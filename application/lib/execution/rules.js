/* eslint-disable camelcase */
async ({ data, deadline }) => {
  const fail = (reason, state = 'unavailable') => ({ version: 1, state, reason });
  const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const text = (value) => typeof value === 'string' && value.trim() !== '' && value === value.trim() && value.length <= 128;
  const instrument = data?.instrument;
  const credentials = data?.credentials;
  if (
    !object(data) ||
    data.version !== 1 ||
    typeof data.account !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(data.account) ||
    typeof data.live !== 'boolean' ||
    !object(instrument) ||
    !['symbol', 'assetCategory', 'exchange'].every((key) => text(instrument[key])) ||
    !(instrument.currency === null || (typeof instrument.currency === 'string' && /^[A-Z]{3}$/.test(instrument.currency))) ||
    !object(credentials) ||
    !['pkey', 'secret', 'refresh_token'].every((key) => typeof credentials[key] === 'string' && credentials[key].trim())
  ) {
    return fail('invalid_request');
  }
  if (!['STK', 'OPT'].includes(instrument.assetCategory)) return fail('execution_domain', 'unsupported');
  let symbol;
  try {
    const parsed = lib.utils.makeSymbol(instrument.symbol);
    if (parsed?.type !== instrument.assetCategory || parsed.symbol !== instrument.symbol) return fail('invalid_request');
    symbol = lib.utils.makeTSSymbol(instrument.symbol, instrument.assetCategory);
  } catch {
    return fail('invalid_request');
  }
  let accessUpdate;
  const finish = (response) => (accessUpdate ? { ...response, accessUpdate } : response);
  const request = (options) => lib.execution.request({ ...options, deadline });
  const base = data.live ? 'https://api.tradestation.com/v3' : 'https://sim-api.tradestation.com/v3';
  try {
    const oauth = await request({
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
    const token = oauth.body;
    if (
      oauth.status !== 200 ||
      !object(token) ||
      typeof token.access_token !== 'string' ||
      !token.access_token.trim() ||
      ['error', 'Error', 'Errors', 'error_description'].some((key) => Object.hasOwn(token, key)) ||
      (Object.hasOwn(token, 'refresh_token') && (typeof token.refresh_token !== 'string' || !token.refresh_token.trim()))
    ) {
      return fail('source_unavailable');
    }
    if (typeof token.refresh_token === 'string' && token.refresh_token !== credentials.refresh_token) {
      accessUpdate = { refresh_token: token.refresh_token };
    }
    const headers = { Authorization: `Bearer ${token.access_token}` };
    const accounts = await request({ url: `${base}/brokerage/accounts`, headers });
    if (!lib.execution.protocol({ kind: 'accounts', response: accounts, account: data.account })) {
      return finish(fail('account_unconfirmed'));
    }
    const details = await request({ url: `${base}/marketdata/symbols/${encodeURIComponent(symbol)}`, headers });
    const routes = await request({ url: `${base}/orderexecution/routes`, headers });
    const response = lib.execution.rulesProof({ data, symbol, accounts, details, routes });
    if (Date.now() >= deadline) return finish(fail('source_unavailable'));
    return finish(response);
  } catch {
    return finish(fail('source_unavailable'));
  }
};
