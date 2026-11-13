import {mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PNG} from 'pngjs';
import {DOMBAY,CASPIAN} from '../src/destinations';
import {summitTiles} from '../src/summits';
const root=new URL('../public/',import.meta.url),manifestPath=new URL('terrain/regions-manifest.json',root),old=await Bun.file(manifestPath).exists()?await Bun.file(manifestPath).json():{files:[]},files=[];
const jobs:{path:string;url:string}[]=[];
for(const s of [DOMBAY,CASPIAN]){
 for(const z of [9,11])for(const t of summitTiles(s,z))jobs.push({path:`terrain/${z}/${t.x}/${t.y}.png`,url:`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${t.x}/${t.y}.png`});
 for(const t of summitTiles(s,8))jobs.push({path:`imagery/8/${t.x}/${t.y}.jpeg`,url:`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/8/${t.y}/${t.x}.jpeg`});
 for(const t of summitTiles(s,12))jobs.push({path:`imagery/summits/${s.id}/12/${t.x}/${t.y}.jpeg`,url:`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/Landsat_WELD_CorrectedReflectance_TrueColor_Global_Annual/default/2000-12-01/GoogleMapsCompatible_Level12/12/${t.y}/${t.x}.jpeg`});
}
for(let i=0;i<jobs.length;i+=4){await Promise.all(jobs.slice(i,i+4).map(async job=>{
 const target=new URL(job.path,root);let bytes:Uint8Array;
 if(await Bun.file(target).exists())bytes=new Uint8Array(await Bun.file(target).arrayBuffer());else{const r=await fetch(job.url,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(`${job.path}: ${r.status}`);bytes=new Uint8Array(await r.arrayBuffer());}
 if(job.path.endsWith('.png')){const p=PNG.sync.read(Buffer.from(bytes));if(p.width!==256||p.height!==256)throw Error('Invalid terrain');}else if(bytes[0]!==255||bytes[1]!==216)throw Error('Invalid image');
 const sha256=createHash('sha256').update(bytes).digest('hex'),pin=old.files.find((f:{path:string})=>f.path===job.path);if(pin&&pin.sha256!==sha256)throw Error(`Pinned mismatch ${job.path}`);
 await mkdir(new URL('./',target),{recursive:true});await Bun.write(target,bytes);files.push({...job,sha256,bytes:bytes.length});
}));}
const url='https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_geography_marine_polys.geojson',source=await(await fetch(url)).json(),sea=source.features.find((f:{properties:{name:string}})=>f.properties.name==='Caspian Sea');
if(!sea||sea.geometry.type!=='Polygon')throw Error('Caspian source unavailable');
const data=JSON.stringify({version:1,source:'Natural Earth 1:10m marine polygons',url,license:'Public domain',waterLevelMetres:CASPIAN.elevation,levelNote:'Fixed historical/educational reference, not a live lake level',features:[{id:'naturalearth/caspian',name:'Caspian Sea',kind:'water',elevation:CASPIAN.elevation,ring:sea.geometry.coordinates[0],holes:sea.geometry.coordinates.slice(1)}]});
const hash=createHash('sha256').update(data).digest('hex'),pin=old.files.find((f:{path:string})=>f.path==='scenery/caspian.json');if(pin&&pin.sha256!==hash)throw Error('Pinned Caspian shoreline mismatch');
await Bun.write(new URL('scenery/caspian.json',root),data);files.push({path:'scenery/caspian.json',url,sha256:hash,bytes:new TextEncoder().encode(data).length});
files.sort((a,b)=>a.path.localeCompare(b.path));await Bun.write(manifestPath,JSON.stringify({destinations:[DOMBAY,CASPIAN],note:'Natural Earth shoreline is generalized; lake datum is fixed. Landsat epoch is 2000.',files},null,2)+'\n');console.log(`${files.length} regional assets, ${files.reduce((n,f)=>n+f.bytes,0)} bytes`);
