async ({ client, symbol, period, limit }) => {
  const domain = 'https://api.tradestation.com/v2';
  const endpoint = ['stream', 'tickbars', symbol.toUpperCase(), (period / 60).toString(), limit.toString()];

  const onData = (message) => console.debug('barsticks:', message);
  const onError = (err) => console.error('barsticks:', err);

  client.socket.bars = {
    endpoint,
    stop: await lib.ts.stream.initiateStream({ domain, endpoint, token: client.tokens.access, onData, onError }),
  };

  return ['OK'];
};
