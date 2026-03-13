async ({
  client = null,
  responce = null,
  endpoint = [],
  symbol = '',
  data = {},
  action = 'subscribe',
  idleMs = null,
  streamKey = null,
}) => {
  const metacomClient = client ?? responce;
  if (!metacomClient) throw new Error('Metacom client is required');

  const tsClient = await domain.ts.clients.getClient({});
  const key = streamKey || tsClient.buildStreamKey({ group: 'chains', symbol, data });

  if (action === 'unsubscribe') {
    return domain.ts.streams.unsubscribe({ kind: 'chains', key, client: metacomClient });
  }

  if (action === 'touch') {
    return domain.ts.streams.touch({ kind: 'chains', key, client: metacomClient, idleMs });
  }

  return domain.ts.streams.subscribe({
    kind: 'chains',
    key,
    client: metacomClient,
    idleMs,
    metadata: {
      symbol: symbol.toUpperCase(),
      expiration: data.expiration ?? null,
      optionType: data.optionType ?? 'All',
      strikeInterval: data.strikeInterval ?? 1,
    },
    start: async ({ emit, notifyError }) => {
      const onData = (message) => {
        const option = lib.ts.readOptionChain({ message });
        if (!option || option.symbol === undefined) {
          console.error('Invalid option chain data received:', message);
          return;
        }

        emit('stream/chain', {
          streamKey: key,
          symbol: option.symbol,
          expiration: option.expiration,
          chain: { [option.strike]: { [option.type]: option } },
        });
      };

      const onError = (error) => {
        console.error('stream chain error:', error);
        notifyError(error);
      };

      const registeredKey = await tsClient.streamChains({ endpoint, symbol, data, onData, onError });
      return {
        stop: async () => {
          await tsClient.stopStoredStream({ group: 'chains', key: registeredKey });
        },
      };
    },
  });
};
