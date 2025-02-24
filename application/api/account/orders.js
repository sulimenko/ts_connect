({
  access: 'public',
  method: async ({ contracts, orders = [], limit = null }) => {
    const client = await domain.ts.client.getClient({});
    const result = [];
    for (const contract of contracts) {
      contract.live = contract.live === 1 || contract.live === '1' || contract.live === true || contract.live === 'true';
      let endpoint = ['brokerage', 'accounts', contract.account, 'orders'];
      if (orders.length > 0) endpoint.push(orders.join(','));
      const data = {};
      if (limit !== null) data.pageSize = limit;

      const responce = await lib.ts.send({ method: 'GET', live: contract.live, endpoint, token: client.tokens.access, data });
      // console.log('orders:', responce);
      if (responce.Errors.length === 0 && responce.Orders.length > 0) result.push(...responce.Orders);
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
