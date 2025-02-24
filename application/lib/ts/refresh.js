async ({ client }) => {
  const method = 'POST';
  const domain = 'https://signin.tradestation.com';
  const endpoint = ['oauth', 'token'];
  const type = 'application/x-www-form-urlencoded';
  const data = {
    grant_type: 'refresh_token',
    client_id: client.key.pkey,
    client_secret: client.key.secret,
    refresh_token: client.tokens.refresh,
  };

  // return lib.ts.send({ method, domain, endpoint, type, data });
  const tokens = await lib.ts.send({ method, domain, endpoint, type, data });
  if (tokens.id_token) client.tokens.id = tokens.id_token;
  if (tokens.access_token) client.tokens.access = tokens.access_token;
  if (tokens.expires_in) client.tokens.expires = new Date(new Date().getTime() + parseInt(tokens.expires_in) * 1000);

  return ['OK'];
};
