'use strict';
/* eslint-disable camelcase */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
const load = (name, globals) =>
  vm.runInNewContext(
    fs.readFileSync(path.join(root, 'application', name), 'utf8'),
    globals,
  );
const plain = (value) => JSON.parse(JSON.stringify(value));
const input = () => ({
  version: 2,
  orderId: 17,
  account: 'EXT-1',
  live: true,
  credentials: {
    pkey: 'private-key',
    secret: 'private-secret',
    refresh_token: 'private-refresh',
  },
  intent: {
    symbol: 'AAPL',
    assetCategory: 'STK',
    quantity: 2,
    type: 'market',
    tif: 'day',
    relation: 'NORMAL',
    related: [],
    extended: false,
    limitPrice: null,
    stopPrice: null,
  },
});
const extendedInput = () => {
  const data = input();
  data.intent = {
    ...data.intent,
    type: 'limit',
    tif: 'gtc',
    extended: true,
    limitPrice: 125.5,
  };
  return data;
};
const rulesInput = () => ({
  version: 1,
  account: 'EXT-1',
  live: true,
  credentials: input().credentials,
  instrument: {
    symbol: 'MSFT',
    assetCategory: 'STK',
    exchange: 'NASDAQ',
    currency: 'USD',
  },
});
const connectorFailure = (action) =>
  ({ rules: 'unavailable', submit: 'rejected', lookup: 'source_unavailable' })[
    action
  ];
const connectorAccounts = [
  ['SIM2811593M', false],
  ['11957784', true],
  ['12062622', true],
  ['12062620', true],
  ['11827414', true],
  ['12062623', true],
];
const connectorInput = (action, account = 'SIM2811593M', live = false) => {
  const data = action === 'rules' ? rulesInput() : input();
  delete data.credentials;
  data.account = account;
  data.live = live;
  data.credential_source = 'connector_env';
  if (action === 'lookup') data.brokerId = 'B-1';
  return data;
};
// Documented SymbolDetailsResponse MSFT example, OpenAPI 2026-04-11.
// No invented OrderTypes/TimeInForce/Rules fields provide combination proof.
const symbolDetails = () => ({
  Symbols: [
    {
      AssetType: 'STOCK',
      Country: 'United States',
      Currency: 'USD',
      Description: 'Microsoft Corp',
      Exchange: 'NASDAQ',
      Symbol: 'MSFT',
      Root: 'MSFT',
      PriceFormat: {
        Format: 'Decimal',
        Decimals: '2',
        IncrementStyle: 'Simple',
        Increment: '0.01',
        PointValue: '1',
      },
      QuantityFormat: {
        Format: 'Decimal',
        Decimals: '0',
        IncrementStyle: 'Simple',
        Increment: '1',
        MinimumTradeQuantity: '1',
      },
    },
  ],
  Errors: [],
});
const expectedRules = (data, maximum = 'infinity') => {
  const quantity = {
    fractional: false,
    minimum: '1',
    step: '1',
    maximum,
    minimumNotional: null,
  };
  return {
    version: 1,
    state: 'ready',
    identity: {
      terminal: 'TS',
      externalAccount: data.account,
      live: data.live,
    },
    instrument: {
      symbol: 'MSFT',
      assetCategory: 'STK',
      exchange: 'NASDAQ',
      currency: 'USD',
    },
    orders: [
      { type: 'market', tif: 'day', sessions: ['regular'] },
      {
        type: 'limit',
        tif: 'gtc',
        sessions: ['regular', 'pre_market', 'post_market'],
      },
    ].map((order) => ({
      ...order,
      relation: 'NORMAL',
      orderClass: 'simple',
      quantityMode: 'whole',
      side: 'buy',
      positionEffect: 'open',
      quantity: { ...quantity },
    })),
    quantity,
    price: {
      rules: [
        {
          minInclusive: '0',
          maxExclusive: null,
          tick: '0.01',
          precision: 2,
          rounding: 'nearest_half_up',
        },
      ],
    },
  };
};
const order = (overrides = {}) => ({
  AccountID: 'EXT-1',
  OrderID: 'B-1',
  Status: 'FLL',
  ...overrides,
});
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
function fakeClock() {
  let now = Date.UTC(2026, 9, 4);
  let next = 0;
  const timers = new Map();
  class ClockDate extends Date {
    static now() {
      return now;
    }
  }
  return {
    Date: ClockDate,
    setTimeout(fn, ms) {
      const id = ++next;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(ms) {
      now += ms;
      for (const [id, timer] of timers) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.fn();
        }
      }
    },
    pending: () => timers.size,
  };
}
function harness({ clock = false } = {}) {
  const calls = [];
  const logs = [];
  const time = clock ? fakeClock() : null;
  const state = {
    responses: {},
    statuses: {},
    delays: {},
    bodyDelays: {},
    loss: false,
    mismatch: false,
    unknown: false,
    rotate: false,
    hang: null,
    jsonHang: null,
    account: 'EXT-1',
    accessToken: 'private-access',
  };
  const globals = {
    node: { crypto },
    Buffer,
    URL,
    URLSearchParams,
    AbortController,
    Date: time?.Date || Date,
    setTimeout: time?.setTimeout || setTimeout,
    clearTimeout: time?.clearTimeout || clearTimeout,
    console: Object.fromEntries(
      ['log', 'info', 'warn', 'error', 'debug'].map((level) => [
        level,
        (...args) => logs.push(args),
      ]),
    ),
    context: { client: { ip: '127.0.0.1' } },
    config: {
      execution: { token: 's'.repeat(32), identity: 'metaterminal-execution' },
    },
    domain: { execution: {} },
    lib: { execution: {} },
  };
  const defaults = {
    oauth: () => {
      const token = { access_token: 'private-access' };
      if (state.rotate) token.refresh_token = 'rotated-refresh';
      return token;
    },
    accounts: () => ({
      Accounts: [
        {
          AccountID: state.mismatch ? 'OTHER' : state.account,
          AccountType: 'Cash',
          Status: 'Active',
          Currency: 'USD',
        },
      ],
    }),
    details: symbolDetails,
    routes: () => ({
      Routes: [
        { Id: 'Intelligent', Name: 'Intelligent', AssetTypes: ['STOCK'] },
      ],
    }),
    positions: () => ({ Positions: [] }),
    place: () => ({ Orders: [{ OrderID: 'B-1' }] }),
    current: () => ({
      Orders: [
        order({
          AccountID: state.account,
          Status: state.unknown ? 'UNKNOWN' : 'FLL',
        }),
      ],
    }),
    historical: () => ({ Orders: [order({ AccountID: state.account })] }),
  };
  globals.fetch = async (url, options) => {
    let stage = 'current';
    if (url.includes('/oauth/token')) stage = 'oauth';
    else if (url.endsWith('/brokerage/accounts')) stage = 'accounts';
    else if (url.includes('/marketdata/symbols/')) stage = 'details';
    else if (url.endsWith('/orderexecution/routes')) stage = 'routes';
    else if (url.endsWith('/positions')) stage = 'positions';
    else if (options.method === 'POST') stage = 'place';
    else if (url.includes('/historicalorders/')) stage = 'historical';
    calls.push({ url, options, stage, at: globals.Date.now() });
    if (stage === 'oauth') {
      assert.ok(options.body.includes('grant_type=refresh_token'));
      assert.equal(options.redirect, 'error');
    } else {
      assert.equal(
        options.headers.Authorization,
        `Bearer ${state.accessToken}`,
      );
    }
    if (stage === 'place') {
      const payload = JSON.parse(options.body);
      assert.equal(payload.OrderConfirmID, 'meta-17');
      assert.equal(payload.OrderConfirmID.length <= 22, true);
      assert.equal(Object.hasOwn(payload, 'OrderConfirmId'), false);
      if (state.loss) throw new Error('private-secret raw upstream exception');
    }
    if (state.hang === stage) return new Promise(() => {});
    time?.advance(state.delays[stage] || 0);
    const body = Object.hasOwn(state.responses, stage)
      ? state.responses[stage]
      : defaults[stage]();
    if (body instanceof Error) throw body;
    return {
      status: state.statuses[stage] ?? 200,
      json: async () => {
        if (state.jsonHang === stage) return new Promise(() => {});
        time?.advance(state.bodyDelays[stage] || 0);
        return body;
      },
    };
  };
  globals.domain.execution.attempts = load(
    'domain/execution/attempts.js',
    globals,
  );
  globals.lib.utils = load('lib/utils.js', globals);
  for (const name of [
    'request',
    'credentialSource',
    'authorization',
    'protocol',
    'broker',
    'handle',
    'decimal',
    'priceRules',
    'rulesReady',
    'intelligentMaximum',
    'rulesProof',
    'rules',
  ]) {
    globals.lib.execution[name] = load(`lib/execution/${name}.js`, globals);
  }
  const hook = load('api/execution.1.js', globals);
  const invoke = (action, data, options = {}) =>
    hook.router({
      method: `execution/${action}`,
      verb: options.verb || 'POST',
      args: data,
      headers: {
        authorization: options.authorization ?? `Bearer ${'s'.repeat(32)}`,
        'x-service-identity': options.identity ?? 'metaterminal-execution',
      },
    });
  const postCount = () => calls.filter((call) => call.stage === 'place').length;
  const restart = () => {
    globals.domain.execution.attempts = load(
      'domain/execution/attempts.js',
      globals,
    );
  };
  return {
    invoke,
    globals,
    calls,
    logs,
    state,
    postCount,
    restart,
    time,
    hook,
  };
}
async function connectorHarness({ cold = false } = {}) {
  const h = harness({ clock: true });
  const { globals } = h;
  globals.config.execution.connectorEnvAccounts = connectorAccounts.map(
    ([account]) => account,
  );
  globals.config.ts = {
    ptfin: {
      pkey: 'env-private-key',
      secret: 'env-private-secret',
      rtoken: 'env-private-refresh',
    },
  };
  const client = await load('domain/ts/client.js', globals)();
  client.tokens.access = h.state.accessToken;
  client.tokens.expires = new globals.Date(globals.Date.now() + 120000);
  const populate = () => {
    for (const [account, live] of connectorAccounts) {
      client.brokerage.accounts.set(account, { account, live });
    }
  };
  if (!cold) populate();
  const lifecycle = {
    get: [],
    factories: 0,
    refreshes: 0,
    syncs: 0,
    allowSync: false,
    refreshGate: null,
    refreshError: null,
    missingToken: false,
  };
  client.syncBrokerageStreams = async () => {
    assert.ok(lifecycle.allowSync, 'execution started brokerage sync');
    lifecycle.syncs++;
    populate();
    return true;
  };
  globals.lib.ptfin = {
    getContract: () => assert.fail('execution loaded contracts'),
  };
  globals.lib.ts = {
    stream: () => assert.fail('execution started streams'),
    refresh: load('lib/ts/refresh.js', globals),
    send: async ({ data }) => {
      lifecycle.refreshes++;
      assert.equal(data.client_id, 'env-private-key');
      assert.equal(data.client_secret, 'env-private-secret');
      assert.equal(data.refresh_token, 'env-private-refresh');
      if (lifecycle.refreshGate) await lifecycle.refreshGate;
      if (lifecycle.refreshError) throw lifecycle.refreshError;
      if (lifecycle.missingToken) return {};
      h.state.accessToken = 'refreshed-private-access';
      return {
        access_token: h.state.accessToken,
        expires_in: 600,
        refresh_token: 'env-private-rotation',
      };
    },
  };
  // Real setup and refresh single-flight, with only upstream transport mocked.
  globals.domain.ts = {
    client: async () => {
      lifecycle.factories++;
      return client;
    },
    orders: { clearAccount: () => {} },
    clients: load('domain/ts/clients.js', globals),
  };
  const clients = globals.domain.ts.clients;
  clients.deleteClient = () => assert.fail('execution deleted/updated client');
  const getClient = clients.getClient.bind(clients);
  clients.getClient = (options) => {
    lifecycle.get.push(plain(options));
    return getClient(options);
  };
  if (!cold) {
    clients.values.ptfin = client;
    client.key = { pkey: 'env-private-key', secret: 'env-private-secret' };
    client.tokens.refresh = 'env-private-refresh';
  }
  h.state.account = 'SIM2811593M';
  return { ...h, client, clients, lifecycle };
}
const safeConnector = (h, ...responses) => {
  for (const response of responses) {
    assert.equal(Object.hasOwn(response, 'accessUpdate'), false);
  }
  const receipt = h.globals.domain.execution.attempts.get({ orderId: 17 });
  assert.doesNotMatch(
    JSON.stringify([responses, receipt, h.logs]),
    /private|pkey|secret|rtoken|refresh_token|access_token|accessUpdate/,
  );
};
test('connector_env uses registry live for all six accounts', async () => {
  for (const [account, live] of connectorAccounts) {
    for (const action of ['rules', 'submit', 'lookup']) {
      const h = await connectorHarness();
      h.state.account = account;
      const data = connectorInput(
        action,
        account,
        h.client.brokerage.accounts.get(account).live,
      );
      const result = await h.invoke(action, data);
      assert.equal(
        result.state,
        { rules: 'ready', submit: 'acknowledged', lookup: 'found' }[action],
      );
      assert.ok(
        h.calls.every(({ url }) =>
          url.startsWith(
            live
              ? 'https://api.tradestation.com/v3/'
              : 'https://sim-api.tradestation.com/v3/',
          ),
        ),
      );
      assert.equal(h.lifecycle.refreshes, 0);
      assert.deepEqual(h.lifecycle.get, [{ name: 'ptfin', sync: false }]);
      assert.equal(h.lifecycle.syncs, 0);
      assert.equal(
        h.calls.some(({ stage }) => stage === 'oauth'),
        false,
      );
      if (action === 'rules') {
        assert.deepEqual(plain(result), expectedRules(data));
      }
      safeConnector(h, result);
    }
  }
  // The registry, even for a SIM-looking name, is the sole source of live.
  const h = await connectorHarness();
  h.client.brokerage.accounts.get('SIM2811593M').live = true;
  assert.equal(
    (await h.invoke('rules', connectorInput('rules', 'SIM2811593M', true)))
      .state,
    'ready',
  );
  assert.ok(
    h.calls.every(({ url }) =>
      url.startsWith('https://api.tradestation.com/v3/'),
    ),
  );
});

