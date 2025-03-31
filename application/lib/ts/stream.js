({ domain = null, live, ver = 'v3', endpoint, tokens, data = {}, onData, onError }) => {
  return {
    currentParams: { domain, live, ver, endpoint, tokens, data, onData, onError },
    reconnectDelay: 5000,
    maxReconnectDelay: 60000,

    abortController: null,
    timeoutHeartbeat: null,

    async initiateStream() {
      this.abortController = new AbortController();
      const { signal } = this.abortController;

      let { domain, live, ver, endpoint, data, tokens, onData, onError } = this.currentParams;

      if (domain === null) domain = lib.utils.constructDomain(live);
      const ep = [ver, ...endpoint];
      const url = lib.utils.constructURL('GET', domain, ep, data);

      console.warn('Connecting to:', url);
      // console.warn(tokens.access);

      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: { Authorization: 'Bearer ' + tokens.access, 'Content-Type': 'application/json' },
          signal,
        });

        if (!response.ok) throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
        console.log('Connection established:', url);
        this.processStream(response.body.getReader(), onData, onError);
      } catch (err) {
        if (err.name === 'AbortError') {
          console.warn('Stream aborted gracefully.');
          return;
        }
        console.error('Stream error:', err);
        onError && onError(err.message);
        this.scheduleReconnect();
      }

      return () => this.stopStream();
    },

    async processStream(reader, onData, onError) {
      const decoder = new TextDecoder();
      let buffer = '';

      const checkTimeout = () => {
        if (this.timeoutHeartbeat) clearTimeout(this.timeoutHeartbeat);
        this.timeoutHeartbeat = setTimeout(() => this.scheduleReconnect(), 30000);
      };

      checkTimeout();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();
          for (const line of lines.filter(Boolean)) {
            try {
              const data = JSON.parse(line);

              if (data.Heartbeat !== undefined) {
                // console.log('Heartbeat:', data);
                checkTimeout();
              } else if (data.StreamStatus === 'GoAway') {
                console.log('Stream termination requested by server.');
                this.scheduleReconnect();
                return;
              } else if (data.Error) {
                console.error('Stream error:', data.Error);
                onError && onError(data.Error);
                this.scheduleReconnect();
                return;
              } else {
                onData && onData(data);
              }
            } catch (err) {
              console.error('Failed to parse JSON:', err, line);
            }
          }
        }
      } catch (err) {
        if (err.name === 'AbortError') {
          console.warn('Stream read aborted.');
          return;
        }
        console.error('Unexpected stream error:', err);
        this.scheduleReconnect();
      }

      console.warn('Stream closed unexpectedly.');
      this.scheduleReconnect();
    },

    async scheduleReconnect() {
      this.stopStream();

      console.log('Reconnecting in', this.reconnectDelay / 1000, 'seconds...');
      await lib.utils.wait(this.reconnectDelay);

      try {
        await this.initiateStream();
        this.reconnectDelay = 5000;
      } catch (err) {
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
        this.scheduleReconnect();
      }
    },

    stopStream() {
      if (this.abortController && !this.abortController.signal.aborted) {
        console.log('Stopping stream...');
        this.abortController.abort();
        this.abortController = null;
      }
      clearTimeout(this.timeoutHeartbeat);
    },
  };
};
