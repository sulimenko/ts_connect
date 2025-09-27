async ({ data, qty, instrument, live, related = null, orderId = null }) => {
  let method = 'POST';
  let endpoint = ['orderexecution', 'orders'];

  if (orderId && typeof orderId === 'string') {
    endpoint.put(orderId);
    method = 'PUT';
  }

  let current = 0.0;
  try {
    const position = domain.ts.positions.getPosition({ account, symbol: instrument.symbol });
    current = parseFloat(position.get('Quantity')) || 0.0;
  } catch (error) {
    console.error('Error in getAction:', error);
    throw new Error('Invalid action determination');
  }

  data.TradeAction = lib.utils.getAction(instrument, qty, current);
  data.Quantity = Math.abs(qty).toString();

  if (related && related.type === 'brk') {
    data.OSOs = [];
    const relatedOrders = { type: related.type.toUpperCase(), Orders: [] };
    for (const brk of related.orders) {
      const { AccountID, Symbol, Quantity, Route } = data;
      const relatedOrder = { AccountID, Symbol, Quantity, Route };
      relatedOrder.TradeAction = lib.utils.getOppositActions(instrument, data.TradeAction);
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
  response = await lib.ts.send({ method, live, endpoint, token: client.tokens.access, data });
  if (current + qty === 0.0) {
    domain.ts.positions.clearPosition({ account, symbol: instrument.symbol });
    api.account.positions({ contracts: [contract] });
  }
  return response;
};
