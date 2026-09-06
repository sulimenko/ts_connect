async ({ account, live, token, orderIds = [], start = null, limit = null, historical = false, signal = null, deadline = null }) => {
  const accountId = `${account ?? ''}`.trim();
  if (!accountId) throw new Error('TradeStation orders account is required');

  const endpoint = ['brokerage', 'accounts', accountId, historical ? 'historicalorders' : 'orders'];
  if (Array.isArray(orderIds) && orderIds.length > 0) endpoint.push(orderIds.join(','));
  const endpointName = endpoint.join('/');
  const mode = historical ? 'historical' : 'current';

  const data = {};
  if (historical) {
    data.since = start || new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().split('T')[0];
  }
  if (limit !== null) data.pageSize = limit;

  const timeoutError = () => {
    const error = new Error(`TradeStation ${mode} orders timed out for ${accountId}`);
    error.code = 'ETIMEOUT';
    error.retryable = true;
    return error;
  };
  const abortError = () => {
    if (signal?.reason instanceof Error) return signal.reason;
    const error = new Error(`TradeStation ${mode} orders aborted for ${accountId}`);
    error.name = 'AbortError';
    return error;
  };
  const wait = (delay) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      let timer = null;
      const abort = () => {
        if (timer) clearTimeout(timer);
        reject(abortError());
      };
      timer = setTimeout(() => {
        signal?.removeEventListener('abort', abort);
        resolve();
      }, delay);
      signal?.addEventListener('abort', abort, { once: true });
    });
  const timeoutCodes = new Set(['ETIMEDOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);
  const networkCodes = new Set(['ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_SOCKET']);
  const transient = new Set([429, 502, 503, 504]);
  let response = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (signal?.aborted) throw abortError();
    const remaining = deadline === null ? 7000 : deadline - Date.now();
    if (remaining <= 0) throw timeoutError();

    const controller = new AbortController();
    const meta = {};
    const started = Date.now();
    let timedOut = false;
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(
      () => {
        timedOut = true;
        controller.abort();
      },
      Math.min(7000, remaining),
    );
    console.log('TradeStation orders read:', {
      endpoint: endpointName,
      account: accountId,
      mode,
      attempt,
      state: 'start',
      durationMs: 0,
      httpStatus: null,
      ordersCount: null,
      retryable: null,
      retryAttempt: attempt - 1,
    });

    try {
      response = await lib.ts.send({ method: 'GET', live, endpoint, token, data, signal: controller.signal, meta });
      if (!response || typeof response !== 'object' || Array.isArray(response)) {
        throw Object.assign(new Error('Unexpected TradeStation orders response'), { code: 'ERESPONSE' });
      }
      if (response.Errors !== undefined && response.Errors !== null && !Array.isArray(response.Errors)) {
        throw Object.assign(new Error('Unexpected TradeStation orders Errors shape'), { code: 'ERESPONSE' });
      }
      if (response.Orders !== undefined && response.Orders !== null && !Array.isArray(response.Orders)) {
        throw Object.assign(new Error('Unexpected TradeStation orders Orders shape'), { code: 'ERESPONSE' });
      }
      console.log('TradeStation orders read:', {
        endpoint: endpointName,
        account: accountId,
        mode,
        attempt,
        state: 'done',
        durationMs: Date.now() - started,
        httpStatus: meta.status ?? 200,
        ordersCount: response.Orders?.length ?? 0,
        retryable: false,
        retryAttempt: attempt - 1,
      });
      break;
    } catch (caught) {
      let error = caught;
      if (signal?.aborted) error = abortError();
      else if (timedOut) error = timeoutError();
      const codes = [error.code, error.cause?.code];
      const malformed = error.code === 'ERESPONSE';
      const timeout = error.status === 408 || error.code === 'ETIMEOUT' || codes.some((code) => timeoutCodes.has(code));
      const network = codes.some((code) => networkCodes.has(code));
      if (timeout && !malformed) error.code = 'ETIMEOUT';
      const retryable = !signal?.aborted && !malformed && (timeout || network || transient.has(error.status));
      console.error('TradeStation orders read:', {
        endpoint: endpointName,
        account: accountId,
        mode,
        attempt,
        state: 'error',
        durationMs: Date.now() - started,
        httpStatus: error.status ?? meta.status ?? null,
        ordersCount: null,
        retryable,
        retryAttempt: attempt - 1,
      });
      if (!retryable || attempt === 2) {
        throw error;
      }
      const delay = 100 * attempt;
      if (deadline !== null && delay >= deadline - Date.now()) throw error;
      await wait(delay);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  return {
    errors: response.Errors ?? [],
    orders: response.Orders ?? [],
  };
};
