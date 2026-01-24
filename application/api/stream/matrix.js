({
  access: 'public',
  method: async ({ symbol, type }) => {
    // console.warn(symbol, type);
    const endpoint = ['stream', 'matrix', 'changes', symbol];
    const data = { heartbeat: true, limit: 50, increment: 0.01, enableVolume: true };

    const symbolData = lib.utils.convertSymbol({ symbol, type });
    // console.warn(symbolData);
    const onData = (message) => {
      if (message.AskSize === undefined && message.BidSize === undefined) return;
      console.debug('stream matrix ' + symbol + ':', message);
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
      if (packet.type === 'delete' && packet.size != 0) console.error('stream matrix delete with size', message);

      // console.debug('stream matrix ' + symbol + ':', packet);
      context.client.emit('stream/levelII', packet);
    };
    const onError = (err) => console.error('stream matrix error:', err);

    const client = await domain.ts.clients.getClient({});

    client.streamMatrix({ endpoint, symbol, data, onData, onError });
    return ['ok'];
  },
});
