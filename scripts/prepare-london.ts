/**
 * Central London buildings from OpenStreetMap (ODbL), Westminster to Canary Wharf.
 * Fetches Overpass tiles into work/london/ (kept out of the shipped bundle), then writes a compact binary:
 * public/scenery/london.bin and london-manifest.json. Run: bun scripts/prepare-london.ts [--refetch]
 */
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
const BOX={south:51.485,west:-.155,north:51.525,east:-.005},TILES=4,refetch=process.argv.includes('--refetch');
const endpoints=['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter'];
type Geom={lat:number;lon:number}[];
interface Raw{type:string;id:number;tags?:Record<string,string>;geometry?:Geom;members?:{type:string;role:string;geometry?:Geom}[]}
const elements:Raw[]=[];let timestamp='';const hash=createHash('sha256');
for(let i=0;i<TILES;i++){
 const west=BOX.west+(BOX.east-BOX.west)*i/TILES,east=BOX.west+(BOX.east-BOX.west)*(i+1)/TILES,box=`${BOX.south},${west.toFixed(5)},${BOX.north},${east.toFixed(5)}`,file=`work/london/tile-${i}.json`;
 if(refetch||!existsSync(file)){
  const query=`[out:json][timeout:170];(way["building"](${box});way["building:part"](${box});relation["building"]["type"="multipolygon"](${box});relation["building:part"]["type"="multipolygon"](${box}););out tags geom;`;
  let text='';for(let attempt=0;attempt<6&&!text;attempt++){const r=await fetch(endpoints[attempt%endpoints.length],{method:'POST',headers:{'User-Agent':'earth-fly-prepare/0.19','Content-Type':'application/x-www-form-urlencoded'},body:'data='+encodeURIComponent(query),signal:AbortSignal.timeout(150000)}).catch(()=>null);
   if(r?.ok){const body=await r.text().catch(()=>'');if(body.startsWith('{'))text=body;}if(!text){console.log(`tile ${i}: retry ${attempt+1}`);await Bun.sleep(8000*(attempt+1));}}
  if(!text)throw Error(`Overpass tile ${i} failed`);await Bun.write(file,text);console.log(`tile ${i}: ${(text.length/1e6).toFixed(1)} MB`);await Bun.sleep(3000);
 }
 const bytes=await Bun.file(file).bytes();hash.update(bytes);const data=JSON.parse(new TextDecoder().decode(bytes));timestamp=data.osm3s.timestamp_osm_base;elements.push(...data.elements);
}
// --- normalise to simple rings
const metres=(tag?:string)=>{if(!tag)return NaN;const m=/^\s*(-?[\d.]+)\s*(m|ft|')?/.exec(tag);if(!m)return NaN;return Number(m[1])*(m[2]&&m[2]!=='m'?.3048:1);};
const ROOFS:Record<string,number>={pyramidal:1,dome:2,onion:2,cone:1,round:0,gabled:3,hipped:3,'half-hipped':3,mansard:3,skillion:4};
interface Building{direction:number;id:string;ring:[number,number][];height:number;base:number;roof:number;roofHeight:number;part:boolean;kind:number;area:number}
const seen=new Set<string>(),out:Building[]=[];
const area=(r:[number,number][])=>{let a=0;for(let i=0,j=r.length-1;i<r.length;j=i++)a+=(r[j][0]-r[i][0])*(r[j][1]+r[i][1]);return a/2*111195*111195*Math.cos(51.5*Math.PI/180);};
const hashId=(s:string)=>{let h=2166136261;for(const c of s)h=Math.imul(h^c.charCodeAt(0),16777619);return(h>>>0)/4294967296;};
const add=(id:string,geometry:Geom|undefined,tags:Record<string,string>)=>{
 if(!geometry||geometry.length<4||seen.has(id))return;const ring=geometry.map(p=>[p.lon,p.lat] as [number,number]);const a=ring[0],b=ring.at(-1)!;if(a[0]!==b[0]||a[1]!==b[1])return;ring.pop();
 const cx=ring.reduce((n,p)=>n+p[0],0)/ring.length,cy=ring.reduce((n,p)=>n+p[1],0)/ring.length;if(cy<BOX.south||cy>BOX.north||cx<BOX.west||cx>BOX.east)return;
 let size=area(ring);if(size<0){ring.reverse();size=-size;}if(size<25||ring.length>250)return;seen.add(id);
 const part=!!tags['building:part']&&tags['building:part']!=='no',levels=Number(tags['building:levels']),tagged=metres(tags.height??tags['building:height']);
 const type=tags.building??tags['building:part']??'yes',rnd=hashId(id);
 // Untagged heights: storeys when mapped, otherwise a plausible inner-London block.
 let height=Number.isFinite(tagged)?tagged:Number.isFinite(levels)&&levels>0?levels*3.3+1.5:/^(garage|garages|shed|roof|hut|kiosk|carport|service)$/.test(type)?3.5:/^(house|terrace|semidetached_house|detached|residential)$/.test(type)?9+rnd*4:/^(church|cathedral|chapel)$/.test(type)?18+rnd*8:12+rnd*9+(size>2500?6:0);
 let base=metres(tags.min_height);if(!Number.isFinite(base)){const minLevel=Number(tags['building:min_level']);base=Number.isFinite(minLevel)&&minLevel>0?minLevel*3.3:0;}
 height=Math.min(330,Math.max(2.5,height));base=Math.max(0,Math.min(base,height-1));
 const direction=Number(tags['roof:direction']);let roof=ROOFS[tags['roof:shape']??'']??0;if(roof===4&&!Number.isFinite(direction))roof=0;let roofHeight=metres(tags['roof:height']);if(!Number.isFinite(roofHeight))roofHeight=roof===1||roof===2?Math.min(height-base,Math.sqrt(size)*.6):roof===4?Math.min(height-base,Math.sqrt(size)*.25):roof===3?Math.min(4,(height-base)*.3):0;roofHeight=Math.max(0,Math.min(roofHeight,height-base));
 const material=(tags['building:material']??'')+' '+(tags['building:colour']??'')+' '+(tags['building:facade:material']??'');
 // 0 stone, 1 stock brick, 2 red brick, 3 glass, 4 concrete, 5 civic/pale
 const kind=/glass/.test(material)||height>70?3:/brick/.test(material)?(/red/.test(material)?2:1):/concrete/.test(material)?4:/stone|limestone|portland/.test(material)||/^(church|cathedral|government|civic|palace|museum|university|public)$/.test(type)?5:height>38?(rnd<.6?3:4):rnd<.34?1:rnd<.52?2:rnd<.8?0:4;
 out.push({direction:roof===4?((direction%360)+360)%360:0,id,ring,height,base,roof,roofHeight,part,kind,area:size});
};
for(const e of elements){const tags=e.tags??{};
 if(e.type==='way')add('w'+e.id,e.geometry,tags);
 else if(e.type==='relation')(e.members??[]).filter(m=>m.type==='way'&&m.role!=='inner').forEach((m,i)=>add(`r${e.id}/${i}`,m.geometry,tags));}
// --- Simple 3D Buildings: an outline that is modelled by parts must not also be extruded.
const cell=(x:number,y:number)=>`${Math.floor(x*400)}/${Math.floor(y*400)}`,grid=new Map<string,Building[]>();
const centre=(b:Building)=>[b.ring.reduce((n,p)=>n+p[0],0)/b.ring.length,b.ring.reduce((n,p)=>n+p[1],0)/b.ring.length];
for(const b of out)if(b.part){const [x,y]=centre(b),k=cell(x,y);grid.set(k,[...(grid.get(k)??[]),b]);}
const inside=(x:number,y:number,r:[number,number][])=>{let hit=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if(a[1]>y!==b[1]>y&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;};
let replaced=0;const kept=out.filter(b=>{if(b.part)return true;
 const xs=b.ring.map(p=>p[0]),ys=b.ring.map(p=>p[1]);let covered=0;
 for(let gx=Math.floor(Math.min(...xs)*400);gx<=Math.floor(Math.max(...xs)*400);gx++)for(let gy=Math.floor(Math.min(...ys)*400);gy<=Math.floor(Math.max(...ys)*400);gy++)for(const p of grid.get(`${gx}/${gy}`)??[]){const [x,y]=centre(p);if(inside(x,y,b.ring))covered+=p.area;}
 if(covered>b.area*.45){replaced++;return false;}return true;});
// --- binary: header, then per building a 12-byte record and u16 ring vertices quantised to the bounding box
const bytes=kept.reduce((n,b)=>n+12+b.ring.length*4,0),buffer=new ArrayBuffer(32+bytes),view=new DataView(buffer);let o=0;
view.setUint32(0,0x4c444e31,true);view.setUint32(4,kept.length,true);view.setFloat32(8,BOX.west,true);view.setFloat32(12,BOX.south,true);view.setFloat32(16,BOX.east,true);view.setFloat32(20,BOX.north,true);o=32;
const qx=(x:number)=>Math.round((x-BOX.west)/(BOX.east-BOX.west)*65535),qy=(y:number)=>Math.round((y-BOX.south)/(BOX.north-BOX.south)*65535),clampQ=(n:number)=>Math.max(0,Math.min(65535,n));
for(const b of kept){view.setUint16(o,b.ring.length,true);view.setUint16(o+2,Math.round(b.height*10),true);view.setUint16(o+4,Math.round(b.base*10),true);view.setUint16(o+6,Math.round(b.roofHeight*10),true);view.setUint8(o+8,b.roof);view.setUint8(o+9,b.kind);view.setUint8(o+10,Math.round(b.direction/360*255));view.setUint8(o+11,Math.floor(hashId(b.id)*256));o+=12;
 for(const [x,y] of b.ring){view.setUint16(o,clampQ(qx(x)),true);view.setUint16(o+2,clampQ(qy(y)),true);o+=4;}}
await Bun.write('public/scenery/london.bin',buffer);
const tall=[...kept].sort((a,b)=>b.height-a.height).slice(0,8).map(b=>`${b.id} ${b.height.toFixed(0)} m`);
const manifest={source:'https://www.openstreetmap.org/copyright',license:'OpenStreetMap contributors, ODbL 1.0',osmTimestamp:timestamp,bounds:BOX,sourceHash:hash.digest('hex'),derivedHash:createHash('sha256').update(new Uint8Array(buffer)).digest('hex'),buildings:kept.length,parts:kept.filter(b=>b.part).length,outlinesReplacedByParts:replaced,taggedHeightShare:Number((elements.filter(e=>e.tags?.height||e.tags?.['building:levels']).length/Math.max(1,elements.length)).toFixed(3)),bytes:buffer.byteLength,tallest:tall};
await Bun.write('public/scenery/london-manifest.json',JSON.stringify(manifest,null,1));console.log(manifest);
