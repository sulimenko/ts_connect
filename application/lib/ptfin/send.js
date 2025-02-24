async ({ method, endpoint, data = {}, type = 'application/json' }) => {
  let url = [config.ptfin.main.url, ...endpoint].filter((e) => e !== null).join('/');
  const options = {
    method,
    headers: {
      Authorization: 'Bearer ' + config.ptfin.main.token,
    },
  };

  if (method === 'GET') {
    url += '?' + new URLSearchParams(data).toString();
  } else if (method === 'PUT') {
    options.headers['Content-Type'] = type;
    options.body = JSON.stringify(data);
  } else if (method === 'POST') {
    options.headers['Content-Type'] = type;
    if (type === 'application/json') options.body = JSON.stringify(data);
  }

  // console.log(url, options);

  const res = await fetch(url, options);
  return res.status === 200 ? res.json() : res.text();
};
