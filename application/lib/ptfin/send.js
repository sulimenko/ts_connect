async ({ method, endpoint, data = {}, type = 'application/json' }) => {
  try {
    // let url = [, ...endpoint].filter((e) => e !== null).join('/');
    const ep = ['api', 'ts', ...endpoint];
    const url = lib.utils.constructURL(method, config.ptfin.main.url, ep, data);

    const options = {
      method,
      headers: {
        Authorization: 'Bearer ' + config.ptfin.main.token,
      },
    };

    if (['PUT', 'POST'].includes(method)) {
      options.headers['Content-Type'] = type;
      if (type === 'application/json') {
        options.body = JSON.stringify(data);
      } else if (type === 'application/x-www-form-urlencoded') {
        options.body = new URLSearchParams(data).toString();
      }
    }

    // console.debug('Request URL:', url);
    // console.debug('Request Options:', options);

    const res = await fetch(url, options);

    if (res.ok) {
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
