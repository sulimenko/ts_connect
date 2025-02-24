// test NotEntitled возможно не открыт доступ
async ({
  client,
  symbol,
  expiration = null, // string '12-17-2021' Date on which the option contract expires; must be a valid expiration date. Defaults to the next contract expiration date
  expiration2 = null, // string '12-17-2021' Second contract expiration date required for Calendar and Diagonal spreads
  strikeProximity = null, // integer 5 number of spreads to display above and below the priceCenter
  spreadType = null, // 'Single', 'Butterfly'
  riskFreeRate = null, // example, to use 2% for the rate, pass in 0.02
  priceCenter = null, // Defaults to the last quoted price for the underlying security
  strikeInterval = null, // integer
  enableGreeks = null, // boolean true
  strikeRange = null, // 'All', 'ITM', 'OTM'
  optionType = 'All', // 'All', 'Call', 'Put'
}) => {
  const endpoint = ['marketdata', 'stream', 'options', 'chains', symbol.toUpperCase()];
  const data = { optionType };

  const onData = (message) => console.debug('optionsChains:', message);
  const onError = (err) => console.error('optionsChains:', err);

  client.socket.bars = {
    endpoint,
    data,
    stop: await lib.ts.stream.initiateStream({ endpoint, token: client.tokens.access, data, onData, onError }),
  };

  return ['OK'];
};
