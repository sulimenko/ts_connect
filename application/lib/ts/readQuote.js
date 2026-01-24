({ message }) => {
  if (!message) return {};

  const instrument = lib.utils.makeSymbol(message.Symbol);
  if (!instrument) {
    console.error('Unknown instrument for quote message:', message);
    return {};
  }
  return {
    ask: parseFloat(message.Ask).toFixed(2),
    ask_size: message.AskSize,
    bid: parseFloat(message.Bid).toFixed(2),
    bid_size: message.BidSize,
    lp: message.Last,
    lp_size: message.LastSize,
    lp_time: new Date(message.LastTradingDate).getTime(),
    volume: message.Volume,
    rtc: null,
    rtc_time: null,
    regular_close: message.Close,
    prev_close_price: parseFloat(message.PreviousClose).toFixed(2),
    prev_volume: message.PreviousVolume,
    open_interest: message.DailyOpenInterest,
    ch: message.NetChange,
    chp: message.NetChangePct,
    date: new Date().getTime(),
    listed_exchange: 'TS',
    currency: 'USD',
    currency_id: 'USD',
    currency_code: 'USD',
    symbol: instrument.symbol,
    underlying: instrument.underlying,
    source: 'TS',
  };
};
