({
  access: 'public',
  method: async ({ contracts, orders = [], start = null, limit = null }) => {
    const client = await domain.ts.clients.getClient({});
    const result = [];
    for (const contract of contracts) {
      contract.live = contract.live === 1 || contract.live === '1' || contract.live === true || contract.live === 'true';
      let endpoint = ['brokerage', 'accounts', contract.account, 'historicalorders'];
      if (orders.length > 0) endpoint.push(orders.join(','));
      const since = start || new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().split('T')[0];
      const data = { since };
      if (limit !== null) data.pageSize = limit;

      const responce = await lib.ts.send({ method: 'GET', live: contract.live, endpoint, token: client.tokens.access, data });
      // console.log('orders:', responce);
      if (responce.Errors.length === 0 && responce.Orders.length > 0) result.push(...responce.Orders);
    }

    return result;
  },
});
