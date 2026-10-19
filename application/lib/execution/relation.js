({ data }) => {
  const { account, orderId, intent } = data;
  const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const price = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;
  if (!object(intent) || !['BRK', 'OCO'].includes(intent.relation) || !Array.isArray(intent.related)) return null;
  const bracket = intent.relation === 'BRK';
  if (intent.related.length !== (bracket ? 2 : 1)) return null;
  const legs = [intent, ...intent.related];
  if (
    !legs.every(
      (leg, index) =>
        object(leg) &&
        leg.assetCategory === 'STK' &&
        leg.symbol === intent.symbol &&
        (!Object.hasOwn(leg, 'account') || leg.account === account) &&
        (!Object.hasOwn(leg, 'live') || leg.live === data.live) &&
        (!Object.hasOwn(leg, 'route') || leg.route === 'Intelligent') &&
        Number.isSafeInteger(leg.quantity) &&
        leg.quantity === (bracket && index > 0 ? -intent.quantity : intent.quantity) &&
        leg.extended === false &&
        (index === 0 || (leg.relation === 'NORMAL' && Array.isArray(leg.related) && leg.related.length === 0)) &&
        (bracket && index === 0
          ? leg.quantity > 0 && leg.type === 'limit' && leg.tif === 'gtc' && price(leg.limitPrice) && leg.stopPrice === null
          : leg.quantity < 0 &&
            leg.tif === 'gtc' &&
            ((leg.type === 'limit' && price(leg.limitPrice) && leg.stopPrice === null) ||
              (leg.type === 'stop' && price(leg.stopPrice) && leg.limitPrice === null))),
    )
  ) {
    return null;
  }
  const exits = bracket ? intent.related : legs;
  if (exits.filter((leg) => leg.type === 'limit').length !== 1 || exits.filter((leg) => leg.type === 'stop').length !== 1) return null;
  let symbol;
  try {
    const parsed = lib.utils.makeSymbol(intent.symbol);
    if (parsed?.type !== 'STK' || parsed.symbol !== intent.symbol) return null;
    symbol = lib.utils.makeTSSymbol(intent.symbol, 'STK');
  } catch {
    return null;
  }
  // Project only approved fields. Every leg belongs to the envelope account;
  // no caller-provided action, nested relation or route can override it.
  const orders = legs.map((leg, index) => {
    const order = {
      AccountID: account,
      Symbol: symbol,
      Quantity: String(Math.abs(leg.quantity)),
      OrderType: { market: 'Market', limit: 'Limit', stop: 'StopMarket' }[leg.type],
      TimeInForce: { Duration: leg.tif === 'day' ? 'DAY' : 'GTC' },
      TradeAction: bracket && index === 0 ? 'BUY' : 'SELL',
      Route: 'Intelligent',
      OrderConfirmID: bracket && index === 0 ? `meta-${orderId}` : `m${orderId}-${index}`,
    };
    if (leg.type === 'limit') order.LimitPrice = String(leg.limitPrice);
    if (leg.type === 'stop') order.StopPrice = String(leg.stopPrice);
    return order;
  });
  return {
    relation: intent.relation,
    orders,
    endpoint: bracket ? 'orders' : 'ordergroups',
    body: bracket ? { ...orders[0], OSOs: [{ Type: 'BRK', Orders: orders.slice(1) }] } : { Type: 'OCO', Orders: orders },
  };
};
