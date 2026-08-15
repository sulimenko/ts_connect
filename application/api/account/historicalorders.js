({
  access: 'public',
  parameters: 'json',
  returns: 'json',
  errors: {
    EACCOUNT: 'At least one brokerage account contract is required',
  },
  validate: ({ contracts }) => Array.isArray(contracts) && contracts.length > 0,
  method: async ({ contracts, orders = [], start = null, limit = null }) => {
    const client = await domain.ts.clients.getClient({});
    const result = [];
    for (const contract of contracts) {
      contract.live = contract.live === 1 || contract.live === '1' || contract.live === true || contract.live === 'true';
      const response = await lib.ts.orders({
        account: contract.account,
        live: contract.live,
        token: client.tokens.access,
        orderIds: orders,
        start,
        limit,
        historical: true,
      });
      if (response.errors.length === 0) result.push(...response.orders);
    }

    return result;
  },
});