test('connector_env parses exact allowlist with no fallback', async () => {
  for (const value of [
    undefined,
    '',
    ' , ',
    ' SIM2811593M , 11957784 ',
    'SIM*,119*',
  ]) {
    const h = await connectorHarness();
    const execution = load('config/execution.js', {
      process: { env: { TRADING_TS_CONNECTOR_ENV_ACCOUNTS: value } },
    });
    h.globals.config.execution.connectorEnvAccounts =
      execution.connectorEnvAccounts;
    const result = await h.invoke('rules', connectorInput('rules'));
    assert.equal(
      result.state,
      value === ' SIM2811593M , 11957784 ' ? 'ready' : 'unavailable',
    );
    if (result.state !== 'ready') {
      assert.equal(result.reason, 'account_unconfirmed');
      assert.equal(h.lifecycle.get.length, 0);
      assert.equal(h.calls.length, 0);
    }
  }
});

test('connector_env local denial skips clients and network', async () => {
  for (const action of ['rules', 'submit', 'lookup']) {
    for (const change of [
      { account: 'OTHER' },
      { account: 'sim2811593m' },
      { account: 'SIM2811593' },
      { account: 'SIM2811593MX' },
      { account: 'SIM*' },
      { account: '1195778' },
      { credential_source: 'unknown' },
      { credential_source: null },
      { credential_source: '' },
      { credential_source: undefined },
      { intent: { ...input().intent, pkey: 'private-request-key' } },
      {
        instrument: {
          ...rulesInput().instrument,
          access_token: 'private-request-token',
        },
      },
      { extra: { nested: { credentials: null } } },
      ...[null, undefined, '', {}, [], 0, false, input().credentials].map(
        (credentials) => ({ credentials }),
      ),
      ...[
        'pkey',
        'secret',
        'rtoken',
        'refresh_token',
        'access_token',
        'id_token',
        'token',
        'tokens',
        'accessToken',
        'refreshToken',
        'client_id',
        'client_secret',
        'api_key',
        'authorization',
      ].map((key) => ({ [key]: 'private-request-secret' })),
    ]) {
      const h = await connectorHarness();
      const data = { ...connectorInput(action), ...change };
      for (const key of Object.keys(change).filter(
        (key) =>
          /credential|token|secret|pkey/.test(key) &&
          key !== 'credential_source',
      )) {
        Object.defineProperty(data, key, {
          get: () => assert.fail('execution read request secret'),
          enumerable: true,
        });
      }
      const result = await h.invoke(action, data);
      assert.equal(result.state, connectorFailure(action));
      assert.equal(h.lifecycle.get.length, 0);
      assert.equal(h.lifecycle.refreshes, 0);
      assert.equal(h.calls.length, 0);
      assert.equal(h.globals.domain.execution.attempts.get(data), null);
      safeConnector(h, result);
    }
    for (const accounts of [
      undefined,
      [],
      ['SIM*'],
      ['sim2811593m'],
      ['SIM2811593'],
      ['SIM2811593MX'],
    ]) {
      const h = await connectorHarness();
      h.globals.config.execution.connectorEnvAccounts = accounts;
      const result = await h.invoke(action, connectorInput(action));
      assert.equal(result.state, connectorFailure(action));
      assert.equal(h.lifecycle.get.length, 0);
      assert.equal(h.calls.length, 0);
    }
  }
});

test('connector_env service auth precedes all other access', async () => {
  for (const action of ['rules', 'submit', 'lookup']) {
    for (const options of [
      { identity: 'wrong' },
      { authorization: 'Bearer wrong' },
    ]) {
      const h = await connectorHarness();
      const data = new Proxy(
        {},
        { get: () => assert.fail('unauthorized request inspected') },
      );
      Object.defineProperty(
        h.globals.config.execution,
        'connectorEnvAccounts',
        { get: () => assert.fail('unauthorized allowlist accessed') },
      );
      Object.defineProperty(h.globals.domain, 'ts', {
        get: () => assert.fail('unauthorized client accessed'),
      });
      Object.defineProperty(h.globals.domain.execution, 'attempts', {
        get: () => assert.fail('unauthorized attempts accessed'),
      });
      assert.deepEqual(plain(await h.invoke(action, data, options)), {
        state: 'unauthorized',
      });
      assert.equal(h.calls.length, 0);
    }
  }
});

test('connector_env registry/live denial skips broker calls', async () => {
  for (const action of ['rules', 'submit', 'lookup']) {
    for (const value of [
      null,
      { live: true },
      { live: 0 },
      { live: 'false' },
      {},
    ]) {
      const h = await connectorHarness();
      h.client.tokens.expires = 0;
      h.client.brokerage.accounts.delete('SIM2811593M');
      if (value) h.client.brokerage.accounts.set('SIM2811593M', value);
      // Similar keys must not confirm the exact requested key.
      h.client.brokerage.accounts.set('sim2811593m', { live: false });
      h.client.brokerage.accounts.set('SIM2811593MX', { live: false });
      const result = await h.invoke(action, connectorInput(action));
      assert.equal(result.state, connectorFailure(action));
      if (action === 'rules') {
        assert.equal(result.reason, 'account_unconfirmed');
      }
      assert.equal(h.lifecycle.refreshes, 0);
      assert.equal(h.calls.length, 0);
      safeConnector(h, result);
    }
  }
});

test('connector_env cold setup shares normal client flight', async () => {
  const h = await connectorHarness({ cold: true });
  let release;
  h.lifecycle.refreshGate = new Promise((resolve) => {
    release = resolve;
  });
  h.lifecycle.allowSync = true;
  const normal = h.clients.getClient({ name: 'ptfin' });
  const rules = h.invoke('rules', connectorInput('rules'));
  const submit = h.invoke('submit', connectorInput('submit'));
  const lookup = h.invoke('lookup', connectorInput('lookup'));
  await flush();
  assert.equal(h.lifecycle.factories, 1);
  assert.equal(h.lifecycle.refreshes, 1);
  assert.equal(h.calls.length, 0);
  release();
  const [client, ready, acknowledged, found] = await Promise.all([
    normal,
    rules,
    submit,
    lookup,
  ]);
  assert.equal(client, h.client);
  assert.equal(ready.state, 'ready');
  assert.equal(acknowledged.state, 'acknowledged');
  assert.equal(found.state, 'found');
  assert.equal(h.lifecycle.syncs, 1); // Only the normal call requests sync.
  assert.deepEqual(
    h.lifecycle.get.slice(1),
    Array(3).fill({ name: 'ptfin', sync: false }),
  );
  assert.equal(h.postCount(), 1);
  safeConnector(h, ready, acknowledged, found);

  const isolated = await connectorHarness({ cold: true });
  const results = await Promise.all(
    ['rules', 'submit', 'lookup'].map((action) =>
      isolated.invoke(action, connectorInput(action)),
    ),
  );
  assert.deepEqual(
    results.map(({ state }) => state),
    ['unavailable', 'rejected', 'source_unavailable'],
  );
  assert.equal(results[0].reason, 'account_unconfirmed');
  assert.equal(isolated.lifecycle.factories, 1);
  assert.equal(isolated.lifecycle.refreshes, 1);
  assert.equal(isolated.lifecycle.syncs, 0);
  assert.equal(isolated.calls.length, 0);
  safeConnector(isolated, ...results);
});

test('connector_env refresh shares normal lifecycle flight', async () => {
  for (const normalFirst of [false, true]) {
    const h = await connectorHarness();
    h.client.tokens.expires = 0;
    let release;
    h.lifecycle.refreshGate = new Promise((resolve) => {
      release = resolve;
    });
    let normal;
    if (normalFirst) {
      normal = h.client.refreshAccessToken({ reason: 'lifetime' });
    }
    const pending = ['rules', 'submit', 'lookup'].map((action) =>
      h.invoke(action, connectorInput(action)),
    );
    await flush();
    if (!normalFirst) {
      normal = h.client.refreshAccessToken({ reason: 'lifetime' });
    }
    assert.equal(h.lifecycle.refreshes, 1);
    assert.equal(h.calls.length, 0);
    release();
    await normal;
    const results = await Promise.all(pending);
    assert.deepEqual(
      results.map(({ state }) => state),
      ['ready', 'acknowledged', 'found'],
    );
    assert.equal(h.lifecycle.refreshes, 1);
    assert.ok(
      h.calls.every(
        ({ options }) =>
          options.headers.Authorization === 'Bearer refreshed-private-access',
      ),
    );
    // Existing persistence semantics.
    assert.equal(h.client.tokens.refresh, 'env-private-refresh');
    safeConnector(h, ...results);
  }
});

test('connector_env bounds setup/refresh without late POST', async () => {
  for (const cold of [false, true]) {
    for (const action of ['rules', 'submit', 'lookup']) {
      const h = await connectorHarness({ cold });
      if (!cold) h.client.tokens.expires = 0;
      let release;
      h.lifecycle.refreshGate = new Promise((resolve) => {
        release = resolve;
      });
      const pending = h.invoke(action, connectorInput(action));
      await flush();
      const flight = cold ? h.clients.connecting.ptfin : h.client.tokenRefresh;
      h.time.advance(18000);
      const result = await pending;
      assert.equal(result.state, connectorFailure(action));
      if (action === 'rules') assert.equal(result.reason, 'source_unavailable');
      assert.equal(h.calls.length, 0);
      assert.equal(
        cold ? h.clients.connecting.ptfin : h.client.tokenRefresh,
        flight,
      );
      release();
      await flight;
      await flush();
      assert.equal(h.calls.length, 0);
      safeConnector(h, result);
      if (action === 'submit') {
        assert.equal(
          (await h.invoke(action, connectorInput(action))).state,
          'rejected',
        );
      }
    }
  }
  const h = await connectorHarness();
  for (const action of ['rules', 'submit', 'lookup']) {
    const data = connectorInput(action);
    const result =
      action === 'rules'
        ? await h.globals.lib.execution.rules({
            data,
            deadline: h.time.Date.now(),
          })
        : await h.globals.lib.execution.handle({
            action,
            data,
            deadline: h.time.Date.now(),
          });
    assert.equal(result.state, connectorFailure(action));
  }
  assert.equal(h.lifecycle.get.length, 0);
  assert.equal(h.calls.length, 0);
});

test('connector_env safely handles client/token failures', async () => {
  for (const action of ['rules', 'submit', 'lookup']) {
    for (const failure of [
      'closed',
      'missing-client',
      'setup-error',
      'missing-token',
      'refresh-error',
      'refresh-false',
      'close-during-refresh',
      'registry-during-refresh',
    ]) {
      const h = await connectorHarness();
      if (failure === 'closed') h.client.closed = true;
      if (failure === 'missing-client') h.clients.getClient = async () => null;
      if (failure === 'setup-error') {
        h.clients.getClient = async () => {
          throw new Error('private-secret setup exception');
        };
      }
      if (failure === 'missing-token') {
        h.client.tokens.access = null;
        h.lifecycle.missingToken = true;
      }
      if (failure === 'refresh-error') {
        h.client.tokens.expires = 0;
        h.lifecycle.refreshError = new Error(
          'private-secret private-access raw refresh exception',
        );
      }
      if (failure === 'refresh-false') {
        h.client.tokens.expires = 0;
        h.client.refreshAccessToken = async () => false;
      }
      let release;
      if (failure.endsWith('during-refresh')) {
        h.client.tokens.expires = 0;
        h.lifecycle.refreshGate = new Promise((resolve) => {
          release = resolve;
        });
      }
      const pending = h.invoke(action, connectorInput(action));
      if (release) {
        await flush();
        if (failure === 'close-during-refresh') await h.client.close();
        else h.client.brokerage.accounts.get('SIM2811593M').live = true;
        release();
      }
      const result = await pending;
      assert.equal(result.state, connectorFailure(action));
      if (action === 'rules') assert.equal(result.reason, 'source_unavailable');
      assert.equal(h.calls.length, 0);
      safeConnector(h, result);
    }
  }
});

test('connector_env rechecks auth and token before POST', async () => {
  for (const change of [
    'closed',
    'live',
    'missing-token',
    'refresh-error',
    'deadline',
    'refresh',
  ]) {
    const h = await connectorHarness();
    const fetch = h.globals.fetch;
    h.globals.fetch = async (url, options) => {
      const response = await fetch(url, options);
      if (url.endsWith('/positions')) {
        if (change === 'closed') h.client.closed = true;
        if (change === 'live') {
          h.client.brokerage.accounts.get('SIM2811593M').live = true;
        }
        if (change === 'missing-token') {
          h.client.tokens.access = null;
          h.lifecycle.missingToken = true;
        }
        if (change === 'refresh-error') {
          h.client.tokens.expires = 0;
          h.lifecycle.refreshError = new Error('private-secret');
        }
        if (change === 'deadline') h.time.advance(18000);
        if (change === 'refresh') h.client.tokens.expires = 0;
      }
      return response;
    };
    const result = await h.invoke('submit', connectorInput('submit'));
    assert.equal(
      result.state,
      change === 'refresh' ? 'acknowledged' : 'rejected',
    );
    assert.equal(h.postCount(), change === 'refresh' ? 1 : 0);
    if (change === 'refresh') {
      assert.equal(
        h.calls.at(-1).options.headers.Authorization,
        'Bearer refreshed-private-access',
      );
    }
    safeConnector(h, result);
  }
});

