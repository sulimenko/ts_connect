async ({ name }) => {
  return {
    key: { pkey: null, secret: null },
    tokens: { id: null, access: null, expires: null, refresh: null },
    timers: { rtoken: null },
    streams: {},

    lifetime: function () {
      clearTimeout(this.timers.rtoken);
      this.timers.rtoken = setTimeout(() => {
        // console.log(this.tokens.expires, new Date(new Date().getTime() + 2 * 60 * 1000));
        // if (this.tokens.expires < new Date(new Date().getTime() + 19 * 60 * 1000)) lib.ts.refresh({ client: this });
        if (this.tokens.expires < new Date(new Date().getTime() + 2 * 60 * 1000)) lib.ts.refresh({ client: this });
        this.lifetime();
      }, 60 * 1000);
    },
    streamOrders: async function ({ contract, ordersIds = [] }) {
      if (this.streams[contract.account] === undefined) this.streams[contract.account] = {};

      const endpoint = ['brokerage', 'stream', 'accounts', contract.account, 'orders'];
      if (ordersIds.length > 0) endpoint.push(ordersIds.join(','));

      const onData = (message) => {
        console.debug('orders:', message);
        lib.ptfin.send({ method: 'POST', endpoint: ['response'], data: { type: 'order', data: message } });
      };
      const onError = (err) => console.error('orders:', err);

      const stream = lib.ts.stream({ live: contract.live, endpoint, tokens: this.tokens, onData, onError });
      await stream.initiateStream();
      this.streams[contract.account].orders = stream;
    },
    streamPositions: async function ({ contract }) {
      if (this.streams[contract.account] === undefined) this.streams[contract.account] = {};
      const endpoint = ['brokerage', 'stream', 'accounts', contract.account, 'positions'];

      const onData = (message) => {
        // console.debug('positions:', message);
        if (message.StreamStatus === undefined) {
          const position = domain.ts.positions.setPosition({ account: message.AccountID, symbol: message.Symbol, data: message });
        }
      };
      const onError = (err) => console.error('positions:', err);

      const stream = lib.ts.stream({ live: contract.live, endpoint, tokens: this.tokens, onData, onError });
      await stream.initiateStream();
      this.streams[contract.account].positions = stream;
    },
  };
};
