async ({ client, contract, ordersIds = [] }) => {
  // const endpoint = ['brokerage', 'stream', 'accounts', contract.account, 'orders'];
  // if (ordersIds.length > 0) endpoint.push(ordersIds.join(','));

  // const onData = (message) => {
  //   console.debug('orders:', message);
  //   lib.ptfin.send({ method: 'POST', endpoint: ['response'], data: { type: 'order', data: message } });
  // };
  // const onError = (err) => console.error('orders:', err);

  // const stop = await lib.ts.stream.initiateStream({
  //   live: contract.live,
  //   endpoint,
  //   tokens: client.tokens,
  //   onData,
  //   onError,
  // });

  // return stop;
};
