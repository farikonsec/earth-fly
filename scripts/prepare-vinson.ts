import {mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PNG} from 'pngjs';
import {fromUrl} from 'geotiff';
import proj4 from 'proj4';
import {SUMMITS,summitTiles} from '../src/summits';
import {decodeTerrarium} from '../src/terrain';
const summit=SUMMITS.find(s=>s.id==='vinson')!,root=new URL('../public/terrain/',import.meta.url),manifestPath=new URL('rema-manifest.json',root);
const pinned=await Bun.file(manifestPath).exists()?await Bun.file(manifestPath).json():null;
const geoidURL='https://download.osgeo.org/proj/vdatum/egm96_15/egm96_15.gtx',geoidPath=new URL('../work/egm96_15.gtx',import.meta.url);
if(!await Bun.file(geoidPath).exists()){const r=await fetch(geoidURL);if(!r.ok)throw Error('Geoid unavailable');await Bun.write(geoidPath,await r.arrayBuffer());}
const geoidBytes=await Bun.file(geoidPath).arrayBuffer(),geoidHash=createHash('sha256').update(new Uint8Array(geoidBytes)).digest('hex'),g=new DataView(geoidBytes),lat0=g.getFloat64(0),lon0=g.getFloat64(8),dy=g.getFloat64(16),dx=g.getFloat64(24),rows=g.getInt32(32),cols=g.getInt32(36);
if(rows!==721||cols!==1440||dy!==.25||dx!==.25||geoidBytes.byteLength!==40+rows*cols*4)throw Error('Unexpected GTX grid');
if(pinned&&pinned.geoid.sha256!==geoidHash)throw Error('Pinned geoid mismatch');
function undulation(lat:number,lon:number){const x=(lon-lon0)/dx,y=(lat-lat0)/dy,i=Math.floor(x),j=Math.floor(y),fx=x-i,fy=y-j,at=(a:number,b:number)=>g.getFloat32(40+((Math.max(0,Math.min(rows-1,b)))*cols+((a%cols+cols)%cols))*4);return (at(i,j)*(1-fx)+at(i+1,j)*fx)*(1-fy)+(at(i,j+1)*(1-fx)+at(i+1,j+1)*fx)*fy;}
const latitude=(y:number,z:number)=>Math.atan(Math.sinh(Math.PI*(1-2*y/2**z)))*180/Math.PI,
 tiles=summitTiles(summit,9),minX=Math.min(...tiles.map(t=>t.x)),maxX=Math.max(...tiles.map(t=>t.x))+1,minY=Math.min(...tiles.map(t=>t.y)),maxY=Math.max(...tiles.map(t=>t.y))+1,
 west=minX/512*360-180,east=maxX/512*360-180,north=latitude(minY,9),south=latitude(maxY,9);
