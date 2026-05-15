async () => ({
  key: { pkey: null, secret: null },
  tokens: { id: null, access: null, expires: null, refresh: null },
  timers: { rtoken: null },
  brokerage: { setup: null, ready: false },
  closed: false,
  streams: {
    charts: {},
    chains: {},
    quotes: {},
    orders: {},
    positions: {},
    matrix: {},
  },

  getStreamBucket(group) {
    if (this.streams[group] === undefined) this.streams[group] = {};
    return this.streams[group];
  },

  serializeStreamData(data = {}) {
    const pairs = [];
    for (const key of Object.keys(data).sort()) {
      const value = data[key];
      if (value === undefined || value === null || value === '') continue;
      pairs.push(`${key}=${value}`);
    }
    return pairs.join('&');
  },

  buildStreamKey({ group, endpoint = [], symbol = null, data = {} }) {
    if (group === 'quotes') return endpoint.at(-1);

    const prefix = symbol ? symbol.toUpperCase() : endpoint.join('/');
    const suffix = this.serializeStreamData(data);
    return suffix ? `${prefix}?${suffix}` : prefix;
  },

  getBrokerageAccount({ contract }) {
    const account = `${contract?.account ?? ''}`.trim();
    return account || null;
  },

  async stopStoredStream({ group, key, reason = 'unknown' }) {
    const bucket = this.getStreamBucket(group);
    const stream = bucket[key];
    if (!stream) return false;

    try {
      await stream.stopStream(reason);
    } catch (error) {
      console.warn(`Failed to stop stream ${group}:${key}:`, error);
    }

    delete bucket[key];
    return true;
  },

  async setStoredStream({ group, key, stream }) {
    await this.stopStoredStream({ group, key });
    this.getStreamBucket(group)[key] = stream;
    return key;
  },

  async stopAllStreams({ reason = 'client.close' } = {}) {
    for (const group of Object.keys(this.streams)) {
      const bucket = this.getStreamBucket(group);
      for (const key of Object.keys(bucket)) {
        await this.stopStoredStream({ group, key, reason });
      }
    }
  },

  async close({ reason = 'client.close' } = {}) {
    if (this.closed) return true;
    this.closed = true;
    this.brokerage.ready = false;
    this.brokerage.setup = null;

    await this.stopAllStreams({ reason });

    for (const key of Object.keys(this.timers)) {
      clearTimeout(this.timers[key]);
      this.timers[key] = null;
    }

    return true;
  },

  async syncBrokerageStreams({ name = 'ptfin' } = {}) {
    if (name !== 'ptfin' || this.closed) return false;
    if (!this.tokens.access) {
      console.warn('Brokerage stream sync skipped: missing access token', name);
      return false;
    }
    if (this.brokerage.ready) return true;
    if (this.brokerage.setup) return this.brokerage.setup;

    this.brokerage.setup = (async () => {
      try {
        const contracts = await lib.ptfin.getContract({ accounts: ['all'] });
        if (this.closed) return false;
        if (!Array.isArray(contracts) || contracts.length === 0) {
          console.warn('Brokerage stream sync skipped: no contracts', name);
          return false;
        }

        const seenAccounts = new Set();
        let started = false;
        let complete = true;

        for (const contract of contracts) {
          if (this.closed) return false;
          const account = this.getBrokerageAccount({ contract });
          if (!account || seenAccounts.has(account)) continue;
          seenAccounts.add(account);

          const orderStarted = await this.streamOrders({ contract: { ...contract, account } });
          const positionStarted = await this.streamPositions({ contract: { ...contract, account } });
          if (!orderStarted || !positionStarted) complete = false;
          if (orderStarted || positionStarted) started = true;
        }

        if (started && complete) this.brokerage.ready = true;
        return started && complete;
      } catch (error) {
        console.warn('Brokerage stream sync failed:', name, error);
        return false;
      } finally {
        this.brokerage.setup = null;
      }
    })();

    return this.brokerage.setup;
  },

  lifetime() {
    clearTimeout(this.timers.rtoken);
    this.timers.rtoken = setTimeout(() => {
      try {
        // console.log(this.tokens.expires, new Date(new Date().getTime() + 2 * 60 * 1000));
        // if (this.tokens.expires < new Date(new Date().getTime() + 19 * 60 * 1000)) lib.ts.refresh({ client: this });
        if (this.tokens.expires < new Date(new Date().getTime() + 2 * 60 * 1000)) lib.ts.refresh({ client: this });
      } catch (error) {
        console.error('Error in lifetime management:', error);
      }
      this.lifetime();
    }, 60 * 1000);
  },

  async streamOrders({ contract, ordersIds = [] }) {
    try {
      if (this.closed) return false;
      const account = this.getBrokerageAccount({ contract });
      if (!account) return false;

      const data = ordersIds.length > 0 ? { ordersIds: ordersIds.join(',') } : {};
      const key = this.buildStreamKey({ group: 'orders', symbol: account, data });
      const bucket = this.getStreamBucket('orders');
      if (bucket[key]) return key;

      const endpoint = ['brokerage', 'stream', 'accounts', account, 'orders'];
      if (ordersIds.length > 0) endpoint.push(ordersIds.join(','));

      const onData = (message) => {
        if (message?.StreamStatus === 'EndSnapshot') return;
        if (message?.StreamStatus && !message.OrderID) return;
        domain.queue.addTask({ endpoint: ['response'], data: { type: 'order', data: message } });
      };

      const onError = (err) => console.error('Stream orders error:', account, endpoint.join('/'), err);

      const stream = lib.ts.stream({ live: contract.live, endpoint, tokens: this.tokens, onData, onError });
      await stream.initiateStream();
      if (this.closed) {
        stream.stopStream('client.close');
        return false;
      }
      await this.setStoredStream({ group: 'orders', key, stream });
      return key;
    } catch (error) {
      console.error('Error in streamOrders:', contract?.account, error);
      return false;
    }
  },

  async streamPositions({ contract }) {
    try {
      if (this.closed) return false;
      const account = this.getBrokerageAccount({ contract });
      if (!account) return false;

      const key = this.buildStreamKey({ group: 'positions', symbol: account });
      const bucket = this.getStreamBucket('positions');
      if (bucket[key]) return key;

      const endpoint = ['brokerage', 'stream', 'accounts', account, 'positions'];

      const onData = (message) => {
        try {
          if (message?.StreamStatus) return;
          const symbol = lib.utils.makeSymbol(message.Symbol)?.symbol ?? null;
          if (!symbol) return;
          const accountId = message.AccountID ?? account;
          const position = domain.ts.positions.setPosition({ account: accountId, symbol, data: message });
          if (lib.utils.readPositionQuantity(position) === 0) {
            domain.ts.positions.clearPosition({ account: accountId, symbol });
          }
        } catch (error) {
          console.error('Error processing position message:', error);
        }
      };
      const onError = (err) => console.error('Stream positions error:', account, endpoint.join('/'), err);

      const stream = lib.ts.stream({ live: contract.live, endpoint, tokens: this.tokens, onData, onError });
      await stream.initiateStream();
      if (this.closed) {
        stream.stopStream('client.close');
        return false;
      }
      await this.setStoredStream({ group: 'positions', key, stream });
      return key;
    } catch (error) {
      console.error('Error in streamPositions:', contract?.account, error);
      return false;
    }
  },

  async streamMatrix({ endpoint, symbol, data, onData, onError }) {
    try {
      const key = this.buildStreamKey({ group: 'matrix', symbol, data });

      const stream = lib.ts.stream({ live: true, ver: 'v2', endpoint, tokens: this.tokens, data, onData, onError });
      await stream.initiateStream();
      await this.setStoredStream({ group: 'matrix', key, stream });
      return key;
    } catch (error) {
      console.error('Error in stream matrix:', error);
      throw error;
    }
  },

  async streamChains({ endpoint, symbol, data, onData, onError }) {
    try {
      const key = this.buildStreamKey({ group: 'chains', symbol, data });

      const stream = lib.ts.stream({ live: true, endpoint, tokens: this.tokens, data, onData, onError });
      await stream.initiateStream();
      await this.setStoredStream({ group: 'chains', key, stream });
      return key;
    } catch (error) {
      console.error('Error in stream chain:', error);
      throw error;
    }
  },

  async streamQuotes({ endpoint, onData, onError, trace = null }) {
    try {
      const key = this.buildStreamKey({ group: 'quotes', endpoint });

      const stream = lib.ts.stream({ live: true, endpoint, tokens: this.tokens, onData, onError, trace });
      await stream.initiateStream();
      await this.setStoredStream({ group: 'quotes', key, stream });
      return key;
    } catch (error) {
      console.error('Error in stream quotes:', error);
      throw error;
    }
  },

  async streamCharts({ endpoint, symbol, data, onData, onError }) {
    try {
      const key = this.buildStreamKey({ group: 'charts', symbol, data });

      const stream = lib.ts.stream({ live: true, endpoint, tokens: this.tokens, data, onData, onError });
      await stream.initiateStream();
      await this.setStoredStream({ group: 'charts', key, stream });
      return key;
    } catch (error) {
      console.error('Error in stream charts:', error);
      throw error;
    }
  },
});
