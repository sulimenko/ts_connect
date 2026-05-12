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

function loadUtils() {
  return loadExpressionModule('application/lib/utils.js', {
    DomainError: class DomainError extends Error {
      constructor(code) {
        super(code);
        this.code = code;
        this.name = 'DomainError';
      }
    },
    config: {
      ts: {
        url: {
          protocol: 'https',
          live: 'live',
          sim: 'sim',
          domen: '.example',
        },
      },
    },
  });
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

test('symbol helpers normalize display and internal option formats idempotently', async () => {
  const utils = loadUtils();

  const display = utils.makeSymbol('CRWV 280121C80');
  const internal = utils.makeSymbol('CRWV280121C00080000');
  const stock = utils.makeSymbol('MSFT');

  assert.equal(display.symbol, 'CRWV280121C00080000');
  assert.equal(internal.symbol, 'CRWV280121C00080000');
  assert.equal(stock.symbol, 'MSFT');
  assert.equal(utils.normalizePositionSymbol(display.symbol), 'CRWV280121C00080000');
  assert.equal(utils.normalizePositionSymbol(internal.symbol), 'CRWV280121C00080000');
  assert.equal(utils.makeSymbol(display.symbol).symbol, 'CRWV280121C00080000');
  assert.equal(utils.makeTSSymbol(display.symbol, display.type), 'CRWV 280121C80');
  assert.equal(utils.makeTSSymbol(internal.symbol, internal.type), 'CRWV 280121C80');
  assert.equal(utils.makeTSSymbol(stock.symbol, stock.type), 'MSFT');
});

test('readOptionChain and positions share the same canonical option symbol contract', async () => {
  const utils = loadUtils();
  const readOptionChain = loadExpressionModule('application/lib/ts/readOptionChain.js', {
    lib: { utils },
  });
  const positions = loadExpressionModule('application/domain/ts/positions.js', {
    lib: { utils },
  });

  const option = readOptionChain({
    message: {
      Legs: [
        {
          Symbol: 'CRWV 280121C80',
          Expiration: '2028-01-21T00:00:00Z',
          OptionType: 'Call',
          StrikePrice: 80,
        },
      ],
      Ask: '1.25',
      Bid: '1.15',
      PreviousClose: '1.20',
      Delta: '0.5',
      Gamma: '0.02',
      Theta: '-0.01',
      Vega: '0.05',
      ImpliedVolatility: '0.25',
      DailyOpenInterest: 10,
      Last: '1.22',
      Volume: 100,
    },
  });

  assert.ok(option);
  assert.equal(option.symbol_raw, 'CRWV280121C00080000');
  assert.equal(option.strike, '00080000');

  positions.setPosition({
    account: 'A1',
    symbol: 'CRWV 280121C80',
    data: {
      AccountID: 'A1',
      Symbol: 'CRWV 280121C80',
      Quantity: '2',
      AssetType: 'OPT',
      PositionID: 'P1',
      AveragePrice: '1.10',
    },
  });

  const byDisplay = positions.getPosition({ account: 'A1', symbol: 'CRWV 280121C80' });
  const byInternal = positions.getPosition({ account: 'A1', symbol: 'CRWV280121C00080000' });
  assert.equal(byDisplay.get('Quantity'), '2');
  assert.equal(byInternal.get('Quantity'), '2');
  assert.equal(positions.clearPosition({ account: 'A1', symbol: 'CRWV280121C00080000' }), true);
  assert.equal(positions.getPosition({ account: 'A1', symbol: 'CRWV 280121C80' }), null);
});

test('marketdata quotes and order execution use the shared symbol formatter', async () => {
  const utils = loadUtils();
  const readQuote = loadExpressionModule('application/lib/ts/readQuote.js', {
    lib: { utils },
  });
  const quotesApiCalls = [];
  const quotesApi = loadExpressionModule('application/api/marketdata/quotes.js', {
    DomainError: class DomainError extends Error {
      constructor(code) {
        super(code);
        this.code = code;
        this.name = 'DomainError';
      }
    },
    domain: {
      ts: {
        clients: {
          getClient: async () => ({ tokens: { access: 'token' } }),
        },
      },
    },
    lib: {
      utils,
      ts: {
        send: async (payload) => {
          quotesApiCalls.push(payload);
          return {
            Errors: [],
            result: {
              Quotes: [
                {
                  Symbol: 'CRWV 280121C80',
                  Ask: '1.30',
                  AskSize: 1,
                  Bid: '1.20',
                  BidSize: 2,
                  Last: '1.25',
                  LastSize: 3,
                  TradeTime: '2028-01-21T10:00:00Z',
                  PreviousClose: '1.15',
                  Volume: 4,
                },
                {
                  Symbol: 'MSFT',
                  Ask: '10.30',
                  AskSize: 5,
                  Bid: '10.20',
                  BidSize: 6,
                  Last: '10.25',
                  LastSize: 7,
                  TradeTime: '2028-01-21T10:00:00Z',
                  PreviousClose: '10.15',
                  Volume: 8,
                },
              ],
            },
          };
        },
        readQuote,
      },
    },
  });

  const optionInstrument = { symbol: 'CRWV 280121C80' };
  optionInstrument['asset_category'] = 'OPT';
  const stockInstrument = { symbol: 'MSFT' };
  stockInstrument['asset_category'] = 'STK';

  const rows = await quotesApi.method({
    instruments: [optionInstrument, stockInstrument],
  });

  assert.equal(quotesApiCalls.length, 1);
  assert.equal(quotesApiCalls[0].endpoint[2], 'CRWV 280121C80,MSFT');
  assert.equal(rows[0].symbol, 'CRWV280121C00080000');
  assert.equal(rows[0].data.symbol, 'CRWV280121C00080000');
  assert.equal(rows[1].symbol, 'MSFT');

  const orderCalls = [];
  const orderApi = loadExpressionModule('application/api/orderexecution/order.js', {
    lib: {
      utils,
      ts: {
        placeorder: async (payload) => {
          orderCalls.push(payload);
          return { Orders: [{ Status: 'OK' }] };
        },
      },
    },
    api: {
      account: {
        positions: async () => [],
      },
    },
  });

  await orderApi.method({
    contract: { account: 'A1', live: true },
    instrument: { symbol: 'CRWV280121C00080000', type: 'OPT' },
    qty: 1,
    type: 'Limit',
    tif: 'GTC',
  });

  assert.equal(orderCalls.length, 1);
  assert.equal(orderCalls[0].data.Symbol, 'CRWV 280121C80');
});

test('placeorder normalizes instrument type before getAction for option closes', async () => {
  const utils = loadUtils();
  const sendCalls = [];
  const placeorder = loadExpressionModule('application/lib/ts/placeorder.js', {
    domain: {
      ts: {
        positions: {
          getPosition: () => {
            const position = new Map();
            position.set('Quantity', '2');
            return position;
          },
          clearPosition: () => {},
        },
        clients: {
          getClient: async () => ({
            tokens: { access: 'token' },
          }),
        },
      },
    },
    lib: {
      utils,
      ts: {
        send: async (payload) => {
          sendCalls.push(payload);
          return { Orders: [{ Status: 'OK' }] };
        },
      },
    },
  });

  const optionInstrument = { symbol: 'CRWV280121C00080000' };
  optionInstrument['asset_category'] = 'OPT';

  await placeorder({
    data: {
      AccountID: 'A1',
      Symbol: 'CRWV 280121C80',
      OrderType: 'Limit',
      TimeInForce: { Duration: 'GTC' },
      Route: 'Intelligent',
    },
    qty: -1,
    instrument: optionInstrument,
    live: true,
  });

  assert.equal(sendCalls.length, 1);
  assert.equal(sendCalls[0].data.TradeAction, 'SELLTOCLOSE');
});

test('stream matrix rejects empty or malformed instruments and uses the first valid instrument', async () => {
  const utils = loadUtils();
  const DomainError = class DomainError extends Error {
    constructor(code) {
      super(code);
      this.code = code;
      this.name = 'DomainError';
    }
  };
  let buildStreamKeyArgs = null;
  let subscribeArgs = null;

  const matrixApi = loadExpressionModule('application/api/stream/matrix.js', {
    DomainError,
    context: { client: {} },
    domain: {
      ts: {
        clients: {
          getClient: async () => ({
            buildStreamKey: (args) => {
              buildStreamKeyArgs = args;
              return 'matrix-key';
            },
          }),
        },
        streams: {
          subscribe: async (args) => {
            subscribeArgs = args;
            return { ok: true };
          },
        },
      },
    },
    lib: { utils },
  });

  const emptyResult = await matrixApi.method({ instruments: [] });
  assert.ok(emptyResult instanceof DomainError);
  assert.equal(emptyResult.code, 'EINSTRUMENTS');

  const malformedResult = await matrixApi.method({ instruments: [{}] });
  assert.ok(malformedResult instanceof DomainError);
  assert.equal(malformedResult.code, 'EINSTRUMENTS');

  const invalidFirst = await matrixApi.method({
    instruments: [{ symbol: '' }, { symbol: 'CRWV 280121C80' }],
  });

  assert.equal(invalidFirst.ok, true);
  assert.ok(buildStreamKeyArgs);
  assert.equal(buildStreamKeyArgs.symbol, 'CRWV 280121C80');
  assert.ok(subscribeArgs);
  assert.equal(subscribeArgs.key, 'matrix-key');
  assert.equal(subscribeArgs.metadata.symbol, 'CRWV 280121C80');
  assert.equal(typeof subscribeArgs.start, 'function');
  assert.equal(subscribeArgs.metadata.owner, 'metaterminal');
});

test('stream matrix emits canonical levelII packets while routing by tsSymbol', async () => {
  const utils = loadUtils();
  let streamMatrixArgs = null;
  let emitted = null;

  const matrixApi = loadExpressionModule('application/api/stream/matrix.js', {
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
          getClient: async () => ({
            buildStreamKey: () => 'matrix-key',
            streamMatrix: async (args) => {
              streamMatrixArgs = args;
              await args.onData({ AskSize: 2, BidSize: 0, Price: 12.34 });
              return 'registered-key';
            },
            stopStoredStream: async () => {},
          }),
        },
        streams: {
          subscribe: async ({ start }) => {
            await start({
              notifyError: () => {},
              emit: (eventName, payload) => {
                emitted = { eventName, payload };
              },
            });
            return { ok: true };
          },
        },
      },
    },
    lib: { utils },
  });

  await matrixApi.method({
    instruments: [{ symbol: 'CRWV 280121C80' }],
  });

  assert.ok(streamMatrixArgs);
  assert.equal(streamMatrixArgs.endpoint.join('/'), 'stream/matrix/changes/CRWV 280121C80');
  assert.equal(streamMatrixArgs.symbol, 'CRWV 280121C80');
  assert.ok(emitted);
  assert.equal(emitted.eventName, 'stream/levelII');
  assert.equal(emitted.payload.symbol, 'CRWV280121C00080000');
  assert.equal(emitted.payload.type, 'ask');
  assert.equal(emitted.payload.size, 2);
});

