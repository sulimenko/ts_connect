async ({ client, symbols }) => {
  const endpoint = ['marketdata', 'stream', 'quotes', symbols.map((symbol) => symbol.toUpperCase()).join(',')];

  const onData = (data) => console.debug('quotes:', data);
  const onError = (err) => console.error('quotes:', err);
  client.socket.quotes = {
    endpoint,
    stop: await lib.ts.stream.initiateStream({ endpoint, token: client.tokens.access, onData, onError }),
  };

  // process.on('unhandledRejection', (reason) => {
  //   if (reason.name === 'AbortError') {
  //     console.warn('Unhandled Rejection:', reason);
  //     event.preventDefault();
  //   }
  // });

  // setTimeout(() => {
  //   // console.log('try stop', client.socket.quotes.stop.toString());
  //   client.socket.quotes.stop();
  // }, 10000);

  // setTimeout(async () => {
  //   client.socket.quotes = {
  //     endpoint,
  //     stop: await lib.ts.stream.initiateStream({ endpoint, token: client.tokens.access, onData, onError }),
  //   };
  // }, 7000);
  return ['OK'];
};
