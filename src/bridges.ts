import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { BRIDGES, type BridgeSpec } from "./bridges-data";
import { latLonToDir, bodyToInertial, dirToLatLon } from "./geo";
import { EARTH } from "./earth";
import type { Terrain } from "./terrain";
import { siteAt } from "./water-sites";
import { AIRFRAME } from "./contact";
import type { V } from "./vector";

/** Everything in a bridge's local frame is in metres: x along the deck, y up from the water, z across (the way you fly under). */
interface Opening { x0: number; x1: number; top: (x: number) => number; index: number }
interface Capsule { a: T.Vector3; b: T.Vector3; r: number }
interface Box { min: T.Vector3; max: T.Vector3 }
export interface BridgeEvent { type: "hit" | "under"; bridge: Bridge; opening?: number; clearance?: number }
export interface Bridge {
  spec: BridgeSpec; a: [number, number]; b: [number, number];
  centre: T.Vector3; X: T.Vector3; Y: T.Vector3; Z: T.Vector3; length: number; width: number; water: number; revision?: number;
  outline: [number, number][]; holes: [number, number][][]; openings: Opening[]; capsules: Capsule[]; boxes: Box[];
  deckTop: (x: number) => number; group: T.Group | null; lamps: T.Mesh | null;
}
const R = EARTH.radius, BELOW = -8;

// ---------- small geometry helpers (all non-indexed with vertex colours, merged per bridge)
const tint = (g: T.BufferGeometry, hex: number, shade = 1) => {
  const geo = g.index ? g.toNonIndexed() : g, n = geo.getAttribute("position").count, c = new T.Color(hex).multiplyScalar(shade), out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) out.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute("color", new T.BufferAttribute(out, 3)); geo.deleteAttribute("uv"); geo.deleteAttribute("uv1"); return geo;
};
/** A side-elevation polygon (x, y) with holes, extruded across the deck to the given width, centred on z. */
function elevation(outer: [number, number][], holes: [number, number][][], width: number, z = 0) {
  const shape = new T.Shape(outer.map(([x, y]) => new T.Vector2(x, y)));
  for (const h of holes) shape.holes.push(new T.Path(h.map(([x, y]) => new T.Vector2(x, y))));
  return new T.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 1 }).translate(0, 0, z - width / 2);
}
/** A cylinder from a to b. */
function rod(a: T.Vector3, b: T.Vector3, r: number, sides = 8) {
  const d = b.clone().sub(a), g = new T.CylinderGeometry(r, r, d.length(), sides, 1, false);
  g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), d.clone().normalize())); g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); return g;
}
const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => new T.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
const smooth = (a: number, b: number, t: number) => a + (b - a) * (0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, t))));

/** Lays out supports and spans along the deck and returns the deck and soffit profiles. */
function layout(spec: BridgeSpec, L: number, endA: number, endB: number) {
  const n = spec.clearances.length, crowns = spec.clearances.map((c) => c + spec.tide);
  let spans: number[], piers: number[], start: number;
  if (spec.spans) {
    spans = spec.spans.slice(); const towers = spec.kind === "suspension" || spec.kind === "cable" ? 14 : 10;
    piers = Array.from({ length: n + 1 }, (_, i) => (i === 0 || i === n ? 12 : towers));
    start = -(spans.reduce((s, v) => s + v, 0) + piers.reduce((s, v) => s + v, 0)) / 2;
  } else {
    // Arch spans grow with their headroom; girders and suspension spans are more even.
    const weights = spec.clearances.map((c, i) => spec.kind === "arch" ? c + 4 : spec.kind === "suspension" ? (i === spec.main ? 2.6 : 1) : 1);
    const pierShare = spec.kind === "arch" ? (spec.iron ? 0.07 : 0.11) : spec.kind === "suspension" ? 0.05 : 0.05;
    const usable = L * 0.9, abut = 8, avg = usable / n, pier = Math.max(spec.kind === "arch" ? 3.5 : 2.5, Math.min(9, avg * pierShare));
    const spanTotal = usable - 2 * abut - (n - 1) * pier, wsum = weights.reduce((s, v) => s + v, 0);
    spans = weights.map((w) => (spanTotal * w) / wsum); piers = Array.from({ length: n + 1 }, (_, i) => (i === 0 || i === n ? abut : pier)); start = -usable / 2;
  }
  // Supports: centre x and width along the deck.
  const supports: { x: number; w: number }[] = []; let x = start;
  for (let i = 0; i <= n; i++) { supports.push({ x: x + piers[i] / 2, w: piers[i] }); x += piers[i] + (i < n ? spans[i] : 0); }
  const centres = spans.map((_, i) => (supports[i].x + supports[i + 1].x) / 2);
  const structureEnds = [supports[0].x - supports[0].w / 2, supports[n].x + supports[n].w / 2];
  // Deck top through each span's crown, easing down to the banks (or along an approach viaduct).
  const keys: [number, number][] = [[-L / 2, endA]];
  if (spec.spans) { keys.push([structureEnds[0], crowns[0] + spec.deck]); centres.forEach((c, i) => keys.push([c, crowns[i] + spec.deck + (i === spec.main ? spans[i] * 0.0015 : 0)])); keys.push([structureEnds[1], crowns[n - 1] + spec.deck]); }
  else centres.forEach((c, i) => keys.push([c, crowns[i] + spec.deck]));
  keys.push([L / 2, endB]);
  const deckTop = (q: number) => { for (let i = 1; i < keys.length; i++) if (q <= keys[i][0]) return smooth(keys[i - 1][1], keys[i][1], (q - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0])); return keys[keys.length - 1][1]; };
  return { n, crowns, spans, supports, centres, structureEnds, deckTop };
}

