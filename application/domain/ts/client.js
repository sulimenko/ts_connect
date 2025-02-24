({
  defaultClient: function ({ name }) {
    return {
      key: { pkey: null, secret: null },
      tokens: { id: null, access: null, expires: null, refresh: null },
      timers: { rtoken: null },
      socket: {},
      lifetime: function () {
        clearTimeout(this.timers.rtoken);
        this.timers.rtoken = setTimeout(() => {
          // console.log(this.tokens.expires, new Date(new Date().getTime() + 2 * 60 * 1000));
          if (this.tokens.expires < new Date(new Date().getTime() + 2 * 60 * 1000)) lib.ts.refresh({ client: this });
          this.lifetime();
        }, 60 * 1000);
      },
      streamOrders: async function ({ contract, ordersIds = [] }) {
        if (this.socket[contract.account] === undefined) this.socket[contract.account] = {};
        this.socket[contract.account].orders = await lib.stream.orders({ client: this, contract, ordersIds });
      },
      streamPositions: async function ({ contract }) {
        if (this.socket[contract.account] === undefined) this.socket[contract.account] = {};
        this.socket[contract.account].positions = await lib.stream.positions({ client: this, contract });
      },
    };
  },
  storage: new Map(),
  delClient: function ({ name }) {
    console.log('tn deleteClient', name);
    const client = this.storage.get(name);
    if (client) for (const key of Object.keys(client.timers)) clearTimeout(client.timers[key]);
    this.storage.delete(name);
  },
  setClient: async function ({ name, update = false }) {
    console.log('setClient:', name);
    let client = this.defaultClient({ name });

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
