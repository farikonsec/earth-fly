import * as T from 'three';
import {mercator} from './terrain';
export type AtlasOrigin={x:number;y:number;z:number};
export function satelliteZoom(alt:number,speed:number,lat:number){
 // A footprint of at least twelve seconds of travel prevents tile churn at super speed.
 const metres=Math.max(600,alt*.9,speed*7),mpp=metres/256;
 return T.MathUtils.clamp(Math.floor(Math.log2(156543*Math.max(.1,Math.cos(lat*Math.PI/180))/mpp)),7,15);
}
/** Live display only: no scraping/bulk download. Bounded RAM cache and graceful bundled fallback. */
export class SatelliteImagery {
 texture:T.CanvasTexture<OffscreenCanvas>|null=null;origin:AtlasOrigin|null=null;previous:T.CanvasTexture<OffscreenCanvas>|null=null;previousOrigin:AtlasOrigin|null=null;
 fade=1;revision=0;busy=false;network=true;status='NASA global base';failures=0;loaded=0;
 fixedZoom:number|null=null;
 /** Extra zoom levels packed into the same footprint: 1 fetches a 6x6 block one level sharper. The shader still sees a 3x3 atlas. */
 boost=0;
 private cache=new Map<string,ImageBitmap>();private request=0;private lastAttempt=0;
 async warm(lat:number,lon:number,alt:number,speed:number,force=false){
  if(this.busy||!this.network||Math.abs(lat)>84.8||(!force&&performance.now()-this.lastAttempt<1200))return;
  const z=this.fixedZoom??satelliteZoom(alt,speed,lat),n=2**z,m=mercator(lat,lon,z),origin={x:Math.floor(m.x)-1,y:Math.max(0,Math.min(n-3,Math.floor(m.y)-1)),z};
  if(this.origin&&this.origin.z===z&&Math.abs(m.x-(this.origin.x+1.5))<.65&&Math.abs(m.y-(this.origin.y+1.5))<.65)return;
  this.lastAttempt=performance.now();this.busy=true;const request=++this.request;
  const k=2**this.boost,side=3*k,zz=z+this.boost,nn=n*k,canvas=new OffscreenCanvas(768*k,768*k),ctx=canvas.getContext('2d')!;
  try{
   let cursor=0;const worker=async()=>{while(cursor<side*side){const i=cursor++,x=((origin.x*k+i%side)%nn+nn)%nn,y=origin.y*k+Math.floor(i/side),key=`${zz}/${y}/${x}`;let im=this.cache.get(key);
    if(!im){const r=await fetch(`https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${key}`,{signal:AbortSignal.timeout(7000)});if(!r.ok)throw Error(`Imagery ${r.status}`);im=await createImageBitmap(await r.blob());this.cache.set(key,im);this.loaded++;}
    ctx.drawImage(im,i%side*256,Math.floor(i/side)*256,256,256);
   }};const jobs=await Promise.allSettled(Array.from({length:3*k},worker));if(jobs.some(x=>x.status==='rejected'))throw Error('Satellite tile unavailable');if(request!==this.request)return;
   this.previous?.dispose();this.previous=this.texture;this.previousOrigin=this.origin;this.texture=new T.CanvasTexture(canvas);this.texture.colorSpace=T.SRGBColorSpace;this.texture.anisotropy=8;this.origin=origin;this.fade=0;this.revision++;this.status='Esri World Imagery · satellite';
  }catch{this.failures++;this.status='Satellite unavailable · retained imagery / NASA base';}
  finally{this.busy=false;while(this.cache.size>54*k*k){const k=this.cache.keys().next().value!;this.cache.get(k)!.close();this.cache.delete(k);}}
 }
 update(dt:number){this.fade=Math.min(1,this.fade+Math.max(0,dt)/.8);}
 get cacheSize(){return this.cache.size;}
}
/** Tile coordinates relative to an atlas origin, from absolute longitude and latitude (good to about a metre). */
export const webTileGeoGLSL=`
vec2 webTileGeo(vec3 origin,vec2 geo){float n=exp2(origin.z);float phi=clamp(geo.y,-85.051,85.051)*.0174532925199;
 vec2 tile=vec2(fract((geo.x+180.)/360.)*n,(1.-log(tan(phi)+1./cos(phi))/3.14159265359)*.5*n);
 return vec2(mod(tile.x-origin.x+n*.5,n)-n*.5,tile.y-origin.y);}
`;
/** Default lookup for materials without a local frame (the globe). */
export const webTileDefaultGLSL=webTileGeoGLSL+`vec2 webTile(vec3 origin,vec2 geo){return webTileGeo(origin,geo);}
`;
/**
 * Terrain lookup near the aircraft. 32-bit absolute coordinates put texels a metre off and make close-range paint and
 * imagery speckle, so within 15 km the tile position is built from the patch anchor's tile (split into whole and
 * fractional parts at zoom 17, computed in double precision on the CPU) plus the fragment's local east/north offset
 * through the Mercator series to second order.
 */
