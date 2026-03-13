({
  access: 'public',
  method: async ({ symbol = null, type = 'STK', action = 'subscribe', stop = false, idleMs = null, streamKey = null }) => {
    const actionValue = lib.utils.normalizeAction({ action, stop });
    if (!symbol && !(streamKey && actionValue)) throw new Error('Symbol is required');

    const data = { heartbeat: true, limit: 50, increment: 0.01, enableVolume: true };
    const rawSymbolData = symbol ? lib.utils.convertSymbol({ symbol, type }) : null;
    const symbolData = typeof rawSymbolData === 'string' ? { symbol: rawSymbolData.toUpperCase() } : rawSymbolData;
    const tsClient = await domain.ts.clients.getClient({});
    const key = streamKey || tsClient.buildStreamKey({ group: 'matrix', symbol: symbolData?.symbol ?? symbol, data });

    if (actionValue === 'unsubscribe') {
      return domain.ts.streams.unsubscribe({ kind: 'matrix', key, client: context.client });
    }
    if (actionValue === 'touch') {
      return domain.ts.streams.touch({ kind: 'matrix', key, client: context.client, idleMs });
    }

    if (!symbolData) throw new Error('Invalid symbol for matrix stream');
    const endpoint = ['stream', 'matrix', 'changes', symbol];

    return domain.ts.streams.subscribe({
      kind: 'matrix',
      key,
      client: context.client,
      idleMs,
      metadata: { symbol: symbolData.symbol },
      start: async ({ notifyError, emit }) => {
        const onData = (message) => {
          if (message.AskSize === undefined && message.BidSize === undefined) return;

          const packet = { symbol: symbolData.symbol, price: message.Price };
          if (message.BidSize > 0) {
            packet.type = 'bid';
            packet.size = message.BidSize;
          } else if (message.AskSize > 0) {
            packet.type = 'ask';
            packet.size = message.AskSize;
          } else {
            packet.type = 'delete';
            packet.size = message.BidSize ?? message.AskSize;
          }

          if (packet.type === 'delete' && packet.size !== 0) {
            console.error('stream matrix delete with size', message);
          }

          emit('stream/levelII', packet);
        };

        const onError = (error) => {
          console.error('stream matrix error:', error);
          notifyError(error);
        };

        const registeredKey = await tsClient.streamMatrix({ endpoint, symbol: symbolData.symbol, data, onData, onError });
        return {
          stop: async () => {
            await tsClient.stopStoredStream({ group: 'matrix', key: registeredKey });
          },
        };
      },
    });
  },
});
