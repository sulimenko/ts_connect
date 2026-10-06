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
  const suppliedIds = Object.hasOwn(data, 'brokerIds');
  const groupRelation = attempt?.relation || data.relation;
  const groupLookup = action === 'lookup' && (suppliedIds || Boolean(attempt?.relation));
  const knownIds = attempt?.brokerIds || [];
  const validIds = (ids) =>
    Array.isArray(ids) && ids.length > 0 && ids.length <= 50 && ids.every(validId) && new Set(ids).size === ids.length;
  if (
    groupLookup &&
    ((attempt && !attempt.relation) ||
      !['BRK', 'OCO'].includes(groupRelation) ||
      Object.hasOwn(data, 'brokerId') ||
      (Object.hasOwn(data, 'relation') && data.relation !== groupRelation) ||
      (suppliedIds &&
        (!validIds(data.brokerIds) ||
          (knownIds.length > 0 && (data.brokerIds.length !== knownIds.length || !data.brokerIds.every((id) => knownIds.includes(id)))))))
  ) {
    return result('source_unavailable');
  }
  const brokerIds = knownIds.length ? knownIds : data.brokerIds;
  if (groupLookup && !validIds(brokerIds)) return result('source_unavailable');
  const suppliedId = Object.hasOwn(data, 'brokerId');
  if (action === 'lookup' && suppliedId && (!validId(data.brokerId) || (attempt?.brokerId && attempt.brokerId !== data.brokerId))) {
    return result('source_unavailable');
  }
  const brokerId = attempt?.brokerId || data.brokerId;
  if (action === 'lookup' && !groupLookup && !validId(brokerId)) return result('source_unavailable');
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
  let group;
  if (action === 'submit') {
    group = ['BRK', 'OCO'].includes(intent?.relation) ? lib.execution.relation({ data }) : null;
    if (['BRK', 'OCO'].includes(intent?.relation) && !group) return result('rejected');
    if (!group) {
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
        (intent.extended && (intent.type !== 'limit' || intent.tif !== 'gtc')) ||
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
        TimeInForce: { Duration: intent.extended ? 'GCP' : tifs[intent.tif] },
        OrderConfirmID: `meta-${orderId}`,
      };
      if (['limit', 'stop_limit'].includes(intent.type)) body.LimitPrice = String(intent.limitPrice);
      if (['stop', 'stop_limit'].includes(intent.type)) body.StopPrice = String(intent.stopPrice);
    } else {
      body = group.body;
    }
    const fingerprint = fingerprintOf();
    if (!fingerprint) return result('rejected');
    const claim = domain.execution.attempts.claim(data, fingerprint);
    if (claim.conflict) return result('ambiguous');
    attempt = claim.attempt;
    if (!claim.owner) return attempt.result || result('ambiguous');
    if (group) {
      attempt.relation = group.relation;
      attempt.orders = group.orders;
    }
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
      const matching = snapshot.positions.filter((row) => row.symbol === (group ? group.orders[0].Symbol : body.Symbol));
      const current = matching.reduce((sum, row) => sum + row.quantity, 0);
      if (
        !Number.isFinite(current) ||
        !Number.isFinite(current + intent.quantity) ||
        (matching.some((row) => row.quantity > 0) && matching.some((row) => row.quantity < 0)) ||
        (current !== 0 && current * (current + intent.quantity) < 0)
      ) {
        return finish(result('rejected'));
      }
      if (group) {
        if (
          (group.relation === 'BRK' && current !== 0) ||
          (group.relation === 'OCO' && (current <= 0 || Math.abs(intent.quantity) > current))
        ) {
          return finish(result('rejected'));
        }
        const details = await request({ url: `${base}/marketdata/symbols/${encodeURIComponent(group.orders[0].Symbol)}`, headers });
        const routes = await request({ url: `${base}/orderexecution/routes`, headers });
        const proof = lib.execution.rulesProof({
          data: {
            ...data,
            instrument: { symbol: intent.symbol, assetCategory: 'STK', exchange: details.body?.Symbols?.[0]?.Exchange, currency: 'USD' },
          },
          symbol: group.orders[0].Symbol,
          accounts,
          details,
          routes,
        });
        if (proof.state !== 'ready') return finish(result('rejected'));
        const quantity = BigInt(Math.abs(intent.quantity));
        if (quantity < BigInt(proof.quantity.minimum) || quantity % BigInt(proof.quantity.step) !== 0n) return finish(result('rejected'));
      } else {
        body.TradeAction = lib.utils.getAction({ type: intent.assetCategory }, intent.quantity, current).toUpperCase();
      }
      if (Date.now() >= deadline) return finish(result('rejected'));
      submitting = true;
      const placed = await request({ url: `${base}/orderexecution/${group?.endpoint || 'orders'}`, headers, method: 'POST', data: body });
      if (!placed.started) return finish(result('rejected'));
      if (group) {
        const placement = lib.execution.groupEvidence({ kind: 'placed', response: placed, account, expected: group.orders });
        attempt.brokerIds = placement.ids;
        if (!placement.ids.length) return finish(result('ambiguous'));
        let broker = { relation: group.relation, mapping: placement.mapping, orders: placement.orders };
        if (
          placement.valid &&
          Date.now() < deadline &&
          (placement.mapping !== 'verified' || placement.orders.some((order) => order.state === 'unknown'))
        ) {
          const lookup = await lib.execution.groupLookup({
            request,
            base,
            account,
            headers,
            brokerIds: placement.ids,
            relation: group.relation,
            expected: group.orders,
          });
          broker = lookup.broker;
        }
        const acknowledged =
          placement.valid &&
          Date.now() < deadline &&
          broker.mapping === 'verified' &&
          broker.orders.every((order) => ['accepted', 'pending', 'part_filled', 'filled'].includes(order.state));
        return finish(result(acknowledged ? 'acknowledged' : 'ambiguous', broker));
      }
      if (Date.now() >= deadline) return finish(result('ambiguous'));
      const broker = parse('placed', placed);
      if (!broker) return finish(result('ambiguous'));
      attempt.brokerId = broker.terminal_id;
      return finish(result('acknowledged', broker));
    }
    if (groupLookup) {
      const lookup = await lib.execution.groupLookup({
        request,
        base,
        account,
        headers,
        brokerIds,
        relation: groupRelation,
        expected: attempt?.orders || [],
      });
      return finish(result(lookup.complete ? 'found' : 'source_unavailable', lookup.broker));
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
    if (action === 'submit') {
      const broker =
        group && attempt.brokerIds.length
          ? {
              relation: group.relation,
              mapping: 'ambiguous',
              orders: attempt.brokerIds.map((id) => ({ terminal_id: id, state: 'unknown' })),
            }
          : null;
      return finish(result(submitting ? 'ambiguous' : 'rejected', broker));
    }
    return finish(result('source_unavailable'));
  }
};