test('connector_env concurrency and replay preserve one POST', async () => {
  for (const loss of [false, true]) {
    const h = await connectorHarness();
    h.state.loss = loss;
    const data = connectorInput('submit');
    const first = h.invoke('submit', data);
    assert.ok(
      h.globals.domain.execution.attempts.get(data),
      'claim must precede first await',
    );
    const concurrent = await h.invoke('submit', data);
    assert.equal(concurrent.state, 'ambiguous');
    const result = await first;
    assert.equal(result.state, loss ? 'ambiguous' : 'acknowledged');
    for (const change of [
      { account: '11957784' },
      { live: true },
      { intent: { ...data.intent, quantity: 3 } },
      { intent: null },
      { intent: [] },
      { credentials: null },
      { credential_source: 'provisioned', credentials: input().credentials },
      { credential_source: 'unknown' },
      { credential_source: undefined },
    ]) {
      const before = h.calls.length;
      const replay = await h.invoke('submit', { ...data, ...change });
      assert.ok(['acknowledged', 'ambiguous'].includes(replay.state));
      assert.equal(h.calls.length, before);
      safeConnector(h, replay);
    }
    assert.equal(h.postCount(), 1);
    const saved = plain(h.globals.domain.execution.attempts.get(data));
    h.state.loss = false;
    const lookup = await h.invoke('lookup', connectorInput('lookup'));
    assert.equal(lookup.state, 'found');
    assert.deepEqual(
      plain(h.globals.domain.execution.attempts.get(data)),
      saved,
    );
    safeConnector(h, result, concurrent, lookup);
  }
  const h = await connectorHarness();
  h.state.account = 'EXT-1';
  h.state.rotate = true;
  const provisioned = await h.invoke('submit', input());
  assert.ok(provisioned.accessUpdate);
  const replay = await h.invoke('submit', {
    ...input(),
    credential_source: 'connector_env',
    credentials: null,
  });
  assert.equal(replay.state, 'acknowledged');
  safeConnector(h, replay);
  assert.equal(h.postCount(), 1);
});

test('connector_env lookup preserves evidence and recovery', async () => {
  for (const evidence of [
    'current',
    'historical',
    'empty',
    'malformed',
    'partial',
  ]) {
    const h = await connectorHarness();
    if (evidence !== 'current') h.state.responses.current = { Orders: [] };
    if (evidence === 'empty') h.state.responses.historical = { Orders: [] };
    if (evidence === 'malformed') {
      h.state.responses.current = { Orders: [{ OrderID: 'OTHER' }] };
    }
    if (evidence === 'partial') {
      h.state.responses.historical = {
        Orders: [order({ AccountID: 'SIM2811593M' })],
        NextToken: 'next',
      };
    }
    const result = await h.invoke('lookup', connectorInput('lookup'));
    assert.equal(
      result.state,
      ['current', 'historical'].includes(evidence)
        ? 'found'
        : 'source_unavailable',
    );
    assert.equal(h.postCount(), 0);
    safeConnector(h, result);
  }
  const h = await connectorHarness();
  assert.equal(
    (await h.invoke('submit', connectorInput('submit'))).state,
    'acknowledged',
  );
  const withoutId = connectorInput('lookup');
  delete withoutId.brokerId;
  assert.equal((await h.invoke('lookup', withoutId)).state, 'found');
  const before = h.calls.length;
  assert.equal(
    (await h.invoke('lookup', { ...withoutId, brokerId: 'OTHER' })).state,
    'source_unavailable',
  );
  assert.equal(h.calls.length, before);
  h.restart();
  assert.equal(
    (await h.invoke('lookup', withoutId)).state,
    'source_unavailable',
  );
  assert.equal(h.calls.length, before);
  const restored = await h.invoke('lookup', connectorInput('lookup'));
  assert.equal(restored.state, 'found');
  assert.equal(h.postCount(), 1);
  safeConnector(h, restored);
});

test('connector_env timeout leaves a shared waiter alive', async () => {
  const h = await connectorHarness();
  h.client.tokens.expires = 0;
  let release;
  h.lifecycle.refreshGate = new Promise((resolve) => {
    release = resolve;
  });
  const short = h.invoke('submit', connectorInput('submit'));
  const long = h.globals.lib.execution.handle({
    action: 'lookup',
    data: connectorInput('lookup'),
    deadline: h.time.Date.now() + 36000,
  });
  await flush();
  assert.equal(h.lifecycle.refreshes, 1);
  h.time.advance(18000);
  const rejected = await short;
  assert.equal(rejected.state, 'rejected');
  assert.equal(h.calls.length, 0);
  release();
  const found = await long;
  assert.equal(found.state, 'found');
  assert.equal(h.postCount(), 0);
  assert.equal(h.lifecycle.refreshes, 1);
  safeConnector(h, rejected, found);
});

test('connector_env hanging refresh before POST stays rejected', async () => {
  const h = await connectorHarness();
  let release;
  h.lifecycle.refreshGate = new Promise((resolve) => {
    release = resolve;
  });
  const fetch = h.globals.fetch;
  h.globals.fetch = async (url, options) => {
    const response = await fetch(url, options);
    if (url.endsWith('/positions')) h.client.tokens.expires = 0;
    return response;
  };
  const pending = h.invoke('submit', connectorInput('submit'));
  await flush();
  assert.equal(h.lifecycle.refreshes, 1);
  h.time.advance(18000);
  const rejected = await pending;
  assert.equal(rejected.state, 'rejected');
  assert.equal(h.postCount(), 0);
  const flight = h.client.tokenRefresh;
  release();
  await flight;
  await flush();
  assert.equal(h.postCount(), 0);
  safeConnector(h, rejected);
});

test('connector_env keeps rules proof and broker failures safe', async () => {
  for (const [action, stage, body, expected] of [
    ['rules', 'accounts', { Accounts: [] }, 'account_unconfirmed'],
    ['rules', 'details', { Symbols: [] }, 'instrument_unconfirmed'],
    ['rules', 'routes', { Routes: [] }, 'combination_unconfirmed'],
    ['submit', 'positions', { Positions: [], NextToken: 'next' }, 'rejected'],
    ['submit', 'place', { Orders: [] }, 'ambiguous'],
    ['lookup', 'current', new Error('private-secret'), 'source_unavailable'],
  ]) {
    const h = await connectorHarness();
    h.client.tokens.expires = 0;
    h.state.responses[stage] = body;
    const result = await h.invoke(action, connectorInput(action));
    assert.equal(action === 'rules' ? result.reason : result.state, expected);
    assert.equal(h.lifecycle.refreshes, 1);
    safeConnector(h, result);
  }
  const h = await connectorHarness();
  const fetch = h.globals.fetch;
  h.globals.fetch = async (url, options) => {
    const response = await fetch(url, options);
    if (url.includes('/marketdata/symbols/')) {
      await h.client.refreshAccessToken({ reason: 'lifetime' });
    }
    return response;
  };
  const ready = await h.invoke('rules', connectorInput('rules'));
  assert.equal(ready.state, 'ready');
  assert.equal(
    h.calls.at(-1).options.headers.Authorization,
    'Bearer refreshed-private-access',
  );
  safeConnector(h, ready);
});

test('explicit provisioned preserves rotation and validation', async () => {
  for (const action of ['rules', 'submit', 'lookup']) {
    const h = harness();
    h.state.rotate = true;
    const data = action === 'rules' ? rulesInput() : input();
    if (action === 'lookup') data.brokerId = 'B-1';
    Object.defineProperty(h.globals.domain, 'ts', {
      get: () => assert.fail('provisioned accessed connector client'),
    });
    Object.defineProperty(h.globals.config.execution, 'connectorEnvAccounts', {
      get: () => assert.fail('provisioned accessed connector allowlist'),
    });
    const result = await h.invoke(action, {
      ...data,
      credential_source: 'provisioned',
    });
    assert.equal(
      result.state,
      { rules: 'ready', submit: 'acknowledged', lookup: 'found' }[action],
    );
    assert.deepEqual(plain(result.accessUpdate), {
      refresh_token: 'rotated-refresh',
    });
    assert.equal(h.calls[0].stage, 'oauth');
    const invalid = harness();
    const rejected = await invalid.invoke(action, {
      ...data,
      credential_source: 'provisioned',
      credentials: null,
    });
    assert.equal(rejected.state, connectorFailure(action));
    assert.equal(invalid.calls.length, 0);
  }
});

