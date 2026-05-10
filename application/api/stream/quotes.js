({
  access: 'public',
  parameters: 'json',
  returns: 'json',
  errors: {
    EACTION: 'Invalid action: expected "subscribe", "unsubscribe", or "touch"',
    EINSTRUMENTS: 'At least one valid instrument is required for quote subscribe requests',
  },
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
    const actionSet = new Set(['subscribe', 'unsubscribe', 'touch']);
    const actionValue = lib.utils.normalizeAction({ action, stop });
    const actionLabel = actionValue ?? 'subscribe';
    const providedKey = typeof streamKey === 'string' ? streamKey.trim() || null : null;
    let key = providedKey;
    let status = 'ok';
    let validInstrumentCount = 0;
    let tsSymbolCount = 0;

    lib.utils.traceLog({
      scope: 'stream/quotes',
      phase: 'api.start',
      traceId: trace,
      streamKey: key,
      action: actionLabel,
      extra: { instrumentCount: instruments.length },
    });

    try {
      if (actionValue !== null && !actionSet.has(actionValue)) {
        status = 'error:EACTION';
        return new DomainError('EACTION');
      }

      const normalizedSymbols = [];
      for (const instrument of instruments) {
        if (!instrument || typeof instrument !== 'object') continue;
        const symbol = typeof instrument.symbol === 'string' ? instrument.symbol.trim() : '';
        if (!symbol) continue;

        const type = typeof instrument.asset_category === 'string' ? instrument.asset_category : 'STK';
        try {
          normalizedSymbols.push(lib.utils.makeTSSymbol(symbol, type));
          validInstrumentCount += 1;
        } catch (error) {
          console.error('Invalid quote instrument:', instrument, error);
        }
      }

      const symbols = Array.from(new Set(normalizedSymbols)).sort();
      tsSymbolCount = symbols.length;

      if (actionValue === 'subscribe' && symbols.length === 0) {
        status = 'error:EINSTRUMENTS';
        return new DomainError('EINSTRUMENTS');
      }

      if (!key) {
        if (symbols.length === 0) {
          status = 'error:EINSTRUMENTS';
          return new DomainError('EINSTRUMENTS');
        }
        key = symbols.join(',');
      }

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
    } catch (error) {
      status = error instanceof DomainError ? `error:${error.code}` : 'error:internal';
      throw error;
    } finally {
      lib.utils.traceLog({
        scope: 'stream/quotes',
        phase: 'api.done',
        traceId: trace,
        streamKey: key,
        action: actionLabel,
        durationMs: Date.now() - startedAt,
        extra: {
          instrumentCount: instruments.length,
          validInstrumentCount,
          tsSymbolCount,
          status,
        },
      });
    }
  },
});
