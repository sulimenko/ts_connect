({ relations = false }) => {
  // Atomic, documented combinations only. Caller proves the US STK account,
  // listing, Intelligent route, whole quantity and price rules first.
  const normal = [
    { type: 'market', tif: 'day', sessions: ['regular'] },
    { type: 'limit', tif: 'gtc', sessions: ['regular', 'pre_market', 'post_market'] },
  ].map((row) => ({ ...row, relation: 'NORMAL', orderClass: 'simple', quantityMode: 'whole', side: 'buy', positionEffect: 'open' }));
  if (!relations) return normal;
  return [
    ...normal,
    {
      type: 'limit',
      tif: 'gtc',
      sessions: ['regular'],
      relation: 'BRK',
      orderClass: 'bracket',
      quantityMode: 'whole',
      side: 'buy',
      positionEffect: 'open',
    },
    ...['limit', 'stop'].map((type) => ({
      type,
      tif: 'gtc',
      sessions: ['regular'],
      relation: 'OCO',
      orderClass: 'simple',
      quantityMode: 'whole',
      side: 'sell',
      positionEffect: 'close',
    })),
  ];
};