test('auth rejects before touching credentials', async () => {
  const h = harness();
  const data = Object.defineProperty({}, 'credentials', {
    get: () => assert.fail('unauthorized credentials accessed'),
  });
  for (const action of ['submit', 'lookup', 'capabilities', 'rules']) {
    for (const options of [
      { authorization: 'Bearer user-session' },
      { authorization: `Bearer ${'x'.repeat(32)}` },
      { identity: 'user-session' },
    ]) {
      assert.equal(
        (await h.invoke(action, data, options)).state,
        'unauthorized',
      );
    }
  }
  h.globals.config.execution.token = undefined;
  assert.equal((await h.invoke('submit', data)).state, 'unauthorized');
  assert.equal(h.calls.length, 0);
  assert.equal(h.logs.length, 0);
});
test('protected capabilities describes recovery', async () => {
  const h = harness();
  assert.deepEqual(plain(await h.invoke('capabilities')), {
    version: 2,
    terminal: 'TS',
    contract: 'meta-ts-v2-1',
    submit: true,
    restart_safe: false,
    recovery: 'known_order_id_only',
  });
  assert.equal(h.hook.timeout < 20000, true);
  assert.equal(h.calls.length, 0);
});
test('parallel submits send once; exact replay uses receipt', async () => {
  const h = harness();
  const data = input();
  const [first, parallel] = await Promise.all([
    h.invoke('submit', data),
    h.invoke('submit', data),
  ]);
  assert.equal(first.state, 'acknowledged');
  assert.equal(first.broker.terminal_id, 'B-1');
  assert.equal(parallel.state, 'ambiguous');
  assert.equal(h.postCount(), 1);
  assert.deepEqual(plain(await h.invoke('submit', data)), plain(first));
  assert.equal((await h.invoke('lookup', data)).broker.state, 'filled');
  assert.equal(JSON.stringify(first).includes('private'), false);
  assert.equal(h.logs.length, 0);
  assert.equal(
    h.calls.every((call) =>
      /^https:\/\/(signin|api|sim-api)\.tradestation\.com\//.test(call.url),
    ),
    true,
  );
});
test('changed and invalid replays never reject anew or send', async () => {
  for (const loss of [false, true]) {
    const h = harness();
    const data = input();
    h.state.loss = loss;
    const first = await h.invoke('submit', data);
    assert.equal(first.state, loss ? 'ambiguous' : 'acknowledged');
    const variants = [
      { ...data, intent: { ...data.intent, quantity: 3 } },
      { ...data, intent: { ...data.intent, quantity: 0 } },
      { ...data, intent: { ...data.intent, type: {} } },
      { ...data, intent: { ...data.intent, type: 'unsupported' } },
      { ...data, intent: { ...data.intent, related: [input().credentials] } },
      { ...data, intent: null },
      { ...data, intent: undefined },
    ];
    for (const changed of variants) {
      assert.equal((await h.invoke('submit', changed)).state, 'ambiguous');
    }
    assert.equal(
      (await h.invoke('submit', { ...data, credentials: null })).state,
      first.state,
    );
    assert.equal(h.postCount(), 1);
    assert.equal(h.calls.length, 4);
    assert.equal(h.logs.length, 0);
  }
});
test('orderId alone owns immutable attempt identity', () => {
  const h = harness();
  const registry = h.globals.domain.execution.attempts;
  const data = input();
  for (const orderId of [0, -1, NaN, 1.5, '17', null, undefined]) {
    const claim = registry.claim({ ...data, orderId }, 'intent-1');
    assert.equal(claim.owner, false);
    assert.equal(claim.conflict, true);
    assert.equal(claim.attempt, null);
  }
  const first = registry.claim(data, 'intent-1');
  assert.equal(first.owner, true);
  assert.deepEqual(plain(first.attempt), {
    account: data.account,
    live: data.live,
    fingerprint: 'intent-1',
    brokerId: null,
    result: null,
  });
  for (const changed of [
    { ...data, account: 'EXT-2' },
    { ...data, live: false },
    { ...data, account: 'EXT-2', live: false, credentials: null },
  ]) {
    const claim = registry.claim(changed, 'intent-1');
    assert.equal(claim.owner, false);
    assert.equal(claim.conflict, true);
    assert.equal(claim.attempt, first.attempt);
    assert.equal(registry.get(changed), first.attempt);
  }
  const changedIntent = registry.claim(data, 'intent-2');
  assert.equal(changedIntent.owner, false);
  assert.equal(changedIntent.conflict, true);
  const replay = registry.claim({ ...data, credentials: null }, 'intent-1');
  assert.equal(replay.owner, false);
  assert.equal(replay.conflict, false);
  assert.equal(replay.attempt, first.attempt);
  assert.equal(
    registry.claim({ ...data, orderId: 18 }, 'intent-1').owner,
    true,
  );
});
test('account/live replay cannot place after ack or loss', async () => {
  for (const loss of [false, true]) {
    for (const live of [false, true]) {
      const h = harness();
      const data = { ...input(), live };
      h.state.loss = loss;
      h.state.rotate = true;
      // Both accounts are valid upstream: a second owner could place again.
      h.state.responses.accounts = {
        Accounts: [{ AccountID: 'EXT-1' }, { AccountID: 'EXT-2' }],
      };
      const first = await h.invoke('submit', data);
      assert.equal(first.state, loss ? 'ambiguous' : 'acknowledged');
      const attempt = h.globals.domain.execution.attempts.get(data);
      const saved = plain(attempt);
      h.state.loss = false;
      const before = h.calls.length;
      for (const credentials of [
        data.credentials,
        {
          pkey: 'changed-key',
          secret: 'changed-secret',
          refresh_token: 'changed-refresh',
        },
        null,
      ]) {
        for (const changed of [
          { account: 'EXT-2' },
          { live: !live },
          { account: 'EXT-2', live: !live },
          { intent: { ...data.intent, quantity: 3 } },
          {
            account: 'EXT-2',
            live: !live,
            intent: { ...data.intent, quantity: 3 },
          },
        ]) {
          const result = await h.invoke('submit', {
            ...data,
            ...changed,
            credentials,
          });
          assert.equal(result.state, 'ambiguous');
          assert.equal(result.broker, null);
          assert.equal(result.accessUpdate, undefined);
          assert.equal(h.calls.length, before);
          assert.equal(h.postCount(), 1);
          assert.deepEqual(plain(attempt), saved);
        }
        assert.deepEqual(
          plain(await h.invoke('submit', { ...data, credentials })),
          saved.result,
        );
      }
      assert.equal(h.calls.length, before);
      assert.equal(h.postCount(), 1);
      assert.equal(JSON.stringify(attempt).includes('private'), false);
      assert.equal(JSON.stringify(attempt).includes('refresh'), false);
      assert.equal(h.logs.length, 0);
    }
  }
});
test('pending PlaceOrder retains account/live ownership', async () => {
  const h = harness({ clock: true });
  const data = input();
  h.state.hang = 'place';
  h.state.responses.accounts = {
    Accounts: [{ AccountID: 'EXT-1' }, { AccountID: 'EXT-2' }],
  };
  const pending = h.invoke('submit', data);
  await flush();
  assert.equal(h.postCount(), 1);
  const before = h.calls.length;
  for (const changed of [
    data,
    { ...data, account: 'EXT-2' },
    { ...data, live: false },
    { ...data, account: 'EXT-2', live: false, credentials: null },
  ]) {
    assert.equal((await h.invoke('submit', changed)).state, 'ambiguous');
    assert.equal(h.calls.length, before);
  }
  h.time.advance(12000);
  assert.equal((await pending).state, 'ambiguous');
  assert.equal((await h.invoke('submit', data)).state, 'ambiguous');
  assert.equal(h.postCount(), 1);
  assert.equal(h.time.pending(), 0);
});
test('registered lookup closes account/live identity conflicts', async () => {
  for (const loss of [false, true]) {
    const h = harness();
    const data = input();
    h.state.loss = loss;
    await h.invoke('submit', data);
    const attempt = h.globals.domain.execution.attempts.get(data);
    const saved = plain(attempt);
    const before = h.calls.length;
    for (const changed of [
      { account: 'EXT-2' },
      { live: false },
      { account: 'EXT-2', live: false },
    ]) {
      for (const broker of [{}, { brokerId: 'B-1' }, { brokerId: 'OTHER' }]) {
        const result = await h.invoke('lookup', {
          ...data,
          ...changed,
          ...broker,
          credentials: {
            ...data.credentials,
            refresh_token: 'changed-refresh',
          },
        });
        assert.equal(result.state, 'source_unavailable');
        assert.equal(h.calls.length, before);
        assert.equal(
          h.globals.domain.execution.attempts.get({ ...data, ...changed }),
          attempt,
        );
        assert.deepEqual(plain(attempt), saved);
      }
    }
    assert.equal(
      (await h.invoke('lookup', { ...data, brokerId: 'B-1' })).state,
      'found',
    );
    assert.deepEqual(plain(attempt), saved);
    assert.deepEqual(plain(await h.invoke('submit', data)), saved.result);
    assert.equal(h.postCount(), 1);
  }
});
test('lost response and restart allow only known OrderID lookup', async () => {
  for (const data of [input(), extendedInput()]) {
    const h = harness();
    h.state.loss = true;
    assert.equal((await h.invoke('submit', data)).state, 'ambiguous');
    const before = h.calls.length;
    assert.equal((await h.invoke('lookup', data)).state, 'source_unavailable');
    assert.equal((await h.invoke('submit', data)).state, 'ambiguous');
    h.restart();
    assert.equal((await h.invoke('lookup', data)).state, 'source_unavailable');
    assert.equal(h.calls.length, before);
    assert.equal(h.postCount(), 1);
    assert.equal(
      (await h.invoke('lookup', { ...data, brokerId: 'B-1' })).state,
      'found',
    );
    assert.equal(h.postCount(), 1);
  }
});
test('brokerId conflicts close before OAuth', async () => {
  const h = harness();
  const data = input();
  await h.invoke('submit', data);
  const before = h.calls.length;
  for (const brokerId of ['OTHER', '', null, {}, ['B-1']]) {
    assert.equal(
      (await h.invoke('lookup', { ...data, brokerId })).state,
      'source_unavailable',
    );
  }
  assert.equal(h.calls.length, before);
  assert.equal(h.postCount(), 1);
});
test('invalid first intent and credentials cannot place', async () => {
  const h = harness();
  const data = input();
  const variants = [
    { ...data, account: '../OTHER' },
    { ...data, live: 'true' },
    { ...data, credentials: null },
    { ...data, credentials: { ...data.credentials, refresh_token: '' } },
    { ...data, intent: { ...data.intent, relation: 'BRK', related: [{}] } },
    { ...data, intent: { ...data.intent, quantity: 0 } },
    { ...data, intent: { ...data.intent, quantity: '2' } },
    { ...data, intent: { ...data.intent, type: {} } },
    { ...data, intent: { ...data.intent, limitPrice: 50 } },
    { ...data, intent: { ...data.intent, extended: 'false' } },
    { ...data, intent: { ...data.intent, assetCategory: 'FUT' } },
    { ...data, intent: { ...data.intent, symbol: '' } },
  ];
  for (const invalid of variants) {
    assert.equal((await h.invoke('submit', invalid)).state, 'rejected');
  }
  assert.equal(h.calls.length, 0);
});
test('extended limit/gtc uses GCP with either credential source', async () => {
  for (const connector of [false, true]) {
    const h = connector ? await connectorHarness() : harness();
    const data = connector ? connectorInput('submit') : extendedInput();
    data.intent = extendedInput().intent;
    const result = await h.invoke('submit', data);
    assert.equal(result.state, 'acknowledged');
    assert.equal(h.postCount(), 1);
    const placed = h.calls.find((call) => call.stage === 'place');
    assert.equal(placed.options.method, 'POST');
    assert.deepEqual(JSON.parse(placed.options.body), {
      AccountID: data.account,
      Symbol: 'AAPL',
      Quantity: '2',
      OrderType: 'Limit',
      TimeInForce: { Duration: 'GCP' },
      OrderConfirmID: 'meta-17',
      LimitPrice: '125.5',
      TradeAction: 'BUY',
    });
    if (connector) {
      assert.deepEqual(plain(h.logs), [
        ['getClient:', { name: 'ptfin', syncBrokerageStreams: false }],
      ]);
      safeConnector(h, result);
    } else {
      assert.deepEqual(h.logs, []);
    }
  }
});
test('extended first intent rejects before requests', async () => {
  for (const connector of [false, true]) {
    const h = connector ? await connectorHarness() : harness();
    const data = connector ? connectorInput('submit') : extendedInput();
    data.intent = extendedInput().intent;
    const changes = [
      ...['market', 'stop', 'stop_limit', 'unsupported'].map((type) => ({
        type,
        limitPrice: type === 'stop_limit' ? 125.5 : null,
        stopPrice: ['stop', 'stop_limit'].includes(type) ? 120 : null,
      })),
      ...['day', 'ioc', 'fok', 'unsupported'].map((tif) => ({ tif })),
      ...[undefined, null, 'true', 'false', 0, 1, {}].map((extended) => ({
        extended,
      })),
      ...[undefined, null, 0, -1, NaN, Infinity, '125.5'].map((limitPrice) => ({
        limitPrice,
      })),
      ...[0, 0.5, Number.MAX_SAFE_INTEGER + 1, '2'].map((quantity) => ({
        quantity,
      })),
      { stopPrice: 120 },
    ];
    for (const change of changes) {
      assert.equal(
        (
          await h.invoke('submit', {
            ...data,
            intent: { ...data.intent, ...change },
          })
        ).state,
        'rejected',
      );
      assert.equal(h.calls.length, 0);
      assert.equal(h.globals.domain.execution.attempts.get(data), null);
    }
    if (connector) assert.equal(h.lifecycle.get.length, 0);
  }
});
test('regular intents keep DAY/GTC/IOC/FOK and prices', async () => {
  const types = {
    market: 'Market',
    limit: 'Limit',
    stop: 'StopMarket',
    stop_limit: 'StopLimit',
  };
  for (const [type, nativeType] of Object.entries(types)) {
    for (const [tif, duration] of Object.entries({
      day: 'DAY',
      gtc: 'GTC',
      ioc: 'IOC',
      fok: 'FOK',
    })) {
      const h = harness();
      const data = input();
      data.intent = {
        ...data.intent,
        type,
        tif,
        limitPrice: ['limit', 'stop_limit'].includes(type) ? 125.5 : null,
        stopPrice: ['stop', 'stop_limit'].includes(type) ? 120 : null,
      };
      assert.equal((await h.invoke('submit', data)).state, 'acknowledged');
      assert.equal(h.postCount(), 1);
      const body = JSON.parse(
        h.calls.find((call) => call.stage === 'place').options.body,
      );
      assert.equal(body.OrderType, nativeType);
      assert.deepEqual(body.TimeInForce, { Duration: duration });
      assert.equal(body.Quantity, '2');
      assert.equal(body.LimitPrice, data.intent.limitPrice?.toString());
      assert.equal(body.StopPrice, data.intent.stopPrice?.toString());
    }
  }
});
test('extended concurrency and replays keep one POST', async () => {
  for (const [connector, loss] of [
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ]) {
    const h = connector ? await connectorHarness() : harness();
    const data = connector ? connectorInput('submit') : extendedInput();
    data.intent = extendedInput().intent;
    h.state.loss = loss;
    const [first, parallel] = await Promise.all([
      h.invoke('submit', data),
      h.invoke('submit', data),
    ]);
    assert.equal(first.state, loss ? 'ambiguous' : 'acknowledged');
    assert.equal(parallel.state, 'ambiguous');
    const before = h.calls.length;
    assert.deepEqual(plain(await h.invoke('submit', data)), plain(first));
    for (const change of [
      { extended: false },
      { extended: 'true' },
      { type: 'market' },
      { tif: 'day' },
      { quantity: 3 },
      { limitPrice: 126 },
    ]) {
      assert.equal(
        (
          await h.invoke('submit', {
            ...data,
            intent: { ...data.intent, ...change },
          })
        ).state,
        'ambiguous',
      );
    }
    assert.equal(h.calls.length, before);
    if (!loss) assert.equal((await h.invoke('lookup', data)).state, 'found');
    assert.equal(h.postCount(), 1);
    if (connector) safeConnector(h, first, parallel);
  }
});
test('invalid orderId and exceptions are never reflected', async () => {
  const h = harness();
  for (const orderId of [input(), [], 'private-secret', null, -1, NaN, {}]) {
    for (const action of ['submit', 'lookup']) {
      const result = await h.invoke(action, { ...input(), orderId });
      assert.equal(result.orderId, null);
      assert.equal(JSON.stringify(result).includes('private'), false);
    }
  }
  h.globals.lib.execution.handle = () => {
    throw new Error('private-secret private-access raw exception');
  };
  for (const action of ['submit', 'lookup']) {
    const result = await h.invoke(action, { ...input(), orderId: input() });
    assert.equal(result.orderId, null);
    assert.equal(JSON.stringify(result).includes('private'), false);
  }
  assert.equal(h.logs.length, 0);
  assert.equal(h.calls.length, 0);
});
test('exact account membership and live/sim host are checked', async () => {
  for (const live of [true, false]) {
    const h = harness();
    assert.equal(
      (await h.invoke('submit', { ...input(), live })).state,
      'acknowledged',
    );
    assert.equal(
      h.calls
        .filter((call) => call.stage !== 'oauth')
        .every((call) =>
          call.url.startsWith(
            live
              ? 'https://api.tradestation.com/v3/'
              : 'https://sim-api.tradestation.com/v3/',
          ),
        ),
      true,
    );
  }
  const invalid = [
    { Accounts: [{ AccountID: 'OTHER' }] },
    { Accounts: [] },
    { Accounts: [null] },
    { Accounts: [{ AccountID: 'EXT-1' }, { AccountID: 'EXT-1' }] },
    { Accounts: [{ AccountID: 'EXT-1' }, {}] },
    { Accounts: [{ AccountID: 'EXT-1' }], Errors: {} },
    { Accounts: [{ AccountID: 'EXT-1' }], Errors: ['failure'] },
    { Accounts: [{ AccountID: 'EXT-1', Error: 'FAILED' }] },
    { Accounts: [{ AccountID: 'EXT-1' }], Error: 'FAILED' },
    { Accounts: [{ AccountID: 'EXT-1' }], AccountID: 'OTHER' },
    { Accounts: [{ AccountID: 'EXT-1' }], NextToken: 'more' },
  ];
  for (const body of invalid) {
    const h = harness();
    h.state.responses.accounts = body;
    assert.equal((await h.invoke('submit', input())).state, 'rejected');
    assert.equal(h.postCount(), 0);
    assert.equal(
      h.calls.some((call) => call.stage === 'positions'),
      false,
    );
  }
});
test('invalid positions block PlaceOrder', async () => {
  const position = { AccountID: 'EXT-1', Symbol: 'AAPL', Quantity: '2' };
  const bodies = [
    null,
    [],
    {},
    { Positions: null },
    { Positions: [null] },
    { Positions: [{ ...position, AccountID: 'OTHER' }] },
    { Positions: [position, { ...position, Symbol: 'OTHER', Quantity: null }] },
    { Positions: [{ ...position, Quantity: '2', LongShort: 'Short' }] },
    { Positions: [position], Errors: { length: 0 } },
    { Positions: [position], Errors: null },
    { Positions: [position], Errors: 'error' },
    { Positions: [position], Errors: [{ Error: 'FAILED' }] },
    { Positions: [position], Error: 'FAILED' },
    { Positions: [position], AccountID: 'OTHER' },
    { Positions: [position], NextToken: 'more' },
    { Positions: [{ ...position, Symbol: '' }] },
    { Positions: [{ ...position, Symbol: ' AAPL ' }] },
    { Positions: [{ ...position, Deleted: true }] },
    ...[null, 0, '', 'false'].map((Deleted) => ({
      Positions: [{ ...position, Deleted }],
    })),
    { Positions: [position, { ...position, Quantity: '-2' }] },
    {
      Positions: [
        { ...position, PositionID: 'P-1' },
        { ...position, PositionID: 'P-1' },
      ],
    },
    ...[null, '', ' ', false, [], {}, 'NaN', 'Infinity', '0x10', Infinity].map(
      (Quantity) => ({ Positions: [{ ...position, Quantity }] }),
    ),
  ];
  for (const body of bodies) {
    const h = harness();
    h.state.responses.positions = body;
    assert.equal((await h.invoke('submit', input())).state, 'rejected');
    assert.equal(h.postCount(), 0);
  }
});
test('signed positions and option symbols determine TradeAction', async () => {
  for (const [category, symbol, current, quantity, action] of [
    ['STK', 'AAPL', '-3', 2, 'BUYTOCOVER'],
    ['STK', 'AAPL', '3', -2, 'SELL'],
    ['OPT', 'FSLR261218C270000', '-3', 2, 'BUYTOCLOSE'],
    ['OPT', 'FSLR261218C270000', '3', -2, 'SELLTOCLOSE'],
  ]) {
    const h = harness();
    const tsSymbol = h.globals.lib.utils.makeTSSymbol(symbol, category);
    h.state.responses.positions = {
      Positions: [{ AccountID: 'EXT-1', Symbol: tsSymbol, Quantity: current }],
      Errors: [],
    };
    const data = input();
    data.intent = {
      ...data.intent,
      symbol,
      assetCategory: category,
      quantity,
    };
    assert.equal((await h.invoke('submit', data)).state, 'acknowledged');
    const posted = JSON.parse(
      h.calls.find((call) => call.stage === 'place').options.body,
    );
    assert.equal(posted.TradeAction, action);
    assert.equal(posted.Symbol, tsSymbol);
  }
  const h = harness();
  h.state.responses.positions = {
    Positions: [{ AccountID: 'EXT-1', Symbol: 'AAPL', Quantity: '-1' }],
  };
  assert.equal((await h.invoke('submit', input())).state, 'rejected');
  assert.equal(h.postCount(), 0);
});
test('only one verified OrderID acknowledges', async () => {
  for (const body of [
    null,
    [],
    {},
    { Orders: [] },
    { Orders: [null] },
    { Orders: [{ OrderID: '' }] },
    { Orders: [{ OrderID: {} }] },
    { Orders: [{ OrderID: 'B-1' }, { OrderID: 'B-2' }] },
    { Orders: [{ OrderID: 'B-1' }], Errors: [{ Error: 'FAILED' }] },
    { Orders: [{ OrderID: 'B-1' }], Errors: {} },
    { Orders: [{ OrderID: 'B-1' }], Error: 'FAILED' },
    { Orders: [{ OrderID: 'B-1', Error: 'FAILED' }] },
    { Orders: [{ OrderID: 'B-1', AccountID: 'OTHER' }] },
    { Orders: [{ OrderID: 'B-1' }], AccountID: 'OTHER' },
    { Orders: [{ OrderID: 'B-1', Status: 'REJ' }] },
    { Orders: [{ OrderID: 'B-1' }], OrderID: 'B-2' },
    { Orders: [{ OrderID: 'B-1' }], NextToken: 'more' },
  ]) {
    const h = harness();
    h.state.responses.place = body;
    assert.equal((await h.invoke('submit', input())).state, 'ambiguous');
    assert.equal((await h.invoke('submit', input())).state, 'ambiguous');
    assert.equal(h.postCount(), 1);
  }
  for (const status of [0, 400, 401, 429, 500]) {
    const h = harness();
    h.state.statuses.place = status;
    assert.equal((await h.invoke('submit', input())).state, 'ambiguous');
    assert.equal(h.postCount(), 1);
  }
});
test('current then history uses exact account and OrderID', async () => {
  const h = harness();
  h.state.responses.current = { Orders: [], Errors: [] };
  const data = { ...input(), brokerId: 'B-1' };
  assert.equal((await h.invoke('lookup', data)).state, 'found');
  assert.deepEqual(
    h.calls.map((call) => call.stage),
    ['oauth', 'current', 'historical'],
  );
  assert.equal(
    h.calls[1].url.endsWith('/brokerage/accounts/EXT-1/orders/B-1'),
    true,
  );
  assert.match(
    h.calls[2].url,
    /\/EXT-1\/historicalorders\/B-1\?since=\d{4}-\d{2}-\d{2}$/,
  );
  assert.equal(h.postCount(), 0);
});
test('empty or unproven lookup never becomes not_found', async () => {
  const bad = [
    null,
    [],
    {},
    { Orders: null },
    { Orders: [null] },
    { Orders: [order({ AccountID: 'OTHER' })] },
    { Orders: [order({ OrderID: 'B-2' })] },
    { Orders: [order(), order()] },
    { Orders: [order({ Status: 'UNKNOWN' })] },
    { Orders: [order({ Status: 'toString' })] },
    { Orders: [order()], Errors: {} },
    { Orders: [order()], Errors: null },
    { Orders: [order()], Errors: [{ Error: 'FAILED' }] },
    { Orders: [order()], Error: 'FAILED' },
    { Orders: [order()], AccountID: 'OTHER' },
    { Orders: [order()], OrderID: 'B-2' },
    { Orders: [order({ Error: 'FAILED' })] },
    { Orders: [order()], NextToken: 'more' },
    { Orders: [] },
  ];
  for (const stage of ['current', 'historical']) {
    for (const body of bad) {
      const h = harness();
      if (stage === 'historical') h.state.responses.current = { Orders: [] };
      h.state.responses[stage] = body;
      h.state.responses.historical =
        stage === 'historical' ? body : { Orders: [] };
      assert.equal(
        (await h.invoke('lookup', { ...input(), brokerId: 'B-1' })).state,
        'source_unavailable',
      );
      assert.equal(h.postCount(), 0);
    }
  }
  for (const status of [0, 404, 429, 500]) {
    const h = harness();
    h.state.statuses.current = status;
    assert.equal(
      (await h.invoke('lookup', { ...input(), brokerId: 'B-1' })).state,
      'source_unavailable',
    );
  }
});
test('broker states normalize in current and historical lookup', async () => {
  const states = {
    OPN: 'pending',
    DON: 'pending',
    PLA: 'pending',
    ACK: 'accepted',
    FPR: 'part_filled',
    FLL: 'filled',
    CAN: 'cancelled',
    OUT: 'cancelled',
    TSC: 'cancelled',
    REJ: 'rejected',
    EXP: 'expired',
  };
  for (const stage of ['current', 'historical']) {
    for (const [Status, expected] of Object.entries(states)) {
      const h = harness();
      if (stage === 'historical') h.state.responses.current = { Orders: [] };
      h.state.responses[stage] = { Orders: [order({ Status })], Errors: [] };
      const result = await h.invoke('lookup', { ...input(), brokerId: 'B-1' });
      assert.equal(result.state, 'found');
      assert.equal(result.broker.state, expected);
    }
  }
});
test('rotation survives errors and uncertain outcomes', async () => {
  const scenarios = [
    ['submit', 'accounts', { Accounts: [] }, 'rejected'],
    ['submit', 'positions', { Positions: [], Errors: {} }, 'rejected'],
    ['submit', 'place', new Error('private-secret'), 'ambiguous'],
    ['lookup', 'current', { Orders: null }, 'source_unavailable'],
  ];
  for (const [action, stage, body, expected] of scenarios) {
    const h = harness();
    h.state.rotate = true;
    h.state.responses[stage] = body;
    const data = { ...input(), brokerId: 'B-1' };
    const result = await h.invoke(action, data);
    assert.equal(result.state, expected);
    assert.deepEqual(plain(result.accessUpdate), {
      refresh_token: 'rotated-refresh',
    });
    const permitted = { ...plain(result) };
    delete permitted.accessUpdate;
    assert.equal(JSON.stringify(permitted).includes('private'), false);
    assert.equal(h.logs.length, 0);
    const attempt = h.globals.domain.execution.attempts.get(data);
    assert.equal(JSON.stringify(attempt).includes('rotated-refresh'), false);
    assert.equal(JSON.stringify(attempt).includes('private'), false);
  }
  const h = harness();
  h.state.rotate = true;
  h.globals.lib.execution.protocol = () => {
    throw new Error('private-secret protocol failure');
  };
  const result = await h.invoke('submit', input());
  assert.equal(result.state, 'rejected');
  assert.equal(result.accessUpdate.refresh_token, 'rotated-refresh');
  assert.equal(h.postCount(), 0);
});
test('rotation returns only in the authenticated owner response', async () => {
  const h = harness();
  h.state.rotate = true;
  const data = input();
  assert.equal(
    (await h.invoke('submit', data, { identity: 'bad' })).accessUpdate,
    undefined,
  );
  const first = await h.invoke('submit', data);
  assert.equal(first.accessUpdate.refresh_token, 'rotated-refresh');
  assert.equal(first.accessUpdate.access_token, undefined);
  const repeated = await h.invoke('submit', data);
  assert.equal(repeated.state, 'acknowledged');
  assert.equal(repeated.accessUpdate, undefined);
  h.state.responses.oauth = {
    access_token: 'private-access',
    refresh_token: 'private-refresh',
  };
  assert.equal(
    (await h.invoke('lookup', { ...data, brokerId: 'B-1' })).accessUpdate,
    undefined,
  );
});
test('invalid OAuth responses stop before account or order calls', async () => {
  for (const token of [
    null,
    [],
    {},
    { access_token: '' },
    { access_token: 'private-access', error: 'invalid_grant' },
    { access_token: 'private-access', refresh_token: {} },
  ]) {
    const h = harness();
    h.state.responses.oauth = token;
    assert.equal((await h.invoke('submit', input())).state, 'rejected');
    assert.equal(h.calls.length, 1);
    assert.equal(h.postCount(), 0);
  }
});
test('shared deadline prevents PlaceOrder after slow preflight', async () => {
  for (const stage of ['oauth', 'accounts', 'positions']) {
    const h = harness({ clock: true });
    h.state.rotate = true;
    h.state.delays[stage] = 19000;
    const started = h.time.Date.now();
    const result = await h.invoke('submit', input());
    assert.equal(result.state, 'rejected');
    assert.equal(h.postCount(), 0);
    assert.equal(
      h.calls.every((call) => call.at < started + 18000),
      true,
    );
    if (stage !== 'oauth') {
      assert.equal(result.accessUpdate.refresh_token, 'rotated-refresh');
    }
    assert.equal(h.time.pending(), 0);
  }
  const h = harness({ clock: true });
  h.state.rotate = true;
  h.state.delays = { oauth: 6000, accounts: 6000, positions: 7000 };
  const result = await h.invoke('submit', input());
  assert.equal(result.state, 'rejected');
  assert.equal(result.accessUpdate.refresh_token, 'rotated-refresh');
  assert.equal(h.postCount(), 0);
});
test('PlaceOrder timeout is ambiguous and preserves rotation', async () => {
  for (const json of [false, true]) {
    const h = harness({ clock: true });
    h.state.rotate = true;
    h.state.delays = { oauth: 5000, accounts: 5000, positions: 5000 };
    if (json) h.state.jsonHang = 'place';
    else h.state.hang = 'place';
    const started = h.time.Date.now();
    const pending = h.invoke('submit', input());
    await flush();
    assert.equal(h.postCount(), 1);
    h.time.advance(3000);
    const result = await pending;
    assert.equal(h.time.Date.now() - started, 18000);
    assert.equal(result.state, 'ambiguous');
    assert.equal(result.accessUpdate.refresh_token, 'rotated-refresh');
    assert.equal(
      h.calls.find((call) => call.stage === 'place').at < started + 18000,
      true,
    );
    assert.equal((await h.invoke('submit', input())).state, 'ambiguous');
    assert.equal(h.postCount(), 1);
    assert.equal(h.time.pending(), 0);
  }
});
test('lookup shares one deadline across OAuth and both reads', async () => {
  const h = harness({ clock: true });
  h.state.rotate = true;
  h.state.responses.current = { Orders: [] };
  h.state.delays = { oauth: 7000, current: 7000 };
  h.state.jsonHang = 'historical';
  const pending = h.invoke('lookup', { ...input(), brokerId: 'B-1' });
  await flush();
  h.time.advance(4000);
  const result = await pending;
  assert.equal(result.state, 'source_unavailable');
  assert.equal(result.accessUpdate.refresh_token, 'rotated-refresh');
  assert.equal(h.postCount(), 0);
});
test('transport guards deadline and sanitizes JSON failures', async () => {
  const h = harness({ clock: true });
  const request = h.globals.lib.execution.request;
  assert.deepEqual(
    plain(await request({ url: 'https://example.invalid', deadline: 0 })),
    { status: 0, body: null, started: false },
  );
  assert.equal(h.calls.length, 0);
  h.globals.fetch = async () => ({
    status: 200,
    json: async () => {
      throw new Error('private-access invalid JSON');
    },
  });
  const response = await request({
    url: 'https://example.invalid',
    deadline: h.time.Date.now() + 1000,
  });
  assert.deepEqual(plain(response), { status: 0, body: null, started: true });
  assert.equal(h.logs.length, 0);
});
test('late transport responses cannot beat delayed timers', async () => {
  for (const stage of ['headers', 'body']) {
    const h = harness({ clock: true });
    let now = h.time.Date.now();
    const deadline = now + 18000;
    h.time.Date.now = () => now;
    h.globals.fetch = async () => {
      if (stage === 'headers') now += 12000;
      return {
        status: 200,
        json: async () => {
          if (stage === 'body') now += 12000;
          return { Orders: [{ OrderID: 'B-1' }] };
        },
      };
    };
    const result = await h.globals.lib.execution.request({
      url: 'https://example.invalid',
      deadline,
    });
    assert.deepEqual(plain(result), { status: 0, body: null, started: true });
    assert.equal(h.time.pending(), 0);
    assert.equal(h.logs.length, 0);
  }
});
test('late PlaceOrder stays ambiguous without another send', async () => {
  const h = harness({ clock: true });
  h.state.rotate = true;
  const fetch = h.globals.fetch;
  let now = h.time.Date.now();
  h.time.Date.now = () => now;
  h.globals.fetch = async (url, options) => {
    const response = await fetch(url, options);
    if (url.endsWith('/orderexecution/orders')) now += 18000;
    return response;
  };
  const result = await h.invoke('submit', input());
  assert.equal(result.state, 'ambiguous');
  assert.equal(result.accessUpdate.refresh_token, 'rotated-refresh');
  assert.equal((await h.invoke('submit', input())).state, 'ambiguous');
  assert.equal(h.postCount(), 1);
  assert.equal(h.time.pending(), 0);
});
test('generic Impress hook logs only safe execution fields', () => {
  const h = harness();
  const hook = load('api/hook.1.js', h.globals);
  for (const action of ['submit', 'lookup', 'capabilities', 'rules']) {
    const method = `execution/${action}`;
    const args = Object.defineProperty(input(), 'credentials', {
      get: () => assert.fail('hook accessed execution credentials'),
    });
    hook.router({
      method,
      args,
      verb: 'POST',
      headers: { Authorization: 'private-service-token' },
    });
    assert.deepEqual(plain(h.logs.at(-1)), [
      { method, ip: '127.0.0.1', verb: 'POST' },
    ]);
  }
  const logs = JSON.stringify(h.logs);
  assert.equal(logs.includes('private'), false);
  assert.equal(logs.includes('credentials'), false);
  assert.equal(logs.includes('Authorization'), false);
});
test('generic Impress hook preserves logging for other methods', () => {
  const h = harness();
  const hook = load('api/hook.1.js', h.globals);
  const args = { symbol: 'AAPL' };
  const headers = { 'content-type': 'application/json' };
  hook.router({ method: 'marketdata/quotes', args, verb: 'POST', headers });
  assert.deepEqual(plain(h.logs), [
    [
      {
        method: 'marketdata/quotes',
        args,
        ip: '127.0.0.1',
        verb: 'POST',
        headers,
      },
    ],
  ]);
});
test('installed Impress/Metacom dispatch the protected HTTP hook', async () => {
  const { Api } = require(path.join(root, 'node_modules/impress/lib/api.js'));
  const { Server } = require(
    path.join(root, 'node_modules/metacom/lib/server.js'),
  );
  const { metarhia } = require(
    path.join(root, 'node_modules/impress/lib/deps.js'),
  );
  const h = await connectorHarness();
  h.state.account = 'EXT-1';
  const sandbox = metarhia.metavm.createContext({
    ...metarhia.metavm.COMMON_CONTEXT,
    ...h.globals,
    api: {},
  });
  const application = {
    absolute: (name) => path.join(root, 'application', name),
    config: { server: { timeouts: { request: 25000 } } },
    semaphore: { enter: async () => {}, leave: () => {} },
    console: h.globals.console,
    sandbox,
    getHook: (name) => application.api.collection[name]?.['1']?.router,
  };
  application.api = new Api('api', application);
  await application.api.change(
    path.join(root, 'application/api/execution.1.js'),
  );
  let pending;
  let response;
  const client = {
    ip: '127.0.0.1',
    createContext: () => ({ client }),
    send: (value) => {
      response = value;
    },
    error: () => assert.fail('runtime escaped the protected boundary'),
  };
  const server = {
    application,
    console: h.globals.console,
    hook: (...args) => {
      pending = Server.prototype.hook.call(server, ...args);
    },
    rpc: () => assert.fail('execution unexpectedly dispatched as public RPC'),
  };
  const invoke = async (action, data, identity = 'metaterminal-execution') => {
    const transport = {
      req: {
        method: 'POST',
        url: `/api/execution/${action}`,
        headers: {
          authorization: `Bearer ${'s'.repeat(32)}`,
          'x-service-identity': identity,
        },
      },
    };
    Server.prototype.request.call(
      server,
      client,
      transport,
      JSON.stringify(data),
    );
    await pending;
    return response;
  };
  assert.equal(
    (await invoke('submit', input(), 'wrong')).state,
    'unauthorized',
  );
  assert.equal(h.calls.length, 0);
  assert.equal((await invoke('capabilities', {})).restart_safe, false);
  assert.equal(
    (await invoke('rules', rulesInput(), 'wrong')).state,
    'unauthorized',
  );
  const ready = plain(await invoke('rules', rulesInput()));
  assert.equal(ready.state, 'ready');
  assert.equal(ready.quantity.maximum, 'infinity');
  assert.deepEqual(plain(await invoke('rules', {})), {
    version: 1,
    state: 'unavailable',
    reason: 'invalid_request',
  });
  assert.equal((await invoke('submit', input())).state, 'acknowledged');
  assert.equal((await invoke('submit', input())).state, 'acknowledged');
  assert.equal(h.postCount(), 1);
  h.restart();
  h.state.account = 'SIM2811593M';
  const connectorReady = await invoke('rules', connectorInput('rules'));
  const connectorSubmit = await invoke('submit', connectorInput('submit'));
  const connectorLookup = await invoke('lookup', connectorInput('lookup'));
  assert.equal(connectorReady.state, 'ready');
  assert.equal(connectorSubmit.state, 'acknowledged');
  assert.equal(connectorLookup.state, 'found');
  assert.equal(h.postCount(), 2);
  assert.equal(h.lifecycle.refreshes, 0);
  safeConnector(h, connectorReady, connectorSubmit, connectorLookup);
  assert.equal(JSON.stringify(h.logs).includes('private'), false);
});

