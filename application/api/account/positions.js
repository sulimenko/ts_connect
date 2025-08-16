({
  access: 'public',
  method: async ({ contracts }) => {
    const client = await domain.ts.clients.getClient({});
    const result = [];
    for (const contract of contracts) {
      contract.live = contract.live === 1 || contract.live === '1' || contract.live === true || contract.live === 'true';
      const endpoint = ['brokerage', 'accounts', contract.account, 'positions'];
      const data = {};
      // if (symbols.length > 0) data.symbol = symbols.map((each) => each.toUpperCase()).join(',');

      const responce = await lib.ts.send({ method: 'GET', live: contract.live, endpoint, token: client.tokens.access, data });
      if (responce.Errors.length === 0) {
        const exist = domain.ts.positions.getAccount({ account: contract.account });
        for (const symbol of exist.keys()) {
          const internal = exist.get(symbol);
          const external =
            responce.Positions?.find((each) => {
              return each.AccountID === internal.get('AccountID') && each.Symbol === internal.get('Symbol');
            }) || {};
          try {
            // console.info('positions', symbol, 'internal', internal.get('Quantity'), '=', external.Quantity ?? 'empty', 'external');
            if (parseFloat(internal.get('Quantity') ?? 0) !== parseFloat(external.Quantity ?? 0)) {
              console.error('positions', symbol, 'internal', internal.get('Quantity'), '=', external.Quantity ?? 'empty', 'external');
            }
          } catch (e) {
            console.error(symbol, internal, external, e);
          }
        }

        domain.ts.positions.clearAccount({ account: contract.account });
        if (responce.Positions.length > 0) {
          for (const position of responce.Positions) {
            domain.ts.positions.setPosition({ account: position.AccountID, symbol: position.Symbol, data: position });
            result.push(position);
          }
          // result.push(...responce.Positions);
        }
      }
    }
    return result;
  },
});
