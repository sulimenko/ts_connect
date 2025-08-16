({
  access: 'public',
  method: async ({
    contract, // { account: 11827414, live: true }
    instrument,
    qty,
    type, // Limit, Market, StopMarket
    // side, // Buy, Sell
    tif = 'GTC', // GTC, Day, IOC, GCP
    route = 'Intelligent',
    limit_price = null,
    stop_price = null,
    related = null,
    orderId = null,
  }) => {
    const live = contract.live === 1 || contract.live === '1' || contract.live === true || contract.live === 'true';
    qty = parseInt(qty);

    const data = {
      AccountID: contract.account,
      Symbol: instrument.symbol.toUpperCase(),
      // Quantity: parseInt(qty),
      OrderType: type,
      TimeInForce: { Duration: tif },
      Route: route,
    };

    if (limit_price) data.LimitPrice = limit_price.toString();
    if (stop_price && typeof stop_price === 'number') data.StopPrice = stop_price.toString();

    // return lib.ts.send({ method, live: contract.live, endpoint, token: client.tokens.access, data });
    const response = await lib.ts.placeorder({ data, qty, instrument, live, related, orderId });

    const check = !response.Orders.some((order) => {
      order.Error === 'FAILED' && order.Message && order.Message.includes('Order failed. Reason: You are');
    });
    if (check) return response;

    console.error('order', instrument.symbol, qty, type, JSON.stringify(related), JSON.stringify(response.Orders));
    await api.account.positions({ contracts: [contract] });
    return lib.ts.placeorder({ data, qty, instrument, live, related, orderId });
  },
});
