({ error, exact }) => {
  const miss = exact && error.status === 404 && error.validErrorResponse === true;
  if (exact && error.status === 404 && !miss) {
    error.code = 'ERESPONSE';
    error.retryable = false;
  }
  return {
    miss,
    brokerMessage: error.upstream?.brokerMessage ?? null,
    requestId: error.upstream?.requestId ?? null,
  };
};
