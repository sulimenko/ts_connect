({
  access: 'public',
  parameters: 'json',
  returns: 'json',
  errors: {
    EACCOUNT: 'At least one brokerage account contract is required',
  },
  validate: ({ contracts }) => Array.isArray(contracts) && contracts.length > 0,
  method: async ({ contracts, orders = [], limit = null }) => {
    const client = await domain.ts.clients.getClient({ sync: false });
    return await lib.ts.ordersBatch({
      contracts,
      token: client.tokens.access,
      orderIds: orders,
      limit,
    });
  },
});
