async ({ responce, endpoint, symbol, data }) => {
  const client = await domain.ts.clients.getClient({});
  const onData = (message) => {
    // console.warn(message.Legs[0].StrikePrice, message.Legs[0].OptionType);
    // if (message.Legs[0].Symbol === 'AMC 251121C.5' || message.Legs[0].Symbol === 'AMC 251121P.5') {
    //   console.debug('Received AMC option chain message:', message);
    // }
    const option = lib.ts.readOptionChain({ message });
    // console.warn('stream chain', option);
    if (!option || option.symbol === undefined) {
      console.error('Invalid option chain data received:', message);
      return;
    }
    responce.emit('stream/chain', {
      symbol: option.symbol,
      expiration: option.expiration,
      chain: { [option.strike]: { [option.type]: option } },
    });
    // responce.emit('stream/chain', option);
    return;
  };

  const onError = (err) => {
    responce(chain, streamKey, timeoutId);
    reject(err);
  };

  client.streamChains({ endpoint, symbol, data, onData, onError });
};
