({
  access: 'public',
  parameters: 'json',
  returns: 'json',
  errors: {
    ELIMITPRICE: 'A finite limit price is required for this order type',
    ESTOPPRICE: 'A finite stop price is required for this order type',
  },
  method: async ({
    contract, // { account: 11827414, live: true }
    instrument,
    qty,
    type, // Limit, Market, StopMarket
    // side, // Buy, Sell
    tif = 'GTC', // GTC, Day, IOC, GCP
    route = 'Intelligent',
    limit_price: limitPrice = null,
    stop_price: stopPrice = null,
    related = null,
    orderId = null,
  }) => {
    const hasPrice = (value) => value !== null && value !== undefined && `${value}`.trim() !== '' && Number.isFinite(Number(value));
    const needsLimit = type === 'Limit' || type === 'StopLimit';
    const needsStop = type === 'StopMarket' || type === 'StopLimit';
    if (needsLimit && !hasPrice(limitPrice)) return new DomainError('ELIMITPRICE');
    if (needsStop && !hasPrice(stopPrice)) return new DomainError('ESTOPPRICE');

    const live = contract.live === 1 || contract.live === '1' || contract.live === true || contract.live === 'true';
    qty = parseInt(qty);
    const parsedInstrument = lib.utils.makeSymbol(instrument.symbol);
    const instrumentType = parsedInstrument?.type ?? instrument.type ?? instrument.asset_category;

    const data = {
      AccountID: contract.account,
      Symbol: lib.utils.makeTSSymbol(parsedInstrument?.symbol ?? instrument.symbol, instrumentType),
      // Quantity: parseInt(qty),
      OrderType: type,
      TimeInForce: { Duration: tif },
      Route: route,
    };

    if (hasPrice(limitPrice)) data.LimitPrice = limitPrice.toString();
    if (hasPrice(stopPrice)) data.StopPrice = stopPrice.toString();

    // return lib.ts.send({ method, live: contract.live, endpoint, token: client.tokens.access, data });
    const response = await lib.ts.placeorder({ data, qty, instrument, live, related, orderId });

    const isConflict = (message) => {
      if (typeof message !== 'string') return false;
      const value = message.toLowerCase();
      if (/working orders?|closing capacity|short locate|easy to borrow|sl0350|price increment/.test(value)) return false;
      return /boxed position|to close (?:a )?(?:long|short) position|order failed\. reason: you are (?:already )?(?:long|short)\b/.test(
        value,
      );
    };
    const orders = Array.isArray(response?.Orders) ? response.Orders : [];
    const errors = Array.isArray(response?.Errors) ? response.Errors : [];
    const mismatch =
      orders.some((order) => order?.Error === 'FAILED' && isConflict(order?.Message)) ||
      errors.some((error) => {
        const message = typeof error === 'string' ? error : error?.Message || error?.message;
        return isConflict(message);
      });
    if (!mismatch) return response;

    console.error('order', instrument.symbol, qty, type, JSON.stringify(related), JSON.stringify(orders));
    await api.account.positions({ contracts: [contract] });
    return lib.ts.placeorder({ data, qty, instrument, live, related, orderId });
  },
});
