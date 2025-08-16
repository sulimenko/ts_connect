({
  access: 'public',
  method: async () => {
    const terminal = await api.account.positions({
      contracts: [
        { account: '11827414', live: true },
        { account: '11957784', live: true },
        { account: 'SIM2811593M', live: false },
      ],
    });
    return terminal;
  },
});
