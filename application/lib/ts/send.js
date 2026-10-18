async ({
  method,
  domain = null,
  live = false,
  ver = 'v3',
  endpoint,
  token,
  data = {},
  type = 'application/json',
  signal = null,
  meta = null,
}) => {
  const started = Date.now();
  let phase = 'request';
  let headersAt = null;
  let httpStatus = null;
  try {
    if (domain === null) domain = lib.utils.constructDomain(live);
    const ep = [ver, ...endpoint];
    const url = lib.utils.constructURL(method, domain, ep, data);

    const options = { method, headers: {} };
    if (signal) options.signal = signal;

    if (token !== null) options.headers.Authorization = `Bearer ${token}`;
    const urlEncodedData = new URLSearchParams(data).toString();

    if (method === 'POST') {
      options.headers['Content-Type'] = type;
      if (type === 'application/json') {
        options.body = JSON.stringify(data);
      } else if (type === 'application/x-www-form-urlencoded') {
        options.body = urlEncodedData;
      }
    }

    phase = 'headers';
    if (meta) meta.phase = phase;
    const res = await fetch(url, options);
    headersAt = Date.now();
    httpStatus = res.status;
    phase = 'body';
    const retryAfter = res.headers?.get?.('retry-after') ?? null;
    if (meta && typeof meta === 'object') {
      meta.status = res.status;
      meta.retryAfter = retryAfter;
      meta.phase = phase;
      meta.headersDurationMs = headersAt - started;
    }
    if (res.ok) {
      try {
        const result = await res.json();
        if (meta) {
          meta.phase = 'complete';
          meta.bodyDurationMs = Date.now() - headersAt;
        }
        return result;
      } catch (error) {
        // An interrupted body is a transport failure, not malformed JSON.
        if (error.name === 'SyntaxError' && !signal?.aborted) {
          error.code = 'ERESPONSE';
          error.retryable = false;
        }
        throw error;
      }
    } else {
      const errorText = await res.text();
      phase = 'response';
      const responseText = errorText.trim();
      const values = [responseText];
      let brokerError = null;
      if (responseText) {
        try {
          brokerError = JSON.parse(responseText);
          const pending = [brokerError];
          while (pending.length > 0) {
            const value = pending.pop();
            if (typeof value === 'string') values.push(value.trim());
            else if (Array.isArray(value)) pending.push(...value);
            else if (value && typeof value === 'object') pending.push(...Object.values(value));
          }
        } catch {
          // Plain text upstream errors are valid response bodies.
        }
      }

      const error = new Error(`HTTP Error: ${res.status} ${res.statusText}`);
      error.status = res.status;
      error.statusText = res.statusText;
      error.responseText = responseText;
      error.retryAfter = retryAfter;
      const contentType = res.headers?.get?.('content-type')?.split(';')[0].trim().toLowerCase();
      error.validErrorResponse = Boolean(
        (!contentType || contentType === 'application/json') &&
        brokerError &&
        typeof brokerError === 'object' &&
        !Array.isArray(brokerError) &&
        typeof brokerError.Message === 'string' &&
        brokerError.Message.trim() &&
        (brokerError.Error === undefined || (typeof brokerError.Error === 'string' && brokerError.Error.trim())) &&
        (brokerError.StatusCode === undefined || brokerError.StatusCode === res.status),
      );
      // Only named broker fields are eligible; never log arbitrary body values.
      const safeText = (value, maximum) => {
        if (typeof value !== 'string') return null;
        const text = value.trim();
        if (!text || text.length > maximum || Array.from(text).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
          return null;
        }
        if (typeof token === 'string' && token && text.includes(token)) return null;
        if (/authorization|bearer|token|cookie|secret|password|credential|api.?key|https?:\/\/|eyJ[\w-]+\./i.test(text)) return null;
        return text;
      };
      const sources = [brokerError, brokerError?.Errors?.[0]];
      const brokerMessage = sources.map((source) => safeText(source?.Message ?? source?.message, 256)).find(Boolean) ?? null;
      const requestIds = [
        res.headers?.get?.('x-request-id'),
        res.headers?.get?.('request-id'),
        res.headers?.get?.('x-correlation-id'),
        ...sources.map((source) => source?.RequestID ?? source?.requestId),
      ];
      const requestId = requestIds.map((value) => safeText(value, 128)).find((value) => value && /^[\w.:-]+$/.test(value)) ?? null;
      error.upstream = { brokerMessage, requestId };
      const invalidSymbol = values.some((value) => {
        const message = value.trim().toLowerCase();
        return message === 'invalid symbol' || message.startsWith('invalid symbol:');
      });
      if (res.status === 400 && invalidSymbol) {
        error.code = 'INVALID_SYMBOL';
        error.classification = 'invalid';
        error.permanent = true;
        error.retryable = false;
      }
      console.error('Request failed:', {
        status: error.status,
        statusText: error.statusText,
        code: error.code,
        ...error.upstream,
      });
      throw error;
    }
  } catch (error) {
    error.phase = phase;
    error.httpStatus = httpStatus;
    error.headersDurationMs = headersAt === null ? null : headersAt - started;
    error.bodyDurationMs = headersAt === null ? null : Date.now() - headersAt;
    if (meta) {
      meta.phase = phase;
      meta.bodyDurationMs = error.bodyDurationMs;
    }
    // Log fixed categories only, never dynamic path segments or arbitrary cause text.
    let operation = 'unknown';
    if (Array.isArray(endpoint)) {
      if (endpoint[0] === 'brokerage' && endpoint[1] === 'accounts') {
        operation = 'account';
        if (endpoint[3] === 'positions') operation = 'account_positions';
        else if (endpoint[3] === 'balances') operation = 'account_balances';
      } else if (endpoint[0] === 'marketdata') {
        operation = 'market_data';
      } else if (endpoint[0] === 'orderexecution') {
        operation = 'order_execution';
      } else if (endpoint[0] === 'oauth' && endpoint[1] === 'token') {
        operation = 'oauth_token';
      }
    }
    const logMethod = typeof method === 'string' ? method.toUpperCase() : null;
    const causeCode = error.cause?.code;
    const causeCodes = [
      'EAI_AGAIN',
      'ENOTFOUND',
      'ECONNRESET',
      'ECONNREFUSED',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'ETIMEDOUT',
      'EPIPE',
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_HEADERS_TIMEOUT',
      'UND_ERR_BODY_TIMEOUT',
      'UND_ERR_SOCKET',
      'UND_ERR_ABORTED',
      'ERR_TLS_CERT_ALTNAME_INVALID',
      'CERT_HAS_EXPIRED',
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'SELF_SIGNED_CERT_IN_CHAIN',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    ];
    console.error('Error in send function:', {
      name: error.name,
      status: error.status,
      statusText: error.statusText,
      code: error.code,
      method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(logMethod) ? logMethod : null,
      operation,
      causeCode: causeCodes.includes(causeCode) ? causeCode : null,
      phase,
      durationMs: Date.now() - started,
      headersDurationMs: error.headersDurationMs,
      bodyDurationMs: error.bodyDurationMs,
      httpStatus,
      ...error.upstream,
    });
    throw error;
  }
};
