async ({ endpoint, symbol, data }) => {
  const client = await domain.ts.clients.getClient({});
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

    const expectedStrikes = Math.max(0, Number(data.strikeProximity) || 0) * 2;
    const expectedLegsPerStrike = data.optionType === 'All' ? 2 : 1;
    const response = {
      symbol: symbol.toUpperCase(),
      expiration: data.expiration ?? null,
      strikes: expectedStrikes,
      chain: {},
    };

    let streamKey = null;
    let timeoutId = null;
    let settled = false;

    const finalize = async (result, error = null) => {
      if (settled) return;
      settled = true;

      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      if (streamKey) await client.stopStoredStream({ group: 'chains', key: streamKey });

      if (error) reject(error);
      else resolve(result);
    };

    const onData = (message) => {
      const option = lib.ts.readOptionChain({ message });
      if (!option) return;
      if (response.chain[option.strike] === undefined) response.chain[option.strike] = {};
      response.chain[option.strike][option.type] = option;

      if (timeoutId === null) {
        timeoutId = setTimeout(() => {
          void finalize(response);
        }, 5000);
      }

      if (expectedStrikes === 0) return;

      const keys = Object.keys(response.chain);
      const enoughStrikes = keys.length >= Math.ceil(expectedStrikes * 0.95);
      if (!enoughStrikes) return;

      const hasEnoughLegs = keys.every((key) => Object.keys(response.chain[key]).length >= expectedLegsPerStrike);
      if (hasEnoughLegs) {
        console.debug('chains response by count', keys.length);
        void finalize(response);
      }
    };

    const onError = (err) => {
      void finalize(response, normalizeError(err));
    };

    client
      .streamChains({ endpoint, symbol, data, onData, onError })
      .then((key) => {
        streamKey = key;
      })
      .catch((error) => {
        void finalize(response, error);
      });
  });
};
