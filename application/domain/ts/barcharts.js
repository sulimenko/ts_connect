({
  pending: new Map(),
  defaultTtlMs: 10 * 1000,

  normalizeTtlMs(ttlMs = this.defaultTtlMs) {
    const timeout = Number(ttlMs);
    if (!Number.isFinite(timeout) || timeout <= 0) return this.defaultTtlMs;
    return Math.max(1000, Math.floor(timeout));
  },

  requireKeyPart(name, value) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`Invalid barcharts cache key: ${name} is required`);
    }
    return value;
  },

  buildKey({ symbol, data }) {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid barcharts cache key: data is required');
    }

    return [
      'ts:barcharts',
      this.requireKeyPart('symbol', symbol),
      this.requireKeyPart('data.interval', data.interval),
      this.requireKeyPart('data.unit', data.unit),
      this.requireKeyPart('data.barsback', data.barsback),
      this.requireKeyPart('data.sessiontemplate', data.sessiontemplate),
    ].join('|');
  },

  async getCached({ key }) {
    if (!db.redis.client?.isReady) return null;
    try {
      const value = await db.redis.get(key);
      if (!value) return null;
      return JSON.parse(value);
    } catch (error) {
      console.warn('barcharts cache get failed:', error?.message ?? error);
      return null;
    }
  },

  async setCached({ key, value, ttlMs = this.defaultTtlMs }) {
    if (!db.redis.client?.isReady) return value;
    const payload = JSON.stringify(value);
    if (payload === undefined) return value;
    try {
      await db.redis.set(key, payload, { PX: this.normalizeTtlMs(ttlMs) });
    } catch (error) {
      console.warn('barcharts cache set failed:', error?.message ?? error);
    }
    return value;
  },

  async fetch({ live = true, token, endpoint, symbol, data = {}, ttlMs = this.defaultTtlMs }) {
    const key = this.buildKey({ symbol, data });
    const cached = await this.getCached({ key });
    if (cached !== null) {
      console.debug('barcharts cache HIT:', symbol);
      return cached;
    }

    const pending = this.pending.get(key);
    if (pending) {
      console.debug('barcharts single-flight REUSE:', symbol);
      return pending;
    }

    console.debug('barcharts cache MISS, fetching:', symbol);

    const request = (async () => {
      const startedAt = Date.now();
      try {
        const response = await lib.ts.send({
          method: 'GET',
          live,
          endpoint,
          token,
          data,
        });
        console.debug('barcharts snapshot:', key, 'durationMs=', Date.now() - startedAt);
        await this.setCached({ key, value: response, ttlMs });
        return response;
      } finally {
        this.pending.delete(key);
      }
    })();

    this.pending.set(key, request);
    return request;
  },
});
