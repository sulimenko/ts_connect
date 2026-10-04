async ({ url, headers, method = 'GET', data = null, form = null }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const options = {
      method,
      headers,
      redirect: 'error',
      signal: controller.signal,
    };
    if (form !== null) options.body = form;
    else if (data !== null) options.body = JSON.stringify(data);
    const response = await fetch(url, options);
    return { status: response.status, body: await response.json() };
  } catch {
    // No raw fetch/SDK exceptions may reach Impress, telemetry or public API.
    return { status: 0, body: null };
  } finally {
    clearTimeout(timer);
  }
};
