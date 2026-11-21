import * as T from "three";
import { bodyToInertial, inertialToBody, latLonToDir, dirToLatLon } from "./geo";
import { EARTH } from "./earth";
import { airVelocity } from "./combat-ai";
import type { Combat, Drone } from "./combat";
import type { RadarContact } from "./contacts";
import type { V } from "./vector";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

const R = EARTH.radius;
/** Ships are drawn 1.6 times life size in this game; submarines match. Small stores (buoys, torpedoes) are drawn 4 times. */
const SHIP = 1.6, STORE = 4;
const KN = 0.5144; // m/s per knot

/* ------------------------------------------------------------------------------------------------------------------
 * Boats. Fictional scenario, real classes and public dimensions:
 *   Yasen-M (Project 885M) SSGN, 139 m, beam 13 m: eight vertical launch silos aft of the sail, Kalibr cruise
 *     missiles launched submerged, pump-jet.
 *   Kilo (Project 636.3) diesel-electric, 74 m, beam 9.9 m: Kalibr from torpedo tubes; this one also carries a
 *     shoulder-launched SAM on its sail and uses it at periscope depth.
 *   Typhoon (Project 941) SSBN, 175 m, beam 23 m: the largest submarine ever built; twin pressure hulls under one
 *     casing, twenty missile tubes ahead of the sail, twin shrouded screws. Here it is surfaced and dives when found.
 * Values for speed, noise and damage are game values.
 * ---------------------------------------------------------------------------------------------------------------- */
export type SubClass = "yasen" | "kilo" | "typhoon";
export const SUBS: Record<SubClass, { name: string; type: string; length: number; beam: number; height: number; noise: number; hull: number; torpedo: number; charge: number; score: number }> = {
  yasen: { name: "YASEN-M", type: "SSGN · cruise-missile submarine", length: 139, beam: 13, height: 12, noise: 0.75, hull: 1, torpedo: 0.55, charge: 0.6, score: 4000 },
  kilo: { name: "KILO 636.3", type: "SSK · diesel-electric submarine", length: 74, beam: 9.9, height: 10, noise: 0.55, hull: 1, torpedo: 0.7, charge: 0.75, score: 2500 },
  typhoon: { name: "TYPHOON 941", type: "SSBN · ballistic-missile submarine", length: 175, beam: 23, height: 14, noise: 1.3, hull: 1, torpedo: 0.35, charge: 0.4, score: 6000 },
};

/** Anechoic tiles: a dark rubber skin laid in panels, as on Russian boats. */
function tiles(base: string, line: string) {
  const c = document.createElement("canvas"); c.width = c.height = 256; const g = c.getContext("2d")!;
  g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 16) for (let x = 0; x < 256; x += 16) { const v = Math.random() * 14 - 7; g.fillStyle = `rgba(${128 + v},${128 + v},${128 + v},0.05)`; g.fillRect(x + 1, y + 1, 14, 14); }
  g.strokeStyle = line; g.lineWidth = 1; for (let i = 0; i <= 256; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); }
  const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.colorSpace = T.SRGBColorSpace; t.anisotropy = 8; return t;
}
/** A teardrop/cylinder hull of revolution, bow toward -Z, with optional red antifouling below the waterline. */
function hull(L: number, Rr: number, bow: number, stern: number, sx: number, sy: number, mat: T.Material, red: boolean) {
  const pts: T.Vector2[] = [];
  for (let i = 0; i <= 60; i++) {
    const u = i / 60; let r: number;
    if (u < bow) r = Rr * Math.sqrt(1 - ((bow - u) / bow) ** 2);
    else if (u > 1 - stern) { const k = (u - (1 - stern)) / stern; r = Rr * (1 - Math.pow(k, 1.7) * 0.94); }
    else r = Rr;
    pts.push(new T.Vector2(Math.max(0.02, r), (u - 0.5) * L));
  }
  const g = new T.LatheGeometry(pts, 40); g.rotateX(-Math.PI / 2); g.rotateZ(Math.PI / 2); g.scale(sx, sy, 1);
  // Lathe makes +Y the axis; after rotateX(-90) the axis is -Z..+Z with y from the profile flipped: put the bow at -Z.
  g.rotateY(Math.PI);
  if (red) {
    const pos = g.getAttribute("position") as T.BufferAttribute, col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) { const below = pos.getY(i) < -Rr * sy * 0.28; col.set(below ? [0.55, 0.18, 0.15] : [1, 1, 1], i * 3); }
    g.setAttribute("color", new T.BufferAttribute(col, 3)); (mat as T.MeshStandardMaterial).vertexColors = true;
  }
  g.computeVertexNormals();
  return new T.Mesh(g, mat);
}
/** Sail (fin): a rounded teardrop plan extruded upward, with a bevel so the top edge reads as rounded. */
function sail(len: number, wid: number, h: number, mat: T.Material) {
  const s = new T.Shape(), n = 28;
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2, x = Math.sin(a) * wid / 2, z = -Math.cos(a) * len / 2; const fat = z < 0 ? 1 : 1 - (z / (len / 2)) * 0.45; i ? s.lineTo(x * fat, z) : s.moveTo(x * fat, z); }
  const g = new T.ExtrudeGeometry(s, { depth: h, bevelEnabled: true, bevelThickness: wid * 0.35, bevelSize: wid * 0.2, bevelSegments: 4, curveSegments: 6 });
  g.rotateX(-Math.PI / 2); g.rotateY(Math.PI); // extrusion now along +Y, rounded end forward (-Z)
  return new T.Mesh(g, mat);
}
function fin(span: number, root: number, tip: number, thick: number, mat: T.Material) {
  const s = new T.Shape(); s.moveTo(0, 0); s.lineTo(span, root - tip); s.lineTo(span, root); s.lineTo(0, root); s.closePath();
  const g = new T.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false }); g.translate(0, -root / 2, -thick / 2); return new T.Mesh(g, mat);
}
/** Control surfaces around the stern (or any station): `count` fins at the given roll angles, chord along the hull. */
function surfaces(g: T.Group, angles: number[], span: number, root: number, tip: number, thick: number, z: number, r0: number, y: number, mat: T.Material) {
  for (const a of angles) { const holder = new T.Group(); holder.rotation.z = a; holder.position.y = y; const f = fin(span, root, tip, thick, mat); f.rotation.x = Math.PI / 2; f.position.set(r0, 0, z); holder.add(f); g.add(holder); }
}
function propeller(r: number, blades: number, mat: T.Material) {
  const p = new T.Group();
  for (let i = 0; i < blades; i++) { const b = new T.Mesh(new T.BoxGeometry(r * 0.32, r, 0.12), mat); b.position.y = r / 2; b.rotation.y = 0.5; const arm = new T.Group(); arm.rotation.z = (i / blades) * Math.PI * 2; arm.add(b); p.add(arm); }
  p.add(new T.Mesh(new T.SphereGeometry(r * 0.22, 12, 8), mat)); return p;
}
export function buildSub(kind: SubClass) {
  const spec = SUBS[kind], g = new T.Group(), props: T.Object3D[] = [];
  const skin = new T.MeshStandardMaterial({ color: 0xffffff, map: tiles(kind === "typhoon" ? "#25282b" : "#1b1d20", "rgba(0,0,0,0.55)"), roughness: 0.92, metalness: 0.05 });
  (skin.map as T.Texture).repeat.set(spec.length / 6, 3);
  const plain = new T.MeshStandardMaterial({ color: 0x1d2023, roughness: 0.85, metalness: 0.1 }), bronze = new T.MeshStandardMaterial({ color: 0x8a6a3c, roughness: 0.45, metalness: 0.8 });
  const hatch = new T.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.7, metalness: 0.2 });
  const L = spec.length, Rr = spec.beam / 2;
  if (kind === "yasen") {
    g.add(hull(L, Rr * 0.98, 0.16, 0.3, 1, 1, skin, false));
    const fin1 = sail(26, 6.2, 7.2, skin); fin1.position.set(0, Rr * 0.82, -26); g.add(fin1);
    // Mast cluster: periscope, radar, communications, all raised at periscope depth.
    for (const [x, z, h, r] of [[0.8, -30, 5, 0.3], [-0.8, -27, 4.2, 0.35], [0, -22, 3.4, 0.5], [0.9, -19, 2.8, 0.25]]) { const m = new T.Mesh(new T.CylinderGeometry(r, r, h, 10), plain); m.position.set(x, Rr * 0.82 + 7.2 + h / 2, z); g.add(m); }
    // Eight vertical launch silos in two rows aft of the sail, the Kalibr magazine.
    for (let i = 0; i < 8; i++) { const x = (i % 2 ? 1 : -1) * 2.4, z = -6 + Math.floor(i / 2) * 4.6, h1 = new T.Mesh(new T.BoxGeometry(3.4, 0.35, 3.6), hatch); h1.position.set(x, Rr * 0.97, z); g.add(h1); }
    // Flank arrays along the sides, retracted bow planes, cruciform stern with a pump-jet.
    for (const side of [1, -1]) { const a = new T.Mesh(new T.BoxGeometry(0.5, 1.2, 70), plain); a.position.set(side * Rr * 0.98, -0.5, 0); g.add(a); }
    surfaces(g, [0, Math.PI], 4.5, 3, 2, 0.4, -L * 0.36, Rr * 0.85, 0, plain);
    surfaces(g, [0, Math.PI / 2, Math.PI, Math.PI * 1.5], 6.5, 9, 5, 0.5, L * 0.38, Rr * 0.25, 0, plain);
    const shroud = new T.Mesh(new T.CylinderGeometry(3.4, 3.1, 4.5, 28, 1, true), plain); shroud.rotation.x = Math.PI / 2; shroud.position.z = L / 2 - 1.5; (shroud.material as T.Material).side = T.DoubleSide; g.add(shroud);
    const rotor = propeller(3, 11, bronze); rotor.position.z = L / 2 - 1.2; g.add(rotor); props.push(rotor);
  } else if (kind === "kilo") {
    g.add(hull(L, Rr * 0.95, 0.2, 0.36, 1, 1.02, skin, true));
    const fin1 = sail(17, 4.6, 6, skin); fin1.position.set(0, Rr * 0.86, -9); g.add(fin1);
    for (const [x, z, h, r] of [[0, -12, 5, 0.32], [0.7, -9, 4, 0.3], [-0.6, -6, 3.2, 0.45]]) { const m = new T.Mesh(new T.CylinderGeometry(r, r, h, 10), plain); m.position.set(x, Rr * 0.86 + 6 + h / 2, z); g.add(m); }
    // The SAM launcher on the sail (a short box on a pedestal), bow planes on the casing, cruciform stern, seven blades.
    const sam = new T.Mesh(new T.BoxGeometry(1.6, 0.8, 1.4), plain); sam.position.set(0, Rr * 0.86 + 6.6, -3); g.add(sam); sam.name = "sam";
    surfaces(g, [0, Math.PI], 4, 3, 2.2, 0.35, -L * 0.33, Rr * 0.7, Rr * 0.4, plain);
    surfaces(g, [0, Math.PI / 2, Math.PI, Math.PI * 1.5], 5, 7, 4, 0.45, L * 0.4, Rr * 0.2, 0, plain);
    const prop = propeller(2.1, 7, bronze); prop.position.z = L / 2 + 0.4; g.add(prop); props.push(prop);
  } else {
    // Typhoon: one broad casing over two pressure hulls; flattened, 23 m wide.
    g.add(hull(L, Rr, 0.14, 0.24, 1, 0.58, skin, true));
    const deck = new T.Mesh(new T.BoxGeometry(Rr * 1.1, 1.2, L * 0.6), skin); deck.position.set(0, Rr * 0.52, -L * 0.05); g.add(deck);
    const fin1 = sail(28, 9, 9, skin); fin1.position.set(0, Rr * 0.55, L * 0.12); g.add(fin1);
    for (const [x, z, h, r] of [[1.2, 8, 5.5, 0.35], [-1, 11, 4.5, 0.4], [0, 15, 3.5, 0.55]]) { const m = new T.Mesh(new T.CylinderGeometry(r, r, h, 10), plain); m.position.set(x, Rr * 0.55 + 9 + h / 2, z + L * 0.12 - 10); g.add(m); }
    // Twenty missile tubes in two rows of ten ahead of the sail.
    for (let i = 0; i < 20; i++) { const x = (i % 2 ? 1 : -1) * 3.4, z = -58 + Math.floor(i / 2) * 5.2, h1 = new T.Mesh(new T.CylinderGeometry(1.5, 1.5, 0.35, 18), hatch); h1.position.set(x, Rr * 0.52 + 0.75, z); g.add(h1); }
    surfaces(g, [0, Math.PI], 6, 4.5, 3, 0.5, -L * 0.38, Rr * 0.9, 0, plain);
    surfaces(g, [0, Math.PI], 11, 13, 8, 0.7, L * 0.4, Rr * 0.5, -1, plain);
    for (const side of [1, -1]) {
      // Twin shafts in shrouds.
      const shroud = new T.Mesh(new T.CylinderGeometry(3.1, 2.9, 3.4, 28, 1, true), plain); shroud.rotation.x = Math.PI / 2; shroud.position.set(side * 6, -1.6, L / 2 - 6); (shroud.material as T.Material).side = T.DoubleSide; g.add(shroud);
      const prop = propeller(2.8, 7, bronze); prop.position.set(side * 6, -1.6, L / 2 - 5.6); g.add(prop); props.push(prop); }
    surfaces(g, [Math.PI / 2], 10, 14, 9, 0.8, L * 0.43, Rr * 0.3, 0, plain);
  }
  g.scale.setScalar(0.001 * SHIP);
  g.userData = { props };
  return g;
}

