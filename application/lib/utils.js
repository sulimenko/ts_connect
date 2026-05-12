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

  makeTraceId(prefix = 'tr') {
    const time = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 8);
    return `${prefix}-${time}-${random}`;
  },

  resolveTraceId({ traceId = null, requestId = null, prefix = 'tr' } = {}) {
    for (const value of [traceId, requestId]) {
      if (typeof value !== 'string') continue;
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
    return this.makeTraceId(prefix);
  },

  traceLog({
    scope,
    phase,
    traceId = null,
    endpoint = null,
    action = null,
    symbol = null,
    streamKey = null,
    period = null,
    limit = null,
    durationMs = null,
    extra = {},
  }) {
    if (!scope || !phase) return;

    const parts = [`${scope}`, phase];
    const fields = [];
    if (traceId) fields.push(`traceId=${traceId}`);
    if (endpoint) fields.push(`endpoint=${endpoint}`);
    if (action) fields.push(`action=${action}`);
    if (symbol) fields.push(`symbol=${symbol}`);
    if (streamKey) fields.push(`streamKey=${streamKey}`);
    if (period !== null && period !== undefined) fields.push(`period=${period}`);
    if (limit !== null && limit !== undefined) fields.push(`limit=${limit}`);
    if (durationMs !== null && durationMs !== undefined) fields.push(`durationMs=${durationMs}`);

    if (extra && typeof extra === 'object') {
      for (const [key, value] of Object.entries(extra)) {
        if (value === undefined || value === null || value === '') continue;
        fields.push(`${key}=${value}`);
      }
    }

    const line = fields.length > 0 ? `${parts.join(' ')} ${fields.join(' ')}` : parts.join(' ');
    console.info(line);
  },

  normalizeAction({ action = null, stop = false }) {
    let actionValue = stop ? 'unsubscribe' : action;
    if (typeof actionValue === 'string') actionValue = actionValue.trim().toLowerCase() || null;
    if (actionValue === null || actionValue === undefined || actionValue === false || actionValue === 0) return null;
    return actionValue;
  },

  formatStrike(strike) {
    const value = Number(strike);
    if (!Number.isFinite(value)) return null;
    const partStrike = value.toFixed(3).split('.');
    return partStrike[0].padStart(5, 0) + partStrike[1].padEnd(3, '0');
  },

  parseSymbol(symbol) {
    if (typeof symbol !== 'string') return null;
    const trimmed = symbol.trim();
    if (!trimmed) return null;

    const tsOptMatch = trimmed.match(/^([A-Z]+)\s+(\d{6})([CP])((\d+)?(?:\.\d+)?)$/i);
    if (tsOptMatch) {
      const [, underlying, expCode, optType, strikeRaw] = tsOptMatch;
      const strike = this.formatStrike(strikeRaw);
      if (!strike) return null;
      const normalized = underlying.toUpperCase() + expCode + optType + strike;
      return {
        type: 'OPT',
        underlying: underlying.toUpperCase(),
        expCode,
        optType,
        strike,
        strikeValue: Number(strike) / 1000,
        symbol: normalized,
        tsSymbol: `${underlying.toUpperCase()} ${expCode}${optType}${Number(strike) / 1000}`,
      };
    }

    const canonicalOptMatch = trimmed.match(/^([A-Z]+)(\d{6})([CP])(\d+)$/i);
    if (canonicalOptMatch) {
      const [, underlying, expCode, optType, strikeRaw] = canonicalOptMatch;
      const strikeValue = Number(strikeRaw) / 1000;
      if (!Number.isFinite(strikeValue)) return null;
      const strike = this.formatStrike(strikeValue);
      if (!strike) return null;
      const normalized = underlying.toUpperCase() + expCode + optType + strike;
      return {
        type: 'OPT',
        underlying: underlying.toUpperCase(),
        expCode,
        optType,
        strike,
        strikeValue,
        symbol: normalized,
        tsSymbol: `${underlying.toUpperCase()} ${expCode}${optType}${strikeValue}`,
      };
    }

    return {
      type: 'STK',
      symbol: trimmed.toUpperCase(),
      underlying: trimmed.toUpperCase(),
      tsSymbol: trimmed.toUpperCase(),
    };
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

  makeTSSymbol(symbol, type = 'STK') {
    const parsed = this.parseSymbol(symbol);
    if (type !== 'OPT' && type !== 'STK') throw new Error('Unsupported instrument type');
    if (!parsed) throw new Error('Invalid option symbol format');
    if (type === 'OPT' && parsed.type !== 'OPT') throw new Error('Invalid option symbol format');
    return parsed.tsSymbol;
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
    const parsed = this.parseSymbol(symbol);
    if (!parsed) return null;
    return {
      type: parsed.type,
      symbol: parsed.symbol,
      underlying: parsed.underlying ?? null,
      expCode: parsed.expCode ?? null,
      optType: parsed.optType ?? null,
      strike: parsed.strike ?? null,
      strikeValue: parsed.strikeValue ?? null,
      tsSymbol: parsed.tsSymbol ?? null,
    };
  },

  normalizePositionSymbol(symbol) {
    return this.makeSymbol(symbol)?.symbol?.toUpperCase() ?? null;
  },

  readPositionQuantity(position) {
    if (!position || typeof position.get !== 'function') return 0;
    // TradeStation position payload already carries signed Quantity; keep the sign intact.
    const quantity = Number(position.get('Quantity'));
    return Number.isFinite(quantity) ? quantity : 0;
  },
});
