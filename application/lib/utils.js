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

  getAction(account, instrument, side) {
    try {
      const position = domain.ts.positions.getPosition({ account, symbol: instrument.symbol });
      if (instrument.type === 'OPT') {
        if (position.get('Quantity') === undefined || parseFloat(position.get('Quantity')) === 0.0) {
          return side === 'Buy' ? 'BUYTOOPEN' : 'SELLTOOPEN';
        }
        const isLong = parseFloat(position.get('Quantity')) > 0;
        if (side === 'Buy') {
          return isLong ? 'BUYTOOPEN' : 'BUYTOCLOSE';
        } else {
          return isLong ? 'SELLTOCLOSE' : 'SELLTOOPEN';
        }
      } else if (instrument.type === 'STK') {
        // console.log(position);
        // console.log(side);
        if (position.get('Quantity') === undefined || parseFloat(position.get('Quantity')) === 0.0) {
          // console.log(position.get('Quantity'), position.get('Quantity') === undefined, parseFloat(position.get('Quantity')) === 0.0);
          return side === 'Buy' ? side : 'SELLSHORT';
        }
        const isLong = parseFloat(position.get('Quantity')) > 0;
        // console.log('isLong:', isLong);
        if (side === 'Buy') {
          return isLong ? side : 'BUYTOCOVER';
        } else {
          return isLong ? side : 'SELLSHORT';
        }
      }

      return side;
    } catch (error) {
      console.error('Error in getAction:', error);
      throw new Error('Invalid action determination');
    }
  },
});