test('regular broker fixture returns ready with infinity', async () => {
  const h = harness();
  Object.defineProperty(h.globals.domain.execution, 'attempts', {
    get: () => assert.fail('rules accessed placement receipts'),
  });
  const data = rulesInput();
  const result = plain(await h.invoke('rules', data));
  assert.deepEqual(result, expectedRules(data));
  assert.deepEqual(
    h.calls.map(({ stage }) => stage),
    ['oauth', 'accounts', 'details', 'routes'],
  );
  for (const call of h.calls.slice(1)) {
    assert.ok(call.url.startsWith('https://api.tradestation.com/v3/'));
    assert.equal(call.options.method, 'GET');
    assert.equal(Object.hasOwn(call.options, 'body'), false);
  }
  assert.equal(h.postCount(), 0);
  assert.deepEqual(h.logs, []);
});

test('common ready wire includes approved sessions and exact maximum', () => {
  const h = harness();
  const data = rulesInput();
  // Synthetic confirmed finite bound tests wire assembly; production evidence
  // above has no applicable finite bound and serializes infinity.
  const quantity = {
    fractional: false,
    minimum: '1',
    step: '1',
    maximum: '1000',
    minimumNotional: null,
  };
  const instrument = symbolDetails().Symbols[0];
  const result = plain(
    h.globals.lib.execution.rulesReady({
      data,
      instrument,
      quantity,
      price: h.globals.lib.execution.priceRules(instrument.PriceFormat),
    }),
  );
  assert.deepEqual(result, {
    version: 1,
    state: 'ready',
    identity: { terminal: 'TS', externalAccount: 'EXT-1', live: true },
    instrument: data.instrument,
    orders: [
      { type: 'market', tif: 'day', sessions: ['regular'] },
      {
        type: 'limit',
        tif: 'gtc',
        sessions: ['regular', 'pre_market', 'post_market'],
      },
    ].map((order) => ({
      ...order,
      relation: 'NORMAL',
      orderClass: 'simple',
      quantityMode: 'whole',
      side: 'buy',
      positionEffect: 'open',
      quantity,
    })),
    quantity: { fractional: false, ...quantity },
    price: {
      rules: [
        {
          minInclusive: '0',
          maxExclusive: null,
          tick: '0.01',
          precision: 2,
          rounding: 'nearest_half_up',
        },
      ],
    },
  });
  for (const row of result.orders) {
    assert.equal(Object.hasOwn(row, 'session'), false);
    assert.equal(Object.hasOwn(row, 'extended'), false);
  }
  assert.equal(h.calls.length, 0);
  assert.equal(h.postCount(), 0);
  assert.deepEqual(h.logs, []);
});

