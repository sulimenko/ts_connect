({ data, instrument, quantity, price }) => {
  const fail = () => ({ version: 1, state: 'unavailable', reason: 'quantity_unconfirmed' });
  // Internal common-wire formatter. Its caller owns authoritative evidence.
  // Only maximum has an unknown -> infinity exception; other rules fail closed.
  const minimum = lib.execution.decimal(quantity.minimum);
  const step = lib.execution.decimal(quantity.step);
  const unconfirmed = quantity.maximum === undefined || quantity.maximum === null || quantity.maximum === 'infinity';
  const maximum = unconfirmed ? null : lib.execution.decimal(quantity.maximum);
  const amounts = maximum ? [minimum, step, maximum] : [minimum, step];
  if (
    quantity.fractional !== false ||
    !minimum ||
    !step ||
    (!unconfirmed && !maximum) ||
    amounts.some((value) => value.units <= 0n || value.scale !== 0)
  ) {
    return fail();
  }
  if (maximum && minimum.units > maximum.units) return fail();
  const constraints = {
    fractional: false,
    minimum: minimum.text,
    step: step.text,
    // Runtime representability is guarded by T-068 when submitting an order.
    maximum: maximum?.text ?? 'infinity',
    minimumNotional: quantity.minimumNotional,
  };
  const requested = data.instrument;
  return {
    version: 1,
    state: 'ready',
    identity: { terminal: 'TS', externalAccount: data.account, live: data.live },
    instrument: {
      symbol: requested.symbol,
      assetCategory: requested.assetCategory,
      exchange: instrument.Exchange,
      currency: instrument.Currency,
    },
    orders: ['market', 'limit'].map((type) => ({
      type,
      tif: 'day',
      session: 'regular',
      extended: false,
      relation: 'NORMAL',
      orderClass: 'simple',
      quantityMode: 'whole',
      side: 'buy',
      positionEffect: 'open',
      quantity: { ...constraints },
    })),
    quantity: { ...constraints },
    price,
  };
};
