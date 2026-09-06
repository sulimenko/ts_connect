async ({ contracts, token, orderIds = [], start = null, limit = null, historical = false, signal = null }) => {
  const concurrency = 3;
  const started = Date.now();
  const deadline = started + 18000;
  const controller = new AbortController();
  const results = new Array(contracts.length);
  let completed = 0;
  let failedAccount = null;
  let failure = null;
  let next = 0;

  const timeout = new Error('TradeStation orders batch timed out');
  timeout.code = 'ETIMEOUT';
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(timeout), 18000);

  console.log('TradeStation orders batch:', {
    endpoint: historical ? 'account/historicalorders' : 'account/orders',
    accountsCount: contracts.length,
    concurrency,
    durationMs: 0,
    completedAccounts: 0,
    failedAccount: null,
    state: 'start',
  });

  const worker = async () => {
    while (!controller.signal.aborted) {
      const index = next;
      if (index >= contracts.length) return;
      next += 1;
      const contract = contracts[index];
      const account = `${contract.account ?? ''}`.trim();
      const live = contract.live === 1 || contract.live === '1' || contract.live === true || contract.live === 'true';
      try {
        const response = await lib.ts.orders({
          account,
          live,
          token,
          orderIds,
          start,
          limit,
          historical,
          signal: controller.signal,
          deadline,
        });
        if (response.errors.length > 0) {
          const error = new Error(`TradeStation orders failed for account ${account}`);
          error.account = account;
          throw error;
        }
        results[index] = response.orders;
        completed += 1;
      } catch (error) {
        if (!failure) {
          failure = controller.signal.aborted && controller.signal.reason instanceof Error ? controller.signal.reason : error;
          failedAccount = account;
          controller.abort(failure);
        }
        return;
      }
    }
  };

  try {
    const workers = Array.from({ length: Math.min(concurrency, contracts.length) }, () => worker());
    await Promise.all(workers);
    if (failure) throw failure;
    if (controller.signal.aborted) {
      if (controller.signal.reason instanceof Error) throw controller.signal.reason;
      throw new Error('TradeStation orders batch aborted');
    }
    console.log('TradeStation orders batch:', {
      endpoint: historical ? 'account/historicalorders' : 'account/orders',
      accountsCount: contracts.length,
      concurrency,
      durationMs: Date.now() - started,
      completedAccounts: completed,
      failedAccount: null,
      state: 'done',
    });
    return results.flat();
  } catch (error) {
    console.error('TradeStation orders batch:', {
      endpoint: historical ? 'account/historicalorders' : 'account/orders',
      accountsCount: contracts.length,
      concurrency,
      durationMs: Date.now() - started,
      completedAccounts: completed,
      failedAccount,
      state: 'error',
    });
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
};
