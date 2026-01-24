({
  values: {},
  deleteClient: function ({ name }) {
    console.log('deleteClient:', name);
    const client = this.values[name];
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
    delete this.values[name];
    return true;
  },
  setClient: async function ({ name }) {
    console.log('setClient:', name);
    const client = await domain.ts.client({ name });
    if (config.ts[name] === undefined) return null;

    client.tokens.refresh = config.ts[name].rtoken;
    client.key.pkey = config.ts[name].pkey;
    client.key.secret = config.ts[name].secret;

    await lib.ts.refresh({ client });
    client.lifetime();
    // console.log(client);
    this.values[name] = client;
    return this.values[name];
  },
  getClient: async function ({ name = 'ptfin', update = false }) {
    if (update) this.deleteClient({ name });
    let client = this.values[name];
    if (client) return client;
    client = await this.setClient({ name });
    return client;
  },
});
