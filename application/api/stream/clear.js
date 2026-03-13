({
  access: 'public',
  method: async () => {
    const removed = await domain.ts.streams.unsubscribeAll({ client: context.client });
    return {
      removed,
      total: removed.length,
    };
  },
});
