({
  entries: {
    charts: new Map(),
    chains: new Map(),
    matrix: new Map(),
    quotes: new Map(),
  },

  defaultIdleMs: 30 * 1000,
  clients: new Map(),
  capacityKinds: new Set(['chains', 'matrix']),
  capacityQueue: [],
  capacityDrain: null,
  capacityProbe: null,
  capacityProbeDelay: 1000,
  maxCapacityProbeDelay: 30000,

  // Legacy matrix diagnostics remain aliases of the shared capacity lifecycle.
  get matrixQueue() {
    return this.capacityQueue;
  },

  set matrixQueue(queue) {
    this.capacityQueue = queue;
  },

  get matrixDrain() {
    return this.capacityDrain;
  },

  set matrixDrain(drain) {
    this.capacityDrain = drain;
  },

  get matrixProbe() {
    return this.capacityProbe;
  },

  set matrixProbe(probe) {
    this.capacityProbe = probe;
  },

  get matrixProbeDelay() {
    return this.capacityProbeDelay;
  },

  set matrixProbeDelay(delay) {
    this.capacityProbeDelay = delay;
  },

  getBucket({ kind }) {
    if (!this.entries[kind]) this.entries[kind] = new Map();
    return this.entries[kind];
  },

  getEntry({ kind, key }) {
    return this.getBucket({ kind }).get(key) ?? null;
  },

  usesCapacity(kind) {
    return this.capacityKinds.has(kind);
  },

  activeCapacityCount() {
    let count = 0;
    for (const kind of this.capacityKinds) {
      count += Array.from(this.getBucket({ kind }).values()).filter((entry) => entry.capacityHeld).length;
    }
    return count;
  },

  activeMatrixCount() {
    return Array.from(this.getBucket({ kind: 'matrix' }).values()).filter((entry) => entry.state === 'active' && entry.upstreamReady)
      .length;
  },

  queuedCapacityCount() {
    return this.capacityQueue.filter(
      (entry) => this.getEntry({ kind: entry.kind, key: entry.key }) === entry && entry.state === 'queued' && entry.subscribers.size > 0,
    ).length;
  },

  queuedMatrixCount() {
    return this.capacityQueue.filter(
      (entry) => entry.kind === 'matrix' && this.getEntry({ kind: 'matrix', key: entry.key }) === entry && entry.state === 'queued',
    ).length;
  },

  capacityLog(event, entry = null, extra = {}) {
    console.debug('managed capacity lifecycle', {
      event,
      kind: entry?.kind ?? null,
      streamKey: entry?.key ?? null,
      state: entry?.state ?? null,
      classification: entry?.lastError?.classification ?? null,
      queueLength: this.queuedCapacityCount(),
      activeCount: this.activeCapacityCount(),
      subscriberCount: entry?.subscribers.size ?? null,
      generation: entry?.generation ?? null,
      capacityHeld: entry?.capacityHeld ?? null,
      ...extra,
    });
  },

  trackClient(entry, client) {
    let tracked = this.clients.get(client);
    if (!tracked) {
      const onClose = () => {
        this.unsubscribeAll({ client, reason: 'client.close' }).catch((error) => {
          console.error('Failed to cleanup closed client subscriptions:', error);
        });
      };
      tracked = { entries: new Set(), onClose };
      this.clients.set(client, tracked);
      client.on('close', onClose);
    }
    tracked.entries.add(entry);
  },

  untrackClient(entry, client) {
    const tracked = this.clients.get(client);
    if (!tracked) return;
    tracked.entries.delete(entry);
    if (tracked.entries.size > 0) return;
    client.removeListener('close', tracked.onClose);
    this.clients.delete(client);
  },

  resolveIdleMs(idleMs, fallback = this.defaultIdleMs) {
    const timeout = Number(idleMs);
    if (!Number.isFinite(timeout) || timeout <= 0) return fallback;
    return Math.max(1000, Math.floor(timeout));
  },

  logStop({ kind, key, reason, clientCount = null }) {
    console.debug('managed stream stop done', { kind, streamKey: key, reason, subscribers: clientCount });
  },

  logUnsubscribe({ kind, key, reason, remaining }) {
    console.debug('managed stream unsubscribe', { kind, streamKey: key, reason, subscribers: remaining });
  },

  logDroppedEvent({ entry, eventName }) {
    console.debug('managed stream dropped event', {
      kind: entry.kind,
      streamKey: entry.key,
      eventName,
      state: entry.state,
      upstreamReady: entry.upstreamReady,
      lastMessageAt: entry.lastMessageAt,
      subscriberCount: entry.subscribers.size,
    });
  },

  entryLog(entry, extra = {}) {
    return {
      kind: entry.kind,
      streamKey: entry.key,
      subscribers: entry.subscribers.size,
      state: entry.state,
      upstreamReady: Boolean(entry.upstreamReady),
      ...extra,
    };
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
      if (error.permanent !== undefined) serialized.permanent = error.permanent;
      if (error.reconnectable !== undefined) serialized.reconnectable = error.reconnectable;
      if (error.streamStopped !== undefined) serialized.streamStopped = error.streamStopped;
      if (error.status !== undefined) serialized.status = error.status;
      if (error.statusText !== undefined) serialized.statusText = error.statusText;
      if (error.body !== undefined) serialized.body = error.body;
      if (error.headers !== undefined) serialized.headers = error.headers;
      if (error.classification !== undefined) serialized.classification = error.classification;
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
      if (error.permanent !== undefined) serialized.permanent = error.permanent;
      if (error.reconnectable !== undefined) serialized.reconnectable = error.reconnectable;
      if (error.streamStopped !== undefined) serialized.streamStopped = error.streamStopped;
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
    entry.state = 'failed';
    entry.upstreamReady = false;
    entry.lastError = this.serializeError(error);
    const payload = {
      kind: entry.kind,
      streamKey: entry.key,
      metadata: entry.metadata,
      state: 'failed',
      active: false,
      resubscribeRequired: true,
      terminal: error?.terminal ?? error?.permanent ?? true,
      retryable: false,
      error: entry.lastError,
    };
    this.emit(entry, 'stream/error', payload);
  },

  notifyStatus(entry, status = {}) {
    const state = status.state ?? entry.state ?? 'active';
    const previousState = entry.state;
    const active = status.active ?? true;
    const resubscribeRequired = status.resubscribeRequired ?? false;
    entry.state = state;
    entry.upstreamReady = state === 'active' && status.active !== false;
    if (previousState !== state) {
      console.debug('managed stream state change', this.entryLog(entry, { from: previousState, to: state }));
    }
    if (status.error) entry.lastError = this.serializeError(status.error);
    console.debug('managed stream status', this.entryLog(entry, { state, reason: status.reason ?? null, active, resubscribeRequired }));
    this.emit(entry, 'stream/status', {
      kind: entry.kind,
      streamKey: entry.key,
      metadata: entry.metadata,
      state,
      reason: status.reason ?? null,
      active,
      resubscribeRequired,
      retryable: status.retryable ?? false,
      terminal: status.terminal ?? false,
      retryAttempt: status.retryAttempt ?? null,
      maxRetries: status.maxRetries ?? null,
      error: status.error ? this.serializeError(status.error) : undefined,
    });
  },

  touch({ kind, key, client, idleMs = null }) {
    const entry = this.getEntry({ kind, key });
    if (!entry) {
      console.debug('managed stream touch missing', { kind, streamKey: key, active: false, subscribers: 0 });
      lib.utils.traceLog({
        scope: `stream/${kind}`,
        phase: 'touch',
        streamKey: key,
        extra: { active: false, subscribers: 0, idleMs: this.resolveIdleMs(idleMs) },
      });
      return {
        active: false,
        kind,
        streamKey: key,
        subscribers: 0,
        resubscribeRequired: true,
        reason: 'missing',
      };
    }

    const subscription = entry.subscribers.get(client);
    if (!subscription) {
      console.debug('managed stream touch not-subscribed', this.entryLog(entry, { active: false }));
      lib.utils.traceLog({
        scope: `stream/${kind}`,
        phase: 'touch',
        streamKey: key,
        extra: { active: false, subscribers: entry.subscribers.size, idleMs: this.resolveIdleMs(idleMs, this.defaultIdleMs) },
      });
      return {
        active: false,
        kind,
        streamKey: key,
        subscribers: entry.subscribers.size,
        resubscribeRequired: true,
        reason: 'not-subscribed',
      };
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

    const active = entry.state === 'active' && entry.upstreamReady;
    const resubscribeRequired = entry.state === 'failed';
    lib.utils.traceLog({
      scope: `stream/${kind}`,
      phase: 'touch',
      streamKey: key,
      extra: { active, subscribers: entry.subscribers.size, idleMs: timeout },
    });

    console.debug('managed stream touch active', this.entryLog(entry, { active }));

    return {
      active,
      kind,
      streamKey: key,
      subscribers: entry.subscribers.size,
      idleMs: timeout,
      resubscribeRequired,
      recovering: entry.state === 'recovering',
      retryable: entry.state === 'queued',
      terminal: entry.state === 'failed',
      state: entry.state ?? 'active',
      upstreamReady: Boolean(entry.upstreamReady),
    };
  },

  dequeueCapacity(entry) {
    this.capacityQueue = this.capacityQueue.filter((queued) => queued !== entry);
    if (this.capacityQueue.length === 0 && this.capacityProbe) {
      clearTimeout(this.capacityProbe);
      this.capacityProbe = null;
      this.capacityProbeDelay = 1000;
    }
  },

  queueCapacity(entry, error, { front = false, from = 'starting' } = {}) {
    entry.state = 'queued';
    entry.upstreamReady = false;
    entry.capacityHeld = false;
    entry.lastError = this.serializeError(error);
    if (!this.capacityQueue.includes(entry)) {
      if (front) this.capacityQueue.unshift(entry);
      else this.capacityQueue.push(entry);
    }
    this.capacityLog(`${from} -> queued`, entry, {
      classification: error.classification,
      status: error.status ?? null,
      observedActive: this.activeCapacityCount(),
    });
  },

  async queueCapacityStatus(entry, status, generation) {
    if (
      this.getEntry({ kind: entry.kind, key: entry.key }) !== entry ||
      entry.generation !== generation ||
      !['starting', 'active', 'recovering'].includes(entry.state)
    ) {
      return false;
    }

    const from = entry.state;
    const upstream = entry.upstream;
    entry.generation += 1;
    const queuedGeneration = entry.generation;
    entry.upstream = null;
    this.queueCapacity(entry, status.error, { from });
    this.notifyStatus(entry, { ...status, state: 'queued', active: false, terminal: false, resubscribeRequired: false });

    if (upstream?.stop) {
      try {
        await upstream.stop({ reason: 'upstream.capacity' });
      } catch (error) {
        console.error(`Failed to stop capacity stream ${entry.kind}:${entry.key}:`, error);
      }
    }

    if (
      this.getEntry({ kind: entry.kind, key: entry.key }) !== entry ||
      entry.generation !== queuedGeneration ||
      entry.state !== 'queued' ||
      entry.subscribers.size === 0
    ) {
      return false;
    }
    this.scheduleCapacityProbe('capacity');
    return true;
  },

  scheduleCapacityProbe(reason = 'capacity') {
    if (this.capacityProbe || this.queuedCapacityCount() === 0) return;
    const delay = this.capacityProbeDelay;
    this.capacityProbe = setTimeout(() => {
      this.capacityProbe = null;
      void this.drainCapacity({ reason: 'probe' });
    }, delay);
    this.capacityProbeDelay = Math.min(delay * 2, this.maxCapacityProbeDelay);
    this.capacityLog('queue probe scheduled', null, { reason, delay });
  },

  async drainCapacity({ reason = 'slot.freed' } = {}) {
    if (this.capacityDrain) return this.capacityDrain;
    if (this.capacityProbe && reason !== 'probe') {
      clearTimeout(this.capacityProbe);
      this.capacityProbe = null;
    }

    this.capacityDrain = (async () => {
      this.capacityLog('queue drain start', null, { reason });
      while (this.capacityQueue.length > 0) {
        const entry = this.capacityQueue.shift();
        if (this.getEntry({ kind: entry.kind, key: entry.key }) !== entry || entry.state !== 'queued' || entry.subscribers.size === 0) {
          this.capacityLog('queue stale skipped', entry, { reason });
          continue;
        }

        this.capacityLog('queued -> starting', entry, { reason });
        try {
          const result = await this.startEntry(entry, { queued: true });
          if (result === 'active') {
            this.capacityLog('queue drain active', entry, { reason });
            this.scheduleCapacityProbe('queue.remaining');
            return true;
          }
          if (result === 'queued') {
            this.scheduleCapacityProbe('capacity');
            return false;
          }
        } catch (error) {
          this.capacityLog('queued -> failed', entry, {
            reason,
            classification: error.classification ?? 'unknown',
          });
        }
      }
      return false;
    })();

    try {
      return await this.capacityDrain;
    } finally {
      this.capacityDrain = null;
    }
  },

  startEntry(entry, { queued = false } = {}) {
    if (entry.startPromise) return entry.startPromise;
    const generation = entry.generation + 1;
    entry.generation = generation;
    entry.state = 'starting';
    entry.upstreamReady = false;
    const current = () => this.getEntry({ kind: entry.kind, key: entry.key }) === entry && entry.generation === generation;

    const promise = (async () => {
      try {
        const upstream = await entry.start({
          entry,
          emit: (eventName, payload) => {
            if (current()) this.emit(entry, eventName, payload);
          },
          notifyError: (error) => {
            if (current()) this.notifyError(entry, error);
          },
          notifyStatus: (status) => {
            if (!current()) return false;
            if (this.usesCapacity(entry.kind) && status.error?.classification === 'capacity') {
              return this.queueCapacityStatus(entry, status, generation);
            }
            return this.notifyStatus(entry, status);
          },
        });

        if (!upstream || typeof upstream.stop !== 'function') throw new Error(`Managed stream "${entry.kind}" must provide stop()`);
        if (!current() || entry.subscribers.size === 0) {
          await upstream.stop({ reason: 'startup.stale' });
          if (this.usesCapacity(entry.kind)) this.capacityLog('startup stale cancelled', entry, { generation });
          return 'stale';
        }

        entry.upstream = upstream;
        entry.upstreamReady = true;
        entry.state = 'active';
        entry.lastError = null;
        if (this.usesCapacity(entry.kind)) {
          entry.capacityHeld = true;
          this.dequeueCapacity(entry);
          this.capacityProbeDelay = 1000;
          this.capacityLog('starting -> active', entry, { generation });
        }
        return 'active';
      } catch (error) {
        if (!current()) {
          if (this.usesCapacity(entry.kind)) {
            this.capacityLog('startup error stale', entry, { generation, classification: error.classification ?? 'unknown' });
          }
          return 'stale';
        }
        if (this.usesCapacity(entry.kind) && error.classification === 'capacity') {
          this.queueCapacity(entry, error, { front: queued });
          this.scheduleCapacityProbe('capacity');
          return 'queued';
        }
        entry.lastError = this.serializeError(error);
        this.notifyError(entry, error);
        await this.stopEntry({ kind: entry.kind, key: entry.key, reason: 'startup.failed' });
        throw error;
      } finally {
        if (entry.startPromise === promise) entry.startPromise = null;
      }
    })();

    entry.startPromise = promise;
    return promise;
  },

  async stopEntry({ kind, key, reason = 'unknown' }) {
    const bucket = this.getBucket({ kind });
    const entry = bucket.get(key);
    if (!entry) return false;

    if (entry.stopPromise) return entry.stopPromise;

    const freedCapacity = this.usesCapacity(kind) && entry.capacityHeld;
    if (freedCapacity) entry.capacityHeld = false;
    entry.state = 'stopping';
    entry.generation += 1;
    if (this.usesCapacity(kind)) this.capacityLog('active -> stopping', entry, { reason });
    console.debug('managed stream stop start', this.entryLog(entry, { reason }));
    entry.stopPromise = (async () => {
      bucket.delete(key);
      if (this.usesCapacity(kind)) this.dequeueCapacity(entry);
      this.logStop({ kind, key, reason, clientCount: entry.subscribers.size });

      for (const subscription of entry.subscribers.values()) {
        clearTimeout(subscription.idleTimer);
        this.untrackClient(entry, subscription.client);
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
      if (freedCapacity && reason !== 'client.close') void this.drainCapacity({ reason });
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
    if (!entry) {
      console.debug('managed stream unsubscribe', { kind, streamKey: key, active: false, subscribers: 0, removed: false });
      return { active: false, kind, streamKey: key, subscribers: 0, removed: false };
    }

    const subscription = entry.subscribers.get(client);
    if (!subscription) {
      const active = entry.state === 'active' && entry.upstreamReady;
      console.debug('managed stream unsubscribe', {
        kind,
        streamKey: key,
        active,
        subscribers: entry.subscribers.size,
        removed: false,
      });
      return { active, kind, streamKey: key, subscribers: entry.subscribers.size, removed: false };
    }

    clearTimeout(subscription.idleTimer);
    this.untrackClient(entry, subscription.client);
    entry.subscribers.delete(client);

    const subscribers = entry.subscribers.size;
    if (subscribers === 0) {
      this.logUnsubscribe({ kind, key, reason, remaining: subscribers });
      await this.stopEntry({ kind, key, reason });
      return { active: false, kind, streamKey: key, subscribers, removed: true };
    }

    this.logUnsubscribe({ kind, key, reason, remaining: subscribers });
    return {
      active: entry.state === 'active' && entry.upstreamReady,
      kind,
      streamKey: key,
      subscribers,
      removed: true,
    };
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

    if (reason === 'client.close') void this.drainCapacity({ reason });

    return removed;
  },

  async subscribe({ kind, key, client, idleMs = null, metadata = {}, start }) {
    if (!client) throw new Error('Metacom client is required');
    if (typeof start !== 'function') throw new Error('Managed stream start() is required');

    const bucket = this.getBucket({ kind });
    // One multiplexed managed entry per kind + streamKey.
    // Consumer counts live above this helper in metaterminal.
    let entry = bucket.get(key);
    const created = entry === undefined;
    console.debug('managed stream subscribe requested', { kind, streamKey: key, created, idleMs: this.resolveIdleMs(idleMs) });

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
        capacityHeld: false,
        state: 'starting',
        startPromise: null,
        stopPromise: null,
        lastError: null,
        generation: 0,
        start,
      };
      bucket.set(key, entry);
      console.debug('managed stream subscribe created', { kind, streamKey: key, subscribers: 0, upstreamReady: false });
    } else if (Object.keys(metadata).length > 0) {
      entry.metadata = { ...entry.metadata, ...metadata };
      console.debug('managed stream subscribe existing', this.entryLog(entry));
    }

    let subscription = entry.subscribers.get(client);
    const subscribed = subscription === undefined;

    if (!subscription) {
      subscription = {
        client,
        idleMs: this.resolveIdleMs(idleMs),
        idleTimer: null,
        touchedAt: Date.now(),
      };

      entry.subscribers.set(client, subscription);
      this.trackClient(entry, client);
    }

    if (created) {
      entry.startPromise = this.startEntry(entry);
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
        state: entry.state,
        upstreamReady: false,
      };
    }

    const state = this.touch({ kind, key, client, idleMs });
    console.debug('managed stream subscribe done', this.entryLog(liveEntry, { created, subscribed, active: state.active }));
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
