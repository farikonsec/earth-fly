import * as T from 'three';
import {latLonToDir} from './geo';
import {EARTH} from './earth';
import type {MvtLayer} from './mvt';
export interface TransportTile{x:number;y:number;layers:Record<string,MvtLayer>}
export interface RoadNode{id:string;p:T.Vector3;lat:number;lon:number;out:string[];station?:string;line?:string;stationMode?:string}
export interface RoadEdge{id:string;a:RoadNode;b:RoadNode;length:number;direction:T.Vector3;kind:'road'|'rail';class:string;subclass:string;layer:number;tunnel:boolean;bridge:boolean;oneway:boolean;lanes:number;limit:number;reverse:string;offset:number}
export interface TransitLine{id:string;name:string;mode:string;stations:{id:string;name:string;lat:number;lon:number}[];sequences:string[][]}
export function hashText(text:string){let n=2166136261;for(let i=0;i<text.length;i++)n=Math.imul(n^text.charCodeAt(i),16777619);return n>>>0;}
const SPEED:Record<string,number>={motorway:31.3,trunk:27,primary:18,secondary:13.4,tertiary:11.2,minor:8.94,service:5.5,busway:11.2,rail:44,transit:22};
const UK=(lat:number,lon:number)=>lat>49.8&&lat<61&&lon>-8.4&&lon<2.1;
/** Bounded map-derived graph. Different layers never join just because their map coordinates cross. */
export class TransportNetwork{
 nodes=new Map<string,RoadNode>();edges=new Map<string,RoadEdge>();road:RoadEdge[]=[];rail:RoadEdge[]=[];stations:{name:string;lat:number;lon:number;subclass:string}[]=[];
 /** Builds at once when `deferred` is false (tests, tools). The game passes true and drives build() across frames. */
 constructor(private tiles:TransportTile[],public lines:TransitLine[]=[],deferred=false){if(!deferred)for(const _ of this.build({until:Infinity}));}
 /** Resumable construction: yields whenever `slice.until` has passed, so a London-sized graph never freezes a frame. */
 *build(slice:{until:number}):Generator<void,void,void>{
  const tiles=this.tiles,lines=this.lines;
  const n=16384,lonOf=(x:number)=>x/n*360-180,latOf=(y:number)=>Math.atan(Math.sinh(Math.PI*(1-2*y/n)))*180/Math.PI;
  for(const tile of tiles){const layer=tile.layers.transportation;if(!layer)continue;
   for(const f of layer.features){if(performance.now()>slice.until)yield;const p=f.properties,cls=String(p.class),sub=String(p.subclass??''),rail=cls==='rail'||cls==='transit';if(f.type!==2||!SPEED[cls]||p.access==='no'||['siding','yard','crossover','spur'].includes(String(p.service)))continue;
    if(rail&&['abandoned','disused','construction'].includes(sub))continue;
    const tunnel=p.brunnel==='tunnel',bridge=p.brunnel==='bridge',z=Number(p.layer)||(tunnel?-1:bridge?1:0),oneway=Number(p.oneway)===1||p.oneway==='yes'||Number(p.oneway)===-1;
    for(const ring of f.rings){let previous:RoadNode|null=null;
     for(let i=0;i<ring.length;i+=2){const lon=lonOf(tile.x+ring[i]/layer.extent),lat=latOf(tile.y+ring[i+1]/layer.extent);if(!UK(lat,lon)){previous=null;continue;}
      // Snap to the global vector-tile grid (about 0.4 m in London); joins work across tile boundaries.
      const id=`${Math.round((tile.x+ring[i]/layer.extent)*4096)},${Math.round((tile.y+ring[i+1]/layer.extent)*4096)},${rail?'r':'c'},${z}`;
      let node=this.nodes.get(id);if(!node){node={id,p:new T.Vector3(...latLonToDir(lat,lon)).multiplyScalar(EARTH.radius),lat,lon,out:[]};this.nodes.set(id,node);}
      if(previous&&previous.id!==node.id){const a=Number(p.oneway)===-1?node:previous,b=Number(p.oneway)===-1?previous:node,base=`${a.id}>${b.id}`,reverse=`${b.id}>${a.id}`,length=a.p.distanceTo(b.p)*1000;
       if(length>.3&&length<8000){const lanes=!rail&&(cls==='motorway'||cls==='trunk')?2:1;
        const add=(from:RoadNode,to:RoadNode,key:string,rev:string)=>{if(this.edges.has(key))return;const edge:RoadEdge={id:key,a:from,b:to,length,direction:to.p.clone().sub(from.p).normalize(),kind:rail?'rail':'road',class:cls,subclass:sub,layer:z,tunnel,bridge,oneway,lanes,limit:SPEED[cls],reverse:rev,offset:rail?0:oneway?(lanes>1?-1.7:0):cls==='motorway'?-8:cls==='trunk'?-5:-1.6};this.edges.set(key,edge);from.out.push(key);};add(a,b,base,reverse);if(!oneway)add(b,a,reverse,base);
       }
      }previous=node;
     }
    }
   }
   const poi=tile.layers.poi;for(const f of poi?.features??[]){if(f.type!==1||!['railway','railway_station'].includes(String(f.properties.class)))continue;const ring=f.rings[0];if(!ring)continue;this.stations.push({name:String(f.properties.name??f.properties['name:en']??'Station'),lat:latOf(tile.y+ring[1]/poi.extent),lon:lonOf(tile.x+ring[0]/poi.extent),subclass:String(f.properties.subclass??'rail')});}
  }
  yield;
  // Reconnect mapped bridge/tunnel portals to their same-position surface continuation.
  // Only degree-one endpoints join across levels, and only in the straight-ahead direction.
  const columns=new Map<string,RoadNode[]>(),incoming=new Map<string,RoadEdge[]>(),degree=new Map<string,Set<string>>();
  for(const e of this.edges.values()){if(!incoming.has(e.b.id))incoming.set(e.b.id,[]);incoming.get(e.b.id)!.push(e);for(const [a,b]of[[e.a,e.b],[e.b,e.a]]){if(!degree.has(a.id))degree.set(a.id,new Set());degree.get(a.id)!.add(b.id);}}
  for(const node of this.nodes.values()){const key=node.id.slice(0,node.id.lastIndexOf(','));const list=columns.get(key);if(list)list.push(node);else columns.set(key,[node]);}
  for(const nodes of columns.values())if(nodes.length>1)for(const node of nodes){if(degree.get(node.id)?.size!==1)continue;for(const other of nodes){if(other===node||degree.get(other.id)?.size!==1)continue;for(const id of other.out.slice()){const next=this.edges.get(id)!;if(incoming.get(node.id)?.some(e=>e.direction.dot(next.direction)>.9)&&!node.out.includes(id))node.out.push(id);}}}
  this.road=[...this.edges.values()].filter(e=>e.kind==='road');this.rail=[...this.edges.values()].filter(e=>e.kind==='rail');
  if(performance.now()>slice.until)yield;
  // Pin stops to actual track nodes; station identities never replace mapped track geometry.
  const stops=[...this.stations.map(s=>({...s,line:'',mode:s.subclass==='subway'?'tube':'rail'})),...lines.flatMap(l=>l.stations.map(s=>({...s,line:l.name,mode:l.mode,subclass:l.mode==='tube'?'subway':'rail'})))];
  // Rail nodes bucketed on a ~220 x 200 m grid: a stop only measures the nodes in its own and adjacent cells,
  // where it used to measure every rail node in the network.
  const cell=(lat:number,lon:number):[number,number]=>[Math.floor(lat*500),Math.floor(lon*333)],grid=new Map<number,RoadNode[]>();
  for(const node of this.nodes.values()){if(!node.out.some(id=>this.edges.get(id)?.kind==='rail'))continue;const [y,x]=cell(node.lat,node.lon),k=y*1e6+x,list=grid.get(k);if(list)list.push(node);else grid.set(k,[node]);}
  for(const s of stops){let best:RoadNode|undefined,distance=140;const p=new T.Vector3(...latLonToDir(s.lat,s.lon)).multiplyScalar(EARTH.radius),[cy,cx]=cell(s.lat,s.lon),near:RoadNode[]=[];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)near.push(...(grid.get((cy+dy)*1e6+cx+dx)??[]));for(const node of near){const d=node.p.distanceTo(p)*1000;if(d<distance){const e=this.edges.get(node.out[0]);if(s.mode==='tube'&&e?.subclass!=='subway')continue;best=node;distance=d;}}if(best){best.station=s.name.replace(/ (Underground|Rail|DLR|Overground) Station$/,'');best.line=s.line||best.line;best.stationMode=s.mode;}}
 }
 /** Deterministic turn choice. No illegal U-turn except a terminal with a reverse edge. */
 next(edge:RoadEdge,seed:number,rail=false):RoadEdge|undefined{
  const options=edge.b.out.map(id=>this.edges.get(id)!).filter(e=>e&&e.kind===edge.kind&&e.id!==edge.reverse&&(!rail||e.subclass===edge.subclass));
  if(!options.length)return this.edges.get(edge.reverse);
  const ranked=options.map(e=>({e,w:Math.max(.02,(edge.direction.dot(e.direction)+1.2)**3)*(e.class===edge.class?2:1)}));
  if(rail)return ranked.sort((a,b)=>b.w-a.w||a.e.id.localeCompare(b.e.id))[0].e;
  let choice=(hashText(edge.id+seed)/4294967296)*ranked.reduce((sum,x)=>sum+x.w,0);for(const x of ranked){choice-=x.w;if(choice<=0)return x.e;}return ranked.at(-1)!.e;
 }
}
/** Intelligent-driver acceleration, m/s². Desired gap depends on speed and closing speed. */
export function trafficAcceleration(speed:number,desired:number,gap=Infinity,leaderSpeed=speed,accel=1.8,brake=3){const closing=speed-leaderSpeed,wanted=3+Math.max(0,speed*1.3+speed*closing/(2*Math.sqrt(accel*brake)));return T.MathUtils.clamp(accel*(1-(speed/Math.max(.1,desired))**4-(wanted/Math.max(.2,gap))**2),-brake*2,accel);}
export function signalGreen(node:RoadNode,edge:RoadEdge,time:number){if(edge.kind==='rail'||edge.class==='motorway'||edge.class==='trunk'||node.out.length<3)return true;const up=node.p.clone().normalize(),east=new T.Vector3(0,1,0).cross(up).normalize(),axis=Math.abs(edge.direction.dot(east))>.707?0:1,phase=((time+hashText(node.id)%60)%64+64)%64;return axis===0?phase<27:phase>=32&&phase<59;}
