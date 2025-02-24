// test NotEntitled - Не работает, возможно нет разрешений
async ({
  client,
  legs0Symbol, // example: MSFT 220916C305 * `legs`: Individual components of a multi-part trade.\n* `[0]`: Represents the position in the legs array.\n* `Symbol`: Option contract symbol or underlying symbol to be traded for this leg. In some cases, the space in an option symbol may need to be explicitly URI encoded as %20, such as `MSFT%20220916C305`,
  legs0Ratio = null, // number 1 * `legs`: Individual components of a multi-part trade.\n* `[0]`: Represents the position in the legs array.\n* `Ratio`: The number of option contracts or underlying shares for this leg, relative to the other legs. Use a positive number to represent a buy trade and a negative number to represent a sell trade. For example, a quote for a Butterfly spread can be requested using ratios of 1, -2, and 1: buy 1 contract of the first leg, sell 2 contracts of the second leg, and buy 1 contract of the third leg
  riskFreeRate = null, // number The theoretical rate of return of an investment with zero risk. Defaults to the current quote for $IRX.X. The percentage rate should be specified as a decimal value. For example, to use 2% for the rate, pass in 0.02
  enableGreeks = true, // boolean true
}) => {
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
