({
  UNITS: ['', ' Kb', ' Mb', ' Gb', ' Tb', ' Pb', ' Eb', ' Zb', ' Yb'],

  bytesToSize(bytes) {
    if (bytes === 0) return '0';
    const exp = Math.floor(Math.log(bytes) / Math.log(1000));
    const size = bytes / 1000 ** exp;
    const short = Math.round(size, 2);
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
    const [num, unit] = size.toLowerCase().split(' ');
    const exp = this.UNIT_SIZES[unit];
    const value = parseInt(num, 10);
    if (!exp) return value;
    return value * 10 ** exp;
  },

  async wait(delay) {
    return new Promise((resolve) => {
      setTimeout(() => resolve('done'), delay);
    });
  },

  getAction(account, instrument, side) {
    const position = domain.ts.positions.getPosition({ account, symbol: instrument.symbol });
    if (instrument.type === 'OPT') {
      if (position.Quantity === undefined || parseFloat(position.Quantity) === 0.0) {
        return side === 'Buy' ? 'BUYTOOPEN' : 'SELLTOOPEN';
      }
      const isLong = parseFloat(position.Quantity) > 0;
      if (side === 'Buy') {
        return isLong ? 'BUYTOOPEN' : 'BUYTOCLOSE';
      } else {
        return isLong ? 'SELLTOCLOSE' : 'SELLTOOPEN';
      }
    } else if (instrument.type === 'STK') {
      if (position.Quantity === undefined || parseFloat(position.Quantity) === 0.0) {
        return side === 'Buy' ? side : 'SELLSHORT';
      }
      const isLong = parseFloat(position.Quantity) > 0;
      if (side === 'Buy') {
        return isLong ? side : 'BUYTOCOVER';
      } else {
        return isLong ? side : 'SELLSHORT';
      }
    }

    return side;
  },
});
