import * as T from "three";
import { bodyToInertial, latLonToDir } from "./geo";
import { EARTH } from "./earth";
import { airVelocity } from "./combat-ai";
import { buildAircraft } from "./aircraft-models";
import type { RadarContact } from "./contacts";
import type { Combat, Drone } from "./combat";
import type { V } from "./vector";

const R = EARTH.radius;
/**
 * A fictional bomber raid, game values only: three Tu-160 "White Swans" and three Tu-95 "Bears" at the Bear's cruise
 * speed, with six Su-27 escorts, flying
 * in from the north-east to release one nuclear bomb over London. A new raid sets out every `period` seconds, so
 * there is always one somewhere on the route to go and find.
 */
export const RAID = { period: 1800, start: 360, bearing: 62, speed: 0.24, altitude: 11, release: 12, scramble: 30, hp: 12, target: { lat: 51.507, lon: -0.128 } };
/** Every other aircraft in the sky is drawn 3.2 times life size so it reads at combat range; the bombers match. */
const LIFE = 0.001 * 3.2;
export type BomberType = "tu160" | "tu95";
export const BOMBER: Record<BomberType, { name: string; radius: number }> = { tu160: { name: "Tu-160 WHITE SWAN", radius: 0.09 }, tu95: { name: "Tu-95 BEAR", radius: 0.08 } };
const WHITE = 0xf1f3f5;
/** Tu-160: long white fuselage, blended glove, swept outer wings, four engines in two under-wing pods. Kilometres, nose toward -Z. */
function swan() {
  const g = new T.Group(), skin = new T.MeshStandardMaterial({ color: WHITE, roughness: 0.35, metalness: 0.3 }), grey = new T.MeshStandardMaterial({ color: 0x8a9097, roughness: 0.5, metalness: 0.4 }), glass = new T.MeshStandardMaterial({ color: 0x1a2430, roughness: 0.2, metalness: 0.6 });
  const body = new T.Mesh(new T.CapsuleGeometry(1.7, 46, 8, 16), skin); body.rotation.x = Math.PI / 2; g.add(body);
  const nose = new T.Mesh(new T.ConeGeometry(1.7, 9, 16), skin); nose.rotation.x = -Math.PI / 2; nose.position.z = -28.5; g.add(nose);
  const canopy = new T.Mesh(new T.SphereGeometry(1.25, 12, 8), glass); canopy.scale.set(0.9, 0.6, 2.2); canopy.position.set(0, 1.2, -19); g.add(canopy);
  const slab = (plan: [number, number][], thickness: number, y: number) => { for (const side of [1, -1]) { const s = new T.Shape(plan.map(([x, z]) => new T.Vector2(x * side, -z))), e = new T.ExtrudeGeometry(s, { depth: thickness, bevelEnabled: false }); e.rotateX(-Math.PI / 2); e.translate(0, y, 0); const m = new T.Mesh(e, skin); m.material = skin.clone(); (m.material as T.MeshStandardMaterial).side = T.DoubleSide; g.add(m); } };
  slab([[1.2, -16], [7, -2], [7, 9], [1.2, 12]], 0.9, -0.6);
  slab([[7, -2], [26, 12], [26, 15.5], [7, 9]], 0.5, -0.3);
  slab([[0.6, 19.5], [6.6, 24.5], [6.6, 26.5], [0.6, 25.5]], 0.35, 4.6);
  const fin = new T.Shape([[13.5, 0], [23, 11.5], [26.5, 11.5], [26.5, 0]].map(([z, y]) => new T.Vector2(z, y))), finGeometry = new T.ExtrudeGeometry(fin, { depth: 0.5, bevelEnabled: false }); finGeometry.rotateY(-Math.PI / 2); finGeometry.translate(0.25, 1.2, 0); g.add(new T.Mesh(finGeometry, skin));
  for (const side of [1, -1]) { const pod = new T.Mesh(new T.BoxGeometry(4.6, 2.2, 15), grey); pod.position.set(side * 4.6, -1.9, 5); g.add(pod);
    for (const x of [-1.1, 1.1]) { const glow = new T.Mesh(new T.CircleGeometry(0.95, 14), new T.MeshBasicMaterial({ color: new T.Color(9, 4.5, 1.6), toneMapped: false })); glow.position.set(side * 4.6 + x, -1.9, 12.55); g.add(glow); } }
  // The model is 60.5 units nose to tail; the real aircraft is 54.1 m.
  g.scale.setScalar(LIFE * 54.1 / 60.5);
  return g;
}
/**
 * Tu-95MS "Bear": 46.2 m long, 50 m span, 35 degree swept wing, four NK-12 turboprops each driving two contra-rotating
 * four-blade propellers 5.6 m across. Metres, nose toward -Z. Returns the model and its propeller hubs for spinning.
 */
