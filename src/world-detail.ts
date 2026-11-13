import * as T from "three";
import { latLonToDir, bodyToInertial, inertialToBody, dirToLatLon } from "./geo";
import { EARTH } from "./earth";
import { readTile, type MvtLayer } from "./mvt";
import { airlinerGeometry, finGeometry } from "./props";
import { GroundCorrection, seatOnGround } from "./terrain-sample";
import type { Terrain } from "./terrain";
import type { City } from "./city";
import type { V } from "./vector";

const ZOOM = 14, RADIUS = 2, KEEP = 3, SKIRT = 12, N = 2 ** ZOOM;
/** Milliseconds of tile building allowed per frame; a tile finishes over several frames instead of freezing one. */
const BUILD_BUDGET_MS = 5;
const WALLS: [number, number, number][] = [[196, 186, 166], [171, 146, 104], [150, 86, 66], [58, 78, 96], [150, 150, 146], [214, 206, 188]];
interface Footprint { ring: Float32Array; n: number; top: number; base: number; minLon: number; maxLon: number; minLat: number; maxLat: number }
interface Place { lat: number; lon: number; name: string; rank: number }
interface Tile { key: string; x: number; y: number; state: "loading" | "decoded" | "built" | "failed"; layers?: Record<string, MvtLayer>; group?: T.Group; footprints: Footprint[]; revision: number; buildings: number; trees?: T.InstancedMesh; places: Place[]; centre?: T.Vector3 }
/** Road classes drawn, with carriageway width in metres and the shader's paint scheme (3 motorway, 4 A road, 5 minor, 6 rail). */
const ROADS: Record<string, [number, number]> = { motorway: [27, 3], trunk: [16, 4], primary: [13, 4], secondary: [10.5, 5], tertiary: [8.5, 5], minor: [6.5, 5], service: [4.2, 5], busway: [7, 5], rail: [5.5, 6] };
const PLACE_RANK: Record<string, number> = { city: 5, town: 4, suburb: 3, village: 3, quarter: 2, neighbourhood: 1, hamlet: 1 };
const hash = (a: number, b: number) => { let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const lonOf = (x: number) => (x / N) * 360 - 180, latOf = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / N))) * 180) / Math.PI;

/**
 * Streams OpenMapTiles vector tiles (OpenStreetMap data, served by OpenFreeMap) around the aircraft and turns
 * them into extruded buildings and painted airfields anywhere on Earth. Display only: tiles are fetched as you
 * fly, held in a small cache and never bulk-downloaded. Heights are the map's render_height where present.
 */
