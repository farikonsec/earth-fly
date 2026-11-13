import {fromUrl} from 'geotiff';
import {PNG} from 'pngjs';
import {mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DOMBAY} from '../src/destinations';
import {SUMMITS,summitTiles} from '../src/summits';
const peaks=[DOMBAY,SUMMITS.find(s=>s.id==='elbrus')!],tiles=peaks.flatMap(s=>summitTiles(s,11)),root=new URL('../public/terrain/',import.meta.url),manifestPath=new URL('caucasus-manifest.json',root),old=await Bun.file(manifestPath).exists()?await Bun.file(manifestPath).json():{files:[]},
 latitude=(y:number)=>Math.atan(Math.sinh(Math.PI*(1-2*y/2048)))*180/Math.PI,
 west=Math.min(...tiles.map(t=>t.x))/2048*360-180,east=(Math.max(...tiles.map(t=>t.x))+1)/2048*360-180,south=latitude(Math.max(...tiles.map(t=>t.y))+1),north=latitude(Math.min(...tiles.map(t=>t.y)));
const windows:{url:string;origin:number[];resolution:number[];offset:number;x:number;y:number;width:number;height:number;data:Float32Array}[]=[];
for(let lat=Math.floor(south);lat<=Math.floor(north);lat++)for(let lon=Math.floor(west);lon<=Math.floor(east);lon++){
 const name=`Copernicus_DSM_COG_10_N${String(lat).padStart(2,'0')}_00_E${String(lon).padStart(3,'0')}_00_DEM`,url=`https://copernicus-dem-30m.s3.amazonaws.com/${name}/${name}.tif`,image=await(await fromUrl(url)).getImage(),origin=image.getOrigin(),resolution=image.getResolution(),offset=(await image.getGeoKeys()).GTRasterTypeGeoKey===2?0:.5,
 x0=Math.max(0,Math.floor((west-origin[0])/resolution[0])-2),x1=Math.min(image.getWidth(),Math.ceil((east-origin[0])/resolution[0])+2),y0=Math.max(0,Math.floor((north-origin[1])/resolution[1])-2),y1=Math.min(image.getHeight(),Math.ceil((south-origin[1])/resolution[1])+2);
 if(x1<=x0||y1<=y0)continue;
 const data=await image.readRasters({window:[x0,y0,x1,y1],samples:[0],interleave:true});windows.push({url,origin,resolution,offset,x:x0,y:y0,width:x1-x0,height:y1-y0,data:data as Float32Array});console.log(`Read Caucasus GLO-30 window ${lat}/${lon}: ${x1-x0} × ${y1-y0}, pixel offset ${offset}`);
}
function sample(lon:number,lat:number){for(const w of windows){const x=(lon-w.origin[0])/w.resolution[0]-w.x-w.offset,y=(lat-w.origin[1])/w.resolution[1]-w.y-w.offset,i=Math.floor(x),j=Math.floor(y);if(i<0||j<0||i+1>=w.width||j+1>=w.height)continue;const a=w.data[j*w.width+i],b=w.data[j*w.width+i+1],c=w.data[(j+1)*w.width+i],d=w.data[(j+1)*w.width+i+1];if(Math.min(a,b,c,d)<-1000)continue;return (a*(1-(x-i))+b*(x-i))*(1-(y-j))+(c*(1-(x-i))+d*(x-i))*(y-j);}return null;}
const files=[];let replaced=0,missing=0;
for(const t of tiles){const key=`11/${t.x}/${t.y}`,png=PNG.sync.read(Buffer.from(await Bun.file(new URL(`${key}.png`,root)).arrayBuffer()));
 for(let j=0;j<256;j++)for(let i=0;i<256;i++){const lon=(t.x+(i+.5)/256)/2048*360-180,lat=latitude(t.y+(j+.5)/256),h=sample(lon,lat);if(h===null){missing++;continue;}replaced++;const value=Math.round((h+32768)*256),k=(j*256+i)*4;png.data[k]=Math.floor(value/65536);png.data[k+1]=Math.floor(value/256)%256;png.data[k+2]=value%256;png.data[k+3]=255;}
 const bytes=PNG.sync.write(png),sha256=createHash('sha256').update(bytes).digest('hex'),pin=old.files.find((f:{key:string})=>f.key===key);if(pin&&pin.sha256!==sha256)throw Error(`Pinned mismatch ${key}`);
 const target=new URL(`caucasus/${key}.png`,root);await mkdir(new URL('./',target),{recursive:true});await Bun.write(target,bytes);files.push({key,sha256,bytes:bytes.length});
}
const licenseURL='https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/DEM/resources/license/License-COPDEM-30.pdf',license=await fetch(licenseURL);if(!license.ok)throw Error('License unavailable');await Bun.write(new URL('COPDEM-LICENSE.pdf',root),await license.arrayBuffer());
await Bun.write(manifestPath,JSON.stringify({source:'Copernicus DEM GLO-30 Public',datum:'EGM2008 orthometric',nativeSampling:'1 arc second / nominal 30 m DSM',attribution:'Produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.',licenseURL,sourceAssets:windows.map(w=>w.url),changes:'Bilinearly resampled to zoom-11 Terrarium; missing samples retain original Mapzen; runtime parent-edge feather applies. No summit heights are artificially pinned.',replaced,missing,summits:peaks.map(s=>({id:s.id,reference:s.elevation,sourceAtReference:sample(s.lon,s.lat)})),files},null,2)+'\n');
console.log(JSON.stringify(peaks.map(s=>({id:s.id,reference:s.elevation,sourceAtReference:sample(s.lon,s.lat)}))));
