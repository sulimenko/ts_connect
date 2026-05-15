({
  values: {},
  connecting: {},
  revisions: {},

  invalidateSetup(name) {
    this.revisions[name] = (this.revisions[name] || 0) + 1;
    this.connecting[name] = null;
  },

  async deleteClient({ name }) {
    console.log('deleteClient:', name);
    const client = this.values[name];
    if (client) {
      if (typeof client.close === 'function') {
        await client.close({ reason: 'client.delete' });
      } else {
        for (const key of Object.keys(client.timers ?? {})) clearTimeout(client.timers[key]);
        if (client.streams) {
          for (const group of Object.keys(client.streams)) {
            for (const key of Object.keys(client.streams[group])) {
              const stream = client.streams[group][key];
              if (stream?.stopStream) stream.stopStream('client.delete');
            }
          }
        }
      }
    }
    delete this.values[name];
    this.invalidateSetup(name);
    return true;
  },

  async setClient({ name }) {
    if (this.values[name]) return this.values[name];
    if (this.connecting[name]) return this.connecting[name];

    console.log('setClient:', name);
    const token = (this.revisions[name] || 0) + 1;
    this.revisions[name] = token;
    const setup = (async () => {
      const client = await domain.ts.client({ name });
      if (config.ts[name] === undefined) return null;

      client.tokens.refresh = config.ts[name].rtoken;
      client.key.pkey = config.ts[name].pkey;
      client.key.secret = config.ts[name].secret;

      await lib.ts.refresh({ client });
      await client.syncBrokerageStreams({ name });
      client.lifetime();
      return client;
    })();

    this.connecting[name] = setup;

    try {
      const client = await setup;
      if (this.revisions[name] !== token) {
        if (client && typeof client.close === 'function') await client.close({ reason: 'client.revision' });
        return null;
      }
      if (client) this.values[name] = client;
      return this.values[name] || null;
    } finally {
      if (this.connecting[name] === setup) this.connecting[name] = null;
    }
  },

  async getClient({ name = 'ptfin', update = false }) {
    if (update) await this.deleteClient({ name });
    let client = this.values[name];
    if (client) {
      await client.syncBrokerageStreams({ name });
      return client;
    }
    client = await this.setClient({ name });
    return client;
  },
});
