({
  access: 'public',
  method: async ({ symbol }) => {
    const endpoint = 'marketdata/options/expirations/' + symbol.toUpperCase();
    return lib.ts.send({ method: 'GET', endpoint });
  },
});
