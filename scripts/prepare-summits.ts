import {mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PNG} from 'pngjs';
import {SUMMITS,summitTiles} from '../src/summits';
const root=new URL('../public/',import.meta.url),manifestPath=new URL('terrain/summits-manifest.json',root),
  existing=await Bun.file(manifestPath).exists()?await Bun.file(manifestPath).json():{files:[]},
  pinned=new Map<string,string>(existing.files.map((f:{path:string;sha256:string})=>[f.path,f.sha256])),
  files:{path:string;sha256:string;bytes:number;url:string}[]=[],jobs:{path:string;url:string;png:boolean}[]=[];
for(const s of SUMMITS){
  for(const z of [9,11])for(const t of summitTiles(s,z)){
    const key=`${z}/${t.x}/${t.y}`;jobs.push({path:`terrain/${key}.png`,url:`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${key}.png`,png:true});
  }
  for(const t of summitTiles(s,8))jobs.push({path:`imagery/8/${t.x}/${t.y}.jpeg`,url:`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/8/${t.y}/${t.x}.jpeg`,png:false});
}
const unique=[...new Map(jobs.map(j=>[j.path,j])).values()];
for(let i=0;i<unique.length;i+=4){
 await Promise.all(unique.slice(i,i+4).map(async job=>{
  const path=new URL(job.path,root);let bytes:Uint8Array;
  if(await Bun.file(path).exists())bytes=new Uint8Array(await Bun.file(path).arrayBuffer());
  else{const r=await fetch(job.url,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(`${job.path}: HTTP ${r.status}`);bytes=new Uint8Array(await r.arrayBuffer());}
  if(job.png){const png=PNG.sync.read(Buffer.from(bytes));if(png.width!==256||png.height!==256)throw Error(`Invalid PNG ${job.path}`);}
  else if(bytes[0]!==255||bytes[1]!==216)throw Error(`Invalid JPEG ${job.path}`);
  const sha256=createHash('sha256').update(bytes).digest('hex');if(pinned.has(job.path)&&pinned.get(job.path)!==sha256)throw Error(`Checksum mismatch ${job.path}`);
  await mkdir(new URL('./',path),{recursive:true});await Bun.write(path,bytes);files.push({path:job.path,sha256,bytes:bytes.length,url:job.url});
 }));
 console.log(`${Math.min(i+4,unique.length)}/${unique.length} summit assets validated`);
}
files.sort((a,b)=>a.path.localeCompare(b.path));
await Bun.write(manifestPath,JSON.stringify({sources:['Mapzen / Tilezen Terrarium','NASA GIBS Blue Marble Next Generation'],note:'Sampling density is not survey accuracy. Reference heights do not modify terrain.',files},null,2)+'\n');
console.log(`${files.length} files, ${files.reduce((n,f)=>n+f.bytes,0)} bytes`);
