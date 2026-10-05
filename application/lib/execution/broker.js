/* eslint-disable camelcase */
async ({ action, data, deadline }) => {
  const { account, live, orderId, intent } = data;
  const result = (state, broker = null) => ({ version: 2, orderId, state, broker });
  const fingerprintOf = () => {
    try {
      return node.crypto.createHash('sha256').update(JSON.stringify(intent)).digest('hex');
    } catch {
      return null;
    }
  };
  let attempt = domain.execution.attempts.get(data);
  // A registered attempt takes precedence over ALL new intent/credential
  // validation. No changed or malformed replay grants another broker POST.
  if (attempt && (attempt.account !== account || attempt.live !== live)) {
    return result(action === 'submit' ? 'ambiguous' : 'source_unavailable');
  }
  if (action === 'submit' && attempt) {
    return fingerprintOf() === attempt.fingerprint ? attempt.result || result('ambiguous') : result('ambiguous');
  }
  const validId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
  const suppliedId = Object.hasOwn(data, 'brokerId');
  if (action === 'lookup' && suppliedId && (!validId(data.brokerId) || (attempt?.brokerId && attempt.brokerId !== data.brokerId))) {
    return result('source_unavailable');
  }
  const brokerId = attempt?.brokerId || data.brokerId;
  if (action === 'lookup' && !validId(brokerId)) return result('source_unavailable');
  const selection = lib.execution.credentialSource({ data });
  if (selection.reason) return result(action === 'submit' ? 'rejected' : 'source_unavailable');
  if (selection.source === 'provisioned') {
    const credentials = data.credentials;
    if (
      !credentials ||
      !['pkey', 'secret', 'refresh_token'].every((name) => typeof credentials[name] === 'string' && credentials[name].trim())
    ) {
      return result(action === 'submit' ? 'rejected' : 'source_unavailable');
    }
  }
  const base = live ? 'https://api.tradestation.com/v3' : 'https://sim-api.tradestation.com/v3';
  let body;
  if (action === 'submit') {
    const quantity = intent?.quantity;
    const category = intent?.assetCategory;
    const types = { market: 'Market', limit: 'Limit', stop: 'StopMarket', stop_limit: 'StopLimit' };
    const tifs = { day: 'DAY', gtc: 'GTC', ioc: 'IOC', fok: 'FOK' };
    const price = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;
    if (
      !intent ||
      !['STK', 'OPT'].includes(category) ||
      typeof intent.symbol !== 'string' ||
      !Number.isSafeInteger(quantity) ||
      quantity === 0 ||
      typeof intent.type !== 'string' ||
      !Object.hasOwn(types, intent.type) ||
      typeof intent.tif !== 'string' ||
      !Object.hasOwn(tifs, intent.tif) ||
      intent.relation !== 'NORMAL' ||
      !Array.isArray(intent.related) ||
      intent.related.length ||
      typeof intent.extended !== 'boolean' ||
      intent.extended ||
      (['limit', 'stop_limit'].includes(intent.type) && !price(intent.limitPrice)) ||
      (['stop', 'stop_limit'].includes(intent.type) && !price(intent.stopPrice)) ||
      (!['limit', 'stop_limit'].includes(intent.type) && intent.limitPrice !== null) ||
      (!['stop', 'stop_limit'].includes(intent.type) && intent.stopPrice !== null)
    ) {
      return result('rejected');
    }
    let symbol;
    try {
      const parsed = lib.utils.makeSymbol(intent.symbol);
      if (parsed?.type !== category) return result('rejected');
      symbol = lib.utils.makeTSSymbol(intent.symbol, category);
    } catch {
      return result('rejected');
    }
    body = {
      AccountID: account,
      Symbol: symbol,
      Quantity: String(Math.abs(quantity)),
      OrderType: types[intent.type],
      TimeInForce: { Duration: tifs[intent.tif] },
      OrderConfirmID: `meta-${orderId}`,
    };
    if (['limit', 'stop_limit'].includes(intent.type)) body.LimitPrice = String(intent.limitPrice);
    if (['stop', 'stop_limit'].includes(intent.type)) body.StopPrice = String(intent.stopPrice);
    const fingerprint = fingerprintOf();
    if (!fingerprint) return result('rejected');
    const claim = domain.execution.attempts.claim(data, fingerprint);
    if (claim.conflict) return result('ambiguous');
    attempt = claim.attempt;
    if (!claim.owner) return attempt.result || result('ambiguous');
  }
  let accessUpdate;
  let submitting = false;
  const finish = (response) => {
    // Keep only non-secret receipts in the domain registry. Rotation belongs
    // exclusively to the authenticated response of this invocation.
    if (action === 'submit') attempt.result = response;
    return accessUpdate ? { ...response, accessUpdate } : response;
  };
  const parse = (kind, response) => lib.execution.protocol({ kind, response, account, brokerId });
  try {
    const authorization = await lib.execution.authorization({ data, source: selection.source, deadline });
    if (authorization.reason) return finish(result(action === 'submit' ? 'rejected' : 'source_unavailable'));
    accessUpdate = authorization.accessUpdate;
    const { request } = authorization;
    const headers = { 'Content-Type': 'application/json' };
    if (action === 'submit') {
      const accounts = await request({ url: `${base}/brokerage/accounts`, headers });
      if (!parse('accounts', accounts)) return finish(result('rejected'));
      const positions = await request({ url: `${base}/brokerage/accounts/${account}/positions`, headers });
      const snapshot = parse('positions', positions);
      if (!snapshot) return finish(result('rejected'));
      const matching = snapshot.positions.filter((row) => row.symbol === body.Symbol);
      const current = matching.reduce((sum, row) => sum + row.quantity, 0);
      if (
        !Number.isFinite(current) ||
        !Number.isFinite(current + intent.quantity) ||
        (matching.some((row) => row.quantity > 0) && matching.some((row) => row.quantity < 0)) ||
        (current !== 0 && current * (current + intent.quantity) < 0)
      ) {
        return finish(result('rejected'));
      }
      body.TradeAction = lib.utils.getAction({ type: intent.assetCategory }, intent.quantity, current).toUpperCase();
      if (Date.now() >= deadline) return finish(result('rejected'));
      submitting = true;
      const placed = await request({ url: `${base}/orderexecution/orders`, headers, method: 'POST', data: body });
      if (!placed.started) return finish(result('rejected'));
      if (Date.now() >= deadline) return finish(result('ambiguous'));
      const broker = parse('placed', placed);
      if (!broker) return finish(result('ambiguous'));
      attempt.brokerId = broker.terminal_id;
      return finish(result('acknowledged', broker));
    }
    const current = await request({ url: `${base}/brokerage/accounts/${account}/orders/${brokerId}`, headers });
    const parsed = parse('orders', current);
    if (!parsed) return finish(result('source_unavailable'));
    if (parsed.broker) return finish(result('found', parsed.broker));
    const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const historical = await request({
      url: `${base}/brokerage/accounts/${account}/historicalorders/${brokerId}?since=${since}`,
      headers,
    });
    const history = parse('orders', historical);
    // Empty current/history arrays do not prove absence: history is bounded
    // to 90 days. Never convert an inconclusive response into not_found.
    return finish(history?.broker ? result('found', history.broker) : result('source_unavailable'));
  } catch {
    if (action === 'submit') return finish(result(submitting ? 'ambiguous' : 'rejected'));
    return finish(result('source_unavailable'));
  }
};