test('unconfirmed bounds use infinity; sessions require proof', async () => {
  for (const maximum of [
    undefined,
    null,
    '1000',
    '9007199254740991',
    'unbounded',
  ]) {
    const h = harness();
    const details = symbolDetails();
    Object.assign(details.Symbols[0].QuantityFormat, {
      MaximumTradeQuantity: maximum,
      Maximum: maximum,
      Unbounded: true,
    });
    details.Symbols[0].Sessions = [
      'regular',
      'pre_market',
      'post_market',
      'overnight',
    ];
    h.state.responses.details = details;
    const data = rulesInput();
    data.instrument.maximum = maximum;
    data.instrument.session = 'overnight';
    data.quantity = { maximum };
    assert.deepEqual(plain(await h.invoke('rules', data)), expectedRules(data));
    assert.equal(h.postCount(), 0);
    assert.deepEqual(h.logs, []);
  }
});

test('ready preserves exact finite maximum and literal infinity', () => {
  const h = harness();
  const instrument = symbolDetails().Symbols[0];
  const assemble = (quantity) =>
    plain(
      h.globals.lib.execution.rulesReady({
        data: rulesInput(),
        instrument,
        quantity: {
          fractional: false,
          minimum: '1',
          step: '1',
          minimumNotional: null,
          ...quantity,
        },
        price: h.globals.lib.execution.priceRules(instrument.PriceFormat),
      }),
    );
  for (const maximum of [
    '',
    '0',
    '+1',
    '-1',
    '1e3',
    ' 1000',
    '1.5',
    1000,
    'unbounded',
    'Infinity',
    Infinity,
    'infinity ',
    '9'.repeat(257),
  ]) {
    assert.deepEqual(assemble({ maximum }), {
      version: 1,
      state: 'unavailable',
      reason: 'quantity_unconfirmed',
    });
  }
  for (const quantity of [
    { minimum: '1001', maximum: '1000' },
    { minimum: undefined },
    { minimum: '0' },
    { step: undefined },
    { step: '0' },
    { step: '0.5' },
    { fractional: undefined },
    { fractional: null },
    { fractional: true },
    { fractional: 'false' },
  ]) {
    assert.equal(assemble(quantity).state, 'unavailable');
  }
  for (const [maximum, expected] of [
    [undefined, 'infinity'],
    [null, 'infinity'],
    ['infinity', 'infinity'],
    ['0001000.000', '1000'],
    ['9007199254740990', '9007199254740990'],
    ['9007199254740991', '9007199254740991'],
    ['9007199254740992', '9007199254740992'],
    ['999999999999999999999999999999999', '999999999999999999999999999999999'],
  ]) {
    const quantity = { maximum };
    const result = assemble(quantity);
    assert.deepEqual(result, expectedRules(rulesInput(), expected));
    for (const row of result.orders) {
      assert.equal(row.quantity.maximum, expected);
      assert.equal(row.quantity.fractional, row.quantityMode === 'fractional');
      assert.equal(Object.hasOwn(row, 'session'), false);
      assert.equal(Object.hasOwn(row, 'extended'), false);
    }
    assert.deepEqual(quantity, { maximum });
  }
  // Broker rules retain exact minimum/step too; concrete order safety is T-068.
  assert.equal(
    assemble({ minimum: '9007199254740992' }).quantity.minimum,
    '9007199254740992',
  );
  assert.equal(
    assemble({ step: '9007199254740992' }).quantity.step,
    '9007199254740992',
  );
  assert.equal(h.calls.length, 0);
});

