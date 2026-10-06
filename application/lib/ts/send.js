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

    const res = await fetch(url, options);
    const retryAfter = res.headers?.get?.('retry-after') ?? null;
    if (meta && typeof meta === 'object') {
      meta.status = res.status;
      meta.retryAfter = retryAfter;
    }
    if (res.ok) {
      try {
        return await res.json();
      } catch (error) {
        error.code = 'ERESPONSE';
        error.retryable = false;
        throw error;
      }
    } else {
      const errorText = await res.text();
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
    console.error('Error in send function:', {
      name: error.name,
      status: error.status,
      statusText: error.statusText,
      code: error.code,
      ...error.upstream,
    });
    throw error;
  }
};
