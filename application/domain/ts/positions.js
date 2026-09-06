({
  values: new Map(),
  fields: ['AccountID', 'Symbol', 'Quantity', 'AssetType', 'PositionID', 'AveragePrice', 'Timestamp'],
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
  makePosition({ symbol, data }) {
    const key = this.getSymbolKey({ symbol: data?.Symbol ?? symbol });
    if (!key) return null;
    const position = new Map();
    const fields = data && typeof data === 'object' ? Object.keys(data) : [];
    for (const field of fields) {
      if (this.fields.includes(field) || field.toLowerCase().includes('timestamp')) position.set(field, data[field]);
    }
    return { key, position };
  },
  setPosition({ account, symbol, data }) {
    const made = this.makePosition({ symbol, data });
    if (!made) return null;
    const accountPositions = this.getAccount({ account });
    if (!accountPositions) return null;
    let position = accountPositions.get(made.key);
    if (position === undefined) {
      position = new Map();
      accountPositions.set(made.key, position);
    }
    for (const [field, value] of made.position) position.set(field, value);
    return position;
  },
  toRecord({ symbol, position }) {
    if (!position || typeof position.get !== 'function') return null;
    const quantity = lib.utils.readPositionQuantity(position);
    const record = {
      symbol: this.getSymbolKey({ symbol }),
      upstreamSymbol: position.get('Symbol') ?? symbol,
      quantity,
    };
    const optionals = [
      ['PositionID', 'positionId'],
      ['AssetType', 'assetType'],
    ];
    for (const [field, name] of optionals) {
      const value = position.get(field);
      if (value !== undefined && value !== null) record[name] = value;
    }
    const averagePrice = Number(position.get('AveragePrice'));
    if (position.has('AveragePrice') && Number.isFinite(averagePrice)) record.averagePrice = averagePrice;
    for (const [field, value] of position) {
      if (field.toLowerCase().includes('timestamp') && value !== undefined && value !== null) {
        record.upstreamTimestamp = value;
        break;
      }
    }
    return record.symbol ? record : null;
  },
  snapshot({ account }) {
    const positions = this.getAccount({ account, create: false });
    if (!positions) return [];
    const snapshot = [];
    for (const [symbol, position] of positions) {
      const record = this.toRecord({ symbol, position });
      if (record) snapshot.push(record);
    }
    return snapshot;
  },
  replaceAccount({ account, items = [] }) {
    const accountKey = this.normalizeAccountKey(account);
    if (!accountKey) return null;
    const previous = this.getAccount({ account: accountKey, create: false }) ?? new Map();
    const next = new Map();
    for (const item of items) {
      const made = this.makePosition(item);
      if (!made || lib.utils.readPositionQuantity(made.position) === 0) continue;
      next.set(made.key, made.position);
    }
    let removedCount = 0;
    let changedCount = 0;
    for (const symbol of previous.keys()) {
      if (!next.has(symbol)) removedCount += 1;
    }
    for (const [symbol, position] of next) {
      if (lib.utils.readPositionQuantity(previous.get(symbol)) !== lib.utils.readPositionQuantity(position)) changedCount += 1;
    }
    this.values.set(accountKey, next);
    return { positions: this.snapshot({ account: accountKey }), removedCount, changedCount };
  },
});
