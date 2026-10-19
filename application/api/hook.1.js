({
  router({ method, args, verb, headers }) {
    const ip = context.client.ip;
    // Protected execution bodies and headers may contain credentials.
    if (['execution/submit', 'execution/lookup', 'execution/capabilities', 'execution/rules'].includes(method)) {
      console.log({ method, ip, verb });
    } else {
      console.log({ method, args, ip, verb, headers });
    }
    return {};
  },
});