function bear() {
  const g = new T.Group(), metal = new T.MeshStandardMaterial({ color: 0xc4c9ce, roughness: 0.42, metalness: 0.55, side: T.DoubleSide }), dark = new T.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.6, metalness: 0.3 }), glass = new T.MeshStandardMaterial({ color: 0x1a2430, roughness: 0.2, metalness: 0.6 });
  const body = new T.Mesh(new T.CylinderGeometry(1.45, 1.45, 36, 18), metal); body.rotation.x = Math.PI / 2; body.position.z = -1; g.add(body);
  const nose = new T.Mesh(new T.SphereGeometry(1.45, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), metal); nose.scale.set(1, 3.2, 1); nose.rotation.x = -Math.PI / 2; nose.position.z = -19; g.add(nose);
  const tail = new T.Mesh(new T.ConeGeometry(1.45, 7, 18), metal); tail.rotation.x = Math.PI / 2; tail.position.set(0, 0.25, 20.5); g.add(tail);
  const turret = new T.Mesh(new T.SphereGeometry(0.75, 10, 8), glass); turret.position.set(0, 0.3, 23.6); g.add(turret);
  const cockpit = new T.Mesh(new T.SphereGeometry(1.05, 12, 8), glass); cockpit.scale.set(1, 0.55, 2.1); cockpit.position.set(0, 1.25, -16.5); g.add(cockpit);
  const probe = new T.Mesh(new T.CylinderGeometry(0.12, 0.12, 4, 6), dark); probe.rotation.x = Math.PI / 2; probe.position.set(0, 1.1, -24.5); g.add(probe);
  const slab = (plan: [number, number][], thickness: number, y: number, mat = metal) => { for (const side of [1, -1]) { const e = new T.ExtrudeGeometry(new T.Shape(plan.map(([x, z]) => new T.Vector2(x * side, -z))), { depth: thickness, bevelEnabled: false }); e.rotateX(-Math.PI / 2); e.translate(0, y, 0); g.add(new T.Mesh(e, mat)); } };
  // Wing: root chord 7.5 m, tip chord 3 m, leading edge swept 35 degrees, mounted mid-fuselage.
  slab([[1.2, -4.5], [25, 12.2], [25, 15.2], [1.2, 3]], 0.45, -0.4);
  slab([[0.8, 15.5], [7.4, 20.6], [7.4, 22.4], [0.8, 20.5]], 0.3, 0.6);
  const fin = new T.ExtrudeGeometry(new T.Shape([[13.5, 0], [21.5, 8.6], [24, 8.6], [23, 0]].map(([z, y]) => new T.Vector2(z, y))), { depth: 0.4, bevelEnabled: false });
  fin.rotateY(-Math.PI / 2); fin.translate(0.2, 1.1, 0); g.add(new T.Mesh(fin, metal));
  const props: T.Object3D[] = [], blade = new T.BoxGeometry(0.42, 2.8, 0.1); blade.translate(0, 1.45, 0);
  const disc = new T.MeshBasicMaterial({ color: 0x20252a, transparent: true, opacity: 0.16, side: T.DoubleSide, depthWrite: false });
  for (const x of [7.2, 14.4]) for (const side of [1, -1]) {
    const lead = -4.5 + (x - 1.2) * Math.tan((35 * Math.PI) / 180), length = x < 10 ? 13 : 8.5;
    const pod = new T.Mesh(new T.CylinderGeometry(0.95, 0.75, length, 14), metal); pod.rotation.x = Math.PI / 2; pod.position.set(side * x, -0.55, lead - 3.2 + length / 2); g.add(pod);
    const spinner = new T.Mesh(new T.ConeGeometry(0.62, 2.2, 14), dark); spinner.rotation.x = -Math.PI / 2; spinner.position.set(side * x, -0.55, lead - 4.6); g.add(spinner);
    for (const [k, dz] of [[1, -4.1], [-1, -3.3]] as const) {
      const hub = new T.Group(); hub.position.set(side * x, -0.55, lead + dz); hub.userData.spin = k;
      for (let i = 0; i < 4; i++) { const b = new T.Mesh(blade, dark); b.rotation.z = (i * Math.PI) / 2 + (k < 0 ? Math.PI / 4 : 0); b.rotation.y = 0.35 * k; hub.add(b); }
      const blur = new T.Mesh(new T.CircleGeometry(2.85, 28), disc); hub.add(blur); g.add(hub); props.push(hub);
    }
  }
  g.scale.setScalar(LIFE);
  return { model: g, props };
}
interface Bomber { type: BomberType; props: T.Object3D[]; drone: Drone; model: T.Group; offset: [number, number, number]; alive: boolean; missile: number; gun: number; burst: number }
interface Escort { model: T.Group; offset: [number, number, number]; drone: Drone | null; lost: boolean }