test('Intelligent range requires proof for every combination', () => {
  const h = harness();
  const instrument = symbolDetails().Symbols[0];
  const orders = expectedRules(rulesInput()).orders.map(
    ({ quantity, ...order }) => {
      assert.equal(quantity.maximum, 'infinity');
      return order;
    },
  );
  // Synthetic authoritative applicability proof, NOT a GetRoutes response.
  // The official page conditions its range on the chosen downstream route.
  const applicability = {
    source:
      'https://help.tradestation.com/10_00/eng/tradestationhelp/routes/intelligent.htm',
    symbol: 'MSFT',
    exchange: 'NASDAQ',
    apiDefaultRoute: 'Intelligent',
    selectedRoute: 'synthetic-confirmed-route',
    minimum: '1',
    maximum: '1000000',
    combinations: orders.map((row) => ({
      ...row,
      sessions: [...row.sessions],
    })),
  };
  const evaluate = (changes = {}) =>
    h.globals.lib.execution.intelligentMaximum({
      instrument,
      route: 'Intelligent',
      orders,
      applicability,
      ...changes,
    });
  assert.equal(evaluate(), '1000000');
  for (const proof of [
    undefined,
    null,
    {},
    { ...applicability, source: 'client' },
    { ...applicability, symbol: 'AAPL' },
    { ...applicability, exchange: 'NYSE' },
    { ...applicability, apiDefaultRoute: 'ARCA' },
    { ...applicability, selectedRoute: undefined },
    { ...applicability, selectedRoute: '' },
    { ...applicability, minimum: undefined },
    { ...applicability, maximum: undefined },
    { ...applicability, maximum: '9007199254740991' },
    { ...applicability, combinations: undefined },
    { ...applicability, combinations: [orders[0]] },
    { ...applicability, combinations: [orders[1]] },
    {
      ...applicability,
      combinations: orders.map((row) => ({ ...row, sessions: ['overnight'] })),
    },
    {
      ...applicability,
      combinations: orders.map(({ sessions, ...row }) => {
        assert.ok(sessions.length);
        return { ...row, tif: 'day', session: 'regular', extended: false };
      }),
    },
    { ...applicability, combinations: [{ type: 'market' }, { type: 'limit' }] },
  ]) {
    assert.equal(evaluate({ applicability: proof }), 'infinity');
  }
  for (const changes of [
    { sessions: undefined },
    { sessions: null },
    { sessions: 'regular' },
    { sessions: [] },
    { sessions: ['regular'] },
    { sessions: ['regular', 'pre_market'] },
    { sessions: ['pre_market', 'post_market'] },
    { sessions: ['regular', 'pre_market', 'overnight'] },
    { sessions: ['regular', 'pre_market', 'post_market', 'overnight'] },
    { sessions: ['regular', 'pre_market', 'pre_market'] },
    { type: 'market' },
    { tif: 'day' },
    { relation: 'BRK' },
    { orderClass: 'bracket' },
    { quantityMode: 'fractional' },
    { side: 'sell' },
    { positionEffect: 'close' },
  ]) {
    assert.equal(
      evaluate({
        applicability: {
          ...applicability,
          combinations: [orders[0], { ...orders[1], ...changes }],
        },
      }),
      'infinity',
    );
  }
  for (const changes of [
    { route: 'ARCA' },
    { orders: [] },
    { orders: [null] },
    { orders: [{ ...orders[0], sessions: ['regular', 'pre_market'] }] },
    { orders: [{ ...orders[1], tif: 'day' }] },
    { instrument: { ...instrument, AssetType: 'STOCKOPTION' } },
    { instrument: { ...instrument, Country: 'Canada' } },
    { instrument: { ...instrument, Currency: 'CAD' } },
    { instrument: { ...instrument, Exchange: 'UNPROVEN' } },
  ]) {
    assert.equal(evaluate(changes), 'infinity');
  }
  const quantity = {
    fractional: false,
    minimum: '1',
    step: '1',
    maximum: evaluate(),
    minimumNotional: null,
  };
  const result = plain(
    h.globals.lib.execution.rulesReady({
      data: rulesInput(),
      instrument,
      quantity,
      price: h.globals.lib.execution.priceRules(instrument.PriceFormat),
    }),
  );
  assert.deepEqual(result, expectedRules(rulesInput(), '1000000'));
  assert.equal(h.calls.length, 0);
});

test('rules checks Intelligent applicability for every row', async () => {
  const h = harness();
  const evaluate = h.globals.lib.execution.intelligentMaximum;
  let checked = false;
  h.globals.lib.execution.intelligentMaximum = (context) => {
    checked = true;
    assert.equal(context.route, 'Intelligent');
    assert.equal(context.applicability, undefined);
    assert.deepEqual(
      plain(context.orders),
      expectedRules(rulesInput()).orders.map(({ quantity, ...row }) => {
        assert.equal(quantity.maximum, 'infinity');
        return row;
      }),
    );
    return evaluate(context);
  };
  const data = rulesInput();
  // Client and undocumented metadata cannot grant internal applicability.
  data.applicability = { apiDefaultRoute: 'Intelligent', maximum: '1000000' };
  const details = symbolDetails();
  details.Symbols[0].QuantityFormat.MaximumTradeQuantity = '1000000';
  details.Symbols[0].applicability = data.applicability;
  h.state.responses.details = details;
  h.state.responses.routes = {
    Routes: [
      {
        Id: 'Intelligent',
        AssetTypes: ['STOCK'],
        SelectedRoute: 'ARCA',
        Maximum: '1000000',
      },
    ],
  };
  assert.deepEqual(plain(await h.invoke('rules', data)), expectedRules(data));
  assert.equal(checked, true);
  assert.equal(h.postCount(), 0);
});

test('large finite bound preserves T-068 transport guard', async () => {
  const h = harness();
  const instrument = symbolDetails().Symbols[0];
  const ready = plain(
    h.globals.lib.execution.rulesReady({
      data: rulesInput(),
      instrument,
      quantity: {
        fractional: false,
        minimum: '1',
        step: '1',
        maximum: '9007199254740992',
        minimumNotional: null,
      },
      price: h.globals.lib.execution.priceRules(instrument.PriceFormat),
    }),
  );
  assert.deepEqual(ready, expectedRules(rulesInput(), '9007199254740992'));
  const data = input();
  data.intent.quantity = 9007199254740992;
  assert.equal((await h.invoke('submit', data)).state, 'rejected');
  assert.equal(h.calls.length, 0);
  assert.equal(h.postCount(), 0);
});

test('rules malformed requests and exceptions keep v1 envelope', async () => {
  const malformed = [null, [], false, 'private-secret', {}, input()];
  for (const changes of [
    { version: 2 },
    { account: '' },
    { account: 'EXT/1' },
    { live: 'true' },
    { credentials: [] },
    { credentials: { ...input().credentials, secret: '' } },
    { instrument: [] },
    { instrument: { ...rulesInput().instrument, currency: undefined } },
    { instrument: { ...rulesInput().instrument, currency: 1 } },
    { instrument: { ...rulesInput().instrument, exchange: '' } },
    { instrument: { ...rulesInput().instrument, assetCategory: 'OPT' } },
  ]) {
    malformed.push({ ...rulesInput(), ...changes });
  }
  for (const data of malformed) {
    const h = harness();
    assert.deepEqual(plain(await h.invoke('rules', data)), {
      version: 1,
      state: 'unavailable',
      reason: 'invalid_request',
    });
    assert.equal(h.calls.length, 0);
  }
  const h = harness();
  const poison = Object.defineProperty({}, 'instrument', {
    get: () => {
      throw new Error('private-secret schema exception');
    },
  });
  assert.deepEqual(plain(await h.invoke('rules', poison)), {
    version: 1,
    state: 'unavailable',
    reason: 'source_unavailable',
  });
  h.globals.lib.execution.rules = () => {
    throw new Error('private-secret domain exception');
  };
  const args = Object.defineProperty(rulesInput(), 'orderId', {
    get: () => assert.fail('v1 exception handler inspected orderId'),
  });
  assert.deepEqual(plain(await h.invoke('rules', args)), {
    version: 1,
    state: 'unavailable',
    reason: 'source_unavailable',
  });
  assert.equal(h.calls.length, 0);
  assert.deepEqual(h.logs, []);
});

test('rules proves live/sim account within T-068 assets', async () => {
  const unsupported = harness();
  const future = rulesInput();
  future.instrument.assetCategory = 'FUT';
  assert.deepEqual(plain(await unsupported.invoke('rules', future)), {
    version: 1,
    state: 'unsupported',
    reason: 'execution_domain',
  });
  assert.equal(unsupported.calls.length, 0);
  const sim = harness();
  const data = rulesInput();
  data.live = false;
  data.instrument.currency = null;
  const result = plain(await sim.invoke('rules', data));
  assert.deepEqual(result, expectedRules(data));
  // Null requested currency resolves to the proven broker currency in SIM.
  assert.deepEqual(
    sim.calls.map(({ stage }) => stage),
    ['oauth', 'accounts', 'details', 'routes'],
  );
  for (const call of sim.calls.slice(1)) {
    assert.ok(call.url.startsWith('https://sim-api.tradestation.com/v3/'));
  }
  // The requested ID exists only in live, not in the selected SIM environment.
  const mismatch = harness();
  const fetch = mismatch.globals.fetch;
  mismatch.globals.fetch = async (url, options) => {
    const response = await fetch(url, options);
    if (url === 'https://sim-api.tradestation.com/v3/brokerage/accounts') {
      return { status: 200, json: async () => ({ Accounts: [] }) };
    }
    return response;
  };
  assert.deepEqual(plain(await mismatch.invoke('rules', data)), {
    version: 1,
    state: 'unavailable',
    reason: 'account_unconfirmed',
  });
  assert.deepEqual(
    mismatch.calls.map(({ stage }) => stage),
    ['oauth', 'accounts'],
  );
});

test('rules rejects duplicate or unconfirmed accounts', async () => {
  const active = {
    AccountID: 'EXT-1',
    Status: 'Active',
    AccountType: 'Margin',
    Currency: 'USD',
  };
  const cases = [
    null,
    {},
    { Accounts: null },
    { Accounts: [active], AccountID: 'OTHER' },
    { Accounts: [active], NextToken: 'more' },
    { Accounts: [active], Errors: [{ Message: 'private-secret' }] },
    { Accounts: [active, active] },
    { Accounts: [{ ...active, AccountID: 'OTHER' }] },
    { Accounts: [{ ...active, Status: 'Closed' }] },
    { Accounts: [{ ...active, Status: 'Closing Transaction Only' }] },
    { Accounts: [{ ...active, Status: undefined }] },
    { Accounts: [{ ...active, AccountType: 'Futures' }] },
    { Accounts: [{ ...active, Currency: undefined }] },
  ];
  for (const accounts of cases) {
    const h = harness();
    h.state.responses.accounts = accounts;
    assert.deepEqual(plain(await h.invoke('rules', rulesInput())), {
      version: 1,
      state: 'unavailable',
      reason: 'account_unconfirmed',
    });
    assert.equal(h.postCount(), 0);
  }
});

test('rules requires authoritative instrument identity', async () => {
  const cases = [
    { Symbol: 'AAPL' },
    { Symbol: undefined },
    { AssetType: 'STOCKOPTION' },
    { AssetType: 'UNKNOWN' },
    { Exchange: undefined },
    { Exchange: 'NYSE' },
    { Currency: null },
    { Currency: 'EUR' },
    { Error: 'private-secret' },
  ];
  for (const changes of cases) {
    const h = harness();
    const details = symbolDetails();
    Object.assign(details.Symbols[0], changes);
    h.state.responses.details = details;
    const data = rulesInput();
    data.instrument.source = 'TradeStation';
    assert.deepEqual(plain(await h.invoke('rules', data)), {
      version: 1,
      state: 'unavailable',
      reason: 'instrument_unconfirmed',
    });
  }
  for (const details of [
    null,
    {},
    { Symbols: [] },
    { Symbols: [symbolDetails().Symbols[0], symbolDetails().Symbols[0]] },
    { ...symbolDetails(), Errors: [{ Symbol: 'MSFT', Error: 'NotFound' }] },
    { ...symbolDetails(), NextToken: 'more' },
  ]) {
    const h = harness();
    h.state.responses.details = details;
    assert.equal((await h.invoke('rules', rulesInput())).state, 'unavailable');
  }
  const h = harness();
  const data = rulesInput();
  data.instrument.exchange = 'TS';
  assert.equal(
    (await h.invoke('rules', data)).reason,
    'instrument_unconfirmed',
  );
  assert.deepEqual(h.logs, []);
});

