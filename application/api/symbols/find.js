({
  access: 'public',
  method: async ({ text }) => {
    const url = 'https://api.tradestation.com/v2';
    const endpoint = ['data', 'symbols', 'suggest', text.toString()];

    const client = await domain.ts.client.getClient({});

    return lib.ts.send({ method: 'GET', domain: url, endpoint, token: client.tokens.access });
  },
});
