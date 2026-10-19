({ data }) => {
  const source = Object.hasOwn(data, 'credential_source') ? data.credential_source : 'provisioned';
  if (!['provisioned', 'connector_env'].includes(source)) return { reason: 'invalid_request' };
  if (source === 'provisioned') return { source };

  // Inspect field names, never supplied secret values (including null/empty).
  const pending = [data];
  const seen = new Set();
  while (pending.length) {
    const value = pending.pop();
    if (seen.has(value)) continue;
    seen.add(value);
    for (const [key, field] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (value === data && key === 'credential_source') continue;
      const name = key.replaceAll('_', '').toLowerCase();
      if (/credential|token|secret/.test(name) || ['pkey', 'clientid', 'apikey', 'authorization', 'password'].includes(name)) {
        return { reason: 'invalid_request' };
      }
      if (!Object.hasOwn(field, 'value')) return { reason: 'invalid_request' };
      if (field.value !== null && typeof field.value === 'object') pending.push(field.value);
    }
  }
  const accounts = config.execution.connectorEnvAccounts;
  if (!Array.isArray(accounts) || !accounts.includes(data.account)) return { reason: 'account_unconfirmed' };
  return { source };
};
