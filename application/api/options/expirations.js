({
  access: 'public',
  method: async ({ symbol }) => {
    const endpoint = ['marketdata', 'options', 'expirations', symbol.toUpperCase()];

    const client = await domain.ts.clients.getClient({});
    const responce = await lib.ts.send({ method: 'GET', live: true, endpoint, token: client.tokens.access });
    if (responce.Expirations === undefined) {
      console.error('Error fetching expirations:', responce);
      return [];
    }
    // console.info('Fetched expirations for', symbol, responce.Expirations);
    return responce.Expirations;
  },
});
