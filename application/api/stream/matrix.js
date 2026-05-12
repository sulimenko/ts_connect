({
  access: 'public',
  parameters: 'json',
  returns: 'json',
  errors: {
    EACTION: 'Invalid action: expected "subscribe", "unsubscribe", or "touch"',
    EINSTRUMENTS: 'At least one valid instrument is required for matrix subscribe requests',
  },
  method: async ({
    instruments = [],
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
    const actionValue = lib.utils.normalizeAction({ action, stop });
    const actionLabel = actionValue ?? 'subscribe';
    const instrumentList = Array.isArray(instruments) ? instruments : [];

    const data = { heartbeat: true, limit: 50, increment: 0.01, enableVolume: true };
    const providedKey = typeof streamKey === 'string' ? streamKey.trim() || null : null;
    let key = providedKey;
    let status = 'ok';
    let symbol = null;
    let tsSymbol = null;

    for (const instrument of instrumentList) {
      if (!instrument || typeof instrument !== 'object') continue;
      const parsed = lib.utils.makeSymbol(instrument.symbol);
      if (!parsed) continue;
      symbol = parsed.symbol ?? null;
      tsSymbol = parsed.tsSymbol ?? null;
      break;
    }

    lib.utils.traceLog({
      scope: 'stream/matrix',
      phase: 'api.start',
      traceId: trace,
      action: actionLabel,
      streamKey: key,
      symbol: tsSymbol,
      extra: { idleMs, instrumentCount: instrumentList.length },
    });

    try {
      if (actionValue !== null && !actionSet.has(actionValue)) {
        status = 'error:EACTION';
        return new DomainError('EACTION');
      }

      const symbolRequired = actionValue === null || actionValue === 'subscribe';
      if (!tsSymbol && (symbolRequired || !key)) {
        status = 'error:EINSTRUMENTS';
        return new DomainError('EINSTRUMENTS');
      }

      const tsClient = await domain.ts.clients.getClient({});
      if (!key) {
        key = tsClient.buildStreamKey({ group: 'matrix', symbol: tsSymbol, data });
      }

      if (actionValue === 'unsubscribe') {
        return await domain.ts.streams.unsubscribe({ kind: 'matrix', key, client: context.client });
      }
      if (actionValue === 'touch') {
        return await domain.ts.streams.touch({ kind: 'matrix', key, client: context.client, idleMs });
      }

      const endpoint = ['stream', 'matrix', 'changes', tsSymbol];

      return await domain.ts.streams.subscribe({
        kind: 'matrix',
        key,
        client: context.client,
        idleMs,
        metadata: { symbol: tsSymbol, owner: 'metaterminal', streamKey: key },
        start: async ({ notifyError, emit }) => {
          const onData = (message) => {
            if (message.AskSize === undefined && message.BidSize === undefined) return;

            const packet = { symbol, price: message.Price };
            if (message.BidSize > 0) {
              packet.type = 'bid';
              packet.size = message.BidSize;
            } else if (message.AskSize > 0) {
              packet.type = 'ask';
              packet.size = message.AskSize;
            } else {
              packet.type = 'delete';
              packet.size = message.BidSize ?? message.AskSize;
            }

            if (packet.type === 'delete' && packet.size !== 0) {
              console.error('stream matrix delete with size', message);
            }
            console.warn(packet);
            emit('stream/levelII', packet);
          };

          const onError = (error) => {
            console.error('stream matrix error:', error);
            notifyError(error);
          };

          const registeredKey = await tsClient.streamMatrix({
            endpoint,
            symbol: tsSymbol,
            data,
            onData,
            onError,
          });
          return {
            stop: async ({ reason = 'unknown' } = {}) => {
              await tsClient.stopStoredStream({ group: 'matrix', key: registeredKey, reason });
            },
          };
        },
      });
    } catch (error) {
      status = error instanceof DomainError ? `error:${error.code}` : 'error:internal';
      throw error;
    } finally {
      lib.utils.traceLog({
        scope: 'stream/matrix',
        phase: 'api.done',
        traceId: trace,
        action: actionLabel,
        streamKey: key,
        symbol: tsSymbol,
        durationMs: Date.now() - startedAt,
        extra: { idleMs, status, instrumentCount: instrumentList.length },
      });
    }
  },
});
