/* eslint-disable camelcase */
({
  timeout: 19000,
  // HTTP hook bypasses the ordinary public RPC envelope. It authenticates
  // before examining credentials and never logs args, headers or exceptions.
  async router({ method, args, verb, headers }) {
    const deadline = Date.now() + 18000;
    if (verb !== 'POST' || !['execution/submit', 'execution/lookup', 'execution/capabilities', 'execution/rules'].includes(method)) {
      return { state: 'invalid' };
    }
    const expected = config.execution.token;
    const provided = headers?.authorization;
    if (
      typeof expected !== 'string' ||
      expected.length < 32 ||
      headers?.['x-service-identity'] !== config.execution.identity ||
      typeof provided !== 'string'
    ) {
      return { state: 'unauthorized' };
    }
    const left = Buffer.from(`Bearer ${expected}`);
    const right = Buffer.from(provided);
    if (left.length !== right.length || !node.crypto.timingSafeEqual(left, right)) return { state: 'unauthorized' };
    if (method === 'execution/capabilities') {
      return {
        version: 2,
        terminal: 'TS',
        contract: 'meta-ts-v2-2',
        submit: true,
        restart_safe: false,
        recovery: 'known_order_id_only',
      };
    }
    try {
      if (method === 'execution/rules') return await lib.execution.rules({ data: args, deadline });
      return await lib.execution.handle({ action: method.split('/')[1], data: args, deadline });
    } catch {
      if (method === 'execution/rules') return { version: 1, state: 'unavailable', reason: 'source_unavailable' };
      const orderId = Number.isSafeInteger(args?.orderId) && args.orderId > 0 ? args.orderId : null;
      return { version: 2, orderId, state: method === 'execution/submit' ? 'ambiguous' : 'source_unavailable' };
    }
  },
});
