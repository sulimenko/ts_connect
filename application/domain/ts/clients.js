({
  storage: new Map(),
  delClient: function ({ name }) {
    console.log('deleteClient:', name);
    const client = this.storage.get(name);
    if (client) {
      for (const key of Object.keys(client.timers)) clearTimeout(client.timers[key]);
      if (client.streams) {
        for (const account in client.streams) {
          for (const key in client.streams[account]) {
            client.streams[account][key].stopStream();
          }
        }
      }
    }
    this.storage.delete(name);
  },
  setClient: async function ({ name, update = false }) {
    console.log('setClient:', name);
    const client = await domain.ts.client({ name });

    if (config.ts[name] === undefined) return null;

    client.tokens.refresh = config.ts[name].rtoken;
    client.key.pkey = config.ts[name].pkey;
    client.key.secret = config.ts[name].secret;

    await lib.ts.refresh({ client });
    client.lifetime();
    // console.log(client);
    return this.storage.set(name, client).get(name);
  },
  getClient: async function ({ name = 'ptfin', update = false }) {
    name = name ?? 'ptfin';
    if (update) this.delClient({ name });
    let client = this.storage.get(name);
    if (!client) client = await this.setClient({ name, update });
    return client;
  },
});
