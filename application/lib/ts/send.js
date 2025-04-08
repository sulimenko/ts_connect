async ({ method, domain = null, live = false, ver = 'v3', endpoint, token, data = {}, type = 'application/json' }) => {
  try {
    if (domain === null) domain = lib.utils.constructDomain(live);
    const ep = [ver, ...endpoint];
    const url = lib.utils.constructURL(method, domain, ep, data);

    const options = { method, headers: {} };

    if (token !== null) options.headers.Authorization = 'Bearer ' + token;
    const urlEncodedData = new URLSearchParams(data).toString();

    if (method === 'POST') {
      options.headers['Content-Type'] = type;
      if (type === 'application/json') {
        options.body = JSON.stringify(data);
      } else if (type === 'application/x-www-form-urlencoded') {
        options.body = urlEncodedData;
      }
    }

    console.debug('Request URL:', url);
    console.debug('Request Options:', options);

    const res = await fetch(url, options);
    if (res.ok) {
      // return res.status === 200 ? res.json() : res.text();
      return await res.json();
    } else {
      const errorText = await res.text();
      console.error('Request failed:', res.status, res.statusText, errorText);
      throw new Error(`HTTP Error: ${res.status} ${res.statusText}`);
    }
  } catch (error) {
    console.error('Error in send function:', error);
    throw error; // Пробрасываем ошибку для дальнейшей обработки
  }
};
