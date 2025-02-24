({
  access: 'public',
  method: async () => {
    console.warn(domain.ts.client.getClient({}));
    return ['OK'];
  },
});
