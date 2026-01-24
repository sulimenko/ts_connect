({ message }) => {
  if (!message || !message.Legs || message.Legs.length === 0) return {};

  const leg = message.Legs[0];
  const partStrike = parseFloat(leg.StrikePrice).toFixed(3).toString().split('.'); // "450" → "450.00"
  const strike = partStrike[0].padStart(5, 0) + partStrike[1].padEnd(3, '0');
  // Парсим символ: "TSLA 251121C450" → извлекаем дату, тип, страйк
  const symbolMatch = leg.Symbol.match(/^([A-Z]+)\s*(\d{6})([CP])((\d+)?(?:\.\d+)?)$/i);
  if (!symbolMatch) return null;

  const [, underlying, expCode, optType, strikeRaw] = symbolMatch;
  const expiration = leg.Expiration.split('T')[0]; // "2025-11-21T00:00:00" → "2025-11-21"

  return {
    ask: parseFloat(message.Ask).toFixed(2),
    ask_size: message.AskSize,
    bid: parseFloat(message.Bid).toFixed(2),
    bid_size: message.BidSize,
    date: new Date().toISOString().split('T')[0], // текущая дата, или можно из сообщения
    delta: message.Delta ? parseFloat(message.Delta).toFixed(4) : null,
    expiration: expiration,
    gamma: message.Gamma ? parseFloat(message.Gamma).toFixed(4) : null,
    open_interest: message.DailyOpenInterest,
    prev_close_price: parseFloat(message.PreviousClose).toFixed(2),
    strike,
    symbol: underlying.toUpperCase(),
    symbol_raw: underlying.toUpperCase() + expCode + optType + strike,
    theo: parseFloat(message.TheoreticalValue).toFixed(4),
    theta: message.Theta ? parseFloat(message.Theta).toFixed(4) : null,
    trade_price: parseFloat(message.Last).toFixed(2),
    trade_time: null,
    type: leg.OptionType.slice(0, 1).toUpperCase(), // "Call" → "C", "Put" → "P"
    vega: message.Vega ? parseFloat(message.Vega).toFixed(4) : null,
    volatility: parseFloat(message.ImpliedVolatility).toFixed(4),
    volume: message.Volume,
  };
};
