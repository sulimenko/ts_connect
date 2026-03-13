({
  entries: {
    charts: new Map(),
    chains: new Map(),
    matrix: new Map(),
    quotes: new Map(),
  },

  defaultIdleMs: 2 * 60 * 1000,

  getBucket({ kind }) {
    if (!this.entries[kind]) this.entries[kind] = new Map();
    return this.entries[kind];
  },

  getEntry({ kind, key }) {
    return this.getBucket({ kind }).get(key) ?? null;
  },

  resolveIdleMs(idleMs, fallback = this.defaultIdleMs) {
    const timeout = Number(idleMs);
    if (!Number.isFinite(timeout) || timeout <= 0) return fallback;
    return Math.max(1000, Math.floor(timeout));
  },

  serializeError(error) {
    if (error instanceof Error) {
      return {
        message: error.message,
        name: error.name,
        stack: error.stack,
      };
    }

    if (typeof error === 'string') return { message: error };
    return { message: String(error?.message ?? error) };
  },

  emit(entry, eventName, payload) {
    entry.lastMessageAt = Date.now();
    for (const subscription of entry.subscribers.values()) {
      try {
        subscription.client.emit(eventName, payload);
      } catch (error) {
        console.error(`Failed to emit ${eventName} for ${entry.kind}:${entry.key}:`, error);
      }
    }
  },

  notifyError(entry, error) {
    const payload = {
      kind: entry.kind,
      streamKey: entry.key,
      error: this.serializeError(error),
    };
    this.emit(entry, 'stream/error', payload);
  },

  touch({ kind, key, client, idleMs = null }) {
    const entry = this.getEntry({ kind, key });
    if (!entry) return { active: false, kind, streamKey: key, subscribers: 0 };

    const subscription = entry.subscribers.get(client);
    if (!subscription) return { active: false, kind, streamKey: key, subscribers: entry.subscribers.size };

    const timeout = this.resolveIdleMs(idleMs, subscription.idleMs);
    clearTimeout(subscription.idleTimer);

    subscription.idleMs = timeout;
    subscription.touchedAt = Date.now();
    subscription.idleTimer = setTimeout(() => {
      this.unsubscribe({ kind, key, client }).catch((error) => {
        console.error(`Failed to cleanup idle subscription ${kind}:${key}:`, error);
      });
    }, timeout);

    return {
      active: true,
      kind,
      streamKey: key,
      subscribers: entry.subscribers.size,
      idleMs: timeout,
    };
  },

  async stopEntry({ kind, key }) {
    const bucket = this.getBucket({ kind });
    const entry = bucket.get(key);
    if (!entry) return false;

    bucket.delete(key);

    for (const subscription of entry.subscribers.values()) {
      clearTimeout(subscription.idleTimer);
      subscription.client.removeListener('close', subscription.onClose);
    }
    entry.subscribers.clear();

    if (entry.upstream?.stop) {
      try {
        await entry.upstream.stop();
      } catch (error) {
        console.error(`Failed to stop managed stream ${kind}:${key}:`, error);
      }
    }

    return true;
  },

  async unsubscribe({ kind, key, client }) {
    const entry = this.getEntry({ kind, key });
    if (!entry) return { active: false, kind, streamKey: key, subscribers: 0, removed: false };

    const subscription = entry.subscribers.get(client);
    if (!subscription) {
      return { active: true, kind, streamKey: key, subscribers: entry.subscribers.size, removed: false };
    }

    clearTimeout(subscription.idleTimer);
    subscription.client.removeListener('close', subscription.onClose);
    entry.subscribers.delete(client);

    const subscribers = entry.subscribers.size;
    if (subscribers === 0) {
      await this.stopEntry({ kind, key });
      return { active: false, kind, streamKey: key, subscribers, removed: true };
    }

    return { active: true, kind, streamKey: key, subscribers, removed: true };
  },

  async unsubscribeAll({ client }) {
    const removed = [];

    for (const kind of Object.keys(this.entries)) {
      const keys = Array.from(this.getBucket({ kind }).keys());
      for (const key of keys) {
        const entry = this.getEntry({ kind, key });
        if (!entry || !entry.subscribers.has(client)) continue;
        removed.push(await this.unsubscribe({ kind, key, client }));
      }
    }

    return removed;
  },

  async subscribe({ kind, key, client, idleMs = null, metadata = {}, start }) {
    if (!client) throw new Error('Metacom client is required');

    const bucket = this.getBucket({ kind });
    let entry = bucket.get(key);
    const created = entry === undefined;

    if (!entry) {
      entry = {
        kind,
        key,
        metadata,
        createdAt: Date.now(),
        lastMessageAt: null,
        subscribers: new Map(),
        upstream: null,
      };
      bucket.set(key, entry);

      try {
        const upstream = await start({
          entry,
          emit: (eventName, payload) => this.emit(entry, eventName, payload),
          notifyError: (error) => this.notifyError(entry, error),
        });

        if (!upstream || typeof upstream.stop !== 'function') {
          throw new Error(`Managed stream "${kind}" must provide stop()`);
        }

        entry.upstream = upstream;
      } catch (error) {
        bucket.delete(key);
        throw error;
      }
    } else if (Object.keys(metadata).length > 0) {
      entry.metadata = { ...entry.metadata, ...metadata };
    }

    let subscription = entry.subscribers.get(client);
    const subscribed = subscription === undefined;

    if (!subscription) {
      const onClose = () => {
        this.unsubscribe({ kind, key, client }).catch((error) => {
          console.error(`Failed to cleanup closed client subscription ${kind}:${key}:`, error);
        });
      };

      subscription = {
        client,
        idleMs: this.resolveIdleMs(idleMs),
        idleTimer: null,
        onClose,
        touchedAt: Date.now(),
      };

      client.on('close', onClose);
      entry.subscribers.set(client, subscription);
    }

    const state = this.touch({ kind, key, client, idleMs });
    return { ...state, created, subscribed, metadata: entry.metadata };
  },

  list() {
    const result = {};

    for (const kind of Object.keys(this.entries)) {
      result[kind] = Array.from(this.getBucket({ kind }).values()).map((entry) => ({
        key: entry.key,
        createdAt: entry.createdAt,
        lastMessageAt: entry.lastMessageAt,
        metadata: entry.metadata,
        subscribers: entry.subscribers.size,
      }));
    }

    return result;
  },
});
