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
const ringStripes=new WeakMap<Point[],Map<number,number[]>>();
export function insideRing(lon: number, lat: number, ring: Point[]) {
  // Ray crossings only need edges spanning this latitude. Cache immutable data rings.
  if(ring.length>512){
    let stripes=ringStripes.get(ring);
    if(!stripes){stripes=new Map();for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j],lo=Math.floor(Math.min(a[1],b[1])*100),hi=Math.floor(Math.max(a[1],b[1])*100);for(let y=lo;y<=hi;y++){const edges=stripes.get(y)??[];edges.push(i);stripes.set(y,edges);}}ringStripes.set(ring,stripes);}
    let hit=false;for(const i of stripes.get(Math.floor(lat*100))??[]){const a=ring[i],b=ring[(i+ring.length-1)%ring.length];if(a[1]>lat!==b[1]>lat&&lon<(b[0]-a[0])*(lat-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;
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
export function insideFeature(lon: number, lat: number, f: Feature) {
  return (
    insideRing(lon, lat, f.ring) &&
    !(f.holes ?? []).some((r) => insideRing(lon, lat, r))
  );
}
export function hash(x: number, y: number) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export class GeoIndex {
  cells = new Map<string, Feature[]>();
  broad:{feature:Feature;minX:number;maxX:number;minY:number;maxY:number}[]=[];
  constructor(public features: Feature[]) {
    for (const f of features) {
      if (f.kind === "river") continue;
      const xs = f.ring.map((p) => p[0]),
        ys = f.ring.map((p) => p[1]),
        minX = Math.floor(Math.min(...xs) * 50),
        maxX = Math.floor(Math.max(...xs) * 50),
        minY = Math.floor(Math.min(...ys) * 50),
        maxY = Math.floor(Math.max(...ys) * 50);
      if ((maxX - minX) * (maxY - minY) > 100000){this.broad.push({feature:f,minX:minX/50,maxX:(maxX+1)/50,minY:minY/50,maxY:(maxY+1)/50});continue;}
      for (let y = minY; y <= maxY; y++)
        for (let x = minX; x <= maxX; x++) {
          const key = `${x}/${y}`,
            list = this.cells.get(key) ?? [];
          list.push(f);
          this.cells.set(key, list);
        }
    }
  }
  at(lat: number, lon: number, kind: Feature["kind"]) {
    return (
      this.cells.get(`${Math.floor(lon * 50)}/${Math.floor(lat * 50)}`) ?? []
    ).find((f) => f.kind === kind && insideFeature(lon, lat, f)) ?? this.broad.find(b=>b.feature.kind===kind&&lon>=b.minX&&lon<=b.maxX&&lat>=b.minY&&lat<=b.maxY&&insideFeature(lon,lat,b.feature))?.feature;
  }
}
