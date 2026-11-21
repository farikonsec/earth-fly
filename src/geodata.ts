export type Point = [number, number];
export interface Feature {
  id: string;
  kind: "forest" | "water" | "river";
  name: string;
  ring: Point[];
  holes?: Point[][];
  elevation?: number | null;
  width?: number;
  water?: string;
}
/** Bands per degree of latitude for the ray-crossing cache (about 110 m each). */
const STRIPES = 1000;
const ringStripes=new WeakMap<Point[],Map<number,number[]>>();
export function insideRing(lon: number, lat: number, ring: Point[]) {
  // Ray crossings only need edges spanning this latitude. Cache immutable data rings.
  if(ring.length>512){
    let stripes=ringStripes.get(ring);
    if(!stripes){stripes=new Map();for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j],lo=Math.floor(Math.min(a[1],b[1])*STRIPES),hi=Math.floor(Math.max(a[1],b[1])*STRIPES);for(let y=lo;y<=hi;y++){const edges=stripes.get(y)??[];edges.push(i);stripes.set(y,edges);}}ringStripes.set(ring,stripes);}
    let hit=false;for(const i of stripes.get(Math.floor(lat*STRIPES))??[]){const a=ring[i],b=ring[(i+ring.length-1)%ring.length];if(a[1]>lat!==b[1]>lat&&lon<(b[0]-a[0])*(lat-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;
  }
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a[1] > lat !== b[1] > lat &&
      lon < ((b[0] - a[0]) * (lat - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
/** Bounding box of a ring, cached: most point tests fall outside it and skip the crossing count entirely. */
const ringBoxes = new WeakMap<Point[], [number, number, number, number]>();
function ringBox(ring: Point[]) {
  let box = ringBoxes.get(ring);
  if (!box) { box = [Infinity, Infinity, -Infinity, -Infinity]; for (const [x, y] of ring) { if (x < box[0]) box[0] = x; if (y < box[1]) box[1] = y; if (x > box[2]) box[2] = x; if (y > box[3]) box[3] = y; } ringBoxes.set(ring, box); }
  return box;
}
function insideBoxedRing(lon: number, lat: number, ring: Point[]) {
  const b = ringBox(ring);
  return lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3] && insideRing(lon, lat, ring);
}
export function insideFeature(lon: number, lat: number, f: Feature) {
  if (!insideBoxedRing(lon, lat, f.ring)) return false;
  if (f.holes) for (const r of f.holes) if (insideBoxedRing(lon, lat, r)) return false;
  return true;
}
export function hash(x: number, y: number) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Cell key for a 0.02° grid: numeric, so a lookup builds no strings. */
const cellKey = (x: number, y: number) => (x + 10000) * 20000 + (y + 10000);
export class GeoIndex {
  /** Features bucketed by kind, then by 0.02° cell. */
  cells = new Map<Feature["kind"], Map<number, Feature[]>>();
  broad:{feature:Feature;minX:number;maxX:number;minY:number;maxY:number}[]=[];
  constructor(public features: Feature[]) {
    for (const f of features) {
      if (f.kind === "river") continue;
      const box = ringBox(f.ring),
        minX = Math.floor(box[0] * 50),
        maxX = Math.floor(box[2] * 50),
        minY = Math.floor(box[1] * 50),
        maxY = Math.floor(box[3] * 50);
      if ((maxX - minX) * (maxY - minY) > 100000){this.broad.push({feature:f,minX:minX/50,maxX:(maxX+1)/50,minY:minY/50,maxY:(maxY+1)/50});continue;}
      let kind = this.cells.get(f.kind); if (!kind) this.cells.set(f.kind, (kind = new Map()));
      for (let y = minY; y <= maxY; y++)
        for (let x = minX; x <= maxX; x++) {
          const key = cellKey(x, y), list = kind.get(key);
          if (list) list.push(f); else kind.set(key, [f]);
        }
    }
  }
  at(lat: number, lon: number, kind: Feature["kind"]) {
    const list = this.cells.get(kind)?.get(cellKey(Math.floor(lon * 50), Math.floor(lat * 50)));
    if (list) for (const f of list) if (insideFeature(lon, lat, f)) return f;
    for (const b of this.broad) if (b.feature.kind === kind && lon >= b.minX && lon <= b.maxX && lat >= b.minY && lat <= b.maxY && insideFeature(lon, lat, b.feature)) return b.feature;
    return undefined;
  }
}
