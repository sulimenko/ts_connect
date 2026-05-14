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

  logStop({ kind, key, reason, clientCount = null }) {
    const suffix = clientCount === null ? '' : ` subscribers=${clientCount}`;
    console.info(`Managed stream stop: ${kind}:${key} reason=${reason}${suffix}`);
  },

  logUnsubscribe({ kind, key, reason, remaining }) {
    console.info(`Subscriber removed: ${kind}:${key} reason=${reason} remaining=${remaining}`);
  },

  logDroppedEvent({ entry, eventName }) {
    console.info('Stream event dropped: no subscribers', {
      kind: entry.kind,
      streamKey: entry.key,
      eventName,
      state: entry.state,
      upstreamReady: entry.upstreamReady,
      lastMessageAt: entry.lastMessageAt,
      subscriberCount: entry.subscribers.size,
    });
  },

  serializeError(error) {
    if (error instanceof Error) {
      const serialized = {
        message: error.message,
        name: error.name,
        stack: error.stack,
      };

      if (error.code !== undefined) serialized.code = error.code;
      if (error.code !== undefined) serialized.error = error.code;
      if (error.details !== undefined) serialized.details = error.details;
      if (error.upstreamMessage !== undefined) serialized.upstreamMessage = error.upstreamMessage;
      if (error.symbol !== undefined) serialized.symbol = error.symbol;
      return serialized;
    }

    if (typeof error === 'string') return { message: error };
    if (error?.Error) {
      const message = error.Message ? `${error.Error}: ${error.Message}` : error.Error;
      const serialized = {
        message,
        error: error.Error,
        details: error.Message ?? null,
        upstreamMessage: error.Message ?? null,
        symbol: error.Symbol ?? null,
      };
      if (error.code !== undefined) serialized.code = error.code;
      return serialized;
    }

    if (error?.message) {
      const serialized = { message: error.message };
      if (error.name !== undefined) serialized.name = error.name;
      if (error.code !== undefined) serialized.code = error.code;
      if (error.details !== undefined) serialized.details = error.details;
      if (error.upstreamMessage !== undefined) serialized.upstreamMessage = error.upstreamMessage;
      if (error.symbol !== undefined) serialized.symbol = error.symbol;
      return serialized;
    }

    const fallback = String(error?.message ?? error);
    console.warn('serializeError fallback:', fallback, 'original type:', typeof error);
    return { message: fallback };
  },

  emit(entry, eventName, payload) {
    entry.lastMessageAt = Date.now();
    if (entry.subscribers.size === 0) {
      this.logDroppedEvent({ entry, eventName });
      return;
    }

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
    if (!entry) {
      lib.utils.traceLog({
        scope: `stream/${kind}`,
        phase: 'touch',
        streamKey: key,
        extra: { active: false, subscribers: 0, idleMs: this.resolveIdleMs(idleMs) },
      });
      return { active: false, kind, streamKey: key, subscribers: 0 };
    }

    const subscription = entry.subscribers.get(client);
    if (!subscription) {
      lib.utils.traceLog({
        scope: `stream/${kind}`,
        phase: 'touch',
        streamKey: key,
        extra: { active: false, subscribers: entry.subscribers.size, idleMs: this.resolveIdleMs(idleMs, this.defaultIdleMs) },
      });
      return { active: false, kind, streamKey: key, subscribers: entry.subscribers.size };
    }

    const timeout = this.resolveIdleMs(idleMs, subscription.idleMs);
    clearTimeout(subscription.idleTimer);

    subscription.idleMs = timeout;
    subscription.touchedAt = Date.now();
    subscription.idleTimer = setTimeout(() => {
      this.unsubscribe({ kind, key, client, reason: 'idle' }).catch((error) => {
        console.error(`Failed to cleanup idle subscription ${kind}:${key}:`, error);
      });
    }, timeout);

    lib.utils.traceLog({
      scope: `stream/${kind}`,
      phase: 'touch',
      streamKey: key,
      extra: { active: true, subscribers: entry.subscribers.size, idleMs: timeout },
    });

    return {
      active: true,
      kind,
      streamKey: key,
      subscribers: entry.subscribers.size,
      idleMs: timeout,
    };
  },

  async stopEntry({ kind, key, reason = 'unknown' }) {
    const bucket = this.getBucket({ kind });
    const entry = bucket.get(key);
    if (!entry) return false;

    if (entry.stopPromise) return entry.stopPromise;

    entry.state = 'stopping';
    entry.stopPromise = (async () => {
      bucket.delete(key);
      this.logStop({ kind, key, reason, clientCount: entry.subscribers.size });

      for (const subscription of entry.subscribers.values()) {
        clearTimeout(subscription.idleTimer);
        subscription.client.removeListener('close', subscription.onClose);
      }
      entry.subscribers.clear();
      entry.startPromise = null;
      entry.upstreamReady = false;

      if (entry.upstream?.stop) {
        try {
          await entry.upstream.stop({ reason });
        } catch (error) {
          console.error(`Failed to stop managed stream ${kind}:${key}:`, error);
        }
      }

      entry.upstream = null;
      return true;
    })();

    try {
      return await entry.stopPromise;
    } finally {
      entry.stopPromise = null;
    }
  },

  async unsubscribe({ kind, key, client, reason = 'unsubscribe' }) {
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
      this.logUnsubscribe({ kind, key, reason, remaining: subscribers });
      if (entry.state !== 'starting') {
        await this.stopEntry({ kind, key, reason });
      }
      return { active: false, kind, streamKey: key, subscribers, removed: true };
    }

    this.logUnsubscribe({ kind, key, reason, remaining: subscribers });
    return { active: true, kind, streamKey: key, subscribers, removed: true };
  },

  async unsubscribeAll({ client, reason = 'clear' }) {
    const removed = [];

    for (const kind of Object.keys(this.entries)) {
      const keys = Array.from(this.getBucket({ kind }).keys());
      for (const key of keys) {
        const entry = this.getEntry({ kind, key });
        if (!entry || !entry.subscribers.has(client)) continue;
        removed.push(await this.unsubscribe({ kind, key, client, reason }));
      }
    }

    return removed;
  },

  async subscribe({ kind, key, client, idleMs = null, metadata = {}, start }) {
    if (!client) throw new Error('Metacom client is required');
    if (typeof start !== 'function') throw new Error('Managed stream start() is required');

    const bucket = this.getBucket({ kind });
    // One managed entry per client + kind + streamKey.
    // Consumer counts live above this helper in metaterminal.
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
        upstreamReady: false,
        state: 'starting',
        startPromise: null,
        stopPromise: null,
        lastError: null,
      };
      bucket.set(key, entry);
    } else if (Object.keys(metadata).length > 0) {
      entry.metadata = { ...entry.metadata, ...metadata };
    }

    let subscription = entry.subscribers.get(client);
    const subscribed = subscription === undefined;

    if (!subscription) {
      const onClose = () => {
        this.unsubscribe({ kind, key, client, reason: 'client.close' }).catch((error) => {
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

    if (created) {
      entry.startPromise = (async () => {
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
          entry.upstreamReady = true;
          entry.state = 'active';

          if (entry.subscribers.size === 0) {
            await this.stopEntry({ kind, key, reason: 'startup.no-subscribers' });
            return false;
          }

          return true;
        } catch (error) {
          entry.lastError = this.serializeError(error);
          await this.stopEntry({ kind, key, reason: 'startup.failed' });
          throw error;
        }
      })();
    }

    await entry.startPromise;

    const liveEntry = this.getEntry({ kind, key });
    if (!liveEntry) {
      return {
        active: false,
        kind,
        streamKey: key,
        subscribers: 0,
        created,
        subscribed,
        metadata: entry.metadata,
      };
    }

    const state = this.touch({ kind, key, client, idleMs });
    console.info(
      `Stream subscribe: ${kind}:${key} created=${created} subscribed=${subscribed} total=${state.subscribers} idleMs=${state.idleMs}`,
    );
    return { ...state, created, subscribed, metadata: liveEntry.metadata };
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
        state: entry.state ?? 'active',
        upstreamReady: Boolean(entry.upstreamReady),
        starting: entry.state === 'starting',
        lastError: entry.lastError ?? null,
      }));
    }

    return result;
  },
});
