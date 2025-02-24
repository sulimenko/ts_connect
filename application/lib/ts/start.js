async () => {
  if (application.worker.id === 'W1') {
    setTimeout(async () => {
      for (const name of ['ptfin']) {
        const client = await domain.ts.client.getClient({ name, update: true });

        const contracts = await lib.ptfin.getContract({ accounts: ['all'] });
        console.log('contracts:', contracts);
        for (const contract of contracts) {
          client.streamOrders({ contract });
          client.streamPositions({ contract });
        }

        // client.streamOrders({ contract });
        // client.streamPositions({ contract });

        // lib.stream.barscharts({ client, symbol: 'BTCUSD', period: 3600, limit: 5 });
        // lib.stream.barsticks({ client, symbol: 'BTCUSD', period: 3600, limit: 5 });
        // lib.stream.quotes({ client, symbols: ['BTCUSD'] });
      }
    }, 1000);

    // console.debug(process.env);

    // setTimeout(async () => {
    // const data = await api.account.accounts({ account: '11827414' });
    // const data = await api.account.balances({ accounts: ['11827414'] });
    // const data = await api.account.bodbalances({ accounts: ['11827414'] });
    // const data = await api.account.positions({ accounts: ['11827414'] });
    // const data = await api.marketdata.barcharts({ symbol: 'TSLA', period: 86400, limit: 5 });
    // const data = await api.marketdata.quotes({ symbols: ['TSLA', 'LI'] });
    // const data = await api.orderexecution.routes();
    // const data = await api.options.strikes({ symbol: 'LI' });
    // const data = await api.symbols.find('LI');
    // const data = await api.symbols.param({ N: 'LI' });
    // console.log(JSON.stringify(data));
    // }, 5000);
  }
};
