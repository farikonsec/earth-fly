import * as T from 'three';
import {GroundTraffic} from './ground-traffic';
import {GroundTrafficView} from './ground-traffic-view';
import {TransportNetwork,type TransportTile,type TransitLine,type RoadEdge} from './transport-network';
import {dirToLatLon,inertialToBody} from './geo';
import {EARTH} from './earth';
import type {Terrain} from './terrain';
import type {WorldDetail} from './world-detail';
import type {Bridges} from './bridges';
import type {V} from './vector';
/** Terrain lattice for vehicle heights: 1e4 cells per degree, about 11 m north–south at London. */
const GRID=1e4;
/** Local-density simulation on the UK's streamed road/rail graph; not a claim to simulate every UK vehicle. */
export class SurfaceTraffic{
 model=new GroundTraffic();view:GroundTrafficView;group=new T.Group();status='Loading London transport';lines:TransitLine[]=[];private fallback:TransportTile[]=[];private revision=-1;private builtTiles='';private overlayFor:T.Vector3|null=null;private pending:{network:TransportNetwork;steps:Generator<void,void,void>;count:number}|null=null;private slice={until:0};private rebuilt=-Infinity;private seedReady=false;private cached=new Map<number,number>();private heightRevision=-1;private statusElement=document.createElement('div');private railOverlay:T.LineSegments|null=null;private overlayAnchor=new T.Vector3();private lastStatus=0;private overlayGroup=new T.Group();
 constructor(private terrain:Terrain,private detail:WorldDetail,private bridges:Bridges){
  this.view=new GroundTrafficView(this.model,(p,e)=>this.height(p,e));this.group.add(this.view.group,this.overlayGroup);this.statusElement.id='surface-traffic-status';this.statusElement.innerHTML='<span>ROAD & RAIL · loading…</span><button type="button" aria-pressed="false">Underground cutaway</button>';document.body.append(this.statusElement);
  this.statusElement.querySelector('button')!.onclick=()=>{this.view.cutaway=!this.view.cutaway;this.statusElement.querySelector('button')!.setAttribute('aria-pressed',String(this.view.cutaway));};
  Promise.allSettled([fetch('traffic/london-network.json').then(r=>{if(!r.ok)throw Error('London network unavailable');return r.json();}),fetch('traffic/london-transit.json').then(r=>{if(!r.ok)throw Error('Transit identities unavailable');return r.json();})]).then(([net,tfl])=>{if(net.status==='fulfilled')this.fallback=net.value.tiles;if(tfl.status==='fulfilled')this.lines=tfl.value.lines;this.seedReady=true;this.revision=-1;this.status=net.status==='fulfilled'?'Map-derived routes':'Streaming mapped routes';});
 }
 private height(p:T.Vector3,e:RoadEdge){
  // Ground height comes from a ~10 m lattice of cached terrain samples, blended bilinearly. A moving vehicle reuses
  // the same four corners for many frames, where the old per-metre string key missed on nearly every frame.
  const loc=dirToLatLon(p.toArray() as V),lx=loc.lon*GRID,ly=loc.lat*GRID,x0=Math.floor(lx),y0=Math.floor(ly),tx=lx-x0,ty=ly-y0;
  const corner=(x:number,y:number)=>{const key=y*4e7+x;let h=this.cached.get(key);if(h===undefined){h=this.terrain.height(y/GRID,x/GRID);if(this.cached.size>40000)this.cached.clear();this.cached.set(key,h);}return h;};
  const base=(corner(x0,y0)*(1-tx)+corner(x0+1,y0)*tx)*(1-ty)+(corner(x0,y0+1)*(1-tx)+corner(x0+1,y0+1)*tx)*ty;
  if(e.bridge){for(const b of this.bridges.list){const rel=p.clone().sub(b.centre.clone().multiplyScalar(EARTH.radius)),x=rel.dot(b.X)*1000,z=rel.dot(b.Z)*1000;if(Math.abs(x)<b.length/2+3&&Math.abs(z)<b.width/2+5)return b.water+b.deckTop(x)+.12;}}
  // CPU mirrors the same correction field that seats buildings on the drawn mesh.
  const corr=this.detail.correction,rel=p.clone().sub(this.detail.anchorPoint),gx=(rel.dot(corr.east)/corr.span+.5)*160,gy=(rel.dot(corr.north)/corr.span+.5)*160;
  let correction=0;if(gx>=0&&gy>=0&&gx<160&&gy<160){const data=corr.texture.image.data as Uint16Array,x=Math.floor(gx),y=Math.floor(gy),fx=gx-x,fy=gy-y,read=(i:number)=>T.DataUtils.fromHalfFloat(data[i]??0);correction=T.MathUtils.lerp(T.MathUtils.lerp(read(y*161+x),read(y*161+x+1),fx),T.MathUtils.lerp(read((y+1)*161+x),read((y+1)*161+x+1),fx),fy);}
  return base+correction+(e.tunnel?-Math.max(9,Math.abs(e.layer)*8):.08);
 }
 private rebuildOverlay(origin:T.Vector3){
  if(this.railOverlay){this.overlayGroup.remove(this.railOverlay);this.railOverlay.geometry.dispose();(this.railOverlay.material as T.Material).dispose();}
  this.overlayAnchor.copy(origin).setLength(EARTH.radius);const positions:number[]=[];
  for(const e of this.model.network.rail){if(!e.tunnel||e.a.p.distanceTo(origin)>6||e.id>e.reverse)continue;for(const n of[e.a,e.b])positions.push(...n.p.clone().normalize().multiplyScalar(EARTH.radius+this.height(n.p,e)/1000).sub(this.overlayAnchor).toArray());}
  const geo=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(positions,3));this.railOverlay=new T.LineSegments(geo,new T.LineBasicMaterial({color:0x59d4e6,transparent:true,opacity:.38,depthTest:false,depthWrite:false}));this.railOverlay.renderOrder=99;this.overlayGroup.add(this.railOverlay);
 }
 private simDt=0;
 update(dt:number,time:number,origin:T.Vector3,altitude:number){
  const body=new T.Vector3(...inertialToBody(origin.toArray() as V,time,EARTH.rotation)),loc=dirToLatLon(body.toArray() as V),uk=loc.lat>49.8&&loc.lat<61&&loc.lon>-8.4&&loc.lon<2.1,enabled=uk&&altitude<10000,now=performance.now();
  if(this.heightRevision!==this.terrain.revision){this.heightRevision=this.terrain.revision;this.cached.clear();}
  if(enabled&&this.seedReady&&(this.revision!==this.detail.revision||this.model.network.edges.size===0)&&now-this.rebuilt>2500){
   const all=new Map<string,TransportTile>();for(const t of [...this.fallback,...this.detail.overlayTiles()])all.set(t.x+','+t.y,t);
   const x=(loc.lon+180)/360*16384,y=(1-Math.asinh(Math.tan(loc.lat*Math.PI/180))/Math.PI)/2*16384;
   const tiles=[...all.values()].filter(t=>Math.abs(t.x-x)<3.2&&Math.abs(t.y-y)<3.2).sort((a,b)=>(a.x-x)**2+(a.y-y)**2-(b.x-x)**2-(b.y-y)**2).slice(0,30);
   this.rebuilt=now;this.revision=this.detail.revision;const key=tiles.map(t=>t.x+','+t.y+':'+t.layers.transportation?.features.length).sort().join(' ');
   // Detail revisions also tick when far tiles unload; rebuild only when the tiles under the traffic changed.
   if(tiles.length&&key!==this.builtTiles){this.builtTiles=key;const network=new TransportNetwork(tiles,this.lines,true);this.pending={network,steps:network.build(this.slice),count:tiles.length};}
  }
  // The next network is built a few milliseconds per frame and swapped in when complete; traffic keeps driving the old one.
  if(this.pending){this.slice.until=now+4;if(this.pending.steps.next().done){const {network,count}=this.pending;this.pending=null;this.model.setNetwork(network,body);this.overlayFor=body.clone();this.status=`${count} mapped tiles`;}}
  // Traffic drives at 30 steps a second; the view still places every vehicle each frame.
  this.simDt+=dt;if(enabled&&this.simDt>=1/31){this.model.advance(this.simDt,body);this.simDt=0;}else if(!enabled)this.simDt=0;this.view.draw(origin,time,enabled);
  // The tunnel overlay is only seen in cutaway view, so it is built when first needed rather than on every network swap.
  if(this.overlayFor&&this.view.cutaway){this.rebuildOverlay(this.overlayFor);this.overlayFor=null;}
  this.overlayGroup.visible=enabled&&this.view.cutaway;this.overlayGroup.quaternion.setFromAxisAngle(new T.Vector3(0,1,0),time/EARTH.rotation*Math.PI*2);this.overlayGroup.position.copy(this.overlayAnchor).applyQuaternion(this.overlayGroup.quaternion).sub(origin);
  if(now-this.lastStatus>500){this.lastStatus=now;const s=this.model.stats;this.statusElement.querySelector('span')!.textContent=enabled?`${s.road} road · ${s.rail} rail · ${s.stopped} stopped${s.wrecks?' · '+s.wrecks+' wrecks':''}`:uk?'Road & rail · below 10 km':'Road & rail · UK coverage';this.statusElement.title=this.status+' · synthetic autonomous traffic; TfL station identities, OSM geometry';}
 }
 get targets(){return this.view.targets;}
 get contacts(){return this.view.contacts;}
 get stats(){return{...this.model.stats,status:this.status,cutaway:this.view.cutaway};}
}