export const webTileLocalGLSL=webTileGeoGLSL+`uniform vec4 groundTile;uniform float groundPhi;varying vec2 vLocalEN;
vec2 webTile(vec3 origin,vec2 geo){
 if(dot(vLocalEN,vLocalEN)>225.)return webTileGeo(origin,geo);
 float n=exp2(origin.z),s=exp2(origin.z-17.),sec=1./cos(groundPhi),dphi=vLocalEN.y/6371.,dlam=vLocalEN.x/6371.*sec;
 vec2 base=vec2(groundTile.x*s-origin.x+groundTile.y*s,groundTile.z*s-origin.y+groundTile.w*s);
 return base+vec2(dlam,-(sec*dphi+.5*sec*tan(groundPhi)*dphi*dphi))*n/6.28318530718;
}
`;
export const satelliteGLSL=`
uniform sampler2D satelliteMap;uniform sampler2D satellitePrevious;
uniform vec3 satelliteOrigin;uniform vec3 satellitePreviousOrigin;uniform float satelliteFade;uniform float satelliteReady;uniform float satellitePreviousReady;
vec4 readSatellite(sampler2D atlas,vec3 origin,vec2 geo){
 vec2 rel=webTile(origin,geo);vec2 uv=vec2(rel.x/3.,1.-rel.y/3.);
 float edge=min(min(uv.x,uv.y),min(1.-uv.x,1.-uv.y));
 return vec4(texture2D(atlas,clamp(uv,0.,1.)).rgb,smoothstep(0.,.09,edge)*(1.-smoothstep(84.5,85.,abs(geo.y))));
}
vec3 blendSatellite(vec3 base,vec2 geo){vec4 prior=readSatellite(satellitePrevious,satellitePreviousOrigin,geo),current=readSatellite(satelliteMap,satelliteOrigin,geo);base=mix(base,prior.rgb,prior.a*satellitePreviousReady);return mix(base,current.rgb,current.a*satelliteReady*satelliteFade);}
`.replace('asinh(tan(phi))','log(tan(phi)+1./cos(phi))');
export function satelliteUniforms(s:SatelliteImagery,prefix="satellite"){const uniforms={satelliteMap:{value:s.texture},satellitePrevious:{value:s.previous??s.texture},satelliteOrigin:{value:new T.Vector3()},satellitePreviousOrigin:{value:new T.Vector3()},satelliteFade:{value:s.fade},satelliteReady:{value:0},satellitePreviousReady:{value:0}};return Object.fromEntries(Object.entries(uniforms).map(([k,v])=>[k.replace("satellite",prefix),v]));}
export function updateSatelliteUniforms(u:Record<string,{value:any}>,s:SatelliteImagery,prefix="satellite"){
 if(prefix!=="satellite"){const normalized=Object.fromEntries(Object.entries(u).filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[k.replace(prefix,"satellite"),v]));return updateSatelliteUniforms(normalized,s);}
 if(!u.satelliteMap)return;u.satelliteMap.value=s.texture;u.satellitePrevious.value=s.previous??s.texture;
 for(const [key,o] of [['satelliteOrigin',s.origin],['satellitePreviousOrigin',s.previousOrigin??s.origin]] as const)if(o)u[key].value.set(o.x,o.y,o.z);
 u.satelliteFade.value=s.fade;u.satelliteReady.value=s.texture?1:0;u.satellitePreviousReady.value=s.previous?1:0;
}
