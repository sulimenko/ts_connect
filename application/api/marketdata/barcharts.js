({
  access: 'public',
  parameters: 'json',
  returns: 'json',
  errors: {
    EINSTRUMENT: 'Instrument is required',
    ELIMIT: 'Limit must be a positive number of bars',
    EPERIOD: 'Period must be aligned to supported minute, day, week, or month intervals',
  },

  method: async ({ instrument = null, period = 3600, limit = 1000, traceId = null, requestId = null }) => {
    const trace = lib.utils.resolveTraceId({ traceId, requestId, prefix: 'chart' });
    const startedAt = Date.now();
    const requestedSymbol = instrument?.symbol?.trim() ?? null;
    let normalizedSymbol = requestedSymbol;
    let normalizedPeriod = null;
    let normalizedLimit = Number(limit);
    let barsCount = null;
    let status = 'ok';

    lib.utils.traceLog({
      scope: 'chart.load',
      phase: 'api.start',
      traceId: trace,
      symbol: requestedSymbol,
      period,
      limit,
    });

    try {
      if (!instrument || typeof instrument.symbol !== 'string' || instrument.symbol.trim() === '') {
        status = 'error:EINSTRUMENT';
        return new DomainError('EINSTRUMENT');
      }

      normalizedLimit = Number(limit);
      if (!Number.isFinite(normalizedLimit) || normalizedLimit <= 0) {
        status = 'error:ELIMIT';
        return new DomainError('ELIMIT');
      }

      normalizedSymbol = lib.utils.makeTSSymbol(instrument.symbol.trim(), instrument.asset_category);
      normalizedPeriod = lib.utils.normalizeBarPeriod(period);
      if (normalizedPeriod instanceof DomainError) {
        status = `error:${normalizedPeriod.code}`;
        return normalizedPeriod;
      }

      const periodData = normalizedPeriod;
      const limitValue = Math.floor(normalizedLimit);
      lib.utils.traceLog({
        scope: 'chart.load',
        phase: 'normalize.done',
        traceId: trace,
        symbol: normalizedSymbol,
        period: periodData.interval,
        limit: limitValue,
      });

      const data = {
        interval: periodData.interval, // string 1 to 1440 minute
        unit: periodData.unit, // string 'Minute, Daily, Weekly, Monthly'
        barsback: limitValue.toString(), // string 1 to 57600
        // firstdate, // The first date formatted as `YYYY-MM-DD`,`2020-04-20T18:00:00Z`. This parameter is mutually exclusive with barsback
        // lastdate, // The last date formatted as `YYYY-MM-DD`,`2020-04-20T18:00:00Z`. This parameter is mutually exclusive with barsback
        sessiontemplate: 'USEQ24Hour', // `USEQPre`, `USEQPost`, `USEQPreAndPost`, `USEQ24Hour`,`Default`.
      };

      const client = await domain.ts.clients.getClient({});
      const response = await domain.ts.barcharts.fetch({
        live: true,
        token: client.tokens.access,
        endpoint: ['marketdata', 'barcharts', normalizedSymbol],
        symbol: normalizedSymbol,
        data,
        traceId: trace,
        period: periodData.interval,
        limit: limitValue,
      });

      if (Array.isArray(response)) {
        barsCount = response.length;
      } else if (Array.isArray(response?.Bars)) {
        barsCount = response.Bars.length;
      } else if (Array.isArray(response?.bars)) {
        barsCount = response.bars.length;
      }
      return response;
    } finally {
      let loggedPeriod = period;
      if (!(normalizedPeriod instanceof DomainError) && normalizedPeriod?.interval) {
        loggedPeriod = normalizedPeriod.interval;
      }
      lib.utils.traceLog({
        scope: 'chart.load',
        phase: 'api.done',
        traceId: trace,
        symbol: normalizedSymbol,
        period: loggedPeriod,
        limit: Number.isFinite(normalizedLimit) ? Math.floor(normalizedLimit) : limit,
        durationMs: Date.now() - startedAt,
        extra: { barsCount, status },
      });
    }
  },
});
