({
  access: 'public',
  method: async (criteria) => {
    const queryString = new URLSearchParams(criteria);
    const endpoint = ['data', 'symbols', 'search', queryString.toString()];
    const client = await domain.ts.clients.getClient({});

    return lib.ts.send({ method: 'GET', live: true, ver: 'v2', endpoint, token: client.tokens.access });
  },
});
