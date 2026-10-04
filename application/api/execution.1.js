({
  timeout: 45000,
  // HTTP hook bypasses the ordinary public RPC envelope. It authenticates
  // before examining credentials and never logs args, headers or exceptions.
  async router({ method, args, verb, headers }) {
    if (verb !== 'POST' || !['execution/submit', 'execution/lookup'].includes(method)) return { state: 'invalid' };
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
    try {
      return await lib.execution.handle({ action: method.split('/')[1], data: args });
    } catch {
      return { version: 2, orderId: args?.orderId, state: 'source_unavailable' };
    }
  },
});
