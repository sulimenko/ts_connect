'use strict';
/* global require */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..', '..');

const baseGlobals = {
  AbortController,
  Array,
  Boolean,
  Date,
  Error,
  JSON,
  Map,
  Math,
  Number,
  Object,
  Promise,
  RegExp,
  Set,
  String,
  TextDecoder,
  TextEncoder,
  URL,
  URLSearchParams,
  clearTimeout,
  console,
  setTimeout,
};

function makeTraceId(prefix = 'tr') {
  return `${prefix}-test`;
}

function makeLib(overrides = {}) {
  return {
    utils: {
      normalizeAction: () => null,
      resolveTraceId: ({ traceId = null, requestId = null, prefix = 'tr' } = {}) => {
        for (const value of [traceId, requestId]) {
          if (typeof value !== 'string') continue;
          const trimmed = value.trim();
          if (trimmed) return trimmed;
        }
        return makeTraceId(prefix);
      },
      traceLog: () => {},
      ...overrides.utils,
    },
    ts: {
      ...overrides.ts,
    },
    stream: {
      ...overrides.stream,
    },
  };
}

function loadExpressionModule(relativePath, globals = {}) {
  const filePath = path.join(repoRoot, relativePath);
  const source = fs.readFileSync(filePath, 'utf8');
  const context = vm.createContext({
    ...baseGlobals,
    ...globals,
  });
  return new vm.Script(source, { filename: filePath }).runInContext(context);
}

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test('options.chain strips riskFreeRate from snapshot and stream requests', async () => {
  const snapshotCalls = [];
  const streamCalls = [];

  const api = loadExpressionModule('application/api/options/chain.js', {
    DomainError: class DomainError extends Error {
      constructor(code) {
        super(code);
        this.code = code;
        this.name = 'DomainError';
      }
    },
    context: { client: {} },
    domain: {
      ts: {
        clients: {
          getClient: async () => ({}),
        },
      },
    },
    lib: makeLib({
      ts: {
        optionChain: async (payload) => {
          snapshotCalls.push(payload);
          return { ok: true };
        },
      },
      stream: {
        optionChain: async (payload) => {
          streamCalls.push(payload);
          return { ok: true };
        },
      },
    }),
  });

  await api.method({
    symbol: 'TSLA',
    expiration: '2026-06-18',
    range: 94,
    riskFreeRate: 0,
    priceCenter: 123.45,
  });
  assert.equal(snapshotCalls.length, 1);
  assert.equal(snapshotCalls[0].data.riskFreeRate, undefined);
  assert.equal(snapshotCalls[0].data.priceCenter, 123.45);

  await api.method({
    symbol: 'TSLA',
    expiration: '2026-06-18',
    range: 94,
    riskFreeRate: 0,
    priceCenter: 123.45,
    stream: true,
  });
  assert.equal(streamCalls.length, 1);
  assert.equal(streamCalls[0].data.riskFreeRate, undefined);
  assert.equal(streamCalls[0].data.priceCenter, 123.45);
});

test('stream helper builds stream key from cleaned option chain payload', async () => {
  let buildStreamKeyArgs = null;
  let subscribeArgs = null;

  const helper = loadExpressionModule('application/lib/stream/optionChain.js', {
    lib: makeLib(),
    domain: {
      ts: {
        clients: {
          getClient: async () => ({
            buildStreamKey: (args) => {
              buildStreamKeyArgs = args;
              return 'chains-key';
            },
          }),
        },
        streams: {
          subscribe: async (args) => {
            subscribeArgs = args;
            return args.key;
          },
        },
      },
    },
  });

  const result = await helper({
    client: {},
    endpoint: ['marketdata', 'stream', 'options', 'chains', 'TSLA'],
    symbol: 'TSLA',
    data: {
      strikeProximity: 94,
      spreadType: 'Single',
      strikeInterval: 1,
      enableGreeks: true,
      strikeRange: 'All',
      optionType: 'All',
      priceCenter: 123.45,
    },
  });

  assert.equal(result, 'chains-key');
  assert.ok(buildStreamKeyArgs);
  assert.equal(buildStreamKeyArgs.group, 'chains');
  assert.equal(buildStreamKeyArgs.symbol, 'TSLA');
  assert.equal(buildStreamKeyArgs.data.riskFreeRate, undefined);
  assert.equal(subscribeArgs.key, 'chains-key');
});

