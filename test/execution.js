'use strict';
/* eslint-disable camelcase */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'package.json')).name === 'ts_connect';
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
function harness() {
  const calls = [];
  const logs = [];
  const state = { loss: false, mismatch: false, unknown: false };
  const globals = {
    node: { crypto },
    Buffer,
    URL,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    console: {
      log: (...args) => logs.push(args),
      error: (...args) => logs.push(args),
    },
    config: {
      execution: { token: 's'.repeat(32), identity: 'metaterminal-execution' },
    },
    domain: { execution: {} },
    lib: { execution: {} },
  };
  globals.domain.execution.attempts = load(
    'domain/execution/attempts.js',
    globals,
  );
  globals.fetch = async (url, options) => {
    calls.push({ url, options });
    let body;
    if (url.includes('/oauth/token')) {
      assert.ok(options.body.includes('grant_type=refresh_token'));
      body = { access_token: 'private-access' };
    } else if (url.endsWith('/brokerage/accounts')) {
      body = { Accounts: [{ AccountID: state.mismatch ? 'OTHER' : 'EXT-1' }] };
    } else if (url.endsWith('/positions')) {
      body = { Positions: [] };
    } else if (url.endsWith('/v2/account')) {
      body = { account_number: state.mismatch ? 'OTHER' : 'EXT-1' };
    } else if (options.method === 'POST') {
      const payload = JSON.parse(options.body);
      assert.equal(
        ts ? payload.OrderConfirmId : payload.client_order_id,
        'meta-17',
      );
      if (state.loss) throw new Error('private-secret raw upstream exception');
      body = ts
        ? { Orders: [{ OrderID: 'B-1' }] }
        : {
            id: 'B-1',
            client_order_id: 'meta-17',
            status: 'new',
            secret: 'private-secret',
          };
    } else {
      body = ts
        ? {
            Orders: [
              {
                AccountID: 'EXT-1',
                OrderID: 'B-1',
                Status: state.unknown ? 'UNKNOWN' : 'FLL',
              },
            ],
          }
        : {
            id: 'B-1',
            client_order_id: state.unknown ? 'other-id' : 'meta-17',
            status: 'filled',
            secret: 'private-secret',
          };
    }
    return { status: 200, json: async () => body };
  };
  globals.lib.execution.request = load('lib/execution/request.js', globals);
  if (ts) globals.lib.utils = load('lib/utils.js', globals);
  globals.lib.execution.broker = load('lib/execution/broker.js', globals);
  globals.lib.execution.handle = load('lib/execution/handle.js', globals);
  const hook = load('api/execution.1.js', globals);
  const invoke = (action, data, authorization = `Bearer ${'s'.repeat(32)}`) =>
    hook.router({
      method: `execution/${action}`,
      verb: 'POST',
      args: data,
      headers: {
        authorization,
        'x-service-identity': 'metaterminal-execution',
      },
    });
  return { invoke, globals, calls, logs, state };
}
test('service identity, submit boundary and exact account lookup', async () => {
  const h = harness();
  const data = input();
  assert.equal(
    (await h.invoke('submit', data, 'Bearer user-session')).state,
    'unauthorized',
  );
  assert.equal(h.calls.length, 0);
  const [first, parallel] = await Promise.all([
    h.invoke('submit', data),
    h.invoke('submit', data),
  ]);
  assert.equal(first.state, 'acknowledged');
  assert.equal(parallel.state, 'ambiguous');
  assert.equal(
    h.calls.filter(
      (call) => call.url.includes('/orders') && call.options.method === 'POST',
    ).length,
    1,
  );
  assert.deepEqual(plain(await h.invoke('submit', data)), plain(first));
  const changed = { ...data, intent: { ...data.intent, quantity: 3 } };
  assert.equal((await h.invoke('submit', changed)).state, 'ambiguous');
  assert.equal((await h.invoke('lookup', data)).broker.state, 'filled');
  h.state.unknown = true;
  assert.equal((await h.invoke('lookup', data)).state, 'source_unavailable');
  assert.equal(JSON.stringify(first).includes('private'), false);
  assert.equal(
    h.calls.some((call) => /back|ptfin/.test(call.url)),
    false,
  );
  assert.equal(h.logs.length, 0);
});
test('lost submit and restart never grant a blind retry', async () => {
  const h = harness();
  const data = input();
  h.state.loss = true;
  assert.equal((await h.invoke('submit', data)).state, 'ambiguous');
  const recovered = await h.invoke('lookup', data);
  assert.equal(recovered.state, ts ? 'source_unavailable' : 'found');
  assert.equal((await h.invoke('submit', data)).state, 'ambiguous');
  assert.equal(
    h.calls.filter(
      (call) => call.url.includes('/orders') && call.options.method === 'POST',
    ).length,
    1,
  );
  h.globals.domain.execution.attempts = load(
    'domain/execution/attempts.js',
    h.globals,
  );
  const restarted = await h.invoke('lookup', data);
  assert.equal(restarted.state, ts ? 'source_unavailable' : 'found');
  if (ts) {
    assert.equal(
      (await h.invoke('lookup', { ...data, brokerId: 'B-1' })).state,
      'found',
    );
  }
  assert.equal(h.logs.length, 0);
});
test('invalid intent cannot partially place an order', async () => {
  const h = harness();
  const data = input();
  const variants = [
    { ...data, account: '../OTHER' },
    { ...data, live: 'true' },
    {
      ...data,
      intent: {
        ...data.intent,
        relation: 'BRK',
        related: [{ type: 'stop', quantity: 2 }],
      },
    },
    { ...data, intent: { ...data.intent, quantity: 0 } },
  ];
  for (const invalid of variants) {
    assert.equal((await h.invoke('submit', invalid)).state, 'rejected');
  }
  assert.equal(h.calls.length, 0);
  if (!ts) {
    h.state.mismatch = true;
    assert.equal((await h.invoke('submit', data)).state, 'rejected');
    assert.equal((await h.invoke('lookup', data)).state, 'source_unavailable');
    assert.equal(
      h.calls.some((call) => call.url.includes('/orders')),
      false,
    );
  }
});