/**
 * Detailed boats, CC BY 4.0 from Sketchfab (credited in public/models/CREDITS.md), used when the files are present:
 * the hand-built hulls above stay as the fallback. Each file is centred, turned bow to -Z and scaled to the real length.
 */
const DETAILED: Record<SubClass, string> = { typhoon: "models/typhoon.glb", kilo: "models/kilo.glb", yasen: "models/yasen.glb" };
let detailed: Promise<Partial<Record<SubClass, T.Object3D>>> | null = null;
export function loadDetailedSubs() {
  if (detailed) return detailed;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  detailed = Promise.all((Object.keys(DETAILED) as SubClass[]).map(async (kind) => {
    try {
      const scene = (await loader.loadAsync(DETAILED[kind])).scene;
      // The Typhoon file ships with a sea plane under the boat; the game draws its own sea.
      scene.getObjectByName("Object_40")?.removeFromParent();
      scene.updateMatrixWorld(true);
      const box = new T.Box3().setFromObject(scene), size = box.getSize(new T.Vector3()), centre = box.getCenter(new T.Vector3());
      // Hull axis height: the keel plus half the real beam, so the sail does not pull the boat down in the water.
      const length = Math.max(size.x, size.z), k = SUBS[kind].length / length;
      centre.y = box.min.y + SUBS[kind].beam / 2 / k;
      scene.position.sub(centre); const wrap = new T.Group(); wrap.add(scene);
      // Checked in game against each boat's heading: the Typhoon's bow is at -Z already, the Yasen's at +Z, the Kilo's at -X.
      wrap.rotation.y = size.x > size.z ? -Math.PI / 2 : kind === "yasen" ? Math.PI : 0;
      wrap.scale.setScalar(k);
      const outer = new T.Group(); outer.add(wrap); return [kind, outer] as const;
    } catch { return [kind, null] as const; }
  })).then((pairs) => Object.fromEntries(pairs.filter(([, m]) => m)) as Partial<Record<SubClass, T.Object3D>>);
  return detailed;
}
/** Kalibr (3M-14) land-attack cruise missile: 6.2 m body, pop-out wings, folding tail fins; booster as a separate stage. Metres. */
function kalibr() {
  const g = new T.Group(), skin = new T.MeshStandardMaterial({ color: 0xc8ccc8, roughness: 0.5, metalness: 0.3 }), dark = new T.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.6 });
  const body = new T.Mesh(new T.CylinderGeometry(0.27, 0.27, 6.2, 16).rotateX(Math.PI / 2), skin); g.add(body);
  const nose = new T.Mesh(new T.ConeGeometry(0.27, 0.9, 16).rotateX(-Math.PI / 2), skin); nose.position.z = -3.55; g.add(nose);
  for (const side of [1, -1]) { const w = new T.Mesh(new T.BoxGeometry(1.5, 0.05, 0.5), skin); w.position.set(side * 0.95, 0.1, -0.5); g.add(w); }
  for (let i = 0; i < 4; i++) { const f = new T.Mesh(new T.BoxGeometry(0.55, 0.04, 0.4), dark); const h = new T.Group(); h.rotation.z = (i * Math.PI) / 2 + Math.PI / 4; f.position.set(0.45, 0, 2.8); h.add(f); g.add(h); }
  const booster = new T.Mesh(new T.CylinderGeometry(0.3, 0.3, 2.2, 14).rotateX(Math.PI / 2), dark); booster.position.z = 4.2; booster.name = "booster"; g.add(booster);
  const flame = new T.Mesh(new T.ConeGeometry(0.35, 3.2, 12).rotateX(Math.PI / 2), new T.MeshBasicMaterial({ color: new T.Color(4, 2.2, 0.8), transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false, blending: T.AdditiveBlending })); flame.position.z = 6.9; flame.name = "flame"; g.add(flame);
  g.scale.setScalar(0.001 * 5);
  return g;
}
function store(kind: "buoy" | "torpedo" | "charge") {
  const g = new T.Group(), yellow = new T.MeshStandardMaterial({ color: kind === "buoy" ? 0xd8b23a : 0x5a6168, roughness: 0.6, metalness: 0.2 });
  if (kind === "buoy") {
    g.add(new T.Mesh(new T.CylinderGeometry(0.06, 0.06, 0.9, 10), yellow));
    const mast = new T.Mesh(new T.CylinderGeometry(0.008, 0.008, 0.8, 4), new T.MeshStandardMaterial({ color: 0x111111 })); mast.position.y = 0.8; g.add(mast);
    const lamp = new T.Mesh(new T.SphereGeometry(0.03, 8, 6), new T.MeshBasicMaterial({ color: new T.Color(4, 0.8, 0.4), toneMapped: false })); lamp.position.y = 1.22; lamp.name = "lamp"; g.add(lamp);
  } else if (kind === "torpedo") {
    const b = new T.Mesh(new T.CylinderGeometry(0.16, 0.16, 2.7, 14).rotateX(Math.PI / 2), yellow); g.add(b);
    const n = new T.Mesh(new T.SphereGeometry(0.16, 12, 8), yellow); n.position.z = -1.35; g.add(n);
    const chute = new T.Mesh(new T.SphereGeometry(0.9, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), new T.MeshStandardMaterial({ color: 0xe8e0d0, side: T.DoubleSide, roughness: 0.9 })); chute.position.y = 2.4; chute.name = "chute"; g.add(chute);
  } else {
    const b = new T.Mesh(new T.CylinderGeometry(0.22, 0.22, 0.9, 14), yellow); g.add(b);
  }
  g.scale.setScalar(0.001 * STORE);
  return g;
}

