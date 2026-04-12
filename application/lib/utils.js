({
  UNITS: ['', ' Kb', ' Mb', ' Gb', ' Tb', ' Pb', ' Eb', ' Zb', ' Yb'],

  bytesToSize(bytes) {
    if (bytes === 0) return '0';
    const exp = Math.floor(Math.log(bytes) / Math.log(1000));
    const size = bytes / 1000 ** exp;
    const short = size.toFixed(2);
    const unit = this.UNITS[exp];
    return short + unit;
  },

  UNIT_SIZES: {
    yb: 24, // yottabyte
    zb: 21, // zettabyte
    eb: 18, // exabyte
    pb: 15, // petabyte
    tb: 12, // terabyte
    gb: 9, // gigabyte
    mb: 6, // megabyte
    kb: 3, // kilobyte
  },

  sizeToBytes(size) {
    if (typeof size === 'number') return size;
    try {
      const [num, unit] = size.toLowerCase().split(' ');
      const exp = this.UNIT_SIZES[unit];
      const value = parseInt(num, 10);
      if (!exp) return value;
      return value * 10 ** exp;
    } catch (error) {
      console.error('Error in sizeToBytes:', error);
      throw new Error('Invalid size format');
    }
  },

  async wait(delay) {
    return new Promise((resolve) => {
      setTimeout(() => resolve('done'), delay);
    });
  },

  normalizeAction({ action = null, stop = false }) {
    let actionValue = stop ? 'unsubscribe' : action;
    if (typeof actionValue === 'string') actionValue = actionValue.trim().toLowerCase() || null;
    if (actionValue === null || actionValue === undefined || actionValue === false || actionValue === 0) return null;
    return actionValue;
  },

  constructDomain(live) {
    try {
      const domainPart = live ? config.ts.url.live : config.ts.url.sim;
      // console.log(live, config.ts.url.protocol, '://', domainPart, config.ts.url.domen);
      return new URL(config.ts.url.protocol + '://' + domainPart + config.ts.url.domen).toString();
    } catch (error) {
      console.error('Error in constructDomain:', error);
      throw new Error('Invalid domain configuration');
    }
  },

  constructURL(method, domain, endpoint, data) {
    try {
      let url = new URL(endpoint.join('/'), domain).toString();
      if (method === 'GET' && Object.keys(data).length > 0) url += '?' + new URLSearchParams(data).toString();
      return url;
    } catch (error) {
      console.error('Error in constructURL:', error);
      throw new Error('Invalid URL construction');
    }
  },

  getOppositActions(instrument, action) {
    if (instrument.type === 'STK') {
      const groupActions = [
        ['Buy', 'Sell'],
        ['SELLSHORT', 'BUYTOCOVER'],
      ];
      for (const actions of groupActions) {
        if (actions.includes(action)) return action === actions[0] ? actions[1] : actions[0];
      }
    }
    if (instrument.type === 'OPT') {
      const groupActions = [
        ['BUYTOOPEN', 'SELLTOCLOSE'],
        ['SELLTOOPEN', 'BUYTOCLOSE'],
      ];
      for (const actions of groupActions) {
        if (actions.includes(action)) return action === actions[0] ? actions[1] : actions[0];
      }
    }
    return null;
  },

  getAction(instrument, quantity, current = 0.0) {
    const currentLong = current > 0;
    const isBuy = quantity > 0;

    const newQuantity = current + quantity;
    const isSignChanged = current * newQuantity < 0;

    if (instrument.type === 'OPT') {
      if (current === 0.0) return isBuy ? 'BUYTOOPEN' : 'SELLTOOPEN';
      if (isSignChanged) {
        return isBuy ? 'BUYTOOPEN' : 'SELLTOOPEN'; // Boxed positions are not permitted. To close long position, try a Sell order.
      }
      if (isBuy) return currentLong ? 'BUYTOOPEN' : 'BUYTOCLOSE';
      return currentLong ? 'SELLTOCLOSE' : 'SELLTOOPEN';
    } else if (instrument.type === 'STK') {
      if (current === 0.0) return isBuy ? 'Buy' : 'SELLSHORT';
      if (isSignChanged) {
        return isBuy ? 'Buy' : 'SELLSHORT'; // Boxed positions are not permitted. To close long position, try a Sell order.
      }
      if (isBuy) return currentLong ? 'Buy' : 'BUYTOCOVER';
      return currentLong ? 'Sell' : 'SELLSHORT';
    }
    return isBuy ? 'Buy' : 'Sell';
  },

  convertSymbol({ symbol, type = 'STK' }) {
    if (type === 'OPT') {
      const symbolMatch = symbol.match(/^([A-Z]+)\s*(\d{6})([CP])((\d+)?(?:\.\d+)?)$/i);
      if (!symbolMatch) return null;
      const [, underlying, expCode, optType, strikePrice] = symbolMatch;
      const partStrike = parseFloat(strikePrice).toFixed(3).toString().split('.');
      const strike = partStrike[0].padStart(5, 0) + partStrike[1].padEnd(3, '0');
      return { symbol: underlying.toUpperCase() + expCode + optType + strike, underlying: underlying.toUpperCase(), strike };
    }
    return symbol;
  },

  // MSTR 251010C352.5
  makeTSSymbol(symbol, type = 'STK') {
    if (type === 'STK') return symbol.toUpperCase();
    if (type === 'OPT') {
      const match = symbol.match(/^([A-Z]+)(\d{6})([CP])(\d+(?:\.\d+)?)$/i);
      if (!match) throw new Error('Invalid option symbol format');
      const [, sym, date, cp, strike] = match;
      const year = date.slice(0, 2);
      const month = date.slice(2, 4);
      const day = date.slice(4, 6);
      const tsSymbol = sym.toUpperCase() + ' ' + year + month + day + cp.toUpperCase() + parseFloat(strike) / 1000;
      console.debug('makeTSSymbol:', symbol, '->', tsSymbol, 'date:', year + month + day, 'len:', (year + month + day).length);
      return tsSymbol;
    }
    throw new Error('Unsupported instrument type');
  },

  normalizeBarPeriod(period) {
    const periodValue = Number(period);
    if (!Number.isFinite(periodValue) || periodValue <= 0) return new DomainError('EPERIOD');

    if (periodValue >= 60 && periodValue < 86400) {
      if (periodValue % 60 !== 0) return new DomainError('EPERIOD');
      const interval = (periodValue / 60).toString();
      if (Number(interval) < 1 || Number(interval) > 1440) return new DomainError('EPERIOD');
      return { interval, unit: 'Minute' };
    }

    if (periodValue === 86400) return { interval: '1', unit: 'Daily' };
    if (periodValue === 604800) return { interval: '1', unit: 'Weekly' };
    if (periodValue === 2592000) return { interval: '1', unit: 'Monthly' };

    return new DomainError('EPERIOD');
  },

  makeSymbol(symbol) {
    const symbolMatch = symbol.match(/^([A-Z]+)\s*(\d{6})([CP])((\d+)?(?:\.\d+)?)$/i);
    if (!symbolMatch) return { type: 'STK', symbol: symbol.toUpperCase() };
    const [, underlying, expCode, optType, strikeRaw] = symbolMatch;
    const partStrike = parseFloat(strikeRaw).toFixed(3).toString().split('.'); // "450" → "450.00"
    const strike = partStrike[0].padStart(5, 0) + partStrike[1].padEnd(3, '0');
    return {
      type: 'OPT',
      underlying,
      expCode,
      optType,
      strike,
      symbol: underlying.toUpperCase() + expCode + optType + strike,
    };
  },
});
