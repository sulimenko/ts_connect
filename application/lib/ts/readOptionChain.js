/* eslint camelcase: "off" */

({ message }) => {
  const toFixedString = (value, digits) => {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(digits) : null;
  };

  if (!message || !message.Legs || message.Legs.length === 0) return null;

  const leg = message.Legs[0];
  if (!leg.Symbol || !leg.Expiration || !leg.OptionType) return null;
  const option = lib.utils.makeSymbol(leg.Symbol);
  if (!option || option.type !== 'OPT') return null;

  const expiration = leg.Expiration.split('T')[0];

  return {
    ask: toFixedString(message.Ask, 2),
    ask_size: message.AskSize,
    bid: toFixedString(message.Bid, 2),
    bid_size: message.BidSize,
    date: new Date().toISOString().split('T')[0],
    delta: toFixedString(message.Delta, 4),
    expiration,
    gamma: toFixedString(message.Gamma, 4),
    open_interest: message.DailyOpenInterest,
    prev_close_price: toFixedString(message.PreviousClose, 2),
    strike: option.strike,
    symbol: option.underlying,
    symbol_raw: option.symbol,
    theo: toFixedString(message.TheoreticalValue, 4),
    theta: toFixedString(message.Theta, 4),
    trade_price: toFixedString(message.Last, 2),
    trade_time: null,
    type: leg.OptionType.slice(0, 1).toUpperCase(),
    vega: toFixedString(message.Vega, 4),
    volatility: toFixedString(message.ImpliedVolatility, 4),
    volume: message.Volume,
  };
};
