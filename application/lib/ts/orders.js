async ({
  account,
  live,
  token,
  orderIds = [],
  start = null,
  limit = null,
  historical = false,
  signal = null,
  deadline = null,
  withOutcomes = false,
}) => {
  const accountId = `${account ?? ''}`.trim();
  if (!accountId) throw new Error('TradeStation orders account is required');

  const exact = Array.isArray(orderIds) && orderIds.length > 0;
  const endpoint = ['brokerage', 'accounts', accountId, historical ? 'historicalorders' : 'orders'];
  if (exact) endpoint.push(orderIds.join(','));
  const endpointName = endpoint.join('/');
  const mode = historical ? 'historical' : 'current';
  if (exact && historical && (typeof start !== 'string' || !start.trim())) {
    const error = new Error(`TradeStation exact historical orders require explicit start for ${accountId}`);
    error.code = 'EHISTORICALSTART';
    error.retryable = false;
    console.error('TradeStation orders read:', {
      endpoint: endpointName,
      account: accountId,
      mode,
      state: 'source_unavailable',
      code: error.code,
      retryable: false,
    });
    throw error;
  }

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
    if (signal?.reason instanceof Error) return Object.assign(new Error(signal.reason.message), signal.reason);
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
  const timeoutCodes = new Set(['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);
  const networkCodes = new Set(['ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_SOCKET']);
  const transient = new Set([429, 502, 503, 504]);
  // Preserve the standalone two-attempt envelope; batches supply their shared deadline.
  const readDeadline = deadline ?? Date.now() + 14100;
  let response = null;
  let outcome = null;
  let validatedOrders = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (signal?.aborted) throw abortError();
    const remaining = readDeadline - Date.now();
    if (remaining <= 0) throw timeoutError();
    // A live batch read can use the remaining deadline. Retry only an actual
    // failure while budget remains; reserving half would abort a viable slow body.
    const attemptTimeoutMs = deadline === null ? Math.min(7000, remaining) : remaining;

    const controller = new AbortController();
    const meta = {};
    const started = Date.now();
    let timedOut = false;
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, attemptTimeoutMs);
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
      if (signal?.aborted) throw abortError();
      if (timedOut || Date.now() >= readDeadline) throw timeoutError();
      if (!response || typeof response !== 'object' || Array.isArray(response)) {
        throw Object.assign(new Error('Unexpected TradeStation orders response'), { code: 'ERESPONSE' });
      }
      if (withOutcomes === true) {
        const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
        const text = (value) => typeof value === 'string' && value.trim().length > 0;
        const numeric = (value) =>
          (typeof value === 'number' || (text(value) && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value))) &&
          Number.isFinite(Number(value));
        const quantity = (value) => numeric(value) && Number(value) >= 0;
        const timestamp = (value) =>
          text(value) &&
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
          Number.isFinite(Date.parse(value));
        // Only statuses explicitly mapped by the Back reconciliation consumer.
        // FLP cancels the remainder; retain its reported executed quantity.
        const statuses = new Set(['DON', 'OPN', 'ACK', 'FPR', 'FLL', 'OUT', 'CAN', 'FLP', 'REJ', 'FAILED']);
        const fills = new Set(['FLL', 'FLP', 'FPR']);
        // The opt-in reconciliation consumer supports these asset types only.
        const assets = new Set(['STOCK', 'STOCKOPTION', 'IDX']);
        const actions = new Set(['BUY', 'SELL', 'SELLSHORT', 'BUYTOCOVER', 'BUYTOOPEN', 'BUYTOCLOSE', 'SELLTOOPEN', 'SELLTOCLOSE']);
        const counts = new Map();
        if (Array.isArray(response.Orders)) {
          for (const order of response.Orders) {
            if (record(order) && order.AccountID === accountId && text(order.OrderID)) {
              counts.set(order.OrderID, (counts.get(order.OrderID) ?? 0) + 1);
            }
          }
        }
        validatedOrders = Array.isArray(response.Orders)
          ? response.Orders.filter(
              (order) =>
                record(order) &&
                text(order.OrderID) &&
                order.AccountID === accountId &&
                (!exact || orderIds.includes(order.OrderID)) &&
                counts.get(order.OrderID) === 1 &&
                order.Error === undefined &&
                statuses.has(order.Status) &&
                ['Market', 'Limit', 'StopMarket', 'StopLimit'].includes(order.OrderType) &&
                text(order.Currency) &&
                ['DAY', 'DAY+', 'GTC', 'GTC+'].includes(order.Duration) &&
                timestamp(order.OpenedDateTime) &&
                // An absent optional close time does not invalidate positive evidence.
                (order.ClosedDateTime === undefined ||
                  order.ClosedDateTime === null ||
                  (timestamp(order.ClosedDateTime) && Date.parse(order.ClosedDateTime) >= Date.parse(order.OpenedDateTime))) &&
                ['FilledPrice', 'LimitPrice', 'StopPrice'].every(
                  (field) => order[field] === undefined || order[field] === null || numeric(order[field]),
                ) &&
                (!['StopMarket', 'StopLimit'].includes(order.OrderType) || numeric(order.StopPrice)) &&
                Array.isArray(order.Legs) &&
                order.Legs.length > 0 &&
                order.Legs.every(
                  (leg) =>
                    record(leg) &&
                    text(leg.Symbol) &&
                    text(leg.BuyOrSell) &&
                    actions.has(leg.BuyOrSell.toUpperCase()) &&
                    assets.has(leg.AssetType) &&
                    quantity(leg.QuantityOrdered) &&
                    (leg.ExecQuantity === undefined
                      ? !fills.has(order.Status)
                      : quantity(leg.ExecQuantity) && Number(leg.ExecQuantity) <= Number(leg.QuantityOrdered)) &&
                    (leg.QuantityRemaining === undefined || quantity(leg.QuantityRemaining)) &&
                    (leg.ExecutionPrice === undefined || leg.ExecutionPrice === null || numeric(leg.ExecutionPrice)) &&
                    (!['Limit', 'StopLimit'].includes(order.OrderType) || numeric(leg.ExecutionPrice ?? order.LimitPrice)),
                ) &&
                (!fills.has(order.Status) || order.Legs.some((leg) => Number(leg.ExecQuantity) > 0)),
            )
          : [];
        const errorsValid =
          response.Errors === undefined ||
          (Array.isArray(response.Errors) && response.Errors.every((error) => record(error) && text(error.Error)));
        const tokenValid = response.NextToken === undefined || typeof response.NextToken === 'string';
        const hasMore = tokenValid && Boolean(response.NextToken?.length);
        // Page is not requested by this reader. Without a verified page schema,
        // it cannot certify a complete snapshot, even when NextToken is absent.
        const pagePresent = response.Page !== undefined;
        const malformed =
          !Array.isArray(response.Orders) ||
          validatedOrders.length !== response.Orders.length ||
          !errorsValid ||
          !tokenValid ||
          pagePresent ||
          response.Error !== undefined ||
          (response.AccountID !== undefined && response.AccountID !== accountId) ||
          (response.OrderID !== undefined && (!exact || !orderIds.includes(response.OrderID)));
        const brokerError = errorsValid && (response.Errors?.length ?? 0) > 0;
        // Preserve a proven fill without inventing the close timestamp Back would
        // otherwise supply. Its final temporal evidence is still incomplete.
        const missingClose = validatedOrders.some(
          (order) => ['FLL', 'FLP'].includes(order.Status) && (order.ClosedDateTime === undefined || order.ClosedDateTime === null),
        );
        const complete = !malformed && !brokerError && !hasMore && !missingClose;
        outcome = {
          state: 'complete',
          complete,
        };
        if (!complete) outcome.state = validatedOrders.length > 0 || hasMore ? 'partial' : 'error';
        if ((tokenValid && !pagePresent) || hasMore) outcome.hasMore = hasMore;
        if (malformed || brokerError || missingClose) {
          let code = 'EINCOMPLETE';
          if (brokerError) code = 'EBROKER';
          if (malformed) code = 'ERESPONSE';
          outcome.error = {
            code,
            phase: 'complete',
            httpStatus: meta.status ?? 200,
          };
        }
      }
      if (withOutcomes !== true) {
        if (response.Errors !== undefined && response.Errors !== null && !Array.isArray(response.Errors)) {
          throw Object.assign(new Error('Unexpected TradeStation orders Errors shape'), { code: 'ERESPONSE' });
        }
        if (response.Orders !== undefined && response.Orders !== null && !Array.isArray(response.Orders)) {
          throw Object.assign(new Error('Unexpected TradeStation orders Orders shape'), { code: 'ERESPONSE' });
        }
        if (exact && !Array.isArray(response.Orders) && !(response.Errors?.length > 0)) {
          throw Object.assign(new Error('Missing TradeStation exact orders Orders array'), { code: 'ERESPONSE' });
        }
        if (exact && response.Orders?.some((order) => !order || typeof order.OrderID !== 'string' || !order.OrderID.trim())) {
          throw Object.assign(new Error('Unexpected TradeStation exact orders entry'), { code: 'ERESPONSE' });
        }
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
        phase: meta.phase ?? 'complete',
        headersDurationMs: meta.headersDurationMs ?? null,
        bodyDurationMs: meta.bodyDurationMs ?? null,
      });
      break;
    } catch (caught) {
      let error = caught;
      if (signal?.aborted) error = abortError();
      else if (timedOut) error = timeoutError();
      const { miss: lookupMiss, brokerMessage, requestId } = lib.ts.orderError({ error, exact });
      const codes = [error.code, error.cause?.code];
      const malformed = error.code === 'ERESPONSE';
      const timeout = error.status === 408 || error.code === 'ETIMEOUT' || codes.some((code) => timeoutCodes.has(code));
      const network = codes.some((code) => networkCodes.has(code));
      if (timeout && !malformed) error.code = 'ETIMEOUT';
      error.phase = caught.phase ?? meta.phase ?? 'headers';
      error.httpStatus = caught.httpStatus ?? meta.status ?? caught.status ?? null;
      error.headersDurationMs = caught.headersDurationMs ?? meta.headersDurationMs ?? null;
      error.bodyDurationMs = caught.bodyDurationMs ?? meta.bodyDurationMs ?? null;
      if (timeout) {
        error.timeoutSource = 'transport';
        if (signal?.aborted) error.timeoutSource = 'parent';
        else if (Date.now() >= readDeadline) error.timeoutSource = 'deadline';
        else if (timedOut) error.timeoutSource = 'attempt';
      }
      const miss = withOutcomes !== true && lookupMiss && !signal?.aborted && !timedOut && !malformed && !timeout && !network;
      const retryable = !signal?.aborted && !malformed && error.status !== 404 && (timeout || network || transient.has(error.status));
      const log = miss ? console.log : console.error;
      log.call(console, 'TradeStation orders read:', {
        endpoint: endpointName,
        account: accountId,
        mode,
        attempt,
        state: miss ? 'miss' : 'error',
        durationMs: Date.now() - started,
        httpStatus: error.httpStatus,
        ordersCount: miss ? 0 : null,
        retryable,
        retryAttempt: attempt - 1,
        brokerMessage,
        requestId,
        code: error.code ?? null,
        phase: error.phase,
        timeoutSource: error.timeoutSource ?? null,
        attemptTimeoutMs,
        remainingMs: Math.max(0, readDeadline - Date.now()),
        headersDurationMs: error.headersDurationMs,
        bodyDurationMs: error.bodyDurationMs,
      });
      if (miss) return { errors: [], orders: [] };
      if (!retryable || attempt === 2) {
        throw error;
      }
      const delay = 100 * attempt;
      if (delay >= readDeadline - Date.now()) throw error;
      await wait(delay);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  if (withOutcomes === true) return { orders: validatedOrders, outcome };
  return {
    errors: response.Errors ?? [],
    orders: response.Orders ?? [],
  };
};
