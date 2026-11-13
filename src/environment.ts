import { EARTH, type EarthState } from './earth';
import { cross, dot, len, type V } from './vector';

export const KARMAN_LINE = 100000;
/** Fixed representative boundaries in metres MSL; actual boundaries vary with place/time. */
export const AIR_LAYERS = [
  { name: 'Troposphere', bottom: 0, top: 12000 },
  { name: 'Stratosphere', bottom: 12000, top: 50000 },
  { name: 'Mesosphere', bottom: 50000, top: 85000 },
  { name: 'Thermosphere', bottom: 85000, top: 700000 },
  { name: 'Exosphere', bottom: 700000, top: 10000000 },
] as const;
export function environmentAt(altitudeM: number) {
  const altitude = Math.max(0, altitudeM);
  const layer = AIR_LAYERS.find(l => altitude < l.top);
  const space = altitude >= KARMAN_LINE;
  return {
    layer: layer?.name ?? 'Beyond the exosphere',
    range: layer ? `${layer.bottom / 1000}–${layer.top / 1000} km · approximate` : 'Above 10,000 km · diffuse outer boundary',
    space,
    label: `${space ? 'Space · ' : ''}${layer?.name ?? 'Beyond the exosphere'}`,
  };
}
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Continuous exposure/haze cues; layer boundaries never cause palette jumps. Linear RGB. */
export function airAppearance(altitudeM: number, sunElevation: number) {
  const h = Math.max(0, altitudeM), day = smooth(-.16, .12, sunElevation),
    daylight = smooth(-.05, .3, sunElevation),
    density = Math.exp(-h / 12000),
    night: V = [.003, .006, .014], dusk: V = [.34, .16, .095], blue: V = [.16, .28, .4],
    haze = night.map((n, i) => n + ((dusk[i] + (blue[i] - dusk[i]) * daylight) - n) * day) as V;
  return {
    haze, hazeDensity: Math.exp(-h / 16000),
    skyLight: .025 + .325 * day * density,
    stars: .65 * (1 - day * (1 - smooth(30000, 110000, h))),
    shipSky: .08 + 1.7 * day * density,
  };
}
/** Two-body osculating orbit; drag, thrust and terrain can subsequently change it. */
export function trajectory(state: Pick<EarthState, 'p' | 'v'>) {
  const r = len(state.p), v = len(state.v), mu = EARTH.mu,
    specificEnergy = v*v/2 - mu/r,
    momentum = len(cross(state.p, state.v)),
    eccentricity = Math.sqrt(Math.max(0, 1 + 2*specificEnergy*momentum*momentum/(mu*mu))),
    perigee = (momentum*momentum/(mu*(1+eccentricity)) - EARTH.radius)*1000,
    circularSpeed = Math.sqrt(mu/r), escapeSpeed = Math.sqrt(2*mu/r),
    circularPeriod = 2*Math.PI*Math.sqrt(r*r*r/mu),
    outward = dot(state.p,state.v)>=0;
  return { circularSpeed, escapeSpeed, circularPeriod, perigee,
    phase: specificEnergy>=0 ? (outward ? 'Escape trajectory' : 'Unbound approach')
      : perigee>=160000 ? 'Earth orbit' : 'Suborbital flight' };
}
