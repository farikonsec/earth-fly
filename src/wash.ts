import * as T from "three";
import { bodyToInertial } from "./geo";
import { EARTH } from "./earth";
import type { V } from "./vector";

const R = EARTH.radius, MAX = 4000;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

const vertex = /* glsl */ `
attribute vec3 offset;
attribute vec4 look; // size (m), opacity, kind (0 droplets, 1 mist), seed
attribute vec3 motion; // velocity, m/s
varying vec2 vCorner;
varying vec4 vLook;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vCorner = position.xy; vLook = look;
  vec4 mv = modelViewMatrix * vec4(offset, 1.0);
  // Droplets streak along their motion as seen on screen; mist puffs just turn.
  vec3 vv = (modelViewMatrix * vec4(motion, 0.0)).xyz; float sp = length(vv.xy) * 1000.0;
  vec2 dir = sp > 0.5 ? normalize(vv.xy) : vec2(cos(look.w * 6.2831853), sin(look.w * 6.2831853)), nrm = vec2(-dir.y, dir.x);
  float stretch = look.z < 0.5 ? 1.0 + min(sp * 0.07, 4.0) : 1.0;
  mv.xy += (dir * position.x * stretch + nrm * position.y) * look.x * 0.001;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;
const fragment = /* glsl */ `
uniform vec3 lightColor, ambient, hazeColor;
uniform float hazeK;
varying vec2 vCorner;
varying vec4 vLook;
#include <common>
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  float r = length(vCorner);
  if (r > 1.0) discard;
  // Lumpy edges: a few lobes per puff so spray reads as torn water, not discs.
  float a = atan(vCorner.y, vCorner.x) + vLook.w * 40.0;
  float edge = 0.72 + 0.18 * sin(a * 5.0 + vLook.w * 17.0) + 0.1 * sin(a * 11.0 - vLook.w * 9.0);
  float droplets = vLook.z < 0.5 ? 1.0 : 0.0;
  float body = smoothstep(edge, edge * mix(0.25, 0.55, droplets), r);
  // Spray scatters sunlight forward and glows white; mist is softer and takes the sky colour.
  vec3 color = mix(ambient * 1.4 + lightColor * 0.55, ambient * 1.1 + lightColor * 0.35, vLook.z);
  color = mix(color, hazeColor, hazeK);
  gl_FragColor = vec4(color, body * vLook.y);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface WashInput {
  /** Aircraft position in the Earth-fixed frame (km) and velocity relative to the ground (m/s, Earth-fixed axes). */
  body: T.Vector3; velocity: T.Vector3;
  /** Height of the water surface (m) and whether the aircraft is over water at all. */
  water: number; over: boolean;
  throttle: number; time: number; dt: number;
}

/**
 * Water thrown up by a jet flying low over it: the wing downwash and exhaust blast hit the surface behind the
 * aircraft and tear spray and mist off it. Strength grows as the square of closeness (nothing above 30 m of belly
 * height), with throttle and with speed. Droplets fly ballistically with air drag and fall back; mist drifts and fades.
 */
