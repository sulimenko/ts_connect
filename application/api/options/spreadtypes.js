({
  access: 'public',
  method: async () => {
    const endpoint = ['marketdata', 'options', 'spreadtypes'];
    const client = await domain.ts.clients.getClient({});
    return lib.ts.send({ method: 'GET', live: true, endpoint, token: client.tokens.access });
  },
});
