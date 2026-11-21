import * as T from "three";
import { bodyToInertial, latLonToDir } from "./geo";
import { EARTH } from "./earth";
import { buildAircraft, AIRCRAFT, type AircraftType } from "./aircraft-models";
import type { RadarContact } from "./contacts";
import type { V } from "./vector";

const R = EARTH.radius;
/** Models are drawn larger than life (airframe scale 1.9 for the big types, times 1.6), so formation gaps grow with them. */
const SPREAD = 1.9 * 1.6;
/**
 * Friendly US formations over Britain, flying the groupings they are usually seen in (fictional tracks, real types):
 * a B-52H out of RAF Fairford with an F-22 escort pair, a B-2A pair, a KC-135R tanker on its track with two F-35As
 * (one on the boom, one waiting on the right wing), a C-17A vic out of Brize Norton, and an E-3 Sentry orbit with
 * an F-15E combat air patrol. Each group flies a racetrack; members hold formation offsets in metres
 * (right, up, behind the leader).
 */
interface Member { type: AircraftType; offset: [number, number, number] }
interface GroupSpec { id: string; call: string; lat: number; lon: number; heading: number; leg: number; radius: number; altitude: number; speed: number; members: Member[]; note: string }
export const ALLIED: GroupSpec[] = [
  { id: "buff", call: "DOOM 31", lat: 51.95, lon: -1.2, heading: 75, leg: 70, radius: 18, altitude: 10500, speed: 0.23, note: "B-52H bomber cell · F-22 escort",
    members: [{ type: "b52", offset: [0, 0, 0] }, { type: "f22", offset: [-140, 25, 60] }, { type: "f22", offset: [140, 25, 60] }] },
  { id: "spirit", call: "SPIRIT 11", lat: 52.45, lon: -2.3, heading: 95, leg: 90, radius: 22, altitude: 12200, speed: 0.24, note: "B-2A pair",
    members: [{ type: "b2", offset: [0, 0, 0] }, { type: "b2", offset: [420, 0, 380] }] },
  { id: "tanker", call: "QUID 71", lat: 53.1, lon: 1.4, heading: 160, leg: 80, radius: 20, altitude: 7600, speed: 0.2, note: "KC-135R tanker · F-35A pair refuelling",
    // F-35A in contact under the boom nozzle (real metres before SPREAD); its wingman waits off the tanker's right wing.
    members: [{ type: "kc135", offset: [0, 0, 0] }, { type: "f35", offset: [0, -10, 39] }, { type: "f35", offset: [55, -4, 18] }] },
  { id: "lift", call: "REACH 404", lat: 51.75, lon: -1.0, heading: 250, leg: 60, radius: 14, altitude: 3000, speed: 0.16, note: "C-17A vic",
    members: [{ type: "c17", offset: [0, 0, 0] }, { type: "c17", offset: [-260, 30, 300] }, { type: "c17", offset: [260, 60, 600] }] },
  { id: "awacs", call: "MAGIC 21", lat: 52.4, lon: 0.9, heading: 20, leg: 50, radius: 28, altitude: 9000, speed: 0.18, note: "E-3 Sentry orbit · F-15E CAP",
    members: [{ type: "e3", offset: [0, 0, 0] }, { type: "f15", offset: [-2600, 900, -3000] }, { type: "f15", offset: [-2200, 900, -2700] }] },
];

interface Flier { member: Member; model: T.Group; p: T.Vector3 }
interface Group { spec: GroupSpec; fliers: Flier[]; length: number }