test('stream quotes keeps batch keys stable and guards public input', async () => {
  const utils = loadUtils();
  const DomainError = class DomainError extends Error {
    constructor(code) {
      super(code);
      this.code = code;
      this.name = 'DomainError';
    }
  };
  let subscribeArgs = null;
  let streamQuotesArgs = null;
  let unsubscribeArgs = null;
  let touchArgs = null;

  const quotesApi = loadExpressionModule('application/api/stream/quotes.js', {
    DomainError,
    context: { client: {} },
    domain: {
      ts: {
        clients: {
          getClient: async () => ({
            streamQuotes: async (args) => {
              streamQuotesArgs = args;
              return 'quotes-registered-key';
            },
            stopStoredStream: async () => {},
          }),
        },
        streams: {
          subscribe: async (args) => {
            subscribeArgs = args;
            await args.start({
              notifyError: () => {},
              emit: () => {},
            });
            return { ok: true };
          },
          unsubscribe: async (args) => {
            unsubscribeArgs = args;
            return { ok: true, kind: args.kind, streamKey: args.key, removed: true };
          },
          touch: async (args) => {
            touchArgs = args;
            return { ok: true, kind: args.kind, streamKey: args.key, active: true };
          },
        },
      },
    },
    lib: { utils },
  });

  const emptyResult = await quotesApi.method({ instruments: null });
  assert.ok(emptyResult instanceof DomainError);
  assert.equal(emptyResult.code, 'EINSTRUMENTS');

  const invalidAction = await quotesApi.method({ action: 'restart', instruments: [] });
  assert.ok(invalidAction instanceof DomainError);
  assert.equal(invalidAction.code, 'EACTION');

  const subscribeResult = await quotesApi.method({
    instruments: [{ symbol: 'MSFT' }, { symbol: 'CRWV 280121C80' }, { symbol: 'MSFT' }],
  });

  assert.deepEqual(subscribeResult, { ok: true });
  assert.ok(subscribeArgs);
  assert.equal(subscribeArgs.key, 'CRWV 280121C80,MSFT');
  assert.ok(streamQuotesArgs);
  assert.equal(streamQuotesArgs.endpoint.join('/'), 'marketdata/stream/quotes/CRWV 280121C80,MSFT');
  assert.equal(streamQuotesArgs.trace.scope, 'stream/quotes');

  const unsubscribeResult = await quotesApi.method({
    instruments: null,
    action: 'unsubscribe',
    streamKey: 'quotes-key',
  });

  assert.deepEqual(unsubscribeResult, { ok: true, kind: 'quotes', streamKey: 'quotes-key', removed: true });
  assert.ok(unsubscribeArgs);
  assert.equal(unsubscribeArgs.key, 'quotes-key');

  const touchResult = await quotesApi.method({
    instruments: [],
    action: 'touch',
    streamKey: 'quotes-key',
  });

  assert.deepEqual(touchResult, { ok: true, kind: 'quotes', streamKey: 'quotes-key', active: true });
  assert.ok(touchArgs);
  assert.equal(touchArgs.key, 'quotes-key');
});

