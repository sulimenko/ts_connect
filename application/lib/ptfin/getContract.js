async ({ accounts = [] }) => {
  const method = 'POST';
  const endpoint = ['contracts'];
  const data = { accounts };

  const contracts = await lib.ptfin.send({ method, endpoint, data });

  for (const contract of contracts) {
    if (contract.live !== undefined)
      contract.live = contract.live === 1 || contract.live === '1' || contract.live === true || contract.live === 'true';
  }

  return contracts;
};
