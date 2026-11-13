import type { V } from "./vector";
const DEG = Math.PI / 180;
export function latLonToDir(lat: number, lon: number): V {
  return [
    Math.cos(lat * DEG) * Math.cos(lon * DEG),
    Math.sin(lat * DEG),
    -Math.cos(lat * DEG) * Math.sin(lon * DEG),
  ];
}
export function dirToLatLon(p: V) {
  const l = Math.hypot(...p) || 1;
  return {
    lat: Math.asin(Math.max(-1, Math.min(1, p[1] / l))) / DEG,
    lon: Math.atan2(-p[2], p[0]) / DEG,
  };
}
export function inertialToBody(p: V, t: number, period: number): V {
  const a = (-t / period) * Math.PI * 2,
    c = Math.cos(a),
    s = Math.sin(a);
  return [c * p[0] + s * p[2], p[1], -s * p[0] + c * p[2]];
}
export function bodyToInertial(p: V, t: number, period: number): V {
  return inertialToBody(p, -t, period);
}
export class EarthSurface {
  radiusM(_dir: V, _minWave = 3) {
    return 6371000;
  }
}
