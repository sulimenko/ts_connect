({
  access: 'public',
  method: async ({ text, environment = 'live' }) => {
    if (!['live', 'sim'].includes(environment)) {
      throw new Error('Invalid TradeStation environment');
    }

    const endpoint = ['data', 'symbols', 'suggest', encodeURIComponent(text.toString())];
    const client = await domain.ts.clients.getClient({ sync: false });
    if (!client?.tokens?.access) {
      throw new Error('TradeStation client is unavailable');
    }

    return lib.ts.send({ method: 'GET', live: environment === 'live', ver: 'v2', endpoint, token: client.tokens.access });
  },
});
