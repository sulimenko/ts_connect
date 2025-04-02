({
  access: 'public',
  method: async ({ symbols }) => {
    const endpoint = ['marketdata', 'quotes', symbols.map((symbol) => symbol.toUpperCase()).join(',')];

    const client = await domain.ts.clients.getClient({});

    return lib.ts.send({ method: 'GET', endpoint, token: client.tokens.access });
  },
});
