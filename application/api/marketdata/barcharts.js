({
  access: 'public',
  method: async ({ symbol, period = 3600, limit = 1000 }) => {
    const endpoint = ['marketdata', 'barcharts', symbol.toUpperCase()];
    let interval = '1';
    let unit = 'Minute';
    if (period < 86400) interval = (period / 60).toString();
    else if (period === 86400) unit = 'Daily';
    else if (period === 604800) unit = 'Weekly';
    else if (period > 604800) unit = 'Monthly';

    const data = {
      interval, // string 1 to 1440 minute
      unit, // string 'Minute, Daily, Weekly, Monthly'
      barsback: limit.toString(), // string 1 to 57600
      // firstdate, // The first date formatted as `YYYY-MM-DD`,`2020-04-20T18:00:00Z`. This parameter is mutually exclusive with barsback
      // lastdate, // The last date formatted as `YYYY-MM-DD`,`2020-04-20T18:00:00Z`. This parameter is mutually exclusive with barsback
      sessiontemplate: 'USEQ24Hour', // `USEQPre`, `USEQPost`, `USEQPreAndPost`, `USEQ24Hour`,`Default`.
    };

    const client = await domain.ts.clients.getClient({});

    return lib.ts.send({ method: 'GET', endpoint, token: client.tokens.access, data });
  },
});
