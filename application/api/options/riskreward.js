({
  access: 'public',
  method: async ({ spread, legs }) => {
    const endpoint = ['marketdata', 'options', 'riskreward'];
    const data = {
      SpreadPrice: spread,
      Legs: legs,
    };
    const client = await domain.ts.clients.getClient({});
    return lib.ts.send({ method: 'POST', live: true, endpoint, token: client.tokens.access, data });
  },
});
