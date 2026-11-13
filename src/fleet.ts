import * as T from "three";
import { bodyToInertial, latLonToDir } from "./geo";
import { EARTH } from "./earth";
import { airVelocity } from "./combat-ai";
import { lineOfSight, type RadarContact } from "./contacts";
import { buildAircraft, type AircraftType } from "./aircraft-models";
import type { Combat, Drone } from "./combat";
import type { V } from "./vector";

const R = EARTH.radius;
/**
 * Fictional carrier strike groups, game values only. A hostile group is a no-go area: its escorts launch a missile
 * every couple of seconds at anything they can track inside 45 km, and guns take over inside 3 km. Two things beat
 * the radar, as in the stories: skimming the sea below 8 m, or arriving faster than about Mach 3.
 */
export const FLEET = { detect: 90, engage: 45, guns: 3, floor: 8, fast: 1.05, lockTime: 2, reload: 6, salvo: 8, damage: 40, deck: 32, deckLength: 224, deckWidth: 48 };
/** Ships are drawn 1.6 times life size, like every other aircraft in the game, so they read from the cockpit. */
const SCALE = 1.6;
export interface GroupSpec { id: string; name: string; side: "hostile" | "friendly"; lat: number; lon: number; heading: number }
/** Stations in open water around Britain; each group holds within about 15 km of its station, chosen afresh every session. */
const STATIONS: GroupSpec[] = [
  { id: "red-channel", name: "RED FLEET · ADMIRAL KUZNETSOV", side: "hostile", lat: 50.2, lon: 0.3, heading: 250 },
  { id: "blue-lyme", name: "HMS QUEEN ELIZABETH", side: "friendly", lat: 50.35, lon: -2.75, heading: 80 },
  { id: "red-north", name: "RED FLEET · PYOTR VELIKIY", side: "hostile", lat: 53.4, lon: 2.6, heading: 200 },
  { id: "blue-west", name: "HMS PRINCE OF WALES", side: "friendly", lat: 49.6, lon: -5.6, heading: 35 },
];
type Kind = "carrier" | "destroyer" | "support" | "submarine";
const SHIPS: Record<Kind, { label: string; hp: number; score: number; half: [number, number, number]; armed: boolean }> = {
  carrier: { label: "AIRCRAFT CARRIER", hp: 45, score: 5000, half: [38, 22, 150], armed: true },
  destroyer: { label: "DESTROYER", hp: 15, score: 1500, half: [10, 16, 78], armed: true },
  support: { label: "SUPPORT SHIP", hp: 12, score: 800, half: [13, 14, 95], armed: false },
  submarine: { label: "SUBMARINE", hp: 9, score: 1200, half: [6, 7, 55], armed: true },
};
/** Formation in metres: right of track, ahead of the carrier. */
const FORMATION: [Kind, number, number][] = [["carrier", 0, 0], ["destroyer", -1400, 1600], ["destroyer", 1500, 1300], ["destroyer", 300, -2100], ["support", -900, -1500], ["submarine", 1100, 2900]];

