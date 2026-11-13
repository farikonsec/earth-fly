import { add, mul, len, type V } from "./vector";
export const EARTH = {
  name: "Earth",
  mu: 398600.4418,
  radius: 6371,
  rotation: 86164.1,
};
// No moon encounters in the first Earth prototype.
export const EARTH_MOONS: { name: string; radius: number }[] = [];
export function earthMoonState(_i: number, _t: number) {
  return { p: [384400, 0, 0] as V, v: [0, 0, 1] as V };
}
export function earthGravity(p: V, _time = 0): V {
  return mul(p, -EARTH.mu / Math.max(len(p), 1e-6) ** 3);
}
export interface EarthState {
  /** Irreversible accumulated overload damage, 0..1; fictional envelope. */
  structuralDamage?: number;
  p: V;
  v: V;
  t: number;
  fuel: number;
  status: "flying" | "impact" | "landed";
  /** Ground speed along the nose while landed, m/s. Zero when parked. */
  roll?: number;
  body: string;
  heat?: number;
  dynamicPressure?: number;
}
export const energy = (s: EarthState) =>
  len(s.v) ** 2 / 2 - EARTH.mu / len(s.p);
export const altitude = (s: EarthState) => (len(s.p) - EARTH.radius) * 1000;
