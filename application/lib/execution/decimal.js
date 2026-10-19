(value) => {
  // Broker decimals are strings. Never coerce through floating point or accept
  // exponent notation. Bound input size before constructing exact integers.
  if (typeof value !== 'string' || value.length > 256 || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  const [integer, fraction = ''] = value.split('.');
  const whole = integer.replace(/^0+(?=\d)/, '');
  const tail = fraction.replace(/0+$/, '');
  return {
    text: tail ? `${whole}.${tail}` : whole,
    units: BigInt(whole + tail),
    scale: tail.length,
  };
};