export class WorldDetail {
  group = new T.Group();
  enabled = true; status = "idle"; error = "";
  private template = ""; private requested = false; private tiles = new Map<string, Tile>(); private inflight = 0;
  private anchor = new T.Vector3(); private anchored = false; private ground: T.MeshStandardMaterial; private water: T.MeshStandardMaterial;
  private treeGeometry = shared(treeGeometry()); private airliner = shared(airlinerGeometry().scale(0.001, 0.001, 0.001)); private fin = shared(finGeometry().scale(0.001, 0.001, 0.001));
  private airlinerMaterial = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.15 }); private finMaterial = new T.MeshStandardMaterial({ roughness: 0.5, metalness: 0.1 }); private treeMaterial = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  labels = document.createElement("canvas"); private label = this.labels.getContext("2d")!;
  /** Shared with main, which feeds it the drawn terrain mesh. */
  correction: GroundCorrection; private buildingMaterial: T.MeshStandardMaterial;
  get anchorPoint() { return this.anchor; }
  /** Footprints a dedicated model already covers (bridges), skipped when extruding. */
  exclude: ((lat: number, lon: number) => boolean) | null = null;
  /** Bumped whenever the set of decoded tiles changes; the ground overlay repaints on it. */
  revision = 0;
  /** Decoded tiles for the ground overlay painter. */
  overlayTiles() { const out: { x: number; y: number; layers: Record<string, MvtLayer> }[] = []; for (const t of this.tiles.values()) if (t.layers) out.push({ x: t.x, y: t.y, layers: t.layers }); return out; }
  constructor(private terrain: Terrain, private city: City) {
    this.correction = new GroundCorrection(terrain);
    this.group.name = "Streamed buildings and airfields";
    // Airfield paint: asphalt with runway markings and edge lights, drawn just above the terrain.
    this.ground = new T.MeshStandardMaterial({ roughness: 0.93, metalness: 0 });
    this.ground.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, { cityNight: city.night, cityHaze: city.hazeColor, cityHazeK: city.hazeK });
      shader.vertexShader = "attribute vec4 mark;varying vec4 vMark;\n" + shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvMark=mark;");
      shader.fragmentShader = "uniform float cityNight;uniform vec3 cityHaze;uniform float cityHazeK;varying vec4 vMark;float fieldLight;\n" + shader.fragmentShader
        .replace("#include <logdepthbuf_fragment>", `#include <logdepthbuf_fragment>
  // Draped layers win the depth test by a fixed share of distance instead of floating above the ground,
  // so they stay pinned to the terrain from every camera angle.
  gl_FragDepth -= log2(1.004) * logDepthBufFC * 0.5;`)
        .replace("#include <color_fragment>", /* glsl */ `#include <color_fragment>
{
  // mark: x across (-1..1), y metres along, z total length, w kind (0 apron, 1 runway, 2 taxiway)
  float kind=vMark.w,u=vMark.x,v=vMark.y,L=vMark.z,aa=fwidth(v)*.5+.02,ax=fwidth(u)*.5+.002;
  float grit=fract(sin(dot(floor(vec2(u*24.,v*.5)),vec2(12.9898,78.233)))*43758.5453);
  vec3 asphalt=vec3(.085,.088,.092)*(.86+.28*grit),concrete=vec3(.34,.34,.33)*(.9+.2*grit),taxi=vec3(.13,.132,.136)*(.88+.24*grit);
  vec3 col=kind<.5?concrete:kind<1.5?asphalt:taxi;
  if(kind<.5){
    // Apron: 7.5 m concrete slabs with dark joints, a little staining, and faint yellow stand lead-in lines.
    vec2 m=vec2(u,v),slab=floor(m/7.5),j=abs(fract(m/7.5)-.5)*2.;float fw2=max(fwidth(m.x),fwidth(m.y))/7.5+.004;
    float joint=(1.-smoothstep(1.-fw2*2.-.03,1.-fw2,j.x))+(1.-smoothstep(1.-fw2*2.-.03,1.-fw2,j.y));joint=clamp(2.-joint,0.,1.)*(1.-smoothstep(.15,.5,fw2*7.5));
    float stain=fract(sin(dot(slab,vec2(41.3,17.7)))*9437.1);
    col=vec3(.47,.47,.45)*(.88+.16*stain)*(1.-.25*joint);
    float lead=(1.-smoothstep(.12,.12+fw2*7.5,abs(fract(m.x/62.)*62.-31.)))*(1.-smoothstep(.3,1.,fw2*7.5));
    col=mix(col,vec3(.75,.6,.1),lead*.8);
  }float paint=0.;fieldLight=0.;
  if(kind>.5&&kind<1.5){
    float end=min(v,L-v);
    // Centreline dashes, side stripes, threshold piano keys, aiming-point blocks, rubber in the touchdown zone.
    float centre=(1.-smoothstep(.018,.018+ax,abs(u)))*step(fract(v/50.),.6)*step(90.,end);
    float side=smoothstep(.9-ax,.9,abs(u))*(1.-smoothstep(.94,.94+ax,abs(u)));
    float keys=step(8.,end)*(1.-step(38.,end))*step(.12,abs(u))*step(abs(u),.86)*step(fract(abs(u)*6.5),.55);
    float aim=step(400.,end)*(1.-step(445.,end))*step(.32,abs(u))*step(abs(u),.62);
    paint=max(max(centre,side),max(keys,aim));
    float rubber=smoothstep(900.,300.,end)*smoothstep(100.,260.,end)*(1.-smoothstep(.1,.5,abs(abs(u)-.2)))*.45;
    col=mix(col,vec3(.03),rubber);
    fieldLight=smoothstep(.955,.975,abs(u))*(1.-smoothstep(.985,1.,abs(u)))*step(fract(v/60.),.06);
  }else if(kind>1.5&&kind<2.5){paint=(1.-smoothstep(.03,.03+ax,abs(u)))*.9;col=mix(col,vec3(.75,.6,.08),paint);paint=0.;fieldLight=smoothstep(.93,.96,abs(u))*step(fract(v/30.),.05)*.5;}
  if(kind>2.5){
    vec3 tar=vec3(.07,.072,.076)*(.82+.36*grit);float fade=1.-smoothstep(4.,12.,fwidth(v));
    if(kind<3.5){
      // Motorway: two carriageways, a planted central reservation, three dashed lanes each way and lighting columns.
      float res=1.-smoothstep(.05,.05+ax,abs(u)),edge=smoothstep(.9-ax,.9,abs(u))*(1.-smoothstep(.93,.93+ax,abs(u))),inner=smoothstep(.085-ax,.085,abs(u))*(1.-smoothstep(.1,.1+ax,abs(u))),lanes=0.;
      for(int k=1;k<3;k++){float c=.1+.8*float(k)/3.;lanes=max(lanes,(1.-smoothstep(.012,.012+ax,abs(abs(u)-c)))*step(fract(v/11.),.2)*fade);}
      col=mix(tar,vec3(.24,.29,.19),res);paint=max(max(edge,inner),lanes)*(1.-res);fieldLight=(1.-smoothstep(0.,.04,abs(u)))*step(fract(v/40.),.05);
    }else if(kind<4.5){
      float centre=(1.-smoothstep(.02,.02+ax,abs(u)))*step(fract(v/12.),.4)*fade,edge=smoothstep(.88-ax,.88,abs(u))*(1.-smoothstep(.92,.92+ax,abs(u)));
      col=tar;paint=max(centre,edge);fieldLight=smoothstep(.95,.99,abs(u))*step(fract(v/35.),.06)*step(0.,u)*.8;
    }else if(kind<5.5){
      col=tar*1.12+vec3(.012);paint=(1.-smoothstep(.025,.025+ax,abs(u)))*step(fract(v/9.),.35)*.55*fade;fieldLight=smoothstep(.95,.99,abs(u))*step(fract(v/32.),.06)*step(0.,u)*.5;
    }else{
      // Twin track on ballast: two rails per track, dark sleepers.
      col=vec3(.17,.15,.13)*(.8+.4*grit);float rails=0.;for(int k=0;k<4;k++){float c=k<2?-.45:.45,o=(mod(float(k),2.)-.5)*.26;rails=max(rails,1.-smoothstep(.025,.025+ax,abs(u-c-o)));}
      col=mix(col,vec3(.4,.37,.33),rails*.9*fade);
    }
  }
  diffuseColor.rgb=mix(col,vec3(.86,.86,.84),paint);
}`)
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance+=fieldLight*(vMark.w>2.5?vec3(1.,.64,.3)*4.*cityNight:mix(vec3(1.,.95,.8),vec3(.2,.5,1.),step(1.5,vMark.w))*(.6+5.*cityNight));")
        .replace("#include <opaque_fragment>", "outgoingLight=mix(cityHaze,outgoingLight,exp(-length(vViewPosition)*cityHazeK));\n#include <opaque_fragment>");
    };
    // Rivers, canals and lakes: dark water that mirrors the sky at grazing angles.
    this.water = new T.MeshStandardMaterial({ color: 0x1a3a3c, roughness: 0.35, metalness: 0 });
    this.water.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, { cityNight: city.night, cityHaze: city.hazeColor, cityHazeK: city.hazeK, citySky: city.sky });
      shader.fragmentShader = "uniform float cityNight;uniform vec3 cityHaze;uniform float cityHazeK;uniform vec3 citySky;\n" + shader.fragmentShader.replace("#include <logdepthbuf_fragment>", `#include <logdepthbuf_fragment>
  // Draped layers win the depth test by a fixed share of distance instead of floating above the ground,
  // so they stay pinned to the terrain from every camera angle.
  gl_FragDepth -= log2(1.003) * logDepthBufFC * 0.5;`).replace("#include <opaque_fragment>",
        "float nv=abs(dot(normalize(normal),normalize(vViewPosition))),fres=.04+.96*pow(1.-nv,5.);outgoingLight=mix(outgoingLight,citySky*1.5*(1.-.9*cityNight),fres*.85);outgoingLight=mix(cityHaze,outgoingLight,exp(-length(vViewPosition)*cityHazeK));\n#include <opaque_fragment>");
    };
    this.labels.id = "place-labels"; document.body.append(this.labels);
    this.buildingMaterial = new T.MeshStandardMaterial({ roughness: 0.82, metalness: 0 }); this.buildingMaterial.onBeforeCompile = city.material.onBeforeCompile;
    for (const m of [this.ground, this.water, this.buildingMaterial, this.treeMaterial, this.airlinerMaterial, this.finMaterial]) seatOnGround(m, this.correction);
  }
  get progress() { let built = 0, buildings = 0; for (const t of this.tiles.values()) if (t.state === "built") { built++; buildings += t.buildings; } return { tiles: this.tiles.size, built, buildings, status: this.status, error: this.error }; }
  private async source() {
    if (this.requested) return; this.requested = true;
    try { const r = await fetch("https://tiles.openfreemap.org/planet", { signal: AbortSignal.timeout(9000) }); if (!r.ok) throw Error(`Map source ${r.status}`); this.template = (await r.json()).tiles[0]; this.status = "streaming"; }
    catch (e) { this.error = String(e); this.status = "offline"; setTimeout(() => { this.requested = false; }, 30000); }
  }
  private async fetchTile(tile: Tile) {
    this.inflight++;
    try {
      const r = await fetch(this.template.replace("{z}", String(ZOOM)).replace("{x}", String(tile.x)).replace("{y}", String(tile.y)), { signal: AbortSignal.timeout(12000) });
      if (!r.ok) throw Error(String(r.status));
      tile.layers = readTile(await r.arrayBuffer(), ["building", "aeroway", "transportation", "water", "waterway", "landcover", "park", "place", "poi"]); tile.state = "decoded"; this.revision++;
    } catch { tile.state = "failed"; }
    this.inflight--;
  }
  private dispose(tile: Tile) { tile.trees?.dispose(); tile.trees = undefined; if (tile.group) { this.group.remove(tile.group); tile.group.traverse((o) => { if (o instanceof T.Mesh && !o.geometry.userData.shared) o.geometry.dispose(); }); tile.group = undefined; } tile.footprints = []; }
  /**
   * Builds one tile's buildings, trees and parked airliners as a resumable job: it yields whenever the frame's
   * budget runs out, and the finished group replaces the old one in a single swap, so a rebuild neither flickers
   * nor drops collision footprints. A whole London tile took 400-500 ms in one frame before.
   */
  private *build(tile: Tile, slice: { until: number }): Generator<void, void, void> {
    const footprints: Tile["footprints"] = []; let newTrees: T.InstancedMesh | undefined;
    const group = new T.Group(), layers = tile.layers!, extent = layers.building?.extent ?? layers.aeroway?.extent ?? 4096;
    const lon = (x: number) => lonOf(tile.x + x / extent), lat = (y: number) => latOf(tile.y + y / extent), midLat = lat(extent / 2), scaleX = 111195 * Math.cos((midLat * Math.PI) / 180), scaleY = 111195;
    const position: number[] = [], normal: number[] = [], tint: number[] = [], wall: number[] = [], index: number[] = [];
    const cityBounds = this.city.ready ? this.city.bounds : null; let count = 0;
    const put = (dir: T.Vector3, h: number, n: T.Vector3, colour: [number, number, number], seed: number, u: number, v: number, g: number) => {
      const r = EARTH.radius + h / 1000; position.push(dir.x * r - this.anchor.x, dir.y * r - this.anchor.y, dir.z * r - this.anchor.z); normal.push(n.x, n.y, n.z); tint.push(colour[0], colour[1], colour[2], seed); wall.push(u, v, g); return position.length / 3 - 1;
    };
    for (const f of layers.building?.features ?? []) {
      if (performance.now() > slice.until) yield;
      if (f.type !== 3) continue;
      const tall = Number(f.properties.render_height) || 0, minimum = Number(f.properties.render_min_height) || 0;
      for (const raw of f.rings) {
        if (performance.now() > slice.until) yield;
        const n = raw.length / 2 - (raw[0] === raw[raw.length - 2] && raw[1] === raw[raw.length - 1] ? 1 : 0); if (n < 3 || n > 1500) continue;
        let area = 0, cx = 0, cy = 0;
        for (let i = 0, j = n - 1; i < n; j = i++) { area += (raw[j * 2] - raw[i * 2]) * (raw[j * 2 + 1] + raw[i * 2 + 1]); cx += raw[i * 2] / n; cy += raw[i * 2 + 1] / n; }
        // Tile space is y-down: exterior rings come out positive here, courtyards negative.
        if (area <= 0 || cx < 0 || cy < 0 || cx >= extent || cy >= extent) continue;
        const cLon = lon(cx), cLat = lat(cy), metres = (area / 2) * ((360 / N / extent) * scaleX) ** 2;
        if (metres < 18) continue;
        if (this.exclude?.(cLat, cLon)) continue;
        if (cityBounds && cLon > cityBounds.west && cLon < cityBounds.east && cLat > cityBounds.south && cLat < cityBounds.north) continue;
        const rnd = hash(Math.round(cLon * 1e5), Math.round(cLat * 1e5)), seed = Math.floor(rnd * 256);
        // Inside a blast ring: nothing at the centre, then rubble, then broken shells of what stood there.
        const blast = this.terrain.blast(cLat, cLon); if (blast > 0.9) continue;
        const height = Math.max(1.2, (tall > 2.5 ? Math.min(tall, 330) : metres < 220 ? 6.5 + rnd * 3 : 9 + rnd * 8) * (blast > 0 ? (1 - blast) * (0.25 + 0.75 * rnd) : 1)), base = Math.max(0, Math.min(minimum, height - 1));
        const house = metres < 260 && height < 13 && base === 0, roofHeight = house ? 2.2 + rnd * 1.6 : 0, eaves = height - roofHeight;
        const kind = height > 60 ? 3 : house ? (rnd < 0.55 ? 1 : rnd < 0.85 ? 2 : 0) : height > 34 ? (rnd < 0.5 ? 3 : 4) : rnd < 0.3 ? 1 : rnd < 0.5 ? 2 : rnd < 0.8 ? 0 : 4, colour = WALLS[kind], glass = kind === 3 ? 1 : 0;
        // Reverse to counter-clockwise in east/north so wall normals face out.
        const flat: T.Vector2[] = [], dirs: T.Vector3[] = [], ringLL = new Float32Array(n * 2);
        let ground = this.terrain.height(cLat, cLon), minLon = 999, maxLon = -999, minLat = 99, maxLat = -99;
        for (let k = 0; k < n; k++) {
          const i = n - 1 - k, lo = lon(raw[i * 2]), la = lat(raw[i * 2 + 1]); ringLL[k * 2] = lo; ringLL[k * 2 + 1] = la;
          flat.push(new T.Vector2((lo - cLon) * scaleX, (la - cLat) * scaleY)); dirs.push(new T.Vector3(...latLonToDir(la, lo)));
          minLon = Math.min(minLon, lo); maxLon = Math.max(maxLon, lo); minLat = Math.min(minLat, la); maxLat = Math.max(maxLat, la);
          if (k % Math.max(1, Math.floor(n / 3)) === 0) ground = Math.max(ground, this.terrain.height(la, lo));
        }
        const centre = new T.Vector3(...latLonToDir(cLat, cLon)), east = new T.Vector3(0, 1, 0).cross(centre).normalize(), north = centre.clone().cross(east);
        const world = (x: number, y: number, z: number) => new T.Vector3().addScaledVector(east, x).addScaledVector(north, y).addScaledVector(centre, z).normalize();
        const bottom = base > 0 ? base : -SKIRT; let run = seed * 0.37;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n, dx = flat[j].x - flat[i].x, dy = flat[j].y - flat[i].y, length = Math.hypot(dx, dy) || 1, nrm = world(dy / length, -dx / length, 0);
          const a = put(dirs[i], ground + bottom, nrm, colour, seed, run, bottom - base, glass), b = put(dirs[j], ground + bottom, nrm, colour, seed, run + length, bottom - base, glass),
            c = put(dirs[j], ground + eaves, nrm, colour, seed, run + length, eaves - base, glass), d = put(dirs[i], ground + eaves, nrm, colour, seed, run, eaves - base, glass);
          index.push(a, b, c, a, c, d); run += length;
        }
        if (house) {
          // Hipped roof: every edge rises to the footprint centre.
          for (let i = 0; i < n; i++) {
            const j = (i + 1) % n, edge = new T.Vector3(flat[j].x - flat[i].x, flat[j].y - flat[i].y, 0), up = new T.Vector3(-flat[i].x, -flat[i].y, roofHeight), nl = edge.cross(up).normalize(), nrm = world(nl.x, nl.y, Math.max(0.05, nl.z));
            const a = put(dirs[i], ground + eaves, nrm, colour, seed, 0, -1000, 0), b = put(dirs[j], ground + eaves, nrm, colour, seed, 0, -1000, 0), c = put(centre, ground + height, nrm, colour, seed, 0, -1000, 0);
            index.push(a, b, c);
          }
        } else {
          const top = dirs.map((d) => put(d, ground + height, centre, colour, seed, 0, -1000, 0));
          for (const t of T.ShapeUtils.triangulateShape(flat, [])) index.push(top[t[0]], top[t[1]], top[t[2]]);
        }
        footprints.push({ ring: ringLL, n, top: ground + height, base: ground + base - 2, minLon, maxLon, minLat, maxLat }); count++;
      }
    }
    if (index.length) {
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.Float32BufferAttribute(position, 3)); g.setAttribute("normal", new T.Float32BufferAttribute(normal, 3));
      g.setAttribute("tint", new T.BufferAttribute(new Uint8Array(tint), 4, true)); g.setAttribute("wall", new T.Float32BufferAttribute(wall, 3)); g.setIndex(index); g.computeBoundingSphere();
      group.add(new T.Mesh(g, this.buildingMaterial));
    }
    if (performance.now() > slice.until) yield;
    // Roads, runways, aprons and water are painted onto the terrain by GroundOverlay, so they cannot float.
    // --- trees: woods densely, parks and cemeteries sparsely, and street trees along residential roads
    const trees: [number, number, number, number][] = [], budget = 2600, seedBase = tile.x * 7919 + tile.y * 104729;
    let rnd = (seedBase >>> 0) || 1; const random = () => { rnd = (Math.imul(rnd, 1664525) + 1013904223) >>> 0; return rnd / 4294967296; };
    const scatter = (rings: Float32Array[], spacing: number, conifer: number) => {
      const polygons: Float32Array[][] = []; for (const raw of rings) { let area = 0; const n = raw.length / 2 - 1; for (let i = 0, j = n - 1; i < n; j = i++) area += (raw[j * 2] - raw[i * 2]) * (raw[j * 2 + 1] + raw[i * 2 + 1]); if (area > 0) polygons.push([raw]); else polygons.at(-1)?.push(raw); }
      const metre = extent / (scaleX * (360 / N)), inside = (x: number, y: number, raw: Float32Array) => { let hit = false; const n = raw.length / 2; for (let i = 0, j = n - 1; i < n; j = i++) { const ax = raw[i * 2], ay = raw[i * 2 + 1], bx = raw[j * 2], by = raw[j * 2 + 1]; if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) hit = !hit; } return hit; };
      for (const poly of polygons) {
        const outer = poly[0]; let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (let i = 0; i < outer.length; i += 2) { x0 = Math.min(x0, outer[i]); x1 = Math.max(x1, outer[i]); y0 = Math.min(y0, outer[i + 1]); y1 = Math.max(y1, outer[i + 1]); }
        x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(extent, x1); y1 = Math.min(extent, y1); if (x1 <= x0 || y1 <= y0) continue;
        const want = Math.min(budget - trees.length, Math.round(((x1 - x0) * (y1 - y0)) / (metre * metre) / (spacing * spacing)));
        for (let k = 0; k < want * 1.4 && trees.length < budget; k++) { const x = x0 + random() * (x1 - x0), y = y0 + random() * (y1 - y0); if (!inside(x, y, outer) || poly.slice(1).some((h) => inside(x, y, h))) continue; trees.push([lon(x), lat(y), random() < conifer ? 1 : 0, random()]); }
      }
    };
    for (const f of layers.landcover?.features ?? []) { if (performance.now() > slice.until) yield; if (f.type === 3 && f.properties.class === "wood") scatter(f.rings, 11, 0.2); }
    for (const f of layers.park?.features ?? []) { if (performance.now() > slice.until) yield; if (f.type === 3) scatter(f.rings, 34, 0.05); }
    for (const f of layers.transportation?.features ?? []) {
      if (performance.now() > slice.until) yield;
      if (f.type !== 2 || f.properties.class !== "minor" || trees.length >= budget) continue;
      for (const raw of f.rings) for (let i = 0; i + 3 < raw.length; i += 2) {
        const ax = lon(raw[i]), ay = lat(raw[i + 1]), bx = lon(raw[i + 2]), by = lat(raw[i + 3]), dx = (bx - ax) * scaleX, dy = (by - ay) * scaleY, l = Math.hypot(dx, dy); if (l < 1) continue;
        for (let s = 9; s < l && trees.length < budget; s += 16) { if (random() > 0.42) continue; const side = random() < 0.5 ? -1 : 1, off = 7.5 + random() * 2, t = s / l; trees.push([ax + (bx - ax) * t + (side * (-dy / l) * off) / scaleX, ay + (by - ay) * t + (side * (dx / l) * off) / scaleY, 0, random()]); }
      }
    }
    if (performance.now() > slice.until) yield;
    if (trees.length) {
      const mesh = new T.InstancedMesh(this.treeGeometry, this.treeMaterial, trees.length), m = new T.Matrix4(), q = new T.Quaternion(), colour = new T.Color(), yAxis = new T.Vector3(0, 1, 0);
      for (let i = 0; i < trees.length; i++) {
        if (i % 128 === 0 && performance.now() > slice.until) yield;
        const [lo, la, conifer, r] = trees[i];
        const d = new T.Vector3(...latLonToDir(la, lo)), h = this.terrain.height(la, lo), height = this.terrain.blast(la, lo) > 0.15 ? 0 : (conifer ? 13 : 8) + r * r * 12;
        q.setFromUnitVectors(yAxis, d).multiply(new T.Quaternion().setFromAxisAngle(yAxis, r * 6.28));
        m.compose(d.clone().multiplyScalar(EARTH.radius + (h - 0.4) / 1000).sub(this.anchor), q, new T.Vector3(height * (conifer ? 0.42 : 0.8 + r * 0.35), height, height * (conifer ? 0.42 : 0.8 + r * 0.35)).multiplyScalar(0.001));
        mesh.setMatrixAt(i, m);
        // UK broadleaf greens with some autumn bronze and dark conifers.
        // Muted UK summer foliage: olive to deep green, a few lighter limes and planes, conifers darker and bluer.
        colour.setHSL(conifer ? 0.4 : 0.22 + r * 0.07, conifer ? 0.22 : 0.24 + r * 0.12, conifer ? 0.13 : 0.15 + r * 0.07);
        mesh.setColorAt(i, colour);
      }
      mesh.computeBoundingSphere(); newTrees = mesh; group.add(mesh);
    }
    if (performance.now() > slice.until) yield;
    // --- parked airliners: one per mapped gate, nose to the nearest terminal building
    const gates: [number, number, number?, number?][] = [];
    for (const f of layers.aeroway?.features ?? []) if (f.type === 1 && (f.properties.class === "gate" || f.properties.class === "parking_position")) for (const r of f.rings) gates.push([lon(r[0]), lat(r[1])]);
    const mapped = gates.length;
    // Most stands are not mapped as gates: also park along apron edges that face a building, every 62 m.
    const nearBuilding = (lo: number, la: number) => { let best = 1e9; for (const b of footprints) { const dx = Math.max(b.minLon - lo, 0, lo - b.maxLon) * scaleX, dy = Math.max(b.minLat - la, 0, la - b.maxLat) * scaleY, d = Math.hypot(dx, dy); if (d < best) best = d; } return best; };
    for (const f of layers.aeroway?.features ?? []) {
      if (performance.now() > slice.until) yield;
      if (f.type !== 3 || f.properties.class !== "apron") continue;
      for (const raw of f.rings) {
        const n = raw.length / 2 - 1; if (n < 3) continue;
        const inside = (x: number, y: number) => { let hit = false; for (let i = 0, j = n - 1; i < n; j = i++) { const ax = raw[i * 2], ay = raw[i * 2 + 1], bx = raw[j * 2], by = raw[j * 2 + 1]; if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) hit = !hit; } return hit; };
        const metre = extent / (scaleX * (360 / N));
        for (let i = 0; i < n && gates.length < 160; i++) {
          const ax = raw[i * 2], ay = raw[i * 2 + 1], bx = raw[i * 2 + 2], by = raw[i * 2 + 3], length = Math.hypot(bx - ax, by - ay) / metre; if (length < 50) continue;
          const nx = -(by - ay) / (length * metre), ny = (bx - ax) / (length * metre);
          for (let t = 31; t < length - 25; t += 62) {
            const ex = ax + ((bx - ax) * t) / length, ey = ay + ((by - ay) * t) / length;
            // Stands line apron edges: nose to the terminal where there is one, otherwise to the apron edge (remote stands).
            if (nearBuilding(lon(ex), lat(ey)) > 45 && length < 120) continue;
            // Step 30 m into the apron, whichever side that is.
            let px = ex + nx * 30 * metre, py = ey + ny * 30 * metre; if (!inside(px, py)) { px = ex - nx * 30 * metre; py = ey - ny * 30 * metre; if (!inside(px, py)) continue; }
            const plo = lon(px), pla = lat(py); if (gates.some(([g, h]) => Math.hypot((g - plo) * scaleX, (h - pla) * scaleY) < 48)) continue;
            gates.push([plo, pla, lon(ex), lat(ey)]);
          }
        }
      }
    }
    if (gates.length) {
      const liveries = [[0.08, 0.13, 0.35], [0.75, 0.08, 0.1], [0.1, 0.35, 0.6], [0.95, 0.55, 0.1], [0.3, 0.1, 0.4], [0.05, 0.45, 0.35]], body = new T.InstancedMesh(this.airliner, this.airlinerMaterial, gates.length), fin = new T.InstancedMesh(this.fin, this.finMaterial, gates.length), m = new T.Matrix4(), colour = new T.Color();
      const centres = footprints.map((b) => [(b.minLon + b.maxLon) / 2, (b.minLat + b.maxLat) / 2, (b.maxLon - b.minLon) * (b.maxLat - b.minLat)] as const).filter((c) => c[2] > 2e-7);
      gates.forEach(([lo, la, faceLon, faceLat], i) => {
        let target: readonly [number, number, number] | null = null, best = 1e9; for (const c of centres) { const d = Math.hypot((c[0] - lo) * scaleX, (c[1] - la) * scaleY); if (d < best) { best = d; target = c; } }
        const bearing = faceLon !== undefined && faceLat !== undefined && !(target && best < 120) ? Math.atan2((faceLon - lo) * scaleX, (faceLat - la) * scaleY) : target && best < 400 ? Math.atan2((target[0] - lo) * scaleX, (target[1] - la) * scaleY) : hash(i, tile.x) * 6.28;
        const up = new T.Vector3(...latLonToDir(la, lo)), east = new T.Vector3(0, 1, 0).cross(up).normalize(), north = up.clone().cross(east), forward = north.multiplyScalar(Math.cos(bearing)).addScaledVector(east, Math.sin(bearing));
        const q = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(forward.clone().cross(up), up, forward.clone().negate()));
        const at = up.clone().multiplyScalar(EARTH.radius + (this.terrain.height(la, lo) + 0.2) / 1000).sub(this.anchor).addScaledVector(forward, i < mapped ? -0.018 : 0);
        m.compose(at, q, new T.Vector3(1, 1, 1)); body.setMatrixAt(i, m); fin.setMatrixAt(i, m);
        const l = liveries[Math.floor(hash(Math.round(lo * 1e5), Math.round(la * 1e5)) * liveries.length)]; fin.setColorAt(i, colour.setRGB(l[0], l[1], l[2]));
      });
      body.computeBoundingSphere(); fin.computeBoundingSphere(); group.add(body, fin);
    }
    // --- place names for the label overlay
    tile.places = [];
    for (const f of layers.place?.features ?? []) { const rank = PLACE_RANK[String(f.properties.class ?? "")], name = String(f.properties["name:en"] || f.properties["name:latin"] || f.properties.name || ""); if (!rank || !name || f.type !== 1 || !f.rings[0]) continue; tile.places.push({ lon: lon(f.rings[0][0]), lat: lat(f.rings[0][1]), name, rank }); }
    tile.centre = new T.Vector3(...latLonToDir(lat(extent / 2), lon(extent / 2))).multiplyScalar(EARTH.radius);
    this.dispose(tile); tile.footprints = footprints; tile.trees = newTrees;
    tile.group = group; tile.buildings = count; tile.state = "built"; tile.revision = this.terrain.revision; this.group.add(group);
  }
  /** True when a point (degrees, metres above sea level) is inside a streamed building. */
  hit(lat: number, lon: number, altitude: number) {
    const x = Math.floor(((lon + 180) / 360) * N), r = (lat * Math.PI) / 180, y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * N), tile = this.tiles.get(`${x}/${y}`);
    if (!tile) return false;
    for (const b of tile.footprints) {
      if (lon < b.minLon || lon > b.maxLon || lat < b.minLat || lat > b.maxLat || altitude > b.top || altitude < b.base) continue;
      let inside = false; const ring = b.ring; for (let i = 0, j = b.n - 1; i < b.n; j = i++) { const ax = ring[i * 2], ay = ring[i * 2 + 1], bx = ring[j * 2], by = ring[j * 2 + 1]; if (ay > lat !== by > lat && lon < ((bx - ax) * (lat - ay)) / (by - ay) + ax) inside = !inside; }
      if (inside) return true;
    }
    return false;
  }
  update(position: V, time: number, speed: number) {
    const body = inertialToBody(position, time, EARTH.rotation), loc = dirToLatLon(body), altitude = (Math.hypot(...position) - EARTH.radius) * 1000;
    const active = this.enabled && altitude < 9000 && speed < 900 && Math.abs(loc.lat) < 80;
    this.group.visible = this.tiles.size > 0 && altitude < 14000;
    if (active && !this.template) void this.source();
    const here = new T.Vector3(...body).normalize().multiplyScalar(EARTH.radius);
    // Keep vertex coordinates small: move the shared anchor when the aircraft has wandered far from it.
    if (!this.anchored || here.distanceTo(this.anchor) > 90) { this.job = null; for (const t of this.tiles.values()) { this.dispose(t); if (t.state === "built") t.state = "decoded"; } this.anchor.copy(here); this.anchored = true; }
    const r = (loc.lat * Math.PI) / 180, cx = Math.floor(((loc.lon + 180) / 360) * N), cy = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * N);
    if (active && this.template) {
      // Nearest tiles first, a few requests at a time.
      const wanted: [number, number, number][] = []; for (let dy = -RADIUS; dy <= RADIUS; dy++) for (let dx = -RADIUS; dx <= RADIUS; dx++) wanted.push([cx + dx, cy + dy, dx * dx + dy * dy]);
      wanted.sort((a, b) => a[2] - b[2]);
      for (const [x, y] of wanted) { const key = `${((x % N) + N) % N}/${y}`; if (y < 0 || y >= N || this.tiles.has(key) || this.inflight >= 3) continue; const tile: Tile = { key, x: ((x % N) + N) % N, y, state: "loading", footprints: [], revision: -1, buildings: 0, places: [] }; this.tiles.set(key, tile); void this.fetchTile(tile); }
      // One geometry build per frame: decoded tiles first, then tiles whose ground has changed under them.
      let next: Tile | null = null, best = 1e9;
      for (const t of this.tiles.values()) { const d = (t.x - cx) ** 2 + (t.y - cy) ** 2; if ((t.state === "decoded" || (t.state === "built" && t.revision !== this.terrain.revision && d <= 2)) && d + (t.state === "built" ? 100 : 0) < best) { best = d + (t.state === "built" ? 100 : 0); next = t; } }
      if (!this.job && next && (next.state === "decoded" || time - this.rebuilt > 2)) { if (next.state === "built") this.rebuilt = time; this.job = { tile: next, steps: this.build(next, this.budget) }; }
    }
    // Advance the current build by a few milliseconds a frame; drop it if its tile was unloaded meanwhile.
    if (this.job) {
      if (this.tiles.get(this.job.tile.key) !== this.job.tile) this.job = null;
      else { this.budget.until = performance.now() + BUILD_BUDGET_MS; if (this.job.steps.next().done) this.job = null; }
    }
    for (const [key, t] of this.tiles) if (Math.abs(t.x - cx) > KEEP || Math.abs(t.y - cy) > KEEP) { if (t.state === "loading") continue; this.dispose(t); this.tiles.delete(key); this.revision++; }
    for (const t of this.tiles.values()) if (t.trees && t.centre) t.trees.visible = altitude < 2500 && t.centre.distanceTo(here) < 3.2;
    if (!this.group.visible) { this.clearLabels(); return; }
    this.group.rotation.y = (time / EARTH.rotation) * Math.PI * 2;
    this.group.position.set(...bodyToInertial(this.anchor.toArray() as V, time, EARTH.rotation)).sub(new T.Vector3(...position));
  }
  private rebuilt = -10;
  private job: { tile: Tile; steps: Generator<void, void, void> } | null = null; private budget = { until: 0 };
  private clearLabels() { if (this.labels.width) this.label.clearRect(0, 0, this.labels.width, this.labels.height); }
  /** Town, suburb and village names floating over the ground; brighter and larger for bigger places. */
  private placeBody = new WeakMap<Place, V>(); private placeRevision = -1;
  drawLabels(camera: T.PerspectiveCamera, position: V, time: number, show: boolean) {
    const w = innerWidth, h = innerHeight, dpr = Math.min(devicePixelRatio, 2), c = this.label;
    if (this.labels.width !== w * dpr || this.labels.height !== h * dpr) { this.labels.width = w * dpr; this.labels.height = h * dpr; this.labels.style.width = w + "px"; this.labels.style.height = h + "px"; }
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    const altitude = (Math.hypot(...position) - EARTH.radius) * 1000; if (!show || altitude > 6000) return;
    if (this.placeRevision !== this.terrain.revision) { this.placeRevision = this.terrain.revision; this.placeBody = new WeakMap(); }
    const ship = new T.Vector3(...position), seen = new Set<string>(), drawn: [number, number, number][] = [], items: { x: number; y: number; d: number; p: Place }[] = [];
    for (const t of this.tiles.values()) for (const p of t.places) {
      if (seen.has(p.name)) continue; seen.add(p.name);
      // A place's ground point only changes when terrain does; the per-frame cost is the rotation into the scene.
      let body = this.placeBody.get(p);
      if (!body) { body = latLonToDir(p.lat, p.lon).map((v) => v * (EARTH.radius + (this.terrain.height(p.lat, p.lon) + 60 + p.rank * 25) / 1000)) as V; this.placeBody.set(p, body); }
      const world = new T.Vector3(...bodyToInertial(body, time, EARTH.rotation)).sub(ship), d = world.length();
      if (d > 2.5 + p.rank * 2.5) continue;
      const view = world.clone().applyMatrix4(camera.matrixWorldInverse); if (view.z > -0.05) continue;
      const ndc = world.project(camera); if (Math.abs(ndc.x) > 1.05 || Math.abs(ndc.y) > 1.05) continue;
      items.push({ x: (ndc.x * 0.5 + 0.5) * w, y: (-ndc.y * 0.5 + 0.5) * h, d, p });
    }
    items.sort((a, b) => b.p.rank - a.p.rank || a.d - b.d);
    c.textAlign = "center"; c.textBaseline = "bottom";
    for (const it of items) {
      const size = 9 + it.p.rank * 2.2, text = it.p.rank >= 4 ? it.p.name.toUpperCase() : it.p.name, width = c.measureText(text).width * (size / 10);
      if (drawn.some(([x, y, r]) => Math.abs(x - it.x) < (r + width) / 2 + 8 && Math.abs(y - it.y) < size + 6)) continue; drawn.push([it.x, it.y, width]);
      const fade = Math.min(1, (2.5 + it.p.rank * 2.5 - it.d) / 1.5);
      c.globalAlpha = fade * 0.95; c.font = `${it.p.rank >= 4 ? 600 : 500} ${size}px system-ui,sans-serif`; c.lineWidth = 3; c.strokeStyle = "#04121acc"; c.fillStyle = it.p.rank >= 4 ? "#ffffff" : "#d8efe9";
      c.strokeText(text, it.x, it.y - 5); c.fillText(text, it.x, it.y - 5);
      c.fillRect(it.x - 1, it.y - 4, 2, 4);
    }
    c.globalAlpha = 1;
  }
}
/** One broadleaf crown on a trunk (unit height, base at the origin) plus a conifer variant chosen by scale only. */
/** Marks geometry shared between tiles so tile disposal leaves it alone. */
function shared<G extends T.BufferGeometry>(g: G) { g.userData.shared = true; return g; }
function treeGeometry() {
  // Three overlapping lumps make a broken, natural crown; vertex colour darkens the underside and the inner lumps.
  const lumps: T.BufferGeometry[] = [];
  for (const [x, y, z, r] of [[0, 0.66, 0, 0.36], [0.17, 0.55, 0.1, 0.27], [-0.15, 0.58, -0.12, 0.28]] as const) {
    const g = new T.IcosahedronGeometry(r, 1).toNonIndexed(); g.translate(x, y, z); lumps.push(g);
  }
  const trunk = new T.CylinderGeometry(0.035, 0.06, 0.42, 5, 1, true).toNonIndexed(); trunk.translate(0, 0.21, 0);
  const parts = [...lumps, trunk], merged = new T.BufferGeometry(), positions: number[] = [], colours: number[] = [];
  parts.forEach((g, k) => { const p = g.getAttribute("position"); for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), wobble = 1 + 0.1 * Math.sin(x * 23 + z * 17) * Math.cos(y * 19);
    positions.push(k < 3 ? x * wobble : x, y, k < 3 ? z * wobble : z);
    if (k === 3) colours.push(0.32, 0.25, 0.18); else { const shade = 0.5 + 0.6 * Math.max(0, Math.min(1, (y - 0.3) / 0.65)); colours.push(shade, shade, shade); }
  } });
  merged.setAttribute("position", new T.Float32BufferAttribute(positions, 3)); merged.setAttribute("color", new T.Float32BufferAttribute(colours, 3));
  merged.computeVertexNormals(); return merged;
}
