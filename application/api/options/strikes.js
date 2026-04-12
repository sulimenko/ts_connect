({
  access: 'public',
  method: async ({ symbol, type = 'Single', interval = 1, expiration = null, expiration2 = null }) => {
    void expiration2;
    const endpoint = ['marketdata', 'options', 'strikes', symbol.toUpperCase()];
    const data = {
      spreadType: type,
      strikeInterval: Number(interval),
    };
    if (expiration) data.expiration = expiration;

    const client = await domain.ts.clients.getClient({});

    return lib.ts.send({ method: 'GET', live: true, endpoint, token: client.tokens.access, data });
  },
});