/* ------------------------------------------------------------------------------------------------------------------
 * Sea effects: spray, mist, foam, smoke and flame as billboards in an Earth-fixed frame around the aircraft.
 * ---------------------------------------------------------------------------------------------------------------- */
const FX_MAX = 5000;
type FxKind = 0 | 1 | 2 | 3 | 4 | 5; // 0 spray, 1 mist, 2 foam, 3 smoke, 4 flame, 5 oil
class SeaFx {
  mesh: T.Mesh; private n = 0;
  private pos = new Float32Array(FX_MAX * 3); private vel = new Float32Array(FX_MAX * 3); private age = new Float32Array(FX_MAX); private life = new Float32Array(FX_MAX);
  private size = new Float32Array(FX_MAX * 2); private kind = new Uint8Array(FX_MAX); private seed = new Float32Array(FX_MAX);
  private offset: T.InstancedBufferAttribute; private look: T.InstancedBufferAttribute; private geom = new T.InstancedBufferGeometry();
  anchor = new T.Vector3(1, 0, 0); east = new T.Vector3(); north = new T.Vector3(); up = new T.Vector3();
  uniforms = { light: { value: new T.Color(1, 1, 1) }, ambient: { value: new T.Color(0.4, 0.45, 0.5) } };
  constructor() {
    this.geom.setAttribute("position", new T.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3)); this.geom.setIndex([0, 1, 2, 0, 2, 3]);
    this.offset = new T.InstancedBufferAttribute(new Float32Array(FX_MAX * 3), 3); this.look = new T.InstancedBufferAttribute(new Float32Array(FX_MAX * 4), 4);
    this.offset.setUsage(T.DynamicDrawUsage); this.look.setUsage(T.DynamicDrawUsage); this.geom.setAttribute("offset", this.offset); this.geom.setAttribute("look", this.look); this.geom.instanceCount = 0;
    this.mesh = new T.Mesh(this.geom, new T.ShaderMaterial({ uniforms: this.uniforms, transparent: true, depthWrite: false, vertexShader: `
attribute vec3 offset;attribute vec4 look;varying vec2 vC;varying vec4 vL;
#include <common>
#include <logdepthbuf_pars_vertex>
void main(){vC=position.xy;vL=look;vec4 mv=modelViewMatrix*vec4(offset,1.);float a=look.w*6.283;mv.xy+=mat2(cos(a),sin(a),-sin(a),cos(a))*position.xy*look.x*.001;gl_Position=projectionMatrix*mv;
#include <logdepthbuf_vertex>
}`, fragmentShader: `
uniform vec3 light,ambient;varying vec2 vC;varying vec4 vL;
#include <common>
#include <logdepthbuf_pars_fragment>
void main(){
#include <logdepthbuf_fragment>
float r=length(vC);if(r>1.)discard;float ang=atan(vC.y,vC.x)+vL.w*40.;float edge=.74+.16*sin(ang*5.+vL.w*17.)+.1*sin(ang*11.);float a=smoothstep(edge,edge*.4,r);
float k=vL.z;vec3 white=ambient*1.35+light*.55,smoke=ambient*.55+light*.22,flame=vec3(5.,2.4,.7),oil=vec3(.03,.03,.035);
vec3 c=k<.5?white:k<1.5?white*.95:k<2.5?white*1.05:k<3.5?smoke:k<4.5?flame:oil;
gl_FragColor=vec4(c,a*vL.y);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}` }));
    this.mesh.frustumCulled = false; this.mesh.scale.setScalar(0.001); this.mesh.name = "Sea effects";
  }
  /** Earth-fixed metres (east, up, south) around `anchor`; re-anchors near the aircraft and carries live particles over. */
  setAnchor(dir: T.Vector3) {
    if (this.n && this.anchor.angleTo(dir) * R < 4) return;
    const old = { a: this.anchor.clone(), e: this.east.clone(), n: this.north.clone(), u: this.up.clone() };
    this.anchor.copy(dir).normalize(); this.up.copy(this.anchor); this.east.set(0, 1, 0).cross(this.up).normalize(); this.north.copy(this.up).cross(this.east);
    for (let i = 0; i < this.n; i++) {
      const w = old.a.clone().multiplyScalar(R * 1000).addScaledVector(old.e, this.pos[i * 3]).addScaledVector(old.u, this.pos[i * 3 + 1]).addScaledVector(old.n, -this.pos[i * 3 + 2]).sub(this.anchor.clone().multiplyScalar(R * 1000));
      this.pos[i * 3] = w.dot(this.east); this.pos[i * 3 + 1] = w.dot(this.up); this.pos[i * 3 + 2] = -w.dot(this.north);
    }
  }
  /** Local metres of an Earth-fixed point given in km. */
  local(body: T.Vector3) { const d = body.clone().multiplyScalar(1000).sub(this.anchor.clone().multiplyScalar(R * 1000)); return new T.Vector3(d.dot(this.east), d.dot(this.up), -d.dot(this.north)); }
  emit(at: T.Vector3, v: T.Vector3, life: number, kind: FxKind, size: number, grow: number) {
    if (this.n >= FX_MAX) return; const i = this.n++;
    this.pos.set([at.x, at.y, at.z], i * 3); this.vel.set([v.x, v.y, v.z], i * 3); this.age[i] = 0; this.life[i] = life; this.kind[i] = kind; this.size[i * 2] = size; this.size[i * 2 + 1] = grow; this.seed[i] = Math.random();
  }
  /** A burst of `count` particles from a point, upward speed `lift` m/s with spread `spread`. */
  burst(at: T.Vector3, count: number, kind: FxKind, lift: number, spread: number, life: number, size: number, grow: number) {
    for (let k = 0; k < count; k++) { const a = Math.random() * Math.PI * 2, s = Math.random() * spread; this.emit(at.clone().add(new T.Vector3(Math.cos(a) * s * 0.15, 0, Math.sin(a) * s * 0.15)), new T.Vector3(Math.cos(a) * s, lift * (0.6 + Math.random() * 0.6), Math.sin(a) * s), life * (0.7 + Math.random() * 0.6), kind, size * (0.7 + Math.random() * 0.6), grow); }
  }
  update(dt: number, time: number, ship: T.Vector3) {
    let m = 0;
    for (let i = 0; i < this.n; i++) {
      const age = this.age[i] + dt; if (age >= this.life[i]) continue;
      const k = this.kind[i], heavy = k === 0, flat = k === 2 || k === 5;
      let vx = this.vel[i * 3], vy = this.vel[i * 3 + 1], vz = this.vel[i * 3 + 2];
      const drag = Math.exp(-dt * (heavy ? 0.35 : flat ? 2 : 1.1)); vx *= drag; vz *= drag; vy = heavy ? vy - 9.81 * dt : k === 3 ? vy * drag + 0.6 * dt : vy * drag;
      let y = this.pos[i * 3 + 1] + vy * dt; if (heavy && y < 0) continue; if (flat) y = 0.4;
      this.pos[m * 3] = this.pos[i * 3] + vx * dt; this.pos[m * 3 + 1] = y; this.pos[m * 3 + 2] = this.pos[i * 3 + 2] + vz * dt;
      this.vel[m * 3] = vx; this.vel[m * 3 + 1] = vy; this.vel[m * 3 + 2] = vz; this.age[m] = age; this.life[m] = this.life[i]; this.kind[m] = k; this.size[m * 2] = this.size[i * 2]; this.size[m * 2 + 1] = this.size[i * 2 + 1]; this.seed[m] = this.seed[i]; m++;
    }
    this.n = m;
    const off = this.offset.array as Float32Array, look = this.look.array as Float32Array;
    for (let i = 0; i < m; i++) {
      const u = this.age[i] / this.life[i], k = this.kind[i];
      off[i * 3] = this.pos[i * 3]; off[i * 3 + 1] = this.pos[i * 3 + 1]; off[i * 3 + 2] = this.pos[i * 3 + 2];
      look[i * 4] = this.size[i * 2] * (1 + this.size[i * 2 + 1] * Math.min(this.age[i], 30));
      look[i * 4 + 1] = (k === 0 ? 0.85 : k === 1 ? 0.35 : k === 2 ? 0.55 : k === 3 ? 0.5 : k === 4 ? 0.9 : 0.6) * Math.min(1, u * 10) * (1 - u) ** (k === 4 ? 2 : 1);
      look[i * 4 + 2] = k; look[i * 4 + 3] = this.seed[i];
    }
    this.geom.instanceCount = m; this.offset.needsUpdate = this.look.needsUpdate = true;
    const spin = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), (time / EARTH.rotation) * Math.PI * 2);
    this.mesh.quaternion.copy(spin).multiply(new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(this.east, this.up, this.north.clone().negate())));
    this.mesh.position.set(...bodyToInertial(this.anchor.clone().multiplyScalar(R).toArray() as V, time, EARTH.rotation)).sub(ship);
    this.mesh.visible = m > 0;
  }
}

