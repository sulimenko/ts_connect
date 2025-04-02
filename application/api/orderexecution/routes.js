({
  access: 'public',
  method: async () => {
    const endpoint = ['orderexecution', 'routes'];

    const client = await domain.ts.clients.getClient({});

    return lib.ts.send({ method: 'GET', endpoint, token: client.tokens.access });
  },
});
