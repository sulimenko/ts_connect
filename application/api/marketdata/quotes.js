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

    const readSnapshot = (response) => {
      const invalid = () => {
        throw Object.assign(new Error('Unexpected TradeStation QuoteSnapshot response'), { code: 'ERESPONSE' });
      };
      const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
      if (!object(response)) invalid();
      const payload = response.result ?? response;
      if (!object(payload)) invalid();
      if (payload.Error !== undefined || payload.Message !== undefined) invalid();
      const errors = payload.Errors ?? [];
      if (payload.Errors !== undefined && !Array.isArray(payload.Errors)) invalid();
      if (payload.Quotes !== undefined && !Array.isArray(payload.Quotes)) invalid();
      if (!Array.isArray(payload.Quotes) && errors.length === 0) invalid();
      for (const error of errors) {
        if (
          !object(error) ||
          typeof error.Error !== 'string' ||
          !error.Error.trim() ||
          !lib.utils.makeSymbol(error.Symbol) ||
          (error.Message !== undefined && error.Message !== null && typeof error.Message !== 'string')
        ) {
          invalid();
        }
      }
      const numeric = [
        'Ask',
        'AskSize',
        'Bid',
        'BidSize',
        'Last',
        'LastSize',
        'PreviousClose',
        'Volume',
        'Close',
        'PreviousVolume',
        'DailyOpenInterest',
        'NetChange',
        'NetChangePct',
      ];
      const quotes = (payload.Quotes ?? []).map((quote) => {
        if (!object(quote) || !lib.utils.makeSymbol(quote.Symbol) || quote.Error !== undefined) invalid();
        const result = { ...quote };
        for (const field of numeric) {
          const value = quote[field];
          if (value === null || value === '') {
            result[field] = ['Ask', 'Bid', 'PreviousClose'].includes(field) ? undefined : null;
          } else if (
            value !== undefined &&
            (!['string', 'number'].includes(typeof value) || !`${value}`.trim() || !Number.isFinite(Number(value)))
          ) {
            invalid();
          }
        }
        for (const field of ['TradeTime', 'LastTradingDate']) {
          const value = quote[field];
          if (value !== undefined && value !== null && (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))) invalid();
        }
        return result;
      });
      return { quotes, errors };
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
        const meta = {};
        let requestStatus = 'error';
        let failures = 0;
        let code = null;
        try {
          const response = await lib.ts.send({ method: 'GET', live: true, endpoint, token: client.tokens.access, meta });
          const snapshot = readSnapshot(response);
          quotes.push(...snapshot.quotes);
          failures = snapshot.errors.length;
          errorCount += failures;
          requestStatus = 'ok';
          if (snapshot.quotes.length === 0) requestStatus = 'no_data';
          else if (failures > 0 || snapshot.quotes.length < batch.length) requestStatus = 'partial';
        } catch (error) {
          failures = 1;
          errorCount += failures;
          code = error.code ?? null;
          throw error;
        } finally {
          lib.utils.traceLog({
            scope: 'marketdata/quotes',
            phase: 'ts.request.done',
            traceId: trace,
            symbol: batch.join(','),
            durationMs: Date.now() - requestStartedAt,
            extra: {
              batchIndex,
              batchSize: batch.length,
              status: requestStatus,
              errorCount: failures,
              httpStatus: meta.status ?? null,
              code,
            },
          });
        }
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
      if (quoteMap.size === 0) status = 'no_data';
      else if (errorCount > 0 || normalizedInputs.some(({ symbol }) => !quoteMap.has(symbol))) status = 'partial';
      return rows;
    } catch (error) {
      status = 'error';
      if (errorCount === 0) errorCount = 1;
      throw error;
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