/* ------------------------------------------------------------------------------------------------------------------
 * The hunt.
 * ---------------------------------------------------------------------------------------------------------------- */
/** Water depth: the eastern English Channel is shallow, about 40-70 m; 55 m is used across the scenario box. */
export function seabed(lat: number, lon: number) { return lat > 49.7 && lat < 51.1 && lon > -1.8 && lon < 1.8 ? 55 : 150; }
export const LOADOUT = { buoys: 16, torpedoes: 4, charges: 8 };
export const TARGETS = { westminster: { lat: 51.5007, lon: -0.1246, name: "Westminster" }, wharf: { lat: 51.5054, lon: -0.0235, name: "Canary Wharf" } };

interface Sub { kind: SubClass; lat: number; lon: number; depth: number; want: number; heading: number; turnTo: number; speed: number; hull: number; mode: "patrol" | "launch" | "evade" | "surfaced" | "diving" | "sunk"; alerted: number; noisy: number; model: T.Group; drone: Drone; launches: { at: number; target: keyof typeof TARGETS }[]; reload: number; sunkAt: number; id: string }
interface Missile { id: number; b: T.Vector3; dir: T.Vector3; speed: number; phase: "capsule" | "boost" | "cruise" | "terminal"; age: number; waypoints: T.Vector3[]; target: keyof typeof TARGETS; model: T.Group; drone: Drone; alive: boolean; from: Sub; seen: number }
interface Buoy { b: T.Vector3; vel: T.Vector3; inWater: boolean; life: number; model: T.Group; ping: number }
interface Weapon { kind: "torpedo" | "charge"; b: T.Vector3; vel: T.Vector3; depth: number; inWater: boolean; life: number; model: T.Group; setDepth: number; target: Sub | null; heading: number; acquired: boolean }
interface Contact { sub: Sub; est: T.Vector3; err: number; depth: number | null; seen: number; active: boolean; identified: boolean; label: string }

const up = (b: T.Vector3) => b.clone().normalize();
const bodyAt = (lat: number, lon: number, h = 0) => new T.Vector3(...latLonToDir(lat, lon)).multiplyScalar(R + h / 1000);
const enu = (b: T.Vector3) => { const u = b.clone().normalize(), e = new T.Vector3(0, 1, 0).cross(u).normalize(), n = u.clone().cross(e); return { u, e, n }; };
const height = (b: T.Vector3) => (b.length() - R) * 1000;

export class SubHunt {
  group = new T.Group(); fx = new SeaFx(); active = false; subs: Sub[] = []; missiles: Missile[] = []; buoys: Buoy[] = []; weapons: Weapon[] = []; contacts: Contact[] = [];
  stores = { ...LOADOUT }; chargeDepth = 40; selected = 0; log: string[] = []; impacts = 0; destroyedMissiles = 0; launched = 0; clock = 0;
  /** Host hooks: terrain height (m), sounds, a line in the HUD log. */
  ground: (lat: number, lon: number) => number = () => 0;
  sound: (kind: "ping" | "splash" | "blast" | "launch", level: number) => void = () => {};
  onImpact: ((p: T.Vector3, name: string) => void) | null = null;
  private serial = 960000; private pingReady = 0; private lastSonar = 0;
  constructor() { this.group.name = "Submarine hunt"; this.group.add(this.fx.mesh); }

