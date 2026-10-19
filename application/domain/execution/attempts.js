(() => {
  // Non-secret, worker-local receipts bridge a lost HTTP response. Meta's
  // durable placement barriers remain authoritative across connector restart.
  // Unknown attempts never turn into permission to place another order.
  const attempts = new Map();
  // Meta orderId is the sole identity; account/live/intent stay with its owner.
  const get = ({ orderId }) => attempts.get(orderId) || null;
  const claim = (data, fingerprint) => {
    if (!Number.isSafeInteger(data.orderId) || data.orderId <= 0) return { owner: false, conflict: true, attempt: null };
    const existing = get(data);
    if (existing) {
      const conflict = existing.account !== data.account || existing.live !== data.live || existing.fingerprint !== fingerprint;
      return { owner: false, conflict, attempt: existing };
    }
    if (attempts.size >= 10000) return { owner: false, conflict: true, attempt: null };
    const attempt = {
      account: data.account,
      live: data.live,
      fingerprint,
      brokerId: null,
      brokerIds: [],
      relation: null,
      orders: [],
      result: null,
    };
    attempts.set(data.orderId, attempt); // synchronous, before the first await
    return { owner: true, conflict: false, attempt };
  };
  return { get, claim };
})();
