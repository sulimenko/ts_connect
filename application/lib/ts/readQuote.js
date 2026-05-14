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

  const buildInstrument = (symbol) => {
    const parsed = lib.utils.makeSymbol(symbol);
    if (!parsed) return null;
    return {
      symbol: parsed.symbol,
      asset_category: parsed.type,
      source: 'TS',
      listing_exchange: 'TS',
      currency: 'USD',
    };
  };

  if (!message) return {};

  const instrument = buildInstrument(message.Symbol);
  if (!instrument) {
    console.error('Unknown instrument for quote message:', message);
    return {};
  }
  const data = {
    lp: message.Last ?? null,
    lp_time: toTimestamp(message.TradeTime ?? message.LastTradingDate),
    prev_close_price: toFixedString(message.PreviousClose, 2),
    date: Date.now(),
  };
  return {
    ask: toFixedString(message.Ask, 2),
    ask_size: message.AskSize,
    bid: toFixedString(message.Bid, 2),
    bid_size: message.BidSize,
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
    instrument,
    data,
    quote: {
      bid: toFixedString(message.Bid, 2),
      bid_size: message.BidSize,
      ask: toFixedString(message.Ask, 2),
      ask_size: message.AskSize,
    },
  };
};
