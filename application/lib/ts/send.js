async ({ method, domain = null, live = false, ver = 'v3', endpoint, token, data = {}, type = 'application/json' }) => {
  if (domain === null)
    domain = [config.ts.url.protocol, (live ? config.ts.url.live : config.ts.url.sim) + config.ts.url.domen, ver].join('/');

  let url = [domain, ...endpoint].join('/');

  const options = { method, headers: {} };

  if (token !== null) options.headers.Authorization = 'Bearer ' + token;
  const urlEncodedData = new URLSearchParams(data).toString();

  if (method === 'GET') {
    if (urlEncodedData) url += '?' + urlEncodedData;
  } else if (method === 'POST') {
    options.headers['Content-Type'] = type;
    if (type === 'application/json') {
      options.body = JSON.stringify(data);
    } else if (type === 'application/x-www-form-urlencoded') {
      options.body = urlEncodedData;
    }
  }

  console.debug(url);
  // console.log(options);

  const res = await fetch(url, options);
  return res.status === 200 ? res.json() : res.text();
};
