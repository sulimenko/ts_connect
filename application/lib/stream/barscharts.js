async ({ client, symbol, period = 3600, limit = 1000 }) => {
  const endpoint = ['marketdata', 'stream', 'barcharts', symbol.toUpperCase()];

  let interval = '1';
  let unit = 'Minute';
  if (period < 86400) interval = (period / 60).toString();
  else if (period === 86400) unit = 'Daily';
  else if (period === 604800) unit = 'Weekly';
  else if (period > 604800) unit = 'Monthly';

  const data = {
    interval, // string 1 to 1440 minute
    unit, // string 'Minute, Daily, Weekly, Monthly'
    barsback: limit.toString(), // string 1 to 57600
    sessiontemplate: 'USEQ24Hour', // `USEQPre`, `USEQPost`, `USEQPreAndPost`, `USEQ24Hour`,`Default`.
  };

  const onData = (message) => console.debug('barscharts:', message);
  const onError = (err) => console.error('barscharts:', err);
  client.socket.barscharts = {
    endpoint,
    data,
    stop: await lib.ts.stream.initiateStream({ endpoint, token: client.tokens.access, data, onData, onError }),
  };

  return ['OK'];
};
