async ({ client, contract, ordersIds = [] }) => {
  const endpoint = ['brokerage', 'stream', 'accounts', contract.account, 'orders'];
  if (ordersIds.length > 0) endpoint.push(ordersIds.join(','));

  const onData = (message) => {
    console.debug('orders:', message);
    lib.ptfin.send({ method: 'POST', endpoint: ['response'], data: { type: 'order', data: message } });
  };
  const onError = (err) => console.error('orders:', err);

  return {
    endpoint,
    stop: await lib.ts.stream.initiateStream({ live: contract.live, endpoint, token: client.tokens.access, onData, onError }),
  };
};
