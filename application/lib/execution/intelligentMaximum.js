({ instrument, route, orders, applicability }) => {
  // Official range is conditional on the route chosen by Intelligent:
  // https://help.tradestation.com/10_00/eng/tradestationhelp/routes/intelligent.htm
  // This is a trusted internal proof input, never request/broker extension
  // fields. API Routes has no selected-route/range/combination proof today.
  const source = 'https://help.tradestation.com/10_00/eng/tradestationhelp/routes/intelligent.htm';
  const keys = ['type', 'tif', 'relation', 'orderClass', 'quantityMode', 'side', 'positionEffect'];
  const sessionsMatch = (actual, expected) =>
    Array.isArray(actual) && actual.length === expected.length && expected.every((session, index) => actual[index] === session);
  if (
    route !== 'Intelligent' ||
    instrument.AssetType !== 'STOCK' ||
    instrument.Country !== 'United States' ||
    instrument.Currency !== 'USD' ||
    !['NASDAQ', 'NYSE', 'AMEX'].includes(instrument.Exchange) ||
    applicability?.source !== source ||
    applicability.symbol !== instrument.Symbol ||
    applicability.exchange !== instrument.Exchange ||
    applicability.apiDefaultRoute !== route ||
    typeof applicability.selectedRoute !== 'string' ||
    !applicability.selectedRoute.trim() ||
    applicability.minimum !== '1' ||
    applicability.maximum !== '1000000' ||
    !Array.isArray(applicability.combinations) ||
    !Array.isArray(orders) ||
    orders.length === 0 ||
    !orders.every(
      (order) =>
        order &&
        ((order.type === 'market' && order.tif === 'day' && sessionsMatch(order.sessions, ['regular'])) ||
          (order.type === 'limit' && order.tif === 'gtc' && sessionsMatch(order.sessions, ['regular', 'pre_market', 'post_market']))) &&
        order.relation === 'NORMAL' &&
        order.orderClass === 'simple' &&
        order.quantityMode === 'whole' &&
        order.side === 'buy' &&
        order.positionEffect === 'open' &&
        applicability.combinations.some(
          (proven) =>
            proven &&
            keys.every((key) => Object.hasOwn(proven, key) && proven[key] === order[key]) &&
            Object.hasOwn(proven, 'sessions') &&
            sessionsMatch(proven.sessions, order.sessions),
        ),
    )
  ) {
    return 'infinity';
  }
  return '1000000';
};