export class Raid {
  group = new T.Group(); bombers: Bomber[] = []; escorts: Escort[] = [];
  /** Seconds into the current raid; a raid takes `start / speed` seconds to reach London. */
  clock = 0; released = false; number = 1; distance = RAID.start; centre = new T.Vector3();
  /** Called once per raid when a surviving bomber reaches its release point. */
  onRelease: ((p: T.Vector3, v: T.Vector3) => void) | null = null;
  private serial = 970000; private target = new T.Vector3(...latLonToDir(RAID.target.lat, RAID.target.lon)); private tangent: T.Vector3; private seed = 5081;
  private rand = () => { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; };
  constructor() {
    const east = new T.Vector3(0, 1, 0).cross(this.target).normalize(), north = this.target.clone().cross(east), b = (RAID.bearing * Math.PI) / 180;
    this.tangent = north.multiplyScalar(Math.cos(b)).addScaledVector(east, Math.sin(b));
    // Three Tu-160s in a vee, a Tu-95 on each wing and one in trail; offsets are km right, up and ahead.
    const flight: [BomberType, [number, number, number]][] = [["tu160", [0, 0, 0]], ["tu160", [-0.9, 0, -1.1]], ["tu160", [0.9, 0, -1.1]], ["tu95", [-2.1, -0.2, -0.4]], ["tu95", [2.1, -0.2, -0.4]], ["tu95", [0, -0.25, -2.4]]];
    for (const [type, offset] of flight) { const built = type === "tu160" ? { model: swan(), props: [] } : bear(); this.group.add(built.model); this.bombers.push({ type, model: built.model, props: built.props, offset, alive: true, missile: 4, gun: 0, burst: 0, drone: this.make(type) }); }
    for (const offset of [[-4, 0.3, 1.2], [4, 0.3, 1.2], [-5, 0.1, -2.6], [5, 0.1, -2.6], [-1.2, 0.7, -4.4], [1.2, 0.7, -4.4]] as [number, number, number][]) { const model = buildAircraft("su27"); this.group.add(model); this.escorts.push({ model, offset, drone: null, lost: false }); }
    this.clock = RAID.period * 0.25;
  }
  private make(type: BomberType): Drone {
    const drone: Drone = { id: ++this.serial, external: true, name: BOMBER[type].name, radius: BOMBER[type].radius, score: 2500, p: new T.Vector3(), v: new T.Vector3(), hp: RAID.hp, maxHp: RAID.hp, phase: 0 };
    return drone;
  }
  /** Starts a fresh raid `distance` km from London. */
  launch(distance = RAID.start) {
    this.clock = (RAID.start - distance) / RAID.speed; this.released = false; this.number++;
    for (const b of this.bombers) { b.alive = true; b.drone = this.make(b.type); b.missile = 4; }
    for (const e of this.escorts) { e.drone = null; e.lost = false; }
  }
  get alive() { return this.bombers.filter((b) => b.alive).length; }
  /** Seconds until release, or -1 once it has happened or every bomber is down. */
  get eta() { return this.released || !this.alive ? -1 : Math.max(0, (this.distance - RAID.release) / RAID.speed); }
  get targets() { return this.bombers.filter((b) => b.alive && this.distance > -140).map((b) => b.drone); }
  get contacts(): RadarContact[] {
    if (this.distance < -140) return [];
    return [...this.bombers.filter((b) => b.alive).map((b) => ({ id: "swan-" + b.drone.id, name: BOMBER[b.type].name, kind: "hostile" as const, p: b.drone.p, v: b.drone.v, detail: this.released ? "Bomb released · withdrawing" : `Nuclear strike on London · Mach 0.8 · ${Math.max(0, this.distance).toFixed(0)} km out`, targetId: b.drone.id })),
      ...this.escorts.filter((e) => !e.drone && !e.lost).map((e, i) => ({ id: "swan-escort-" + i, name: "Su-27 FLANKER", kind: "hostile" as const, p: e.model.position.clone().add(this.shipAt), v: this.velocity, detail: "Bomber escort" }))];
  }
  private shipAt = new T.Vector3(); private velocity = new T.Vector3();
  /** Distance in km from the ship to the nearest live bomber of each type, for sound. */
  nearest = { tu95: 1e9, tu160: 1e9 };
  update(dt: number, time: number, ship: T.Vector3, shipV: T.Vector3, flying: boolean, combat: Combat) {
    this.clock += dt; if (this.clock > RAID.period) this.launch();
    for (const b of this.bombers) if (b.alive && b.drone.hp <= 0) b.alive = false;
    // An escort that was wiped with the rest of a sortie (not shot down) is back in formation.
    for (const e of this.escorts) if (e.drone) { if (e.drone.hp <= 0) e.lost = true; else if (!combat.targets.includes(e.drone)) e.drone = null; }
    const d = (this.distance = RAID.start - RAID.speed * this.clock), a = d / R, body = this.target.clone().multiplyScalar(Math.cos(a)).addScaledVector(this.tangent, Math.sin(a)).normalize();
    // Heading along the great circle toward London, in the Earth-fixed frame, then turned into the inertial frame.
    const headingBody = this.target.clone().multiplyScalar(Math.sin(a)).addScaledVector(this.tangent, -Math.cos(a)).normalize();
    const lead = new T.Vector3(...bodyToInertial(body.clone().multiplyScalar(R + RAID.altitude).toArray() as V, time, EARTH.rotation)), forward = new T.Vector3(...bodyToInertial(headingBody.toArray() as V, time, EARTH.rotation));
    const up = lead.clone().normalize(), right = forward.clone().cross(up).normalize(), attitude = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(right, up, forward.clone().negate()));
    const at = (o: [number, number, number]) => lead.clone().addScaledVector(right, o[0]).addScaledVector(up, o[1]).addScaledVector(forward, o[2]);
    this.centre.copy(lead); this.shipAt.copy(ship); this.velocity.copy(airVelocity(lead)).addScaledVector(forward, RAID.speed);
    const range = lead.distanceTo(ship), shown = d > -140 && range < 200;
    for (const b of this.bombers) {
      const p = at(b.offset); b.drone.p.copy(p); b.drone.v.copy(airVelocity(p)).addScaledVector(forward, RAID.speed);
      b.model.visible = shown && b.alive; b.model.position.copy(p).sub(ship); b.model.quaternion.copy(attitude);
      if (b.model.visible) for (const hub of b.props) hub.rotation.z += hub.userData.spin * dt * 31;
    }
    this.nearest.tu95 = this.nearest.tu160 = 1e9;
    if (shown) for (const b of this.bombers) if (b.alive) this.nearest[b.type] = Math.min(this.nearest[b.type], b.drone.p.distanceTo(ship));
    for (const e of this.escorts) {
      const p = at(e.offset); e.model.visible = shown && !e.drone && !e.lost; e.model.position.copy(p).sub(ship); e.model.quaternion.copy(attitude);
      // Inside 30 km the escorts break formation and become real fighters with their own pilots and weapons.
      if (!e.drone && !e.lost && shown && flying && combat.active && !combat.completed && range < RAID.scramble) e.drone = combat.scramble("su27", p, ship.clone().sub(p).normalize(), 0.45);
    }
    if (!this.released && d <= RAID.release && this.alive) { this.released = true; const b = this.bombers.find((x) => x.alive)!; this.onRelease?.(b.drone.p.clone(), b.drone.v.clone()); }
    if (!flying || !combat.active || combat.completed || !combat.allowEngage || !shown) return;
    for (const b of this.bombers) {
      if (!b.alive) continue;
      const toPlayer = ship.clone().sub(b.drone.p), range = toPlayer.length(); b.missile = Math.max(0, b.missile - dt); b.gun = Math.max(0, b.gun - dt);
      if (range < 14 && range > 1 && b.missile === 0) {
        const dir = toPlayer.clone().normalize();
        combat.incoming.push({ p: b.drone.p.clone().addScaledVector(dir, 0.08), v: b.drone.v.clone().addScaledVector(dir, 0.5), age: 0, life: 22, weapon: "missile", damage: 16, turn: 0.3, accel: 0.3, maxSpeed: 1.3, owner: b.drone.id, name: "AIR-TO-AIR" });
        b.missile = 9 + this.rand() * 4; combat.event?.("enemyGun", b.drone.p);
      }
      // Tail gun: only bears on an attacker in the rear hemisphere, inside 2.8 km.
      if (range < 2.8 && toPlayer.dot(forward) < 0 && b.gun === 0) {
        if (!b.burst) b.burst = 6; b.burst--; b.gun = b.burst ? 0.09 : 1.4 + this.rand();
        const aim = toPlayer.addScaledVector(shipV.clone().sub(b.drone.v), range / 1.4).normalize().add(new T.Vector3(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5).multiplyScalar(0.04)).normalize();
        combat.incoming.push({ p: b.drone.p.clone().addScaledVector(forward, -0.04), v: b.drone.v.clone().addScaledVector(aim, 1.4), life: 2.6, age: 0, weapon: "gun", damage: 4, owner: b.drone.id }); combat.event?.("enemyGun", b.drone.p);
      }
    }
  }
}
