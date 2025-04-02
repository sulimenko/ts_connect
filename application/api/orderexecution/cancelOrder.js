({
  access: 'public',
  method: async ({
    contract, // { account: 11827414, live: true }
    orderId,
  }) => {
    let endpoint = ['orderexecution', 'orders', orderId.toString()];
    let method = 'DELETE';
    contract.live = contract.live === 1 || contract.live === '1' || contract.live === true || contract.live === 'true';

    const client = await domain.ts.clients.getClient({});

    // console.log(endpoint);
    return lib.ts.send({ method, live: contract.live, endpoint, token: client.tokens.access });
  },
});
