({
  abortController: null,
  timeoutHeartbeat: null,

  async initiateStream({ domain = null, live, ver = 'v3', endpoint, token, data = {}, onData, onError }) {
    this.abortController = new AbortController();

    if (domain === null)
      domain = [config.ts.url.protocol, (live ? config.ts.url.live : config.ts.url.sim) + config.ts.url.domen, ver].join('/');

    let url = [domain, ...endpoint].join('/');

    if (Object.keys(data).length > 0) url += '?' + new URLSearchParams(data).toString();
    // console.warn(url, token);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        signal: this.abortController.signal,
      });

      if (!response.ok) throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
      console.log('Connection established:', url);
      this.processStream(response.body.getReader(), onData, onError);
    } catch (err) {
      console.error('Stream error:', err);
      onError && onError(err.message);
      this.scheduleReconnect();
    }
    return () => {
      // console.log(this.abortController.signal.aborted);
      !this.abortController.signal.aborted ? this.abortController.abort() : console.log('signal undefined');
    };
  },

  async processStream(reader, onData, onError) {
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true }).replace(/\r/g, '');
      const lines = chunk.split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          // console.warn(line);
          // console.warn(encodeURI(line));
          const data = JSON.parse(line);

          // if (data.StreamStatus === 'EndSnapshot') {
          // console.log('Snapshot complete.');
          // } else
          if (data.Heartbeat !== undefined) {
            // console.log('Heartbeat:', data);
            if (this.timeoutHeartbeat) clearTimeout(this.timeoutHeartbeat);
            this.timeoutHeartbeat = setTimeout(() => this.scheduleReconnect(), 15 * 1000);
          } else if (data.StreamStatus === 'GoAway') {
            console.log('Stream termination requested by server.');
            this.scheduleReconnect();
            return;
          } else if (data.Error) {
            console.error(`Stream error: ${data.Error}`);
            onError && onError(data.Error);
            this.scheduleReconnect();
            return;
          } else {
            onData && onData(data);
          }
        } catch (err) {
          console.error('Failed to parse JSON:', err, line, encodeURI(line));
        }
      }
    }
  },

  // Функция для планирования перезапуска
  async scheduleReconnect() {
    this.abortController.abort();
    console.log('Reconnecting...');
    await lib.utils.wait(5000); // Задержка перед повторным подключением
    initiateStream();
  },
});
