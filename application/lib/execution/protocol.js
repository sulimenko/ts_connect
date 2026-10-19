/* eslint-disable camelcase */
({ kind, response, account, brokerId }) => {
  const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const identifier = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
  const clean = (value) =>
    object(value) &&
    !['Error', 'error', 'errors', 'error_description'].some((name) => Object.hasOwn(value, name)) &&
    (!Object.hasOwn(value, 'Errors') || (Array.isArray(value.Errors) && value.Errors.length === 0));
  const body = response?.body;
  if (
    response?.status !== 200 ||
    !clean(body) ||
    (Object.hasOwn(body, 'AccountID') && body.AccountID !== account) ||
    (Object.hasOwn(body, 'NextToken') && body.NextToken !== '')
  ) {
    return null;
  }
  if (kind === 'accounts') {
    const rows = body.Accounts;
    if (!Array.isArray(rows) || !rows.every((row) => clean(row) && identifier(row.AccountID))) return null;
    if (new Set(rows.map((row) => row.AccountID)).size !== rows.length) return null;
    return rows.filter((row) => row.AccountID === account).length === 1 ? { verified: true } : null;
  }
  if (kind === 'positions') {
    const quantity = (value) =>
      (typeof value === 'number' || (typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value))) &&
      Number.isFinite(Number(value));
    const rows = body.Positions;
    if (
      !Array.isArray(rows) ||
      !rows.every(
        (row) =>
          clean(row) &&
          row.AccountID === account &&
          typeof row.Symbol === 'string' &&
          row.Symbol.trim() !== '' &&
          row.Symbol === row.Symbol.trim() &&
          quantity(row.Quantity) &&
          (!Object.hasOwn(row, 'Deleted') || row.Deleted === false) &&
          (!Object.hasOwn(row, 'LongShort') ||
            (row.LongShort === 'Long' && Number(row.Quantity) >= 0) ||
            (row.LongShort === 'Short' && Number(row.Quantity) <= 0)) &&
          (!Object.hasOwn(row, 'PositionID') || identifier(row.PositionID)),
      )
    ) {
      return null;
    }
    const ids = rows.filter((row) => Object.hasOwn(row, 'PositionID')).map((row) => row.PositionID);
    if (new Set(ids).size !== ids.length) return null;
    return { positions: rows.map((row) => ({ symbol: row.Symbol, quantity: Number(row.Quantity) })) };
  }
  const rows = body.Orders;
  if (!Array.isArray(rows) || !rows.every((row) => clean(row) && identifier(row.OrderID))) {
    return null;
  }
  const states = {
    ACK: 'accepted',
    OPN: 'pending',
    DON: 'pending',
    PLA: 'pending',
    FPR: 'part_filled',
    FLL: 'filled',
    CAN: 'cancelled',
    OUT: 'cancelled',
    TSC: 'cancelled',
    REJ: 'rejected',
    EXP: 'expired',
  };
  const stateOf = (row) => (typeof row.Status === 'string' && Object.hasOwn(states, row.Status) ? states[row.Status] : null);
  if (kind === 'placed') {
    if (rows.length !== 1) return null;
    const row = rows[0];
    if (
      (Object.hasOwn(row, 'AccountID') && row.AccountID !== account) ||
      (Object.hasOwn(body, 'OrderID') && body.OrderID !== row.OrderID) ||
      (Object.hasOwn(row, 'Status') && !['pending', 'accepted'].includes(stateOf(row)))
    ) {
      return null;
    }
    return { terminal_id: row.OrderID, state: 'pending' };
  }
  if (
    kind !== 'orders' ||
    rows.length > 1 ||
    (Object.hasOwn(body, 'OrderID') && body.OrderID !== brokerId) ||
    !rows.every((row) => row.AccountID === account && row.OrderID === brokerId)
  ) {
    return null;
  }
  if (rows.length === 0) return { empty: true };
  const state = stateOf(rows[0]);
  return state ? { broker: { terminal_id: brokerId, state } } : null;
};
