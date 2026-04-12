({
  access: 'public',
  parameters: 'json',
  returns: 'json',
  errors: {
    EINSTRUMENT: 'Instrument is required',
    ELIMIT: 'Limit must be a positive number of bars',
    EPERIOD: 'Period must be aligned to supported minute, day, week, or month intervals',
  },

  method: async ({ instrument = null, period = 3600, limit = 1000 }) => {
    if (!instrument || typeof instrument.symbol !== 'string' || instrument.symbol.trim() === '') return new DomainError('EINSTRUMENT');

    const limitValue = Number(limit);
    if (!Number.isFinite(limitValue) || limitValue <= 0) return new DomainError('ELIMIT');

    const chartSymbol = lib.utils.makeTSSymbol(instrument.symbol.trim(), instrument.asset_category);
    const periodData = lib.utils.normalizeBarPeriod(period);
    if (periodData instanceof DomainError) return periodData;

    const data = {
      interval: periodData.interval, // string 1 to 1440 minute
      unit: periodData.unit, // string 'Minute, Daily, Weekly, Monthly'
      barsback: Math.floor(limitValue).toString(), // string 1 to 57600
      // firstdate, // The first date formatted as `YYYY-MM-DD`,`2020-04-20T18:00:00Z`. This parameter is mutually exclusive with barsback
      // lastdate, // The last date formatted as `YYYY-MM-DD`,`2020-04-20T18:00:00Z`. This parameter is mutually exclusive with barsback
      sessiontemplate: 'USEQ24Hour', // `USEQPre`, `USEQPost`, `USEQPreAndPost`, `USEQ24Hour`,`Default`.
    };

    const client = await domain.ts.clients.getClient({});
    return domain.ts.barcharts.fetch({
      live: true,
      token: client.tokens.access,
      endpoint: ['marketdata', 'barcharts', chartSymbol],
      symbol: chartSymbol,
      data,
    });
  },
});
