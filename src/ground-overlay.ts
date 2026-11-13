import * as T from "three";
import type { MvtLayer } from "./mvt";

/**
 * Roads, railways, runways, taxiways, aprons and water painted into textures that the terrain shader samples with
 * the same Web Mercator mapping as the satellite imagery. Because the paint lives on the terrain itself, it can never
 * float, slide or separate from the ground. Two clip levels follow the aircraft: a sharp one (about 1 m per pixel
 * over 2.3 km) with markings, and a wide one (about 6 m per pixel over 9 km).
 */
export interface OverlayTile { x: number; y: number; layers: Record<string, MvtLayer> }
type P = [number, number];
const C = 40075016.686;
/** Side of the CPU water mask: 2,304 painted pixels over 3 zoom-15 tiles become 576, about 6 m each at London. */
const MASK = 576;
const ROAD: Record<string, { w: number; c: string; scheme: "motorway" | "a" | "minor" | "rail" | "path" }> = {
  motorway: { w: 27, c: "#2b2d30", scheme: "motorway" }, trunk: { w: 16, c: "#303236", scheme: "a" }, primary: { w: 13, c: "#33353a", scheme: "a" },
  secondary: { w: 10.5, c: "#393b40", scheme: "a" }, tertiary: { w: 8.5, c: "#3d3f43", scheme: "minor" }, minor: { w: 6.5, c: "#45474b", scheme: "minor" },
  service: { w: 4.2, c: "#4b4c4f", scheme: "minor" }, busway: { w: 7, c: "#3a3335", scheme: "minor" }, rail: { w: 5.5, c: "#4a4038", scheme: "rail" },
  transit: { w: 5.5, c: "#4a4038", scheme: "rail" },
  path: { w: 2.2, c: "#8a8170", scheme: "path" }, track: { w: 3, c: "#7d735f", scheme: "path" },
};
const ORDER = ["service", "track", "path", "minor", "tertiary", "busway", "secondary", "primary", "trunk", "rail", "transit", "motorway"];
/** Offsets a polyline sideways by d (same units as the points), keeping joints mitred. */
function offset(points: P[], d: number): P[] {
  return points.map((p, i) => {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [p[0] - (dy / l) * d, p[1] + (dx / l) * d];
  });
}

/** One clip level, drawn into its own rectangle of the shared canvas (the shader has few texture units to spare). */
class Level {
  origin = new T.Vector3(-1e6, -1e6, 0); drawnRevision = -1; drawnAt = -10;
  /** Set for a level with its own texture; otherwise it draws into the shared canvas at `left`. */
  own: { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D; texture: T.CanvasTexture<OffscreenCanvas> } | null = null;
  constructor(public zoom: number, public tilePx: number, public detailed: boolean, public left: number) {}
}

