({
  access: 'public',
  method: async ({ contracts }) => {
    const client = await domain.ts.clients.getClient({});
    const result = [];
    for (const contract of contracts) {
      contract.live = contract.live === 1 || contract.live === '1' || contract.live === true || contract.live === 'true';
      const endpoint = ['brokerage', 'accounts', contract.account, 'balances'];

      const responce = await lib.ts.send({ method: 'GET', live: contract.live, endpoint, token: client.tokens.access });
      
      if (responce.Errors.length === 0 && responce.Balances.length > 0) result.push(...responce.Balances);
    }
    return result;
  },
});
