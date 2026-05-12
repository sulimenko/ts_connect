({
  pending: new Map(),
  defaultTtlMs: 10 * 1000,

  trace({ traceId, phase, symbol, period = null, limit = null, durationMs = null, extra = {} }) {
    if (!traceId) return;
    lib.utils.traceLog({
      scope: 'marketdata/barcharts',
      phase,
      traceId,
      symbol,
      period,
      limit,
      durationMs,
      extra,
    });
  },

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

  async getCached({ key, traceId = null, symbol = null, period = null, limit = null }) {
    const startedAt = Date.now();
    if (!db.redis.client?.isReady) {
      this.trace({ traceId, phase: 'cache.miss', symbol, period, limit, durationMs: Date.now() - startedAt, extra: { redisReady: false } });
      return null;
    }
    try {
      const value = await db.redis.get(key);
      if (!value) {
        this.trace({ traceId, phase: 'cache.miss', symbol, period, limit, durationMs: Date.now() - startedAt });
        return null;
      }
      this.trace({ traceId, phase: 'cache.hit', symbol, period, limit, durationMs: Date.now() - startedAt });
      return JSON.parse(value);
    } catch (error) {
      console.warn('barcharts cache get failed:', error?.message ?? error);
      this.trace({ traceId, phase: 'cache.miss', symbol, period, limit, durationMs: Date.now() - startedAt, extra: { redisReady: false } });
      return null;
    }
  },

  async setCached({ key, value, ttlMs = this.defaultTtlMs, traceId = null, symbol = null, period = null, limit = null }) {
    if (!db.redis.client?.isReady) {
      this.trace({ traceId, phase: 'redis.set.failed', symbol, period, limit, extra: { reason: 'redis-not-ready' } });
      return value;
    }
    const payload = JSON.stringify(value);
    if (payload === undefined) return value;
    try {
      await db.redis.set(key, payload, { PX: this.normalizeTtlMs(ttlMs) });
      this.trace({ traceId, phase: 'redis.set.done', symbol, period, limit });
    } catch (error) {
      console.warn('barcharts cache set failed:', error?.message ?? error);
      this.trace({ traceId, phase: 'redis.set.failed', symbol, period, limit, extra: { reason: error?.message ?? 'unknown' } });
    }
    return value;
  },

  async fetch({ live = true, token, endpoint, symbol, data = {}, ttlMs = this.defaultTtlMs, traceId = null, period = null, limit = null }) {
    const startedAt = Date.now();
    const key = this.buildKey({ symbol, data });
    const cached = await this.getCached({ key, traceId, symbol, period, limit });
    if (cached !== null) {
      return cached;
    }

    const pending = this.pending.get(key);
    if (pending) {
      const reuseStartedAt = Date.now();
      this.trace({ traceId, phase: 'singleFlight.reuse', symbol, period, limit, durationMs: reuseStartedAt - startedAt });
      return pending.finally(() => {
        this.trace({ traceId, phase: 'singleFlight.reuse.done', symbol, period, limit, durationMs: Date.now() - reuseStartedAt });
      });
    }

    const request = (async () => {
      const requestStartedAt = Date.now();
      try {
        const response = await lib.ts.send({
          method: 'GET',
          live,
          endpoint,
          token,
          data,
        });
        this.trace({
          traceId,
          phase: 'ts.request.done',
          symbol,
          period,
          limit,
          durationMs: Date.now() - requestStartedAt,
          extra: { streamKey: key },
        });
        await this.setCached({ key, value: response, ttlMs, traceId, symbol, period, limit });
        return response;
      } finally {
        this.pending.delete(key);
      }
    })();

    this.pending.set(key, request);
    return request;
  },
});
