({
  access: 'public',
  method: async ({
    contract, // { account: 11827414, live: true }
    instrument,
    qty,
    type, // Limit, Market, StopMarket
    side, // Buy, Sell
    tif = 'GTC', // GTC, Day, IOC, GCP
    route = 'Intelligent',
    limit_price = null,
    stop_price = null,
    related = null,
    orderId = null,
  }) => {
    let endpoint = ['orderexecution', 'orders'];
    let method = 'POST';
    contract.live = contract.live === 1 || contract.live === '1' || contract.live === true || contract.live === 'true';

    const client = await domain.ts.clients.getClient({});

    const action = lib.utils.getAction(contract.account, instrument, side);

    const data = {
      AccountID: contract.account,
      Symbol: instrument.symbol.toUpperCase(),
      Quantity: qty.toString(),
      OrderType: type,
      TradeAction: action,
      TimeInForce: { Duration: tif },
      Route: route,
    };

    if (limit_price) data.LimitPrice = limit_price.toString();
    if (stop_price && typeof stop_price === 'number') data.StopPrice = stop_price.toString();
    if (related && related.type === 'brk') {
      console.debug(related);
      data.OSOs = [];
      const relatedOrders = { type: related.type.toUpperCase(), Orders: [] };
      for (const brk of related.orders) {
        const { AccountID, Symbol, Quantity, Route } = data;
        const relatedOrder = { AccountID, Symbol, Quantity, Route };
        relatedOrder.TradeAction = lib.utils.getOppositActions(instrument, action);
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

    if (orderId && typeof orderId === 'string') {
      endpoint.put(orderId);
      method = 'PUT';
    }

    console.log(contract, endpoint, JSON.stringify(data));

    return lib.ts.send({ method, live: contract.live, endpoint, token: client.tokens.access, data });
  },
});
