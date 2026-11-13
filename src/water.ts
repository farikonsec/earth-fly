import * as T from "three";
import { latLonToDir, bodyToInertial, dirToLatLon } from "./geo";
import { EARTH } from "./earth";
import type { V } from "./vector";
import { siteAt, type WaterSite } from "./water-sites";
import { overlayGLSL } from "./ground-overlay";
import { webTileDefaultGLSL } from "./satellite";

const R = EARTH.radius;

const vertex = /* glsl */ `
uniform mat4 textureMatrix;
uniform vec2 anchorGeo;
varying vec2 vGeo;
varying vec3 vLocal;
varying vec4 vReflect;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vec3 p = position;
  // The sphere falls away from the tangent plane: 3.9 m at 7 km.
  p.y -= dot(p.xz, p.xz) / (2.0 * ${(R * 1000).toFixed(1)});
  vLocal = p;
  vGeo = anchorGeo + vec2(p.x / (111320.0 * cos(radians(anchorGeo.y))), -p.z / 110540.0);
  vReflect = textureMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  #include <logdepthbuf_vertex>
}`;

const fragment = /* glsl */ `
uniform sampler2D reflectionMap;
uniform float masked, waveScale;
uniform vec4 wake[24];
uniform vec4 jetNow;
uniform vec3 bodyColor;
varying vec2 vGeo;
uniform float reflectionOn, time, hazeDensity, fadeStart, fadeEnd, skyLight;
uniform vec2 waveOrigin;
uniform vec3 camLocal, sunLocal, sunColor, skyHorizon, skyZenith, hazeColor;
varying vec3 vLocal;
varying vec4 vReflect;
#include <common>
#include <logdepthbuf_pars_fragment>
${webTileDefaultGLSL}
${overlayGLSL}
float hash1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y); }
void main() {
  #include <logdepthbuf_fragment>
  // Off surveyed ground, only where the map paints water (shore land may sit below the surface there).
  float wet = 1.0;
  if (masked > 0.5) { applyOverlay(vec3(0.0), vGeo); wet = smoothstep(0.35, 0.65, overlayWater); if (wet < 0.01) discard; }
  // World-fixed wave coordinates in metres (east, north), continuous when the surface re-anchors.
  vec2 wp = vec2(vLocal.x, -vLocal.z) + waveOrigin;
  float footprint = max(length(dFdx(wp)), length(dFdy(wp)));
  // A spectrum of deep-water wind waves, 30 m down to 0.3 m, each moving at its own dispersion speed (w = sqrt(g k)),
  // with jittered lengths and a wide spread of directions so no single wave train shows as stripes. On a sheltered
  // river the long waves are gentle and the short wind chop carries most of the slope.
  // Waves smaller than a pixel fade out and turn into surface roughness instead, so distant water glitters, not flickers.
  vec2 grad = vec2(0.0); float rough = 0.0;
  for (int i = 0; i < 32; i++) {
    float fi = float(i), lambda = 30.0 * pow(0.86, fi) * (0.8 + 0.4 * hash1(fi + 1.3));
    float a = 0.55 + (hash1(fi) - 0.5) * 3.0, k = 6.2831853 / lambda, w = sqrt(9.81 * k);
    vec2 dir = vec2(cos(a), sin(a));
    float slope = waveScale * (0.008 + 0.03 * smoothstep(2.0, 14.0, fi)) * (0.5 + hash1(fi + 3.1));
    float phase = k * dot(dir, wp) - w * time + hash1(fi + 7.7) * 6.2831853;
    float keep = 1.0 - smoothstep(0.18, 0.6, footprint / lambda);
    // A little peaking (cos with a squared crest) reads as wind chop rather than pure sine ripples.
    float c = cos(phase), s = sin(phase);
    grad += dir * slope * (c * (1.0 + 0.35 * s)) * keep;
    rough += slope * slope * (1.0 - keep);
  }
  // Jet wash. Under the aircraft the downwash ruffles the surface into fast short chop and rings spreading out;
  // behind it a foam trail follows the actual flight path (24 points, last 3.6 s), widening and fading with age.
  float foam = 0.0;
  if (jetNow.z > 0.005) {
    vec2 dj = wp - jetNow.xy; float d = length(dj), reach = 7.0 + jetNow.w * 0.9;
    float ruffle = jetNow.z * exp(-d * d / (reach * reach * 3.0));
    grad += ruffle * 0.55 * vec2(sin(wp.x * 3.3 + time * 15.0) + sin(wp.y * 2.6 - time * 12.0 + wp.x), cos(wp.y * 3.1 - time * 14.0) + cos(wp.x * 2.4 + time * 11.0 - wp.y));
    grad += ruffle * 0.35 * (dj / max(d, 0.5)) * sin(d * 1.7 - time * 13.0);
    rough += ruffle * 0.04;
    for (int i = 0; i < 23; i++) {
      vec4 a = wake[i], b = wake[i + 1]; if (a.z <= 0.0 || b.z <= 0.0) continue;
      vec2 ab = b.xy - a.xy; float t = clamp(dot(wp - a.xy, ab) / max(dot(ab, ab), 1e-3), 0.0, 1.0);
      float age = mix(a.w, b.w, t), s = mix(a.z, b.z, t), width = 4.0 + 3.5 * age + 0.5 * s * 6.0;
      float dd = length(wp - a.xy - ab * t);
      foam += s * exp(-age / 2.2) * exp(-dd * dd / (width * width));
    }
    // Torn, lacy foam rather than a smooth band.
    float lace = vnoise(wp * 0.9 + time * 0.6) * 0.6 + vnoise(wp * 3.1 - time * 1.1) * 0.4;
    foam = smoothstep(0.25, 0.85, foam * (0.55 + 0.9 * lace)) * (1.0 - smoothstep(1500.0, 3000.0, length(camLocal - vLocal)));
    rough += foam * 0.02;
  }
  vec3 N = normalize(vec3(-grad.x, 1.0, grad.y));
  vec3 toEye = camLocal - vLocal; float dist = length(toEye); vec3 V = toEye / dist;
  float nv = max(dot(N, V), 0.02);
  float F = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
  vec3 Rr = reflect(-V, N); Rr.y = abs(Rr.y);
  // Sky in the water: horizon haze to zenith blue, with the sun's aureole.
  vec3 sky = mix(skyHorizon, skyZenith, pow(Rr.y, 0.5)) + sunColor * 0.025 * pow(max(dot(Rr, sunLocal), 0.0), 12.0);
  // Mirror image of bridges, buildings and aircraft, bent by the wave normals; sky shows wherever nothing was drawn.
  vec2 uv = vReflect.xy / vReflect.w + vec2(N.x, N.z) * 0.035 * (1.0 - smoothstep(800.0, 5000.0, dist));
  vec4 mirrored = texture2D(reflectionMap, clamp(uv, 0.001, 0.999)) * reflectionOn;
  vec3 reflected = mix(sky, mirrored.rgb, mirrored.a);
  // Silty tidal water: little light comes back up out of it.
  vec3 body = bodyColor * (0.25 + 0.75 * skyLight) + vec3(0.010, 0.022, 0.016) * max(dot(N, sunLocal), 0.0) * max(sunLocal.y, 0.0);
  // Sun glitter: GGX lobe whose width grows with the waves too small to draw.
  float alpha = clamp(0.012 + sqrt(rough) * 1.1, 0.012, 0.45), a2 = alpha * alpha;
  vec3 H = normalize(sunLocal + V); float nh = max(dot(N, H), 0.0), nl = max(dot(N, sunLocal), 0.0);
  float D = a2 / (3.14159265 * pow(nh * nh * (a2 - 1.0) + 1.0, 2.0));
  float Fs = 0.02 + 0.98 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
  vec3 glint = sunColor * D * Fs * nl / (4.0 * nv + 0.0001) * (1.0 - mirrored.a) * step(0.0, sunLocal.y);
  vec3 color = mix(body, reflected, F) + min(glint, vec3(60.0));
  color = mix(color, skyHorizon * 0.55 + sunColor * 0.12 * max(sunLocal.y, 0.0), foam * 0.85);
  color = mix(color, hazeColor, 1.0 - exp(-dist * 0.000012 * hazeDensity));
  gl_FragColor = vec4(color, wet * (1.0 - smoothstep(fadeStart, fadeEnd, length(toEye.xz))));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * A real water surface for surveyed rivers: a curved disc at the river level under the camera, with a planar mirror
 * render of the scene (bridges, buildings, aircraft), a wave spectrum for the normals and a physically based sun glint.
 * Land, embankments and moored ships stand above it and hide it through the depth test.
 */
export class WaterSurface {
  mesh: T.Mesh; active = false;
  private target = new T.WebGLRenderTarget(1, 1, { type: T.HalfFloatType });
  private mirror = new T.PerspectiveCamera();
  private textureMatrix = new T.Matrix4();
  private uniforms = {
    reflectionMap: { value: this.target.texture }, textureMatrix: { value: this.textureMatrix }, reflectionOn: { value: 1 },
    time: { value: 0 }, waveOrigin: { value: new T.Vector2() }, camLocal: { value: new T.Vector3() }, sunLocal: { value: new T.Vector3(0, 1, 0) },
    sunColor: { value: new T.Color() }, skyHorizon: { value: new T.Color() }, skyZenith: { value: new T.Color() }, hazeColor: { value: new T.Color() },
    wake: { value: Array.from({ length: 24 }, () => new T.Vector4()) }, jetNow: { value: new T.Vector4() },
    masked: { value: 0 }, waveScale: { value: 1 }, bodyColor: { value: new T.Vector3() }, anchorGeo: { value: new T.Vector2() },
    hazeDensity: { value: 1 }, fadeStart: { value: 4500 }, fadeEnd: { value: 7000 }, skyLight: { value: 1 },
  };
  private anchor = { lat: 0, lon: 0 }; private region: WaterSite | null = null;
  /** `overlay` is the ground overlay's uniform set: the mask of painted water for the estuary sites. */
  constructor(overlay: Record<string, { value: unknown }>) {
    Object.assign(this.uniforms, overlay);
    // Rings packed close under the camera and widening outwards, 7 km across the radius.
    const rings: number[] = [0]; for (let r = 4; r < 7200; r *= 1.12) rings.push(r);
    const seg = 160, pos: number[] = [], index: number[] = [];
    for (const r of rings) for (let s = 0; s < seg; s++) { const a = (s / seg) * Math.PI * 2; pos.push(Math.cos(a) * r, 0, Math.sin(a) * r); }
    for (let i = 0; i + 1 < rings.length; i++) for (let s = 0; s < seg; s++) {
      const a = i * seg + s, b = i * seg + ((s + 1) % seg), c = a + seg, d = b + seg; index.push(a, b, c, b, d, c);
    }
    const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); g.setIndex(index);
    this.mesh = new T.Mesh(g, new T.ShaderMaterial({ uniforms: this.uniforms, vertexShader: vertex, fragmentShader: fragment, transparent: true, depthWrite: true }));
    this.mesh.name = "WaterSurface"; this.mesh.frustumCulled = false; this.mesh.visible = false; 
    this.mesh.scale.setScalar(0.001);
  }
  /** Places the surface under the camera; inactive outside the surveyed rivers or above 2.5 km. */
  update(cameraBody: T.Vector3, altitude: number, ship: V, time: number) {
    const ll = dirToLatLon(cameraBody.clone().normalize().toArray() as V);
    this.region = siteAt(ll.lat, ll.lon, 0.03);
    this.active = !!this.region && altitude < 2500;
    this.mesh.visible = this.active; if (!this.region) return;
    const reg = this.region;
    // Re-anchor on a 0.002° grid so the tangent plane never strays more than ~150 m from the camera.
    this.anchor = { lat: Math.round(ll.lat / 0.002) * 0.002, lon: Math.round(ll.lon / 0.002) * 0.002 };
    const up = new T.Vector3(...latLonToDir(this.anchor.lat, this.anchor.lon)), east = new T.Vector3(0, 1, 0).cross(up).normalize(), north = up.clone().cross(east), south = north.clone().negate();
    const spin = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), (time / EARTH.rotation) * Math.PI * 2);
    this.mesh.quaternion.copy(spin).multiply(new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(east, up, south)));
    this.mesh.position.set(...bodyToInertial(up.clone().multiplyScalar(R + (reg.level + 0.3) / 1000).toArray() as V, time, EARTH.rotation)).sub(new T.Vector3(...ship));
    const lat0 = (reg.south + reg.north) / 2, lon0 = (reg.west + reg.east) / 2, k = Math.cos((lat0 * Math.PI) / 180);
    this.uniforms.waveOrigin.value.set((this.anchor.lon - lon0) * 111320 * k, (this.anchor.lat - lat0) * 110540);
    this.uniforms.anchorGeo.value.set(this.anchor.lon, this.anchor.lat); this.uniforms.masked.value = reg.masked ? 1 : 0;
    this.uniforms.waveScale.value = reg.waves; this.uniforms.bodyColor.value.set(...reg.body);
    this.uniforms.time.value = time % 3600;
    this.mesh.updateMatrixWorld();
  }
  /** Height (m) of the drawn water surface at the active site. */
  get level() { return this.region ? this.region.level + 0.3 : 0; }
  /** Wave coordinates (metres east, north of the site centre) of a point; null outside the active site. */
  waveCoords(lat: number, lon: number) {
    const r = this.region; if (!r) return null;
    const lat0 = (r.south + r.north) / 2, lon0 = (r.west + r.east) / 2;
    return new T.Vector2((lon - lon0) * 111320 * Math.cos((lat0 * Math.PI) / 180), (lat - lat0) * 110540);
  }
  private trail: { p: T.Vector2; s: number; t: number }[] = []; private trailSite: WaterSite | null = null;
  /** Feeds the jet wash: where the aircraft is over the water, how strong its wash is and its belly height. */
  wash(lat: number, lon: number, intensity: number, belly: number, time: number) {
    const p = this.waveCoords(lat, lon), u = this.uniforms;
    if (this.region !== this.trailSite) { this.trail = []; this.trailSite = this.region; }
    if (!p) { u.jetNow.value.set(0, 0, 0, 0); return; }
    u.jetNow.value.set(p.x, p.y, intensity, Math.max(0, belly));
    const last = this.trail[this.trail.length - 1];
    if (!last || time - last.t > 0.15 || time < last.t) { this.trail.push({ p, s: intensity, t: time }); if (this.trail.length > 24) this.trail.shift(); }
    else { last.p.copy(p); last.s = Math.max(last.s, intensity); }
    for (let i = 0; i < 24; i++) { const e = this.trail[i]; if (e && e.s > 0.005) u.wake.value[i].set(e.p.x, e.p.y, e.s, Math.max(0, time - e.t)); else u.wake.value[i].set(0, 0, 0, 0); }
  }
  /** Sky, sun and haze in step with the terrain's own lighting. */
  light(sunWorld: T.Vector3, sun: T.Color, day: number, haze: T.Color, hazeDensity: number, skyLight: number) {
    const inv = this.mesh.quaternion.clone().invert();
    this.uniforms.sunLocal.value.copy(sunWorld).normalize().applyQuaternion(inv);
    this.uniforms.sunColor.value.copy(sun).multiplyScalar(day);
    this.uniforms.skyHorizon.value.copy(haze).multiplyScalar(1.55);
    this.uniforms.skyZenith.value.setRGB(haze.r * 0.42, haze.g * 0.68, haze.b * 1.3);
    this.uniforms.hazeColor.value.copy(haze); this.uniforms.hazeDensity.value = hazeDensity; this.uniforms.skyLight.value = skyLight;
  }
  private reflectFrame = 0;
  /** Renders the mirror image of the given scenes across the water plane (Lengyel oblique clipping keeps the riverbed out). */
  reflect(renderer: T.WebGLRenderer, camera: T.PerspectiveCamera, scenes: T.Scene[], scale = 0.5) {
    if (!this.active) return;
    const size = renderer.getDrawingBufferSize(new T.Vector2()), w = Math.max(1, Math.round(size.x * scale)), h = Math.max(1, Math.round(size.y * scale));
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
    this.uniforms.camLocal.value.copy(this.mesh.worldToLocal(camera.position.clone()));
    // The mirror is redrawn every other frame: ripples already smear it, and it is a second full pass over the
    // terrain scene. The texture matrix is only updated with a redraw so the image and its projection stay paired.
    if (++this.reflectFrame % 2 === 0 && this.uniforms.reflectionOn.value) return;
    const normal = new T.Vector3(0, 1, 0).applyQuaternion(this.mesh.quaternion), point = this.mesh.position.clone();
    const eye = camera.position.clone(), view = point.clone().sub(eye);
    if (view.dot(normal) > 0) { this.uniforms.reflectionOn.value = 0; return; } // camera below the water
    this.uniforms.reflectionOn.value = 1;
    const rot = new T.Matrix4().extractRotation(camera.matrixWorld), look = new T.Vector3(0, 0, -1).applyMatrix4(rot).add(eye);
    const mirroredEye = view.reflect(normal).negate().add(point), target = point.clone().sub(look).reflect(normal).negate().add(point);
    const m = this.mirror; m.position.copy(mirroredEye); m.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal); m.lookAt(target);
    m.near = camera.near; m.far = camera.far; m.updateMatrixWorld(); m.projectionMatrix.copy(camera.projectionMatrix);
    m.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(m.projectionMatrix).multiply(m.matrixWorldInverse).multiply(this.mesh.matrixWorld);
    // Oblique near plane on the water surface (lifted a few centimetres so the waterline does not clip).
    const plane = new T.Plane().setFromNormalAndCoplanarPoint(normal, point.clone().addScaledVector(normal, -0.00003)).applyMatrix4(m.matrixWorldInverse);
    const clip = new T.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant), e = m.projectionMatrix.elements;
    const q = new T.Vector4((Math.sign(clip.x) + e[8]) / e[0], (Math.sign(clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
    clip.multiplyScalar(2 / clip.dot(q)); e[2] = clip.x; e[6] = clip.y; e[10] = clip.z + 1; e[14] = clip.w;
    const previous = renderer.getRenderTarget(), clearColor = renderer.getClearColor(new T.Color()), clearAlpha = renderer.getClearAlpha();
    this.mesh.visible = false;
    renderer.setRenderTarget(this.target); renderer.setClearColor(0x000000, 0); renderer.clear(true, true, false);
    for (const s of scenes) renderer.render(s, m);
    renderer.setRenderTarget(previous); renderer.setClearColor(clearColor, clearAlpha);
    this.mesh.visible = true;
  }
}
