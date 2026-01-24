({
  access: 'public',
  method: async ({ instruments }) => {
    const symbolsString = instruments
      .map((instrument) => {
        const { asset_category: type, symbol } = instrument;
        return lib.utils.makeTSSymbol(symbol, type);
      })
      .join(',');
    const endpoint = ['marketdata', 'stream', 'quotes', symbolsString];

    const onData = (message) => {
      // console.debug('stream matrix ' + symbol + ':', message);
      const packet = lib.ts.readQuote({ message });
      // console.debug('stream quote ' + symbolsString + ':', packet);
      context.client.emit('stream/quote', packet);
    };
    const onError = (err) => console.error('stream quote error:', err);

    const client = await domain.ts.clients.getClient({});

    client.streamQuotes({ endpoint, onData, onError });
    return ['ok'];
  },
});
