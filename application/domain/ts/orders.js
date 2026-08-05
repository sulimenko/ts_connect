({
  values: new Map(),

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

  merge({ live, account, order }) {
    if (!order || typeof order !== 'object' || Array.isArray(order)) return null;
    const accountId = `${order.AccountID ?? account ?? ''}`.trim();
    const orderId = `${order.OrderID ?? ''}`.trim();
    if (!accountId || !orderId) return { ...order, AccountID: accountId || null, OrderID: orderId || null };
    const previous = this.get({ live, account: accountId, orderId }) ?? {};
    const merged = { ...previous, ...order, AccountID: accountId, OrderID: orderId };
    if (!Array.isArray(order.Legs) && Array.isArray(previous.Legs)) {
      merged.Legs = previous.Legs;
    } else if (Array.isArray(order.Legs) && Array.isArray(previous.Legs)) {
      merged.Legs = order.Legs.map((leg, index) => {
        const cached = previous.Legs[index] ?? {};
        return { ...cached, ...leg };
      });
    }
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

  commit({ live, account, order }) {
    const merged = this.merge({ live, account, order });
    if (this.missing(merged).length > 0) return false;
    const key = this.key({ live, account: merged.AccountID, orderId: merged.OrderID });
    const fingerprint = this.fingerprint(merged);
    if (this.values.get(key)?.fingerprint === fingerprint) return false;
    this.values.set(key, { order: merged, fingerprint });
    return true;
  },

  clearAccount({ live, account }) {
    const prefix = `${live === true}|${`${account ?? ''}`.trim()}|`;
    for (const key of this.values.keys()) {
      if (key.startsWith(prefix)) this.values.delete(key);
    }
  },
});
