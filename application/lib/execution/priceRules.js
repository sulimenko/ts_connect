(format) => {
  const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const clean = (value) =>
    object(value) && !['Error', 'error', 'Errors', 'errors', 'error_description'].some((key) => Object.hasOwn(value, key));
  if (!clean(format) || format.Format !== 'Decimal' || typeof format.Decimals !== 'string' || !/^\d{1,3}$/.test(format.Decimals)) {
    return null;
  }
  const precision = Number(format.Decimals);
  const decimal = lib.execution.decimal;
  let rows;
  if (format.IncrementStyle === 'Simple') {
    if (Object.hasOwn(format, 'IncrementSchedule')) return null;
    rows = [{ StartsAt: '0', Increment: format.Increment }];
  } else if (format.IncrementStyle === 'Schedule') {
    if (Object.hasOwn(format, 'Increment') || !Array.isArray(format.IncrementSchedule)) return null;
    rows = format.IncrementSchedule;
  } else {
    return null;
  }
  if (!rows.length || rows.length > 256) return null;
  const parsed = [];
  for (const row of rows) {
    if (!clean(row)) return null;
    const start = decimal(row.StartsAt);
    const tick = decimal(row.Increment);
    if (!start || !tick || tick.units === 0n || tick.scale > precision) return null;
    parsed.push({ start, tick });
  }
  if (parsed[0].start.units !== 0n) return null;
  const result = [];
  for (let i = 0; i < parsed.length; i++) {
    const { start, tick } = parsed[i];
    const end = parsed[i + 1]?.start;
    if (end) {
      const scale = Math.max(start.scale, end.scale, tick.scale);
      const units = (value) => value.units * 10n ** BigInt(scale - value.scale);
      const low = units(start);
      const high = units(end);
      const grid = units(tick);
      // The next interval owns its boundary. The grid is zero-origin, even
      // when a threshold is off-grid; never shift it or round a customer price.
      const first = ((low + grid - 1n) / grid) * grid;
      if (high <= low || first >= high) return null;
    }
    result.push({
      minInclusive: start.text,
      maxExclusive: end?.text ?? null,
      tick: tick.text,
      precision,
      rounding: 'nearest_half_up',
    });
  }
  return { rules: result };
};
