({ action, data }) => {
  const invalid = { version: 2, orderId: data?.orderId, state: action === 'submit' ? 'rejected' : 'source_unavailable' };
  if (
    data?.version !== 2 ||
    !Number.isSafeInteger(data.orderId) ||
    data.orderId <= 0 ||
    typeof data.account !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(data.account) ||
    typeof data.live !== 'boolean' ||
    !data.credentials ||
    !['pkey', 'secret'].every((name) => typeof data.credentials[name] === 'string' && data.credentials[name].trim() !== '')
  ) {
    return invalid;
  }
  if (!['submit', 'lookup'].includes(action)) return invalid;
  return lib.execution.broker({ action, data });
};
