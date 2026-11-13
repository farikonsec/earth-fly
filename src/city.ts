import * as T from "three";
import { latLonToDir, bodyToInertial, inertialToBody, dirToLatLon } from "./geo";
import { EARTH } from "./earth";
import type { Terrain } from "./terrain";
import type { V } from "./vector";

/** One mapped footprint. Heights in metres; `ground` is the terrain height the mesh was last seated on. */
interface Building {
  ring: Float32Array; // lon, lat pairs
  n: number; height: number; base: number; roof: number; roofHeight: number; kind: number; seed: number; direction: number;
  lat: number; lon: number; ground: number; chunk: number; start: number; count: number;
  minLon: number; maxLon: number; minLat: number; maxLat: number;
 squash?: number }
interface Chunk { position: Float32Array; normal: Int8Array; tint: Uint8Array; wall: Float32Array; index: Uint32Array; v: number; i: number; mesh: T.Mesh | null; members: Building[] }

const CENTRE = { lat: 51.505, lon: -0.08 }, COLUMNS = 16, ROWS = 6, SKIRT = 12, DOME_STEPS = 4, GRADE_X = 72, GRADE_Y = 28, MARGIN = 0.006;
// 0 Portland stone, 1 London stock brick, 2 red brick, 3 glass, 4 concrete, 5 pale civic stone
const WALLS: [number, number, number][] = [[196, 186, 166], [171, 146, 104], [150, 86, 66], [58, 78, 96], [150, 150, 146], [214, 206, 188]];
const vertexCount = (b: { n: number; roof: number }) => b.n * 4 + (b.roof === 2 ? b.n * (DOME_STEPS * 4 - 1) : b.roof === 1 ? b.n * 3 : b.n);
const indexCount = (b: { n: number; roof: number }) => b.n * 6 + (b.roof === 2 ? b.n * DOME_STEPS * 6 : b.roof === 1 ? b.n * 3 : (b.n - 2) * 3);

/**
 * Central London from OpenStreetMap footprints: extruded blocks, mapped building parts for the landmarks,
 * procedural windows that light up after dark, and a footprint index for collisions.
 * Coverage and heights are only as good as the map: untagged buildings get a plausible height.
 */
