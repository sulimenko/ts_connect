async ({ method, domain = null, live = false, ver = 'v3', endpoint, token, data = {}, type = 'application/json' }) => {
  try {
    if (domain === null) domain = lib.utils.constructDomain(live);
    const ep = [ver, ...endpoint];
    const url = lib.utils.constructURL(method, domain, ep, data);

    const options = { method, headers: {} };

    if (token !== null) options.headers.Authorization = `Bearer ${token}`;
    const urlEncodedData = new URLSearchParams(data).toString();

    if (method === 'POST') {
      options.headers['Content-Type'] = type;
      if (type === 'application/json') {
        options.body = JSON.stringify(data);
        // options.json = true;
      } else if (type === 'application/x-www-form-urlencoded') {
        options.body = urlEncodedData;
      }
    }

    // console.debug('Request URL:', url);
    // console.debug('Request Options:', options);

    const res = await fetch(url, options);
    if (res.ok) {
      // return res.status === 200 ? res.json() : res.text();
      return await res.json();
    } else {
      const errorText = await res.text();
      const responseText = errorText.trim();
      const values = [responseText];
      if (responseText) {
        try {
          const pending = [JSON.parse(responseText)];
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
      if (res.status === 400 && values.some((value) => value.toLowerCase() === 'invalid symbol')) {
        error.code = 'INVALID_SYMBOL';
        error.classification = 'invalid';
        error.permanent = true;
        error.retryable = false;
      }
      console.error('Request failed:', {
        status: error.status,
        statusText: error.statusText,
        code: error.code,
        responseText: error.responseText,
      });
      throw error;
    }
  } catch (error) {
    console.error('Error in send function:', error);
    throw error;
  }
};
