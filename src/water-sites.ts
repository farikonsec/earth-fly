/**
 * Places with a real water surface (mirror reflections, wave spectrum). Plain data shared by the main thread, the
 * terrain mesh worker and the bridges.
 *
 * London sits on LIDAR bare earth with the river at 0 m, so the surface needs no help there. The estuary sites sit on
 * surface models whose "water" wanders between 0 and 14 m (the Forth) because radar reads waves, mud and decks. There
 * the ground below `level + lower` is sunk under the surface, and the surface only draws where the map paints water.
 */
export interface WaterSite {
  name: string; west: number; east: number; south: number; north: number;
  /** Water level in metres; the surface draws 0.3 m above it. */
  level: number;
  /** Ground up to this many metres above the level counts as water-surface noise and is sunk below the surface. */
  lower: number;
  /** Draw only where the ground overlay paints water (needed where the terrain is not surveyed bare earth). */
  masked: boolean;
  /** Linear colour of light coming back up out of the water: silt, peat or open sea. */
  body: [number, number, number];
  /** Wave slope multiplier: sheltered river 1, open firth more. */
  waves: number;
}
export const WATER_SITES: WaterSite[] = [
  { name: "Thames, London", west: -0.52, east: 0.06, south: 51.44, north: 51.56, level: 0, lower: 0, masked: false, body: [0.016, 0.021, 0.017], waves: 1 },
  { name: "Thames, Dartford", west: 0.18, east: 0.34, south: 51.43, north: 51.5, level: 0, lower: 10, masked: true, body: [0.022, 0.022, 0.016], waves: 1.15 },
  { name: "Severn crossings", west: -2.78, east: -2.55, south: 51.54, north: 51.68, level: 0, lower: 8, masked: true, body: [0.032, 0.025, 0.014], waves: 1.25 },
  { name: "Firth of Forth", west: -3.5, east: -3.3, south: 55.96, north: 56.04, level: 0, lower: 14, masked: true, body: [0.009, 0.017, 0.016], waves: 1.5 },
];
export const siteAt = (lat: number, lon: number, margin = 0) =>
  WATER_SITES.find((s) => lon > s.west - margin && lon < s.east + margin && lat > s.south - margin && lat < s.north + margin) ?? null;
/**
 * Ground height with the water-surface noise sunk below the surface. Low land near the shore goes down with it,
 * which the masked surface leaves visible as land; anything 6 m above the noise band is untouched.
 */
export function sinkWater(lat: number, lon: number, h: number) {
  for (const s of WATER_SITES) {
    if (s.lower <= 0 || lon < s.west || lon > s.east || lat < s.south || lat > s.north) continue;
    const F = 0.012, edge = Math.min(1, Math.min(lon - s.west, s.east - lon, lat - s.south, s.north - lat) / F), e = edge * edge * (3 - 2 * edge);
    const top = s.level + s.lower, u = Math.min(1, Math.max(0, (h - top) / 6)), w = 1 - u * u * (3 - 2 * u);
    // Never below 1 m under the surface, so a splash happens where the water is drawn.
    return Math.max(h - (s.lower + 1) * w * e, Math.min(h, s.level - 1));
  }
  return h;
}
