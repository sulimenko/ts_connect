({ data, symbol, accounts, details, routes }) => {
  const fail = (reason) => ({ version: 1, state: 'unavailable', reason });
  const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const clean = (value) =>
    object(value) &&
    !['Error', 'error', 'errors', 'error_description'].some((key) => Object.hasOwn(value, key)) &&
    (!Object.hasOwn(value, 'Errors') || (Array.isArray(value.Errors) && value.Errors.length === 0));
  const bodyOf = (response) =>
    response?.status === 200 && clean(response.body) && (!Object.hasOwn(response.body, 'NextToken') || response.body.NextToken === '')
      ? response.body
      : null;
  const accountBody = bodyOf(accounts);
  if (!accountBody || !lib.execution.protocol({ kind: 'accounts', response: accounts, account: data.account })) {
    return fail('account_unconfirmed');
  }
  const account = accountBody.Accounts.find((row) => row.AccountID === data.account);
  if (account.Status !== 'Active' || !['Cash', 'Margin'].includes(account.AccountType) || account.Currency !== 'USD') {
    return fail('account_unconfirmed');
  }
  const detailBody = bodyOf(details);
  if (!detailBody || !Array.isArray(detailBody.Symbols) || detailBody.Symbols.length !== 1) {
    return fail('instrument_unconfirmed');
  }
  const instrument = detailBody.Symbols[0];
  const categories = { STOCK: 'STK', STOCKOPTION: 'OPT', INDEXOPTION: 'OPT' };
  const requested = data.instrument;
  if (
    !clean(instrument) ||
    instrument.Symbol !== symbol ||
    categories[instrument.AssetType] !== requested.assetCategory ||
    typeof instrument.Exchange !== 'string' ||
    !instrument.Exchange.trim() ||
    instrument.Exchange !== requested.exchange ||
    typeof instrument.Currency !== 'string' ||
    !/^[A-Z]{3}$/.test(instrument.Currency) ||
    (requested.currency !== null && instrument.Currency !== requested.currency)
  ) {
    return fail('instrument_unconfirmed');
  }
  const routeBody = bodyOf(routes);
  const routeRows = routeBody?.Routes;
  if (
    !Array.isArray(routeRows) ||
    !routeRows.every(
      (row) =>
        clean(row) &&
        typeof row.Id === 'string' &&
        row.Id.trim() !== '' &&
        Array.isArray(row.AssetTypes) &&
        row.AssetTypes.length > 0 &&
        row.AssetTypes.every((type) => typeof type === 'string'),
    ) ||
    new Set(routeRows.map((row) => row.Id)).size !== routeRows.length
  ) {
    return fail('combination_unconfirmed');
  }
  // Documented atomic combinations, not OrderType x Duration enums.
  // OrderRequest.Route defaults to Intelligent (OpenAPI 2026-04-11).
  // Intelligent covers US NYSE/AMEX/Nasdaq stocks. TradeStation's Basket Order
  // documentation jointly confirms Market/Day and Limit/Day on that route. See
  // doc/execution-rules.md for sources and the deliberately narrow coverage.
  const intelligent = routeRows.find((row) => row.Id === 'Intelligent');
  if (
    instrument.AssetType !== 'STOCK' ||
    instrument.Country !== 'United States' ||
    !['NASDAQ', 'NYSE', 'AMEX'].includes(instrument.Exchange) ||
    instrument.Currency !== 'USD' ||
    !intelligent?.AssetTypes.includes('STOCK')
  ) {
    return fail('combination_unconfirmed');
  }
  const quantityFormat = instrument.QuantityFormat;
  const minimum = lib.execution.decimal(quantityFormat?.MinimumTradeQuantity);
  const step = lib.execution.decimal(quantityFormat?.Increment);
  if (
    !clean(quantityFormat) ||
    quantityFormat.Format !== 'Decimal' ||
    quantityFormat.Decimals !== '0' ||
    quantityFormat.IncrementStyle !== 'Simple' ||
    Object.hasOwn(quantityFormat, 'IncrementSchedule') ||
    !minimum ||
    !step ||
    minimum.units <= 0n ||
    step.units <= 0n ||
    minimum.scale !== 0 ||
    step.scale !== 0
  ) {
    return fail('quantity_unconfirmed');
  }
  const price = clean(instrument.PriceFormat) ? lib.execution.priceRules(instrument.PriceFormat) : null;
  if (!price) return fail('price_unconfirmed');
  // Check the official Intelligent range before choosing infinity. GetRoutes
  // confirms the API default route, but not the chosen downstream route/range
  // for these combinations. No client or undocumented payload field can supply
  // the missing applicability proof. See doc/execution-rules.md.
  const maximum = lib.execution.intelligentMaximum({
    instrument,
    route: intelligent.Id,
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
    })),
  });
  return lib.execution.rulesReady({
    data,
    instrument,
    quantity: { fractional: false, minimum: minimum.text, step: step.text, maximum, minimumNotional: null },
    price,
  });
};
