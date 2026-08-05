async ({ account, live, token, orderIds = [], start = null, limit = null, historical = false }) => {
  const accountId = `${account ?? ''}`.trim();
  if (!accountId) throw new Error('TradeStation orders account is required');

  const endpoint = ['brokerage', 'accounts', accountId, historical ? 'historicalorders' : 'orders'];
  if (Array.isArray(orderIds) && orderIds.length > 0) endpoint.push(orderIds.join(','));

  const data = {};
  if (historical) {
    data.since = start || new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().split('T')[0];
  }
  if (limit !== null) data.pageSize = limit;

  const response = await lib.ts.send({ method: 'GET', live, endpoint, token, data });
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error('Unexpected TradeStation orders response');
  }
  if (response.Errors !== undefined && response.Errors !== null && !Array.isArray(response.Errors)) {
    throw new Error('Unexpected TradeStation orders Errors shape');
  }
  if (response.Orders !== undefined && response.Orders !== null && !Array.isArray(response.Orders)) {
    throw new Error('Unexpected TradeStation orders Orders shape');
  }

  return {
    errors: response.Errors ?? [],
    orders: response.Orders ?? [],
  };
};
