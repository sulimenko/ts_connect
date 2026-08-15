({
  values: new Map(),
  generations: new Map(),

  accountKey({ live, account }) {
    const accountId = `${account ?? ''}`.trim();
    return accountId ? `${live === true}|${accountId}` : null;
  },

  generation({ live, account }) {
    const key = this.accountKey({ live, account });
    if (!key) return 0;
    return this.generations.get(key) ?? 0;
  },

  nextGeneration({ live, account }) {
    const key = this.accountKey({ live, account });
    if (!key) return 0;
    const generation = (this.generations.get(key) ?? 0) + 1;
    this.generations.set(key, generation);
    return generation;
  },

  key({ live, account, orderId }) {
    const accountId = `${account ?? ''}`.trim();
    const id = `${orderId ?? ''}`.trim();
    return accountId && id ? `${live === true}|${accountId}|${id}` : null;
  },

  get({ live, account, orderId }) {
    const key = this.key({ live, account, orderId });
    if (!key) return null;
    return this.values.get(key)?.order ?? null;
  },

  legId(leg) {
    if (!leg || typeof leg !== 'object') return null;
    for (const field of ['LegID', 'OrderLegID']) {
      const value = `${leg[field] ?? ''}`.trim();
      if (value) return { field, value };
    }
    return null;
  },

  mergeLegs(previous, incoming) {
    if (!Array.isArray(incoming) || incoming.length === 0) return Array.isArray(previous) ? previous : incoming;
    if (!Array.isArray(previous) || previous.length === 0) return incoming;

    const legs = previous.map((leg) => ({ ...leg }));
    for (const [index, leg] of incoming.entries()) {
      const id = this.legId(leg);
      let target = index;
      if (id) {
        const found = previous.findIndex((item) => `${item?.[id.field] ?? ''}`.trim() === id.value);
        if (found >= 0) target = found;
        else if (this.legId(legs[target])) target = legs.length;
      }
      const cached = legs[target] ?? {};
      legs[target] = { ...cached, ...leg };
    }
    return legs;
  },

  merge({ live, account, order }) {
    if (!order || typeof order !== 'object' || Array.isArray(order)) return null;
    const accountId = `${order.AccountID ?? account ?? ''}`.trim();
    const orderId = `${order.OrderID ?? ''}`.trim();
    if (!accountId || !orderId) return { ...order, AccountID: accountId || null, OrderID: orderId || null };
    const previous = this.get({ live, account: accountId, orderId }) ?? {};
    const merged = { ...previous, ...order, AccountID: accountId, OrderID: orderId };
    if (order.Legs !== undefined || Array.isArray(previous.Legs)) merged.Legs = this.mergeLegs(previous.Legs, order.Legs);
    return merged;
  },

  missing(order) {
    const fields = [];
    if (!`${order?.OrderID ?? ''}`.trim()) fields.push('OrderID');
    if (!`${order?.AccountID ?? ''}`.trim()) fields.push('AccountID');
    if (!Array.isArray(order?.Legs) || order.Legs.length === 0) {
      fields.push('Legs');
    } else if (order.Legs.some((leg) => !leg || typeof leg !== 'object' || !`${leg.Symbol ?? ''}`.trim())) {
      fields.push('Legs[].Symbol');
    }
    return fields;
  },

  fingerprint(order) {
    const stable = (value) => {
      if (Array.isArray(value)) return value.map(stable);
      if (!value || typeof value !== 'object') return value;
      const result = {};
      for (const key of Object.keys(value).sort()) result[key] = stable(value[key]);
      return result;
    };
    return JSON.stringify(stable(order));
  },

  observe({ live, account, order, generation = null, stream = false }) {
    const merged = this.merge({ live, account, order });
    if (!merged?.OrderID || !merged?.AccountID) return null;
    const key = this.key({ live, account: merged.AccountID, orderId: merged.OrderID });
    const current = this.values.get(key);
    let next = generation ?? this.generation({ live, account: merged.AccountID });
    if (stream) next = this.nextGeneration({ live, account: merged.AccountID });
    if (current && current.generation > next) return { ...current, stale: true };
    const fingerprint = this.fingerprint(merged);
    const deliveries = current?.deliveries ?? new Map();
    if (!deliveries.has(fingerprint)) deliveries.set(fingerprint, 'observed');
    const value = { order: merged, fingerprint, generation: next, deliveries };
    this.values.set(key, value);
    return value;
  },

  pending({ live, account, order, generation = null }) {
    const value = this.observe({ live, account, order, generation });
    if (!value || value.stale || this.missing(value.order).length > 0) return null;
    const state = value.deliveries.get(value.fingerprint);
    if (state === 'pending' || state === 'delivered') return null;
    value.deliveries.set(value.fingerprint, 'pending');
    return value;
  },

  transition({ live, account, orderId, fingerprint, from, to }) {
    const key = this.key({ live, account, orderId });
    const value = key ? this.values.get(key) : null;
    if (!value || value.deliveries.get(fingerprint) !== from) return false;
    value.deliveries.set(fingerprint, to);
    return true;
  },

  delivered(params) {
    return this.transition({ ...params, from: 'pending', to: 'delivered' });
  },

  failed(params) {
    return this.transition({ ...params, from: 'pending', to: 'observed' });
  },

  commit({ live, account, order }) {
    return Boolean(this.pending({ live, account, order }));
  },

  clearAccount({ live, account }) {
    const prefix = `${live === true}|${`${account ?? ''}`.trim()}|`;
    for (const key of this.values.keys()) {
      if (key.startsWith(prefix)) this.values.delete(key);
    }
    this.generations.delete(this.accountKey({ live, account }));
  },
});
