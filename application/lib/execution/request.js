async ({ url, headers, deadline, method = 'GET', data = null, form = null }) => {
  const now = Date.now();
  const remaining = deadline - now;
  if (!Number.isFinite(remaining) || remaining <= 0) return { status: 0, body: null, started: false };
  const duration = Math.min(12000, remaining);
  const expires = now + duration;
  const controller = new AbortController();
  let started = false;
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ status: 0, body: null, started });
    }, duration);
  });
  try {
    const options = {
      method,
      headers,
      redirect: 'error',
      signal: controller.signal,
    };
    if (form !== null) options.body = form;
    else if (data !== null) options.body = JSON.stringify(data);
    // Bound both headers and JSON body, even if a transport ignores abort.
    const read = async () => {
      if (Date.now() >= expires) return { status: 0, body: null, started: false };
      started = true;
      const response = await fetch(url, options);
      if (Date.now() >= expires) return { status: 0, body: null, started };
      const body = await response.json();
      if (Date.now() >= expires) return { status: 0, body: null, started };
      return { status: response.status, body, started };
    };
    return await Promise.race([read(), timeout]);
  } catch {
    // No raw fetch/SDK exceptions may reach Impress, telemetry or public API.
    return { status: 0, body: null, started };
  } finally {
    clearTimeout(timer);
  }
};