export class JetWash {
  mesh: T.Mesh; intensity = 0;
  private pos = new Float32Array(MAX * 3); private vel = new Float32Array(MAX * 3); private age = new Float32Array(MAX); private life = new Float32Array(MAX);
  private size = new Float32Array(MAX * 2); private kind = new Uint8Array(MAX); private seed = new Float32Array(MAX); private count = 0; private debt = 0;
  private offset: T.InstancedBufferAttribute; private look: T.InstancedBufferAttribute; private motion: T.InstancedBufferAttribute; private geometry: T.InstancedBufferGeometry;
  private anchor = new T.Vector3(); private east = new T.Vector3(); private north = new T.Vector3(); private up = new T.Vector3(); private level = 0;
  uniforms = { lightColor: { value: new T.Color(1, 1, 1) }, ambient: { value: new T.Color(0.3, 0.35, 0.4) }, hazeColor: { value: new T.Color() }, hazeK: { value: 0 } };
  constructor() {
    const g = new T.InstancedBufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3)); g.setIndex([0, 1, 2, 0, 2, 3]);
    this.offset = new T.InstancedBufferAttribute(new Float32Array(MAX * 3), 3); this.look = new T.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
    this.motion = new T.InstancedBufferAttribute(new Float32Array(MAX * 3), 3); this.motion.setUsage(T.DynamicDrawUsage); g.setAttribute("motion", this.motion);
    this.offset.setUsage(T.DynamicDrawUsage); this.look.setUsage(T.DynamicDrawUsage); g.setAttribute("offset", this.offset); g.setAttribute("look", this.look); g.instanceCount = 0;
    this.geometry = g;
    this.mesh = new T.Mesh(g, new T.ShaderMaterial({ uniforms: this.uniforms, vertexShader: vertex, fragmentShader: fragment, transparent: true, depthWrite: false }));
    this.mesh.frustumCulled = false; this.mesh.scale.setScalar(0.001); this.mesh.name = "Jet wash"; this.mesh.visible = false;
  }
  /** Local east/up/south metres around the anchor, so the spray stays put on the water as the Earth turns. */
  private frame(body: T.Vector3, water: number) {
    const dir = body.clone().normalize();
    if (this.count === 0 || this.anchor.angleTo(dir) * R > 1.5 || Math.abs(water - this.level) > 0.5) {
      const old = { a: this.anchor.clone(), e: this.east.clone(), n: this.north.clone(), u: this.up.clone(), l: this.level };
      this.anchor.copy(dir); this.up.copy(dir); this.east.set(0, 1, 0).cross(dir).normalize(); this.north.copy(this.up).cross(this.east); this.level = water;
      // Carry live particles over to the new anchor.
      if (this.count) for (let i = 0; i < this.count; i++) {
        const w = old.a.clone().multiplyScalar(R * 1000 + old.l).addScaledVector(old.e, this.pos[i * 3]).addScaledVector(old.u, this.pos[i * 3 + 1]).addScaledVector(old.n, -this.pos[i * 3 + 2]);
        const d = w.sub(this.anchor.clone().multiplyScalar(R * 1000 + this.level)); this.pos[i * 3] = d.dot(this.east); this.pos[i * 3 + 1] = d.dot(this.up); this.pos[i * 3 + 2] = -d.dot(this.north);
      }
    }
  }
  update(input: WashInput, ship: V, sun: { color: T.Color; ambient: T.Color; haze: T.Color; hazeK: number }) {
    const { dt } = input;
    this.frame(input.body, input.water);
    const rel = input.body.clone().multiplyScalar(1000).sub(this.anchor.clone().multiplyScalar(R * 1000 + this.level));
    const jet = new T.Vector3(rel.dot(this.east), rel.dot(this.up), -rel.dot(this.north));
    const v = new T.Vector3(input.velocity.dot(this.east), input.velocity.dot(this.up), -input.velocity.dot(this.north)), speed = Math.hypot(v.x, v.z);
    const belly = jet.y - 1.5, close = Math.max(0, 1 - belly / 30);
    this.intensity = input.over && belly > -1 ? close * close * (0.35 + 0.65 * input.throttle) * Math.min(1.4, speed / 70) : 0;
    // Emit: wing downwash meets the water a little behind the jet; the exhaust blast further back along the track.
    if (this.intensity > 0.01 && dt > 0) {
      this.debt += dt * 2600 * this.intensity;
      const back = speed > 1 ? new T.Vector3(-v.x / speed, 0, -v.z / speed) : new T.Vector3(0, 0, 1), side = new T.Vector3(-back.z, 0, back.x);
      // Three sources, as in photographs of low passes: a rooster tail torn up by the exhaust on the centre line, and
      // a curl of spray under each wingtip vortex, thrown outwards and up. Mist hangs over all of it.
      while (this.debt >= 1 && this.count < MAX) {
        this.debt -= 1; const i = this.count++, roll = Math.random(), mist = roll < 0.18, tipSide = roll < 0.6 ? (Math.random() < 0.5 ? -1 : 1) : 0;
        const h = Math.max(0, belly), along = tipSide ? rand(6, 26) + h * 0.7 : rand(10, 48) + h * 0.9, across = tipSide ? tipSide * (13 + rand(-2.5, 2.5) + h * 0.15) : rand(-1, 1) * (2.5 + h * 0.2);
        const p = jet.clone().addScaledVector(back, along).addScaledVector(side, across); p.y = rand(0, 0.3);
        const power = 0.45 + this.intensity;
        // Vortex spray swirls outwards and up; the exhaust trench throws water up and back along the track.
        const out = side.clone().multiplyScalar(tipSide ? tipSide * rand(2, 8) * power : rand(-1.5, 1.5));
        const lift = mist ? rand(0.5, 3) : tipSide ? rand(2, 9) * power : rand(4, 16) * power;
        const drag = back.clone().multiplyScalar(-speed * (tipSide ? rand(0.02, 0.1) : rand(0.08, 0.3)));
        this.pos.set([p.x, p.y, p.z], i * 3); this.vel.set([out.x + drag.x, lift, out.z + drag.z], i * 3);
        this.age[i] = 0; this.life[i] = mist ? rand(2, 3.6) : rand(0.6, 1.6); this.kind[i] = mist ? 1 : 0; this.seed[i] = Math.random();
        this.size[i * 2] = mist ? rand(2, 4) : rand(0.25, 0.7); this.size[i * 2 + 1] = mist ? rand(7, 13) : rand(0.8, 1.8);
      }
    }
    // Integrate: gravity for droplets, strong drag and slight buoyancy for mist; anything back in the water is gone.
    let n = 0;
    for (let i = 0; i < this.count; i++) {
      const life = this.life[i], age = this.age[i] + dt; if (age >= life || this.pos[i * 3 + 1] < -0.3) continue;
      const k = this.kind[i], drag = Math.exp(-dt * (k ? 1.6 : 0.6));
      let vx = this.vel[i * 3] * drag, vy = this.vel[i * 3 + 1] * (k ? Math.exp(-dt * 1.2) : 1) - (k ? -0.15 : 9.81) * dt, vz = this.vel[i * 3 + 2] * drag;
      if (!Number.isFinite(vx + vy + vz)) continue;
      const j = n;
      this.pos[j * 3] = this.pos[i * 3] + vx * dt; this.pos[j * 3 + 1] = this.pos[i * 3 + 1] + vy * dt; this.pos[j * 3 + 2] = this.pos[i * 3 + 2] + vz * dt;
      this.vel[j * 3] = vx; this.vel[j * 3 + 1] = vy; this.vel[j * 3 + 2] = vz; this.age[j] = age; this.life[j] = life; this.kind[j] = k; this.seed[j] = this.seed[i];
      this.size[j * 2] = this.size[i * 2]; this.size[j * 2 + 1] = this.size[i * 2 + 1]; n++;
    }
    this.count = n;
    const off = this.offset.array as Float32Array, look = this.look.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const u = this.age[i] / this.life[i], mist = this.kind[i];
      off[i * 3] = this.pos[i * 3]; off[i * 3 + 1] = this.pos[i * 3 + 1]; off[i * 3 + 2] = this.pos[i * 3 + 2];
      look[i * 4] = this.size[i * 2] + (this.size[i * 2 + 1] - this.size[i * 2]) * Math.sqrt(u);
      const m = this.motion.array as Float32Array; m[i * 3] = this.vel[i * 3]; m[i * 3 + 1] = this.vel[i * 3 + 1]; m[i * 3 + 2] = this.vel[i * 3 + 2];
      look[i * 4 + 1] = (mist ? 0.12 : 0.85) * Math.min(1, u * 8) * (1 - u) * (1 - u * 0.3);
      look[i * 4 + 2] = mist; look[i * 4 + 3] = this.seed[i];
    }
    this.geometry.instanceCount = n; this.offset.needsUpdate = true; this.look.needsUpdate = true; this.motion.needsUpdate = true;
    this.offset.clearUpdateRanges(); this.offset.addUpdateRange(0, n * 3); this.motion.clearUpdateRanges(); this.motion.addUpdateRange(0, n * 3); this.look.clearUpdateRanges(); this.look.addUpdateRange(0, n * 4);
    this.mesh.visible = n > 0;
    if (!n) return;
    // Place the local frame: Earth-fixed anchor at the water, turned with the planet.
    const spin = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), (input.time / EARTH.rotation) * Math.PI * 2);
    this.mesh.quaternion.copy(spin).multiply(new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(this.east, this.up, this.north.clone().negate())));
    this.mesh.position.set(...bodyToInertial(this.anchor.clone().multiplyScalar(R + this.level / 1000).toArray() as V, input.time, EARTH.rotation)).sub(new T.Vector3(...ship));
    this.uniforms.lightColor.value.copy(sun.color); this.uniforms.ambient.value.copy(sun.ambient); this.uniforms.hazeColor.value.copy(sun.haze); this.uniforms.hazeK.value = sun.hazeK;
  }
}
