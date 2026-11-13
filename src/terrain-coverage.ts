import { MathUtils } from 'three';

/** 5 m centre spacing across 640 m on a 256-segment grid; retain the 600 km horizon. */
export function terrainOffset(unit: number) {
  const d=Math.abs(unit);
  if(d<=.5)return unit*.64;
  if(d<=.75){const t=(d-.5)*4;return Math.sign(unit)*(.32+.16*t+9.52*t*t);}
  const t=(d-.75)*4;
  return Math.sign(unit)*(10+19.2*t+156.6*t*t+414.2*t*t*t);
}

/** A gradual handoff to the globe instead of the old 70 km visibility switch. */
export function terrainOpacity(altitudeMetres: number) {
  return 1 - MathUtils.smoothstep(altitudeMetres, 50000, 90000);
}

/** Shared numerical reference for the regional/global imagery shader feather. */
export function regionalWeight(u: number, v: number) {
  return MathUtils.smoothstep(Math.min(u, v, 1 - u, 1 - v), 0, .08);
}