export class GroundOverlay {
  // Fine (0.25 m per pixel over 570 m, own texture so frequent repaints upload little), near (1 m over 2.3 km) and far (6 m over 9 km).
  private fine = new Level(17, 768, true, 0);
  private levels = [this.fine, new Level(15, 768, true, 0), new Level(13, 512, false, 2304)];
  private canvas = new OffscreenCanvas(2304 + 1536, 2304); private ctx = this.canvas.getContext("2d")!; private texture = new T.CanvasTexture(this.canvas);
  uniforms = {
    // Origins are copies: they change only when a repainted texture is published, so roads never sit on stale tiles.
    overlayMap: { value: this.texture as T.Texture }, overlayNearOrigin: { value: new T.Vector3(-1e6, -1e6, 15) }, overlayFarOrigin: { value: new T.Vector3(-1e6, -1e6, 13) },
    overlayFine: { value: null as T.Texture | null }, overlayFineOrigin: { value: new T.Vector3(-1e6, -1e6, 17) },
    overlayReady: { value: 0 }, overlayNight: { value: 0 },
  };
  constructor() {
    const setup = (t: T.CanvasTexture<OffscreenCanvas>) => { t.colorSpace = T.SRGBColorSpace; t.anisotropy = 16; t.minFilter = T.LinearMipmapLinearFilter; t.generateMipmaps = true; };
    setup(this.texture);
    const canvas = new OffscreenCanvas(2304, 2304), texture = new T.CanvasTexture(canvas); setup(texture);
    this.fine.own = { canvas, ctx: canvas.getContext("2d")!, texture }; this.uniforms.overlayFine.value = texture;
  }
  private maskCanvas = new OffscreenCanvas(MASK, MASK); private maskCtx = this.maskCanvas.getContext("2d", { willReadFrequently: true })!;
  private waterMask: Uint8ClampedArray | null = null; private waterOrigin = new T.Vector3(); private maskPending = false;
  /** True where the 1 m level has painted water (blue) under this point; false outside its 2.3 km or before it loads. */
  isWater(lat: number, lon: number) {
    const level = this.levels[1]; if (!this.uniforms.overlayReady.value || level.origin.x < 0) return false;
    const n = 2 ** level.zoom, r = (lat * Math.PI) / 180, x = (((lon + 180) / 360) * n - level.origin.x) * level.tilePx, y = (((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n - level.origin.y) * level.tilePx;
    if (x < 0 || y < 0 || x >= level.tilePx * 3 || y >= level.tilePx * 3) return false;
    // Lookups read a small CPU-side copy refreshed asynchronously after each repaint (refreshWaterMask); reading the
    // GPU-backed paint canvas directly stalled the pipeline for about 26 ms a call.
    const d = this.waterMask; if (!d || !this.waterOrigin.equals(level.origin)) return false;
    const scale = MASK / (level.tilePx * 3), i = (Math.floor(y * scale) * MASK + Math.floor(x * scale)) * 4;
    return d[i + 3] > 60 && d[i + 2] > 1.4 * Math.max(d[i], d[i + 1]);
  }
  private published: Record<string, number> = {};
  /**
   * Hands a repainted canvas to the GPU without blocking. Canvas 2D defers rasterising thousands of road paths until
   * the canvas is read, and a direct texture upload made the main thread wait for it (400 ms on a recentre). An
   * ImageBitmap resolves once that work is done elsewhere; the texture and the origins it was painted for swap in
   * together, and a newer repaint supersedes one still in flight.
   */
  private publish(key: string, canvas: OffscreenCanvas, texture: T.CanvasTexture<OffscreenCanvas>, origins: [Level, T.Vector3][]) {
    const generation = (this.published[key] = (this.published[key] ?? 0) + 1), snapshot = origins.map(([level, target]) => [level.origin.clone(), target] as const);
    createImageBitmap(canvas, { imageOrientation: "flipY" }).then((bitmap) => {
      if (generation !== this.published[key]) { bitmap.close(); return; }
      const previous = texture.image as unknown;
      (texture as unknown as T.Texture<ImageBitmap>).image = bitmap; texture.flipY = false; texture.needsUpdate = true;
      for (const [origin, target] of snapshot) target.copy(origin);
      // three uploads the new image on the next render; the old bitmap is no longer read.
      if (previous instanceof ImageBitmap) requestAnimationFrame(() => previous.close());
    }).catch(() => { texture.needsUpdate = true; for (const [origin, target] of snapshot) target.copy(origin); });
  }
  /** Copies the near level into the water mask without blocking: the GPU downsamples and reads back off-thread. */
  private refreshWaterMask(level: Level) {
    if (this.maskPending) return; this.maskPending = true;
    const span = level.tilePx * 3, origin = level.origin.clone();
    createImageBitmap(this.canvas, level.left, 0, span, span, { resizeWidth: MASK, resizeHeight: MASK, resizeQuality: "low" })
      .then((bitmap) => {
        this.maskCtx.clearRect(0, 0, MASK, MASK); this.maskCtx.drawImage(bitmap, 0, 0); bitmap.close();
        this.waterMask = this.maskCtx.getImageData(0, 0, MASK, MASK).data; this.waterOrigin.copy(origin);
      })
      .catch(() => {})
      .finally(() => { this.maskPending = false; });
  }
  /** Areas painted by other means (the London Thames mask), as [west, south, east, north]. */
  skipWater: [number, number, number, number][] = [];
  update(lat: number, lon: number, tiles: OverlayTile[], revision: number, time: number, active: boolean) {
    this.uniforms.overlayReady.value = active && tiles.length ? 1 : 0;
    if (!this.uniforms.overlayReady.value) return;
    let sharedDirty = false, fineDirty = false;
    for (const level of this.levels) {
      const n = 2 ** level.zoom, x = ((lon + 180) / 360) * n, r = (lat * Math.PI) / 180, y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
      const off = Math.abs(x - (level.origin.x + 1.5)) > 0.6 || Math.abs(y - (level.origin.y + 1.5)) > 0.6;
      // Recentre at once; repaint for newly streamed data at most every 1.5 s.
      if (off || (revision !== level.drawnRevision && time - level.drawnAt > 1.5)) {
        if (off) level.origin.set(Math.floor(x) - 1, Math.floor(y) - 1, level.zoom);
        this.paint(level, tiles, lat); level.drawnRevision = revision; level.drawnAt = time;
        if (level === this.fine) fineDirty = true; else sharedDirty = true;
        if (level === this.levels[1]) this.refreshWaterMask(level);
      }
    }
    if (sharedDirty) this.publish("shared", this.canvas, this.texture, [[this.levels[1], this.uniforms.overlayNearOrigin.value], [this.levels[2], this.uniforms.overlayFarOrigin.value]]);
    if (fineDirty && this.fine.own) this.publish("fine", this.fine.own.canvas, this.fine.own.texture, [[this.fine, this.uniforms.overlayFineOrigin.value]]);
  }
  private paint(level: Level, tiles: OverlayTile[], lat: number) {
    const c = level.own ? level.own.ctx : this.ctx, size = level.tilePx * 3;
    c.save(); c.translate(level.left, 0); c.beginPath(); c.rect(0, 0, size, size); c.clip();
    try { this.paintLevel(level, tiles, lat, size, c); } finally { c.restore(); }
  }
  private paintLevel(level: Level, tiles: OverlayTile[], lat: number, size: number, c: OffscreenCanvasRenderingContext2D) {
    const scale = 2 ** (level.zoom - 14), metre = level.tilePx / ((C * Math.cos((lat * Math.PI) / 180)) / 2 ** level.zoom);
    c.clearRect(0, 0, size, size); c.lineCap = "round"; c.lineJoin = "round";
    const px = (w: number) => Math.max(1, w * metre);
    const inView = (t: OverlayTile) => { const x0 = (t.x * scale - level.origin.x) * level.tilePx, y0 = (t.y * scale - level.origin.y) * level.tilePx, s = scale * level.tilePx; return x0 < size && y0 < size && x0 + s > 0 && y0 + s > 0; };
    const lines = (t: OverlayTile, ring: Float32Array, extent: number): P[] => { const out: P[] = []; for (let i = 0; i < ring.length; i += 2) out.push([((t.x + ring[i] / extent) * scale - level.origin.x) * level.tilePx, ((t.y + ring[i + 1] / extent) * scale - level.origin.y) * level.tilePx]); return out; };
    const path = (pts: P[], close = false) => { c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); if (close) c.closePath(); };
    const lonOf = (X: number) => (X / 2 ** level.zoom) * 360 - 180, latOf = (Y: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * Y) / 2 ** level.zoom))) * 180) / Math.PI;
    const skipped = (p: P) => { const lo = lonOf(level.origin.x + p[0] / level.tilePx), la = latOf(level.origin.y + p[1] / level.tilePx); return this.skipWater.some(([w, s, e, n]) => lo > w && lo < e && la > s && la < n); };
    const visible = tiles.filter(inView);
    // 1. Water: pure blue is the shader's water signal, so it gets proper reflections instead of flat paint. Sea
    // polygons count too: the global ocean mask is too coarse for firths and estuaries (the Forth drew as grass).
    c.fillStyle = c.strokeStyle = "#0000ff";
    for (const t of visible) {
      const water = t.layers.water;
      if (water) for (const f of water.features) { if (f.type !== 3) continue; c.beginPath(); for (const ring of f.rings) { const pts = lines(t, ring, water.extent); if (skipped(pts[0])) continue; pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath(); } c.fill("evenodd"); }
      const ways = t.layers.waterway;
      if (ways) for (const f of ways.features) { const w = ({ river: 16, canal: 13, stream: 3.5 } as Record<string, number>)[String(f.properties.class)]; if (f.type !== 2 || !w || f.properties.brunnel === "tunnel") continue; c.lineWidth = px(w); for (const ring of f.rings) { const pts = lines(t, ring, ways.extent); if (!skipped(pts[0])) { path(pts); c.stroke(); } } }
    }
    // 2. Aprons: concrete with slab joints on the sharp level.
    for (const t of visible) {
      const air = t.layers.aeroway; if (!air) continue;
      for (const f of air.features) {
        if (f.type !== 3 || !["apron", "taxiway", "runway", "helipad"].includes(String(f.properties.class))) continue;
        c.save(); c.beginPath(); for (const ring of f.rings) { const pts = lines(t, ring, air.extent); pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath(); }
        c.fillStyle = f.properties.class === "apron" ? "#8e8d88" : "#4a4b4e"; c.fill("evenodd");
        if (level.detailed && f.properties.class === "apron") { c.clip("evenodd"); c.strokeStyle = "rgba(40,40,38,.35)"; c.lineWidth = 1; const step = 7.5 * metre; c.beginPath(); for (let v = 0; v < size; v += step) { c.moveTo(v, 0); c.lineTo(v, size); c.moveTo(0, v); c.lineTo(size, v); } c.stroke(); }
        c.restore();
      }
    }
    // 3. Taxiways, then runways with full markings on the sharp level.
    for (const t of visible) {
      const air = t.layers.aeroway; if (!air) continue;
      for (const f of air.features) {
        if (f.type !== 2 || f.properties.class !== "taxiway") continue;
        for (const ring of f.rings) { const pts = lines(t, ring, air.extent); path(pts); c.strokeStyle = "#47484b"; c.lineWidth = px(23); c.stroke(); if (level.detailed) { c.strokeStyle = "#d9b21c"; c.lineWidth = px(0.35); c.stroke(); } }
      }
    }
    for (const t of visible) {
      const air = t.layers.aeroway; if (!air) continue;
      for (const f of air.features) {
        if (f.type !== 2 || f.properties.class !== "runway") continue;
        for (const ring of f.rings) {
          const pts = lines(t, ring, air.extent); path(pts);
          // Major runways are 45-60 m wide (Heathrow 50 m) with paved shoulders: the shoulders cover the photo's own edge lines so they do not double up.
          c.lineCap = "butt"; c.strokeStyle = "#3b3c3f"; c.lineWidth = px(64); c.stroke(); c.strokeStyle = "#e8e8e4"; c.lineWidth = px(50.5); c.stroke(); c.strokeStyle = "#26282b"; c.lineWidth = px(48.5); c.stroke(); c.lineCap = "round";
          if (!level.detailed) continue;
          c.strokeStyle = "#e8e8e4"; c.lineWidth = px(0.9); c.setLineDash([30 * metre, 20 * metre]); path(pts); c.stroke(); c.setLineDash([]);
          // Threshold piano keys, aiming points and touchdown-zone bars at both ends.
          for (const [a, b] of [[pts[0], pts[1]], [pts[pts.length - 1], pts[pts.length - 2]]] as [P, P][]) {
            const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l, nx = -uy, ny = ux;
            const bar = (along: number, across: number, length: number, width: number) => { const cx = a[0] + ux * along * metre + nx * across * metre, cy = a[1] + uy * along * metre + ny * across * metre; c.beginPath(); c.moveTo(cx - (nx * width * metre) / 2, cy - (ny * width * metre) / 2); c.lineTo(cx + (nx * width * metre) / 2, cy + (ny * width * metre) / 2); c.lineTo(cx + (nx * width * metre) / 2 + ux * length * metre, cy + (ny * width * metre) / 2 + uy * length * metre); c.lineTo(cx - (nx * width * metre) / 2 + ux * length * metre, cy - (ny * width * metre) / 2 + uy * length * metre); c.closePath(); c.fill(); };
            c.fillStyle = "#e8e8e4";
            for (let k = 0; k < 8; k++) { const across = 3 + k * 2.4; bar(6, across, 30, 1.6); bar(6, -across, 30, 1.6); }
            bar(400, 10.5, 50, 9); bar(400, -10.5, 50, 9);
            for (const along of [150, 300, 600, 750, 900]) for (const across of [6, 9, 12]) { bar(along, across, 22, 1.6); bar(along, -across, 22, 1.6); }
            // Rubber from touchdowns darkens the first kilometre.
            c.strokeStyle = "rgba(10,10,10,.28)"; c.lineWidth = px(18); c.beginPath(); c.moveTo(a[0] + ux * 250 * metre, a[1] + uy * 250 * metre); c.lineTo(a[0] + ux * 950 * metre, a[1] + uy * 950 * metre); c.stroke();
          }
        }
      }
    }
    // 4. Roads and railways, minor first so major roads sit on top at junctions.
    for (const cls of ORDER) {
      const style = ROAD[cls];
      for (const t of visible) {
        const way = t.layers.transportation; if (!way) continue;
        for (const f of way.features) {
          if (f.type !== 2 || f.properties.class !== cls || f.properties.brunnel === "tunnel") continue;
          const single=Number(f.properties.oneway)!==0&&[1,-1].includes(Number(f.properties.oneway))||f.properties.oneway==='yes';
          const width = (single&&cls==='motorway'?11:single&&cls==='trunk'?9:style.w) * (Number(f.properties.ramp) === 1 ? 0.5 : 1);
          for (const ring of f.rings) {
            const pts = lines(t, ring, way.extent);
            // A darker kerb line, then the carriageway.
            path(pts); c.strokeStyle = style.scheme === "path" ? "rgba(0,0,0,0)" : "#25262a"; c.lineWidth = px(width + 1.2); c.stroke();
            c.strokeStyle = style.c; c.lineWidth = px(width); c.stroke();
            if (!level.detailed) continue;
            if (style.scheme === "motorway"&&single) {
              c.strokeStyle='#e6e6e2';c.lineWidth=px(.2);for(const side of[-1,1]){path(offset(pts,side*(width/2-1)*metre));c.stroke();}
              c.setLineDash([3*metre,7*metre]);path(pts);c.stroke();c.setLineDash([]);
            } else if (style.scheme === "motorway") {
              path(pts); c.strokeStyle = "#4d5a44"; c.lineWidth = px(2.6); c.stroke();
              c.strokeStyle = "#e6e6e2"; c.lineWidth = px(0.25);
              for (const side of [-1, 1]) { path(offset(pts, side * (width / 2 - 0.8) * metre)); c.stroke(); path(offset(pts, side * 1.8 * metre)); c.stroke(); }
              c.setLineDash([2 * metre, 7 * metre]); for (const side of [-1, 1]) for (const k of [1, 2]) { path(offset(pts, side * (1.8 + ((width / 2 - 2.6) * k) / 3) * metre)); c.stroke(); } c.setLineDash([]);
            } else if (style.scheme === "a") {
              c.strokeStyle = "#e6e6e2"; c.lineWidth = px(0.15); c.setLineDash([4 * metre, 5 * metre]); path(pts); c.stroke(); c.setLineDash([]);
              for (const side of [-1, 1]) { path(offset(pts, side * (width / 2 - 0.5) * metre)); c.stroke(); }
            } else if (style.scheme === "rail") {
              c.strokeStyle = "#a5a5a0"; c.lineWidth = px(0.16); for (const side of [-0.7175, 0.7175]) { path(offset(pts, side * metre)); c.stroke(); }
            }
          }
        }
      }
    }
  }
}

