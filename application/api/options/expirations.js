({
  access: 'public',
  parameters: 'json',
  returns: 'json',
  errors: {
    ESYMBOL: 'Underlying symbol is required',
    ESTRIKEPRICE: 'Strike price must be numeric',
  },
  method: async ({ symbol = null, underlying = null, strikePrice = null }) => {
    const rawSymbol = typeof symbol === 'string' ? symbol.trim() : '';
    const rawUnderlying = typeof underlying === 'string' ? underlying.trim() : '';
    const expirationsSymbol = (rawSymbol || rawUnderlying).toUpperCase();
    if (!expirationsSymbol) return new DomainError('ESYMBOL');

    const data = {};
    if (strikePrice !== null && strikePrice !== undefined && strikePrice !== '') {
      const strikeValue = Number(strikePrice);
      if (!Number.isFinite(strikeValue)) return new DomainError('ESTRIKEPRICE');
      data.strikePrice = strikeValue;
    }

    const client = await domain.ts.clients.getClient({});
    const endpoint = ['marketdata', 'options', 'expirations', expirationsSymbol];
    const response = await lib.ts.send({ method: 'GET', live: true, endpoint, token: client.tokens.access, data });

    if (Array.isArray(response?.Expirations)) return response.Expirations;
    if (Array.isArray(response?.expirations)) return response.expirations;
    return [];
  },
});