test('stream packet Failed/Internal server error is permanent and stops reconnect', async () => {
  const streamFactory = loadExpressionModule('application/lib/ts/stream.js', {});
  let reconnectCalls = 0;
  const stopReasons = [];
  const errors = [];

  const instance = {
    ...streamFactory({
      live: true,
      endpoint: ['marketdata', 'stream', 'options', 'chains', 'TSLA'],
      tokens: { access: 'token' },
      onData: () => {},
      onError: () => {},
    }),
    shouldReconnect: true,
    checkTimeout() {},
    scheduleReconnect: async () => {
      reconnectCalls += 1;
    },
    stopStream(reason = 'unknown') {
      stopReasons.push(reason);
      this.shouldReconnect = false;
    },
  };

  const packet = {
    Error: 'Failed',
    Message: 'Internal server error',
    Symbol: 'TSLA',
  };

  const result = instance.handlePacket(packet, null, (error) => errors.push(error));

  assert.equal(result, false);
  assert.equal(reconnectCalls, 0);
  assert.deepEqual(stopReasons, ['permanent-error']);
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof Error);
  assert.equal(errors[0].message, 'Failed Internal server error');
  assert.equal(errors[0].code, 'Failed');
  assert.equal(errors[0].upstreamMessage, 'Internal server error');
  assert.equal(errors[0].details, 'Internal server error');
  assert.equal(errors[0].symbol, 'TSLA');
});

test('serializeError preserves upstream error metadata', async () => {
  const streams = loadExpressionModule('application/domain/ts/streams.js', {});

  const packetResult = streams.serializeError({
    Error: 'Failed',
    Message: 'Internal server error',
    Symbol: 'TSLA',
  });

  assert.equal(packetResult.message, 'Failed: Internal server error');
  assert.equal(packetResult.error, 'Failed');
  assert.equal(packetResult.details, 'Internal server error');
  assert.equal(packetResult.upstreamMessage, 'Internal server error');
  assert.equal(packetResult.symbol, 'TSLA');

  const error = Object.assign(new Error('boom'), {
    code: 'EBOOM',
    details: 'more detail',
    upstreamMessage: 'upstream detail',
    symbol: 'TSLA',
  });
  const errorResult = streams.serializeError(error);

  assert.equal(errorResult.message, 'boom');
  assert.equal(errorResult.code, 'EBOOM');
  assert.equal(errorResult.error, 'EBOOM');
  assert.equal(errorResult.details, 'more detail');
  assert.equal(errorResult.upstreamMessage, 'upstream detail');
  assert.equal(errorResult.symbol, 'TSLA');
});

test('optionChain rejects object errors with a readable message', async () => {
  const helper = loadExpressionModule('application/lib/ts/optionChain.js', {
    lib: makeLib({
      ts: {
        readOptionChain: () => null,
      },
    }),
    domain: {
      ts: {
        clients: {
          getClient: async () => ({
            stopStoredStream: async () => {},
            streamChains: async ({ onError }) => {
              onError({
                Error: 'Failed',
                Message: 'Internal server error',
                Symbol: 'TSLA',
              });
              return 'chains-key';
            },
          }),
        },
      },
    },
  });

  await assert.rejects(
    () =>
      helper({
        endpoint: ['marketdata', 'stream', 'options', 'chains', 'TSLA'],
        symbol: 'TSLA',
        data: {
          strikeProximity: 94,
          optionType: 'All',
        },
      }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'Failed: Internal server error');
      assert.equal(error.code, 'Failed');
      assert.equal(error.details, 'Internal server error');
      assert.equal(error.upstreamMessage, 'Internal server error');
      assert.equal(error.symbol, 'TSLA');
      return true;
    },
  );
});

(async () => {
  let failed = 0;

  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok - ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`not ok - ${name}`);
      console.error(error && error.stack ? error.stack : error);
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} test(s) failed`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n${tests.length} test(s) passed`);
})();
