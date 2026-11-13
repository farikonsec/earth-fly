import { sinkWater } from "./water-sites";
import { bundledTerrain, REFERENCE_DETAIL, summitTerrain, terrainAssetFolder, opticalTerrain } from "./terrain-data";
import { dirToLatLon, type EarthSurface } from "./geo";
import {caspianRegion} from './destinations';
import type { V } from "./vector";
export const TILE_SIZE = 256;
/** Keep the dense centre within 80 m on approach; permit 1 km offsets high above terrain. */
export function terrainRecenterKm(aglM = 10000) {
  return Math.max(.08, Math.min(1, aglM / 10000));
}
export function mercator(lat: number, lon: number, z: number) {
  const n = 2 ** z,
    a = (Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180;
  return {
    x: (((((lon + 180) / 360) % 1) + 1) % 1) * n,
    y: Math.max(
      0,
      Math.min(n - 1e-7, ((1 - Math.asinh(Math.tan(a)) / Math.PI) / 2) * n),
    ),
  };
}
export function decodeTerrarium(r: number, g: number, b: number) {
  return r * 256 + g + b / 256 - 32768;
}
function bilinear(
  data: Float32Array,
  w: number,
  h: number,
  x: number,
  y: number,
  wrap = false,
) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    a = x - ix,
    b = y - iy;
  const at = (i: number, j: number) =>
    data[
      Math.max(0, Math.min(h - 1, j)) * w +
        (wrap ? ((i % w) + w) % w : Math.max(0, Math.min(w - 1, i)))
    ];
  return (
    at(ix, iy) * (1 - a) * (1 - b) +
    at(ix + 1, iy) * a * (1 - b) +
    at(ix, iy + 1) * (1 - a) * b +
    at(ix + 1, iy + 1) * a * b
  );
}
export interface Tile {
  data: Float32Array;
  z: number;
  x: number;
  y: number;
  loaded: number;
}
/** One shared, synchronous height authority for both collision and rendering. */
/** A bundled bare-earth elevation grid (LIDAR), metres x10 in row-major order, row 0 at the north edge, pixel centres. */
export interface LocalDem { west: number; south: number; east: number; north: number; cols: number; rows: number; data: Int16Array; feather: number }
/** A strip where the surface model recorded a bridge deck as ground; the ground there takes the level beside the deck. */
export interface TerrainCut { lat: number; lon: number; east: number; north: number; half: number; width: number }
export interface TerrainGrade { west: number; south: number; dx: number; dy: number; nx: number; ny: number; margin: number; data: Float32Array }
/** A blast crater: a bowl `depth` m deep and `radius` m across with a raised lip, and the wider ring where buildings fall. */
export interface Crater { lat: number; lon: number; radius: number; depth: number; rim: number; blast: number }
export class Terrain {
  /** Replaced, never mutated, so the mesh worker can tell when to take a new copy. */
  craters: Crater[] | null = null;
  height(lat: number, lon: number) {
    const h = this.surfaceHeight(lat, lon), craters = this.craters;
    if (!craters) return this.decks ? Math.max(h, this.deckAt(lat, lon)) : h;
    let out = this.decks ? Math.max(h, this.deckAt(lat, lon)) : h;
    for (const c of craters) {
      const dy = (lat - c.lat) * 110540; if (Math.abs(dy) > c.radius * 1.8) continue;
      const d = Math.hypot((lon - c.lon) * 111320 * Math.cos((c.lat * Math.PI) / 180), dy) / c.radius; if (d >= 1.8) continue;
      const bowl = d < 1 ? 1 - d * d : 0;
      out += c.rim * Math.exp(-(((d - 1.08) / 0.22) ** 2)) - c.depth * bowl * Math.sqrt(bowl);
    }
    return out;
  }
  /** Flight decks of ships at sea, on the flight thread only: collision and landing treat them as ground, the mesh does not. */
  decks: { lat: number; lon: number; heading: number; halfLength: number; halfWidth: number; height: number }[] | null = null;
  /** Deck height in metres at a point, or 0 where there is no deck. */
  deckAt(lat: number, lon: number) {
    for (const d of this.decks ?? []) {
      const dy = (lat - d.lat) * 110540; if (Math.abs(dy) > d.halfLength + d.halfWidth) continue;
      const dx = (lon - d.lon) * 111320 * Math.cos((d.lat * Math.PI) / 180), h = (d.heading * Math.PI) / 180, along = dx * Math.sin(h) + dy * Math.cos(h), across = dx * Math.cos(h) - dy * Math.sin(h);
      if (Math.abs(along) < d.halfLength && Math.abs(across) < d.halfWidth) return d.height;
    }
    return 0;
  }
  /** 0 where nothing fell, 1 where nothing is left standing. */
  blast(lat: number, lon: number) {
    const craters = this.craters; if (!craters) return 0;
    let worst = 0;
    for (const c of craters) {
      const dy = (lat - c.lat) * 110540; if (Math.abs(dy) > c.blast) continue;
      const d = Math.hypot((lon - c.lon) * 111320 * Math.cos((c.lat * Math.PI) / 180), dy) / c.blast, k = Math.min(1, Math.max(0, (1 - d) / 0.6));
      worst = Math.max(worst, k * k * (3 - 2 * k));
    }
    return worst;
  }
  global: Float32Array = new Float32Array(720 * 361);
  polarNorth:Float32Array|null=null;polarSouth:Float32Array|null=null;
  tiles = new Map<string, Tile>();
  pending = new Map<string, Promise<void>>();
  failures = new Map<string, number>();
  revision = 0;
  generation = 0;
  meshSync = false;
  transitionReady = true;
  network = true;
  status = "Global relief";
  requests = 0;
  lastError = "";
  live = false;
  staged = new Map<string, Tile>();
  previous: Map<string, Tile> | null = null;
  blend = 1;
  detailHeld = false;
  waterLevel: ((lat: number, lon: number) => number | null) | null = null;
  async init() {
    const r = await fetch("terrain/global.f32");
    if (!r.ok) throw Error("Bundled terrain unavailable");
    const b = await r.arrayBuffer();
    if (b.byteLength !== 720 * 361 * 4)
      throw Error("Invalid bundled elevation grid");
    this.global = new Float32Array(b);
    const polar=await Promise.all(['north','south'].map(async side=>{try{const response=await fetch('terrain/polar-'+side+'.f32');if(!response.ok)return null;const buffer=await response.arrayBuffer();return buffer.byteLength===1440*81*4?new Float32Array(buffer):null;}catch{return null;}}));
    [this.polarNorth,this.polarSouth]=polar;
    this.revision++;
    this.generation++;
  }
  polar(lat:number,lon:number){const data=lat>=0?this.polarNorth:this.polarSouth;if(!data)return null;return bilinear(data,1440,81,((((lon+180)/360)%1+1)%1)*1440,lat>=0?(90-lat)/20*80:(-70-lat)/20*80,true);}
  coarse(lat: number, lon: number) {
    const value=bilinear(
      this.global,
      720,
      361,
      (((((lon + 180) / 360) % 1) + 1) % 1) * 720,
      ((90 - lat) / 180) * 360,
      true,
    );
    const polar=Math.abs(lat)>=70?this.polar(lat,lon):null,w=Math.max(0,Math.min(1,(Math.abs(lat)-70)/3));return polar===null?value:value+(polar-value)*w*w*(3-2*w);
  }
  private surfaceHeight(lat: number, lon: number) {
    const water = this.waterLevel?.(lat, lon);
    if (water !== null && water !== undefined) return sinkWater(lat, lon, water);
    let raw = sinkWater(lat, lon, this.cutHeight(lat, lon, this.rawHeight(lat, lon))), bare = 0;
    const dem = this.dem;
    if (dem && lon > dem.west && lon < dem.east && lat > dem.south && lat < dem.north) {
      // Survey-grade bare earth replaces the global surface model, feathered in over the grid's outer margin.
      const fx = ((lon - dem.west) / (dem.east - dem.west)) * dem.cols - 0.5, fy = ((dem.north - lat) / (dem.north - dem.south)) * dem.rows - 0.5;
      const ix = Math.max(0, Math.min(dem.cols - 2, Math.floor(fx))), iy = Math.max(0, Math.min(dem.rows - 2, Math.floor(fy))), tx = Math.max(0, Math.min(1, fx - ix)), ty = Math.max(0, Math.min(1, fy - iy)), k = iy * dem.cols + ix, d = dem.data;
      const h = ((d[k] * (1 - tx) + d[k + 1] * tx) * (1 - ty) + (d[k + dem.cols] * (1 - tx) + d[k + dem.cols + 1] * tx) * ty) / 10;
      const edge = Math.min(lon - dem.west, dem.east - lon, (lat - dem.south) * 1.6, (dem.north - lat) * 1.6) / dem.feather;
      bare = Math.min(1, edge); bare = bare * bare * (3 - 2 * bare); raw += (h - raw) * bare;
    }
    const g = this.grade;
    if (!g || bare >= 1) return raw;
    const gx = (lon - g.west) / g.dx, gy = (lat - g.south) / g.dy;
    if (gx <= 0 || gy <= 0 || gx >= g.nx || gy >= g.ny) return raw;
    const ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy, k = iy * (g.nx + 1) + ix, d = g.data,
      smooth = (d[k] * (1 - fx) + d[k + 1] * fx) * (1 - fy) + (d[k + g.nx + 1] * (1 - fx) + d[k + g.nx + 2] * fx) * fy,
      edge = Math.min(1, (Math.min(gx, g.nx - gx) * g.dx) / g.margin, (Math.min(gy, g.ny - gy) * g.dy) / g.margin);
    return raw + (smooth - raw) * edge * edge * (3 - 2 * edge) * (1 - bare);
  }
  /** Bridge strips (see TerrainCut); plain data so the mesh worker applies the same cut. */
  cuts: TerrainCut[] | null = null;
  private cutHeight(lat: number, lon: number, raw: number) {
    const cuts = this.cuts; if (!cuts) return raw;
    for (const c of cuts) {
      const k = Math.cos((c.lat * Math.PI) / 180), dx = (lon - c.lon) * 111320 * k, dy = (lat - c.lat) * 110540;
      const along = dx * c.east + dy * c.north, across = -dx * c.north + dy * c.east, F = 50;
      if (Math.abs(along) > c.half + F || Math.abs(across) > c.width + F) continue;
      // The level beside the deck at this point along it, from both sides.
      const side = (s: number) => { const ox = -c.north * s * (c.width + F), oy = c.east * s * (c.width + F); return this.rawHeight(lat + oy / 110540, lon + ox / (111320 * k)); };
      const level = (side(1) + side(-1)) / 2;
      let w = Math.min(1, (c.half + F - Math.abs(along)) / F, (c.width + F - Math.abs(across)) / F); w = w * w * (3 - 2 * w);
      return raw + (Math.min(raw, level) - raw) * w;
    }
    return raw;
  }
  /** Optional LIDAR bare-earth grid that overrides the global elevation where it covers. */
  dem: LocalDem | null = null;
  /**
   * Optional street-level field for a mapped city, where the elevation source carries rooftops.
   * Plain data so the mesh worker can apply the same correction.
   */
  grade: TerrainGrade | null = null;
  rawHeight(lat: number, lon: number) {
    const current = this.sample(lat, lon, this.tiles);
    if (!this.previous) return current;
    const old = this.sample(lat, lon, this.previous),
      w = this.blend * this.blend * (3 - 2 * this.blend);
    return old + (current - old) * w;
  }
  private sample(lat: number, lon: number, source: Map<string, Tile>, maxZoom = 12): number {
    const base = this.coarse(lat, lon);
    if(Math.abs(lat)>=84)return Math.max(0,base);
    for (let z = maxZoom; z >= 6; z--) {
      const m = mercator(lat, lon, z),
        x = Math.floor(m.x),
        y = Math.floor(m.y),
        tile = source.get(`${z}/${x}/${y}`);
      if (!tile) continue;
      const px = (m.x - x) * 256,
        py = (m.y - y) * 256;
      const n = 2 ** z,
        has = (dx: number, dy: number) =>
          source.has(`${z}/${(((x + dx) % n) + n) % n}/${y + dy}`);
      const edge = Math.min(
          has(-1, 0) ? 256 : px,
          has(0, -1) ? 256 : py,
          has(1, 0) ? 256 : 256 - px,
          has(0, 1) ? 256 : 256 - py,
        ),
        w = Math.min(1, Math.max(0, edge / 12));
      const ix = Math.floor(px - 0.5),
        iy = Math.floor(py - 0.5),
        fx = px - 0.5 - ix,
        fy = py - 0.5 - iy;
      const at = (i: number, j: number) => {
        const dx = Math.floor(i / 256),
          dy = Math.floor(j / 256),
          neighbor = source.get(`${z}/${(((x + dx) % n) + n) % n}/${y + dy}`);
        return neighbor
          ? neighbor.data[
              (((j % 256) + 256) % 256) * 256 + (((i % 256) + 256) % 256)
            ]
          : tile.data[
              Math.max(0, Math.min(255, j)) * 256 +
                Math.max(0, Math.min(255, i))
            ];
      };
      const detail =
        at(ix, iy) * (1 - fx) * (1 - fy) +
        at(ix + 1, iy) * fx * (1 - fy) +
        at(ix, iy + 1) * (1 - fx) * fy +
        at(ix + 1, iy + 1) * fx * fy;
      const parent = w < 1 ? this.sample(lat, lon, source, z - 1) : 0;
      const local=parent+(detail-parent)*w,polarWeight=Math.max(0,Math.min(1,(Math.abs(lat)-82)/2));return Math.max(0,local+(base-local)*polarWeight*polarWeight*(3-2*polarWeight));
    }
    return Math.max(0, base);
  }
  /** Staged data cannot raise terrain through a nearby vehicle. Rendering and collision blend together. */
  advance(seconds: number, lat: number, lon: number, altitudeM: number) {
    if (this.previous && this.transitionReady) {
      this.blend = Math.min(1, this.blend + Math.max(0, seconds) / 3);
      this.revision++;
      if (this.blend === 1) this.previous = null;
    }
    if (!this.staged.size || this.previous) return;
    const candidate = new Map(this.tiles);
    for (const [key, tile] of this.staged) candidate.set(key, tile);
    const old = this.height(lat, lon),
      next = this.sample(lat, lon, candidate);
    this.detailHeld = altitudeM - Math.max(old, next) < 1500;
    if (this.detailHeld) return;
    this.applyStaged(false);
  }
  applyStaged(immediate = true) {
    if (immediate && this.previous) {
      this.previous = null;
      this.blend = 1;
      this.transitionReady = true;
      this.revision++;
    }
    if (!this.staged.size) return;
    this.previous = immediate ? null : new Map(this.tiles);
    for (const [key, tile] of this.staged) this.tiles.set(key, tile);
    this.staged.clear();
    while (this.tiles.size > 96)
      this.tiles.delete(this.tiles.keys().next().value!);
    this.blend = immediate ? 1 : 0;
    this.transitionReady = immediate || !this.meshSync;
    this.generation++;
    this.detailHeld = false;
    this.revision++;
  }
  radiusM(dir: V, _minWave = 3) {
    const loc = dirToLatLon(dir);
    return 6371000 + this.height(loc.lat, loc.lon);
  }
  describe(lat: number, lon: number) {
    if (Math.abs(lat) > 85) return "Polar relief · NOAA ETOPO 2022";
    const fine=mercator(lat,lon,12),fx=Math.floor(fine.x),fy=Math.floor(fine.y);
    if(this.tiles.has(`12/${fx}/${fy}`)&&opticalTerrain(12,fx,fy))return 'Caucasus · finer optical terrain';
    const detail = mercator(lat, lon, 11), key = `11/${Math.floor(detail.x)}/${Math.floor(detail.y)}`;
    if (this.tiles.has(key)) return bundledTerrain(11, Math.floor(detail.x), Math.floor(detail.y))
      ? summitTerrain(11,Math.floor(detail.x),Math.floor(detail.y)) ? "Summits · finer bundled terrain" : "Alps · finer bundled terrain" : "World · finer streamed terrain";
    const p = mercator(lat, lon, 9), x = Math.floor(p.x), y = Math.floor(p.y);
    return this.tiles.has(`9/${x}/${y}`)
      ? bundledTerrain(9, x, y) ? summitTerrain(9,x,y) ? "Summits · bundled measured terrain" : "Alps · bundled measured terrain" : "World · streamed measured terrain"
      : "Coarse global relief · no local detail";
  }
  async tile(z: number, x: number, y: number) {
    const n = 2 ** z;
    x = ((x % n) + n) % n;
    if (y < 0 || y >= n) return;
    const bundled = bundledTerrain(z, x, y);
    if (!bundled && !this.network) {
      this.status = "Offline · global relief";
      return;
    }
    if (this.requests >= 6) return;
    const key = `${z}/${x}/${y}`;
    if (this.tiles.has(key) || this.staged.has(key)) return;
    if (this.pending.has(key)) return this.pending.get(key);
    if ((this.failures.get(key) ?? 0) > Date.now()) return;
    const promise = (async () => {
      this.requests++;
      try {
        const url = bundled
          ? `terrain/${terrainAssetFolder(z,x,y)}${key}.png`
          : `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${key}.png`;
        const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!r.ok) throw Error(`Terrain HTTP ${r.status}`);
        const bitmap = await createImageBitmap(await r.blob(), {
          colorSpaceConversion: "none",
        });
        const canvas = new OffscreenCanvas(256, 256),
          ctx = canvas.getContext("2d")!;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        const rgba = ctx.getImageData(0, 0, 256, 256).data,
          data = new Float32Array(65536),
          nearCaspian=(x+1)/n*360-180>=46&&x/n*360-180<=55&&Math.atan(Math.sinh(Math.PI*(1-2*y/n)))*180/Math.PI>=36&&Math.atan(Math.sinh(Math.PI*(1-2*(y+1)/n)))*180/Math.PI<=48;
        for (let i = 0; i < data.length; i++)
          {if(!nearCaspian){data[i]=Math.max(0,decodeTerrarium(rgba[i*4],rgba[i*4+1],rgba[i*4+2]));continue;}const px=x+(i%256+.5)/256,py=y+(Math.floor(i/256)+.5)/256,
            lat=Math.atan(Math.sinh(Math.PI*(1-2*py/n)))*180/Math.PI,lon=px/n*360-180;
           data[i]=Math.max(caspianRegion(lat,lon)?-500:0,decodeTerrarium(rgba[i*4],rgba[i*4+1],rgba[i*4+2]));}
        const destination = this.live ? this.staged : this.tiles;
        destination.set(key, { z, x, y, data, loaded: performance.now() });
        while (destination.size > 96)
          destination.delete(destination.keys().next().value!);
        if (this.tiles.size > 96)
          this.tiles.delete(this.tiles.keys().next().value!);
        this.revision++;
        if (!this.live) this.generation++;
        this.status = bundled
          ? summitTerrain(z,x,y) ? "Summits · bundled elevation" : "Alps · bundled elevation"
          : "World · streamed elevation";
      } catch (e) {
        this.lastError = String(e);
        this.failures.set(key, Date.now() + 60000);
        this.status = "Global relief · detail unavailable";
      } finally {
        this.pending.delete(key);
        this.requests--;
      }
    })();
    this.pending.set(key, promise);
    return promise;
  }
  async warmReferenceDetail() {
    const b = REFERENCE_DETAIL, jobs: (() => Promise<void>)[] = [];
    for (let x = b.minX; x <= b.maxX; x++)
      for (let y = b.minY; y <= b.maxY; y++) jobs.push(() => this.tile(b.z, x, y));
    for (let i = 0; i < jobs.length; i += 3)
      await Promise.all(jobs.slice(i, i + 3).map(job => job()));
  }
  async warmRegionalDetail(lat:number,lon:number){
    const m=mercator(lat,lon,12),jobs:(()=>Promise<void>)[]=[];
    for(let y=Math.floor(m.y)-1;y<=Math.floor(m.y)+1;y++)for(let x=Math.floor(m.x)-1;x<=Math.floor(m.x)+1;x++)if(opticalTerrain(12,x,y))jobs.push(()=>this.tile(12,x,y));
    for(let i=0;i<jobs.length;i+=3)await Promise.all(jobs.slice(i,i+3).map(job=>job()));
  }
  async warm(lat: number, lon: number, z = 9) {
    if (Math.abs(lat) > 85) {
      this.status = "Polar region · global relief";
      return;
    }
    const p = mercator(lat, lon, z),
      x = Math.floor(p.x),
      y = Math.floor(p.y);
    const jobs = [];
    for (let j = -1; j <= 1; j++)
      for (let i = -1; i <= 1; i++) jobs.push(() => this.tile(z, x + i, y + j));
    for (let n = 0; n < jobs.length; n += 3)
      await Promise.all(jobs.slice(n, n + 3).map((f) => f()));
  }
}
