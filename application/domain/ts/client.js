async () => ({
  key: { pkey: null, secret: null },
  tokens: { id: null, access: null, expires: null, refresh: null },
  tokenRefresh: null,
  timers: { rtoken: null },
  brokerage: { setup: null, recovery: null, recoveryAuth: false, ready: false, accounts: new Map(), reconciling: {} },
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
    if (!stream) {
      console.debug('stored stream stop missing', { group, streamKey: key, reason });
      return false;
    }

    try {
      console.debug('stored stream stop requested', { group, streamKey: key, reason });
      await stream.stopStream(reason);
    } catch (error) {
      console.warn(`Failed to stop stream ${group}:${key}:`, error);
    }

    delete bucket[key];
    console.debug('stored stream stop done', { group, streamKey: key, reason });
    return true;
  },

  async setStoredStream({ group, key, stream }) {
    await this.stopStoredStream({ group, key });
    this.getStreamBucket(group)[key] = stream;
    console.debug('stored stream set', { group, streamKey: key });
    return key;
  },

  streamUsable(stream) {
    return Boolean(stream && stream.shouldReconnect !== false && ['starting', 'active', 'recovering'].includes(stream.state));
  },

  brokerageHealthy() {
    if (this.brokerage.accounts.size === 0) return false;
    for (const account of this.brokerage.accounts.keys()) {
      if (!this.streamUsable(this.streams.orders[account]) || !this.streamUsable(this.streams.positions[account])) return false;
    }
    return true;
  },

  sendOrder({ live, account, order, source, generation = null }) {
    const pending = domain.ts.orders.pending({ live, account, order, generation });
    if (!pending) return false;
    const { order: merged, fingerprint } = pending;
    const delivery = { live, account: merged.AccountID, orderId: merged.OrderID, fingerprint };
    console.debug('brokerage order ready', { account, OrderID: merged.OrderID, hydrationSource: source });
    domain.queue.addTask({
      endpoint: ['response'],
      data: { type: 'order', data: merged },
      onSuccess: () => domain.ts.orders.delivered(delivery),
      onFailure: () => domain.ts.orders.failed(delivery),
    });
    return true;
  },

  async hydrateOrder({ live, account, order }) {
    let merged = domain.ts.orders.merge({ live, account, order });
    if (domain.ts.orders.missing(merged).length === 0) return { order: merged, source: 'cache' };

    for (const historical of [false, true]) {
      const orderId = `${merged.OrderID}`;
      const response = await lib.ts.orders({
        account,
        live,
        token: this.tokens.access,
        orderIds: [merged.OrderID],
        historical,
      });
      const found = response.orders.find((item) => `${item?.OrderID ?? ''}` === orderId);
      if (!found) continue;
      const restored = { ...found, ...merged };
      if (Array.isArray(found.Legs)) {
        restored.Legs = Array.isArray(merged.Legs) ? domain.ts.orders.mergeLegs(found.Legs, merged.Legs) : found.Legs;
      }
      merged = domain.ts.orders.merge({ live, account, order: restored });
      if (domain.ts.orders.missing(merged).length === 0) {
        return { order: merged, source: historical ? 'historical' : 'current' };
      }
    }
    return { order: merged, source: null };
  },

  async handleOrder({ live, account, order, generation = null }) {
    if (!order?.OrderID) return false;
    try {
      const hydrated = await this.hydrateOrder({ live, account, order: { ...order, AccountID: order.AccountID ?? account } });
      const missingFields = domain.ts.orders.missing(hydrated.order);
      if (missingFields.length === 0) {
        return this.sendOrder({ live, account, order: hydrated.order, source: hydrated.source, generation });
      }
      console.warn('brokerage order hydration failed', {
        account,
        OrderID: order.OrderID,
        missingFields,
        reason: 'order-not-found',
      });
      void this.reconcileOrders({ live, account, reason: 'hydration.failed' });
      return false;
    } catch (error) {
      console.warn('brokerage order hydration failed', {
        account,
        OrderID: order.OrderID,
        missingFields: domain.ts.orders.missing(order),
        reason: error?.message ?? 'request.failed',
      });
      void this.reconcileOrders({ live, account, reason: 'hydration.error' });
      return false;
    }
  },

  async reconcileOrders({ live, account, reason = 'lifecycle' }) {
    const key = `${live === true}|${account}`;
    if (this.brokerage.reconciling[key]) return this.brokerage.reconciling[key];
    const task = (async () => {
      const generation = domain.ts.orders.generation({ live, account });
      try {
        const [current, historical] = await Promise.all([
          lib.ts.orders({ account, live, token: this.tokens.access }),
          lib.ts.orders({ account, live, token: this.tokens.access, historical: true }),
        ]);
        const snapshot = new Map();
        for (const order of [...historical.orders, ...current.orders]) {
          const accountId = `${order?.AccountID ?? account}`.trim();
          const orderId = `${order?.OrderID ?? ''}`.trim();
          if (!accountId || !orderId) continue;
          snapshot.set(`${accountId}|${orderId}`, { ...order, AccountID: accountId });
        }
        for (const order of snapshot.values()) {
          this.sendOrder({ live, account, order, source: `reconcile:${reason}`, generation });
        }
        return true;
      } catch (error) {
        console.warn('brokerage order reconciliation failed', { account, reason, error: error?.message ?? error });
        return false;
      } finally {
        delete this.brokerage.reconciling[key];
      }
    })();
    this.brokerage.reconciling[key] = task;
    return task;
  },

  recoverBrokerage({ name = 'ptfin', reason = 'unknown', authorization = false } = {}) {
    if (authorization && !(this.brokerage.recovery && this.tokenRefresh)) this.brokerage.recoveryAuth = true;
    if (this.brokerage.recovery) return this.brokerage.recovery;
    this.brokerage.ready = false;
    const recovery = (async () => {
      try {
        if (this.brokerage.setup) await this.brokerage.setup;
        let result = false;
        for (let cycle = 0; cycle < 2; cycle++) {
          for (const group of ['orders', 'positions']) {
            for (const key of Object.keys(this.getStreamBucket(group))) {
              await this.stopStoredStream({ group, key, reason });
            }
          }
          const refresh = this.brokerage.recoveryAuth;
          this.brokerage.recoveryAuth = false;
          if (refresh) await this.refreshAccessToken({ reason: 'brokerage' });
          result = await this.syncBrokerageStreams({ name });
          if (!this.brokerage.recoveryAuth) return result;
        }
        return result;
      } catch (error) {
        console.warn('Brokerage stream recovery failed:', { reason, error: error?.message ?? error });
        return false;
      } finally {
        this.brokerage.recovery = null;
        this.brokerage.recoveryAuth = false;
      }
    })();
    this.brokerage.recovery = recovery;
    return recovery;
  },

  refreshAccessToken({ reason = 'unknown' } = {}) {
    if (this.closed) {
      console.debug('OAuth refresh', { event: 'oauth.refresh', reason, state: 'skipped', shared: false, closed: true });
      return Promise.resolve(false);
    }
    if (this.tokenRefresh) {
      console.debug('OAuth refresh', { event: 'oauth.refresh', reason, state: 'shared', shared: true, closed: false });
      return this.tokenRefresh;
    }

    const refresh = (async () => {
      console.debug('OAuth refresh', { event: 'oauth.refresh', reason, state: 'started', shared: false, closed: false });
      try {
        const result = await lib.ts.refresh({ client: this });
        console.debug('OAuth refresh', {
          event: 'oauth.refresh',
          reason,
          state: 'completed',
          shared: false,
          closed: this.closed,
        });
        return result;
      } catch (error) {
        console.warn('OAuth refresh', {
          event: 'oauth.refresh',
          reason,
          state: 'failed',
          shared: false,
          closed: this.closed,
          errorName: error?.name,
          errorCode: error?.code,
        });
        throw error;
      } finally {
        if (this.tokenRefresh === refresh) this.tokenRefresh = null;
      }
    })();

    this.tokenRefresh = refresh;
    return refresh;
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

    for (const [account, contract] of this.brokerage.accounts) {
      domain.ts.orders.clearAccount({ live: contract.live, account });
    }
    this.brokerage.accounts.clear();

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
    if (this.brokerage.ready && this.brokerageHealthy()) return true;
    this.brokerage.ready = false;
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
          const normalized = { ...contract, account, live: contract.live === true || contract.live === 1 || contract.live === '1' };
          this.brokerage.accounts.set(account, normalized);

          const orderStarted = await this.streamOrders({ contract: normalized });
          const positionStarted = await this.streamPositions({ contract: normalized });
          if (!orderStarted || !positionStarted) complete = false;
          if (orderStarted || positionStarted) started = true;
        }

        this.brokerage.ready = started && complete && this.brokerageHealthy();
        return this.brokerage.ready;
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
    this.timers.rtoken = null;
    if (this.closed) return;
    this.timers.rtoken = setTimeout(() => {
      this.timers.rtoken = null;
      if (this.closed) return;
      void (async () => {
        try {
          if (this.tokens.expires < new Date(new Date().getTime() + 2 * 60 * 1000)) {
            await this.refreshAccessToken({ reason: 'lifetime' });
          }
        } catch (error) {
          console.warn('OAuth refresh handled', {
            event: 'oauth.refresh',
            reason: 'lifetime',
            state: 'handled',
            shared: false,
            closed: this.closed,
            errorName: error?.name,
            errorCode: error?.code,
          });
        } finally {
          if (!this.closed) this.lifetime();
        }
      })();
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
      if (this.streamUsable(bucket[key])) return key;
      if (bucket[key]) await this.stopStoredStream({ group: 'orders', key, reason: 'stale' });

      const endpoint = ['brokerage', 'stream', 'accounts', account, 'orders'];
      if (ordersIds.length > 0) endpoint.push(ordersIds.join(','));

      const onData = (message) => {
        if (message?.StreamStatus === 'EndSnapshot') return;
        if (message?.StreamStatus && !message.OrderID) return;
        const observed = domain.ts.orders.observe({ live: contract.live, account, order: message, stream: true });
        if (observed) {
          void this.handleOrder({ live: contract.live, account, order: observed.order, generation: observed.generation });
        }
      };

      let stream = null;
      const onError = (err) => {
        console.error('Stream orders error:', account, endpoint.join('/'), err);
        const authorization = err?.classification === 'authorization';
        if (err?.permanent || err?.terminal || err?.streamStopped) {
          this.brokerage.ready = false;
          if (!authorization && bucket[key] === stream) delete bucket[key];
        }
        if (authorization) {
          void this.recoverBrokerage({ reason: 'upstream.authorization', authorization: true });
        }
      };
      const onStatus = (status) => {
        if (!stream) return;
        stream.state = status.state;
        console.debug('brokerage order stream', {
          account,
          streamKey: key,
          state: status.state,
          reason: status.reason,
          generation: stream.generation,
          connected: stream.connected,
          brokerageReady: this.brokerage.ready,
        });
        if (status.state === 'active' && status.reason === 'reconnected') {
          void this.reconcileOrders({ live: contract.live, account, reason: status.reason });
        }
        if (status.terminal || ['failed', 'stopped'].includes(status.state)) {
          this.brokerage.ready = false;
          const authorization = status.error?.classification === 'authorization' || status.reason === 'upstream.authorization';
          if (!authorization && bucket[key] === stream) delete bucket[key];
          if (authorization) void this.recoverBrokerage({ reason: status.reason, authorization: true });
        }
      };

      stream = lib.ts.stream({ live: contract.live, endpoint, tokens: this.tokens, onData, onError, onStatus });
      await stream.initiateStream();
      if (this.closed) {
        stream.stopStream('client.close');
        return false;
      }
      stream.state = 'active';
      await this.setStoredStream({ group: 'orders', key, stream });
      void this.reconcileOrders({ live: contract.live, account, reason: 'initial' });
      return key;
    } catch (error) {
      console.error('Error in streamOrders:', contract?.account, error);
      this.brokerage.ready = false;
      if (error?.classification === 'authorization') {
        setTimeout(() => void this.recoverBrokerage({ reason: 'upstream.authorization', authorization: true }), 0);
      }
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
      if (this.streamUsable(bucket[key])) return key;
      if (bucket[key]) await this.stopStoredStream({ group: 'positions', key, reason: 'stale' });

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
      let stream = null;
      const onError = (err) => {
        console.error('Stream positions error:', account, endpoint.join('/'), err);
        const authorization = err?.classification === 'authorization';
        if (err?.permanent || err?.terminal || err?.streamStopped) {
          this.brokerage.ready = false;
          if (!authorization && bucket[key] === stream) delete bucket[key];
        }
        if (authorization) {
          void this.recoverBrokerage({ reason: 'upstream.authorization', authorization: true });
        }
      };
      const onStatus = (status) => {
        if (!stream) return;
        stream.state = status.state;
        if (status.terminal || ['failed', 'stopped'].includes(status.state)) {
          this.brokerage.ready = false;
          const authorization = status.error?.classification === 'authorization' || status.reason === 'upstream.authorization';
          if (!authorization && bucket[key] === stream) delete bucket[key];
          if (authorization) void this.recoverBrokerage({ reason: status.reason, authorization: true });
        }
      };

      stream = lib.ts.stream({ live: contract.live, endpoint, tokens: this.tokens, onData, onError, onStatus });
      await stream.initiateStream();
      if (this.closed) {
        stream.stopStream('client.close');
        return false;
      }
      stream.state = 'active';
      await this.setStoredStream({ group: 'positions', key, stream });
      return key;
    } catch (error) {
      console.error('Error in streamPositions:', contract?.account, error);
      this.brokerage.ready = false;
      if (error?.classification === 'authorization') {
        setTimeout(() => void this.recoverBrokerage({ reason: 'upstream.authorization', authorization: true }), 0);
      }
      return false;
    }
  },

  async streamMatrix({ endpoint, symbol, data, onData, onError, onStatus }) {
    try {
      if (this.closed) throw new Error('TradeStation client is closed');
      const key = this.buildStreamKey({ group: 'matrix', symbol, data });

      const stream = lib.ts.stream({ live: true, ver: 'v2', endpoint, tokens: this.tokens, data, onData, onError, onStatus });
      await stream.initiateStream();
      if (this.closed) {
        stream.stopStream('client.close');
        throw new Error('TradeStation client closed during matrix startup');
      }
      await this.setStoredStream({ group: 'matrix', key, stream });
      return key;
    } catch (error) {
      console.error('Error in stream matrix:', error);
      throw error;
    }
  },

  async streamChains({ endpoint, symbol, data, onData, onError, onStatus }) {
    try {
      const key = this.buildStreamKey({ group: 'chains', symbol, data });
      const retryPolicy = { packetErrors: { failedInternalServerError: { retryable: true, maxRetries: 2 } } };

      const stream = lib.ts.stream({ live: true, endpoint, tokens: this.tokens, data, onData, onError, onStatus, retryPolicy });
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
