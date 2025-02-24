async ({ tokens }) => {
  const method = 'PUT';
  const endpoint = ['key'];
  const data = { tokens };

  return lib.ptfin.send({ method, endpoint, data });
};
