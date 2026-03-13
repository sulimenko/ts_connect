async ({ endpoint, symbol, data }) => {
  const client = await domain.ts.clients.getClient({});
  return new Promise((resolve, reject) => {
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
      void finalize(response, err instanceof Error ? err : new Error(String(err)));
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
