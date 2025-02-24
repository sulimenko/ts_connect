({
  access: 'public',
  method: async ({ name = null, live = true }) => {
    live = live === 'true' || live === 1 || live === '1' || live === true;

    console.log(name, live);
    const endpoint = ['brokerage', 'accounts'];
    const client = await domain.ts.client.getClient({ name });

    return lib.ts.send({ method: 'GET', live, endpoint, token: client.tokens.access });
  },
});