/** Shader side: same tile mapping as the satellite atlases. Declares overlayWater/overlayPaint for later stages. */
export const overlayGLSL = /* glsl */ `
uniform sampler2D overlayMap;uniform vec3 overlayNearOrigin;uniform vec3 overlayFarOrigin;uniform sampler2D overlayFine;uniform vec3 overlayFineOrigin;uniform float overlayReady;uniform float overlayNight;
float overlayWater=0.,overlayPaint=0.;
vec2 overlayUV(vec3 origin,vec2 geo,out float inside){
  vec2 rel=webTile(origin,geo);vec2 uv=vec2(rel.x/3.,1.-rel.y/3.);
  float edge=min(min(uv.x,uv.y),min(1.-uv.x,1.-uv.y));inside=smoothstep(0.,.04,edge);
  return clamp(uv,0.,1.);
}
// rect: u offset, u scale, v scale (both shared levels hang from the top edge of the shared canvas).
vec4 readOverlay(vec3 origin,vec2 geo,vec4 rect,out float inside){vec2 uv=overlayUV(origin,geo,inside);return texture2D(overlayMap,vec2(rect.x+uv.x*rect.y,1.-(1.-uv.y)*rect.z));}
vec3 applyOverlay(vec3 base,vec2 geo){
  if(overlayReady<.5)return base;
  float inNear,inFar;vec4 near=readOverlay(overlayNearOrigin,geo,vec4(0.,2304./3840.,1.,0.),inNear),far=readOverlay(overlayFarOrigin,geo,vec4(2304./3840.,1536./3840.,1536./2304.,0.),inFar);
  float inFine;vec4 fine=texture2D(overlayFine,overlayUV(overlayFineOrigin,geo,inFine));
  vec4 o=mix(mix(far*inFar,near,inNear),fine,inFine);
  // Pure blue marks water: hand it to the water shading instead of painting it.
  float blue=clamp((o.b-max(o.r,o.g))*1.6,0.,1.);overlayWater=o.a*blue;overlayPaint=o.a*(1.-blue);
  return mix(base,o.rgb,overlayPaint);
}`;
