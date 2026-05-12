({ domain = null, live, ver = 'v3', endpoint, tokens, data = {}, onData, onError, trace = null }) => ({
  currentParams: { domain, live, ver, endpoint, tokens, data, onData, onError, trace },
  reconnectDelay: 5000,
  maxReconnectDelay: 60000,

  abortController: null,
  reconnectTimer: null,
  timeoutHeartbeat: null,
  shouldReconnect: true,

  endpointName() {
    return this.currentParams.endpoint.join('/');
  },

  traceLog(phase, { startedAt = null, extra = {} } = {}) {
    const trace = this.currentParams.trace;
    if (!trace?.traceId) return;
    lib.utils.traceLog({
      scope: trace.scope ?? 'stream',
      phase,
      traceId: trace.traceId,
      endpoint: this.endpointName(),
      streamKey: trace.streamKey ?? null,
      durationMs: startedAt === null ? null : Date.now() - startedAt,
      extra,
    });
  },

  clearReconnectTimer() {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  },

  clearHeartbeatTimer() {
    if (!this.timeoutHeartbeat) return;
    clearTimeout(this.timeoutHeartbeat);
    this.timeoutHeartbeat = null;
  },

  abortActiveStream(reason = 'unknown') {
    if (!this.abortController || this.abortController.signal.aborted) return;
    console.log('Stopping stream...', this.endpointName(), 'reason:', reason);
    this.abortController.abort();
  },

  async initiateStream() {
    this.clearReconnectTimer();
    this.clearHeartbeatTimer();
    this.abortActiveStream('restart');
    const startedAt = Date.now();
    this.traceLog('stream.connect.start');

    const abortController = new AbortController();
    this.abortController = abortController;
    const { signal } = abortController;

    let { domain } = this.currentParams;
    const { live, ver, endpoint, data, tokens, onData, onError } = this.currentParams;

    if (domain === null) domain = lib.utils.constructDomain(live);
    const ep = [ver, ...endpoint];
    const url = lib.utils.constructURL('GET', domain, ep, data);

    console.warn('Connecting to:', url);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + tokens.access, 'Content-Type': 'application/json' },
        signal,
      });

      if (!response.ok) throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
      if (signal.aborted || !this.shouldReconnect) return () => this.stopStream();

      console.log('Connection established:', url);
      this.traceLog('stream.connect.done', { startedAt });
      this.reconnectDelay = 5000;
      this.checkTimeout();
      this.traceLog('stream.subscribe.done', { startedAt });
      void this.processStream(response.body.getReader(), onData, onError, signal);
    } catch (err) {
      if (err.name === 'AbortError' || signal.aborted || !this.shouldReconnect) {
        console.warn('Stream aborted gracefully:', this.endpointName());
        return () => this.stopStream();
      }
      console.error('Stream error:', this.endpointName(), err);
      if (onError) onError(err);
      void this.scheduleReconnect();
    }

    return () => this.stopStream();
  },

  handlePacket(packet, onData, onError) {
    this.checkTimeout();

    if (packet.Heartbeat !== undefined) return true;

    if (packet.StreamStatus === 'GoAway' || packet.Error === 'GoAway') {
      console.log('Stream termination requested by server.', this.endpointName());
      void this.scheduleReconnect();
      return false;
    }

    if (packet.Error) {
      const errorText = `${packet.Error} ${packet.Message ?? ''}`.trim();
      console.error('Stream error:', this.endpointName(), errorText);
      const error = new Error(errorText);
      error.code = packet.Error;
      error.upstreamMessage = packet.Message ?? null;
      error.details = packet.Message ?? null;
      error.symbol = packet.Symbol ?? null;
      error.packet = packet;
      if (onError) onError(error);
      const permanent =
        /INVALID/i.test(packet.Error) || (/Failed/i.test(packet.Error) && /Internal server error/i.test(packet.Message ?? ''));
      console.warn('Stream error classification:', this.endpointName(), permanent ? 'PERMANENT -> stop' : 'TRANSIENT -> reconnect');
      if (permanent) {
        this.stopStream('permanent-error');
        return false;
      }
      void this.scheduleReconnect();
      return false;
    }

    if (onData) onData(packet);
    return true;
  },

  async processStream(reader, onData, onError, signal) {
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (this.shouldReconnect && !signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines.map((line) => line.trim()).filter(Boolean)) {
          try {
            const packet = JSON.parse(line);
            const shouldContinue = this.handlePacket(packet, onData, onError);
            if (!shouldContinue) return;
          } catch (err) {
            console.error('Failed to parse JSON:', this.endpointName(), err, line);
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError' || signal.aborted || !this.shouldReconnect) {
        console.warn('Stream stopped gracefully:', this.endpointName());
        return;
      }
      console.error('Unexpected stream error:', this.endpointName(), err);
      void this.scheduleReconnect();
      return;
    }

    const tail = buffer.trim();
    if (tail) {
      try {
        const packet = JSON.parse(tail);
        const shouldContinue = this.handlePacket(packet, onData, onError);
        if (!shouldContinue) return;
      } catch (err) {
        console.error('Failed to parse JSON:', this.endpointName(), err, tail);
      }
    }

    if (!this.shouldReconnect || signal.aborted) return;
    console.warn('Stream closed unexpectedly:', this.endpointName());
    void this.scheduleReconnect();
  },

  checkTimeout() {
    this.clearHeartbeatTimer();
    if (!this.shouldReconnect) return;
    this.timeoutHeartbeat = setTimeout(() => {
      if (!this.shouldReconnect) return;
      console.log('timeoutHeartbeat:', this.endpointName());
      void this.scheduleReconnect();
    }, 30000);
  },

  async scheduleReconnect() {
    if (!this.shouldReconnect || this.reconnectTimer) return;

    this.clearHeartbeatTimer();
    this.abortActiveStream('reconnect');

    const delay = this.reconnectDelay;
    console.log('Reconnecting in', delay / 1000, 'seconds...');
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (!this.shouldReconnect) return;
      await this.initiateStream();
    }, delay);

    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  },

  stopStream(reason = 'unknown') {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.clearHeartbeatTimer();
    this.abortActiveStream(reason);
    this.abortController = null;
  },
});