proj4.defs('EPSG:3031','+proj=stere +lat_0=-90 +lat_ts=-71 +lon_0=0 +datum=WGS84 +units=m +no_defs');
const project=(lon:number,lat:number)=>proj4('EPSG:4326','EPSG:3031',[lon,lat]);
const boundary:number[][]=[];for(let i=0;i<=32;i++){const f=i/32;boundary.push(project(west+(east-west)*f,south),project(west+(east-west)*f,north),project(west,south+(north-south)*f),project(east,south+(north-south)*f));}
const bounds=[Math.min(...boundary.map(p=>p[0])),Math.min(...boundary.map(p=>p[1])),Math.max(...boundary.map(p=>p[0])),Math.max(...boundary.map(p=>p[1]))];
const catalogURL=`https://stac.pgc.umn.edu/api/v1/collections/rema-mosaics-v2.0-32m/items?bbox=${west},${south},${east},${north}&limit=20`,catalog=await(await fetch(catalogURL)).json();
const windows:{url:string;origin:number[];resolution:number[];x:number;y:number;width:number;height:number;data:Float32Array}[]=[];
for(const feature of catalog.features){
 const url=feature.assets.dem.href,image=await(await fromUrl(url)).getImage(),origin=image.getOrigin(),resolution=image.getResolution(),
 x0=Math.max(0,Math.floor((bounds[0]-origin[0])/resolution[0])-2),x1=Math.min(image.getWidth(),Math.ceil((bounds[2]-origin[0])/resolution[0])+2),
 y0=Math.max(0,Math.floor((bounds[3]-origin[1])/resolution[1])-2),y1=Math.min(image.getHeight(),Math.ceil((bounds[1]-origin[1])/resolution[1])+2);
 if(x1<=x0||y1<=y0)continue;
 const raster=await image.readRasters({window:[x0,y0,x1,y1],samples:[0],interleave:true});
 windows.push({url,origin,resolution,x:x0,y:y0,width:x1-x0,height:y1-y0,data:raster as Float32Array});console.log(`Read REMA window ${feature.id}: ${x1-x0} × ${y1-y0}`);
}
function ellipsoid(lon:number,lat:number){const p=project(lon,lat);for(const w of windows){const x=(p[0]-w.origin[0])/w.resolution[0]-.5-w.x,y=(p[1]-w.origin[1])/w.resolution[1]-.5-w.y,i=Math.floor(x),j=Math.floor(y);if(i<0||j<0||i+1>=w.width||j+1>=w.height)continue;const a=w.data[j*w.width+i],b=w.data[j*w.width+i+1],c=w.data[(j+1)*w.width+i],d=w.data[(j+1)*w.width+i+1];if(Math.min(a,b,c,d)<-9000)continue;return (a*(1-(x-i))+b*(x-i))*(1-(y-j))+(c*(1-(x-i))+d*(x-i))*(y-j);}return null;}
const files=[];let valid=0,missing=0;
for(const z of [9,11])for(const t of summitTiles(summit,z)){
 const key=`${z}/${t.x}/${t.y}`,png=PNG.sync.read(Buffer.from(await Bun.file(new URL(`${key}.png`,root)).arrayBuffer()));
 for(let j=0;j<256;j++)for(let i=0;i<256;i++){
  const lon=(t.x+(i+.5)/256)/2**z*360-180,lat=latitude(t.y+(j+.5)/256,z),h=ellipsoid(lon,lat),k=(j*256+i)*4;
  if(h===null){missing++;continue;}valid++;
  const edge=Math.max(0,Math.min(1,Math.min((lon-west)/(east-west),(east-lon)/(east-west),(lat-south)/(north-south),(north-lat)/(north-south))/.15)),weight=edge*edge*(3-2*edge),old=decodeTerrarium(png.data[k],png.data[k+1],png.data[k+2]),height=old+(h-undulation(lat,lon)-old)*weight,encoded=Math.max(0,Math.round((height+32768)*256));
  png.data[k]=Math.floor(encoded/65536);png.data[k+1]=Math.floor(encoded/256)%256;png.data[k+2]=encoded%256;png.data[k+3]=255;
 }
 const bytes=PNG.sync.write(png),sha256=createHash('sha256').update(bytes).digest('hex'),old=pinned?.files.find((f:{key:string})=>f.key===key);
 if(old&&old.sha256!==sha256)throw Error(`Pinned derived tile mismatch ${key}`);
 const path=new URL(`rema/${key}.png`,root);await mkdir(new URL('./',path),{recursive:true});await Bun.write(path,bytes);files.push({key,bytes:bytes.length,sha256});
}
const h=ellipsoid(summit.lon,summit.lat);if(h===null)throw Error('No REMA at Vinson');
await Bun.write(manifestPath,JSON.stringify({source:'REMA mosaic v2.0 32m, Polar Geospatial Center',license:'CC-BY-4.0',citation:'https://doi.org/10.7910/DVN/EBW8UC',catalogURL,sourceAssets:windows.map(w=>w.url),geoid:{source:geoidURL,sha256:geoidHash,model:'EGM96 15 arc-minute',conversion:'orthometric H = ellipsoidal h − geoid undulation N'},bounds:{west,south,east,north},feather:'Outer 15% blends into original Mapzen terrain; DEM voids retain original data.',valid,missing,summit:{ellipsoidal:h,geoidUndulation:undulation(summit.lat,summit.lon),orthometric:h-undulation(summit.lat,summit.lon)},files},null,2)+'\n');
console.log(`Vinson REMA: ${(h-undulation(summit.lat,summit.lon)).toFixed(1)} m EGM96; ${valid} samples, ${missing} voids`);
