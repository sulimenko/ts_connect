async ({ name }) => {
  return {
    key: { pkey: null, secret: null },
    tokens: { id: null, access: null, expires: null, refresh: null },
    timers: { rtoken: null },
    streams: {},

    lifetime: function () {
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
    streamOrders: async function ({ contract, ordersIds = [] }) {
      try {
        if (this.streams[contract.account] === undefined) this.streams[contract.account] = {};

        const endpoint = ['brokerage', 'stream', 'accounts', contract.account, 'orders'];
        if (ordersIds.length > 0) endpoint.push(ordersIds.join(','));

        const onData = (message) => {
          console.debug('orders:', message);
          lib.ptfin.send({ method: 'POST', endpoint: ['response'], data: { type: 'order', data: message } });
        };

        const onError = (err) => console.error('Stream orders error:', err);

        const stream = lib.ts.stream({ live: contract.live, endpoint, tokens: this.tokens, onData, onError });
        await stream.initiateStream();
        this.streams[contract.account].orders = stream;
      } catch (error) {
        console.error('Error in streamOrders:', error);
      }
    },
    streamPositions: async function ({ contract }) {
      try {
        if (this.streams[contract.account] === undefined) this.streams[contract.account] = {};
        const endpoint = ['brokerage', 'stream', 'accounts', contract.account, 'positions'];

        const onData = (message) => {
          try {
            if (!message.StreamStatus) {
              // console.info('streamPositions', message.AccountID, message.Symbol, ':', message.Quantity, message.AveragePrice);
              domain.ts.positions.setPosition({ account: message.AccountID, symbol: message.Symbol, data: message });
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
  };
};
