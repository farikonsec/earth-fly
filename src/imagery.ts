import * as T from "three";
import { mercator } from "./terrain";
import { summitTiles } from './summits';
import {ALL_PEAKS as SUMMITS,CASPIAN} from './destinations';
const bundledOrigins=new Set([...SUMMITS,CASPIAN].map(s=>{const t=summitTiles(s,8)[0];return `${t.x}/${t.y}`;}));
export class Imagery {
  texture: T.CanvasTexture<OffscreenCanvas> | null = null;
  origin: { x: number; y: number; z: number } | null = null;
  busy = false;
  revision = 0;
  status = "NASA global imagery";
  network = true;
  altitude=0;
  overview:T.CanvasTexture<OffscreenCanvas>|null=null;
  overviewOrigin={x:653,y:385,z:10};
  async warmOverview(){
   const m=mercator(40.4,50.05,10),x=Math.floor(m.x)-1,y=Math.floor(m.y)-1;this.overviewOrigin={x,y,z:10};
   const canvas=new OffscreenCanvas(768,768),ctx=canvas.getContext("2d")!;
   await Promise.all(Array.from({length:9},async(_,i)=>{const r=await fetch(`imagery/absheron/10/${x+i%3}/${y+Math.floor(i/3)}.jpeg`);if(!r.ok)throw Error("Absheron overview unavailable");const image=await createImageBitmap(await r.blob());ctx.drawImage(image,i%3*256,Math.floor(i/3)*256);image.close();}));
   this.overview=new T.CanvasTexture(canvas);this.overview.colorSpace=T.SRGBColorSpace;this.overview.anisotropy=8;
  }
  focusSummit: string | null = null;
  contains(lat: number, lon: number) {
    const uv = this.uv(lat, lon);
    return !!uv && uv.u > 0.05 && uv.u < 0.95 && uv.v > 0.05 && uv.v < 0.95;
  }
  uv(lat: number, lon: number) {
    if (!this.origin) return null;
    const m = mercator(lat, lon, this.origin.z),
      n = 2 ** this.origin.z;
    let dx = m.x - this.origin.x;
    if (dx > n / 2) dx -= n;
    if (dx < -n / 2) dx += n;
    return { u: dx / 3, v: 1 - (m.y - this.origin.y) / 3 };
  }
  async warm(lat: number, lon: number) {
    if (this.busy) return;
    if (Math.abs(lat) > 84) {
      this.origin = null;
      this.revision++;
      return;
    }
    const candidate=[...SUMMITS,CASPIAN].find(s=>s.id===this.focusSummit)??(Math.hypot((lat-40.4)*111,(lon-50.05)*85)<50?CASPIAN:null),detail=candidate&&candidate.id!=='vinson'&&Math.hypot((lat-candidate.lat)*111.195,(lon-candidate.lon)*111.195*Math.cos(lat*Math.PI/180))<50?candidate:null,
      overview=detail?.id==='caspian'&&this.altitude>3500,z=overview?10:detail?12:8,n=2**z,m = mercator(overview?40.4:detail?.lat??lat, overview?50.05:detail?.lon??lon, z),
      x = Math.floor(m.x) - 1,
      y = Math.max(0, Math.min(n-3, Math.floor(m.y) - 1));
    if (this.origin?.x === x && this.origin.y === y && this.origin.z===z) return;
    const bundled = !!detail || (x === 132 && y === 89) || bundledOrigins.has(`${((x%256)+256)%256}/${y}`);
    this.origin = null;
    this.revision++;
    if (!this.network && !bundled) {
      this.status = "NASA global imagery · offline";
      return;
    }
    this.busy = true;
    const canvas = new OffscreenCanvas(768, 768),
      ctx = canvas.getContext("2d")!;
    try {
      await Promise.all(
        Array.from({ length: 9 }, async (_, i) => {
          const tx = (((x + (i % 3)) % n) + n) % n,
            ty = y + Math.floor(i / 3),
            url = overview ? `imagery/absheron/10/${tx}/${ty}.jpeg` : detail ? `imagery/summits/${detail.id}/${z}/${tx}/${ty}.jpeg` : bundled
              ? `imagery/8/${tx}/${ty}.jpeg`
              : `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/8/${ty}/${tx}.jpeg`;
          const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
          if (!r.ok) throw Error("Imagery unavailable");
          const image = await createImageBitmap(await r.blob());
          ctx.drawImage(
            image,
            (i % 3) * 256,
            Math.floor(i / 3) * 256,
            256,
            256,
          );
          image.close();
        }),
      );
      const old = this.texture;
      this.texture = new T.CanvasTexture(canvas);
      this.texture.colorSpace = T.SRGBColorSpace;
      this.texture.anisotropy = 8;
      this.origin = { x, y, z };
      this.revision++;
      this.status = detail ? "Landsat WELD · 2000 annual composite" : "NASA GIBS · regional imagery";
      old?.dispose();
    } catch {
      this.status = "NASA global imagery · detail unavailable";
    } finally {
      this.busy = false;
    }
  }
}
