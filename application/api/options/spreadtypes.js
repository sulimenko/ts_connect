({
  access: 'public',
  method: async ({ spread, legs }) => {
    const endpoint = 'marketdata/options/spreadtypes';
    return lib.ts.send({ method: 'GET', endpoint });
  },
});