export class Bridges {
  list: Bridge[] = []; ready = false; night = 0;
  private material = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.08 });
  private lampMaterial = new T.MeshStandardMaterial({ color: 0x2a2620, emissive: new T.Color(1, 0.78, 0.45), emissiveIntensity: 0 });
  private gateMaterial = new T.MeshBasicMaterial({ color: new T.Color(0.4, 1, 0.65).multiplyScalar(2.2), transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false, side: T.DoubleSide });
  group = new T.Group(); private gate: T.Mesh | null = null;
  constructor(private terrain: Terrain) { this.group.name = "Bridges"; }
  async load() {
    const data = await (await fetch("scenery/bridges.json")).json(), geo = data.bridges as Record<string, { a: [number, number]; b: [number, number]; width: number }>;
    for (const spec of BRIDGES) { const g = geo[spec.osm]; if (g) this.add(spec, g.a, g.b, g.width); }
    // Surface models record long decks as a ridge of ground (75 m high along the Severn Bridge); cut it back to the
    // level beside the deck. London is covered by LIDAR bare earth, which overrides this anyway.
    this.terrain.cuts = this.list.map((b) => {
      const ll = dirToLatLon(b.centre.toArray() as V), east = new T.Vector3(0, 1, 0).cross(b.centre).normalize(), north = b.centre.clone().cross(east);
      return { lat: ll.lat, lon: ll.lon, east: b.X.dot(east), north: b.X.dot(north), half: b.length / 2, width: b.width / 2 + 15 };
    });
    this.ready = true;
  }
  /** Places one bridge from its axis end points (lat, lon) and mapped width. */
  add(spec: BridgeSpec, a: [number, number], b: [number, number], mappedWidth: number) {
    {
      // Arches are numbered from the north shore: put end `a` on the north side.
      if (a[0] < b[0]) [a, b] = [b, a];
      const da = new T.Vector3(...latLonToDir(a[0], a[1])), db = new T.Vector3(...latLonToDir(b[0], b[1])), mid = da.clone().add(db).normalize();
      const Y = mid.clone(), X = db.clone().sub(da); X.addScaledVector(Y, -X.dot(Y)).normalize(); const Z = X.clone().cross(Y).normalize();
      const length = spec.length ?? da.angleTo(db) * R * 1000, width = spec.width ?? Math.max(8, Math.min(spec.footbridges ? 52 : 40, mappedWidth));
      const bridge: Bridge = { spec, a, b, centre: mid, X, Y, Z, length, width, water: 0, outline: [], holes: [], openings: [], capsules: [], boxes: [], deckTop: () => 0, group: null, lamps: null };
      this.list.push(bridge); return bridge;
    }
  }
  /** Builds a bridge's model and collision shapes now (normally done when you come within 30 km). */
  ensure(b: Bridge) { if (!b.group) this.build(b); return b; }
  /** Ground or water height (m) at a point along the deck axis. */
  private heightAt(b: Bridge, x: number, z = 0) { const p = b.centre.clone().multiplyScalar(R).addScaledVector(b.X, x / 1000).addScaledVector(b.Z, z / 1000).normalize(), l = dirToLatLon(p.toArray() as V); return this.terrain.height(l.lat, l.lon); }
  /**
   * The river surface under the middle of the bridge, the reference level for every clearance. Surface models record
   * big decks as ground (65-75 m up at Severn and the Forth), so it also samples beside the deck.
   */
  private waterAt(b: Bridge) { const ll = dirToLatLon(b.centre.toArray() as V), site = siteAt(ll.lat, ll.lon); if (site?.masked) return site.level; const off = b.width / 2 + 40, L = b.length; return Math.min(...[0, L * 0.1, -L * 0.1].flatMap((x) => [0, off, -off, 2 * off, -2 * off].map((z) => this.heightAt(b, x, z)))); }
  /** Rebuilds one bridge if the ground under it has changed since it was built. */
  relevel(id: string) { const b = this.list.find((x) => x.spec.id === id); if (b?.group && Math.abs(this.waterAt(b) - b.water) > 0.5) { this.unbuild(b); this.build(b); } }
  /** Drops a built bridge so the next update builds it again on finer ground. */
  private unbuild(b: Bridge) {
    if (!b.group) return; this.group.remove(b.group);
    b.group.traverse((o) => { if ((o as T.Mesh).isMesh) (o as T.Mesh).geometry.dispose(); }); b.group = null; b.lamps = null;
  }
  private build(b: Bridge) {
    const s = b.spec, L = b.length;
    b.water = this.waterAt(b); b.revision = this.terrain.revision;
    const off = b.width / 2 + 40, bank = (x: number) => Math.max(1.5, Math.min(this.heightAt(b, x, off), this.heightAt(b, x, -off)) - b.water + 0.6);
    const lay = layout(s, L, bank(-L / 2), bank(L / 2)), parts: T.BufferGeometry[] = [], lamps: T.BufferGeometry[] = [], w = b.width, half = w / 2;
    b.deckTop = lay.deckTop; b.capsules = []; b.boxes = []; b.openings = []; b.holes = [];
    const soffit = (x: number) => lay.deckTop(x) - s.deck;
    // ----- openings (what you fly through), one per span; approach viaducts add their own arches
    const holes: [number, number][][] = [];
    const addOpening = (x0: number, x1: number, top: (x: number) => number, index: number) => {
      if (x1 - x0 < 4) return; const pts: [number, number][] = [[x0, BELOW + 1], [x1, BELOW + 1]], steps = Math.max(10, Math.min(48, Math.round((x1 - x0) / 6)));
      for (let k = steps; k >= 0; k--) { const x = x0 + ((x1 - x0) * k) / steps; pts.push([x, Math.max(BELOW + 1.5, Math.min(top(x), soffit(x) - 0.3))]); }
      holes.push(pts); if (index >= 0) b.openings.push({ x0, x1, top: (x) => Math.min(top(x), soffit(x) - 0.3), index });
    };
    for (let i = 0; i < lay.n; i++) {
      const x0 = lay.supports[i].x + lay.supports[i].w / 2, x1 = lay.supports[i + 1].x - lay.supports[i + 1].w / 2, c = (x0 + x1) / 2, a = (x1 - x0) / 2, crown = lay.crowns[i];
      if (s.kind === "arch") { const spring = crown * (s.iron ? 0.28 : 0.42); addOpening(x0, x1, (x) => spring + (crown - spring) * Math.pow(Math.max(0, 1 - ((x - c) / a) ** 2), s.iron ? 0.5 : 0.6), i); }
      else if (s.kind === "cantilever") { /* openings come from the cantilever geometry below */ }
      else addOpening(x0, x1, (x) => soffit(x) - 1.4 * Math.pow(Math.abs((x - c) / a), 10), i);
    }
    if (s.spans) {
      // Approach viaducts: piers every 60-70 m down to the banks.
      for (const side of [-1, 1]) {
        const from = side < 0 ? lay.structureEnds[0] : lay.structureEnds[1], to = (side * L) / 2, count = Math.max(1, Math.round(Math.abs(to - from) / 66)), step = (to - from) / count;
        for (let k = 0; k < count; k++) { const p0 = from + step * k, p1 = from + step * (k + 1), lo = Math.min(p0, p1) + 2.5, hi = Math.max(p0, p1) - 2.5; if (soffit((lo + hi) / 2) > 4) addOpening(lo, hi, (x) => soffit(x) - 0.8, -1); }
      }
    }
    // ----- main body: bank to bank, from below the water up to the deck surface
    const outer: [number, number][] = [[-L / 2, BELOW], [L / 2, BELOW]], step = Math.max(2, L / 400);
    for (let x = L / 2; x >= -L / 2 - 1e-6; x -= step) outer.push([x, lay.deckTop(x)]);
    b.outline = outer; b.holes = holes;
    const deckWidth = s.footbridges ? w - 11 : w;
    if (s.kind === "cantilever") {
      // Forth Bridge: the rail deck girder only; the cantilevers carry it.
      parts.push(tint(box(-L / 2, L / 2, lay.deckTop(0) - s.deck, lay.deckTop(0), -half, half), s.colour, 0.85));
      b.boxes.push({ min: new T.Vector3(-L / 2, lay.deckTop(0) - s.deck, -half), max: new T.Vector3(L / 2, lay.deckTop(0), half) });
      b.outline = [[-L / 2, BELOW], [L / 2, BELOW], [L / 2, BELOW + 0.1], [-L / 2, BELOW + 0.1]]; b.holes = [];
    } else parts.push(tint(elevation(outer, holes, deckWidth), s.colour, s.kind === "arch" && !s.iron ? 0.95 : 0.9));
    // Road surface strip and parapets.
    const strip = (lift: number, depth: number, z: number, hex: number, shade = 1) => { const pts: [number, number][] = []; for (let x = -L / 2 + 1; x <= L / 2 - 1; x += step) pts.push([x, lay.deckTop(x) + lift]); for (let x = L / 2 - 1; x >= -L / 2 + 1; x -= step) pts.push([x, lay.deckTop(x)]); const g = elevation(pts, [], depth, z); return tint(g, hex, shade); };
    if (s.kind !== "cantilever") {
      parts.push(strip(0.08, deckWidth - 2.4, 0, 0x34363a, 1));
      for (const side of [-1, 1]) parts.push(strip(1.15, 0.45, side * (deckWidth / 2 - 0.25), s.iron ? s.trim : s.colour, s.iron ? 1 : 1.08));
    }
    // ----- piers: cutwaters on both faces of every river pier
    for (let i = 1; i < lay.n; i++) {
      const p = lay.supports[i], top = Math.min(lay.crowns[i - 1], lay.crowns[i]) * (s.kind === "arch" ? (s.iron ? 0.28 : 0.42) : 0.5);
      if (s.kind === "cantilever") continue;
      for (const side of [-1, 1]) { const tri = new T.Shape([new T.Vector2(-p.w / 2, 0), new T.Vector2(p.w / 2, 0), new T.Vector2(0, p.w * 0.75)]), g = new T.ExtrudeGeometry(tri, { depth: Math.max(1, top - BELOW), bevelEnabled: false }); g.rotateX(-Math.PI / 2); g.scale(1, 1, side); g.translate(p.x, BELOW, side * (deckWidth / 2)); parts.push(tint(g, s.colour, 0.8)); }
    }
    // ----- iron arch ribs on both faces
    if (s.kind === "arch" && s.iron) for (const o of b.openings) for (const side of [-1, 1]) {
      const pts: [number, number][] = [], k = 28; for (let j = 0; j <= k; j++) { const x = o.x0 + ((o.x1 - o.x0) * j) / k; pts.push([x, o.top(x)]); } for (let j = k; j >= 0; j--) { const x = o.x0 + ((o.x1 - o.x0) * j) / k; pts.push([x, Math.min(o.top(x) + 1.5, lay.deckTop(x) - 0.25)]); }
      parts.push(tint(elevation(pts, [], 0.5, side * (deckWidth / 2 + 0.2)), s.trim));
    }
    // ----- lamp standards along both parapets (London)
    if (s.region === "thames" && !s.spans && s.kind !== "cantilever") for (let x = -L * 0.42; x <= L * 0.42; x += 24) for (const side of [-1, 1]) {
      const y = lay.deckTop(x) + 1.15, z = side * (deckWidth / 2 - 0.25); parts.push(tint(rod(new T.Vector3(x, y, z), new T.Vector3(x, y + 4.2, z), 0.11, 6), s.iron ? s.trim : 0x2d2f31));
      lamps.push(new T.SphereGeometry(0.32, 8, 6).translate(x, y + 4.4, z));
    }
    // ----- type-specific superstructure
    const legs = (x: number, top: number, thick: number, zs: number[], from = BELOW) => { for (const z of zs) { parts.push(tint(box(x - thick / 2, x + thick / 2, from, top, z - thick / 2, z + thick / 2), s.trim === 0xf0f0ee ? s.colour : s.colour, 1.05)); b.boxes.push({ min: new T.Vector3(x - thick / 2, from, z - thick / 2), max: new T.Vector3(x + thick / 2, top, z + thick / 2) }); } };
    const cable = (pts: T.Vector3[], r: number, hex: number) => { for (let i = 1; i < pts.length; i++) { parts.push(tint(rod(pts[i - 1], pts[i], r, 6), hex)); b.capsules.push({ a: pts[i - 1], b: pts[i], r }); } };
    if (s.kind === "suspension") {
      const mainA = lay.supports[s.main], mainB = lay.supports[s.main + 1], big = !!s.spans, low = s.towers === 0;
      const towerTop = low ? lay.deckTop(mainA.x) + 2.3 : s.towers!, thick = big ? 7 : 1.6, zc = half + (big ? 0.5 : 0.2), sag = low ? 0.6 : big ? 0.1 : 0.2;
      if (!low) for (const t of [mainA, mainB]) { legs(t.x, towerTop, thick, [-zc, zc], lay.deckTop(t.x) - s.deck - (big ? 40 : 2)); parts.push(tint(box(t.x - thick / 2, t.x + thick / 2, towerTop - (big ? 6 : 1.6), towerTop, -zc, zc), s.colour, 1.05)); if (big) parts.push(tint(box(t.x - thick / 2, t.x + thick / 2, towerTop * 0.55, towerTop * 0.55 + 5, -zc, zc), s.colour, 1.05)); }
      for (const z of [-zc, zc]) {
        const pts: T.Vector3[] = [], anchorA = -L / 2 + (big ? 30 : 6), anchorB = L / 2 - (big ? 30 : 6), lowY = (x: number) => lay.deckTop(x) + (low ? 2.3 : 1.2);
        // Side span up to the tower saddle, a parabola across the main span, and down to the far anchorage.
        // The Millennium Bridge has no towers: its cables run just above the deck edge with a shallow sag.
        const saddle = (x: number) => (low ? lowY(x) : towerTop - 1);
        for (let k = 0; k <= 8; k++) { const t = k / 8, x = anchorA + (mainA.x - anchorA) * t; pts.push(new T.Vector3(x, low ? lowY(x) - sag * Math.sin(Math.PI * t) : smooth(lowY(anchorA), saddle(x), t), z)); }
        for (let k = 1; k <= 24; k++) { const t = k / 24, x = mainA.x + (mainB.x - mainA.x) * t, base = lowY(x), y = low ? base - sag * Math.sin(Math.PI * t) : base + (saddle(x) - base) * (2 * t - 1) ** 2; pts.push(new T.Vector3(x, Math.max(base - (low ? sag : 0), y), z)); }
        for (let k = 1; k <= 8; k++) { const t = k / 8, x = mainB.x + (anchorB - mainB.x) * t; pts.push(new T.Vector3(x, low ? lowY(x) - sag * Math.sin(Math.PI * t) : smooth(saddle(x), lowY(anchorB), t), z)); }
        cable(pts, big ? 0.6 : 0.3, s.trim);
        // Hangers.
        if (!low) for (let i = 1; i < pts.length - 1; i += big ? 1 : 1) { const p = pts[i], d = lay.deckTop(p.x); if (p.y - d > 1.5) parts.push(tint(rod(new T.Vector3(p.x, d, z), p, big ? 0.12 : 0.07, 4), s.trim, 0.9)); }
      }
    }
    if (s.kind === "cable" || s.footbridges) {
      const pylonsAt = s.footbridges ? lay.supports.slice(1, -1) : lay.supports.filter((_, i) => i > 0 && i < lay.n && (lay.spans[i - 1] >= 400 || lay.spans[i] >= 400));
      for (const p of pylonsAt) {
        const top = s.footbridges ? lay.deckTop(p.x) + s.towers! : s.towers!, deck = lay.deckTop(p.x), mono = s.pylon === "mono", thick = s.footbridges ? 0.9 : mono ? 9 : 6;
        const zs = s.footbridges ? [-(half + 0.8), half + 0.8] : mono ? [0] : [-(half + 1.5), half + 1.5];
        if (s.footbridges) for (const z of zs) { parts.push(tint(rod(new T.Vector3(p.x, deck, z), new T.Vector3(p.x, top, z + Math.sign(z) * 4), 0.6, 8), 0xf2f2ef)); b.capsules.push({ a: new T.Vector3(p.x, deck, z), b: new T.Vector3(p.x, top, z + Math.sign(z) * 4), r: 0.6 }); }
        else { legs(p.x, top, thick, zs); if (!mono) { parts.push(tint(box(p.x - thick / 2, p.x + thick / 2, deck - s.deck - 4, deck - s.deck, -(half + 1.5), half + 1.5), s.colour, 1.0)); parts.push(tint(box(p.x - thick / 2, p.x + thick / 2, top * 0.74, top * 0.74 + 5, -(half + 1.5), half + 1.5), s.colour, 1.0)); } }
        // Stay fans on both sides of the pylon.
        const reach = s.footbridges ? 30 : Math.min(...[lay.spans[Math.max(0, lay.supports.indexOf(p) - 1)], lay.spans[Math.min(lay.n - 1, lay.supports.indexOf(p))]]) * 0.46, count = s.footbridges ? 4 : 13;
        for (const dir of [-1, 1]) for (let k = 1; k <= count; k++) for (const z of zs) {
          const xd = p.x + dir * (8 + ((reach - 8) * k) / count), anchor = new T.Vector3(p.x, deck + (top - deck) * (0.6 + 0.37 * (k / count)), z + (s.footbridges ? Math.sign(z) * 4 * 0.8 : 0)), foot = new T.Vector3(xd, lay.deckTop(xd) + 0.3, mono ? (k % 2 ? -1.2 : 1.2) : z * (s.footbridges ? 1 : 0.96));
          parts.push(tint(rod(anchor, foot, s.footbridges ? 0.08 : 0.28, 4), 0xf4f4f2)); b.capsules.push({ a: anchor, b: foot, r: s.footbridges ? 0.2 : 0.5 });
        }
      }
      if (s.footbridges) for (const side of [-1, 1]) {
        // Golden Jubilee footbridges either side of the rail truss.
        const z = side * (half - 2.4), pts: [number, number][] = []; for (let x = -L * 0.46; x <= L * 0.46; x += step) pts.push([x, lay.deckTop(x) + 0.6]); for (let x = L * 0.46; x >= -L * 0.46; x -= step) pts.push([x, lay.deckTop(x) - 0.6]);
        parts.push(tint(elevation(pts, [], 4.7, z), 0xe9e9e6)); parts.push(tint(elevation(pts.map(([x, y]) => [x, y + 1.6]), [], 0.15, z + side * 2.3), 0xcfd6da, 1));
      }
    }
    if (s.kind === "truss") for (const side of [-1, 1]) {
      const z = side * (deckWidth / 2 - 0.4), panel = 9;
      for (let i = 0; i < lay.n; i++) {
        const x0 = lay.supports[i].x, x1 = lay.supports[i + 1].x, count = Math.max(2, Math.round((x1 - x0) / panel)), depth = 5.5;
        for (let k = 0; k < count; k++) {
          const xa = x0 + ((x1 - x0) * k) / count, xb = x0 + ((x1 - x0) * (k + 1)) / count, ya = lay.deckTop(xa), yb = lay.deckTop(xb);
          parts.push(tint(rod(new T.Vector3(xa, ya + depth, z), new T.Vector3(xb, yb + depth, z), 0.3, 4), s.colour));
          parts.push(tint(rod(new T.Vector3(xa, ya, z), new T.Vector3(xa, ya + depth, z), 0.22, 4), s.colour));
          parts.push(tint(rod(new T.Vector3(xa, k % 2 ? ya : ya + depth, z), new T.Vector3(xb, k % 2 ? yb + depth : yb, z), 0.2, 4), s.colour));
          b.capsules.push({ a: new T.Vector3(xa, ya + depth, z), b: new T.Vector3(xb, yb + depth, z), r: 0.6 });
        }
      }
    }
    if (s.kind === "tower") this.towerBridge(b, lay, parts);
    if (s.kind === "cantilever") this.forthBridge(b, lay, parts);
    // ----- assemble
    const geo = mergeGeometries(parts.map((g) => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (k !== "position" && k !== "normal" && k !== "color") n.deleteAttribute(k); if (!n.getAttribute("normal")) n.computeVertexNormals(); return n; }), false);
    geo.computeVertexNormals(); geo.computeBoundingSphere();
    const group = new T.Group(), mesh = new T.Mesh(geo, this.material); group.add(mesh); group.scale.setScalar(0.001);
    if (lamps.length) { b.lamps = new T.Mesh(mergeGeometries(lamps.map((g) => g.toNonIndexed()), false), this.lampMaterial); group.add(b.lamps); }
    b.group = group; this.group.add(group);
  }
  private towerBridge(b: Bridge, lay: ReturnType<typeof layout>, parts: T.BufferGeometry[]) {
    const s = b.spec, half = b.width / 2, stone = s.colour, blue = s.trim, white = 0xf3f1ea;
    const towers = [lay.supports[1], lay.supports[2]];
    for (const t of towers) {
      const tx = 10.5, tz = half + 4, top = 52, roof = s.towers!;
      parts.push(tint(box(t.x - tx, t.x + tx, BELOW, top, -tz, tz), stone));
      b.boxes.push({ min: new T.Vector3(t.x - tx, BELOW, -tz), max: new T.Vector3(t.x + tx, roof, tz) });
      // Corner turrets with pointed caps, and the central pyramid roof.
      for (const dx of [-tx, tx]) for (const dz of [-tz, tz]) { parts.push(tint(new T.CylinderGeometry(2.4, 2.6, top + 6 - 14, 10).translate(t.x + dx, (top + 6 + 14) / 2, dz), stone, 1.05)); parts.push(tint(new T.ConeGeometry(2.8, 6.5, 10).translate(t.x + dx, top + 9.2, dz), 0x5d6670)); }
      parts.push(tint(new T.ConeGeometry(Math.min(tx, tz) * 1.05, roof - top, 4).rotateY(Math.PI / 4).translate(t.x, (roof + top) / 2, 0), 0x56606a));
      // Gothic window bands.
      for (const y of [22, 32, 42]) for (const side of [-1, 1]) parts.push(tint(box(t.x - tx * 0.7, t.x + tx * 0.7, y, y + 4.5, side * tz - 0.3, side * tz + 0.3), 0x3a3f46));
    }
    // High-level walkways, 42 m above high water.
    const yw = 42 + s.tide;
    for (const z of [-(half - 1.5), half - 1.5]) { parts.push(tint(box(towers[0].x + 10.5, towers[1].x - 10.5, yw, yw + 3.6, z - 1.8, z + 1.8), blue)); parts.push(tint(box(towers[0].x + 10.5, towers[1].x - 10.5, yw + 3.6, yw + 4.1, z - 2, z + 2), white)); b.boxes.push({ min: new T.Vector3(towers[0].x, yw, z - 2), max: new T.Vector3(towers[1].x, yw + 4.1, z + 2) }); }
    // Suspension chains over the side spans, from the towers to the shore towers.
    for (const [t, end] of [[towers[0], lay.supports[0]], [towers[1], lay.supports[3]]] as const) for (const z of [-(half + 0.3), half + 0.3]) {
      const pts: T.Vector3[] = []; for (let k = 0; k <= 20; k++) { const u = k / 20, x = t.x + (end.x - t.x) * u, y = 29 - 20 * Math.sin(Math.PI * Math.min(1, u * 1.05)) * 0.55 - (29 - 22) * u; pts.push(new T.Vector3(x, Math.max(lay.deckTop(x) + 1, y), z)); }
      for (let i = 1; i < pts.length; i++) { parts.push(tint(rod(pts[i - 1], pts[i], 0.9, 6), blue)); b.capsules.push({ a: pts[i - 1], b: pts[i], r: 0.9 }); }
      for (let i = 2; i < pts.length - 1; i += 2) { const d = lay.deckTop(pts[i].x); parts.push(tint(rod(new T.Vector3(pts[i].x, d, z), pts[i], 0.15, 4), blue)); }
      parts.push(tint(box(end.x - 5, end.x + 5, lay.deckTop(end.x), 24, z - 3, z + 3), stone));
    }
  }
  private forthBridge(b: Bridge, lay: ReturnType<typeof layout>, parts: T.BufferGeometry[]) {
    // Three double cantilevers (Fife, Inchgarvie, Queensferry) joined by 107 m suspended girders; approach viaducts at each end.
    const s = b.spec, red = s.colour, deckY = lay.deckTop(0) - s.deck, top = s.towers! + s.tide, base = 8, arm = 207, tower = 22, suspended = 107, gap = 2 * arm + 2 * tower + suspended;
    const centres = [-gap, 0, gap], tube = 1.85, web = 0.9;
    const member = (a: T.Vector3, c: T.Vector3, r: number) => { parts.push(tint(rod(a, c, r, 8), red)); b.capsules.push({ a, b: c, r }); };
    for (const c of centres) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const foot = new T.Vector3(c + sx * tower, base, sz * 37), head = new T.Vector3(c + sx * tower, top, sz * 10);
        member(foot, head, tube);
        parts.push(tint(new T.CylinderGeometry(9, 10, base - BELOW, 16).translate(foot.x, (base + BELOW) / 2, foot.z), 0x8a857c));
        // Bottom chord: the great curved compression tube, steep off the pier and flattening out to the arm tip; top
        // chord: straight tie from the tower head.
        const tip = new T.Vector3(c + sx * (tower + arm), deckY, sz * 10), tipTop = new T.Vector3(tip.x, deckY + 12, sz * 10);
        let prev = foot.clone(); const chord: T.Vector3[] = [foot.clone()];
        for (let k = 1; k <= 10; k++) { const u = k / 10, p = new T.Vector3(foot.x + (tip.x - foot.x) * u, base + (deckY - base) * (1 - Math.pow(1 - u, 1.8)), foot.z + (tip.z - foot.z) * u); member(prev, p, tube); chord.push(p); prev = p; }
        member(head, tipTop, tube * 0.8);
        // Web: verticals and diagonals between the chords.
        for (let k = 2; k <= 10; k += 2) { const lowP = chord[k], upP = head.clone().lerp(tipTop, (lowP.x - head.x) / (tipTop.x - head.x)); member(lowP, upP, web); if (k < 10) member(lowP, head.clone().lerp(tipTop, (chord[k + 2].x - head.x) / (tipTop.x - head.x)), web * 0.8); }
      }
      // Cross bracing between the four tower legs.
      for (const sx of [-1, 1]) for (const y of [30, 60, 90]) { const t = (y - base) / (top - base), zz = 37 + (10 - 37) * t; member(new T.Vector3(c + sx * tower, y, -zz), new T.Vector3(c + sx * tower, y, zz), web); }
      for (const sz of [-1, 1]) for (const y of [40, 80]) { const t = (y - base) / (top - base), zz = sz * (37 + (10 - 37) * t); member(new T.Vector3(c - tower, y, zz), new T.Vector3(c + tower, y, zz), web); }
    }
    // Navigation openings: under the suspended girders and the arms between the cantilevers.
    for (const [i, x0, x1] of [[0, centres[0] + tower, centres[1] - tower], [1, centres[1] + tower, centres[2] - tower]] as const) {
      const mid = (x0 + x1) / 2, halfw = (x1 - x0) / 2;
      b.openings.push({ x0: x0 + 8, x1: x1 - 8, index: i, top: (x) => { const u = Math.abs(x - mid) / halfw; const fromTip = Math.max(0, (u * halfw - suspended / 2) / arm); return fromTip <= 0 ? deckY - 0.5 : Math.max(0, base + (deckY - base) * (1 - Math.pow(fromTip, 1.8)) - 3); } });
    }
    // Approach viaduct piers.
    const end = centres[2] + tower + arm;
    for (const side of [-1, 1]) for (let x = end + 30; x < b.length / 2 - 10; x += 51) { const px = side * x; parts.push(tint(box(px - 4, px + 4, BELOW, deckY, -6, 6), 0x8a857c)); b.boxes.push({ min: new T.Vector3(px - 4, BELOW, -6), max: new T.Vector3(px + 4, deckY, 6) }); }
  }
  /** Local metres of a body-frame point (km). */
  local(b: Bridge, p: T.Vector3) { const d = p.clone().sub(b.centre.clone().multiplyScalar(R)); return new T.Vector3(d.dot(b.X) * 1000, (p.length() - R) * 1000 - b.water, d.dot(b.Z) * 1000); }
  private insideBody(b: Bridge, x: number, y: number) {
    const ring = (r: [number, number][]) => { let hit = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [ax, ay] = r[i], [bx, by] = r[j]; if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) hit = !hit; } return hit; };
    return ring(b.outline) && !b.holes.some(ring);
  }
  /** Collision and fly-under detection between two body-frame positions (km). */
  check(prev: T.Vector3, cur: T.Vector3): BridgeEvent[] {
    const out: BridgeEvent[] = [];
    for (const b of this.list) {
      if (!b.group) continue;
      const p = this.local(b, cur); if (Math.abs(p.z) > 600 || Math.abs(p.x) > b.length / 2 + 50) continue;
      const q = this.local(b, prev), A = AIRFRAME;
      // The drawn airframe, wings level and crossing square to the bridge: belly, fin, mid-wings and both winglets.
      const pts = [[0, 0], [0, -A.belly], [0, A.fin], [-8, -0.8], [8, -0.8], [-A.tip, A.tipLow], [A.tip, A.tipLow], [-A.tip, A.tipHigh], [A.tip, A.tipHigh]].map(([dx, dy]) => new T.Vector3(p.x + dx, p.y + dy, p.z));
      const across = Math.abs(p.z) < b.width / 2 + 4;
      if (across && pts.some((v) => this.insideBody(b, v.x, v.y))) { out.push({ type: "hit", bridge: b }); continue; }
      if (b.boxes.some((k) => pts.some((v) => v.x > k.min.x - 1 && v.x < k.max.x + 1 && v.y > k.min.y - 1 && v.y < k.max.y + 1 && v.z > k.min.z - 3 && v.z < k.max.z + 3))) { out.push({ type: "hit", bridge: b }); continue; }
      if (b.capsules.some((c) => { const ab = c.b.clone().sub(c.a); return pts.some((v) => { const t = Math.max(0, Math.min(1, v.clone().sub(c.a).dot(ab) / ab.lengthSq())); return c.a.clone().addScaledVector(ab, t).distanceTo(v) < c.r + 1.5; }); })) { out.push({ type: "hit", bridge: b }); continue; }
      // Under: crossed the centre plane inside an opening, below its arch.
      if (q.z * p.z < 0) { const t = q.z / (q.z - p.z), x = q.x + (p.x - q.x) * t, y = q.y + (p.y - q.y) * t; const o = b.openings.find((o) => x > o.x0 + 2 && x < o.x1 - 2 && y > 0.3 && y < o.top(x) - 0.8); if (o) out.push({ type: "under", bridge: b, opening: o.index, clearance: o.top(x) - y - AIRFRAME.fin }); }
    }
    return out;
  }
  /** A start point `distance` m out from the bridge on the given side, in the middle of the free band under the main opening (the jet spans 1.5 m below its centre to 4.5 m above), flying at it. */
  startFor(id: string, side = 1, distance = 600) {
    const b = this.list.find((x) => x.spec.id === id); if (!b) return null;
    if (!b.group) this.build(b);
    const o = b.openings.find((x) => x.index === b.spec.main) ?? b.openings[0], x = o ? (o.x0 + o.x1) / 2 : 0, top = o ? o.top(x) : 20;
    // The free band: belly clear of the water below, fin under the crown and winglets under the arch at ±15 m above,
    // each with about a metre for the height hold to wander. Middle of it, or as good as it gets if it is empty.
    const lo = AIRFRAME.belly + 1.2, hi = o ? Math.min(top - AIRFRAME.fin, o.top(x - AIRFRAME.tip) - AIRFRAME.tipHigh, o.top(x + AIRFRAME.tip) - AIRFRAME.tipHigh) - 0.8 : 30;
    const y = Math.max(lo, Math.min((lo + hi) / 2, 30));
    // Prefer the requested side and distance, but only over open water with no other bridge in the way: the river
    // bends, and some bridges (Blackfriars) have a neighbour 30 m away whose piers do not line up.
    for (const o of this.list) if (!o.group && o.centre.distanceTo(b.centre) * R < 3) this.build(o);
    const at = (z: number) => b.centre.clone().multiplyScalar(R).addScaledVector(b.X, x / 1000).addScaledVector(b.Z, z / 1000).normalize();
    const clear = (s: number, d: number, strict: boolean) => {
      for (let z = d; z > 25; z -= 10) {
        for (const w of [-AIRFRAME.tip - 4, -8, 0, 8, AIRFRAME.tip + 4]) { const q = at(s * z).multiplyScalar(R).addScaledVector(b.X, w / 1000).normalize(), l = dirToLatLon(q.toArray() as V); if (this.terrain.height(l.lat, l.lon) > b.water + 1.5) return false; }
        const h = R + (b.water + y) / 1000;
        if (this.check(at(s * z).multiplyScalar(h), at(s * (z - 10)).multiplyScalar(h)).some((e) => e.type === "hit" || (strict && e.bridge !== b))) return false;
      }
      return true;
    };
    let chosen: [number, number] | null = null;
    // First an approach that passes no other bridge, then one that at least hits none.
    for (const strict of [true, false]) for (const s of [side, -side]) { for (let d = distance; d >= 250 && !chosen; d -= 50) if (clear(s, d, strict)) chosen = [s, d]; if (chosen) break; }
    [side, distance] = chosen ?? [side, Math.min(distance, 300)];
    const pos = b.centre.clone().multiplyScalar(R).addScaledVector(b.X, x / 1000).addScaledVector(b.Z, (side * distance) / 1000);
    const up = pos.clone().normalize(), ll = dirToLatLon(up.toArray() as V), east = new T.Vector3(0, 1, 0).cross(up).normalize(), north = up.clone().cross(east), dir = b.Z.clone().multiplyScalar(-side);
    const heading = ((Math.atan2(dir.dot(east), dir.dot(north)) * 180) / Math.PI + 360) % 360;
    return { lat: ll.lat, lon: ll.lon, alt: b.water + y, heading, gate: { x, y: top } };
  }
  /** Which way is downstream-east for a bridge: +1 if its +Z side lies further east. */
  eastSide(id: string) { const b = this.list.find((x) => x.spec.id === id)!, up = b.centre, east = new T.Vector3(0, 1, 0).cross(up).normalize(); return b.Z.dot(east) >= 0 ? 1 : -1; }
  /** True inside any bridge's footprint, so building layers do not extrude the same structure twice. */
  covers(lat: number, lon: number) {
    if (!this.ready) return false; const p = new T.Vector3(...latLonToDir(lat, lon));
    return this.list.some((b) => { const d = p.clone().multiplyScalar(R).sub(b.centre.clone().multiplyScalar(R)); return Math.abs(d.dot(b.X) * 1000) < b.length / 2 && Math.abs(d.dot(b.Z) * 1000) < b.width / 2 + 3; });
  }
  /** Shows a glowing frame in the opening of the next gate, or hides it. */
  showGate(id: string | null) {
    if (this.gate) { this.gate.parent?.remove(this.gate); this.gate.geometry.dispose(); this.gate = null; }
    const b = id ? this.list.find((x) => x.spec.id === id) : null; if (!b?.group) return;
    const o = b.openings.find((x) => x.index === b.spec.main) ?? b.openings[0]; if (!o) return;
    const pts: T.Vector3[] = [], k = 32; for (let j = 0; j <= k; j++) { const x = o.x0 + 2 + ((o.x1 - o.x0 - 4) * j) / k; pts.push(new T.Vector3(x, o.top(x) - 0.8, 0)); } pts.push(new T.Vector3(o.x1 - 2, 0.4, 0), new T.Vector3(o.x0 + 2, 0.4, 0), pts[0].clone());
    const g = mergeGeometries(pts.slice(1).map((p, i) => rod(pts[i], p, 0.35, 5).toNonIndexed()), false); this.gate = new T.Mesh(g, this.gateMaterial); b.group.add(this.gate);
  }
  update(position: V, time: number) {
    if (!this.ready) return;
    const ship = new T.Vector3(...position), spin = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), (time / EARTH.rotation) * Math.PI * 2), body = ship.clone().applyQuaternion(spin.clone().invert()).normalize();
    this.lampMaterial.emissiveIntensity = this.night * 6; this.gateMaterial.opacity = 0.55 + 0.35 * Math.sin(time * 5);
    for (const b of this.list) {
      const near = b.centre.angleTo(body) * R < 30;
      if (near && !b.group && this.terrain.revision > 0) this.build(b);
      // A bridge built on coarse ground (the 0.5° global grid reads 75 m around the Severn) re-levels when finer tiles land.
      if (b.group && near && b.revision !== this.terrain.revision) { b.revision = this.terrain.revision; if (Math.abs(this.waterAt(b) - b.water) > 0.5) { this.unbuild(b); this.build(b); } }
      if (!b.group) continue; b.group.visible = near; if (!near) continue;
      const basis = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(b.X, b.Y, b.Z));
      b.group.quaternion.copy(spin).multiply(basis);
      b.group.position.set(...bodyToInertial(b.centre.clone().multiplyScalar(R + b.water / 1000).toArray() as V, time, EARTH.rotation)).sub(ship);
    }
  }
}
