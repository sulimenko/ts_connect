({
  access: 'public',
  method: async ({ contracts, symbols = [] }) => {
    const client = await domain.ts.client.getClient({});
    const result = [];
    for (const contract of contracts) {
      contract.live = contract.live === 1 || contract.live === '1' || contract.live === true || contract.live === 'true';
      const endpoint = ['brokerage', 'accounts', contract.account, 'positions'];
      const data = {};
      if (symbols.length > 0) data.symbol = symbols.map((each) => each.toUpperCase()).join(',');

      const responce = await lib.ts.send({ method: 'GET', live: contract.live, endpoint, token: client.tokens.access, data });

      if (responce.Errors.length === 0 && responce.Positions.length > 0) result.push(...responce.Positions);
    }
    return result;
  },
});