/** Position along a racetrack (two legs joined by half circles), as east/north km from the track centre and a heading. */
function track(spec: GroupSpec, s: number) {
  const L = spec.leg, r = spec.radius, perimeter = 2 * L + 2 * Math.PI * r, u = ((s % perimeter) + perimeter) % perimeter;
  let x: number, y: number, dir: number; // x along the leg, y to the right
  if (u < L) { x = u - L / 2; y = -r; dir = 0; }
  else if (u < L + Math.PI * r) { const a = (u - L) / r; x = L / 2 + Math.sin(a) * r; y = -Math.cos(a) * r; dir = a; }
  else if (u < 2 * L + Math.PI * r) { x = L / 2 - (u - L - Math.PI * r); y = r; dir = Math.PI; }
  else { const a = (u - 2 * L - Math.PI * r) / r; x = -L / 2 - Math.sin(a) * r; y = Math.cos(a) * r; dir = Math.PI + a; }
  const h = (spec.heading * Math.PI) / 180, hd = h + dir;
  // Rotate leg axes into compass axes: the leg runs along `heading`, right of it is +90°.
  const east = x * Math.sin(h) + y * Math.cos(h), north = x * Math.cos(h) - y * Math.sin(h);
  return { east, north, heading: hd };
}

export class AlliedFlights {
  group = new T.Group(); groups: Group[] = []; contacts: RadarContact[] = [];
  constructor() {
    this.group.name = "Allied formations";
    for (const spec of ALLIED) {
      const fliers = spec.members.map((member) => { const model = buildAircraft(member.type); model.scale.setScalar(1.6); this.group.add(model); return { member, model, p: new T.Vector3() }; });
      this.groups.push({ spec, fliers, length: 2 * spec.leg + 2 * Math.PI * spec.radius });
    }
  }
  update(time: number, ship: T.Vector3) {
    const spin = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), (time / EARTH.rotation) * Math.PI * 2);
    this.contacts = [];
    for (const g of this.groups) {
      const spec = g.spec, centre = new T.Vector3(...latLonToDir(spec.lat, spec.lon)), east = new T.Vector3(0, 1, 0).cross(centre).normalize(), north = centre.clone().cross(east);
      // Each group starts somewhere different on its track so they are not in step.
      const s = time * spec.speed + g.length * ((spec.id.charCodeAt(0) * 37) % 100) / 100, a = track(spec, s), b = track(spec, s + 0.2);
      const at = (k: { east: number; north: number }) => centre.clone().addScaledVector(east, k.east / R).addScaledVector(north, k.north / R).normalize();
      const here = at(a), ahead = at(b), up = here.clone(), fwd = ahead.clone().sub(here).normalize(), right = fwd.clone().cross(up).normalize();
      // Bank into the turns: the racetrack's half circles are rate-one-ish turns.
      const turning = Math.abs(((b.heading - a.heading + Math.PI) % (2 * Math.PI)) - Math.PI) > 1e-4, bank = turning ? Math.atan((spec.speed * 1000) ** 2 / (9.81 * spec.radius * 1000)) : 0;
      const lift = up.clone().applyAxisAngle(fwd, bank), wing = fwd.clone().cross(lift).normalize();
      for (const f of g.fliers) {
        const [ox, oy, oz] = f.member.offset.map((x) => x * SPREAD), alt = spec.altitude + oy;
        const body = here.clone().multiplyScalar(R + alt / 1000).addScaledVector(right, ox / 1000).addScaledVector(fwd, -oz / 1000);
        const p = new T.Vector3(...bodyToInertial(body.toArray() as V, time, EARTH.rotation));
        f.p.copy(p);
        f.model.position.copy(p).sub(ship);
        f.model.quaternion.copy(spin).multiply(new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(wing, lift, fwd.clone().negate())));
        f.model.visible = p.distanceTo(ship) < 120;
        const dome = f.model.userData.dome as T.Object3D | null; if (dome) dome.rotation.y = time * 0.63; // 6 rpm
        this.contacts.push({ id: `ally-${spec.id}-${g.fliers.indexOf(f)}`, name: `${spec.call}${g.fliers.indexOf(f) ? "-" + (g.fliers.indexOf(f) + 1) : ""} · ${AIRCRAFT[f.member.type].name}`, kind: "friendly", p, v: new T.Vector3(...bodyToInertial(fwd.toArray() as V, time, EARTH.rotation)).multiplyScalar(spec.speed), detail: `${spec.note} · FL${Math.round(spec.altitude / 0.3048 / 100)}` });
      }
    }
  }
}
