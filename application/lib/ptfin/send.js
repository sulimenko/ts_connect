async ({ method, endpoint, data = {}, type = 'application/json' }) => {
  // let url = [, ...endpoint].filter((e) => e !== null).join('/');
  endpoint.unshift('api','ts');
  const url = lib.utils.constructURL(method, config.ptfin.main.url, endpoint, data);

  const options = {
    method,
    headers: {
      Authorization: 'Bearer ' + config.ptfin.main.token,
    },
  };

  if (method === 'PUT') {
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
