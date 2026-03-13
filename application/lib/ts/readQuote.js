/* eslint camelcase: "off" */

({ message }) => {
  const toFixedString = (value, digits) => {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(digits) : null;
  };

  const toTimestamp = (value) => {
    const time = Date.parse(value);
    return Number.isNaN(time) ? null : time;
  };

  if (!message) return {};

  const instrument = lib.utils.makeSymbol(message.Symbol);
  if (!instrument) {
    console.error('Unknown instrument for quote message:', message);
    return {};
  }
  return {
    ask: toFixedString(message.Ask, 2),
    ask_size: message.AskSize,
    bid: toFixedString(message.Bid, 2),
    bid_size: message.BidSize,
    lp: message.Last ?? null,
    lp_size: message.LastSize,
    lp_time: toTimestamp(message.TradeTime ?? message.LastTradingDate),
    volume: message.Volume,
    rtc: null,
    rtc_time: null,
    regular_close: message.Close,
    prev_close_price: toFixedString(message.PreviousClose, 2),
    prev_volume: message.PreviousVolume,
    open_interest: message.DailyOpenInterest,
    ch: message.NetChange,
    chp: message.NetChangePct,
    date: Date.now(),
    listed_exchange: 'TS',
    currency: 'USD',
    currency_id: 'USD',
    currency_code: 'USD',
    symbol: instrument.symbol,
    underlying: instrument.underlying,
    source: 'TS',
  };
};
