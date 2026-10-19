({
  token: process.env.BROKER_EXECUTION_TOKEN,
  identity: 'metaterminal-execution',
  connectorEnvAccounts: (process.env.TRADING_TS_CONNECTOR_ENV_ACCOUNTS || '')
    .split(',')
    .map((account) => account.trim())
    .filter(Boolean),
});
