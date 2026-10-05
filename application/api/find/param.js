({
  access: 'public',
  method: async (criteria = {}) => {
    const { environment = 'live', ...searchCriteria } = criteria;
    if (!['live', 'sim'].includes(environment)) {
      throw new Error('Invalid TradeStation environment');
    }

    const queryString = new URLSearchParams(searchCriteria);
    const endpoint = ['data', 'symbols', 'search', queryString.toString()];
    const client = await domain.ts.clients.getClient({ sync: false });
    if (!client?.tokens?.access) {
      throw new Error('TradeStation client is unavailable');
    }

    return lib.ts.send({ method: 'GET', live: environment === 'live', ver: 'v2', endpoint, token: client.tokens.access });
  },
});
