({
  access: 'public',
  parameters: 'json',
  returns: 'json',
  errors: {
    EACCOUNT: 'At least one brokerage account contract is required',
  },
  validate: ({ contracts }) => Array.isArray(contracts) && contracts.length > 0,
  method: async ({ contracts, orders = [], limit = null }) => {
    const client = await domain.ts.clients.getClient({});
    const result = [];
    for (const contract of contracts) {
      contract.live = contract.live === 1 || contract.live === '1' || contract.live === true || contract.live === 'true';
      const response = await lib.ts.orders({
        account: contract.account,
        live: contract.live,
        token: client.tokens.access,
        orderIds: orders,
        limit,
      });
      if (response.errors.length === 0) result.push(...response.orders);
    }

    // let details = {};
    // for (const order of responce.Orders) {
    //   // if (['FLL'].includes(order.Status)) {
    //   details = await lib.ts.send({ method: 'GET', endpoint: ['accounts','11827414','executions'], token: client.tokens.access, data });
    //   // details = await api.account.historicalorders({ accounts, orders: ['1128551599'], start: '2025-02-01' });
    //   console.log(details);
    //   // }
    // }
    return result;
  },
});
