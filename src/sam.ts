import * as T from "three";
import { bodyToInertial, latLonToDir, dirToLatLon } from "./geo";
import { EARTH } from "./earth";
import { lineOfSight } from "./contacts";
import { airVelocity } from "./combat-ai";
import type { Combat, Drone } from "./combat";
import type { V } from "./vector";

const R = EARTH.radius;
/**
 * Fictional long-range surface-to-air batteries, game values only. Real long-range systems reach into the lower
 * stratosphere, so the ceiling here is 32 km; the missile boosts to about Mach 4.5 and turns at a fixed rate, which a
 * hard break turn at the right moment can beat.
 */
export const SAM = { count: 6, detect: 80, engage: 45, floor: 100, grace: 30, salvo: 2, ceiling: 32, lockTime: 4, reload: 18, boost: 0.45, top: 1.5, turn: 0.32, damage: 45, life: 60, respawn: 90 };

interface Site { lat: number; lon: number; h: number; drone: Drone; lock: number; reload: number; alive: boolean; respawnAt: number; model: T.Group; dish: T.Object3D; heightAt: number }

function camo(c: number) { return new T.MeshStandardMaterial({ color: c, roughness: 0.85, metalness: 0.1 }); }
/** A launcher with four canisters on a raised erector, a radar truck with a turning panel and a command cabin; metres. */
function battery() {
  const g = new T.Group(), olive = camo(0x4c5537), dark = camo(0x2c3122), tyre = camo(0x151515), panel = camo(0x3a4230);
  const box = (w: number, h: number, l: number, m: T.Material, x: number, y: number, z: number) => { const b = new T.Mesh(new T.BoxGeometry(w, h, l), m); b.position.set(x, y, z); g.add(b); return b; };
  const truck = (x: number, z: number, yaw: number) => {
    const t = new T.Group(); t.position.set(x, 0, z); t.rotation.y = yaw; g.add(t);
    const add = (o: T.Object3D) => { t.add(o); return o; };
    add(new T.Mesh(new T.BoxGeometry(3, 1.2, 11), olive)).position.set(0, 1.6, 0);
    add(new T.Mesh(new T.BoxGeometry(3, 2.4, 2.6), dark)).position.set(0, 2.4, -6.3);
    for (const zz of [-4.5, -2.5, 1.5, 3.5]) for (const xx of [-1.45, 1.45]) { const w = new T.Mesh(new T.CylinderGeometry(0.6, 0.6, 0.5, 12), tyre); w.rotation.z = Math.PI / 2; w.position.set(xx, 0.6, zz); add(w); }
    return t;
  };
  const launcher = truck(0, 0, 0), erector = new T.Group(); erector.position.set(0, 2.4, 4.5); erector.rotation.x = -1.2; launcher.add(erector);
  for (const [x, y] of [[-0.55, 0.5], [0.55, 0.5], [-0.55, 1.45], [0.55, 1.45]]) { const c = new T.Mesh(new T.CylinderGeometry(0.45, 0.45, 7.5, 12), olive); c.position.set(x, y, -3.6); c.rotation.x = Math.PI / 2; erector.add(c); }
  erector.name = "canisters";
  const radar = truck(26, 6, 0.6), mast = new T.Group(); mast.position.set(0, 3, 2.5); radar.add(mast);
  const face = new T.Mesh(new T.BoxGeometry(4.4, 3.4, 0.35), panel); face.position.set(0, 2, 0); face.rotation.x = -0.35; mast.add(face);
  box(2.6, 2.6, 6, dark, -14, 1.3, 10);
  // A berm of earth around the launcher, as dug-in batteries have.
  const berm = new T.Mesh(new T.TorusGeometry(11, 1.4, 6, 24), camo(0x5b5440)); berm.rotation.x = Math.PI / 2; berm.scale.z = 0.6; berm.position.y = 0.2; g.add(berm);
  g.scale.setScalar(0.001);
  return { group: g, dish: mast };
}

/**
 * Batteries scattered on land around the aircraft: they track, launch, can be locked and destroyed, and come back
 * elsewhere. Their radars see out to 80 km (shown on the scope) but engage inside 45 km, never in the first 30 s after a
 * start, and with at most two missiles in the air between them.
 */