test('stream addBarchart normalizes symbol contract and rejects empty symbol', async () => {
  const utils = loadUtils();
  const DomainError = class DomainError extends Error {
    constructor(code) {
      super(code);
      this.code = code;
      this.name = 'DomainError';
    }
  };
  let buildStreamKeyArgs = null;
  let streamChartsArgs = null;

  const barchartApi = loadExpressionModule('application/api/stream/addBarchart.js', {
    DomainError,
    context: { client: {} },
    domain: {
      ts: {
        clients: {
          getClient: async () => ({
            buildStreamKey: (args) => {
              buildStreamKeyArgs = args;
              return 'charts-key';
            },
            streamCharts: async (args) => {
              streamChartsArgs = args;
              return 'charts-registered-key';
            },
            stopStoredStream: async () => {},
          }),
        },
        streams: {
          subscribe: async (args) => {
            await args.start({
              notifyError: () => {},
              emit: () => {},
            });
            return { ok: true };
          },
          unsubscribe: async () => ({ ok: true }),
          touch: async () => ({ ok: true }),
        },
      },
    },
    lib: { utils },
  });

  const invalidResult = await barchartApi.method({ symbol: '   ' });
  assert.ok(invalidResult instanceof DomainError);
  assert.equal(invalidResult.code, 'ESYMBOL');

  const subscribeResult = await barchartApi.method({
    symbol: 'CRWV280121C00080000',
    period: 3600,
    limit: 100,
  });

  assert.deepEqual(subscribeResult, { ok: true });
  assert.ok(buildStreamKeyArgs);
  assert.equal(buildStreamKeyArgs.symbol, 'CRWV 280121C80');
  assert.ok(streamChartsArgs);
  assert.equal(streamChartsArgs.endpoint.join('/'), 'marketdata/stream/barcharts/CRWV 280121C80');
  assert.equal(streamChartsArgs.symbol, 'CRWV 280121C80');
});

