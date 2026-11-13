import * as T from "three";
import { latLonToDir } from "./geo";
import { terrainOffset } from "./terrain-coverage";
import type { Terrain } from "./terrain";

const R = 6371;
/** Inverse of terrainOffset (monotonic), by bisection. Returns the grid unit in -1..1. */
function unitOf(offset: number) {
  let lo = -1, hi = 1;
  for (let k = 0; k < 28; k++) { const mid = (lo + hi) / 2; if (terrainOffset(mid) < offset) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
/** Height in metres of the terrain mesh as it is drawn, at a geographic point; null outside the mesh. */
export function meshHeight(geometry: T.BufferGeometry, anchor: T.Vector3, segments: number, blend: number, lat: number, lon: number) {
  const pos = geometry.getAttribute("position") as T.BufferAttribute | undefined, base = geometry.getAttribute("basePosition") as T.BufferAttribute | undefined;
  if (!pos || pos.count !== (segments + 1) ** 2) return null;
  const up = anchor.clone().normalize(), east = new T.Vector3(0, 1, 0).cross(anchor).normalize(), north = up.clone().cross(east).normalize();
  const d = new T.Vector3(...latLonToDir(lat, lon)), along = d.dot(up); if (along <= 0) return null;
  const v = d.multiplyScalar(anchor.length() / along).sub(anchor), gx = (unitOf(v.dot(east)) + 1) / 2 * segments, gy = (unitOf(v.dot(north)) + 1) / 2 * segments;
  if (gx < 0 || gy < 0 || gx >= segments || gy >= segments) return null;
  const i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j, w = segments + 1, p = new T.Vector3();
  const h = (k: number) => {
    p.set(pos.getX(k), pos.getY(k), pos.getZ(k));
    if (base && blend < 1) p.lerp(new T.Vector3(base.getX(k), base.getY(k), base.getZ(k)), 1 - blend);
    return (p.add(anchor).length() - R) * 1000;
  };
  const a = h(j * w + i), b = h(j * w + i + 1), c = h((j + 1) * w + i), e = h((j + 1) * w + i + 1);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy;
}

/**
 * The drawn terrain is a coarse mesh away from the aircraft, so objects placed at the exact elevation float above
 * it or sink into it. This field holds (drawn height - exact height) on a grid around an anchor; object shaders add it
 * so trees, buildings, roads and aircraft stand on the ground you actually see.
 */
export class GroundCorrection {
  // 161 samples over 8 km: one every 50 m, finer than the drawn mesh's cells where buildings and trees stand.
  static SIZE = 161;
  texture: T.DataTexture; span = 8; // km across
  east = new T.Vector3(); north = new T.Vector3(); up = new T.Vector3();
  uniforms = { groundDelta: { value: null as T.DataTexture | null }, groundEast: { value: new T.Vector3() }, groundNorth: { value: new T.Vector3() }, groundUp: { value: new T.Vector3() }, groundSpan: { value: 8 } };
  private data = new Uint16Array(GroundCorrection.SIZE ** 2); private exact = new Float32Array(GroundCorrection.SIZE ** 2);
  /** Per sample: mesh vertex index of the cell corner (or -1 outside) and the two cell fractions. */
  private cell = new Int32Array(GroundCorrection.SIZE ** 2); private fx = new Float32Array(GroundCorrection.SIZE ** 2); private fy = new Float32Array(GroundCorrection.SIZE ** 2);
  private exactKey = ""; private layoutKey = ""; private stateKey = "";
  constructor(private terrain: Terrain) {
    this.texture = new T.DataTexture(this.data, GroundCorrection.SIZE, GroundCorrection.SIZE, T.RedFormat, T.HalfFloatType);
    this.texture.minFilter = this.texture.magFilter = T.LinearFilter; this.texture.wrapS = this.texture.wrapT = T.ClampToEdgeWrapping; this.texture.needsUpdate = true;
    this.uniforms.groundDelta.value = this.texture;
  }
  private point(k: number, anchor: T.Vector3) {
    const n = GroundCorrection.SIZE, x = ((k % n) / (n - 1) - 0.5) * this.span, y = (Math.floor(k / n) / (n - 1) - 0.5) * this.span;
    const d = anchor.clone().addScaledVector(this.east, x).addScaledVector(this.north, y).normalize();
    return { lat: (Math.asin(d.y) * 180) / Math.PI, lon: (Math.atan2(-d.z, d.x) * 180) / Math.PI, d };
  }
  /**
   * Mirrors the terrain vertex shader exactly: mix(base, position, blend) plus the recentring height ramp.
   * Cheap enough to run every frame while the ground is morphing, so objects move with it instead of jumping.
   */
  update(anchor: T.Vector3, geometry: T.BufferGeometry, meshAnchor: T.Vector3, segments: number, blend: number, recenter: number, revision: number) {
    this.up.copy(anchor).normalize(); this.east.set(0, 1, 0).cross(anchor).normalize(); this.north.copy(this.up).cross(this.east).normalize();
    const n = GroundCorrection.SIZE, total = n * n, exactKey = `${anchor.x.toFixed(4)},${anchor.y.toFixed(4)},${anchor.z.toFixed(4)},${revision}`;
    if (exactKey !== this.exactKey) { for (let k = 0; k < total; k++) { const { lat, lon } = this.point(k, anchor); this.exact[k] = this.terrain.height(lat, lon); } this.exactKey = exactKey; this.stateKey = ""; }
    const pos = geometry.getAttribute("position") as T.BufferAttribute | undefined, base = geometry.getAttribute("basePosition") as T.BufferAttribute | undefined, ramp = geometry.getAttribute("recenterHeight") as T.BufferAttribute | undefined;
    if (!pos || pos.count !== (segments + 1) ** 2) return;
    const layoutKey = `${exactKey}|${meshAnchor.x.toFixed(5)},${meshAnchor.y.toFixed(5)},${meshAnchor.z.toFixed(5)}|${segments}`;
    if (layoutKey !== this.layoutKey) {
      const up = meshAnchor.clone().normalize(), east = new T.Vector3(0, 1, 0).cross(meshAnchor).normalize(), north = up.clone().cross(east).normalize();
      for (let k = 0; k < total; k++) {
        const d = this.point(k, anchor).d, along = d.dot(up); this.cell[k] = -1; if (along <= 0) continue;
        const v = d.multiplyScalar(meshAnchor.length() / along).sub(meshAnchor), gx = (unitOf(v.dot(east)) + 1) / 2 * segments, gy = (unitOf(v.dot(north)) + 1) / 2 * segments;
        if (gx < 0 || gy < 0 || gx >= segments || gy >= segments) continue;
        const i = Math.floor(gx), j = Math.floor(gy); this.cell[k] = j * (segments + 1) + i; this.fx[k] = gx - i; this.fy[k] = gy - j;
      }
      this.layoutKey = layoutKey; this.stateKey = "";
    }
    const moving = blend < 1 || recenter < 1, stateKey = `${layoutKey}|${pos.version}|${base?.version}|${ramp?.version}`;
    if (!moving && stateKey === this.stateKey) return;
    this.stateKey = stateKey;
    const a = pos.array as Float32Array, b = base?.array as Float32Array | undefined, r = ramp?.array as Float32Array | undefined, w = segments + 1, ax = meshAnchor.x, ay = meshAnchor.y, az = meshAnchor.z, lift = 1 - recenter;
    const height = (k: number) => {
      let x = a[k * 3], y = a[k * 3 + 1], z = a[k * 3 + 2];
      if (b && blend < 1) { x = b[k * 3] + (x - b[k * 3]) * blend; y = b[k * 3 + 1] + (y - b[k * 3 + 1]) * blend; z = b[k * 3 + 2] + (z - b[k * 3 + 2]) * blend; }
      let length = Math.hypot(x + ax, y + ay, z + az);
      if (r && lift > 0) length += (r[k * 2] + (r[k * 2 + 1] - r[k * 2]) * blend) * lift;
      return (length - R) * 1000;
    };
    for (let k = 0; k < total; k++) {
      const c = this.cell[k]; if (c < 0) { this.data[k] = 0; continue; }
      const fx = this.fx[k], fy = this.fy[k], drawn = (height(c) * (1 - fx) + height(c + 1) * fx) * (1 - fy) + (height(c + w) * (1 - fx) + height(c + w + 1) * fx) * fy;
      this.data[k] = T.DataUtils.toHalfFloat(T.MathUtils.clamp(drawn - this.exact[k], -400, 400));
    }
    this.texture.needsUpdate = true;
    this.uniforms.groundEast.value.copy(this.east); this.uniforms.groundNorth.value.copy(this.north); this.uniforms.groundUp.value.copy(this.up); this.uniforms.groundSpan.value = this.span;
  }
}
/** GLSL replacement for three's project_vertex chunk: positions are anchor-relative (km); the correction is metres. */
export const groundProjectVertex = /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
{
  vec2 guv = vec2( dot( mvPosition.xyz, groundEast ), dot( mvPosition.xyz, groundNorth ) ) / groundSpan + 0.5;
  float inside = step( 0.0, guv.x ) * step( guv.x, 1.0 ) * step( 0.0, guv.y ) * step( guv.y, 1.0 );
  mvPosition.xyz += groundUp * texture2D( groundDelta, clamp( guv, 0.0, 1.0 ) ).r * 0.001 * inside;
}
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`;
export const groundUniformsGLSL = "uniform sampler2D groundDelta;uniform vec3 groundEast;uniform vec3 groundNorth;uniform vec3 groundUp;uniform float groundSpan;\n";
/** Adds the correction to any material whose geometry is in the shared anchor frame. */
export function seatOnGround(material: T.Material, correction: GroundCorrection) {
  const previous = material.onBeforeCompile.bind(material), source = material.onBeforeCompile.toString();
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    Object.assign(shader.uniforms, correction.uniforms);
    shader.vertexShader = groundUniformsGLSL + shader.vertexShader.replace("#include <project_vertex>", groundProjectVertex);
  };
  material.customProgramCacheKey = () => "seated:" + source;
  material.needsUpdate = true;
}
