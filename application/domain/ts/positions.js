({
  values: new Map(),
  getAccount({ account }) {
    let acc = this.values.get(account);
    if (acc === undefined) acc = this.values.set(account, new Map()).get(account);
    return acc;
  },
  getPosition({ account, symbol }) {
    let position = this.getAccount({ account }).get(symbol);
    if (position === undefined) position = this.getAccount({ account }).set(symbol, new Map()).get(symbol);
    return position;
  },
  setPosition({ account, symbol, data }) {
    const position = this.getPosition({ account, symbol });
    for (const key of Object.keys(data)) {
        position.set(key, data[key]);
    }
    // position.forEach((value, key) => (value = data[key]));
    return position;
  },
});
