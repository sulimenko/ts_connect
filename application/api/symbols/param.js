({
  access: 'public',
  method: async (criteria) => {
    const url = 'https://api.tradestation.com/v2';
    const queryString = new URLSearchParams(criteria);
    const endpoint = ['data', 'symbols', 'search', queryString.toString()];

    const client = await domain.ts.client.getClient({});

    return lib.ts.send({ method: 'GET', domain: url, endpoint, token: client.tokens.access });
  },
});
