({
  access: 'public',
  method: async ({ instruments = [], action = 'subscribe', stop = false, idleMs = null, streamKey = null }) => {
    const actionValue = lib.utils.normalizeAction({ action, stop });
    const symbols = instruments.map((instrument) => {
      const { asset_category: type, symbol } = instrument;
      return lib.utils.makeTSSymbol(symbol, type);
    });
    const key = streamKey || Array.from(new Set(symbols)).sort().join(',');

    if (!key) throw new Error('Instruments are required');
    if (actionValue === 'unsubscribe') {
      return domain.ts.streams.unsubscribe({ kind: 'quotes', key, client: context.client });
    }
    if (actionValue === 'touch') {
      return domain.ts.streams.touch({ kind: 'quotes', key, client: context.client, idleMs });
    }

    const endpoint = ['marketdata', 'stream', 'quotes', key];
    const tsClient = await domain.ts.clients.getClient({});

    // Managed ownership stays at client + kind + streamKey.
    // metaterminal owns consumer counts and uses touch/unsubscribe/clear explicitly.
    return domain.ts.streams.subscribe({
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

        const registeredKey = await tsClient.streamQuotes({ endpoint, onData, onError });
        return {
          stop: async () => {
            await tsClient.stopStoredStream({ group: 'quotes', key: registeredKey });
          },
        };
      },
    });
  },
});
