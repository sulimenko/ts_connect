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
  const quote = {
    bid: toFixedString(message.Bid, 2),
    bid_size: message.BidSize,
    ask: toFixedString(message.Ask, 2),
    ask_size: message.AskSize,
  };
  const data = {
    symbol: instrument.symbol,
    lp: message.Last ?? null,
    lp_time: toTimestamp(message.TradeTime ?? message.LastTradingDate),
    prev_close_price: toFixedString(message.PreviousClose, 2),
    date: Date.now(),
    listed_exchange: 'TS',
    currency: 'USD',
    currency_id: 'USD',
    currency_code: 'USD',
    underlying: instrument.underlying,
    source: 'TS',
  };
  return {
    ask: quote.ask,
    ask_size: quote.ask_size,
    bid: quote.bid,
    bid_size: quote.bid_size,
    lp: data.lp,
    lp_size: message.LastSize,
    lp_time: data.lp_time,
    volume: message.Volume,
    rtc: null,
    rtc_time: null,
    regular_close: message.Close,
    prev_close_price: data.prev_close_price,
    prev_volume: message.PreviousVolume,
    open_interest: message.DailyOpenInterest,
    ch: message.NetChange,
    chp: message.NetChangePct,
    date: data.date,
    listed_exchange: data.listed_exchange,
    currency: data.currency,
    currency_id: data.currency_id,
    currency_code: data.currency_code,
    symbol: instrument.symbol,
    underlying: instrument.underlying,
    source: 'TS',
    instrument,
    data,
    quote,
  };
};
