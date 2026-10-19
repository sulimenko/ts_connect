async ({ contracts, token, orderIds = [], start = null, limit = null, historical = false, signal = null, withOutcomes = false }) => {
  const concurrency = 3;
  const started = Date.now();
  const deadline = started + 18000;
  const controller = new AbortController();
  const results = new Array(contracts.length);
  const structured = withOutcomes === true;
  const outcomes = structured
    ? contracts.map((contract) => ({
        account: `${contract.account ?? ''}`.trim(),
        live: contract.live === 1 || contract.live === '1' || contract.live === true || contract.live === 'true',
        source: historical ? 'historical' : 'current',
        state: 'not_started',
        complete: false,
        orders: [],
      }))
    : null;
  // Only local classifications may reach the public error object.
  const safeCodes = new Set([
    'ETIMEOUT',
    'ERESPONSE',
    'EHISTORICALSTART',
    'ECONNRESET',
    'ECONNREFUSED',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ENOTFOUND',
    'EAI_AGAIN',
    'UND_ERR_SOCKET',
    'ERR_TLS_CERT_ALTNAME_INVALID',
  ]);
  const publicError = (error) => {
    const code = [error?.code, error?.cause?.code].find((value) => safeCodes.has(value));
    const status = error?.httpStatus ?? error?.status;
    return {
      code: code ?? (Number.isInteger(status) ? 'EHTTP' : 'ETRANSPORT'),
      phase: ['request', 'headers', 'body', 'response', 'complete'].includes(error?.phase) ? error.phase : 'request',
      httpStatus: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    };
  };
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
      if (structured && Date.now() >= deadline) {
        controller.abort(timeout);
        return;
      }
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
          withOutcomes: structured,
        });
        if (structured) {
          // A body finishing after the shared deadline cannot prove completeness.
          if (controller.signal.aborted || Date.now() >= deadline) throw timeout;
          outcomes[index] = { ...outcomes[index], ...response.outcome, orders: response.orders };
          if (outcomes[index].complete) completed += 1;
          continue;
        }
        if (response.errors.length > 0) {
          const error = new Error(`TradeStation orders failed for account ${account}`);
          error.account = account;
          throw error;
        }
        results[index] = response.orders;
        completed += 1;
      } catch (error) {
        if (structured) {
          const metadata = publicError(error);
          if (controller.signal.aborted && controller.signal.reason === timeout) metadata.code = 'ETIMEOUT';
          outcomes[index] = {
            ...outcomes[index],
            state: metadata.code === 'ETIMEOUT' ? 'timeout' : 'error',
            error: metadata,
          };
          continue;
        }
        if (!failure) {
          failure =
            controller.signal.aborted && controller.signal.reason instanceof Error
              ? Object.assign(new Error(controller.signal.reason.message), error, controller.signal.reason)
              : error;
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
    if (structured) {
      if (signal?.aborted) {
        if (signal.reason instanceof Error) throw signal.reason;
        throw new Error('TradeStation orders batch aborted');
      }
      return { complete: outcomes.every((outcome) => outcome.complete), outcomes };
    }
    if (failure) throw failure;
    if (controller.signal.aborted) {
      if (controller.signal.reason instanceof Error) throw controller.signal.reason;
      throw new Error('TradeStation orders batch aborted');
    }
    if (Date.now() >= deadline) throw timeout;
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
      code: error.code ?? null,
      phase: error.phase ?? null,
      httpStatus: error.httpStatus ?? error.status ?? null,
      timeoutSource: error.timeoutSource ?? null,
    });
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
};
