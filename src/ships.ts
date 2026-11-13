import * as T from "three";
import { latLonToDir, bodyToInertial } from "./geo";
import { EARTH } from "./earth";
import { insideFeature, type Feature } from "./geodata";
import { VESSELS, vesselGeometry, wakeGeometry, type Vessel } from "./props";
import type { V } from "./vector";

interface Ship { type: Vessel; lat: number; lon: number; heading: number; speed: number; mesh: number }
const PER_TYPE = 24;
/**
 * River traffic on the Thames: commuter catamarans, barges, tugs and coasters that follow the river's own banks,
 * plus HMS Belfast moored by Tower Bridge. Positions advance on the simulation clock.
 */
export class Ships {
  group = new T.Group(); ships: Ship[] = [];
  private meshes = new Map<Vessel, T.InstancedMesh>(); private wake: T.InstancedMesh; private river: Feature[] = [];
  private anchor = new T.Vector3(...latLonToDir(51.505, -0.08)).multiplyScalar(EARTH.radius); private last = 0;
  constructor() {
    this.group.name = "Thames shipping";
    const material = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.1 });
    for (const type of Object.keys(VESSELS) as Vessel[]) { const g = vesselGeometry(type); g.scale(0.001, 0.001, 0.001); const m = new T.InstancedMesh(g, material, PER_TYPE); m.count = 0; m.frustumCulled = false; this.meshes.set(type, m); this.group.add(m); }
    const foam = new T.ShaderMaterial({ transparent: true, depthWrite: false, side: T.DoubleSide, uniforms: {},
      vertexShader: "#include <common>\n#include <logdepthbuf_pars_vertex>\nvarying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);\n#include <logdepthbuf_vertex>\n}",
      fragmentShader: "#include <common>\n#include <logdepthbuf_pars_fragment>\nvarying vec2 vUv;void main(){\n#include <logdepthbuf_fragment>\ngl_FragDepth-=log2(1.003)*logDepthBufFC*.5;gl_FragColor=vec4(vec3(.92),(1.-vUv.y)*(1.-vUv.y)*.38*(.4+.6*vUv.x));}" });
    this.wake = new T.InstancedMesh(wakeGeometry(), foam, PER_TYPE * 5); this.wake.count = 0; this.wake.frustumCulled = false; this.group.add(this.wake);
    this.group.visible = false;
  }
  /** `water` is the London water set; only tidal river polygons carry shipping. */
  load(water: Feature[]) {
    this.river = water.filter((f) => f.water === "river" || f.name === "River Thames");
    if (!this.river.length) return;
    let seed = 1234567; const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const wet = (lat: number, lon: number) => this.river.some((f) => insideFeature(lon, lat, f));
    // Mix by reach: catamarans and barges upstream, coasters and tugs below Tower Bridge.
    for (let k = 0; k < 400 && this.ships.length < 44; k++) {
      const lon = -0.16 + random() * 0.17, lat = 51.477 + random() * 0.05; if (!wet(lat, lon)) continue;
      const down = lon > -0.075, roll = random(), type: Vessel = down ? (roll < 0.35 ? "cargo" : roll < 0.6 ? "tug" : roll < 0.8 ? "clipper" : "barge") : roll < 0.55 ? "clipper" : roll < 0.85 ? "barge" : "tug";
      if (this.ships.some((s) => Math.hypot((s.lon - lon) * 69, (s.lat - lat) * 111) < 0.25)) continue;
      const ship: Ship = { type, lat, lon, heading: 0, speed: VESSELS[type].speed * (0.7 + 0.5 * random()) * (random() < 0.5 ? -1 : 1), mesh: 0 };
      ship.heading = this.flow(lat, lon); this.ships.push(ship);
    }
    this.ships.push({ type: "cruiser", lat: 51.50655, lon: -0.08135, heading: (95 * Math.PI) / 180, speed: 0, mesh: 0 });
  }
  /** Downstream direction (radians from north) estimated from which way the river stays wet the longest. */
  private flow(lat: number, lon: number) {
    let best = 0, bestRun = -1;
    for (let a = 0; a < Math.PI; a += Math.PI / 18) { let run = 0; for (const side of [-1, 1]) for (let d = 20; d < 400; d += 20) { const la = lat + (side * d * Math.cos(a)) / 111195, lo = lon + (side * d * Math.sin(a)) / (111195 * 0.622); if (!this.river.some((f) => insideFeature(lo, la, f))) break; run++; } if (run > bestRun) { bestRun = run; best = a; } }
    return best;
  }
  /** Set by the host: true where a blast has sunk whatever was afloat. */
  sunk: ((lat: number, lon: number) => boolean) | null = null;
  update(position: V, time: number, near: boolean) {
    this.group.visible = near && this.ships.length > 0; if (!this.group.visible) return;
    const dt = Math.min(1, Math.max(0, time - this.last)); this.last = time;
    const m = new T.Matrix4(), q = new T.Quaternion(), counts = new Map<Vessel, number>(); let wakes = 0;
    for (const s of this.ships) {
      if (this.sunk?.(s.lat, s.lon)) continue;
      if (s.speed) {
        const dist = s.speed * dt, la = s.lat + (dist * Math.cos(s.heading)) / 111195, lo = s.lon + (dist * Math.sin(s.heading)) / (111195 * 0.622);
        if (this.river.some((f) => insideFeature(lo, la, f))) { s.lat = la; s.lon = lo; if (Math.random() < dt * 0.2) { const want = this.flow(s.lat, s.lon), turn = Math.atan2(Math.sin(want - s.heading), Math.cos(want - s.heading)); s.heading += Math.abs(turn) < Math.PI / 2 ? turn * 0.5 : (turn - Math.sign(turn) * Math.PI) * 0.5; } }
        else s.heading = this.flow(s.lat, s.lon) + (Math.cos(this.flow(s.lat, s.lon) - s.heading) > 0 ? Math.PI : 0);
      }
      const up = new T.Vector3(...latLonToDir(s.lat, s.lon)), east = new T.Vector3(0, 1, 0).cross(up).normalize(), north = up.clone().cross(east), forward = north.clone().multiplyScalar(Math.cos(s.heading)).addScaledVector(east, Math.sin(s.heading));
      q.setFromRotationMatrix(new T.Matrix4().makeBasis(forward.clone().cross(up), up, forward.clone().negate()));
      const at = up.clone().multiplyScalar(EARTH.radius + 0.0003).sub(this.anchor), mesh = this.meshes.get(s.type)!, n = counts.get(s.type) ?? 0;
      if (n < PER_TYPE) { m.compose(at, q, new T.Vector3(1, 1, 1)); mesh.setMatrixAt(n, m); counts.set(s.type, n + 1); }
      if (Math.abs(s.speed) > 1 && wakes < PER_TYPE * 5) { const L = VESSELS[s.type].length * 0.001, len = L * (1.1 + Math.abs(s.speed) * 0.12); m.compose(at.clone().addScaledVector(forward, -L * 0.45), q, new T.Vector3(len * 0.9, 1, len)); this.wake.setMatrixAt(wakes++, m); }
    }
    for (const [type, mesh] of this.meshes) { mesh.count = counts.get(type) ?? 0; mesh.instanceMatrix.needsUpdate = true; }
    this.wake.count = wakes; this.wake.instanceMatrix.needsUpdate = true;
    this.group.rotation.y = (time / EARTH.rotation) * Math.PI * 2;
    this.group.position.set(...bodyToInertial(this.anchor.toArray() as V, time, EARTH.rotation)).sub(new T.Vector3(...position));
  }
}
