async ({ data, deadline }) => {
  const fail = (reason, state = 'unavailable') => ({ version: 1, state, reason });
  const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const text = (value) => typeof value === 'string' && value.trim() !== '' && value === value.trim() && value.length <= 128;
  const instrument = data?.instrument;
  if (
    !object(data) ||
    data.version !== 1 ||
    typeof data.account !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(data.account) ||
    typeof data.live !== 'boolean' ||
    !object(instrument) ||
    !['symbol', 'assetCategory', 'exchange'].every((key) => text(instrument[key])) ||
    !(instrument.currency === null || (typeof instrument.currency === 'string' && /^[A-Z]{3}$/.test(instrument.currency)))
  ) {
    return fail('invalid_request');
  }
  const selection = lib.execution.credentialSource({ data });
  if (selection.reason) return fail(selection.reason);
  if (selection.source === 'provisioned') {
    const credentials = data.credentials;
    if (
      !object(credentials) ||
      !['pkey', 'secret', 'refresh_token'].every((key) => typeof credentials[key] === 'string' && credentials[key].trim())
    ) {
      return fail('invalid_request');
    }
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
  const base = data.live ? 'https://api.tradestation.com/v3' : 'https://sim-api.tradestation.com/v3';
  try {
    const authorization = await lib.execution.authorization({ data, source: selection.source, deadline });
    if (authorization.reason) return fail(authorization.reason);
    accessUpdate = authorization.accessUpdate;
    const { request } = authorization;
    const accounts = await request({ url: `${base}/brokerage/accounts` });
    if (!lib.execution.protocol({ kind: 'accounts', response: accounts, account: data.account })) {
      return finish(fail('account_unconfirmed'));
    }
    const details = await request({ url: `${base}/marketdata/symbols/${encodeURIComponent(symbol)}` });
    const routes = await request({ url: `${base}/orderexecution/routes` });
    const response = lib.execution.rulesProof({ data, symbol, accounts, details, routes });
    if (Date.now() >= deadline) return finish(fail('source_unavailable'));
    return finish(response);
  } catch {
    return finish(fail('source_unavailable'));
  }
};
