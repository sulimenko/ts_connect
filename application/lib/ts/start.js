async () => {
  if (application.worker.id === 'W1') {
    setTimeout(async () => {
      for (const name of ['ptfin']) {
        const client = await domain.ts.clients.getClient({ name, update: true });
        const contracts = await lib.ptfin.getContract({ accounts: ['all'] });
        for (const contract of contracts) {
          await client.streamOrders({ contract });
          await client.streamPositions({ contract });
          // setTimeout(async () => {
          // console.log(client.streams[contract.account].orders);
          // client.streams[contract.account].orders.scheduleReconnect();
          // }, 20 * 1000);
        }
      }
    }, 1000);
  }
};
