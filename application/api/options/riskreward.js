({
  access: 'public',
  method: async ({ spread, legs }) => {
    const endpoint = 'marketdata/options/riskreward';
    const data = {
      SpreadPrice: spread,
      Legs: legs,
    };
    return lib.ts.send({ method: 'POST', endpoint, data });
  },
});
