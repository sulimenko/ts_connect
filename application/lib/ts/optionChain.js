async ({ endpoint, symbol, data }) => {
  const client = await domain.ts.clients.getClient({});
  return new Promise(async (resolve, reject) => {
    const res = { symbol, expiration: data.expiration, stirkes: strikeProximity * 2, chain: {} };
    let timeoutId = null;
    let streamKey = null;

    const onData = (message) => {
      const option = lib.ts.readOptionChain({ message });
      if (res.chain[option.strike] === undefined) res.chain[option.strike] = {};
      res.chain[option.strike][option.type] = option;

      // clearTimeout(timeoutId);
      // timeoutId = null;
      if (timeoutId === null) {
        timeoutId = setTimeout(() => {
          console.debug('chains responce by time', Object.keys(chain.length));
          responce(chain, streamKey, timeoutId);
          return;
        }, 5000);
      }

      const keys = Object.keys(chain);
      if (keys.length > data.strikeProximity * 2 * 0.95) {
        if (keys.every((key) => Object.keys(chain[key]).length === 2)) {
          console.debug('chains responce by count', keys.length);
          responce(res, streamKey, timeoutId);
          return;
        }
      }
    };

    const onError = (err) => {
      responce(chain, streamKey, timeoutId);
      reject(err);
    };

    const responce = async function (res, streamKey, timeoutId) {
      resolve(res);
      clearTimeout(timeoutId);
      timeoutId = null;
      if (streamKey && client.streams.chains[streamKey]) {
        try {
          await client.streams.chains[streamKey].stopStream();
        } catch (err) {
          console.warn('Failed to stop stream:', err);
        }
        delete client.streams.chains[streamKey];
      }
    };

    try {
      streamKey = await client.streamChains({ endpoint, symbol, data, onData, onError });
    } catch (err) {
      reject(err);
    }
  });
};
