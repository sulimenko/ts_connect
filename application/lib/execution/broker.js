/* eslint-disable camelcase */
async ({ action, data }) => {
  const { account, live, orderId, credentials, intent } = data;
  const result = (state, broker = null) => ({ version: 2, orderId, state, broker });
  if (typeof credentials.refresh_token !== 'string' || !credentials.refresh_token.trim()) {
    return result(action === 'submit' ? 'rejected' : 'source_unavailable');
  }
  const base = live ? 'https://api.tradestation.com/v3' : 'https://sim-api.tradestation.com/v3';
  const brokerOf = (row) => {
    const states = {
      ACK: 'accepted',
      OPN: 'pending',
      FPR: 'part_filled',
      FLL: 'filled',
      OUT: 'cancelled',
      REJ: 'rejected',
      EXP: 'expired',
    };
    const id = row?.OrderID;
    const state = states[row?.Status];
    return typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id) && state ? { terminal_id: id, state } : null;
  };
  let attempt = domain.execution.attempts.get(data);
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
      !Object.hasOwn(types, intent.type) ||
      !Object.hasOwn(tifs, intent.tif) ||
      intent.relation !== 'NORMAL' ||
      !Array.isArray(intent.related) ||
      intent.related.length ||
      intent.extended ||
      (['limit', 'stop_limit'].includes(intent.type) && !price(intent.limitPrice)) ||
      (['stop', 'stop_limit'].includes(intent.type) && !price(intent.stopPrice))
    ) {
      return result('rejected');
    }
    let symbol;
    try {
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
      OrderConfirmId: `meta-${orderId}`,
    };
    if (['limit', 'stop_limit'].includes(intent.type)) body.LimitPrice = String(intent.limitPrice);
    if (['stop', 'stop_limit'].includes(intent.type)) body.StopPrice = String(intent.stopPrice);
    const fingerprint = node.crypto.createHash('sha256').update(JSON.stringify(intent)).digest('hex');
    const claim = domain.execution.attempts.claim(data, fingerprint);
    if (claim.conflict) return result('ambiguous');
    attempt = claim.attempt;
    if (!claim.owner) return attempt.result || result('ambiguous');
  }
  // An unknown broker identity is never looked up by order similarity or
  // treated as not_found. Meta keeps its permanent barrier and reservation.
  const brokerId = attempt?.brokerId || data.brokerId;
  if (action === 'lookup' && (typeof brokerId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(brokerId))) {
    return result('source_unavailable');
  }
  let response;
  let accessUpdate;
  try {
    const tokenResponse = await lib.execution.request({
      url: 'https://signin.tradestation.com/oauth/token',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: null,
      // This request uses the separate form transport; it never reaches Back.
      form: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: credentials.pkey,
        client_secret: credentials.secret,
        refresh_token: credentials.refresh_token,
      }).toString(),
    });
    if (tokenResponse.status !== 200 || typeof tokenResponse.body?.access_token !== 'string') return result('source_unavailable');
    if (typeof tokenResponse.body.refresh_token === 'string' && tokenResponse.body.refresh_token !== credentials.refresh_token) {
      accessUpdate = { refresh_token: tokenResponse.body.refresh_token };
    }
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenResponse.body.access_token}` };
    if (action === 'submit') {
      const accounts = await lib.execution.request({ url: `${base}/brokerage/accounts`, headers });
      if (
        accounts.status !== 200 ||
        !Array.isArray(accounts.body?.Accounts) ||
        accounts.body?.Errors?.length ||
        !accounts.body.Accounts.some((row) => row.AccountID === account)
      ) {
        attempt.result = result('rejected');
        return Object.assign({}, attempt.result, accessUpdate ? { accessUpdate } : {});
      }
      // Resolve open/close intent using this account's native, authoritative
      // positions. No global quote client credentials and no Back query.
      const positions = await lib.execution.request({ url: `${base}/brokerage/accounts/${account}/positions`, headers });
      if (positions.status !== 200 || !Array.isArray(positions.body?.Positions) || positions.body.Errors?.length) {
        response = result('rejected'); // no broker submit has occurred
      } else {
        const matching = positions.body.Positions.filter((row) => row.AccountID === account && row.Symbol === body.Symbol);
        const current = matching.reduce((sum, row) => sum + Number(row.Quantity), 0);
        if (!Number.isFinite(current) || (current !== 0 && current * (current + intent.quantity) < 0)) {
          response = result('rejected');
        } else {
          body.TradeAction = lib.utils.getAction({ type: intent.assetCategory }, intent.quantity, current).toUpperCase();
          const placed = await lib.execution.request({ url: `${base}/orderexecution/orders`, headers, method: 'POST', data: body });
          const orders = placed.body?.Orders;
          const row = Array.isArray(orders) && orders.length === 1 ? orders[0] : null;
          if (placed.status === 200 && row && !row.Error && typeof row.OrderID === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(row.OrderID)) {
            attempt.brokerId = row.OrderID;
            response = result('acknowledged', { terminal_id: row.OrderID, state: 'pending' });
          } else {
            response = result('ambiguous');
          }
        }
      }
      attempt.result = response;
    } else {
      const found = await lib.execution.request({
        url: `${base}/brokerage/accounts/${account}/orders/${brokerId}`,
        headers,
      });
      const rows = found.body?.Orders;
      const matching = Array.isArray(rows) ? rows.filter((row) => row.AccountID === account && row.OrderID === brokerId) : [];
      const broker = matching.length === 1 ? brokerOf(matching[0]) : null;
      response = found.status === 200 && !found.body?.Errors?.length && broker ? result('found', broker) : result('source_unavailable');
    }
  } catch {
    response = result(action === 'submit' ? 'ambiguous' : 'source_unavailable');
  }
  return Object.assign({}, response, accessUpdate ? { accessUpdate } : {});
};
