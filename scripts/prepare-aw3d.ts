import {fromUrl} from 'geotiff';
import {PNG} from 'pngjs';
import {mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DOMBAY} from '../src/destinations';
import {SUMMITS,summitTiles} from '../src/summits';
const root=new URL('../public/terrain/',import.meta.url),base='https://s3.ap-northeast-1.wasabisys.com/je-pds/cog/v1/JAXA.EORC_ALOS.PRISM_AW3D30.v3.2_global/2021-02/3/',
 manifestPath=new URL('aw3d-manifest.json',root),old=await Bun.file(manifestPath).exists()?await Bun.file(manifestPath).json():{files:[]},files=[],regions=[];
const latitude=(y:number,z:number)=>Math.atan(Math.sinh(Math.PI*(1-2*y/2**z)))*180/Math.PI;
for(const peak of [DOMBAY,SUMMITS.find(s=>s.id==='elbrus')!]){
 const tiles=[11,12].flatMap(z=>summitTiles(peak,z)),bounds=summitTiles(peak,11),west=Math.min(...bounds.map(t=>t.x))/2048*360-180,east=(Math.max(...bounds.map(t=>t.x))+1)/2048*360-180,south=latitude(Math.max(...bounds.map(t=>t.y))+1,11),north=latitude(Math.min(...bounds.map(t=>t.y)),11),windows=[];
 for(let lat=Math.floor(south);lat<=Math.floor(north);lat++)for(let lon=Math.floor(west);lon<=Math.floor(east);lon++){
  const e=`E${String(lon).padStart(3,'0')}.00`,e1=`E${String(lon+1).padStart(3,'0')}.00`,n=`N${String(lat).padStart(2,'0')}.00`,n1=`N${String(lat+1).padStart(2,'0')}.00`,itemURL=`${base}${e}-${e1}/${n}-${n1}.json`,item=await(await fetch(itemURL)).json(),url=new URL(item.assets.DSM.href,itemURL).href,maskURL=new URL(item.assets.MSK.href,itemURL).href,
   image=await(await fromUrl(url)).getImage(),mask=await(await fromUrl(maskURL)).getImage(),origin=image.getOrigin(),resolution=image.getResolution(),offset=(await image.getGeoKeys()).GTRasterTypeGeoKey===2?0:.5,
   x0=Math.max(0,Math.floor((west-origin[0])/resolution[0])-2),x1=Math.min(image.getWidth(),Math.ceil((east-origin[0])/resolution[0])+2),y0=Math.max(0,Math.floor((north-origin[1])/resolution[1])-2),y1=Math.min(image.getHeight(),Math.ceil((south-origin[1])/resolution[1])+2);
  if(x1<=x0||y1<=y0)continue;
  const window=[x0,y0,x1,y1],data=await image.readRasters({window,samples:[0],interleave:true}),quality=await mask.readRasters({window,samples:[0],interleave:true});
  windows.push({url,maskURL,itemURL,origin,resolution,offset,x:x0,y:y0,width:x1-x0,height:y1-y0,data,quality});
  console.log(`${peak.id}: ${x1-x0} × ${y1-y0} optical source, offset ${offset}`);
 }
 function sample(lon:number,lat:number){for(const w of windows){const x=(lon-w.origin[0])/w.resolution[0]-w.x-w.offset,y=(lat-w.origin[1])/w.resolution[1]-w.y-w.offset,i=Math.floor(x),j=Math.floor(y);if(i<0||j<0||i+1>=w.width||j+1>=w.height)continue;const indices=[j*w.width+i,j*w.width+i+1,(j+1)*w.width+i,(j+1)*w.width+i+1],v=indices.map(k=>Number(w.data[k]));if(v.some(h=>!Number.isFinite(h)||h===-9999)||indices.some(k=>w.quality[k]===1))return null;return (v[0]*(1-(x-i))+v[1]*(x-i))*(1-(y-j))+(v[2]*(1-(x-i))+v[3]*(x-i))*(y-j);}return null;}
 let crest={lat:peak.lat,lon:peak.lon,elevation:-Infinity,mask:0},valid=0,filled=0;
 for(const w of windows)for(let j=0;j<w.height;j++)for(let i=0;i<w.width;i++){
  const lat=w.origin[1]+(w.y+j+w.offset)*w.resolution[1],lon=w.origin[0]+(w.x+i+w.offset)*w.resolution[0],distance=Math.hypot((lat-peak.lat)*111195,(lon-peak.lon)*111195*Math.cos(peak.lat*Math.PI/180)),h=Number(w.data[j*w.width+i]),mask=Number(w.quality[j*w.width+i]);
  if(distance>1000||h===-9999||mask===1)continue;valid++;if(mask!==0)filled++;if(h>crest.elevation)crest={lat,lon,elevation:h,mask};
 }
 if(!Number.isFinite(crest.elevation))throw Error(`No valid crest ${peak.id}`);
 for(const t of tiles){
  // The zoom-11 set feathers back to original Mapzen across 1 km; zoom-12 has a same-source parent.
  const parent=PNG.sync.read(Buffer.from(await Bun.file(new URL(`${t.z===11?'': 'caucasus/'}${t.z===11?`${t.z}/${t.x}/${t.y}`:`11/${Math.floor(t.x/2)}/${Math.floor(t.y/2)}`}.png`,root)).arrayBuffer())),png=new PNG({width:256,height:256});let missing=0;
  for(let j=0;j<256;j++)for(let i=0;i<256;i++){
   const lon=(t.x+(i+.5)/256)/2**t.z*360-180,lat=latitude(t.y+(j+.5)/256,t.z),value=sample(lon,lat),distance=Math.min((lon-west)*Math.cos(lat*Math.PI/180),(east-lon)*Math.cos(lat*Math.PI/180),lat-south,north-lat)*111195,
    weight=t.z===11?Math.min(1,Math.max(0,distance/1000)):1,
    px=t.z===11?i:Math.min(255,Math.floor(((t.x%2)+(i+.5)/256)*128)),py=t.z===11?j:Math.min(255,Math.floor(((t.y%2)+(j+.5)/256)*128)),pk=(py*256+px)*4,prior=parent.data[pk]*256+parent.data[pk+1]+parent.data[pk+2]/256-32768,
    h=value===null?prior:prior+(value-prior)*weight,encoded=Math.round((h+32768)*256),k=(j*256+i)*4;
   if(value===null)missing++;png.data[k]=Math.floor(encoded/65536);png.data[k+1]=Math.floor(encoded/256)%256;png.data[k+2]=encoded%256;png.data[k+3]=255;
  }
  const bytes=PNG.sync.write(png),key=`${t.z}/${t.x}/${t.y}`,sha256=createHash('sha256').update(bytes).digest('hex'),pin=old.files.find((f:{key:string})=>f.key===key);if(pin&&pin.sha256!==sha256)throw Error(`Pinned mismatch ${key}`);
  const target=new URL(`aw3d/${key}.png`,root);await mkdir(new URL('./',target),{recursive:true});await Bun.write(target,bytes);files.push({key,sha256,bytes:bytes.length,missing});
 }
 regions.push({id:peak.id,reference:{lat:peak.lat,lon:peak.lon,elevation:peak.elevation},sourceAtReference:sample(peak.lon,peak.lat),sourceCrestWithin1000m:crest,crestOffsetMetres:Math.hypot((crest.lat-peak.lat)*111195,(crest.lon-peak.lon)*111195*Math.cos(peak.lat*Math.PI/180)),validSamples:valid,nonzeroMaskSamples:filled,sourceAssets:windows.map(w=>({url:w.url,maskURL:w.maskURL,itemURL:w.itemURL,origin:w.origin,resolution:w.resolution,pixelOffset:w.offset})),bounds:{west,east,south,north}});
}
await Bun.write(manifestPath,JSON.stringify({source:'JAXA ALOS World 3D-30m, JAXA Earth v3.2 global collection (2021-02 catalog)',datum:'EGM96 orthometric',sourcePixelMetres:'nominal 30 m; integer metre pixel averages',credit:'Original data supplied by JAXA AW3D30. Optical PRISM DSM with supplementary fill sources described by the source MSK.',terms:'https://earth.jaxa.jp/en/data/policy/',product:'https://www.eorc.jaxa.jp/ALOS/en/aw3d30/aw3d30v3.2_product_e_e1.2.pdf',changes:'Bilinear resampling to zoom 11/12 Terrarium. Zoom-11 outer 1 km feathers to original Mapzen. Void/invalid snow pixels retain parent terrain. No surveyed height correction or coordinate relocation.',regions,files},null,2)+'\n');
console.log(JSON.stringify(regions.map(r=>({id:r.id,sourceAtReference:r.sourceAtReference,crest:r.sourceCrestWithin1000m,offset:r.crestOffsetMetres}))));
