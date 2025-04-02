({
  access: 'public',
  method: async () => {
    console.warn(domain.ts.clients.getClient({}));
    return ['OK'];
  },
});
