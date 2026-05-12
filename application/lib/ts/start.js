async () => {
  if (application.worker.id !== 'W1') return;

  const name = 'ptfin';
  setTimeout(() => {
    void (async () => {
      try {
        console.info('TS prewarm start:', name);
        const client = await domain.ts.clients.getClient({ name });
        if (!client) {
          console.warn('TS prewarm skipped: client unavailable', name);
          return;
        }
        console.info('TS prewarm done:', name);
      } catch (error) {
        console.warn('TS prewarm failed:', name, error);
      }
    })();
  }, 1000);

  // setTimeout(async () => {
  // for (const name of ['ptfin']) {
  // api.marketdata.streamBarchart({ symbol: 'TSLA', period: 900, limit: 10 });
  // api.marketdata.streamMatrix({ symbol: 'TSLA' });
  // api.marketdata.streamMatrix({ symbol: 'AAPL' });
  // api.marketdata.streamMatrix({ symbol: 'NFLX' });
  // api.marketdata.streamMatrix({ symbol: 'COIN 251003P307.5' });
  // const client = await domain.ts.clients.getClient({ name, update: true });
  // const contracts = await lib.ptfin.getContract({ accounts: ['all'] });
  // for (const contract of contracts) {
  // await client.streamOrders({ contract });
  // await client.streamPositions({ contract });
  // setTimeout(async () => {
  //   if (contract.account === '11827414') {
  //   }
  //   // console.log(client.streams[contract.account].orders);
  //   // client.streams[contract.account].orders.scheduleReconnect();
  // }, 2 * 1000);
  // }
  // }
  // }, 1000);
};
