import * as T from "three";
const DEG = Math.PI / 180;
/** Low-precision solar equatorial direction for visual lighting, not navigation. */
export function sunDirection(date: Date) {
  const d = date.getTime() / 86400000 - 10957.5,
    L = (280.46 + 0.9856474 * d) * DEG,
    g = (357.528 + 0.9856003 * d) * DEG,
    lambda = L + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG,
    eps = (23.439 - 0.0000004 * d) * DEG;
  return new T.Vector3(
    Math.cos(lambda),
    Math.sin(eps) * Math.sin(lambda),
    -Math.cos(eps) * Math.sin(lambda),
  ).normalize();
}
export function siderealAngle(date: Date) {
  const d = date.getTime() / 86400000 - 10957.5;
  return ((280.46061837 + 360.98564736629 * d) % 360) * DEG;
}
/** Mean lunar orbit for visual scale/phase. Not a precision ephemeris. */
export function moonPosition(date: Date) {
  const d = date.getTime() / 86400000 - 10957.5,
    lambda = (218.316 + 13.176396 * d) * DEG,
    beta = 5.145 * Math.sin((93.272 + 13.22935 * d) * DEG) * DEG,
    eps = 23.439 * DEG;
  const x = Math.cos(beta) * Math.cos(lambda),
    y = Math.cos(beta) * Math.sin(lambda),
    z = Math.sin(beta);
  return new T.Vector3(
    x,
    y * Math.sin(eps) + z * Math.cos(eps),
    -(y * Math.cos(eps) - z * Math.sin(eps)),
  ).multiplyScalar(384400);
}

/** Sun in the rotating geographic frame (east-positive longitude). UTC, including date/season. */
export function earthFixedSun(date: Date) {
  return sunDirection(date).applyAxisAngle(new T.Vector3(0,1,0),-siderealAngle(date));
}
/** Geometric centre-of-disc angles; excludes atmospheric refraction and terrain obstruction. */
export function solarPosition(date: Date, lat: number, lon: number) {
  const sun=earthFixedSun(date),a=lat*DEG,b=lon*DEG;
  const up=new T.Vector3(Math.cos(a)*Math.cos(b),Math.sin(a),-Math.cos(a)*Math.sin(b));
  const east=new T.Vector3(-Math.sin(b),0,-Math.cos(b));
  const north=up.clone().cross(east);
  return {elevation:Math.asin(T.MathUtils.clamp(sun.dot(up),-1,1))/DEG,
    azimuth:(Math.atan2(sun.dot(east),sun.dot(north))/DEG+360)%360};
}
