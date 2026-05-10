({
  access: 'public',
  parameters: 'json',
  returns: 'json',
  errors: {
    EACTION: 'Invalid action: expected "subscribe", "unsubscribe", or "touch"',
    ESPREADTYPE: 'Unsupported spreadType: only "Single" is supported',
    ESYMBOL: 'Symbol is required for snapshot requests and for stream subscribe',
  },

  method: async ({
    symbol = null,
    expiration = null,
    expiration2 = null,
    range = 0,
    stream = false,
    stop = false,
    action = null,
    streamKey = null,
    idleMs = null,
    spreadType = 'Single',
    priceCenter = null,
    strikeInterval = 1,
    enableGreeks = true,
    strikeRange = 'All',
    optionType = 'All',
  }) => {
    const actionSet = new Set(['subscribe', 'unsubscribe', 'touch']);
    const toBoolean = (value) => value === true || value === 'true' || value === 1 || value === '1';
    const toNumber = (value) => {
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    };
    const actionValue = lib.utils.normalizeAction({ action, stop });
    const spreadValue = typeof spreadType === 'string' ? spreadType.trim() : spreadType;
    const chainKey = typeof streamKey === 'string' ? streamKey.trim() || null : null;

    if (actionValue !== null && !actionSet.has(actionValue)) return new DomainError('EACTION');
    if (spreadValue !== 'Single') return new DomainError('ESPREADTYPE');

    const chainSymbol = typeof symbol === 'string' ? symbol.trim().toUpperCase() : '';
    const streamMode = toBoolean(stream) || actionValue !== null;
    const symbolRequired = !actionValue || actionValue === 'subscribe';
    if (!chainSymbol && (symbolRequired || !chainKey)) return new DomainError('ESYMBOL');

    const proximity = Math.max(0, Number(range) || 0);
    const interval = Math.max(1, Number(strikeInterval) || 1);
    const chainData = {
      strikeProximity: proximity,
      spreadType: 'Single',
      strikeInterval: interval,
      enableGreeks: toBoolean(enableGreeks),
      strikeRange,
      optionType,
    };

    if (expiration) chainData.expiration = expiration;
    if (expiration2) chainData.expiration2 = expiration2;
    const centerPrice = toNumber(priceCenter);
    if (centerPrice !== null) chainData.priceCenter = centerPrice;

    if (!streamMode) {
      const endpoint = ['marketdata', 'stream', 'options', 'chains', chainSymbol];
      return lib.ts.optionChain({ endpoint, symbol: chainSymbol, data: chainData });
    }

    const endpoint = chainSymbol ? ['marketdata', 'stream', 'options', 'chains', chainSymbol] : [];
    const streamAction = actionValue ?? 'subscribe';

    return lib.stream.optionChain({
      client: context.client,
      endpoint,
      symbol: chainSymbol,
      data: chainData,
      action: streamAction,
      idleMs,
      streamKey: chainKey,
    });
  },
});
