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
      Accounts: [{ AccountID: state.mismatch ? 'OTHER' : 'EXT-1' }],
    }),
    positions: () => ({ Positions: [] }),
    place: () => ({ Orders: [{ OrderID: 'B-1' }] }),
    current: () => ({
      Orders: [order({ Status: state.unknown ? 'UNKNOWN' : 'FLL' })],
    }),
    historical: () => ({ Orders: [order()] }),
  };
  globals.fetch = async (url, options) => {
    let stage = 'current';
    if (url.includes('/oauth/token')) stage = 'oauth';
    else if (url.endsWith('/brokerage/accounts')) stage = 'accounts';
    else if (url.endsWith('/positions')) stage = 'positions';
    else if (options.method === 'POST') stage = 'place';
    else if (url.includes('/historicalorders/')) stage = 'historical';
    calls.push({ url, options, stage, at: globals.Date.now() });
    if (stage === 'oauth') {
      assert.ok(options.body.includes('grant_type=refresh_token'));
      assert.equal(options.redirect, 'error');
    } else {
      assert.equal(options.headers.Authorization, 'Bearer private-access');
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
  for (const name of ['request', 'protocol', 'broker', 'handle']) {
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
test('auth rejects before touching credentials', async () => {
  const h = harness();
  const data = Object.defineProperty({}, 'credentials', {
    get: () => assert.fail('unauthorized credentials accessed'),
  });
  for (const action of ['submit', 'lookup', 'capabilities']) {
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
  const h = harness();
  const data = input();
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
  for (const action of ['submit', 'lookup', 'capabilities']) {
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
  const h = harness();
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
  assert.equal((await invoke('submit', input())).state, 'acknowledged');
  assert.equal((await invoke('submit', input())).state, 'acknowledged');
  assert.equal(h.postCount(), 1);
  assert.equal(JSON.stringify(h.logs).includes('private'), false);
});
