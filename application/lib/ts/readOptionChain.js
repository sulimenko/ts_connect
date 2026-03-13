/* eslint camelcase: "off" */

({ message }) => {
  const toFixedString = (value, digits) => {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(digits) : null;
  };

  if (!message || !message.Legs || message.Legs.length === 0) return null;

  const leg = message.Legs[0];
  const strikePrice = Number(leg.StrikePrice);
  if (!Number.isFinite(strikePrice) || !leg.Symbol || !leg.Expiration || !leg.OptionType) return null;

  const partStrike = strikePrice.toFixed(3).split('.');
  const strike = partStrike[0].padStart(5, 0) + partStrike[1].padEnd(3, '0');
  const symbolMatch = leg.Symbol.match(/^([A-Z]+)\s*(\d{6})([CP])((\d+)?(?:\.\d+)?)$/i);
  if (!symbolMatch) return null;

  const [, underlying, expCode, optType] = symbolMatch;
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
    strike,
    symbol: underlying.toUpperCase(),
    symbol_raw: underlying.toUpperCase() + expCode + optType + strike,
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
