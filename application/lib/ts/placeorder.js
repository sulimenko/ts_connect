async ({ data, qty, instrument, live, related = null, orderId = null }) => {
  let method = 'POST';
  const endpoint = ['orderexecution', 'orders'];
  const account = data.AccountID;
  const parsedInstrument = lib.utils.makeSymbol(instrument.symbol);
  const symbol = parsedInstrument?.symbol ?? null;
  const instrumentType = parsedInstrument?.type ?? instrument.type ?? instrument.asset_category;
  const orderInstrument = { ...instrument, type: instrumentType };

  if (orderId && typeof orderId === 'string') {
    endpoint.push(orderId);
    method = 'PUT';
  }

  let current = 0.0;
  try {
    const position = domain.ts.positions.getPosition({ account, symbol });
    current = lib.utils.readPositionQuantity(position);
    if (!position) {
      console.info(
        'placeorder position miss',
        `account=${account}`,
        `symbol=${instrument.symbol}`,
        `canonicalSymbol=${symbol}`,
        `current=${current}`,
      );
    }
  } catch (error) {
    console.error('Error in getAction:', error);
    throw new Error('Invalid action determination');
  }

  data.TradeAction = lib.utils.getAction(orderInstrument, qty, current);
  data.Quantity = Math.abs(qty).toString();
  data.Symbol = lib.utils.makeTSSymbol(parsedInstrument?.symbol ?? instrument.symbol, instrumentType);

  if (related && related.type === 'brk') {
    data.OSOs = [];
    const relatedOrders = { type: related.type.toUpperCase(), Orders: [] };
    for (const brk of related.orders) {
      const { AccountID, Symbol, Quantity, Route } = data;
      const relatedOrder = { AccountID, Symbol, Quantity, Route };
      relatedOrder.TradeAction = lib.utils.getOppositActions(orderInstrument, data.TradeAction);
      relatedOrder.TimeInForce = { Duration: 'GTC' };
      if (brk.type === 'limit') {
        relatedOrder.OrderType = 'Limit';
        relatedOrder.LimitPrice = brk.limit_price.toString();
      } else if (brk.type === 'stop') {
        relatedOrder.OrderType = 'StopMarket';
        relatedOrder.StopPrice = brk.stop_price.toString();
      }
      relatedOrders.Orders.push(relatedOrder);
    }
    data.OSOs.push(relatedOrders);
  }

  console.warn('placeorder', JSON.stringify(endpoint), JSON.stringify(data));

  const client = await domain.ts.clients.getClient({});
  const response = await lib.ts.send({ method, live, endpoint, token: client.tokens.access, data });
  if (current + qty === 0.0) {
    domain.ts.positions.clearPosition({ account, symbol });
    // api.account.positions({ contracts: [contract] });
  }
  return response;
};
