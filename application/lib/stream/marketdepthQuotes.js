// test Не работает, возможно нет разрешений
async ({
  client,
  symbol,
  maxlevels = null, // integer 20 The maximum number of market depth levels to return
}) => {
  const endpoint = ['marketdata', 'stream', 'marketdepth', 'quotes', symbol.toUpperCase()];
  const data = {};
  if (maxlevels) data.maxlevels = maxlevels;

  const onData = (message) => console.debug('marketdepthquotes:', message);
  const onError = (err) => console.error('marketdepthquotes:', err);

  client.socket.marketdepthquotes = {
    endpoint,
    data,
    stop: await lib.ts.stream.initiateStream({ endpoint, token: client.tokens.access, data, onData, onError }),
  };

  return ['OK'];
};
