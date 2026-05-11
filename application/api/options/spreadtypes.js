({
  access: 'public',
  returns: 'json',
  method: async () => {
    const endpoint = ['marketdata', 'options', 'spreadtypes'];
    const client = await domain.ts.clients.getClient({});
    const response = await lib.ts.send({ method: 'GET', live: true, endpoint, token: client.tokens.access });
    if (Array.isArray(response?.SpreadTypes)) return response.SpreadTypes;
    if (Array.isArray(response?.spreadTypes)) return response.spreadTypes;
    return [];
  },
});