export class City {
  group = new T.Group();
  ready = false; loading = false; error = ""; count = 0; near = false;
  night = { value: 0 }; hazeColor = { value: new T.Color(0.6, 0.7, 0.8) }; hazeK = { value: 0.01 }; sky = { value: new T.Color(0.4, 0.55, 0.75) };
  bounds = { west: 0, south: 0, east: 0, north: 0 };
  private anchor = new T.Vector3(...latLonToDir(CENTRE.lat, CENTRE.lon)).multiplyScalar(EARTH.radius);
  private buildings: Building[] = []; private chunks: Chunk[] = []; private cursor = 0; private built = false;
  private cells = new Map<number, Building[]>(); private revision = -1; private refreshAt = 0; private refreshCursor = -1;
  material: T.MeshStandardMaterial; private eye: T.Group | null = null;
  private grade = new Float32Array((GRADE_X + 1) * (GRADE_Y + 1));
  constructor(private terrain: Terrain) {
    this.group.name = "London";
    this.group.visible = false;
    this.material = new T.MeshStandardMaterial({ roughness: 0.82, metalness: 0 });
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, { cityNight: this.night, cityHaze: this.hazeColor, cityHazeK: this.hazeK, citySky: this.sky });
      shader.vertexShader = "attribute vec4 tint;attribute vec3 wall;varying vec4 vTint;varying vec3 vWall;\n" +
        shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvTint=tint;vWall=wall;");
      shader.fragmentShader = "uniform float cityNight;uniform vec3 cityHaze;uniform float cityHazeK;uniform vec3 citySky;varying vec4 vTint;varying vec3 vWall;float cityWindow;float cityLit;\n" +
        shader.fragmentShader
          .replace("#include <color_fragment>", /* glsl */ `#include <color_fragment>
{
  float roof=step(vWall.y,-500.),glass=vWall.z;
  vec2 size=mix(vec2(2.7,3.3),vec2(1.9,3.7),glass),g=vWall.xy/size,id=floor(g),f=fract(g);
  // Ground floors are taller and darker, like shopfronts.
  float storey=step(1.,id.y);
  vec2 lo=mix(vec2(.24,.3),vec2(.05,.1),glass),hi=mix(vec2(.76,.84),vec2(.95,.93),glass);
  lo=mix(vec2(.1,.08),lo,storey);hi=mix(vec2(.9,.86),hi,storey);
  float fw=max(fwidth(g.x),fwidth(g.y));
  vec2 e=vec2(fw*.5+.001);
  float win=smoothstep(lo.x-e.x,lo.x+e.x,f.x)*(1.-smoothstep(hi.x-e.x,hi.x+e.x,f.x))*smoothstep(lo.y-e.y,lo.y+e.y,f.y)*(1.-smoothstep(hi.y-e.y,hi.y+e.y,f.y));
  // Past the point where a window is smaller than a pixel, fade to its average coverage.
  float cover=(hi.x-lo.x)*(hi.y-lo.y);
  win=mix(win,cover,smoothstep(.12,.45,fw))*step(0.,vWall.y)*(1.-roof);
  float h=fract(sin(dot(id+vTint.a*91.7,vec2(12.9898,78.233)))*43758.5453),h2=fract(h*57.31);
  vec3 wallColour=vTint.rgb*(.9+.2*fract(vTint.a*7.3))*mix(.7,1.,smoothstep(0.,16.,vWall.y));
  vec3 pane=mix(vec3(.035,.05,.065),citySky*.22,.5+.5*glass);
  vec3 roofColour=mix(vec3(.3,.31,.33),vTint.rgb*.45,.35)*(.8+.4*fract(vTint.a*3.7));
  diffuseColor.rgb=mix(mix(wallColour,pane,win),roofColour,roof);
  cityWindow=win;
  // Offices empty out and homes light up: roughly a third of windows are lit, more in glass towers.
  float share=mix(.2,.34,glass),far=smoothstep(.12,.45,fw);
  // Beyond window resolution the facade carries the average glow, not a fully lit sheet.
  cityLit=win*mix(step(1.-share,h)*(.35+.65*h2),share*.55,far)*cityNight;
}`)
          .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,.12,cityWindow);")
          .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance+=cityLit*mix(vec3(1.,.74,.42),vec3(.75,.88,1.),step(.82,fract(vTint.a*13.1+vWall.x*.01)))*1.15;")
          .replace("#include <opaque_fragment>", /* glsl */ `{
  // Sky in the glass: a cheap Fresnel term in place of a reflection probe.
  float nv=abs(dot(normal,normalize(vViewPosition))),fresnel=.06+.94*pow(1.-nv,4.);
  outgoingLight=mix(outgoingLight,citySky*(1.-.85*cityNight),cityWindow*fresnel*mix(.45,.85,vWall.z));
  outgoingLight=mix(cityHaze,outgoingLight,exp(-length(vViewPosition)*cityHazeK));
}
#include <opaque_fragment>`);
    };
  }
  /** Footprints a dedicated model already covers (bridges), skipped when extruding. */
  exclude: ((lat: number, lon: number) => boolean) | null = null;
  get progress() { return { ready: this.ready, built: this.built, done: this.cursor, total: this.buildings.length, error: this.error, visible: this.group.visible }; }
  /** Loads the bundled footprints once. Safe to call every frame. */
  async load() {
    if (this.ready || this.loading || this.error) return;
    this.loading = true;
    try {
      const r = await fetch("scenery/london.bin");
      if (!r.ok) throw Error("London data unavailable");
      const view = new DataView(await r.arrayBuffer());
      if (view.getUint32(0, true) !== 0x4c444e31) throw Error("Unsupported London data");
      const total = view.getUint32(4, true), west = view.getFloat32(8, true), south = view.getFloat32(12, true), east = view.getFloat32(16, true), north = view.getFloat32(20, true);
      this.bounds = { west, south, east, north };
      let o = 32;
      for (let k = 0; k < total; k++) {
        const n = view.getUint16(o, true), height = view.getUint16(o + 2, true) / 10, base = view.getUint16(o + 4, true) / 10, roofHeight = view.getUint16(o + 6, true) / 10,
          roof = view.getUint8(o + 8), kind = view.getUint8(o + 9), direction = (view.getUint8(o + 10) / 255) * Math.PI * 2, seed = view.getUint8(o + 11);
        o += 12;
        const ring = new Float32Array(n * 2);
        let lat = 0, lon = 0, minLon = 9, maxLon = -9, minLat = 99, maxLat = -99;
        for (let i = 0; i < n; i++, o += 4) {
          const x = west + (view.getUint16(o, true) / 65535) * (east - west), y = south + (view.getUint16(o + 2, true) / 65535) * (north - south);
          ring[i * 2] = x; ring[i * 2 + 1] = y; lon += x / n; lat += y / n;
          minLon = Math.min(minLon, x); maxLon = Math.max(maxLon, x); minLat = Math.min(minLat, y); maxLat = Math.max(maxLat, y);
        }
        const cx = Math.min(COLUMNS - 1, Math.max(0, Math.floor(((lon - west) / (east - west)) * COLUMNS))), cy = Math.min(ROWS - 1, Math.max(0, Math.floor(((lat - south) / (north - south)) * ROWS)));
        if (this.exclude?.(lat, lon)) continue;
        this.buildings.push({ ring, n, height, base, roof: roof === 3 ? 1 : roof, roofHeight: roof === 3 ? Math.min(roofHeight, 3.5) : roofHeight, kind, seed, direction, lat, lon, ground: 0, chunk: cy * COLUMNS + cx, start: 0, count: 0, minLon, maxLon, minLat, maxLat });
      }
      for (let c = 0; c < COLUMNS * ROWS; c++) this.chunks.push({ position: new Float32Array(0), normal: new Int8Array(0), tint: new Uint8Array(0), wall: new Float32Array(0), index: new Uint32Array(0), v: 0, i: 0, mesh: null, members: [] });
      const vertices = new Array(this.chunks.length).fill(0), indices = new Array(this.chunks.length).fill(0);
      for (const b of this.buildings) { vertices[b.chunk] += vertexCount(b); indices[b.chunk] += indexCount(b); this.chunks[b.chunk].members.push(b); }
      this.chunks.forEach((c, k) => { c.position = new Float32Array(vertices[k] * 3); c.normal = new Int8Array(vertices[k] * 3); c.tint = new Uint8Array(vertices[k] * 4); c.wall = new Float32Array(vertices[k] * 3); c.index = new Uint32Array(indices[k]); });
      // Build outward from the middle of the map so the centre appears first.
      this.buildings.sort((a, b) => Math.hypot((a.lon - CENTRE.lon) * 0.62, a.lat - CENTRE.lat) - Math.hypot((b.lon - CENTRE.lon) * 0.62, b.lat - CENTRE.lat));
      for (const b of this.buildings) {
        for (let gx = Math.floor(b.minLon * 400); gx <= Math.floor(b.maxLon * 400); gx++) for (let gy = Math.floor(b.minLat * 400); gy <= Math.floor(b.maxLat * 400); gy++) {
          const key = gx * 100003 + gy, list = this.cells.get(key); if (list) list.push(b); else this.cells.set(key, [b]);
        }
      }
      this.count = total;
      this.regrade();
      this.eye = this.londonEye();
      this.group.add(this.eye);
      this.ready = true;
    } catch (e) { this.error = String(e); }
    this.loading = false;
  }
  /**
   * The global elevation source is a surface model: inside a city it carries rooftops, which would bury low
   * buildings in lumpy ground. Regrade the mapped area to a smooth street-level field (a low percentile of each
   * ~150 m cell), feathered into the surrounding terrain.
   */
  private regrade() {
    const { west, south, east, north } = this.bounds, w = west - MARGIN, s = south - MARGIN, dx = (east - west + 2 * MARGIN) / GRADE_X, dy = (north - south + 2 * MARGIN) / GRADE_Y, samples: number[] = [];
    for (let y = 0; y <= GRADE_Y; y++) for (let x = 0; x <= GRADE_X; x++) {
      samples.length = 0;
      for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) samples.push(this.terrain.rawHeight(s + (y + j * 0.4) * dy, w + (x + i * 0.4) * dx));
      samples.sort((a, b) => a - b); this.grade[y * (GRADE_X + 1) + x] = samples[5];
    }
    // One smoothing pass removes the last cell-to-cell steps.
    const copy = this.grade.slice(), at = (x: number, y: number) => copy[Math.min(GRADE_Y, Math.max(0, y)) * (GRADE_X + 1) + Math.min(GRADE_X, Math.max(0, x))];
    for (let y = 0; y <= GRADE_Y; y++) for (let x = 0; x <= GRADE_X; x++) this.grade[y * (GRADE_X + 1) + x] = (at(x, y) * 4 + at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1)) / 8;
    this.terrain.grade = { west: w, south: s, dx, dy, nx: GRADE_X, ny: GRADE_Y, margin: MARGIN, data: this.grade.slice() };
    this.terrain.revision++; this.terrain.generation++; this.revision = this.terrain.revision;
  }
  private groundAt(b: Building) { return this.terrain.height(b.lat, b.lon); }
  private extrude(b: Building) {
    const c = this.chunks[b.chunk], n = b.n, ground = this.groundAt(b), wallColour = WALLS[b.kind] ?? WALLS[0], glass = b.kind === 3 ? 1 : 0;
    const scaleX = 111195 * Math.cos((b.lat * Math.PI) / 180), scaleY = 111195;
    const centreDir = new T.Vector3(...latLonToDir(b.lat, b.lon)), east = new T.Vector3(0, 1, 0).cross(centreDir).normalize(), north = centreDir.clone().cross(east);
    const dirs: T.Vector3[] = [], flat: T.Vector2[] = [];
    for (let i = 0; i < n; i++) { dirs.push(new T.Vector3(...latLonToDir(b.ring[i * 2 + 1], b.ring[i * 2]))); flat.push(new T.Vector2((b.ring[i * 2] - b.lon) * scaleX, (b.ring[i * 2 + 1] - b.lat) * scaleY)); }
    const first = c.v;
    b.ground = ground; b.start = first;
    const put = (dir: T.Vector3, h: number, nx: number, ny: number, nz: number, u: number, v: number, g: number) => {
      const k = c.v++, r = EARTH.radius + (ground + h) / 1000;
      c.position[k * 3] = dir.x * r - this.anchor.x; c.position[k * 3 + 1] = dir.y * r - this.anchor.y; c.position[k * 3 + 2] = dir.z * r - this.anchor.z;
      c.normal[k * 3] = nx * 127; c.normal[k * 3 + 1] = ny * 127; c.normal[k * 3 + 2] = nz * 127;
      c.tint[k * 4] = wallColour[0]; c.tint[k * 4 + 1] = wallColour[1]; c.tint[k * 4 + 2] = wallColour[2]; c.tint[k * 4 + 3] = b.seed;
      c.wall[k * 3] = u; c.wall[k * 3 + 1] = v; c.wall[k * 3 + 2] = g;
      return k;
    };
    const world = (x: number, y: number, z: number) => new T.Vector3().addScaledVector(east, x).addScaledVector(north, y).addScaledVector(centreDir, z).normalize();
    const eaves = b.height - (b.roof ? b.roofHeight : 0), bottom = b.base > 0 ? b.base : -SKIRT;
    // Skillion: one plane falling toward roof:direction. The Shard is eight of these leaning on each other.
    const fallX = Math.sin(b.direction), fallY = Math.cos(b.direction);
    let lowest = Infinity, highest = -Infinity;
    if (b.roof === 4) for (const p of flat) { const d = p.x * fallX + p.y * fallY; lowest = Math.min(lowest, d); highest = Math.max(highest, d); }
    const span = Math.max(1e-3, highest - lowest), topAt = (i: number) => b.roof === 4 ? eaves + b.roofHeight * (highest - (flat[i].x * fallX + flat[i].y * fallY)) / span : eaves;
    // Walls: one quad per edge, with the running perimeter as the window coordinate.
    let run = b.seed * 0.37;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, dx = flat[j].x - flat[i].x, dy = flat[j].y - flat[i].y, length = Math.hypot(dx, dy) || 1, normal = world(dy / length, -dx / length, 0);
      const a = put(dirs[i], bottom, normal.x, normal.y, normal.z, run, bottom - b.base, glass), d = put(dirs[j], bottom, normal.x, normal.y, normal.z, run + length, bottom - b.base, glass),
        e = put(dirs[j], topAt(j), normal.x, normal.y, normal.z, run + length, topAt(j) - b.base, glass), f = put(dirs[i], topAt(i), normal.x, normal.y, normal.z, run, topAt(i) - b.base, glass);
      c.index.set([a, d, e, a, e, f], c.i); c.i += 6; run += length;
    }
    if (b.roof === 4) {
      // Steep glass planes are facade, not roof: give them window coordinates along the slope.
      const steep = b.roofHeight / span, slope = world(fallX * steep, fallY * steep, 1), facade = steep > 1.2;
      const top = dirs.map((d, i) => put(d, topAt(i), slope.x, slope.y, slope.z, facade ? flat[i].x * fallY - flat[i].y * fallX : 0, facade ? topAt(i) - b.base : -1000, facade ? glass : 0));
      for (const t of T.ShapeUtils.triangulateShape(flat, [])) { c.index.set([top[t[0]], top[t[1]], top[t[2]]], c.i); c.i += 3; }
    } else if (!b.roof) {
      const top = dirs.map((d) => put(d, b.height, centreDir.x, centreDir.y, centreDir.z, 0, -1000, 0));
      for (const t of T.ShapeUtils.triangulateShape(flat, [])) { c.index.set([top[t[0]], top[t[1]], top[t[2]]], c.i); c.i += 3; }
    } else {
      // Tapered roofs converge on the footprint centre: one step for a pyramid, several for a dome.
      const steps = b.roof === 2 ? DOME_STEPS : 1, at = (i: number, s: number) => {
        const t = s / steps, shrink = b.roof === 2 ? Math.cos((t * Math.PI) / 2) : 1 - t, rise = b.roof === 2 ? Math.sin((t * Math.PI) / 2) : t;
        return { dir: world(flat[i].x * shrink, flat[i].y * shrink, scaleY).clone(), h: eaves + b.roofHeight * rise, x: flat[i].x * shrink, y: flat[i].y * shrink };
      };
      const exact = (x: number, y: number) => new T.Vector3(...latLonToDir(b.lat + y / scaleY, b.lon + x / scaleX));
      for (let s = 0; s < steps; s++) for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, p0 = at(i, s), p1 = at(j, s), p2 = at(j, s + 1), p3 = at(i, s + 1);
        const edge = new T.Vector3(p1.x - p0.x, p1.y - p0.y, 0), up = new T.Vector3(p3.x - p0.x, p3.y - p0.y, p3.h - p0.h), nl = edge.cross(up).normalize(), normal = world(nl.x, nl.y, Math.max(0.05, nl.z));
        if (s === steps - 1) {
          const a = put(exact(p0.x, p0.y), p0.h, normal.x, normal.y, normal.z, 0, -1000, 0), d = put(exact(p1.x, p1.y), p1.h, normal.x, normal.y, normal.z, 0, -1000, 0), e = put(exact(0, 0), eaves + b.roofHeight, normal.x, normal.y, normal.z, 0, -1000, 0);
          c.index.set([a, d, e], c.i); c.i += 3;
        } else {
          const a = put(exact(p0.x, p0.y), p0.h, normal.x, normal.y, normal.z, 0, -1000, 0), d = put(exact(p1.x, p1.y), p1.h, normal.x, normal.y, normal.z, 0, -1000, 0),
            e = put(exact(p2.x, p2.y), p2.h, normal.x, normal.y, normal.z, 0, -1000, 0), f = put(exact(p3.x, p3.y), p3.h, normal.x, normal.y, normal.z, 0, -1000, 0);
          c.index.set([a, d, e, a, e, f], c.i); c.i += 6;
        }
      }
    }
    b.count = c.v - first;
  }
  private finish(c: Chunk) {
    if (!c.v) return;
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.BufferAttribute(c.position.subarray(0, c.v * 3), 3));
    g.setAttribute("normal", new T.BufferAttribute(c.normal.subarray(0, c.v * 3), 3, true));
    g.setAttribute("tint", new T.BufferAttribute(c.tint.subarray(0, c.v * 4), 4, true));
    g.setAttribute("wall", new T.BufferAttribute(c.wall.subarray(0, c.v * 3), 3));
    g.setIndex(new T.BufferAttribute(c.index.subarray(0, c.i), 1));
    g.computeBoundingSphere();
    if (c.mesh) { c.mesh.geometry.dispose(); c.mesh.geometry = g; } else { c.mesh = new T.Mesh(g, this.material); this.group.add(c.mesh); }
  }
  /** The London Eye is not a building in the map, so it is modelled by hand at its surveyed position. */
  private londonEye() {
    const group = new T.Group(), white = new T.MeshStandardMaterial({ color: 0xe9eef2, roughness: 0.45, metalness: 0.3, emissive: new T.Color(0.25, 0.4, 1), emissiveIntensity: 0 }),
      pod = new T.MeshStandardMaterial({ color: 0x9fc4d8, roughness: 0.15, metalness: 0.2, emissive: new T.Color(0.6, 0.8, 1), emissiveIntensity: 0 });
    const wheel = new T.Group(), R = 0.06;
    wheel.add(new T.Mesh(new T.TorusGeometry(R, 0.0011, 6, 96), white), new T.Mesh(new T.TorusGeometry(R * 0.965, 0.0006, 5, 96), white));
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2, capsule = new T.Mesh(new T.CapsuleGeometry(0.0016, 0.0036, 3, 8), pod);
      capsule.position.set(Math.cos(a) * (R + 0.0032), Math.sin(a) * (R + 0.0032), 0); capsule.rotation.z = Math.PI / 2; wheel.add(capsule);
      if (i % 2 === 0) { const spoke = new T.Mesh(new T.CylinderGeometry(0.00012, 0.00012, R, 4), white); spoke.position.set(Math.cos(a) * R * 0.5, Math.sin(a) * R * 0.5, 0); spoke.rotation.z = a - Math.PI / 2; wheel.add(spoke); }
    }
    const hub = new T.Mesh(new T.CylinderGeometry(0.0022, 0.0022, 0.012, 12), white); hub.rotation.x = Math.PI / 2; wheel.add(hub);
    wheel.position.y = 0.0675; group.add(wheel);
    // A-frame on the landward side.
    for (const side of [-1, 1]) { const leg = new T.Mesh(new T.CylinderGeometry(0.0012, 0.0016, 0.074, 6), white), foot = new T.Vector3(side * 0.018, 0, -0.022), top = new T.Vector3(0, 0.0675, -0.006); leg.position.copy(foot).add(top).multiplyScalar(0.5); leg.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), top.clone().sub(foot).normalize()); group.add(leg); }
    group.userData = { wheel, white, pod, lat: 51.5033, lon: -0.1195, ground: NaN };
    return group;
  }
  private seatEye() {
    const eye = this.eye; if (!eye) return;
    const { lat, lon } = eye.userData, ground = this.terrain.height(lat, lon); if (ground === eye.userData.ground) return; eye.userData.ground = ground;
    const up = new T.Vector3(...latLonToDir(lat, lon)), east = new T.Vector3(0, 1, 0).cross(up).normalize(), north = up.clone().cross(east), bearing = (25 * Math.PI) / 180,
      along = north.clone().multiplyScalar(Math.cos(bearing)).addScaledVector(east, Math.sin(bearing)), axis = along.clone().cross(up).normalize();
    eye.position.copy(up).multiplyScalar(EARTH.radius + ground / 1000).sub(this.anchor);
    eye.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(along, up, axis));
  }
  /** True when a point (degrees, metres above sea level) is inside a mapped building volume. */
  hit(lat: number, lon: number, altitude: number) {
    if (!this.built) return false;
    for (const b of this.cells.get(Math.floor(lon * 400) * 100003 + Math.floor(lat * 400)) ?? []) {
      if (lon < b.minLon || lon > b.maxLon || lat < b.minLat || lat > b.maxLat || altitude > b.ground + (b.roof === 4 ? b.height - b.roofHeight * 0.5 : b.height) || altitude < b.ground + b.base - 2) continue;
      let inside = false; const r = b.ring;
      for (let i = 0, j = b.n - 1; i < b.n; j = i++) { const ax = r[i * 2], ay = r[i * 2 + 1], bx = r[j * 2], by = r[j * 2 + 1]; if (ay > lat !== by > lat && lon < ((bx - ax) * (lat - ay)) / (by - ay) + ax) inside = !inside; }
      if (inside) return true;
    }
    return false;
  }
  /** Tallest mapped roof (metres above sea level) within the cell under a point, for look-ahead warnings. */
  roofNear(lat: number, lon: number) {
    let top = -1e9;
    for (const b of this.cells.get(Math.floor(lon * 400) * 100003 + Math.floor(lat * 400)) ?? []) top = Math.max(top, b.ground + b.height);
    return top;
  }
  update(position: V, time: number, budgetMs = 7) {
    const body = inertialToBody(position, time, EARTH.rotation), loc = dirToLatLon(body), altitude = (Math.hypot(...position) - EARTH.radius) * 1000;
    const distance = Math.hypot((loc.lon - CENTRE.lon) * 69, (loc.lat - CENTRE.lat) * 111);
    this.near = distance < 70 && altitude < 60000;
    this.group.visible = this.near && this.ready;
    if (this.near && !this.ready) void this.load();
    if (!this.group.visible) return;
    const started = performance.now();
    // Time-sliced extrusion keeps the frame rate while the city appears block by block.
    if (!this.built) {
      let dirty = new Set<number>();
      while (this.cursor < this.buildings.length && performance.now() - started < budgetMs) { const b = this.buildings[this.cursor++]; this.extrude(b); dirty.add(b.chunk); }
      if (this.cursor >= this.buildings.length) { this.built = true; this.revision = -1; dirty = new Set(this.chunks.keys()); }
      if (this.built || this.cursor % 6 < 3) for (const k of dirty) if (this.built || this.chunks[k].mesh === null || this.cursor % 2000 < 400) this.finish(this.chunks[k]);
      this.seatEye();
    } else if (this.revision !== this.terrain.revision && time > this.refreshAt && this.refreshCursor < 0) { this.regrade(); this.refreshCursor = 0; }
    // Terrain tiles stream in after the city: reseat buildings on the new ground, a few chunks per frame.
    if (this.refreshCursor >= 0) {
      while (this.refreshCursor < this.chunks.length && performance.now() - started < budgetMs) {
        const c = this.chunks[this.refreshCursor++]; let moved = false;
        for (const b of c.members) {
          const ground = this.groundAt(b), delta = (ground - b.ground) / 1000, blast = this.terrain.craters ? this.terrain.blast(b.lat, b.lon) : 0;
          // A blast leaves rubble at the centre and broken shells further out; each building keeps a share of its height.
          const keep = blast > 0 ? Math.max(0.03, (1 - blast) * (0.25 + (0.75 * b.seed) / 255)) : 1, ratio = keep / (b.squash ?? 1);
          if (Math.abs(delta) < 0.0003 && Math.abs(ratio - 1) < 0.01) continue;
          if (Math.abs(ratio - 1) >= 0.01) {
            const from = EARTH.radius + b.ground / 1000, to = EARTH.radius + ground / 1000, a = this.anchor;
            for (let k = b.start; k < b.start + b.count; k++) {
              const x = c.position[k * 3] + a.x, y = c.position[k * 3 + 1] + a.y, z = c.position[k * 3 + 2] + a.z, r = Math.hypot(x, y, z), s = (to + (r - from) * ratio) / r;
              c.position[k * 3] = x * s - a.x; c.position[k * 3 + 1] = y * s - a.y; c.position[k * 3 + 2] = z * s - a.z;
            }
            b.height *= ratio; b.roofHeight *= ratio; b.base *= ratio; b.squash = keep; b.ground = ground; moved = true; continue;
          }
          const up = latLonToDir(b.lat, b.lon); for (let k = b.start; k < b.start + b.count; k++) { c.position[k * 3] += up[0] * delta; c.position[k * 3 + 1] += up[1] * delta; c.position[k * 3 + 2] += up[2] * delta; }
          b.ground = ground; moved = true;
        }
        if (moved && c.mesh) { (c.mesh.geometry.attributes.position as T.BufferAttribute).needsUpdate = true; c.mesh.geometry.computeBoundingSphere(); }
      }
      if (this.refreshCursor >= this.chunks.length) { this.refreshCursor = -1; this.refreshAt = time + 1.5; this.seatEye(); }
    }
    if (this.eye) {
      (this.eye.userData.wheel as T.Group).rotation.z = time * 0.0035;
      (this.eye.userData.white as T.MeshStandardMaterial).emissiveIntensity = this.night.value * 1.6; (this.eye.userData.pod as T.MeshStandardMaterial).emissiveIntensity = this.night.value * 2.5;
    }
    this.group.rotation.y = (time / EARTH.rotation) * Math.PI * 2;
    this.group.position.set(...bodyToInertial(this.anchor.toArray() as V, time, EARTH.rotation)).sub(new T.Vector3(...position));
  }
}
