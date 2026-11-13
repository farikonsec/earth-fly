import * as T from 'three';
import { EARTH } from './earth';
import { bodyToInertial, inertialToBody, type EarthSurface } from './geo';
import { add, mul, unit, cross, dot, len, type V } from './vector';
export const LANDING = { maxSlope: 12, maxTilt: 8, gearTravel: .75, gearClearance: 3.4, bellyClearance: 1.5 };
/**
 * The drawn airframe's envelope in metres from its centre (measured from the model in spaceplane.ts): belly 1.5 m
 * below, fin top 4.5 m above, wings 31.3 m across with winglets rising from -0.5 m to +4.2 m at the tips.
 */
export const AIRFRAME = { belly: 1.5, fin: 4.5, tip: 15, tipLow: -0.5, tipHigh: 3.6 };
/** Terrain normal over a 30 m footprint, sampled from the collision height authority. */
export function groundFrame(surface: EarthSurface, position: V, time: number) {
  const body = inertialToBody(position, time, EARTH.rotation), up = unit(body);
  let east = unit(cross([0, 1, 0], up));
  if (len(east) < .1) east = [1, 0, 0];
  const north = unit(cross(up, east)), step = 15 / surface.radiusM(up);
  const point = (axis: V, side: number) => {
    const direction = unit(add(up, mul(axis, step * side)));
    return mul(direction, surface.radiusM(direction));
  };
  const difference = (axis: V) => add(point(axis, 1), mul(point(axis, -1), -1));
  let normal = unit(cross(difference(east), difference(north)));
  if (dot(normal, up) < 0) normal = mul(normal, -1);
  return {
    normal: bodyToInertial(normal, time, EARTH.rotation),
    slope: Math.acos(Math.max(-1, Math.min(1, dot(normal, up)))) * 180 / Math.PI,
  };
}
/** Signed radial gaps at the nose and main pads, plus a belly ridge check; metres. */
export function contactGaps(surface: EarthSurface, position: V, time: number, q: T.Quaternion, gear: boolean) {
  const offsets = gear ? [[0, -LANDING.gearClearance, -11], [-3.2, -LANDING.gearClearance, 5], [3.2, -LANDING.gearClearance, 5], [0, -LANDING.bellyClearance, 0]]
    // Gear up: belly plus both wingtips, so a banked low pass can catch a tip in the water.
    : [[0, -LANDING.bellyClearance, 0], [-AIRFRAME.tip, AIRFRAME.tipLow, 4], [AIRFRAME.tip, AIRFRAME.tipLow, 4]];
  const gaps = offsets.map(offset => {
    const v = new T.Vector3(...offset).applyQuaternion(q).multiplyScalar(.001),
      p = add(position, v.toArray() as V);
    return len(p) * 1000 - surface.radiusM(inertialToBody(p, time, EARTH.rotation));
  });
  return { gap: Math.min(...gaps), spread: gear ? Math.max(...gaps.slice(0, 3)) - Math.min(...gaps) : 0 };
}
export function surfaceAttitude(q: T.Quaternion, normal: V) {
  const up = new T.Vector3(...normal), forward = new T.Vector3(0, 0, -1).applyQuaternion(q);
  forward.addScaledVector(up, -forward.dot(up));
  if (forward.lengthSq() < 1e-8) forward.set(1, 0, 0).addScaledVector(up, -up.x);
  if (forward.lengthSq() < 1e-8) forward.set(0, 0, 1);
  forward.normalize();
  return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(
    forward.clone().cross(up).normalize(), up, forward.clone().negate(),
  ));
}
export function settleOnSurface(surface: EarthSurface, position: V, time: number, q: T.Quaternion): V {
  let p = position;
  for (let i = 0; i < 3; i++) {
    const { gap } = contactGaps(surface, p, time, q, true);
    p = add(p, mul(unit(p), -gap / 1000));
  }
  return p;
}