const paint = (c: number, rough = 0.7) => new T.MeshStandardMaterial({ color: c, roughness: rough, metalness: 0.25 });
/** A pointed hull from the waterline up; metres, bow toward -Z. */
function hull(length: number, beam: number, height: number, m: T.Material, bow = 0.22) {
  const L = length / 2, B = beam / 2, s = new T.Shape([[0, -L], [B * 0.7, -L + length * bow * 0.5], [B, -L + length * bow], [B, L * 0.9], [B * 0.8, L], [-B * 0.8, L], [-B, L * 0.9], [-B, -L + length * bow], [-B * 0.7, -L + length * bow * 0.5]].map(([x, z]) => new T.Vector2(x, -z)));
  const g = new T.ExtrudeGeometry(s, { depth: height + 3, bevelEnabled: false }); g.rotateX(-Math.PI / 2); g.translate(0, -3, 0);
  return new T.Mesh(g, m);
}
function vessel(kind: Kind, side: GroupSpec["side"], jet: AircraftType) {
  const g = new T.Group(), grey = paint(side === "hostile" ? 0x4b5158 : 0x8c949c), dark = paint(side === "hostile" ? 0x30353b : 0x5d656d), deck = paint(side === "hostile" ? 0x2b2e31 : 0x3b4045, 0.9), flag = paint(side === "hostile" ? 0xb3202a : 0x1f5fbf), white = paint(0xe8eaec);
  const box = (w: number, h: number, l: number, m: T.Material, x: number, y: number, z: number) => { const b = new T.Mesh(new T.BoxGeometry(w, h, l), m); b.position.set(x, y, z); g.add(b); return b; };
  if (kind === "carrier") {
    g.add(hull(300, 44, 17, grey, 0.16));
    // Flight deck with the angled landing strip overhanging to port, island to starboard.
    const plan = new T.Shape([[-22, -150], [22, -150], [36, -60], [36, 60], [24, 150], [-24, 150], [-38, 70], [-38, -40]].map(([x, z]) => new T.Vector2(x, -z))), top = new T.ExtrudeGeometry(plan, { depth: 3, bevelEnabled: false }); top.rotateX(-Math.PI / 2); top.translate(0, 17, 0); g.add(new T.Mesh(top, deck));
    box(1.2, 0.15, 270, white, 0, 20.05, 0); box(0.8, 0.15, 180, white, -14, 20.05, 40).rotation.y = 0.14; box(8, 0.15, 40, flag, 0, 20.06, -120);
    for (const z of [60, 75, 90]) box(40, 0.15, 0.8, white, -8, 20.05, z);
    box(12, 22, 40, grey, 28, 31, 10); box(9, 8, 22, dark, 28, 46, 8); box(2, 26, 2, dark, 28, 60, 4); box(16, 1.2, 5, dark, 28, 64, 4); box(4, 14, 4, dark, 28, 49, 24);
    // Parked aircraft along the starboard edge.
    for (let i = 0; i < 6; i++) { const p = new T.Group(); p.add(buildAircraft(jet)); p.scale.setScalar(1000); p.position.set(26 - (i % 2) * 3, 20.9, -110 + i * 17); p.rotation.y = 0.9; g.add(p); }
  } else if (kind === "destroyer" || kind === "support") {
    const tanker = kind === "support", L = tanker ? 190 : 156, beam = tanker ? 26 : 19;
    g.add(hull(L, beam, tanker ? 11 : 9, grey));
    box(beam * 0.7, tanker ? 12 : 9, L * 0.26, grey, 0, tanker ? 17 : 13.5, tanker ? L * 0.3 : -L * 0.08); box(beam * 0.5, 7, L * 0.12, dark, 0, tanker ? 26 : 21, tanker ? L * 0.3 : -L * 0.1);
    box(1.6, 18, 1.6, dark, 0, 32, tanker ? L * 0.3 : -L * 0.1); box(9, 1, 3, dark, 0, 38, tanker ? L * 0.3 : -L * 0.1);
    if (tanker) { for (const z of [-50, -15, 20]) { box(2, 22, 2, dark, 0, 22, z); box(18, 1.2, 1.2, dark, 0, 31, z); } box(beam * 0.9, 0.3, L * 0.2, flag, 0, 11.2, -L * 0.3); }
    else { const gun = box(5, 3.5, 6, dark, 0, 10.8, -L * 0.33); gun.name = "gun"; const barrel = new T.Mesh(new T.CylinderGeometry(0.35, 0.35, 9, 8), dark); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 11.5, -L * 0.33 - 6); g.add(barrel); box(10, 1.5, 16, dark, 0, 9.8, -L * 0.2); box(beam * 0.75, 6, L * 0.14, grey, 0, 12, L * 0.2); box(beam, 0.3, 26, deck, 0, 9.2, L * 0.38); box(3, 0.3, 26, flag, 0, 9.25, L * 0.38); }
  } else {
    const body = new T.Mesh(new T.CapsuleGeometry(5.5, 100, 8, 16), dark); body.rotation.x = Math.PI / 2; body.position.y = -1.2; g.add(body);
    box(4.5, 9, 16, dark, 0, 8, -12); box(14, 0.6, 4, dark, 0, 9.5, -14); box(0.5, 7, 0.5, dark, 0, 15, -10); box(1, 7, 9, dark, 0, 5, 50);
  }
  g.scale.setScalar(0.001 * SCALE);
  return g;
}

