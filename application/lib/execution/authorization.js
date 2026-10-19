/* eslint-disable camelcase */
async ({ data, source, deadline }) => {
  const unavailable = () => ({ reason: 'source_unavailable' });
  const transport = (options) => lib.execution.request({ ...options, deadline });
  if (source === 'provisioned') {
    const credentials = data.credentials;
    const response = await transport({
      url: 'https://signin.tradestation.com/oauth/token',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      form: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: credentials.pkey,
        client_secret: credentials.secret,
        refresh_token: credentials.refresh_token,
      }).toString(),
    });
    const token = response.body;
    if (
      response.status !== 200 ||
      !token ||
      typeof token !== 'object' ||
      Array.isArray(token) ||
      typeof token.access_token !== 'string' ||
      !token.access_token.trim() ||
      ['error', 'Error', 'Errors', 'error_description'].some((key) => Object.hasOwn(token, key)) ||
      (Object.hasOwn(token, 'refresh_token') && (typeof token.refresh_token !== 'string' || !token.refresh_token.trim()))
    ) {
      return unavailable();
    }
    const accessUpdate =
      typeof token.refresh_token === 'string' && token.refresh_token !== credentials.refresh_token
        ? { refresh_token: token.refresh_token }
        : undefined;
    return {
      accessUpdate,
      request: (options) => transport({ ...options, headers: { ...options.headers, Authorization: `Bearer ${token.access_token}` } }),
    };
  }

  const active = () => Number.isFinite(deadline) && Date.now() < deadline;
  // Timeout only this waiter. The registry/lifecycle still owns shared work.
  const wait = async (start) => {
    if (!active()) throw new Error('Execution unavailable');
    let timer;
    try {
      return await Promise.race([
        start(),
        new Promise((resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Execution unavailable')), deadline - Date.now());
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const client = await wait(() => domain.ts.clients.getClient({ name: 'ptfin', sync: false }));
  const confirmed = () => client?.brokerage?.accounts?.get(data.account)?.live === data.live;
  if (!active() || !client || client.closed) return unavailable();
  if (!confirmed()) return { reason: 'account_unconfirmed' };
  const usable = () =>
    typeof client.tokens?.access === 'string' &&
    client.tokens.access.trim() !== '' &&
    Number.isFinite(Number(client.tokens.expires)) &&
    Number(client.tokens.expires) > Date.now();
  const prepare = async () => {
    if (!active() || client.closed || !confirmed()) throw new Error('Execution unavailable');
    if (client.tokenRefresh || !usable()) {
      const refreshed = await wait(() => client.refreshAccessToken({ reason: 'execution' }));
      if (refreshed === false) throw new Error('Execution unavailable');
    }
    if (!active() || client.closed || !confirmed() || !usable()) throw new Error('Execution unavailable');
  };
  await prepare();
  return {
    request: async (options) => {
      try {
        await prepare();
        if (!active() || client.closed || !confirmed() || !usable()) throw new Error('Execution unavailable');
      } catch {
        if (options.method === 'POST') return { status: 0, body: null, started: false };
        throw new Error('Execution unavailable');
      }
      // Re-read after a shared refresh; never retain a stale Authorization.
      return transport({ ...options, headers: { ...options.headers, Authorization: `Bearer ${client.tokens.access}` } });
    },
  };
};
