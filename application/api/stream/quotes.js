({
  access: 'public',
  method: async ({
    instruments = [],
    action = 'subscribe',
    stop = false,
    idleMs = null,
    streamKey = null,
    traceId = null,
    requestId = null,
  }) => {
    const trace = lib.utils.resolveTraceId({ traceId, requestId, prefix: 'stream' });
    const startedAt = Date.now();
    const actionValue = lib.utils.normalizeAction({ action, stop });
    const symbols = instruments.map((instrument) => {
      const { asset_category: type, symbol } = instrument;
      return lib.utils.makeTSSymbol(symbol, type);
    });
    const key = streamKey || Array.from(new Set(symbols)).sort().join(',');

    lib.utils.traceLog({
      scope: 'stream/quotes',
      phase: 'api.start',
      traceId: trace,
      streamKey: key,
      action: actionValue ?? 'subscribe',
      extra: { symbolCount: instruments.length, tsSymbolCount: symbols.length },
    });

    try {
      if (!key) throw new Error('Instruments are required');
      if (actionValue === 'unsubscribe') {
        return await domain.ts.streams.unsubscribe({ kind: 'quotes', key, client: context.client });
      }
      if (actionValue === 'touch') {
        return await domain.ts.streams.touch({ kind: 'quotes', key, client: context.client, idleMs });
      }

      const endpoint = ['marketdata', 'stream', 'quotes', key];
      const tsClient = await domain.ts.clients.getClient({});

      // Managed ownership stays at client + kind + streamKey.
      // metaterminal owns consumer counts and uses touch/unsubscribe/clear explicitly.
      return await domain.ts.streams.subscribe({
        kind: 'quotes',
        key,
        client: context.client,
        idleMs,
        metadata: { symbols: key, owner: 'metaterminal', streamKey: key },
        start: async ({ notifyError, emit }) => {
          const onData = (message) => {
            const packet = lib.ts.readQuote({ message });
            if (!packet.symbol) return;
            emit('stream/quote', packet);
          };

          const onError = (error) => {
            const message = error?.Error || error?.message || String(error);
            console.error('stream quote error:', message, error?.Symbol ?? '');
            notifyError(error);
          };

          const registeredKey = await tsClient.streamQuotes({
            endpoint,
            onData,
            onError,
            trace: {
              traceId: trace,
              scope: 'stream/quotes',
              streamKey: key,
            },
          });
          return {
            stop: async ({ reason = 'unknown' } = {}) => {
              await tsClient.stopStoredStream({ group: 'quotes', key: registeredKey, reason });
            },
          };
        },
      });
    } finally {
      lib.utils.traceLog({
        scope: 'stream/quotes',
        phase: 'api.done',
        traceId: trace,
        streamKey: key,
        action: actionValue ?? 'subscribe',
        durationMs: Date.now() - startedAt,
        extra: { symbolCount: instruments.length, tsSymbolCount: symbols.length },
      });
    }
  },
});