export class SamSites {
  group = new T.Group(); sites: Site[] = []; private serial = 900000; private seed = 4211;
  private rand = () => { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; };
  get targets() { return this.sites.filter((s) => s.alive).map((s) => s.drone); }
  constructor(private height: (lat: number, lon: number) => number, private land: (lat: number, lon: number) => boolean) { this.group.name = "SAM batteries"; }
  /** A spot on land 20-70 km away in a random direction; null if none was found this time. */
  private place(body: T.Vector3) {
    const up = body.clone().normalize(), east = new T.Vector3(0, 1, 0).cross(up).normalize(), north = up.clone().cross(east);
    for (let k = 0; k < 14; k++) {
      const a = this.rand() * Math.PI * 2, d = 20 + this.rand() * 50, dir = up.clone().addScaledVector(east, (Math.sin(a) * d) / R).addScaledVector(north, (Math.cos(a) * d) / R).normalize();
      const ll = dirToLatLon(dir.toArray() as V), h = this.height(ll.lat, ll.lon);
      if (h > 1 && this.land(ll.lat, ll.lon)) return { ...ll, h };
    }
    return null;
  }
  private spawn(slot: number, body: T.Vector3, time: number) {
    const spot = this.place(body); if (!spot) return;
    const old = this.sites[slot]; if (old) this.group.remove(old.model);
    const { group, dish } = battery(); this.group.add(group);
    const site: Site = { ...spot, lock: 0, reload: 4 + this.rand() * 8, alive: true, respawnAt: 0, model: group, dish, heightAt: time,
      drone: { id: ++this.serial, ground: true, external: true, name: "SAM BATTERY", radius: 0.035, p: new T.Vector3(), v: new T.Vector3(), hp: 3, maxHp: 3, phase: slot } };
    site.drone.destroy = () => { site.alive = false; site.respawnAt = time + SAM.respawn; site.lock = 0; this.wreck(site); };
    this.sites[slot] = site;
  }
  private wreck(site: Site) {
    site.model.traverse((o) => { const m = (o as T.Mesh).material as T.MeshStandardMaterial | undefined; if (m?.color) { const c = m.clone(); c.color.setHex(0x1a1714); (o as T.Mesh).material = c; } });
    site.model.getObjectByName("canisters")!.visible = false;
  }
  /**
   * Keeps the batteries around the aircraft, places them on the turning Earth, and runs their engagement:
   * track (line of sight, inside 80 km and below the ceiling), lock for 2.5 s, launch, reload.
   */
  update(dt: number, time: number, ship: T.Vector3, shipBody: T.Vector3, altitude: number, agl: number, flying: boolean, combat: Combat) {
    const spin = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), (time / EARTH.rotation) * Math.PI * 2);
    for (let i = 0; i < SAM.count; i++) {
      const s = this.sites[i];
      const far = s && new T.Vector3(...latLonToDir(s.lat, s.lon)).angleTo(shipBody.clone().normalize()) * R > 140;
      if (altitude < 60000 && (!s || far || (!s.alive && time > s.respawnAt))) this.spawn(i, shipBody, time);
    }
    for (const s of this.sites) {
      if (!s) continue;
      const dir = new T.Vector3(...latLonToDir(s.lat, s.lon));
      if (time - s.heightAt > 3 && dir.angleTo(shipBody.clone().normalize()) * R < 40) { s.h = this.height(s.lat, s.lon); s.heightAt = time; }
      const p = new T.Vector3(...bodyToInertial(dir.clone().multiplyScalar(R + s.h / 1000).toArray() as V, time, EARTH.rotation));
      s.drone.p.copy(p); s.drone.v.copy(airVelocity(p));
      const east = new T.Vector3(0, 1, 0).cross(dir).normalize(), north = dir.clone().cross(east);
      s.model.quaternion.copy(spin).multiply(new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(east, dir, north.clone().negate())));
      s.model.position.copy(p).sub(ship); s.model.visible = p.distanceTo(ship) < 60;
      if (!s.alive) continue;
      s.dish.rotation.y += dt * (s.lock > 0 ? 0 : 1.6);
      const toPlayer = ship.clone().sub(p), distance = toPlayer.length();
      // Below 100 m above the ground the aircraft hides in terrain clutter: flying low is the defence, as in reality.
      const tracking = flying && time > SAM.grace && combat.active && combat.allowEngage && !combat.completed && distance < SAM.engage && agl > SAM.floor && altitude < SAM.ceiling * 1000 && lineOfSight(p.clone().addScaledVector(p.clone().normalize(), 0.01), ship);
      s.lock = tracking ? s.lock + dt : Math.max(0, s.lock - dt * 2); s.reload = Math.max(0, s.reload - dt);
      // The radar panel stops scanning and faces the aircraft while it tracks (its truck sits turned 0.6 rad).
      if (tracking) { const l = toPlayer.clone().applyQuaternion(s.model.quaternion.clone().invert()); s.dish.rotation.y = Math.atan2(l.x, l.z) - 0.6; }
      const own = combat.incoming.filter((m) => m.owner === s.drone.id).length, aloft = combat.incoming.filter((m) => m.name === "SAM").length;
      if (tracking && s.lock > SAM.lockTime && s.reload === 0 && own < 1 && aloft < SAM.salvo) {
        const up = p.clone().normalize(), launch = up.clone().multiplyScalar(0.8).add(toPlayer.clone().normalize()).normalize();
        combat.incoming.push({ p: p.clone().addScaledVector(up, 0.015), v: airVelocity(p).addScaledVector(launch, 0.25), age: 0, life: SAM.life, weapon: "missile", damage: SAM.damage, turn: SAM.turn, accel: SAM.boost, maxSpeed: SAM.top, owner: s.drone.id, name: "SAM" });
        s.reload = SAM.reload; combat.event?.("enemyGun", p);
      }
    }
  }
  /** Batteries currently tracking the aircraft, for the warning receiver. */
  locks() { return this.sites.filter((s) => s?.alive && s.lock > 0.3).map((s) => ({ p: s.drone.p, name: "SAM BATTERY", ground: true })); }
}
