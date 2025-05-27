// const TimeInForce = { day: 'Day', gtc: 'GTC', ioc: 'IOC' };
// const OrderType = { limit: 'Limit', market: 'Market', stop: 'StopMarket' };

({
  access: 'public',
  method: async ({
    contract,
    instrument,
    qty,
    type, // Limit, Market, StopMarket
    side, // Buy, Sell, BUYTOCOVER, SELLSHORT, BUYTOOPEN, BUYTOCLOSE, SELLTOOPEN, SELLTOCLOSE
    tif = 'GTC', // GTC, Day, IOC
    route = 'Intelligent',
    limit_price = null,
    stop_price = null,
  }) => {
    let endpoint = ['orderexecution', 'orderconfirm'];
    // let endpoint = ['orderexecution', 'marginimpact'];
    let method = 'POST';
    contract.live = contract.live === 1 || contract.live === '1' || contract.live === true || contract.live === 'true';

    const client = await domain.ts.clients.getClient({});

    const action = lib.utils.getAction(contract.account, instrument, side);

    const data = {
      AccountID: contract.account,
      Symbol: instrument.symbol.toUpperCase(),
      Quantity: qty.toString(),
      OrderType: OrderType[type],
      TradeAction: side,
      TimeInForce: { Duration: TimeInForce[tif] },
      Route: route,
    };
    //   Legs: [
    //     {
    //       Symbol: 'DG 250620P95',
    //       Quantity: '1',
    //       // TradeAction: 'BuyToOpen',
    //       TradeAction: 'SellToOpen',
    //     },
    //   ],
    // };

    if (limit_price) data.LimitPrice = limit_price.toString();
    if (stop_price && typeof stop_price === 'number') data.StopPrice = stop_price.toString();

    return lib.ts.send({ method, live: contract.live, endpoint, token: client.tokens.access, data });
  },
});
