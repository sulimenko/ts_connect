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
          stop: async ({ reason = 'unknown' } = {}) => {
            await tsClient.stopStoredStream({ group: 'chains', key: registeredKey, reason });
          },
        };
      },
    });
  } finally {
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