  /** Sets up the scenario: the Yasen-M south of Beachy Head with two Kalibr for London, a Kilo off Hastings, a surfaced Typhoon. */
  start() {
    this.stop(); this.active = true; this.clock = 0; this.stores = { ...LOADOUT }; this.chargeDepth = 40; this.impacts = this.destroyedMissiles = this.launched = 0; this.log = [];
    this.add("yasen", 50.43, 0.48, 40, 20, [{ at: 30, target: "westminster" }, { at: 42, target: "wharf" }]);
    this.add("kilo", 50.5, 0.88, 12, 300, []);
    this.add("typhoon", 50.31, 0.12, 0, 250, []);
    this.note("MAGIC 21: submarine activity south of Beachy Head · expect cruise missile launches toward London");
  }
  stop() {
    for (const o of [...this.subs.map((s) => s.model), ...this.missiles.map((m) => m.model), ...this.buoys.map((b) => b.model), ...this.weapons.map((w) => w.model)]) this.group.remove(o);
    this.subs = []; this.missiles = []; this.buoys = []; this.weapons = []; this.contacts = []; this.active = false;
  }
  private add(kind: SubClass, lat: number, lon: number, depth: number, heading: number, launches: Sub["launches"]) {
    const model = buildSub(kind); this.group.add(model);
    const spec = SUBS[kind];
    const sub: Sub = { kind, lat, lon, depth, want: depth, heading: (heading * Math.PI) / 180, turnTo: (heading * Math.PI) / 180, speed: (kind === "typhoon" ? 8 : 5) * KN, hull: 1, mode: depth < 1 ? "surfaced" : "patrol", alerted: 0, noisy: 0, model, launches, reload: 0, sunkAt: -1, id: `S${this.subs.length + 1}`,
      drone: { id: ++this.serial, ground: true, external: true, name: `${spec.name}`, radius: (spec.length * SHIP) / 2000, p: new T.Vector3(), v: new T.Vector3(), hp: 12, maxHp: 12, phase: 0 } };
    // Gun and missile hits only count while it is on the surface (see `targets`): each costs an eighth of the hull.
    sub.drone.destroy = () => this.damage(sub, 1, "Sunk by gunfire and missiles on the surface");
    this.subs.push(sub);
    // Swap in the detailed model once it has loaded (the hand-built one stays if the file is missing).
    void loadDetailedSubs().then((models) => { const m = models[kind]; if (!m || !this.subs.includes(sub)) return; model.clear(); model.add(m.clone()); model.scale.setScalar(0.001 * SHIP); model.userData.props = []; });
  }
  note(text: string) { this.log.unshift(text); this.log.length = Math.min(this.log.length, 5); }
  /** Combat targets: cruise missiles in flight, and any boat on the surface. */
  get targets() { return [...this.missiles.filter((m) => m.alive && m.phase !== "capsule").map((m) => m.drone), ...this.subs.filter((s) => s.mode !== "sunk" && s.depth < 4).map((s) => s.drone)]; }

  // ---- player actions -------------------------------------------------------------------------------------------
  /** Drops a store from the aircraft. Returns a message to flash. `body`/`vel` are the aircraft's Earth-fixed km and m/s. */
  drop(kind: "buoy" | "torpedo" | "charge", body: T.Vector3, vel: T.Vector3) {
    const h = height(body), ll = dirToLatLon(up(body).toArray() as V);
    if (kind === "buoy") { if (!this.stores.buoys) return "No sonobuoys left"; this.stores.buoys--; const model = store("buoy"); this.group.add(model); this.buoys.push({ b: body.clone(), vel: vel.clone().multiplyScalar(0.25), inWater: false, life: 900, model, ping: 0 }); return `Sonobuoy away · ${this.stores.buoys} left`; }
    if (kind === "torpedo") {
      if (!this.stores.torpedoes) return "No torpedoes left";
      if (h > 2200) return "Too high to drop a torpedo: release below 2,200 m";
      if (vel.length() > 300) return "Too fast to drop a torpedo: slow below 300 m/s";
      this.stores.torpedoes--; const model = store("torpedo"); this.group.add(model);
      const c = this.contacts[this.selected % Math.max(1, this.contacts.length)];
      this.weapons.push({ kind, b: body.clone(), vel: vel.clone().multiplyScalar(0.3), depth: 0, inWater: false, life: 360, model, setDepth: 0, target: c?.sub ?? null, heading: 0, acquired: false });
      return `Torpedo away · ${this.stores.torpedoes} left${c ? ` · aimed at ${c.label}` : " · no contact: it will search"}`;
    }
    if (!this.stores.charges) return "No depth charges left";
    if (h > 3000) return "Too high for depth charges: drop below 3,000 m";
    this.stores.charges--; const model = store("charge"); this.group.add(model);
    const depth = Math.min(this.chargeDepth, seabed(ll.lat, ll.lon) - 2);
    this.weapons.push({ kind, b: body.clone(), vel: vel.clone(), depth: 0, inWater: false, life: 120, model, setDepth: depth, target: null, heading: 0, acquired: false });
    return `Depth charge away · set ${depth.toFixed(0)} m · ${this.stores.charges} left`;
  }
  /** Active sonar: every buoy in the water pings. Finds boats within 6 km exactly, depth included, and alerts them. */
  ping(time: number) {
    if (time < this.pingReady) return `Sonar recharging · ${Math.ceil(this.pingReady - time)} s`;
    const wet = this.buoys.filter((b) => b.inWater); if (!wet.length) return "No sonobuoys in the water to ping";
    this.pingReady = time + 8; this.sound("ping", 1);
    let found = 0;
    for (const b of wet) { b.ping = 1.5; const l = this.fx.local(b.b); this.fx.burst(l, 14, 2, 0, 6, 4, 10, 0.4); }
    for (const s of this.subs) {
      if (s.mode === "sunk") continue; const p = bodyAt(s.lat, s.lon);
      if (wet.some((b) => b.b.distanceTo(p) < 6)) { found++; s.alerted = 40; this.contact(s, p, 0.03, s.depth, true, time); }
    }
    return found ? `Active ping · ${found} contact${found > 1 ? "s" : ""} fixed with depth · they know you are there` : "Active ping · no echoes inside 6 km";
  }
  cycle() { if (this.contacts.length) this.selected = (this.selected + 1) % this.contacts.length; return this.contacts.length ? `Sonar target ${this.contacts[this.selected].label}` : "No sonar contacts"; }
  depthStep(d: number) { this.chargeDepth = Math.max(10, Math.min(150, this.chargeDepth + d)); return `Depth charges set to ${this.chargeDepth} m`; }

  private contact(s: Sub, p: T.Vector3, err: number, depth: number | null, active: boolean, time: number) {
    let c = this.contacts.find((x) => x.sub === s);
    if (!c) { c = { sub: s, est: p.clone(), err, depth, seen: time, active, identified: false, label: "" }; this.contacts.push(c); }
    const { e, n } = enu(p), a = Math.random() * Math.PI * 2, r = err * Math.sqrt(Math.random());
    c.est.copy(p).addScaledVector(e, Math.cos(a) * r).addScaledVector(n, Math.sin(a) * r); c.err = err; c.seen = time; c.active = active;
    if (depth !== null) c.depth = depth; if (active || err < 0.4) c.identified = true;
    c.label = `${s.id} ${c.identified ? SUBS[s.kind].name : "SUB?"}`;
  }

