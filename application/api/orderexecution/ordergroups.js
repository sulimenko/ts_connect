// const TimeInForce = { day: 'Day', gtc: 'GTC', ioc: 'IOC' };
// const OrderType = { limit: 'Limit', market: 'Market', stop: 'StopMarket' };

({
  access: 'public',
  method: async () => {
    const endpoint = 'orderexecution/ordergroups';
    // const data = {
    //   AccountID: account,
    //   Symbol: symbol.toUpperCase(),
    //   Quantity: qty,
    //   OrderType: OrderType[type],
    //   TradeAction: side,
    //   TimeInForce: { Duration: TimeInForce[tif] },
    //   Route: route,
    // };

    // if (limit_price && typeof limit_price === 'number') data.LimitPrice = limit_price;
    // if (stop_price && typeof stop_price === 'number') data.StopPrice = stop_price;

    // return lib.ts.send({ method: 'POST', endpoint, data });
    return [endpoint];
  },
});
