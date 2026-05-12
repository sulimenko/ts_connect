({
  access: 'public',
  parameters: 'json',
  returns: 'json',
  errors: {
    EINSTRUMENTS: 'At least one instrument is required',
  },
  method: async ({ instruments = [], traceId = null, requestId = null }) => {
    const trace = lib.utils.resolveTraceId({ traceId, requestId, prefix: 'quote' });
    const startedAt = Date.now();
    let status = 'ok';
    let tsSymbolCount = 0;
    let errorCount = 0;
    let rowCount = 0;

    lib.utils.traceLog({
      scope: 'marketdata/quotes',
      phase: 'api.start',
      traceId: trace,
      extra: { symbolCount: instruments.length },
    });

    const extractQuotes = (response) => {
      if (!response || typeof response !== 'object') return [];
      const payload = response.result ?? response;
      if (Array.isArray(payload)) return payload;
      if (Array.isArray(payload?.Quotes)) return payload.Quotes;
      if (Array.isArray(payload?.quotes)) return payload.quotes;
      return [];
    };

    const extractErrors = (response) => {
      if (!response || typeof response !== 'object') return [];
      const payload = response.result ?? response;
      const errors = payload?.Errors ?? payload?.errors ?? payload?.Error ?? payload?.error ?? null;
      if (Array.isArray(errors)) return errors;
      if (errors && typeof errors === 'object') return [errors];
      if (typeof errors === 'string' && errors.trim()) return [errors];
      return [];
    };

    const buildEmptyRow = ({ instrument, symbol }) => {
      const data = {
        symbol,
        lp: null,
        date: null,
        currency: null,
        underlying: instrument?.underlying ?? null,
        source: 'TS',
      };
      data['lp_time'] = null;
      data['prev_close_price'] = null;
      data['listed_exchange'] = null;
      data['currency_id'] = null;
      data['currency_code'] = null;

      const quote = {
        bid: null,
        ask: null,
      };
      quote['bid_size'] = null;
      quote['ask_size'] = null;

      return {
        symbol,
        instrument: instrument ? { ...instrument, symbol } : { symbol },
        data,
        quote,
      };
    };

    const buildRowFromQuote = ({ instrument, symbol, quote }) => {
      const rowSymbol = quote.instrument?.symbol ?? quote.symbol ?? symbol;
      let rowInstrument = { symbol: rowSymbol };
      if (instrument) rowInstrument = { ...instrument, symbol: rowSymbol };
      if (quote.instrument) rowInstrument = { ...rowInstrument, ...quote.instrument, symbol: rowSymbol };
      const rowData = quote.data ? { ...quote.data, symbol: rowSymbol } : { symbol: rowSymbol };

      return {
        symbol: rowSymbol,
        instrument: rowInstrument,
        data: rowData,
        quote: quote.quote,
      };
    };

    const normalizedInputs = [];
    for (const instrument of instruments) {
      if (!instrument || typeof instrument !== 'object') continue;
      const parsed = lib.utils.makeSymbol(instrument.symbol);
      const symbol = parsed?.symbol?.toUpperCase() ?? null;
      const tsSymbol = parsed ? lib.utils.makeTSSymbol(parsed.symbol, parsed.type) : null;
      if (!symbol || !tsSymbol) continue;
      normalizedInputs.push({
        instrument: { ...instrument, symbol },
        symbol,
        tsSymbol,
      });
    }

    try {
      const tsSymbols = Array.from(new Set(normalizedInputs.map((item) => item.tsSymbol))).sort();
      tsSymbolCount = tsSymbols.length;
      if (tsSymbols.length === 0) {
        status = 'error:EINSTRUMENTS';
        return new DomainError('EINSTRUMENTS');
      }

      const client = await domain.ts.clients.getClient({});
      const quotes = [];
      const requestSnapshot = async (batch, batchIndex = 0) => {
        const endpoint = ['marketdata', 'quotes', batch.join(',')];
        const requestStartedAt = Date.now();
        const response = await lib.ts.send({ method: 'GET', live: true, endpoint, token: client.tokens.access });
        quotes.push(...extractQuotes(response));
        errorCount += extractErrors(response).length;
        lib.utils.traceLog({
          scope: 'marketdata/quotes',
          phase: 'ts.request.done',
          traceId: trace,
          symbol: batch.join(','),
          durationMs: Date.now() - requestStartedAt,
          extra: { batchIndex, batchSize: batch.length },
        });
        return response;
      };

      for (let index = 0, batchIndex = 0; index < tsSymbols.length; index += 100, batchIndex += 1) {
        const batch = tsSymbols.slice(index, index + 100);
        await requestSnapshot(batch, batchIndex);
      }

      const quoteMap = new Map();
      for (const message of quotes) {
        const parsed = lib.ts.readQuote({ message });
        if (!parsed?.instrument?.symbol) continue;
        quoteMap.set(parsed.instrument.symbol, parsed);
      }

      const rows = normalizedInputs.map(({ instrument, symbol }) => {
        const quote = quoteMap.get(symbol);
        if (!quote) return buildEmptyRow({ instrument, symbol });
        return buildRowFromQuote({ instrument, symbol, quote });
      });

      rowCount = rows.length;
      return rows;
    } finally {
      lib.utils.traceLog({
        scope: 'marketdata/quotes',
        phase: 'api.done',
        traceId: trace,
        durationMs: Date.now() - startedAt,
        extra: { symbolCount: instruments.length, tsSymbolCount, rowCount, errorCount, status },
      });
    }
  },
});