interface Ship { kind: Kind; dir: T.Vector3; drone: Drone; model: T.Group; alive: boolean; sink: number; gun: number; burst: number }
interface Jet { model: T.Group; phase: number }
export interface Group { spec: GroupSpec; ships: Ship[]; centre: T.Vector3; east: T.Vector3; north: T.Vector3; forward: T.Vector3; p: T.Vector3; lock: number; reload: number; jets: Jet[]; distance: number }

/** Carrier circuit in deck metres [right, up, ahead] at `t` seconds into the 146 s loop: catapult, climb, downwind, final, trap. */
function circuit(t: number): [number, number, number] {
  const speed = 90, r = 600, top = 140 + speed * 20, down = (top + 1800) / speed, arc = (Math.PI * r) / speed;
  if (t < 6) return [0, 21.6, -60 + 200 * (t / 6) ** 2];
  t -= 6; if (t < 20) return [0, 21.6 + t * 14, 140 + speed * t];
  t -= 20; if (t < arc) { const a = (t / arc) * Math.PI; return [-r + r * Math.cos(a), 301.6, top + r * Math.sin(a)]; }
  t -= arc; if (t < down) return [-2 * r, 301.6, top - speed * t];
  t -= down; if (t < arc) { const a = (t / arc) * Math.PI; return [-r - r * Math.cos(a), 301.6 - 180 * (t / arc), -1800 - r * Math.sin(a)]; }
  t -= arc; if (t < 24) { const k = t / 24; return [0, 121.6 - 100 * k, -1800 + 1700 * k]; }
  t -= 24; if (t < 3) { const k = t / 3; return [0, 21.6, -100 + 80 * (2 * k - k * k)]; }
  return [0, 21.6, -20];
}
const CIRCUIT = 146;

