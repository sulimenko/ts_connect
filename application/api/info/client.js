({
  access: 'public',
  method: async () => {
    const client = await domain.ts.clients.getClient({});
    const subscriptions = domain.ts.streams.list();

    const upstream = {};
    for (const group of Object.keys(client.streams)) {
      upstream[group] = Object.keys(client.streams[group]).map((key) => ({
        key,
        data: client.streams[group][key].currentParams?.data ?? {},
        endpoint: client.streams[group][key].currentParams?.endpoint ?? [],
      }));
    }

    return {
      upstream,
      subscriptions,
    };
  },
});
