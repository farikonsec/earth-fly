import {mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {SUMMITS,summitTiles} from '../src/summits';
const path=new URL('../public/imagery/summits-manifest.json',import.meta.url),old=await Bun.file(path).exists()?await Bun.file(path).json():{files:[]},files=[];
for(const s of SUMMITS.filter(s=>s.id!=='vinson'))for(const t of summitTiles(s,12)){
 const key=`${s.id}/12/${t.x}/${t.y}.jpeg`,target=new URL(`../public/imagery/summits/${key}`,import.meta.url),url=`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/Landsat_WELD_CorrectedReflectance_TrueColor_Global_Annual/default/2000-12-01/GoogleMapsCompatible_Level12/12/${t.y}/${t.x}.jpeg`;
 let bytes:Uint8Array;if(await Bun.file(target).exists())bytes=new Uint8Array(await Bun.file(target).arrayBuffer());else{const r=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(`Imagery HTTP ${r.status}`);bytes=new Uint8Array(await r.arrayBuffer());}
 if(bytes[0]!==255||bytes[1]!==216)throw Error(`Invalid image ${key}`);
 const sha256=createHash('sha256').update(bytes).digest('hex'),pin=old.files.find((f:{key:string})=>f.key===key);if(pin&&pin.sha256!==sha256)throw Error(`Pinned mismatch ${key}`);
 await mkdir(new URL('./',target),{recursive:true});await Bun.write(target,bytes);files.push({key,url,sha256,bytes:bytes.length});
}
await Bun.write(path,JSON.stringify({source:'NASA GIBS / Landsat WELD True Color Global Annual v3.1',date:'2000-12-01',nominalSourceResolutionMetres:30,note:'Historic annual composite. Non-Antarctic coverage. Sampling, cloud/void and glacier changes limit realism.',files},null,2)+'\n');console.log(`${files.length} Landsat tiles, ${files.reduce((n,f)=>n+f.bytes,0)} bytes`);
