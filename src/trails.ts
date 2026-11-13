import * as T from "three";
import { EARTH } from "./earth";
import { bodyToInertial, inertialToBody } from "./geo";
import type { V } from "./vector";

interface Ribbon {
  local: T.Vector3;
  points: { p: V; born: number; strength: number }[];
  mesh: T.Mesh;
  life: number;
  width: [number, number];
  channel: "tips" | "contrail" | "energy";
  lastEmit: number;
}
const SEGMENTS = 110;

/**
 * Camera-facing ribbons left in the air: wingtip vapour under load, engine contrails at altitude and the
 * supercruise wake. Points are stored Earth-fixed so the trail hangs in the co-rotating air.
 */
export class Trails {
  group = new T.Group();
  private ribbons: Ribbon[] = [];
  private vapour: T.ShaderMaterial;
  private energy: T.ShaderMaterial;
  constructor(ship: T.Object3D) {
    // The scaled model is in kilometres with the nose toward -Z; plume meshes are excluded by using fixed stations.
    const box = new T.Box3().setFromObject(ship), half = Math.max(Math.abs(box.min.x), Math.abs(box.max.x)), tail = 0.023, y = 0;
    const make = (blending: T.Blending) => new T.ShaderMaterial({
      transparent: true, depthWrite: false, side: T.DoubleSide, blending, toneMapped: false,
      uniforms: { tint: { value: new T.Color(1, 1, 1) } },
      vertexShader: `#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec2 ribbon;varying vec2 vRibbon;void main(){vRibbon=ribbon;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
  #include <logdepthbuf_vertex>
}`,
      fragmentShader: `#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 tint;varying vec2 vRibbon;void main(){
  #include <logdepthbuf_fragment>
  float across=1.-vRibbon.x*vRibbon.x;gl_FragColor=vec4(tint,across*across*vRibbon.y);}`,
    });
    this.vapour = make(T.NormalBlending);
    this.energy = make(T.AdditiveBlending);
    const add = (x: number, yy: number, z: number, channel: Ribbon["channel"], life: number, width: [number, number]) => {
      const geometry = new T.BufferGeometry();
      geometry.setAttribute("position", new T.BufferAttribute(new Float32Array(SEGMENTS * 6), 3));
      geometry.setAttribute("ribbon", new T.BufferAttribute(new Float32Array(SEGMENTS * 4), 2));
      const index: number[] = [];
      for (let i = 0; i < SEGMENTS - 1; i++) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      geometry.setIndex(index);
      const mesh = new T.Mesh(geometry, channel === "energy" ? this.energy : this.vapour);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.ribbons.push({ local: new T.Vector3(x, yy, z), points: [], mesh, life, width, channel, lastEmit: -1 });
    };
    add(-half * 0.97, y, tail * 0.5, "tips", 3.2, [0.0006, 0.006]);
    add(half * 0.97, y, tail * 0.5, "tips", 3.2, [0.0006, 0.006]);
    add(-half * 0.16, y, tail, "contrail", 16, [0.002, 0.03]);
    add(half * 0.16, y, tail, "contrail", 16, [0.002, 0.03]);
    add(0, y, tail, "energy", 1.6, [0.004, 0.012]);
  }
  reset() { for (const r of this.ribbons) r.points.length = 0; }
  update(time: number, shipP: T.Vector3, rotation: T.Quaternion, cameraPosition: T.Vector3, strength: { tips: number; contrail: number; energy: number }, light: T.Color, energyTint: T.Color) {
    this.vapour.uniforms.tint.value.copy(light);
    this.energy.uniforms.tint.value.copy(energyTint);
    for (const r of this.ribbons) {
      const s = strength[r.channel], head = r.local.clone().applyQuaternion(rotation).add(shipP);
      const last = r.points[0];
      if (last && (time < last.born || time - last.born > r.life * 2)) r.points.length = 0;
      if (time - r.lastEmit > r.life / (SEGMENTS - 4) || time < r.lastEmit) {
        r.lastEmit = time;
        if (s > 0.01 || r.points.some(p => p.strength > 0.01)) r.points.unshift({ p: inertialToBody(head.toArray() as V, time, EARTH.rotation), born: time, strength: s });
      }
      while (r.points.length && (time - r.points[r.points.length - 1].born > r.life || r.points.length > SEGMENTS - 1)) r.points.pop();
      const position = r.mesh.geometry.attributes.position as T.BufferAttribute, ribbon = r.mesh.geometry.attributes.ribbon as T.BufferAttribute;
      const count = r.points.length + 1;
      r.mesh.visible = r.points.length > 1;
      if (!r.mesh.visible) continue;
      const world: T.Vector3[] = [head.clone().sub(shipP)];
      for (const point of r.points) world.push(new T.Vector3(...bodyToInertial(point.p, time, EARTH.rotation)).sub(shipP));
      for (let i = 0; i < count; i++) {
        const a = world[Math.max(0, i - 1)], b = world[Math.min(count - 1, i + 1)], here = world[i],
          tangent = b.clone().sub(a), side = tangent.cross(here.clone().sub(cameraPosition)).normalize(),
          age = i === 0 ? 0 : (time - r.points[i - 1].born) / r.life,
          power = i === 0 ? s : r.points[i - 1].strength,
          width = T.MathUtils.lerp(r.width[0], r.width[1], Math.sqrt(age)),
          alpha = power * Math.min(1, age * 14 + (i === 0 ? 0 : 0.25)) * Math.pow(1 - age, 1.6);
        position.setXYZ(i * 2, here.x + side.x * width, here.y + side.y * width, here.z + side.z * width);
        position.setXYZ(i * 2 + 1, here.x - side.x * width, here.y - side.y * width, here.z - side.z * width);
        ribbon.setXY(i * 2, -1, alpha); ribbon.setXY(i * 2 + 1, 1, alpha);
      }
      r.mesh.geometry.setDrawRange(0, (count - 1) * 6);
      position.needsUpdate = ribbon.needsUpdate = true;
    }
  }
}
