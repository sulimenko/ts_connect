({
  access: 'public',
  method: async ({ symbol, type = 'Single', interval = 1, expiration = null, expiration2 = null }) => {
    const endpoint = ['marketdata', 'options', 'strikes', symbol.toUpperCase()];
    const data = {
      spreadType: type,
      strikeInterval: Number(interval),
    };

    const client = await domain.ts.client.getClient({});

    return lib.ts.send({ method: 'GET', endpoint, token: client.tokens.access, data });
  },
});
