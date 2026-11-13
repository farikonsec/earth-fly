/** 1976 Standard Atmosphere layer equations below 86 km; exponential extension above. */
export function atmosphereAt(altitude: number) {
  const h = Math.max(0, altitude),
    R = 287.05287,
    g = 9.80665,
    bases = [0, 11000, 20000, 32000, 47000, 51000, 71000, 86000],
    lapses = [-0.0065, 0, 0.001, 0.0028, 0, -0.0028, -0.002];
  let temp = 288.15,
    pressure = 101325;
  for (let i = 0; i < lapses.length; i++) {
    const dh = Math.min(h, bases[i + 1]) - bases[i];
    if (dh <= 0) break;
    const lapse = lapses[i],
      next = temp + lapse * dh;
    pressure *=
      lapse === 0
        ? Math.exp((-g * dh) / (R * temp))
        : Math.pow(temp / next, g / (R * lapse));
    temp = next;
    if (h <= bases[i + 1]) break;
  }
  if (h > 86000) pressure *= Math.exp(-(h - 86000) / 7000);
  return {
    temperature: temp,
    pressure,
    density: pressure / (R * temp),
    soundSpeed: Math.sqrt(1.4 * R * temp),
  };
}
export function liftCoefficient(alpha: number) {
  const a = Math.abs(alpha),
    t = Math.max(0, Math.min(1, (a - 0.23) / 0.18)),
    w = t * t * (3 - 2 * t),
    attached = Math.max(-1.25, Math.min(1.25, alpha * 4.6)),
    separated = 2.1 * Math.sin(alpha) * Math.cos(alpha);
  return attached * (1 - w) + separated * w;
}
