({
  access: 'public',
  method: async () => {
    const positions = domain.ts.positions.values;
    for (const account of positions.keys()) {
      console.debug('account', account);
      const total = positions.get(account);
      for (const symbol of total.keys()) {
        console.warn('symbol', symbol);
        console.warn('position', total.get(symbol));
      }
    }
    return ['OK'];
  },
});
