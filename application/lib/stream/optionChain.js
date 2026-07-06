/* eslint camelcase: "off" */
async ({
  client = null,
  responce = null,
  endpoint = [],
  symbol = '',
  data = {},
  action = 'subscribe',
  idleMs = null,
  streamKey = null,
  trace = null,
}) => {
  const metacomClient = client ?? responce;
  if (!metacomClient) throw new Error('Metacom client is required');

  const tsClient = await domain.ts.clients.getClient({});
  const key = streamKey || tsClient.buildStreamKey({ group: 'chains', symbol, data });
  const traceId = trace?.traceId ?? null;
  const scope = trace?.scope ?? 'stream/options/chains';
  const actionLabel = action ?? 'subscribe';
  const startedAt = Date.now();
  const observedStrikes = new Set();
  const observedLegs = new Map();
  let statsTimer = null;
  const logBase = () => ({
    streamKey: key,
    symbol: symbol.toUpperCase(),
    expiration: data.expiration ?? null,
    expiration2: data.expiration2 ?? null,
    strikeRange: data.strikeRange ?? null,
    strikeProximity: data.strikeProximity ?? null,
    optionType: data.optionType ?? 'All',
    strikeInterval: data.strikeInterval ?? 1,
    action: actionLabel,
  });
  const debug = (event, extra = {}) => console.debug(event, { ...logBase(), ...extra });
  const buildInstrument = (value) => {
    const parsed = lib.utils.makeSymbol(value);
    if (!parsed) return null;
    return {
      symbol: parsed.symbol,
      asset_category: parsed.type,
      source: 'TS',
      listing_exchange: 'TS',
      currency: 'USD',
    };
  };
  const writeStats = (phase) => {
    const strikes = [...observedStrikes].sort((a, b) => Number(a) - Number(b));
    const strikeValues = strikes.map((strike) => Number(strike) / 1000);
    const observedLegCount = [...observedLegs.values()].reduce((sum, legs) => sum + legs.size, 0);
    console.debug('stream/chains observed stats', {
      phase,
      streamKey: key,
      symbol: symbol.toUpperCase(),
      expiration: data.expiration ?? null,
      strikeRange: data.strikeRange ?? null,
      strikeProximity: data.strikeProximity ?? null,
      optionType: data.optionType ?? 'All',
      strikeInterval: data.strikeInterval ?? 1,
      observedStrikes: strikes.length,
      observedLegs: observedLegCount,
      minStrike: strikes[0] ?? null,
      maxStrike: strikes.at(-1) ?? null,
      minStrikeValue: strikeValues[0] ?? null,
      maxStrikeValue: strikeValues.at(-1) ?? null,
      firstStrikes: strikes.slice(0, 10),
      lastStrikes: strikes.slice(-10),
      durationMs: Date.now() - startedAt,
    });
  };
  const clearStats = () => {
    if (!statsTimer) return;
    clearTimeout(statsTimer);
    statsTimer = null;
  };

  lib.utils.traceLog({
    scope,
    phase: 'api.start',
    traceId,
    action: actionLabel,
    streamKey: key,
    symbol: symbol.toUpperCase(),
    extra: {
      idleMs,
      expiration: data.expiration ?? null,
      optionType: data.optionType ?? 'All',
      strikeInterval: data.strikeInterval ?? 1,
      strikeRange: data.strikeRange ?? null,
    },
  });

  try {
    debug('stream/chains action start');
    if (action === 'unsubscribe') {
      debug('stream/chains unsubscribe requested');
      const result = await domain.ts.streams.unsubscribe({ kind: 'chains', key, client: metacomClient });
      debug('stream/chains unsubscribe result', result);
      return result;
    }

    if (action === 'touch') {
      debug('stream/chains touch requested', { idleMs });
      const result = await domain.ts.streams.touch({ kind: 'chains', key, client: metacomClient, idleMs });
      debug('stream/chains touch result', result);
      return result;
    }

    debug('stream/chains subscribe requested', { idleMs });
    const result = await domain.ts.streams.subscribe({
      kind: 'chains',
      key,
      client: metacomClient,
      idleMs,
      metadata: {
        symbol: symbol.toUpperCase(),
        expiration: data.expiration ?? null,
        expiration2: data.expiration2 ?? null,
        optionType: data.optionType ?? 'All',
        strikeRange: data.strikeRange ?? null,
        strikeProximity: data.strikeProximity ?? null,
        strikeInterval: data.strikeInterval ?? 1,
      },
      start: async ({ emit, notifyError, notifyStatus }) => {
        debug('stream/chains upstream start');
        statsTimer = setTimeout(() => {
          statsTimer = null;
          writeStats('sample');
        }, 15000);
        if (typeof statsTimer.unref === 'function') statsTimer.unref();

        const onData = (message) => {
          const option = lib.ts.readOptionChain({ message });
          if (!option || option.symbol === undefined) {
            console.error('Invalid option chain data received:', message);
            return;
          }

          observedStrikes.add(option.strike);
          if (!observedLegs.has(option.strike)) observedLegs.set(option.strike, new Set());
          observedLegs.get(option.strike).add(option.type);

          const instrument = buildInstrument(option.symbol);
          emit('stream/chain', {
            streamKey: key,
            instrument,
            expiration: option.expiration,
            chain: { [option.strike]: { [option.type]: option } },
          });
        };

        const onError = (error) => {
          clearStats();
          writeStats('error');
          const permanent = Boolean(error?.permanent || error?.streamStopped);
          debug('stream/chains upstream error', {
            code: error?.code ?? null,
            message: error?.message ?? String(error),
            permanent,
            reconnectable: error?.reconnectable ?? null,
          });
          console.error('stream chain error:', error);
          if (!permanent) return;
          notifyError(error);
          const reason = error?.code ? `upstream.${error.code}` : 'upstream.permanent-error';
          if (error?.exhausted) {
            debug('stream/chains retry exhausted', {
              reason,
              retryAttempt: error?.retryAttempt ?? null,
              maxRetries: error?.maxRetries ?? null,
            });
            debug('stream/chains terminal error after retries', {
              reason,
              retryAttempt: error?.retryAttempt ?? null,
              maxRetries: error?.maxRetries ?? null,
            });
          }
          debug('stream/chains terminal cleanup start', { reason });
          void domain.ts.streams
            .stopEntry({ kind: 'chains', key, reason })
            .then(() => {
              debug('stream/chains terminal cleanup done', { reason });
            })
            .catch((cleanupError) => {
              console.error('Failed to stop failed chain managed stream:', key, cleanupError);
            });
        };

        const onStatus = (status) => {
          const state = status?.state ?? 'recovering';
          debug(state === 'active' ? 'stream/chains recovered' : 'stream/chains recovering status', {
            state,
            reason: status?.reason ?? null,
            retryAttempt: status?.retryAttempt ?? null,
            maxRetries: status?.maxRetries ?? null,
            active: status?.active ?? true,
            resubscribeRequired: status?.resubscribeRequired ?? false,
            observedStrikes: observedStrikes.size,
            observedLegs: [...observedLegs.values()].reduce((sum, legs) => sum + legs.size, 0),
          });
          notifyStatus({ ...status, state, active: status?.active ?? true, resubscribeRequired: status?.resubscribeRequired ?? false });
        };

        let registeredKey = null;
        try {
          registeredKey = await tsClient.streamChains({ endpoint, symbol, data, onData, onError, onStatus });
          debug('stream/chains upstream ready');
        } catch (error) {
          clearStats();
          writeStats('startup-error');
          throw error;
        }
        return {
          stop: async ({ reason = 'unknown' } = {}) => {
            debug('stream/chains stop requested', { reason });
            clearStats();
            writeStats(reason === 'unknown' ? 'stop' : reason);
            await tsClient.stopStoredStream({ group: 'chains', key: registeredKey, reason });
            debug('stream/chains stop done', { reason });
          },
        };
      },
    });
    debug('stream/chains subscribe result', result);
    return result;
  } finally {
    debug('stream/chains action done', { durationMs: Date.now() - startedAt });
    lib.utils.traceLog({
      scope,
      phase: 'api.done',
      traceId,
      action: actionLabel,
      streamKey: key,
      symbol: symbol.toUpperCase(),
      durationMs: Date.now() - startedAt,
      extra: {
        idleMs,
        expiration: data.expiration ?? null,
        optionType: data.optionType ?? 'All',
        strikeInterval: data.strikeInterval ?? 1,
        strikeRange: data.strikeRange ?? null,
      },
    });
  }
};
