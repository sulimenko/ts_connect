// test NotEntitled - Не работает, возможно нет разрешений
async ({ client, legs0Symbol, legs0Ratio = null, riskFreeRate = null, enableGreeks = true }) => {
  void legs0Symbol;
  void legs0Ratio;
  void riskFreeRate;
  const endpoint = ['marketdata', 'stream', 'options', 'quotes'];
  const data = { enableGreeks };

  const onData = (message) => console.debug('optionsQuotes:', message);
  const onError = (err) => console.error('optionsQuotes:', err);

  client.socket.bars = {
    endpoint,
    data,
    stop: await lib.ts.stream.initiateStream({ endpoint, token: client.tokens.access, data, onData, onError }),
  };

  return ['OK'];
};
