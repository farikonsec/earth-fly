/**
 * Bridges you can fly under. Positions and orientation come from OpenStreetMap (public/scenery/bridges.json);
 * heights come from published figures:
 * - Thames, Richmond to Dartford: Port of London Authority "Thames bridge heights" chart, clearance of each arch in
 *   metres above Mean High Water Springs, numbered north shore to south shore (pla.co.uk/thames-bridge-heights).
 *   Bridges marked `maintained` (above Richmond lock) give headway above the maintained water level instead.
 * - Severn Bridge 47 m clearance, 988 m main span (Structurae); Prince of Wales Bridge 37 m navigation clearance,
 *   456 m main span, pylons 101 m above the deck (Wikipedia, Gloucester Harbour Trustees).
 * - Forth Road Bridge 44.3 m clearance, towers 156 m; Queensferry Crossing 46 m clearance, towers 207 m;
 *   Forth Bridge highest point 110 m above high water (theforthbridges.org, Wikipedia).
 * - QEII Bridge, Dartford: PLA chart 53.9 m above MHWS, 450 m main span, 137 m overall height (ICE).
 * The game's water surface sits at mean sea level, so `tide` (MHWS above that level) is added to every clearance:
 * you meet each bridge at mid-tide, a few metres roomier than the charted high-water headroom.
 */
