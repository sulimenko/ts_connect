({
  access: 'public',
  method: async () => {
    const client = await domain.ts.clients.getClient({});
    for (const name of Object.keys(client.streams)) {
      for (const key of Object.keys(client.streams[name])) {
        console.debug('Keys:', key, 'data:', client.streams[name][key].currentParams.data);
      }
    }
    return ['OK'];
  },
});
