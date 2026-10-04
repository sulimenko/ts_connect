({
  router({ method, verb }) {
    const ip = context.client.ip;
    // Hook bodies and headers may contain execution credentials.
    console.log({ method, ip, verb });
    return {};
  },
});
