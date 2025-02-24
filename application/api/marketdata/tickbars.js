({
  access: 'public',
  method: async ({ symbol, interval, bars = 1000 }) => {
    const endpoint = 'stream/tickbars/' + symbol.toUpperCase() + '/' + interval + '/' + bars;
    return lib.ts.stream({ method: 'GET', endpoint });
  },
});
