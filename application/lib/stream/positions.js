async ({ client, contract, changes = true }) => {
  const endpoint = ['brokerage', 'stream', 'accounts', contract.account, 'positions'];
  const data = { changes };

  const onData = (message) => {
  //  console.debug('positions:', message);
    if (message.StreamStatus === undefined) {
      const position = domain.ts.positions.setPosition({ account: message.AccountID, symbol: message.Symbol, data: message });
    //  console.warn('domain positions:', position);
    }
    //  else {}
  };
  const onError = (err) => console.error('positions:', err);

  return {
    endpoint,
    data,
    stop: await lib.ts.stream.initiateStream({ live: contract.live, endpoint, token: client.tokens.access, data, onData, onError }),
  };
};
