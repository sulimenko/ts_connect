({
  host: process.env.host || '0.0.0.0',
  // balancer: 8000,
  protocol: process.env.protocol || 'http',
  ports: [parseInt(process.env.port) || 11500],
  nagle: false,
  timeouts: {
    bind: 2000,
    start: 30000,
    stop: 5000,
    request: 5000,
    watch: 1000,
    test: 60000,
  },
  queue: {
    concurrency: 1000,
    size: 2000,
    timeout: 3000,
  },
  scheduler: {
    concurrency: 10,
    size: 2000,
    timeout: 3000,
  },
  workers: {
    pool: 0,
    wait: 2000,
    timeout: 5000,
  },
  cors: {
    origin: '*',
  },
});
