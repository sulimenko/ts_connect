/* eslint-disable camelcase */
async ({ request, base, account, headers, brokerIds, relation, expected = [] }) => {
  const parse = (response) => lib.execution.groupEvidence({ kind: 'orders', response, account, brokerIds, expected });
  const current = parse(await request({ url: `${base}/brokerage/accounts/${account}/orders/${brokerIds.join(',')}`, headers }));
  const evidence = new Map(current.orders.map((order) => [order.terminal_id, order]));
  let rows = current.rows;
  let valid = current.valid;
  const missing = brokerIds.filter((id) => !evidence.has(id));
  if (valid && missing.length) {
    const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const history = lib.execution.groupEvidence({
      kind: 'orders',
      response: await request({
        url: `${base}/brokerage/accounts/${account}/historicalorders/${missing.join(',')}?since=${since}`,
        headers,
      }),
      account,
      brokerIds: missing,
      expected,
    });
    valid = history.valid;
    rows = [...rows, ...history.rows];
    for (const order of history.orders) evidence.set(order.terminal_id, order);
  }
  const combined = parse({ status: 200, body: { Orders: rows } });
  const broker = {
    relation,
    mapping: valid ? combined.mapping : 'ambiguous',
    orders: brokerIds.map(
      (id) =>
        (valid ? combined.orders.find((order) => order.terminal_id === id) : evidence.get(id)) || { terminal_id: id, state: 'unknown' },
    ),
  };
  // Bounded history is not proof of absence. Unknown status and partial source
  // failures preserve factual evidence but never become found/not_found.
  return { complete: valid && broker.orders.every((order) => order.state !== 'unknown'), broker };
};
