({
  values: new Map(),
  clearAccount({ account }) {
    return this.values.set(account, new Map()).get(account);
  },
  clearPosition({ account, symbol }) {
    return this.getAccount({ account }).set(symbol, new Map()).get(symbol);
  },
  getAccount({ account }) {
    let positions = this.values.get(account);
    if (positions === undefined) positions = this.clearAccount({ account });
    return positions;
  },
  getPosition({ account, symbol }) {
    let position = this.getAccount({ account }).get(symbol);
    if (position === undefined) position = this.clearPosition({ account, symbol });
    return position;
  },
  setPosition({ account, symbol, data }) {
    const position = this.getPosition({ account, symbol });
    for (const key of Object.keys(data)) {
      if (['AccountID', 'Symbol', 'Quantity', 'AssetType', 'PositionID', 'AveragePrice'].includes(key)) position.set(key, data[key]);
    }
    // position.forEach((value, key) => (value = data[key]));
    return position;
  },
});
