async () => ({
  key: { pkey: null, secret: null },
  tokens: { id: null, access: null, expires: null, refresh: null },
  timers: { rtoken: null },
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
      if (this.streams[contract.account] === undefined) this.streams[contract.account] = {};

      const endpoint = ['brokerage', 'stream', 'accounts', contract.account, 'orders'];
      if (ordersIds.length > 0) endpoint.push(ordersIds.join(','));

      const onData = (message) => {
        if (message.StreamStatus && message.StreamStatus === 'EndSnapshot') return;
        if (message.StreamStatus) console.debug('streamOrders onData:', message);
        // console.debug('orders:', message.OrderID ?? message);
        console.debug('orders:', message);
        domain.queue.addTask({ endpoint: ['response'], data: { type: 'order', data: message } });
        // lib.ptfin.send({ method: 'POST', endpoint: ['response'], data: { type: 'order', data: message } });
      };

      const onError = (err) => console.error('Stream orders error:', err);

      const stream = lib.ts.stream({ live: contract.live, endpoint, tokens: this.tokens, onData, onError });
      await stream.initiateStream();
      this.streams[contract.account].orders = stream;
    } catch (error) {
      console.error('Error in streamOrders:', error);
    }
  },

  async streamPositions({ contract }) {
    try {
      if (this.streams[contract.account] === undefined) this.streams[contract.account] = {};
      const endpoint = ['brokerage', 'stream', 'accounts', contract.account, 'positions'];

      const onData = (message) => {
        try {
          if (!message.StreamStatus) {
            // console.info('streamPositions', message.AccountID, message.Symbol, ':', message.Quantity, message.AveragePrice);
            const symbol = lib.utils.makeSymbol(message.Symbol)?.symbol ?? message.Symbol;
            domain.ts.positions.setPosition({ account: message.AccountID, symbol, data: message });
          }
        } catch (error) {
          console.error('Error processing position message:', error);
        }
      };
      const onError = (err) => console.error('Stream positions error:', err);

      const stream = lib.ts.stream({ live: contract.live, endpoint, tokens: this.tokens, onData, onError });
      await stream.initiateStream();
      this.streams[contract.account].positions = stream;
    } catch (error) {
      console.error('Error in streamPositions:', error);
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
