/* eslint camelcase: "off" */
({
  access: 'public',
  parameters: 'json',
  returns: 'json',
  errors: {
    EACTION: 'Invalid action: expected "subscribe", "unsubscribe", or "touch"',
    ELIMIT: 'Limit must be a positive number of bars from 1 to 57600',
    EPERIOD: 'Period must be aligned to supported minute, day, week, or month intervals',
    ESTREAMKEY: 'Stream key must match the requested barchart subscription',
    ESYMBOL: 'Symbol is required for barchart subscribe requests',
  },

  method: async ({
    symbol = null,
    period = 3600,
    limit = 1000,
    action = 'subscribe',
    stop = false,
    idleMs = null,
    streamKey = null,
    traceId = null,
    requestId = null,
  }) => {
    const trace = lib.utils.resolveTraceId({ traceId, requestId, prefix: 'stream' });
    const startedAt = Date.now();
    const actionSet = new Set(['subscribe', 'unsubscribe', 'touch']);
    const toNumber = (value) => {
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    };
    const actionValue = lib.utils.normalizeAction({ action, stop });
    const parsedSymbol = typeof symbol === 'string' ? lib.utils.makeSymbol(symbol) : null;
    const chartSymbol = parsedSymbol?.tsSymbol ?? '';
    const outboundInstrument = parsedSymbol
      ? {
          symbol: parsedSymbol.symbol,
          asset_category: parsedSymbol.type,
          source: 'TS',
          listing_exchange: 'TS',
          currency: 'USD',
        }
      : null;
    const chartKey = typeof streamKey === 'string' ? streamKey.trim() || null : null;
    const periodValue = Number(period);
    const limitValue = toNumber(limit);
    const actionLabel = actionValue ?? 'subscribe';

    lib.utils.traceLog({
      scope: 'stream/barcharts',
      phase: 'api.start',
      traceId: trace,
      action: actionLabel,
      streamKey: chartKey,
      symbol: chartSymbol || null,
      period: periodValue,
      limit: limitValue,
      extra: { idleMs },
    });

    try {
      if (actionValue !== null && !actionSet.has(actionValue)) return new DomainError('EACTION');
      if (limitValue === null || limitValue <= 0 || limitValue > 57600) return new DomainError('ELIMIT');

      const symbolRequired = !actionValue || actionValue === 'subscribe';
      if (!chartSymbol && (symbolRequired || !chartKey)) return new DomainError('ESYMBOL');

      const periodData = lib.utils.normalizeBarPeriod(period);
      if (periodData instanceof DomainError) return periodData;

      const chartData = {
        interval: periodData.interval,
        unit: periodData.unit,
        barsback: Math.floor(limitValue).toString(),
        sessiontemplate: 'USEQ24Hour',
      };
      const tsClient = await domain.ts.clients.getClient({});
      const subscriptionKey = symbolRequired ? tsClient.buildStreamKey({ group: 'charts', symbol: chartSymbol, data: chartData }) : null;
      if (symbolRequired && chartKey && chartKey !== subscriptionKey) return new DomainError('ESTREAMKEY');
      const key = chartKey || subscriptionKey || tsClient.buildStreamKey({ group: 'charts', symbol: chartSymbol, data: chartData });

      if (actionValue === 'unsubscribe') {
        return domain.ts.streams.unsubscribe({ kind: 'charts', key, client: context.client });
      }
      if (actionValue === 'touch') {
        return domain.ts.streams.touch({ kind: 'charts', key, client: context.client, idleMs });
      }

      const endpoint = ['marketdata', 'stream', 'barcharts', chartSymbol];

      return domain.ts.streams.subscribe({
        kind: 'charts',
        key,
        client: context.client,
        idleMs,
        metadata: { symbol: chartSymbol, period: periodValue, limit: Math.floor(limitValue) },
        start: async ({ notifyError, notifyStatus, emit }) => {
          const onData = (message) => {
            if (!message || typeof message !== 'object' || Array.isArray(message)) return;
            if (['Heartbeat', 'StreamStatus', 'Error', 'Status'].some((field) => Object.hasOwn(message, field))) return;
            // TS v3 prices may be numeric strings; validate without changing the raw bar.
            const prices = ['Open', 'High', 'Low', 'Close'].map((field) => {
              const value = message[field];
              if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return NaN;
              return Number(value);
            });
            if (!prices.every(Number.isFinite)) return;
            if (!Number.isSafeInteger(message.Epoch) || message.Epoch <= 0) return;
            emit('stream/barchart', { streamKey: key, instrument: outboundInstrument, period: periodValue, bar: message });
          };
          const onError = (error) => {
            console.error('stream chart error:', error);
            notifyError(error);
            if (error?.permanent || error?.streamStopped) {
              const reason = error?.code ? `upstream.${error.code}` : 'upstream.permanent-error';
              void domain.ts.streams.stopEntry({ kind: 'charts', key, reason }).catch((cleanupError) => {
                console.error('Failed to stop failed chart managed stream:', key, cleanupError);
              });
            }
          };
          const registeredKey = await tsClient.streamCharts({
            endpoint,
            symbol: chartSymbol,
            data: chartData,
            onData,
            onError,
            onStatus: notifyStatus,
          });
          return {
            stop: async ({ reason = 'unknown' } = {}) => {
              await tsClient.stopStoredStream({ group: 'charts', key: registeredKey, reason });
            },
          };
        },
      });
    } finally {
      lib.utils.traceLog({
        scope: 'stream/barcharts',
        phase: 'api.done',
        traceId: trace,
        action: actionLabel,
        streamKey: chartKey,
        symbol: chartSymbol || null,
        period: periodValue,
        limit: limitValue,
        durationMs: Date.now() - startedAt,
        extra: { idleMs },
      });
    }
  },
});