export type BridgeKind = "arch" | "girder" | "truss" | "suspension" | "cable" | "cantilever" | "tower";
export interface BridgeSpec {
  id: string; name: string; osm: string; region: "thames" | "severn" | "forth";
  kind: BridgeKind;
  /** Clearance of each span in metres above MHWS (or maintained level), first entry at end `a` of the axis. */
  clearances: number[];
  /** Main navigation span index. */
  main: number;
  /** Relative span lengths when the spans are not all alike (big crossings): metres. */
  spans?: number[];
  /** MHWS above the game's water level, metres. */
  tide: number;
  /** Depth of the deck structure at mid-span, metres. */
  deck: number;
  width?: number; length?: number;
  colour: number; trim: number;
  /** Height of towers or pylons above the water, metres. */
  towers?: number;
  /** Iron or steel arches get visible arch ribs; stone arches get rusticated spandrels. */
  iron?: boolean;
  /** Pylon form for cable-stayed bridges. */
  pylon?: "H" | "mono";
  /** Low approach viaduct each side, metres (big crossings). */
  approach?: number;
  /** Sub-structure extras. */
  footbridges?: boolean; rail?: boolean;
  note?: string;
}
const T = 3.5; // MHWS above mean sea level, central tideway (London Bridge +3.4 m ODN, rounded)
export const BRIDGES: BridgeSpec[] = [
  { id: "tower", name: "Tower Bridge", osm: "Tower Bridge", region: "thames", kind: "tower", clearances: [6.8, 8.5, 6.8], main: 1, tide: T, deck: 2.2, colour: 0xc9bea6, trim: 0x6f9cc9, towers: 65, note: "High walkways 42 m above high water; towers 65 m." },
  { id: "london", name: "London Bridge", osm: "London Bridge", region: "thames", kind: "girder", clearances: [6.6, 8.6, 6.6], main: 1, tide: T, deck: 2.6, colour: 0xb4b0a6, trim: 0x8e8a80 },
  { id: "cannon", name: "Cannon Street Railway Bridge", osm: "Cannon Street Railway Bridge", region: "thames", kind: "girder", clearances: [6.7, 7.0, 7.1, 7.0, 6.8], main: 2, tide: T, deck: 2.4, colour: 0x6b7075, trim: 0x3e4449, rail: true },
  { id: "southwark", name: "Southwark Bridge", osm: "Southwark Bridge", region: "thames", kind: "arch", clearances: [5.6, 6.5, 7.2, 6.5, 5.5], main: 2, tide: T, deck: 1.4, colour: 0x6f8a55, trim: 0xd1aa36, iron: true },
  { id: "millennium", name: "Millennium Bridge", osm: "Millennium Bridge", region: "thames", kind: "suspension", clearances: [8.5, 8.8, 6.3], main: 1, tide: T, deck: 1.0, colour: 0xc9cdd1, trim: 0x9aa1a8, towers: 0, note: "A 'blade of light': cables run 2.3 m above deck level." },
  { id: "blackfriars-rail", name: "Blackfriars Railway Bridge", osm: "Blackfriars Railway Bridge", region: "thames", kind: "arch", clearances: [5.0, 6.9, 6.9, 7.0, 7.2], main: 2, tide: T, deck: 2.0, colour: 0x5a4f4a, trim: 0x8b2f2a, iron: true, rail: true },
  { id: "blackfriars", name: "Blackfriars Bridge", osm: "Blackfriars Bridge", region: "thames", kind: "arch", clearances: [4.0, 5.9, 6.9, 5.8, 4.4], main: 2, tide: T, deck: 1.5, colour: 0xa02a26, trim: 0xece4d2, iron: true },
  { id: "waterloo", name: "Waterloo Bridge", osm: "Waterloo Bridge", region: "thames", kind: "girder", clearances: [6.1, 8.4, 8.5, 8.5, 6.0], main: 2, tide: T, deck: 2.2, colour: 0xd8d2c2, trim: 0xb9b2a0 },
  { id: "hungerford", name: "Hungerford & Golden Jubilee Bridges", osm: "Hungerford Bridge", region: "thames", kind: "truss", clearances: [6.8, 6.9, 6.9, 6.9, 6.8], main: 2, tide: T, deck: 2.2, colour: 0x53595f, trim: 0xf0f0ee, footbridges: true, rail: true, towers: 25 },
  { id: "westminster", name: "Westminster Bridge", osm: "Westminster Bridge", region: "thames", kind: "arch", clearances: [4.1, 4.7, 5.1, 5.3, 5.1, 4.7, 4.1], main: 3, tide: T, deck: 1.4, width: 26, colour: 0x3f6b4d, trim: 0xcaa641, iron: true },
  { id: "lambeth", name: "Lambeth Bridge", osm: "Lambeth Bridge", region: "thames", kind: "arch", clearances: [3.1, 5.0, 6.3, 5.0, 3.2], main: 2, tide: T, deck: 1.4, colour: 0x8c2f2b, trim: 0xdcc9a0, iron: true },
  { id: "vauxhall", name: "Vauxhall Bridge", osm: "Vauxhall Bridge", region: "thames", kind: "arch", clearances: [3.8, 5.0, 5.6, 5.0, 3.8], main: 2, tide: T, deck: 1.5, colour: 0xa3352b, trim: 0xe0d6c0, iron: true },
  { id: "grosvenor", name: "Grosvenor Railway Bridge", osm: "Grosvenor Bridge", region: "thames", kind: "arch", clearances: [5.9, 5.9, 5.9, 5.9], main: 1, tide: T, deck: 2.0, colour: 0x6f6a63, trim: 0x4b4741, iron: true, rail: true },
  { id: "chelsea", name: "Chelsea Bridge", osm: "Chelsea Bridge", region: "thames", kind: "suspension", clearances: [6.1, 6.4, 6.1], main: 1, tide: T, deck: 1.6, colour: 0xf0ede6, trim: 0xb8392f, towers: 30 },
  { id: "albert", name: "Albert Bridge", osm: "Albert Bridge", region: "thames", kind: "suspension", clearances: [4.2, 5.2, 5.2, 4.1], main: 1, tide: T, deck: 1.4, colour: 0xe5c4c8, trim: 0x8fb4b6, towers: 24 },
  { id: "battersea", name: "Battersea Bridge", osm: "Battersea Bridge", region: "thames", kind: "arch", clearances: [2.4, 3.8, 5.4, 3.8, 2.4], main: 2, tide: T, deck: 1.3, colour: 0x405c46, trim: 0xc8a43e, iron: true },
  { id: "battersea-rail", name: "Battersea Railway Bridge", osm: "Battersea Railway Bridge", region: "thames", kind: "arch", clearances: [5.9, 5.9, 5.9, 5.9, 5.9], main: 2, tide: T, deck: 1.8, colour: 0x5d6064, trim: 0x3d4044, iron: true, rail: true },
  { id: "wandsworth", name: "Wandsworth Bridge", osm: "Wandsworth Bridge", region: "thames", kind: "girder", clearances: [3.0, 5.7, 3.0], main: 1, tide: T, deck: 2.0, colour: 0x6f8aa1, trim: 0x4d6476 },
  { id: "fulham-rail", name: "Fulham Railway Bridge", osm: "Fulham Railway Bridge", region: "thames", kind: "truss", clearances: [6.1, 6.4, 6.6, 7.0, 7.2], main: 2, tide: T, deck: 1.8, colour: 0x6b5a4c, trim: 0x4a3d33, rail: true },
  { id: "putney", name: "Putney Bridge", osm: "Putney Bridge", region: "thames", kind: "arch", clearances: [3.3, 4.3, 5.2, 4.3, 3.4], main: 2, tide: T, deck: 1.6, colour: 0x9c978d, trim: 0x7e796f },
  { id: "hammersmith", name: "Hammersmith Bridge", osm: "Hammersmith Bridge", region: "thames", kind: "suspension", clearances: [2.4, 3.5, 2.4], main: 1, tide: T, deck: 1.3, colour: 0x4f6e4a, trim: 0xc4a24a, towers: 22, note: "The lowest headroom on the tideway: 3.5 m at high water." },
  { id: "barnes", name: "Barnes Railway Bridge", osm: "Barnes Bridge", region: "thames", kind: "arch", clearances: [5.4, 5.4, 5.3], main: 1, tide: T, deck: 1.8, colour: 0x6c6f70, trim: 0x4b4e4f, iron: true, rail: true },
  { id: "chiswick", name: "Chiswick Bridge", osm: "Chiswick Bridge", region: "thames", kind: "arch", clearances: [6.4, 6.6, 6.4], main: 1, tide: T, deck: 1.6, colour: 0xcfc8b8, trim: 0xb3ab99 },
  { id: "kew-rail", name: "Kew Railway Bridge", osm: "Kew Railway Bridge", region: "thames", kind: "truss", clearances: [5.4, 5.4, 5.4, 5.5, 5.5], main: 3, tide: T, deck: 1.6, colour: 0x5d6a50, trim: 0x3f4936, rail: true },
  { id: "kew", name: "Kew Bridge", osm: "Kew Bridge", region: "thames", kind: "arch", clearances: [4.4, 5.2, 4.3], main: 1, tide: T, deck: 1.6, colour: 0xbab4a7, trim: 0x9c968a },
  { id: "richmond-rail", name: "Richmond Railway Bridge", osm: "Richmond Railway Bridge", region: "thames", kind: "girder", clearances: [5.4, 5.5, 5.5], main: 1, tide: 0, deck: 1.8, width: 10, colour: 0x6a6560, trim: 0x4c4843, rail: true, note: "Headway above maintained water level." },
  { id: "twickenham", name: "Twickenham Bridge", osm: "Twickenham Bridge", region: "thames", kind: "arch", clearances: [5.8, 6.1, 5.8], main: 1, tide: 0, deck: 1.4, colour: 0xd4ccb8, trim: 0xb0a690, note: "Headway above maintained water level." },
  { id: "richmond", name: "Richmond Bridge", osm: "Richmond Bridge", region: "thames", kind: "arch", clearances: [3.6, 4.5, 5.5, 4.4, 3.1], main: 2, tide: 0, deck: 1.6, colour: 0xd9cfb5, trim: 0xb9ae93, note: "London's oldest Thames bridge (1777). Headway above maintained water level." },
  { id: "qe2", name: "Queen Elizabeth II Bridge (Dartford)", osm: "Queen Elizabeth II Bridge", region: "thames", kind: "cable", clearances: [53.9, 53.9, 53.9], main: 1, spans: [181, 450, 181], tide: 3.3, deck: 3.0, width: 32, length: 1500, colour: 0xe8e8e5, trim: 0x9ea3a8, towers: 137, pylon: "H", approach: 340 },
  { id: "severn", name: "Severn Bridge", osm: "Severn Bridge", region: "severn", kind: "suspension", clearances: [47, 47, 47], main: 1, spans: [305, 988, 305], tide: 6.4, deck: 3.0, width: 31.6, colour: 0xd8dadb, trim: 0x9da2a6, towers: 136 },
  { id: "prince-of-wales", name: "Prince of Wales Bridge", osm: "Prince of Wales Bridge", region: "severn", kind: "cable", clearances: [37, 37, 37], main: 1, spans: [246, 456, 246], tide: 7.4, deck: 3.0, width: 34, length: 1800, colour: 0xd3d1cb, trim: 0x8f8b84, towers: 148, pylon: "H", approach: 420 },
  { id: "forth", name: "Forth Bridge", osm: "Forth Bridge", region: "forth", kind: "cantilever", clearances: [46, 46], main: 0, tide: 2.5, deck: 7, width: 10, colour: 0xb3302a, trim: 0x7d1f1b, towers: 110, rail: true },
  { id: "forth-road", name: "Forth Road Bridge", osm: "Forth Road Bridge", region: "forth", kind: "suspension", clearances: [44.3, 44.3, 44.3], main: 1, spans: [408, 1006, 408], tide: 2.5, deck: 8.4, width: 33, colour: 0x9aa0a4, trim: 0x6b7276, towers: 156 },
  { id: "queensferry", name: "Queensferry Crossing", osm: "Queensferry Crossing", region: "forth", kind: "cable", clearances: [46, 46, 46, 46], main: 1, spans: [221, 650, 650, 221], tide: 2.5, deck: 4.9, width: 40, colour: 0xd9dadc, trim: 0x8d9296, towers: 207, pylon: "mono", approach: 300 },
];