test('stream addBarchart emits canonical symbol for TS-style input', async () => {
  const utils = loadUtils();
  let emitted = null;

  const barchartApi = loadExpressionModule('application/api/stream/addBarchart.js', {
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
          getClient: async () => ({
            buildStreamKey: () => 'charts-key',
            streamCharts: async (args) => {
              await args.onData({ Open: 1 });
              return 'charts-registered-key';
            },
            stopStoredStream: async () => {},
          }),
        },
        streams: {
          subscribe: async ({ start }) => {
            await start({
              notifyError: () => {},
              emit: (eventName, payload) => {
                emitted = { eventName, payload };
              },
            });
            return { ok: true };
          },
          unsubscribe: async () => ({ ok: true }),
          touch: async () => ({ ok: true }),
        },
      },
    },
    lib: { utils },
  });

  const result = await barchartApi.method({
    symbol: 'CRWV 280121C80',
    period: 3600,
    limit: 100,
  });

  assert.deepEqual(result, { ok: true });
  assert.ok(emitted);
  assert.equal(emitted.eventName, 'stream/barchart');
  assert.equal(emitted.payload.symbol, 'CRWV280121C00080000');
});

test('stream clear returns removed entries and total count', async () => {
  const utils = loadUtils();
  let unsubscribeAllArgs = null;

  const clearApi = loadExpressionModule('application/api/stream/clear.js', {
    context: { client: {} },
    domain: {
      ts: {
        streams: {
          unsubscribeAll: async (args) => {
            unsubscribeAllArgs = args;
            return [{ kind: 'quotes', key: 'quotes-key', removed: true }];
          },
        },
      },
    },
    lib: { utils },
  });

  const result = await clearApi.method({ traceId: 'trace-1' });

  assert.ok(result);
  assert.equal(result.total, 1);
  assert.equal(result.removed.length, 1);
  assert.equal(result.removed[0].kind, 'quotes');
  assert.equal(result.removed[0].key, 'quotes-key');
  assert.equal(result.removed[0].removed, true);
  assert.ok(unsubscribeAllArgs);
  assert.equal(unsubscribeAllArgs.reason, 'clear');
});

test('marketdata barcharts returns EINSTRUMENT for null or empty instrument input', async () => {
  const DomainError = class DomainError extends Error {
    constructor(code) {
      super(code);
      this.code = code;
      this.name = 'DomainError';
    }
  };

  const barcharts = loadExpressionModule('application/api/marketdata/barcharts.js', {
    DomainError,
    domain: {
      ts: {
        clients: {
          getClient: async () => ({
            tokens: { access: 'token' },
          }),
        },
        barcharts: {
          fetch: async () => {
            throw new Error('fetch should not be called');
          },
        },
      },
    },
    lib: {
      utils: loadUtils(),
    },
  });

  const nullResult = await barcharts.method({ instrument: null });
  assert.ok(nullResult instanceof DomainError);
  assert.equal(nullResult.code, 'EINSTRUMENT');

  const emptyResult = await barcharts.method({ instrument: { symbol: '' } });
  assert.ok(emptyResult instanceof DomainError);
  assert.equal(emptyResult.code, 'EINSTRUMENT');
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
