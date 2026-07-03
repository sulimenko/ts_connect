async ({ endpoint, symbol, data }) => {
  const client = await domain.ts.clients.getClient({});
  const countStrikes = (value) => {
    const raw =
      (Array.isArray(value) && value) ||
      (Array.isArray(value?.Strikes) && value.Strikes) ||
      (Array.isArray(value?.strikes) && value.strikes) ||
      (Array.isArray(value?.StrikePrices) && value.StrikePrices) ||
      (Array.isArray(value?.strikePrices) && value.strikePrices) ||
      [];

    const values = raw
      .flat(Infinity)
      .map((strike) => {
        if (typeof strike !== 'object' || strike === null) return strike;
        return strike.StrikePrice ?? strike.Strike ?? strike.price;
      })
      .map((strike) => lib.utils.formatStrike(strike))
      .filter(Boolean);

    return new Set(values).size;
  };
  const proximity = Math.max(0, Number(data.strikeProximity) || 0);
  const all = data.strikeRange === 'All';
  let expectedStrikes = proximity > 0 ? proximity * 2 : null;
  let expectedSource = proximity > 0 ? 'strikeProximity' : 'unknown';

  if (all && typeof lib.ts.send === 'function') {
    try {
      const params = {
        spreadType: data.spreadType ?? 'Single',
        strikeInterval: data.strikeInterval ?? 1,
      };
      if (data.expiration) params.expiration = data.expiration;
      if (data.expiration2) params.expiration2 = data.expiration2;
      const strikes = await lib.ts.send({
        method: 'GET',
        live: true,
        endpoint: ['marketdata', 'options', 'strikes', symbol],
        token: client.tokens?.access ?? null,
        data: params,
      });
      const count = countStrikes(strikes);
      if (count > 0) {
        expectedStrikes = count;
        expectedSource = 'options-strikes';
      }
    } catch {
      expectedSource = 'unknown';
    }
  }

  return new Promise((resolve, reject) => {
    const normalizeError = (err) => {
      if (err instanceof Error) return err;

      if (err?.Error) {
        const message = err.Message ? `${err.Error}: ${err.Message}` : err.Error;
        const error = new Error(message);
        error.code = err.Error;
        error.details = err.Message ?? null;
        error.upstreamMessage = err.Message ?? null;
        error.symbol = err.Symbol ?? null;
        error.packet = err;
        return error;
      }

      if (err?.message) {
        const error = new Error(err.message);
        if (err.name !== undefined) error.name = err.name;
        if (err.code !== undefined) error.code = err.code;
        if (err.details !== undefined) error.details = err.details;
        if (err.upstreamMessage !== undefined) error.upstreamMessage = err.upstreamMessage;
        if (err.symbol !== undefined) error.symbol = err.symbol;
        return error;
      }

      return new Error(String(err));
    };

    const expectedLegsPerStrike = data.optionType === 'All' ? 2 : 1;
    const response = {
      symbol: symbol.toUpperCase(),
      expiration: data.expiration ?? null,
      strikes: 0,
      chain: {},
      metadata: {
        requested: {
          strikeProximity: proximity,
          spreadType: data.spreadType ?? 'Single',
          strikeInterval: data.strikeInterval ?? 1,
          enableGreeks: data.enableGreeks ?? true,
          strikeRange: data.strikeRange ?? null,
          optionType: data.optionType ?? 'All',
          expiration: data.expiration ?? null,
          expiration2: data.expiration2 ?? null,
          priceCenter: data.priceCenter ?? null,
        },
        expectedStrikes,
        actualStrikes: 0,
        expectedLegsPerStrike,
        actualLegs: 0,
        partial: true,
        source: 'stream-snapshot',
        expectedSource,
        reason: 'pending',
      },
    };

    let streamKey = null;
    const timing = all ? { minWaitMs: 5000, idleMs: 1500, hardTimeoutMs: 15000 } : { minWaitMs: 0, idleMs: 5000, hardTimeoutMs: 5000 };
    const startedAt = Date.now();
    let lastPacketAt = null;
    let timerId = null;
    let settled = false;

    const updateMeta = (reason) => {
      const keys = Object.keys(response.chain);
      const actualLegs = keys.reduce((sum, key) => sum + Object.keys(response.chain[key]).length, 0);
      const missingStrikes = expectedStrikes !== null ? Math.max(expectedStrikes - keys.length, 0) : null;
      const missingLegs = keys.reduce((sum, key) => Math.max(expectedLegsPerStrike - Object.keys(response.chain[key]).length, 0) + sum, 0);
      const incompleteStrikes = expectedStrikes !== null && keys.length < expectedStrikes;
      const incompleteLegs = keys.some((key) => Object.keys(response.chain[key]).length < expectedLegsPerStrike);

      response.strikes = keys.length;
      response.metadata.actualStrikes = keys.length;
      response.metadata.actualLegs = actualLegs;
      response.metadata.missingStrikes = missingStrikes;
      response.metadata.missingLegs = missingLegs;
      response.metadata.partial = reason !== 'complete' || incompleteStrikes || incompleteLegs;
      response.metadata.reason = response.metadata.partial ? reason : 'complete';
    };

    const stop = async (key) => {
      if (!key) return;
      try {
        await client.stopStoredStream({ group: 'chains', key });
      } catch (error) {
        console.warn('chains stream cleanup failed:', key, error);
      }
    };

    const finalize = async (result, error = null, reason = 'complete') => {
      if (settled) return;
      settled = true;
      updateMeta(reason);

      if (timerId) {
        clearTimeout(timerId);
        timerId = null;
      }

      await stop(streamKey);

      if (error) reject(error);
      else resolve(result);
    };

    const onData = (message) => {
      const option = lib.ts.readOptionChain({ message });
      if (!option) return;
      lastPacketAt = Date.now();
      if (response.chain[option.strike] === undefined) response.chain[option.strike] = {};
      response.chain[option.strike][option.type] = option;

      if (expectedStrikes === null) return;

      const keys = Object.keys(response.chain);
      const enoughStrikes = keys.length >= Math.ceil(expectedStrikes * 0.95);
      if (!enoughStrikes) return;

      const hasEnoughLegs = keys.every((key) => Object.keys(response.chain[key]).length >= expectedLegsPerStrike);
      if (hasEnoughLegs) {
        console.debug('chains response by count', keys.length);
        void finalize(response, null, 'complete');
      }
    };

    const onError = (err) => {
      void finalize(response, normalizeError(err), 'error');
    };

    const schedule = (forceReason = null) => {
      if (settled) return;

      if (forceReason) {
        void finalize(response, null, forceReason);
        return;
      }

      const elapsed = Date.now() - startedAt;
      if (elapsed >= timing.hardTimeoutMs) {
        void finalize(response, null, 'timeout');
        return;
      }

      if (elapsed >= timing.minWaitMs && lastPacketAt !== null) {
        const idleFor = Date.now() - lastPacketAt;
        if (idleFor >= timing.idleMs) {
          void finalize(response, null, 'idle');
          return;
        }
      }

      const waitForMin = Math.max(timing.minWaitMs - elapsed, 0);
      let waitForIdle = timing.idleMs;
      if (lastPacketAt !== null && elapsed >= timing.minWaitMs) {
        waitForIdle = Math.max(timing.idleMs - (Date.now() - lastPacketAt), 0);
      }
      const waitForHard = Math.max(timing.hardTimeoutMs - elapsed, 0);
      const delay = Math.max(1, Math.min(waitForHard, waitForMin || waitForIdle));
      let reason = null;
      if (delay === waitForHard) reason = 'timeout';
      else if (delay === waitForIdle && lastPacketAt !== null && elapsed >= timing.minWaitMs) reason = 'idle';

      timerId = setTimeout(() => schedule(reason), delay);
    };

    const stream = client.streamChains({ endpoint, symbol, data, onData, onError });
    schedule();

    stream
      .then((key) => {
        streamKey = key;
        if (settled) void stop(key);
      })
      .catch((error) => {
        void finalize(response, error);
      });
  });
};
