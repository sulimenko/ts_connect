({
  access: 'public',
  method: async ({
    contract, // { account: 11827414, live: true }
    instrument,
    qty,
    type, // Limit, Market, StopMarket
    side, // Buy, Sell, BUYTOCOVER, SELLSHORT, BUYTOOPEN, BUYTOCLOSE, SELLTOOPEN, SELLTOCLOSE
    tif = 'GTC', // GTC, Day, IOC
    route = 'Intelligent',
    limit_price = null,
    stop_price = null,
    orderId = null,
  }) => {
    let endpoint = ['orderexecution', 'orders'];
    let method = 'POST';
    contract.live = contract.live === 1 || contract.live === '1' || contract.live === true || contract.live === 'true';

    const client = await domain.ts.client.getClient({});

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
    if (orderId && typeof orderId === 'string') {
      endpoint.put(orderId);
      method = 'PUT';
    }

    console.log(contract, endpoint, data);

    return lib.ts.send({ method, live: contract.live, endpoint, token: client.tokens.access, data });
  },
});
