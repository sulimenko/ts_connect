({
  access: 'public',
  parameters: 'json',
  returns: 'json',
  errors: {
    EBARS: 'Bars back must be an integer from 1 to 10',
    EINTERVAL: 'Interval must be an integer from 1 to 64999 ticks',
    ESYMBOL: 'Symbol is required for tickbar requests',
  },
  method: async ({ symbol = null, interval = null, bars = 10, traceId = null, requestId = null }) => {
    const trace = lib.utils.resolveTraceId({ traceId, requestId, prefix: 'tickbars' });
    const startedAt = Date.now();
    const rawSymbol = typeof symbol === 'string' ? symbol.trim().toUpperCase() : '';
    const intervalValue = Number(interval);
    const barsValue = Number(bars);
    let status = 'ok';
    let packetCount = 0;

    lib.utils.traceLog({
      scope: 'marketdata/tickbars',
      phase: 'api.start',
      traceId: trace,
      symbol: rawSymbol || null,
      interval: Number.isFinite(intervalValue) ? intervalValue : interval,
      bars: Number.isFinite(barsValue) ? barsValue : bars,
    });

    const readPackets = async (response) => {
      const packets = [];
      const pushLines = (text) => {
        for (const line of text.split('\n')) {
          const packetLine = line.trim();
          if (!packetLine) continue;

          try {
            packets.push(JSON.parse(packetLine));
          } catch (error) {
            console.error('Failed to parse tickbar packet:', error, packetLine);
          }
        }
      };

      const reader = response.body?.getReader?.();
      if (!reader) {
        pushLines(await response.text());
        return packets;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          pushLines(lines.join('\n'));
        }
        const tail = decoder.decode();
        if (tail) buffer += tail;
        if (buffer.trim()) pushLines(buffer);
      } finally {
        reader.releaseLock?.();
      }

      return packets;
    };

    try {
      if (!rawSymbol) {
        status = 'error:ESYMBOL';
        return new DomainError('ESYMBOL');
      }
      if (!Number.isInteger(intervalValue) || intervalValue < 1 || intervalValue > 64999) {
        status = 'error:EINTERVAL';
        return new DomainError('EINTERVAL');
      }
      if (!Number.isInteger(barsValue) || barsValue < 1 || barsValue > 10) {
        status = 'error:EBARS';
        return new DomainError('EBARS');
      }

      const client = await domain.ts.clients.getClient({});
      const endpoint = ['stream', 'tickbars', rawSymbol, intervalValue.toString(), barsValue.toString()];
      const requestStartedAt = Date.now();
      const domainUrl = lib.utils.constructDomain(true);
      const url = lib.utils.constructURL('GET', domainUrl, ['v2', ...endpoint], {});
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: 'Bearer ' + client.tokens.access,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP Error: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`);
      }

      const packets = await readPackets(response);
      packetCount = packets.length;

      lib.utils.traceLog({
        scope: 'marketdata/tickbars',
        phase: 'ts.request.done',
        traceId: trace,
        symbol: rawSymbol,
        durationMs: Date.now() - requestStartedAt,
        extra: { interval: intervalValue, bars: barsValue, packetCount },
      });

      return packets;
    } catch (error) {
      status = error instanceof DomainError ? `error:${error.code}` : 'error:internal';
      throw error;
    } finally {
      lib.utils.traceLog({
        scope: 'marketdata/tickbars',
        phase: 'api.done',
        traceId: trace,
        symbol: rawSymbol || null,
        interval: Number.isFinite(intervalValue) ? intervalValue : interval,
        bars: Number.isFinite(barsValue) ? barsValue : bars,
        durationMs: Date.now() - startedAt,
        extra: { packetCount, status },
      });
    }
  },
});
