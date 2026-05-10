({
  access: 'public',
  method: async ({ traceId = null, requestId = null } = {}) => {
    const trace = lib.utils.resolveTraceId({ traceId, requestId, prefix: 'stream' });
    const startedAt = Date.now();
    let removedCount = 0;

    lib.utils.traceLog({
      scope: 'stream/clear',
      phase: 'api.start',
      traceId: trace,
      action: 'clear',
    });

    try {
      const removed = await domain.ts.streams.unsubscribeAll({ client: context.client, reason: 'clear' });
      removedCount = removed.length;
      return {
        removed,
        total: removedCount,
      };
    } finally {
      lib.utils.traceLog({
        scope: 'stream/clear',
        phase: 'api.done',
        traceId: trace,
        action: 'clear',
        durationMs: Date.now() - startedAt,
        extra: { removedCount },
      });
    }
  },
});
