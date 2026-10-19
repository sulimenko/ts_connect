({
  access: 'public',
  method: async ({ symbol, environment = 'live' }) => {
    if (!['live', 'sim'].includes(environment)) {
      throw new Error('Invalid TradeStation environment');
    }
    if (typeof symbol !== 'string' || symbol.trim() === '') {
      throw new Error('TradeStation symbol is required');
    }

    const endpoint = ['marketdata', 'symbols', encodeURIComponent(symbol.trim())];
    const client = await domain.ts.clients.getClient({ sync: false });
    if (!client?.tokens?.access) {
      throw new Error('TradeStation client is unavailable');
    }

    return lib.ts.send({
      method: 'GET',
      live: environment === 'live',
      endpoint,
      token: client.tokens.access,
    });
  },
});