test('rules requires combination proof, never an enum product', async () => {
  const route = {
    Id: 'Intelligent',
    Name: 'Intelligent',
    AssetTypes: ['STOCK'],
  };
  for (const routes of [
    null,
    {},
    { Routes: [] },
    { Routes: [route, route] },
    { Routes: [{ ...route, Id: 'ARCA' }] },
    { Routes: [{ ...route, AssetTypes: ['STOCKOPTION'] }] },
    { Routes: [{ ...route, AssetTypes: null }] },
    { Routes: [route], Errors: [{ Error: 'private-secret' }] },
    { Routes: [route], NextToken: 'more' },
    { OrderTypes: ['Market', 'Limit'], Durations: ['DAY', 'GTC'] },
  ]) {
    const h = harness();
    h.state.responses.routes = routes;
    assert.deepEqual(plain(await h.invoke('rules', rulesInput())), {
      version: 1,
      state: 'unavailable',
      reason: 'combination_unconfirmed',
    });
  }
  for (const changes of [
    { Country: 'Canada' },
    { Exchange: 'UNPROVEN' },
    { Currency: 'CAD' },
  ]) {
    const h = harness();
    const details = symbolDetails();
    Object.assign(details.Symbols[0], changes);
    h.state.responses.details = details;
    const data = rulesInput();
    data.instrument.exchange = details.Symbols[0].Exchange;
    data.instrument.currency = details.Symbols[0].Currency;
    assert.equal(
      (await h.invoke('rules', data)).reason,
      'combination_unconfirmed',
    );
  }
  const h = harness();
  const details = symbolDetails();
  details.Symbols[0].OrderTypes = [
    'Market',
    'Limit',
    'StopMarket',
    'StopLimit',
  ];
  details.Symbols[0].Durations = ['DAY', 'GTC', 'IOC', 'FOK'];
  h.state.responses.details = details;
  const result = plain(await h.invoke('rules', rulesInput()));
  assert.deepEqual(result, expectedRules(rulesInput()));
  const option = harness();
  const data = rulesInput();
  data.instrument = {
    symbol: 'MSFT261218C00400000',
    assetCategory: 'OPT',
    exchange: 'OPRA',
    currency: 'USD',
  };
  const optionDetails = symbolDetails();
  Object.assign(optionDetails.Symbols[0], {
    Symbol: 'MSFT 261218C400',
    AssetType: 'STOCKOPTION',
    Exchange: 'OPRA',
  });
  option.state.responses.details = optionDetails;
  option.state.responses.routes = {
    Routes: [{ ...route, AssetTypes: ['STOCKOPTION'] }],
  };
  assert.deepEqual(plain(await option.invoke('rules', data)), {
    version: 1,
    state: 'unavailable',
    reason: 'combination_unconfirmed',
  });
  assert.ok(
    option.calls
      .find(({ stage }) => stage === 'details')
      .url.endsWith('/MSFT%20261218C400'),
  );
  assert.equal(option.postCount(), 0);
});

test('rules quantity uses explicit canonical broker decimals', async () => {
  const base = symbolDetails().Symbols[0].QuantityFormat;
  for (const format of [
    undefined,
    null,
    [],
    { ...base, MinimumTradeQuantity: undefined },
    { ...base, MinimumTradeQuantity: '0' },
    { ...base, MinimumTradeQuantity: '+1' },
    { ...base, MinimumTradeQuantity: '1e0' },
    { ...base, MinimumTradeQuantity: 1 },
    { ...base, Increment: undefined },
    { ...base, Increment: '0' },
    { ...base, Increment: '0.5', Decimals: '1' },
    { ...base, Decimals: undefined },
    { ...base, Decimals: 0 },
    { ...base, IncrementStyle: 'Schedule' },
    { ...base, IncrementSchedule: [] },
    { ...base, Error: 'private-secret' },
  ]) {
    const h = harness();
    const details = symbolDetails();
    details.Symbols[0].QuantityFormat = format;
    h.state.responses.details = details;
    assert.deepEqual(plain(await h.invoke('rules', rulesInput())), {
      version: 1,
      state: 'unavailable',
      reason: 'quantity_unconfirmed',
    });
  }
  const h = harness();
  const details = symbolDetails();
  details.Symbols[0].QuantityFormat = {
    ...base,
    MinimumTradeQuantity: '0003.0000',
    Increment: '0002.00',
  };
  h.state.responses.details = details;
  assert.deepEqual(plain(await h.invoke('rules', rulesInput())).quantity, {
    fractional: false,
    minimum: '3',
    step: '2',
    maximum: 'infinity',
    minimumNotional: null,
  });
  const result = plain(
    h.globals.lib.execution.rulesReady({
      data: rulesInput(),
      instrument: details.Symbols[0],
      quantity: {
        fractional: false,
        minimum: '0003.0000',
        step: '0002.00',
        maximum: '001000.00',
        minimumNotional: null,
      },
      price: h.globals.lib.execution.priceRules(details.Symbols[0].PriceFormat),
    }),
  );
  assert.deepEqual(result.quantity, {
    fractional: false,
    minimum: '3',
    step: '2',
    maximum: '1000',
    minimumNotional: null,
  });
  for (const row of result.orders) {
    assert.deepEqual(row.quantity, {
      fractional: false,
      minimum: '3',
      step: '2',
      maximum: '1000',
      minimumNotional: null,
    });
  }
});

test('rules never defaults unconfirmed price rules', async () => {
  const base = symbolDetails().Symbols[0].PriceFormat;
  const schedule = (rows) => ({
    Format: 'Decimal',
    Decimals: '2',
    IncrementStyle: 'Schedule',
    IncrementSchedule: rows,
  });
  for (const format of [
    undefined,
    null,
    [],
    { ...base, Increment: undefined },
    { ...base, Increment: '0' },
    { ...base, Increment: 0.01 },
    { ...base, Increment: '1e-2' },
    { ...base, Increment: '+0.01' },
    { ...base, Increment: '-0.01' },
    { ...base, Increment: ' 0.01' },
    { ...base, Increment: '0.001' },
    { ...base, Decimals: undefined },
    { ...base, Decimals: 2 },
    { ...base, Decimals: '-1' },
    { ...base, Format: 'Fraction' },
    { ...base, Format: 'SubFraction' },
    { ...base, IncrementStyle: 'Unknown' },
    { ...base, IncrementSchedule: [] },
    { ...base, Error: 'private-secret' },
    schedule([]),
    schedule([{ StartsAt: '1', Increment: '0.01' }]),
    schedule([
      { StartsAt: '0', Increment: '0.01' },
      { StartsAt: '0', Increment: '0.02' },
    ]),
    schedule([
      { StartsAt: '0', Increment: '0.01' },
      { StartsAt: '-1', Increment: '0.02' },
    ]),
    schedule([{ StartsAt: '0', Increment: '0.01' }, { StartsAt: '1' }]),
    schedule([{ StartsAt: '0', Increment: '0.01', Error: 'private-secret' }]),
    schedule([
      { StartsAt: '0', Increment: '0.01' },
      { StartsAt: '1', Increment: '0.05' },
      { StartsAt: '1.01', Increment: '0.01' },
      { StartsAt: '1.02', Increment: '0.01' },
      { StartsAt: '1.01', Increment: '0.01' },
    ]),
    schedule([
      { StartsAt: '0', Increment: '0.01' },
      { StartsAt: '0.011', Increment: '0.05' },
      { StartsAt: '0.012', Increment: '0.01' },
    ]),
  ]) {
    const h = harness();
    const details = symbolDetails();
    details.Symbols[0].PriceFormat = format;
    h.state.responses.details = details;
    assert.deepEqual(plain(await h.invoke('rules', rulesInput())), {
      version: 1,
      state: 'unavailable',
      reason: 'price_unconfirmed',
    });
  }
});

// Independent consumer of the common wire: fixed exact scale for these vectors.
// No connector parsing helpers decide range or grid membership here.
const priceAllowed = (price, value) => {
  const exact = (decimal) => {
    const [whole, fraction = ''] = decimal.split('.');
    return BigInt(whole + fraction.padEnd(32, '0'));
  };
  const amount = exact(value);
  const row = price.rules.find(
    (rule) =>
      amount >= exact(rule.minInclusive) &&
      (rule.maxExclusive === null || amount < exact(rule.maxExclusive)),
  );
  const tail = (value.split('.')[1] || '').replace(/0+$/, '');
  return Boolean(
    row && tail.length <= row.precision && amount % exact(row.tick) === 0n,
  );
};

test('rules exact ranges, zero-origin grids and precision', () => {
  const h = harness();
  const details = symbolDetails();
  details.Symbols[0].PriceFormat = {
    Format: 'Decimal',
    Decimals: '2',
    IncrementStyle: 'Schedule',
    IncrementSchedule: [
      { StartsAt: '000.000', Increment: '0.0100' },
      { StartsAt: '0.01500', Increment: '0.0200' },
      { StartsAt: '1.0000', Increment: '0.0500' },
    ],
  };
  const price = plain(
    h.globals.lib.execution.priceRules(details.Symbols[0].PriceFormat),
  );
  assert.deepEqual(price.rules, [
    {
      minInclusive: '0',
      maxExclusive: '0.015',
      tick: '0.01',
      precision: 2,
      rounding: 'nearest_half_up',
    },
    {
      minInclusive: '0.015',
      maxExclusive: '1',
      tick: '0.02',
      precision: 2,
      rounding: 'nearest_half_up',
    },
    {
      minInclusive: '1',
      maxExclusive: null,
      tick: '0.05',
      precision: 2,
      rounding: 'nearest_half_up',
    },
  ]);
  for (const [value, allowed] of [
    ['0.01', true],
    ['0.015', false],
    ['0.02', true],
    ['0.035', false],
    ['0.03', false],
    ['0.98', true],
    ['0.9999999999999999', false],
    ['1', true],
    ['1.02', false],
    ['1.05', true],
    ['1.05000', true],
    ['1.0500000000000001', false],
  ]) {
    assert.equal(priceAllowed(price, value), allowed, value);
  }
  // Thresholds that collapse to one Number must still remain distinct.
  details.Symbols[0].PriceFormat = {
    Format: 'Decimal',
    Decimals: '16',
    IncrementStyle: 'Schedule',
    IncrementSchedule: [
      { StartsAt: '0', Increment: '0.0000000000000001' },
      {
        StartsAt: '9007199254740993.0000000000000001',
        Increment: '0.0000000000000002',
      },
      {
        StartsAt: '9007199254740993.0000000000000005',
        Increment: '0.0000000000000001',
      },
    ],
  };
  const high = plain(
    h.globals.lib.execution.priceRules(details.Symbols[0].PriceFormat),
  );
  assert.equal(high.rules[1].minInclusive, '9007199254740993.0000000000000001');
  assert.equal(priceAllowed(high, '9007199254740993.0000000000000001'), false);
  assert.equal(priceAllowed(high, '9007199254740993.0000000000000002'), true);
  assert.equal(priceAllowed(high, '9007199254740993.0000000000000004'), true);
  assert.equal(priceAllowed(high, '9007199254740993.0000000000000005'), true);
});

test('rules rotation stays only in accessUpdate on all outcomes', async () => {
  for (const outcome of [
    'ready',
    'quantity',
    'accounts',
    'details',
    'routes',
    'exception',
  ]) {
    const h = harness();
    Object.defineProperty(h.globals.domain.execution, 'attempts', {
      get: () => assert.fail('rules stored rotation in placement receipts'),
    });
    h.state.rotate = true;
    if (['accounts', 'details', 'routes'].includes(outcome)) {
      h.state.responses[outcome] = { Error: 'private-secret private-access' };
    } else if (outcome === 'quantity') {
      const details = symbolDetails();
      delete details.Symbols[0].QuantityFormat.Increment;
      h.state.responses.details = details;
    } else if (outcome === 'exception') {
      h.globals.lib.execution.rulesProof = () => {
        throw new Error('private-secret private-access parser exception');
      };
    }
    const result = plain(await h.invoke('rules', rulesInput()));
    assert.equal(result.state, outcome === 'ready' ? 'ready' : 'unavailable');
    if (outcome === 'quantity') {
      assert.equal(result.reason, 'quantity_unconfirmed');
    }
    assert.deepEqual(result.accessUpdate, { refresh_token: 'rotated-refresh' });
    const { accessUpdate, ...rules } = result;
    assert.equal(accessUpdate.refresh_token, 'rotated-refresh');
    assert.equal(JSON.stringify(rules).includes('refresh'), false);
    assert.equal(JSON.stringify(result).includes('private'), false);
    assert.equal(JSON.stringify(result).includes('access_token'), false);
    assert.equal(JSON.stringify(result).includes('credentials'), false);
    assert.deepEqual(h.logs, []);
    assert.equal(h.postCount(), 0);
  }
  const same = harness();
  same.state.responses.oauth = {
    access_token: 'private-access',
    refresh_token: rulesInput().credentials.refresh_token,
  };
  assert.equal(
    Object.hasOwn(await same.invoke('rules', rulesInput()), 'accessUpdate'),
    false,
  );
});

test('rules source errors and expired evidence fail closed', async () => {
  for (const stage of ['oauth', 'accounts', 'details', 'routes']) {
    for (const status of [401, 429, 500]) {
      const h = harness();
      h.state.statuses[stage] = status;
      const result = plain(await h.invoke('rules', rulesInput()));
      assert.equal(result.version, 1);
      assert.equal(result.state, 'unavailable');
      assert.deepEqual(Object.keys(result).sort(), [
        'reason',
        'state',
        'version',
      ]);
      assert.equal(h.postCount(), 0);
    }
    const h = harness();
    h.state.responses[stage] = new Error(
      'private-secret private-access raw upstream error',
    );
    assert.equal((await h.invoke('rules', rulesInput())).state, 'unavailable');
    assert.deepEqual(h.logs, []);
  }
  for (const token of [
    null,
    [],
    { access_token: 'private-access', refresh_token: '' },
    { access_token: 'private-access', error: 'private-secret' },
    { access_token: '' },
  ]) {
    const h = harness();
    h.state.responses.oauth = token;
    assert.deepEqual(plain(await h.invoke('rules', rulesInput())), {
      version: 1,
      state: 'unavailable',
      reason: 'source_unavailable',
    });
    assert.equal(h.calls.length, 1);
  }
  const expired = harness({ clock: true });
  expired.state.rotate = true;
  expired.state.bodyDelays.details = 18000;
  const result = plain(await expired.invoke('rules', rulesInput()));
  assert.deepEqual(result, {
    version: 1,
    state: 'unavailable',
    reason: 'source_unavailable',
    accessUpdate: { refresh_token: 'rotated-refresh' },
  });
  assert.equal(expired.time.pending(), 0);
});
