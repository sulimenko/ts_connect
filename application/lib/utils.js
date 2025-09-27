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
      if (isSignChanged) return isBuy ? 'BUYTOOPEN' : 'SELLTOOPEN'; // EC804: Boxed positions are not permitted. To close long position, try a \"Sell\" order.
      if (isBuy) return currentLong ? 'BUYTOOPEN' : 'BUYTOCLOSE';
      return currentLong ? 'SELLTOCLOSE' : 'SELLTOOPEN';
    } else if (instrument.type === 'STK') {
      if (current === 0.0) return isBuy ? 'Buy' : 'SELLSHORT';
      if (isSignChanged) return isBuy ? 'Buy' : 'SELLSHORT'; // EC804: Boxed positions are not permitted. To close long position, try a \"Sell\" order.
      if (isBuy) return currentLong ? 'Buy' : 'BUYTOCOVER';
      return currentLong ? 'Sell' : 'SELLSHORT';
    }
    return isBuy ? 'Buy' : 'Sell';
  },
});
