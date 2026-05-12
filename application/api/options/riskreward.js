({
  access: 'public',
  parameters: 'json',
  returns: 'json',
  errors: {
    ELEGS: 'At least one leg is required',
    ESPREADPRICE: 'Spread price must be numeric',
  },
  method: async ({ spread = null, spreadPrice = null, SpreadPrice = null, legs = null, Legs = null }) => {
    const spreadValue = spreadPrice ?? SpreadPrice ?? spread;
    const parsedSpread = Number(spreadValue);
    if (!Number.isFinite(parsedSpread)) return new DomainError('ESPREADPRICE');

    const requestLegs = Legs ?? legs;
    if (!Array.isArray(requestLegs) || requestLegs.length === 0) return new DomainError('ELEGS');

    const endpoint = ['marketdata', 'options', 'riskreward'];
    const data = {
      SpreadPrice: parsedSpread,
      Legs: requestLegs,
    };

    const client = await domain.ts.clients.getClient({});
    return lib.ts.send({ method: 'POST', live: true, endpoint, token: client.tokens.access, data });
  },
});
