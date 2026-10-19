/* eslint-disable camelcase */
({ kind, response, account, brokerIds = [], expected = [] }) => {
  const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const identifier = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
  const body = response?.body;
  const placed = kind === 'placed';
  const rows = Array.isArray(body?.Orders) ? body.Orders : [];
  const errors = Array.isArray(body?.Errors) ? body.Errors : [];
  // Even partial/malformed placement can provide authoritative IDs. Message is
  // never identity; nothing from an upstream body is retained wholesale.
  const candidates = placed ? [...rows, ...errors] : rows;
  const ids = [
    ...new Set(
      candidates
        .filter(
          (row) =>
            object(body) &&
            (!Object.hasOwn(body, 'AccountID') || body.AccountID === account) &&
            object(row) &&
            identifier(row.OrderID) &&
            (!Object.hasOwn(row, 'AccountID') || row.AccountID === account),
        )
        .map((row) => row.OrderID),
    ),
  ].sort();
  const states = {
    ACK: 'accepted',
    OPN: 'pending',
    DON: 'pending',
    PLA: 'pending',
    OSO: 'pending',
    FPR: 'part_filled',
    FLL: 'filled',
    CAN: 'cancelled',
    OUT: 'cancelled',
    TSC: 'cancelled',
    REJ: 'rejected',
    EXP: 'expired',
  };
  const clean = (value) =>
    object(value) &&
    !['Error', 'error', 'errors', 'error_description'].some((key) => Object.hasOwn(value, key)) &&
    (!Object.hasOwn(value, 'Errors') || (Array.isArray(value.Errors) && value.Errors.length === 0));
  const valid =
    response?.status === 200 &&
    object(body) &&
    !['Error', 'error', 'errors', 'error_description'].some((key) => Object.hasOwn(body, key)) &&
    (!Object.hasOwn(body, 'Errors') || (Array.isArray(body.Errors) && body.Errors.length === 0)) &&
    (!Object.hasOwn(body, 'AccountID') || body.AccountID === account) &&
    (!Object.hasOwn(body, 'NextToken') || body.NextToken === '') &&
    (!Object.hasOwn(body, 'OrderID') || (ids.length === 1 && body.OrderID === ids[0])) &&
    Array.isArray(body.Orders) &&
    rows.length <= 50 &&
    rows.every(
      (row) =>
        clean(row) &&
        identifier(row.OrderID) &&
        (placed
          ? !Object.hasOwn(row, 'AccountID') || row.AccountID === account
          : row.AccountID === account && brokerIds.includes(row.OrderID)),
    ) &&
    new Set(rows.map((row) => row.OrderID)).size === rows.length;
  const orders = ids.map((id) => {
    const matching = rows.filter((row) => row?.OrderID === id);
    const row = matching.length === 1 ? matching[0] : null;
    const state = valid && typeof row?.Status === 'string' && Object.hasOwn(states, row.Status) ? states[row.Status] : 'unknown';
    return { terminal_id: id, state };
  });
  // Prove a bijection using structured fields, never array order or Message.
  // Ambiguous/missing fields deliberately leave every leg unmapped.
  const decimalEqual = (left, right) => {
    const actual = lib.execution.decimal(left);
    const wanted = lib.execution.decimal(right);
    return actual !== null && wanted !== null && actual.text === wanted.text;
  };
  const matches = (row, order) => {
    const leg = Array.isArray(row.Legs) && row.Legs.length === 1 ? row.Legs[0] : null;
    return (
      clean(leg) &&
      row.AccountID === order.AccountID &&
      row.OrderType === order.OrderType &&
      row.Duration === order.TimeInForce.Duration &&
      leg.AssetType === 'STOCK' &&
      leg.Symbol === order.Symbol &&
      decimalEqual(leg.QuantityOrdered, order.Quantity) &&
      leg.BuyOrSell === (order.TradeAction === 'BUY' ? 'Buy' : 'Sell') &&
      leg.OpenOrClose === (order.TradeAction === 'BUY' ? 'Open' : 'Close') &&
      (!Object.hasOwn(row, 'Routing') || row.Routing === order.Route) &&
      ['LimitPrice', 'StopPrice'].every((key) => !Object.hasOwn(order, key) || decimalEqual(row[key], order[key]))
    );
  };
  const mapping =
    valid &&
    rows.length === expected.length &&
    expected.length > 0 &&
    rows.every((row) => expected.filter((order) => matches(row, order)).length === 1) &&
    expected.every((order) => rows.filter((row) => matches(row, order)).length === 1);
  if (mapping) {
    for (const order of orders) {
      order.leg = expected.findIndex((wanted) =>
        matches(
          rows.find((row) => row.OrderID === order.terminal_id),
          wanted,
        ),
      );
    }
  }
  return { ids, orders, valid, mapping: mapping ? 'verified' : 'ambiguous', rows: valid ? rows : [] };
};
