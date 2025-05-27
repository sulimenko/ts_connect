({
  access: 'public',
  method: async ({ text }) => {
    const endpoint = ['data', 'symbols', 'suggest', text.toString()];
    const client = await domain.ts.clients.getClient({});

    return lib.ts.send({ method: 'GET', live: true, ver: 'v2', endpoint, token: client.tokens.access });
  },
});
