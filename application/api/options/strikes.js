({
  access: 'public',
  parameters: 'json',
  returns: 'json',
  errors: {
    EINTERVAL: 'Strike interval must be a positive number',
    ESYMBOL: 'Underlying symbol is required',
  },
  method: async ({
    symbol = null,
    underlying = null,
    type = 'Single',
    spreadType = null,
    interval = 1,
    expiration = null,
    expiration2 = null,
  }) => {
    const rawSymbol = typeof symbol === 'string' ? symbol.trim() : '';
    const rawUnderlying = typeof underlying === 'string' ? underlying.trim() : '';
    const strikesSymbol = (rawSymbol || rawUnderlying).toUpperCase();
    if (!strikesSymbol) return new DomainError('ESYMBOL');

    let spreadValue = 'Single';
    if (typeof spreadType === 'string' && spreadType.trim()) {
      spreadValue = spreadType.trim();
    } else if (typeof type === 'string' && type.trim()) {
      spreadValue = type.trim();
    }
    const intervalValue = Number(interval);
    if (!Number.isFinite(intervalValue) || intervalValue <= 0) return new DomainError('EINTERVAL');

    const data = {
      spreadType: spreadValue,
      strikeInterval: Math.max(1, Math.floor(intervalValue)),
    };
    if (typeof expiration === 'string' && expiration.trim()) data.expiration = expiration.trim();
    if (typeof expiration2 === 'string' && expiration2.trim()) data.expiration2 = expiration2.trim();

    const client = await domain.ts.clients.getClient({});
    const endpoint = ['marketdata', 'options', 'strikes', strikesSymbol];

    return lib.ts.send({ method: 'GET', live: true, endpoint, token: client.tokens.access, data });
  },
});