  // ---- simulation ------------------------------------------------------------------------------------------------
  update(dt: number, time: number, ship: T.Vector3, shipBody: T.Vector3, combat: Combat) {
    this.fx.setAnchor(shipBody.clone().normalize());
    if (this.active && dt > 0) {
      this.clock += dt;
      for (const s of this.subs) this.steer(s, dt, time, shipBody, combat);
      for (const m of this.missiles) this.fly(m, dt, time, combat);
      this.drift(dt, time);
      if (time - this.lastSonar > 1) { this.lastSonar = time; this.listen(time); }
      this.contacts = this.contacts.filter((c) => c.sub.mode !== "sunk" && time - c.seen < 45);
      for (const c of this.contacts) c.err = Math.min(3, c.err + dt * 0.01);
    }
    this.place(time, ship);
    this.fx.update(dt, time, ship);
  }
  private steer(s: Sub, dt: number, time: number, shipBody: T.Vector3, combat: Combat) {
    const spec = SUBS[s.kind], floor = seabed(s.lat, s.lon) - 8, here = bodyAt(s.lat, s.lon);
    s.alerted = Math.max(0, s.alerted - dt); s.noisy = Math.max(0, s.noisy - dt); s.reload = Math.max(0, s.reload - dt);
    if (s.mode === "sunk") { s.depth = Math.min(seabed(s.lat, s.lon), s.depth + dt * 1.8); s.speed *= Math.exp(-dt * 0.3); if (this.clock - s.sunkAt < 60 && Math.random() < dt * 6) { const l = this.fx.local(here); this.fx.emit(l.add(new T.Vector3((Math.random() - 0.5) * 30, 0.3, (Math.random() - 0.5) * 30)), new T.Vector3(), 40, Math.random() < 0.5 ? 5 : 2, 8, 0.25); } }
    else {
      // Launch schedule (Yasen): rise to launch depth, fire, then run.
      const next = s.launches[0];
      if (next && this.clock > next.at - 8) { s.mode = "launch"; s.want = Math.min(35, floor); if (this.clock >= next.at && Math.abs(s.depth - s.want) < 4) { s.launches.shift(); this.launch(s, next.target, time); s.noisy = 25; } }
      else if (s.mode === "launch") { s.mode = "evade"; s.alerted = 60; }
      if (s.kind === "typhoon" && s.mode === "surfaced" && (s.alerted > 0 || s.hull < 1)) { s.mode = "diving"; s.want = Math.min(30, floor); this.note("TYPHOON is diving"); }
      if (s.kind === "kilo") {
        if (s.alerted > 0) { s.mode = "evade"; s.want = Math.min(40, floor); }
        else if (s.mode !== "patrol") { s.mode = "patrol"; s.want = 12; }
        // At periscope depth the Kilo's SAM watches for low, slow aircraft hunting it.
        const p = new T.Vector3(...bodyToInertial(bodyAt(s.lat, s.lon, 14).toArray() as V, time, EARTH.rotation)), shipI = new T.Vector3(...bodyToInertial(shipBody.toArray() as V, time, EARTH.rotation)), d = p.distanceTo(shipI), alt = height(shipBody);
        if (s.depth < 14 && s.reload === 0 && d < 6 && alt < 3000 && combat.active) {
          const dir = shipI.clone().sub(p).normalize().add(p.clone().normalize().multiplyScalar(0.6)).normalize();
          combat.incoming.push({ p: p.clone(), v: airVelocity(p).addScaledVector(dir, 0.12), age: 0, life: 14, weapon: "missile", damage: 30, turn: 0.85, accel: 0.55, maxSpeed: 0.68, owner: s.drone.id, name: "SAM" });
          s.reload = 16; s.noisy = 10; this.sound("launch", Math.max(0.1, 1 - d / 8)); combat.event?.("enemyGun", p); this.note("KILO fired a SAM from periscope depth");
          const l = this.fx.local(bodyAt(s.lat, s.lon, 10)); this.fx.burst(l, 18, 1, 6, 4, 4, 6, 0.4);
        }
      }
      if (s.mode === "evade" || (s.mode === "diving" && s.depth > 20)) {
        // Run away from the nearest buoy or the aircraft at speed, turning in steps.
        const threats = [...this.buoys.filter((b) => b.inWater).map((b) => b.b), shipBody];
        const near = threats.sort((a, b) => a.distanceTo(here) - b.distanceTo(here))[0], { e, n } = enu(here), away = here.clone().sub(near);
        if (s.alerted > 0) s.turnTo = Math.atan2(away.dot(e), away.dot(n)) + Math.sin(time * 0.05 + s.lat) * 0.6;
        s.speed += ((s.kind === "kilo" ? 14 : 22) * KN - s.speed) * dt * 0.1; if (s.mode === "evade") s.want = Math.min(Math.max(s.want, 35), floor);
      } else s.speed += ((s.kind === "typhoon" ? 8 : 5) * KN - s.speed) * dt * 0.05;
    }
    // Move along the heading; change depth at up to 1 m/s.
    const dh = ((s.turnTo - s.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI; s.heading += Math.sign(dh) * Math.min(Math.abs(dh), dt * 0.02);
    if (s.mode !== "sunk") s.depth += Math.sign(s.want - s.depth) * Math.min(Math.abs(s.want - s.depth), dt * (s.mode === "diving" ? 0.5 : 1));
    if (s.mode === "diving" && s.depth >= s.want - 1) s.mode = "evade";
    const km = (s.speed * dt) / 1000; s.lat += (km * Math.cos(s.heading)) / 111.2; s.lon += (km * Math.sin(s.heading)) / (111.2 * Math.cos((s.lat * Math.PI) / 180));
    // Periscope-depth and surfaced boats leave a wake: foam along the hull and a feather at the masts.
    if (s.depth < 16 && s.mode !== "sunk" && s.speed > 1 && Math.random() < dt * 8) {
      const l = this.fx.local(here), { e, n } = enu(here), back = new T.Vector3(-Math.sin(s.heading), 0, Math.cos(s.heading)); void e; void n;
      const mast = l.clone().addScaledVector(back, s.kind === "typhoon" ? -40 : 30 * SHIP); this.fx.emit(mast.setY(0.6), new T.Vector3(0, 0.5, 0), 12, 2, 4, 0.5);
      if (s.depth < 2) for (const side of [-1, 1]) this.fx.emit(l.clone().addScaledVector(back, -SUBS[s.kind].length * 0.75 * SHIP).add(new T.Vector3(-back.z * side * 8, 0.5, back.x * side * 8)), new T.Vector3(-back.z * side * 2, 0, back.x * side * 2), 25, 2, 6, 0.6);
    }
    void spec;
  }
  /** A Kalibr leaves the boat in a capsule, breaks the surface on its booster and then flies low to the target. */
  private launch(s: Sub, target: keyof typeof TARGETS, time: number) {
    const t = TARGETS[target], start = bodyAt(s.lat, s.lon, -s.depth), model = kalibr(); this.group.add(model);
    const coast = target === "westminster" ? [bodyAt(50.86, 0.56, 0), bodyAt(51.17, 0.18, 0)] : [bodyAt(50.9, 0.75, 0), bodyAt(51.2, 0.45, 0)];
    const m: Missile = { id: ++this.serial, b: start, dir: up(start), speed: 0.03, phase: "capsule", age: 0, waypoints: [...coast, bodyAt(t.lat, t.lon, 0)], target, model, alive: true, from: s, seen: time,
      drone: { id: this.serial, ground: false, external: true, name: "KALIBR CRUISE MISSILE", radius: 0.03, p: new T.Vector3(), v: new T.Vector3(), hp: 1, maxHp: 1, phase: 0 } };
    m.drone.destroy = () => { m.alive = false; this.destroyedMissiles++; this.note(`Kalibr destroyed · ${this.destroyedMissiles}/${this.launched} down`); };
    this.missiles.push(m); this.launched++;
    this.note(`⚠ KALIBR LAUNCH · ${this.launched} in the air · target ${t.name} · MAGIC 21 has the track`);
  }
  private fly(m: Missile, dt: number, time: number, combat: Combat) {
    if (!m.alive) { m.model.visible = false; return; }
    m.age += dt; const { u } = enu(m.b), h = height(m.b), ll = dirToLatLon(u.toArray() as V);
    if (m.phase === "capsule") {
      m.b.addScaledVector(u, (30 * dt) / 1000);
      if (h >= 0) { m.phase = "boost"; m.age = 0; m.speed = 0.04; this.sound("launch", 1); const l = this.fx.local(m.b); this.fx.burst(l, 60, 0, 22, 10, 3, 4, 0.3); this.fx.burst(l, 30, 1, 5, 8, 6, 10, 0.5); }
    } else {
      const wp = m.waypoints[0], ground = Math.max(0, this.ground(ll.lat, ll.lon));
      let wantDir: T.Vector3;
      if (m.phase === "boost") {
        // Booster: climb out at 60 degrees to 250 m, then pitch over toward the first waypoint.
        const toward = wp.clone().sub(m.b); toward.addScaledVector(u, -toward.dot(u)).normalize();
        wantDir = h < 220 ? u.clone().multiplyScalar(0.87).addScaledVector(toward, 0.5).normalize() : toward;
        m.speed = Math.min(0.24, m.speed + dt * 0.05);
        if (m.age > 5) { m.phase = "cruise"; m.model.getObjectByName("booster")!.visible = false; m.model.getObjectByName("flame")!.visible = false; const l = this.fx.local(m.b); this.fx.burst(l, 12, 3, 2, 3, 8, 8, 0.4); }
        else { const l = this.fx.local(m.b), back = m.dir.clone(); void back; for (let k = 0; k < 3; k++) this.fx.emit(l.clone().add(new T.Vector3((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2)), new T.Vector3(0, 1, 0), 22, 3, 6, 0.22); this.fx.emit(l, new T.Vector3(), 0.12, 4, 8, 0); }
      } else {
        // Cruise: 20 m over water, 50 m over land (looking 1 km ahead), turning toward each waypoint in turn.
        const ahead = m.b.clone().addScaledVector(m.dir, 1).normalize(), la = dirToLatLon(ahead.toArray() as V), groundAhead = Math.max(0, this.ground(la.lat, la.lon), ground);
        const target = bodyAt(TARGETS[m.target].lat, TARGETS[m.target].lon), distance = target.distanceTo(m.b);
        if (m.phase === "cruise" && distance < 5) { m.phase = "terminal"; }
        let wantH = (groundAhead > 2 ? groundAhead + 50 : 20);
        if (m.phase === "terminal") wantH = distance > 2 ? groundAhead + 300 : -50; // pop up, then dive onto the target
        if (wp && wp.distanceTo(m.b) < 2 && m.waypoints.length > 1) m.waypoints.shift();
        const toward = m.waypoints[0].clone().sub(m.b); toward.addScaledVector(u, -toward.dot(u)).normalize();
        const climb = T.MathUtils.clamp((wantH - h) / 250, -0.5, 0.35);
        wantDir = toward.addScaledVector(u, climb).normalize();
        if (distance < 0.08 || (h < ground + 2 && m.phase === "terminal")) { this.strike(m, time, combat); return; }
        if (h < ground + 1) { m.alive = false; this.note("A Kalibr flew into the ground"); this.explode(m, combat, time); return; }
      }
      // Turn rate limit: about 0.25 rad/s, more in the dive.
      const angle = m.dir.angleTo(wantDir), rate = (m.phase === "terminal" ? 0.6 : 0.25) * dt;
      if (angle > 1e-5) { const axis = m.dir.clone().cross(wantDir); if (axis.lengthSq() > 1e-12) m.dir.applyAxisAngle(axis.normalize(), Math.min(angle, rate)); }
      m.b.addScaledVector(m.dir, m.speed * dt);
    }
    const p = new T.Vector3(...bodyToInertial(m.b.toArray() as V, time, EARTH.rotation));
    m.drone.v.copy(airVelocity(p)).add(new T.Vector3(...bodyToInertial(m.dir.toArray() as V, time, EARTH.rotation)).multiplyScalar(m.speed));
    m.drone.p.copy(p);
    void combat;
  }
  private strike(m: Missile, time: number, combat: Combat) {
    m.alive = false; this.impacts++; const t = TARGETS[m.target];
    this.note(`✖ KALIBR HIT ${t.name.toUpperCase()}`); this.explode(m, combat, time, true); this.onImpact?.(m.drone.p.clone(), t.name);
  }
  private explode(m: Missile, combat: Combat, time: number, big = false) {
    m.model.visible = false; const l = this.fx.local(m.b);
    this.fx.burst(l, big ? 80 : 30, 4, 12, big ? 40 : 15, 1.2, big ? 30 : 12, 0.6); this.fx.burst(l, big ? 60 : 20, 3, 6, big ? 12 : 5, big ? 40 : 15, big ? 30 : 12, 0.35);
    combat.bursts.push({ p: m.drone.p.clone(), life: 1.2, big: true, v: m.drone.v.clone() }); void time;
  }
  /** Buoys and dropped weapons: fall, splash, then float, run or sink. */
  private drift(dt: number, time: number) {
    for (const b of this.buoys) {
      b.life -= dt; b.ping = Math.max(0, b.ping - dt);
      if (!b.inWater) { const { u } = enu(b.b); b.vel.multiplyScalar(Math.exp(-dt * 1.5)); b.b.addScaledVector(b.vel, dt / 1000).addScaledVector(u, (-22 * dt) / 1000);
        const ll = dirToLatLon(u.toArray() as V); if (height(b.b) <= Math.max(0, this.ground(ll.lat, ll.lon))) { b.inWater = true; b.b.setLength(R); this.splash(b.b, 0.4); if (this.ground(ll.lat, ll.lon) > 2) { b.life = 0; this.note("Sonobuoy landed on land"); } } }
    }
    this.buoys = this.buoys.filter((b) => { if (b.life <= 0) this.group.remove(b.model); return b.life > 0; });
    for (const w of this.weapons) {
      w.life -= dt; const { u, e, n } = enu(w.b), ll = dirToLatLon(u.toArray() as V);
      if (!w.inWater) {
        // Torpedoes fall under a small parachute at about 25 m/s; depth charges fall freely.
        w.vel.multiplyScalar(Math.exp(-dt * (w.kind === "torpedo" ? 1.2 : 0.15))); const fall = w.kind === "torpedo" ? 25 : Math.min(80, 9.81 * (120 - w.life));
        w.b.addScaledVector(w.vel, dt / 1000).addScaledVector(u, (-fall * dt) / 1000);
        if (height(w.b) <= 0) { w.inWater = true; w.b.setLength(R); this.splash(w.b, 0.8); w.heading = Math.atan2(w.vel.dot(e), w.vel.dot(n)); w.model.getObjectByName("chute")?.removeFromParent(); }
        continue;
      }
      const floor = seabed(ll.lat, ll.lon);
      if (w.kind === "charge") {
        w.depth += dt * 4.5; // sinks about 4.5 m/s
        if (w.depth >= w.setDepth || w.depth >= floor - 1) { this.detonate(w, time); w.life = 0; }
        continue;
      }
      // Torpedo: run at 40 kn at 25 m, snake-search toward the aim point, and home once a boat is within 1.2 km.
      w.depth += Math.sign(25 - w.depth) * Math.min(Math.abs(25 - w.depth), dt * 3);
      const here = w.b, live = this.subs.filter((s) => s.mode !== "sunk");
      const near = live.map((s) => ({ s, d: bodyAt(s.lat, s.lon).distanceTo(here) })).sort((a, b) => a.d - b.d)[0];
      if (near && near.d < 1.2) { w.acquired = true; w.target = near.s; }
      let aim: T.Vector3 | null = null;
      if (w.target && (w.acquired || this.contacts.some((c) => c.sub === w.target))) aim = w.acquired ? bodyAt(w.target.lat, w.target.lon) : this.contacts.find((c) => c.sub === w.target)!.est;
      if (aim) { const d = aim.clone().sub(here); w.heading = Math.atan2(d.dot(e), d.dot(n)); if (w.acquired) w.depth += Math.sign(w.target!.depth - w.depth) * Math.min(Math.abs(w.target!.depth - w.depth), dt * 6); }
      else w.heading += Math.sin(time * 0.4) * dt * 0.25;
      const km = (20.6 * dt) / 1000; w.b.addScaledVector(n, km * Math.cos(w.heading)).addScaledVector(e, km * Math.sin(w.heading)).setLength(R);
      // Bubble trail on the surface while it runs shallow.
      if (Math.random() < dt * 5) { const l = this.fx.local(w.b); this.fx.emit(l.setY(0.4), new T.Vector3(), 10, 2, 2, 0.4); }
      if (w.acquired && w.target) { const t = w.target, d = Math.hypot(bodyAt(t.lat, t.lon).distanceTo(here) * 1000, t.depth - w.depth); if (d < 15) { this.hit(w, t, time); w.life = 0; } }
      if (w.life <= 0 && !w.acquired) this.note("Torpedo ran out of fuel");
    }
    this.weapons = this.weapons.filter((w) => { if (w.life <= 0) this.group.remove(w.model); return w.life > 0; });
  }
  private splash(b: T.Vector3, scale: number) { const l = this.fx.local(b); this.fx.burst(l, Math.round(20 * scale), 0, 6 * scale, 3 * scale, 2, 2 * scale + 1, 0.4); this.fx.burst(l, 6, 2, 0, 2, 12, 5 * scale + 2, 0.3); this.sound("splash", 0.6); }
  /** A depth charge: the burst depth decides the surface show (a dome, then a column; tallest when shallow). */
  private detonate(w: Weapon, time: number) {
    const ll = dirToLatLon(up(w.b).toArray() as V), d = w.depth, column = 140 * Math.exp(-d / 35), l = this.fx.local(w.b);
    this.fx.burst(l, 90, 0, Math.sqrt(2 * 9.81 * column), column * 0.12, 4, 4, 0.35); this.fx.burst(l, 40, 1, Math.sqrt(column) * 1.5, column * 0.1, 7, 14, 0.5); this.fx.burst(l, 24, 2, 0, 12, 25, 18, 0.25);
    this.sound("blast", 1);
    // Damage: full within 8 m, nothing beyond 48 m; the report gives the burst depth and the miss distance.
    let best: { s: Sub; dist: number } | null = null;
    for (const s of this.subs) { if (s.mode === "sunk") continue; const dist = Math.hypot(bodyAt(s.lat, s.lon).distanceTo(w.b) * 1000, s.depth - d); if (!best || dist < best.dist) best = { s, dist }; }
    if (best && best.dist < 48) {
      const loss = SUBS[best.s.kind].charge * Math.min(1, Math.max(0, 1 - (best.dist - 8) / 40));
      this.damage(best.s, loss, `Depth charge · burst ${d.toFixed(0)} m deep · ${SUBS[best.s.kind].name} at ${best.s.depth.toFixed(0)} m · ${best.dist.toFixed(0)} m away`);
    } else this.note(`Depth charge · burst ${d.toFixed(0)} m deep${best ? ` · nearest boat ${best.dist.toFixed(0)} m away at ${best.s.depth.toFixed(0)} m · no damage` : ""}`);
    for (const s of this.subs) if (s.mode !== "sunk" && bodyAt(s.lat, s.lon).distanceTo(w.b) < 4) s.alerted = 60;
    void ll; void time;
  }
  private hit(w: Weapon, s: Sub, time: number) {
    const l = this.fx.local(bodyAt(s.lat, s.lon)), column = 110 * Math.exp(-s.depth / 40);
    this.fx.burst(l, 110, 0, Math.sqrt(2 * 9.81 * column), column * 0.15, 4, 5, 0.35); this.fx.burst(l, 30, 1, 8, 10, 8, 18, 0.5); this.sound("blast", 1);
    this.damage(s, SUBS[s.kind].torpedo, `Torpedo hit · ${SUBS[s.kind].name} at ${s.depth.toFixed(0)} m`); void w; void time;
  }
  private damage(s: Sub, loss: number, what: string) {
    if (s.mode === "sunk") return; s.hull = Math.max(0, s.hull - loss); s.alerted = 90; s.drone.hp = Math.max(0, Math.round(s.drone.maxHp! * s.hull));
    if (s.hull <= 0.001) { s.mode = "sunk"; s.sunkAt = this.clock; this.note(`${what} · ${SUBS[s.kind].name} SUNK`); }
    else this.note(`${what} · hull −${Math.round(loss * 100)}% (${Math.round(s.hull * 100)}% left)`);
  }
  /** Passive sonar once a second: each buoy hears a boat out to 1.8 km times its noise (speed, depth, launches). */
  private listen(time: number) {
    const wet = this.buoys.filter((b) => b.inWater);
    for (const s of this.subs) {
      if (s.mode === "sunk") continue; const p = bodyAt(s.lat, s.lon), spec = SUBS[s.kind];
      const loud = spec.noise * (1 + s.speed / KN / 8) * (s.depth < 16 ? 1.8 : 1) * (s.noisy > 0 ? 4 : 1), range = 1.8 * loud;
      const hearing = wet.filter((b) => b.b.distanceTo(p) < range);
      if (hearing.length) this.contact(s, p, (0.45 * range) / Math.sqrt(hearing.length), null, false, time);
      else if (s.noisy > 20) this.contact(s, p, 1.5, null, false, time); // launch transient, heard by the AWACS-linked network
    }
  }
  /** Puts every model in place for this frame (positions relative to the aircraft, turned with the Earth). */
  private place(time: number, ship: T.Vector3) {
    const spin = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), (time / EARTH.rotation) * Math.PI * 2);
    const put = (model: T.Object3D, b: T.Vector3, heading: number, pitch = 0) => {
      const { u, e, n } = enu(b), basis = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(e, u, n.clone().negate()));
      model.quaternion.copy(spin).multiply(basis).multiply(new T.Quaternion().setFromEuler(new T.Euler(pitch, -heading, 0, "YXZ")));
      model.position.set(...bodyToInertial(b.toArray() as V, time, EARTH.rotation)).sub(ship);
    };
    for (const s of this.subs) {
      const b = bodyAt(s.lat, s.lon, -s.depth); put(s.model, b, s.heading, s.mode === "sunk" ? -0.25 : T.MathUtils.clamp((s.depth - s.want) * 0.006, -0.12, 0.12));
      for (const pr of s.model.userData.props as T.Object3D[]) pr.rotation.z += (s.speed * 0.3) / 60;
      const p = new T.Vector3(...bodyToInertial(b.toArray() as V, time, EARTH.rotation)); s.drone.p.copy(p); s.drone.v.copy(airVelocity(p));
      s.model.visible = p.distanceTo(ship) < 80;
    }
    for (const m of this.missiles) { if (!m.alive) continue; const { e, n, u } = enu(m.b); put(m.model, m.b, Math.atan2(m.dir.dot(e), m.dir.dot(n)), Math.asin(T.MathUtils.clamp(m.dir.dot(u), -1, 1))); m.model.visible = m.drone.p.distanceTo(ship) < 60; }
    for (const b of this.buoys) { put(b.model, b.inWater ? b.b.clone().setLength(R + 0.0002) : b.b, 0); const lamp = b.model.getObjectByName("lamp"); if (lamp) lamp.visible = (time * 1.2) % 1 < 0.2 || b.ping > 0; }
    for (const w of this.weapons) put(w.model, w.inWater ? w.b.clone().setLength(R - w.depth / 1000) : w.b, w.heading, w.inWater ? 0 : 0);
  }
  /** Radar picture: sonar contacts (with their uncertainty in km as `altitude`), and Kalibr tracks via the AWACS link. */
  radar(time: number): RadarContact[] {
    const out: RadarContact[] = [];
    for (const c of this.contacts) out.push({ id: `sonar-${c.sub.id}`, name: `${c.label} · ${c.depth === null ? "depth ?" : `${c.depth.toFixed(0)} m deep`}`, kind: "sub", p: new T.Vector3(...bodyToInertial(c.est.toArray() as V, time, EARTH.rotation)), v: new T.Vector3(), detail: `${c.active ? "active fix" : "passive"} · ±${(c.err * 1000).toFixed(0)} m · ${Math.round(time - c.seen)} s old`, altitude: c.err });
    for (const m of this.missiles) if (m.alive && m.phase !== "capsule") out.push({ id: `kalibr-${m.id}`, name: "KALIBR", kind: "cruise", p: m.drone.p.clone(), v: m.drone.v.clone(), detail: `${height(m.b).toFixed(0)} m · ${(m.speed * 1000).toFixed(0)} m/s · target ${TARGETS[m.target].name} · MAGIC 21 link`, targetId: m.drone.id });
    for (const s of this.subs) if (s.mode !== "sunk" && s.depth < 2) out.push({ id: `surf-${s.id}`, name: `${SUBS[s.kind].name} (surfaced)`, kind: "ground", p: s.drone.p.clone(), v: s.drone.v.clone(), detail: SUBS[s.kind].type, targetId: s.drone.id });
    return out;
  }
  /** What a torpedo or a depth charge dropped now would most likely do to the selected contact. */
  prediction() {
    const c = this.contacts[this.selected % Math.max(1, this.contacts.length)]; if (!c) return null;
    const spec = SUBS[c.sub.kind], err = c.err * 1000, kn = c.sub.speed / KN;
    const pk = T.MathUtils.clamp(1 - err / 1400, 0.15, 0.95) * (kn > 15 ? 0.8 : 1);
    const depthErr = c.depth === null ? 18 : Math.abs(c.depth - this.chargeDepth), dist = Math.hypot(err * 0.7, depthErr);
    const charge = spec.charge * Math.min(1, Math.max(0, 1 - (dist - 8) / 40));
    return { contact: c, torpedo: pk, torpedoLoss: spec.torpedo, charge, hull: c.identified ? c.sub.hull : null };
  }
}
export { inertialToBody };
