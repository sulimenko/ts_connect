({
  values: new Map(),
  getSymbolKey({ symbol }) {
    return lib.utils.normalizePositionSymbol(symbol);
  },
  normalizeAccountKey(account) {
    const key = String(account ?? '').trim();
    return key || null;
  },
  clearAccount(account) {
    const key = this.normalizeAccountKey(account);
    if (!key) return null;
    const positions = new Map();
    this.values.set(key, positions);
    return positions;
  },
  clearPosition({ account, symbol }) {
    const key = this.getSymbolKey({ symbol });
    if (!key) return null;
    const positions = this.getAccount({ account, create: false });
    if (!positions) return false;
    return positions.delete(key);
  },
  getAccount({ account, create = true }) {
    const key = this.normalizeAccountKey(account);
    if (!key) return null;
    let positions = this.values.get(key);
    if (positions === undefined && create) positions = this.clearAccount(key);
    return positions;
  },
  getPosition({ account, symbol }) {
    const key = this.getSymbolKey({ symbol });
    if (!key) return null;
    const positions = this.getAccount({ account, create: false });
    if (!positions) return null;
    return positions.get(key) ?? null;
  },
  setPosition({ account, symbol, data }) {
    const key = this.getSymbolKey({ symbol: data?.Symbol ?? symbol });
    if (!key) return null;
    const accountPositions = this.getAccount({ account });
    if (!accountPositions) return null;
    let position = accountPositions.get(key);
    if (position === undefined) {
      position = new Map();
      accountPositions.set(key, position);
    }
    const fields = data && typeof data === 'object' ? Object.keys(data) : [];
    for (const field of fields) {
      if (['AccountID', 'Symbol', 'Quantity', 'AssetType', 'PositionID', 'AveragePrice'].includes(field)) position.set(field, data[field]);
    }
    // position.forEach((value, key) => (value = data[key]));
    return position;
  },
});
