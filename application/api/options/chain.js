({
  access: 'public',
  method: async ({ symbol, expiration, range = 0, stream = false, stop = false }) => {
    const endpoint = ['marketdata', 'stream', 'options', 'chains', symbol.toUpperCase()];
    // if (range === null) {
    //   const strikes = await api.options.strikes({ symbol, expiration });
    //   range = Math.ceil(strikes.Strikes.length / 2);
    // }

    console.debug('range:', range);
    const data = {
      expiration,
      strikeProximity: range,
      spreadType: 'Single',
      strikeInterval: 1,
      enableGreeks: true,
      strikeRange: 'All',
      optionType: 'All',
    };

    if (!stream) return lib.ts.optionChain({ endpoint, symbol, data });
    if (stop) {
      const client = await domain.ts.clients.getClient({});
      const streamKey = symbol.toUpperCase() + '_' + data.expiration;
      if (client.streams.chains[streamKey] !== undefined) {
        try {
          await client.streams.chains[streamKey].stopStream();
        } catch (err) {
          console.warn('Failed to stop option chain stream:', err);
        }
        delete client.streams.chains[streamKey];
      }
      return { stopped: true };
    }
    return lib.stream.optionChain({ responce: context.client, endpoint, symbol, data });
  },
});
