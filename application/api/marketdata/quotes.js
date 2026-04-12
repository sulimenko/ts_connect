({
  access: 'public',
  parameters: 'json',
  returns: 'json',
  errors: {
    EINSTRUMENTS: 'At least one instrument is required',
  },
  method: async ({ instruments = [] }) => {
    const normalized = new Set();
    for (const instrument of instruments) {
      if (!instrument) continue;
      const { symbol, asset_category: type } = instrument;
      if (typeof symbol !== 'string') continue;
      const value = lib.utils.makeTSSymbol(symbol.trim(), type);
      if (value) normalized.add(value);
    }

    const tsSymbols = Array.from(normalized).sort();
    if (tsSymbols.length === 0) return new DomainError('EINSTRUMENTS');

    const client = await domain.ts.clients.getClient({});
    const requestSnapshot = async (batch) => {
      const endpoint = ['marketdata', 'quotes', batch.join(',')];
      return lib.ts.send({ method: 'GET', live: true, endpoint, token: client.tokens.access });
    };

    if (tsSymbols.length <= 100) return requestSnapshot(tsSymbols);

    const responses = [];
    for (let index = 0; index < tsSymbols.length; index += 100) {
      const batch = tsSymbols.slice(index, index + 100);
      responses.push(await requestSnapshot(batch));
    }

    const merged = {};
    for (const response of responses) {
      if (!response || typeof response !== 'object') continue;
      for (const key of Object.keys(response)) {
        const value = response[key];
        if (Array.isArray(value)) {
          if (!Array.isArray(merged[key])) merged[key] = [];
          merged[key].push(...value);
        } else if (merged[key] === undefined) {
          merged[key] = value;
        } else if (value && typeof value === 'object' && !Array.isArray(value) && !Array.isArray(merged[key])) {
          merged[key] = { ...merged[key], ...value };
        }
      }
    }

    return merged;
  },
});
