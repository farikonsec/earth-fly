import {mapProjection} from './map-projection';
import type {SatelliteImagery} from './satellite';
import {WORLD_DESTINATIONS} from './world-destinations';
import * as T from 'three';
import type {Feature} from './geodata';
import type {Imagery} from './imagery';
export const wrapLongitude=(v:number)=>((v+180)%360+360)%360-180;
/** True heading, with a deterministic longitude meridian at the geographic poles. */
export function trueHeading(rotation:T.Quaternion,up:T.Vector3){
 const lon=Math.atan2(-up.z,up.x),east=new T.Vector3(-Math.sin(lon),0,-Math.cos(lon)),north=up.clone().cross(east).normalize(),fwd=new T.Vector3(0,0,-1).applyQuaternion(rotation);
 return (Math.atan2(fwd.dot(east),fwd.dot(north))*180/Math.PI+360)%360;
}
/** Bounded local equirectangular moving map. Source imagery remains explicitly labelled. */
const boxes=new WeakMap<Feature,[number,number,number,number]>();
/** [west, south, east, north] of a feature's outer ring, cached: features never move. */
function bounds(f:Feature){let b=boxes.get(f);if(!b){b=[Infinity,Infinity,-Infinity,-Infinity];for(const [lon,lat] of f.ring){if(lon<b[0])b[0]=lon;if(lat<b[1])b[1]=lat;if(lon>b[2])b[2]=lon;if(lat>b[3])b[3]=lat;}boxes.set(f,b);}return b;}
export class FlightMap {
 element=document.createElement('section');canvas=document.createElement('canvas');
 private c=this.canvas.getContext('2d')!; private image=new Image();
 private label=document.createElement('div');private trackButton:HTMLButtonElement;
 route:{lat:number;lon:number}[]=[];
 satellite:SatelliteImagery|null=null;wideImagery:SatelliteImagery|null=null;
 span=3;following=true;center={lat:0,lon:0};trail:{lat:number;lon:number;t:number}[]=[];
 private mapPixels:ImageData|null=null;private polarCanvas=document.createElement("canvas");
 private last=-Infinity; private lastTime=-1; private dragging:{x:number;y:number;lat:number;lon:number}|null=null;
 constructor(private plan:(lat:number,lon:number)=>void){
  this.element.id='flight-map';this.element.setAttribute('aria-label','Flight navigation map');this.image.src=matchMedia('(pointer: coarse)').matches?'textures/earth-2k.jpg':'textures/earth.jpg';this.image.onload=()=>{const canvas=document.createElement('canvas');canvas.width=1440;canvas.height=720;const c=canvas.getContext('2d')!;c.drawImage(this.image,0,0,1440,720);this.mapPixels=c.getImageData(0,0,1440,720);};
  this.canvas.setAttribute('aria-label','Drag to pan, wheel to zoom, double click to plan a flight');this.canvas.tabIndex=0;
  const controls=document.createElement('div');controls.className='map-controls';
  const button=(text:string,title:string,action:()=>void)=>{const b=document.createElement('button');b.textContent=text;b.title=title;b.setAttribute('aria-label',title);b.onclick=action;controls.append(b);return b;};
  button('−','Zoom out',()=>this.zoom(2));button('+','Zoom in',()=>this.zoom(.5));
  this.trackButton=button('Follow','Follow aircraft',()=>{this.following=true;});
  button('↗','Expand or shrink map',()=>this.element.classList.toggle('expanded'));
  this.label.className='flight-map-label';this.element.append(this.canvas,controls,this.label);document.body.append(this.element);
  this.canvas.onwheel=e=>{e.preventDefault();this.zoom(Math.exp(Math.sign(e.deltaY)*.35));};
  this.canvas.onpointerdown=e=>{this.following=false;this.dragging={x:e.clientX,y:e.clientY,...this.center};this.canvas.setPointerCapture(e.pointerId);};
  this.canvas.onpointermove=e=>{const d=this.dragging;if(!d)return;const r=this.canvas.getBoundingClientRect(),projection=mapProjection(d,this.span,r.width,r.height);this.center=projection.invert(r.width/2-(e.clientX-d.x),r.height/2-(e.clientY-d.y));};
  this.canvas.onpointerup=()=>this.dragging=null;this.canvas.onpointercancel=()=>this.dragging=null;
  this.canvas.ondblclick=e=>{const r=this.canvas.getBoundingClientRect(),p=mapProjection(this.center,this.span,r.width,r.height).invert(e.clientX-r.left,e.clientY-r.top);this.plan(p.lat,p.lon);};
  this.canvas.onkeyup=e=>{if(['+','=','-','f','F'].includes(e.key))e.stopPropagation();};
  this.canvas.onkeydown=e=>{if(['+','=','-','f','F'].includes(e.key)){e.preventDefault();e.stopPropagation();if(e.key.toLowerCase()==='f')this.following=true;else this.zoom(e.key==='-'?2:.5);}};
 }
 zoom(factor:number){this.span=T.MathUtils.clamp(this.span*factor,.015,360);}
 reset(){this.route=[];this.trail=[];this.lastTime=-1;this.following=true;}
 update(lat:number,lon:number,heading:number,time:number,features:Feature[],imagery:Imagery){
  if(time<this.lastTime)this.reset();this.lastTime=time;
  if(!this.trail.length||time-this.trail[this.trail.length-1].t>1){this.trail.push({lat,lon,t:time});if(this.trail.length>1800)this.trail.shift();}
  if(performance.now()-this.last<100)return;this.last=performance.now();if(this.following)this.center={lat,lon};
  const r=this.canvas.getBoundingClientRect(),w=Math.round(r.width),h=Math.round(r.height);if(!w||!h)return;
  const dpr=Math.min(devicePixelRatio,2);if(this.canvas.width!==w*dpr||this.canvas.height!==h*dpr){this.canvas.width=w*dpr;this.canvas.height=h*dpr;}
  const c=this.c;c.setTransform(dpr,0,0,dpr,0,0);c.fillStyle='#102836';c.fillRect(0,0,w,h);
  const projection=mapProjection(this.center,this.span,w,h),{project,sy}=projection;
  if(!projection.polar&&this.image.complete&&this.image.naturalWidth){const iw=360/this.span*w,ih=180/sy*h;for(const shift of [-360,0,360]){const x=w*(.5+(-180-this.center.lon+shift)/this.span),y=h*(.5-(90-this.center.lat)/sy);c.drawImage(this.image,x,y,iw,ih);}}
  if(projection.polar&&this.mapPixels){const cw=Math.min(w,360),ch=Math.round(cw*h/w);if(this.polarCanvas.width!==cw||this.polarCanvas.height!==ch){this.polarCanvas.width=cw;this.polarCanvas.height=ch;}const pc=this.polarCanvas.getContext('2d')!,pixels=pc.createImageData(cw,ch),source=this.mapPixels;for(let y=0;y<ch;y++)for(let x=0;x<cw;x++){const geo=projection.invert(x/cw*w,y/ch*h),ix=((Math.floor((geo.lon+180)/360*1440)%1440)+1440)%1440,iy=Math.max(0,Math.min(719,Math.floor((90-geo.lat)/180*720))),i=(y*cw+x)*4,j=(iy*1440+ix)*4;pixels.data.set(source.data.subarray(j,j+4),i);}pc.putImageData(pixels,0,0);c.drawImage(this.polarCanvas,0,0,w,h);}
  const atlas=(im:OffscreenCanvas,o:{x:number;y:number;z:number})=>{if(projection.polar)return;const n=2**o.z,toLat=(y:number)=>Math.atan(Math.sinh(Math.PI*(1-2*y/n)))*180/Math.PI,west=o.x/n*360-180,east=(o.x+3)/n*360-180;
   // Latitude strips remove the Mercator/equirectangular mismatch when zoomed out.
   for(let i=0;i<24;i++){const north=toLat(o.y+i/8),south=toLat(o.y+(i+1)/8),a=project(north,west),b=project(south,east);const width=1080/n/this.span*w;for(const offset of [-360/this.span*w,0,360/this.span*w])c.drawImage(im,0,i*32,768,32,a[0]+offset,a[1],width,b[1]-a[1]);}};
  if(imagery.overview)atlas(imagery.overview.image,imagery.overviewOrigin);
  if(imagery.origin&&imagery.texture)atlas(imagery.texture.image,imagery.origin);
  if(this.wideImagery?.texture&&this.wideImagery.origin)atlas(this.wideImagery.texture.image,this.wideImagery.origin);
  if(this.satellite?.texture&&this.satellite.origin)atlas(this.satellite.texture.image,this.satellite.origin);
  // Geographic graticule and landmark labels keep the expanded map legible.
  c.strokeStyle='#b0e6e320';c.lineWidth=.5;const spacing=this.span>120?30:this.span>25?10:this.span>5?2:this.span>1?.5:.1;
  for(let a=-90;a<=90;a+=spacing){const y=project(a,this.center.lon)[1];if(y<0||y>h)continue;c.beginPath();c.moveTo(0,y);c.lineTo(w,y);c.stroke();}
  for(let b=-180;b<180;b+=spacing){const x=project(this.center.lat,b)[0];if(x<0||x>w)continue;c.beginPath();c.moveTo(x,0);c.lineTo(x,h);c.stroke();}
  if(this.element.classList.contains('expanded')){c.font='10px monospace';for(const d of WORLD_DESTINATIONS){const p=project(d.lat,d.lon);if(p[0]<8||p[0]>w-80||p[1]<30||p[1]>h-35)continue;c.fillStyle='#ffe1a5';c.fillRect(p[0]-2,p[1]-2,4,4);c.fillText(d.name,p[0]+6,p[1]+3);}}
  // Only water whose bounding box meets the visible window is traced; the full London and Caspian sets are thousands of rings.
  const half=this.span/2,view=projection.polar?null:{w:this.center.lon-half,e:this.center.lon+half,s:this.center.lat-sy/2,n:this.center.lat+sy/2};
  for(const f of features){if(f.kind!=='water')continue;if(view){const b=bounds(f);if(b[2]<view.w||b[0]>view.e||b[3]<view.s||b[1]>view.n)continue;}c.beginPath();for(const ring of [f.ring,...f.holes??[]]){ring.forEach(([b,a],i)=>{const p=project(a,b);i?c.lineTo(...p as [number,number]):c.moveTo(...p as [number,number]);});c.closePath();}c.fillStyle='rgba(13,83,113,.65)';c.fill('evenodd');c.strokeStyle='#64b3c7';c.lineWidth=1;c.stroke();}
  if(this.route.length){c.strokeStyle='#ffd48a';c.lineWidth=1;c.beginPath();let prior:number[]|null=null;for(const p of this.route){const q=project(p.lat,p.lon);if(!prior||Math.abs(q[0]-prior[0])>w/2)c.moveTo(q[0],q[1]);else c.lineTo(q[0],q[1]);prior=q;}c.stroke();const home=project(this.route[0].lat,this.route[0].lon);c.fillStyle='#ffd48a';c.fillRect(home[0]-3,home[1]-3,6,6);}
  c.strokeStyle='#b8ffdc';c.lineWidth=1.8;c.beginPath();let previous:number[]|null=null;for(const p of this.trail){const q=project(p.lat,p.lon);if(!previous||Math.abs(q[0]-previous[0])>w/2)c.moveTo(q[0],q[1]);else c.lineTo(q[0],q[1]);previous=q;}c.stroke();
  const p=project(lat,lon);c.save();c.translate(p[0],p[1]);c.rotate((heading+projection.headingOffset)*Math.PI/180);c.beginPath();c.moveTo(0,-9);c.lineTo(6,7);c.lineTo(0,4);c.lineTo(-6,7);c.closePath();c.fillStyle='#c6ffe0';c.fill();c.strokeStyle='#061e25';c.lineWidth=2;c.stroke();c.restore();
  c.fillStyle='#d9f4ee';c.font='11px monospace';c.fillText(projection.polar?'POLAR GRID':'N ↑',9,17);
  const km=projection.kmPerQuarter;c.strokeStyle='#d9f4ee';c.beginPath();c.moveTo(10,h-18);c.lineTo(10+w/4,h-18);c.stroke();c.fillText(`${km<1?(km*1000).toFixed(0)+' m':km.toFixed(km<10?1:0)+' km'}`,10,h-23);
  this.trackButton.classList.toggle('active',this.following);this.label.textContent=`${lat.toFixed(4)}° ${lon.toFixed(4)}° · ${this.following?'TRACKING':'PANNED'} · ${this.satellite?.origin&&this.span<2?'Satellite':'World map'}`;
 }
}