export class Fleets {
  group = new T.Group(); groups: Group[] = []; private serial = 950000; private seed = 91177;
  private rand = () => { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; };
  constructor() {
    this.group.name = "Carrier groups";
    for (const station of STATIONS) {
      const spec = { ...station, lat: station.lat + (Math.random() - 0.5) * 0.2, lon: station.lon + (Math.random() - 0.5) * 0.3, heading: station.heading + (Math.random() - 0.5) * 60 };
      const centre = new T.Vector3(...latLonToDir(spec.lat, spec.lon)), east = new T.Vector3(0, 1, 0).cross(centre).normalize(), north = centre.clone().cross(east), h = (spec.heading * Math.PI) / 180;
      const forward = north.clone().multiplyScalar(Math.cos(h)).addScaledVector(east, Math.sin(h)), right = forward.clone().cross(centre), jet: AircraftType = spec.side === "hostile" ? "su27" : "f35";
      const group: Group = { spec, ships: [], centre, east, north, forward, p: new T.Vector3(), lock: 0, reload: 3, jets: [], distance: 1e9 };
      for (const [kind, x, z] of FORMATION) {
        const info = SHIPS[kind], dir = centre.clone().addScaledVector(right, x / 1000 / R).addScaledVector(forward, z / 1000 / R).normalize(), model = vessel(kind, spec.side, jet);
        const ship: Ship = { kind, dir, model, alive: true, sink: 0, gun: 0, burst: 0,
          drone: { id: ++this.serial, ground: true, external: true, name: `${spec.side === "hostile" ? "HOSTILE" : "FRIENDLY"} ${info.label}`, radius: (info.half[2] * SCALE) / 1000, score: info.score, p: new T.Vector3(), v: new T.Vector3(), hp: info.hp, maxHp: info.hp, phase: 0,
            collisionBox: { right: new T.Vector3(), up: new T.Vector3(), forward: new T.Vector3(), half: new T.Vector3(info.half[0], info.half[1], info.half[2]).multiplyScalar(0.001 * SCALE) } } };
        ship.drone.destroy = () => { ship.alive = false; };
        group.ships.push(ship); this.group.add(model);
      }
      for (let i = 0; i < 3; i++) { const model = new T.Group(); model.add(buildAircraft(jet)); model.scale.setScalar(1.6); this.group.add(model); group.jets.push({ model, phase: (i * CIRCUIT) / 3 }); }
      this.groups.push(group);
    }
  }
  /** Hostile ships still afloat, as targets for the player's weapons. */
  get targets() { return this.groups.flatMap((g) => (g.spec.side === "hostile" ? g.ships.filter((s) => s.alive).map((s) => s.drone) : [])); }
  /** Flight decks as terrain: a carrier that is afloat can be landed on. */
  decks() { return this.groups.filter((g) => g.ships[0].alive).map((g) => ({ lat: g.spec.lat, lon: g.spec.lon, heading: g.spec.heading, halfLength: FLEET.deckLength, halfWidth: FLEET.deckWidth, height: FLEET.deck })); }
  get contacts(): RadarContact[] { return this.groups.flatMap((g) => g.distance > 250 ? [] : g.ships.filter((s) => s.alive).map((s) => ({ id: "ship-" + s.drone.id, name: s.drone.name!, kind: "ground" as const, p: s.drone.p, v: s.drone.v, detail: g.spec.name + (g.spec.side === "hostile" ? ` · engages inside ${FLEET.engage} km` : " · cleared to land"), targetId: g.spec.side === "hostile" ? s.drone.id : undefined }))); }
  locks() { return this.groups.filter((g) => g.lock > 0.3).map((g) => ({ p: g.p, name: "CARRIER GROUP", ground: true })); }
  /** A nuclear burst sinks everything inside `radius` km of `centre`. Returns how many ships went down. */
  nuked(centre: T.Vector3, radius: number) {
    let sunk = 0;
    for (const g of this.groups) for (const s of g.ships) if (s.alive && s.drone.p.distanceTo(centre) < radius) { s.alive = false; s.drone.hp = 0; sunk++; }
    return sunk;
  }
  update(dt: number, time: number, ship: T.Vector3, shipV: T.Vector3, altitude: number, flying: boolean, combat: Combat) {
    const spin = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), (time / EARTH.rotation) * Math.PI * 2);
    const place = (dir: T.Vector3, h = 0) => new T.Vector3(...bodyToInertial(dir.clone().multiplyScalar(R + h / 1000).toArray() as V, time, EARTH.rotation));
    for (const g of this.groups) {
      g.p.copy(place(g.centre)); g.distance = g.p.distanceTo(ship);
      const near = g.distance < 120;
      for (const s of g.ships) s.model.visible = near && s.sink < 60;
      for (const j of g.jets) j.model.visible = near && g.ships[0].alive;
      if (!near) { g.lock = 0; for (const s of g.ships) s.drone.p.copy(g.p); continue; }
      const up = g.p.clone().normalize(), forward = g.forward.clone().applyQuaternion(spin), right = forward.clone().cross(up), attitude = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(right, up, forward.clone().negate()));
      for (const s of g.ships) {
        if (!s.alive) s.sink = Math.min(60, s.sink + dt * 2.2);
        const p = place(s.dir, -s.sink * 0.6); s.drone.p.copy(p); s.drone.v.copy(airVelocity(p));
        const box = s.drone.collisionBox!; box.right.copy(right); box.up.copy(up); box.forward.copy(forward);
        s.model.position.copy(p).sub(ship); s.model.quaternion.copy(attitude);
        // A stricken ship lists and settles by the stern.
        if (s.sink > 0) s.model.quaternion.multiply(new T.Quaternion().setFromEuler(new T.Euler(Math.min(0.35, s.sink * 0.012), 0, Math.min(0.5, s.sink * 0.02))));
      }
      // Air operations: three jets fly the launch and recovery circuit, spaced a third of a lap apart.
      if (g.ships[0].alive) for (const j of g.jets) {
        const t = (time + j.phase) % CIRCUIT, a = circuit(t), b = circuit(Math.min(CIRCUIT, t + 0.2)), at = (c: [number, number, number]) => g.p.clone().addScaledVector(right, (c[0] * SCALE) / 1000).addScaledVector(up, (c[1] * SCALE) / 1000).addScaledVector(forward, (c[2] * SCALE) / 1000);
        const here = at(a), ahead = at(b).sub(here); j.model.position.copy(here).sub(ship);
        const f = ahead.lengthSq() > 1e-12 ? ahead.normalize() : forward, r = f.clone().cross(up).normalize(), bank = a[0] !== 0 && Math.abs(a[0] + 1200) > 1 && a[1] > 100 ? -0.6 : 0;
        j.model.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(r, r.clone().cross(f), f.clone().negate())).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), bank));
      }
      if (g.spec.side !== "hostile") continue;
      const armed = g.ships.filter((s) => s.alive && SHIPS[s.kind].armed);
      const air = shipV.clone().sub(airVelocity(ship)).length();
      const tracking = flying && armed.length > 0 && combat.active && combat.allowEngage && !combat.completed && g.distance < FLEET.engage && altitude > FLEET.floor && air < FLEET.fast && lineOfSight(g.p.clone().addScaledVector(up, 0.04), ship);
      g.lock = tracking ? g.lock + dt : Math.max(0, g.lock - dt * 2); g.reload = Math.max(0, g.reload - dt);
      const aloft = combat.incoming.filter((m) => m.name === "NAVAL SAM").length;
      if (tracking && g.lock > FLEET.lockTime && g.reload === 0 && aloft < FLEET.salvo) {
        const from = armed[Math.floor(this.rand() * armed.length)].drone.p, launch = up.clone().multiplyScalar(0.9).add(ship.clone().sub(from).normalize()).normalize();
        combat.incoming.push({ p: from.clone().addScaledVector(up, 0.03), v: airVelocity(from).addScaledVector(launch, 0.3), age: 0, life: 50, weapon: "missile", damage: FLEET.damage, turn: 0.55, accel: 0.6, maxSpeed: 1.7, owner: armed[0].drone.id, name: "NAVAL SAM" });
        g.reload = FLEET.reload / armed.length; combat.event?.("enemyGun", from);
      }
      // Close-in guns: each armed ship walks bursts onto anything above the wave tops inside 3 km.
      if (flying && combat.active && !combat.completed && altitude > FLEET.floor) for (const s of armed) {
        const toPlayer = ship.clone().sub(s.drone.p), d = toPlayer.length(); s.gun = Math.max(0, s.gun - dt);
        if (d > FLEET.guns || s.gun > 0) continue;
        if (!s.burst) s.burst = 8; s.burst--; s.gun = s.burst ? 0.07 : 0.9 + this.rand() * 0.6;
        const aim = toPlayer.addScaledVector(shipV.clone().sub(s.drone.v), d / 1.3).normalize().add(new T.Vector3(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).multiplyScalar(0.035)).normalize();
        combat.incoming.push({ p: s.drone.p.clone().addScaledVector(up, 0.025), v: s.drone.v.clone().addScaledVector(aim, 1.3), life: 3, age: 0, weapon: "gun", damage: 5, owner: s.drone.id }); combat.event?.("enemyGun", s.drone.p);
      }
    }
  }
}
