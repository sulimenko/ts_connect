(() => {
  // Non-secret, worker-local receipts bridge a lost HTTP response. Meta's
  // durable placement barriers remain authoritative across connector restart.
  // Unknown attempts never turn into permission to place another order.
  const attempts = new Map();
  const key = ({ account, live, orderId }) => JSON.stringify([account, live, orderId]);
  const get = (data) => attempts.get(key(data)) || null;
  const claim = (data, fingerprint) => {
    const existing = get(data);
    if (existing) return { owner: false, conflict: existing.fingerprint !== fingerprint, attempt: existing };
    if (attempts.size >= 10000) return { owner: false, conflict: true, attempt: null };
    const attempt = { fingerprint, brokerId: null, result: null };
    attempts.set(key(data), attempt); // synchronous, before the first await
    return { owner: true, conflict: false, attempt };
  };
  return { get, claim };
})();
