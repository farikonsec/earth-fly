import * as T from 'three';
import {TransportNetwork,hashText,signalGreen,trafficAcceleration,type RoadEdge} from './transport-network';
export type VehicleKind='hatchback'|'saloon'|'estate'|'suv'|'taxi'|'van'|'bus'|'lorry'|'train'|'freight'|'tube'|'overground'|'tram';
export const VEHICLES:Record<VehicleKind,{length:number;width:number;height:number;carriages:number;accel:number;brake:number;top:number;hp:number}>={
 hatchback:{length:3.9,width:1.75,height:1.5,carriages:1,accel:2.1,brake:3.5,top:35,hp:2},saloon:{length:4.6,width:1.85,height:1.45,carriages:1,accel:2.4,brake:3.8,top:38,hp:2},estate:{length:4.7,width:1.85,height:1.6,carriages:1,accel:1.9,brake:3.3,top:34,hp:2},suv:{length:4.8,width:2,height:1.9,carriages:1,accel:1.8,brake:3.2,top:34,hp:3},taxi:{length:4.8,width:1.95,height:1.85,carriages:1,accel:1.9,brake:3.3,top:30,hp:2},van:{length:5.8,width:2.1,height:2.6,carriages:1,accel:1.3,brake:3,top:29,hp:3},bus:{length:10.8,width:2.55,height:4.35,carriages:1,accel:1,brake:2.5,top:22,hp:4},lorry:{length:15,width:2.55,height:4,carriages:1,accel:.7,brake:2,top:25,hp:4},
 train:{length:23,width:2.8,height:3.8,carriages:5,accel:.8,brake:1.1,top:55,hp:6},freight:{length:16,width:2.8,height:3.6,carriages:6,accel:.45,brake:.8,top:30,hp:6},tube:{length:17.5,width:2.65,height:2.9,carriages:6,accel:1.1,brake:1.2,top:22,hp:5},overground:{length:20,width:2.8,height:3.8,carriages:4,accel:1,brake:1.15,top:32,hp:5},tram:{length:15,width:2.65,height:3.4,carriages:2,accel:1.1,brake:1.3,top:22,hp:4},
};
export interface GroundVehicle{id:number;kind:VehicleKind;edge:string;s:number;speed:number;acceleration:number;seed:number;lane:number;laneOffset:number;changing:number;next?:string;history:string[];dwell:number;station:string;stoppedAt:string;turn:number;braking:boolean;dead:boolean;wreckAge:number;age:number;distance:number;line:string;colour:number;busCycle:number}
const PALETTE=[0xe7e8e2,0x252a32,0xaeb6bc,0x3f5368,0x951f25,0x235679,0x2b5c4c,0xebe1c8,0xb66b27,0x626571,0x3e344d];
export class GroundTraffic{
 vehicles:GroundVehicle[]=[];time=0;private serial=4000000;private refill=0;private junctions=new Map<string,{id:number;until:number}>();network=new TransportNetwork([]);capacity=720;railCapacity=32;
 setNetwork(network:TransportNetwork,origin:T.Vector3){this.network=network;this.vehicles=this.vehicles.filter(v=>network.edges.has(v.edge));this.populate(origin);}
 private populate(origin:T.Vector3){
  const occupied=new Set(this.vehicles.map(v=>v.edge)),choose=(edges:RoadEdge[],rail:boolean)=>{
   const candidates=edges.filter(e=>e.a.p.distanceToSquared(origin)<(rail?36:9)&&e.length>(rail?35:12)).sort((a,b)=>hashText(a.id)-hashText(b.id));
   let count=this.vehicles.filter(v=>VEHICLES[v.kind].carriages>1===rail).length,limit=rail?this.railCapacity:this.capacity;
   for(const e of candidates){if(count>=limit)break;if(occupied.has(e.id)||rail&&occupied.has(e.reverse))continue;
    const h=hashText(e.id),sample=h/4294967296;if(!rail&&sample>Math.min(1,e.length/(e.class==='motorway'?60:e.class==='service'?440:110)))continue;
    if(rail&&this.vehicles.some(v=>VEHICLES[v.kind].carriages>1&&this.network.edges.get(v.edge)?.a.p.distanceTo(e.a.p)!<.35))continue;
    const s=e.length*(.15+(h%700)/1000),near=this.vehicles.some(v=>v.edge===e.id&&Math.abs(v.s-s)<25);if(near)continue;
    const london=e.a.lat>51.25&&e.a.lat<51.75&&e.a.lon>-.65&&e.a.lon<.35;
    let kind:VehicleKind=rail?(e.subclass==='subway'?'tube':e.class==='transit'?'tram':e.a.stationMode==='overground'||e.b.stationMode==='overground'||london&&h%4===0?'overground':h%5===0?'freight':'train'):h%20<4?'hatchback':h%20<8?'saloon':h%20<10?'estate':h%20<12?'suv':h%20<14?'taxi':h%20<17?'van':h%20<19?'bus':'lorry';
    if(['minor','service'].includes(e.class)&&(kind==='bus'||kind==='lorry'))kind=h%2?'van':'estate';
    if(e.class==='motorway'&&(kind==='taxi'||kind==='bus'))kind=h%2?'lorry':'saloon';
    const spec=VEHICLES[kind],v:GroundVehicle={busCycle:0,id:++this.serial,kind,edge:e.id,s,speed:Math.min(e.limit,spec.top)*(.5+(h%200)/1000),acceleration:0,seed:h,lane:0,laneOffset:e.offset,changing:0,history:[],dwell:0,station:'',stoppedAt:'',next:undefined,turn:0,braking:false,dead:false,wreckAge:0,age:0,distance:0,line:e.a.line||e.b.line||'',colour:kind==='taxi'?0x171d23:kind==='bus'?0xa51f2b:kind==='tube'?0xd5dde3:kind==='overground'?0xdd842f:kind==='train'?0x284e81:kind==='freight'?0x92613d:PALETTE[h%PALETTE.length]};
    // Seed a real route behind a train so its carriages start on track, not on an extrapolated straight line.
    let cursor=e;for(let n=0;n<60;n++){const incoming=cursor.a.out.map(id=>networkEdge(this.network,id)?.reverse).map(id=>id?this.network.edges.get(id):undefined).filter((x):x is RoadEdge=>!!x&&x.kind===e.kind&&x.id!==cursor.reverse).sort((a,b)=>b.direction.dot(cursor.direction)-a.direction.dot(cursor.direction));if(!incoming.length)break;cursor=incoming[0];v.history.unshift(cursor.id);if(v.history.reduce((sum,id)=>sum+(this.network.edges.get(id)?.length??0),0)>spec.length*spec.carriages+80)break;}
    this.vehicles.push(v);occupied.add(e.id);count++;
   }
  };choose(this.network.rail,true);choose(this.network.road,false);
 }
 kill(id:number){const v=this.vehicles.find(v=>v.id===id);if(!v||v.dead)return false;v.dead=true;v.speed=0;v.acceleration=0;v.wreckAge=0;return true;}
 advance(dt:number,origin:T.Vector3){if(dt<=0)return;let remaining=Math.min(dt,30);while(remaining>1e-8){const h=Math.min(.1,remaining);this.tick(h);remaining-=h;}this.refill+=dt;
  if(this.refill>8){this.refill=0;this.vehicles=this.vehicles.filter(v=>{const e=this.network.edges.get(v.edge);return e&&e.a.p.distanceToSquared(origin)<(VEHICLES[v.kind].carriages>1?64:16)&&(!v.dead||v.wreckAge<100);});this.populate(origin);}
 }
 private tick(dt:number){this.time+=dt;const lanes=new Map<string,GroundVehicle[]>();
  for(const v of this.vehicles){const k=v.edge+':'+v.lane;if(!lanes.has(k))lanes.set(k,[]);lanes.get(k)!.push(v);}for(const vs of lanes.values())vs.sort((a,b)=>a.s-b.s);
  for(const v of this.vehicles){v.age+=dt;if(v.dead){v.wreckAge+=dt;continue;}const e=this.network.edges.get(v.edge);if(!e)continue;const spec=VEHICLES[v.kind],rail=spec.carriages>1;
   v.changing=Math.max(0,v.changing-dt);v.dwell=Math.max(0,v.dwell-dt);if(v.dwell>0){v.speed=0;v.braking=true;continue;}
   v.next??=this.network.next(e,v.seed+Math.floor(v.distance/50),rail)?.id;const next=v.next?this.network.edges.get(v.next):undefined,remaining=e.length-v.s;
   let desired=Math.min(e.limit,spec.top)*(.88+(v.seed%220)/1000),gap=Infinity,leadSpeed=v.speed;const own=lanes.get(v.edge+':'+v.lane)!,index=own.indexOf(v),leader=own[index+1];
   const occupiedLength=(lead:GroundVehicle)=>{const ls=VEHICLES[lead.kind];return(ls.length+spec.length)/2+(ls.carriages-1)*(ls.length+1);};
   if(leader){gap=leader.s-v.s-occupiedLength(leader);leadSpeed=leader.speed;}
   if(next){const further=lanes.get(next.id+':'+Math.min(v.lane,next.lanes-1))?.[0];if(further){const distance=remaining+further.s-occupiedLength(further);if(distance<gap){gap=distance;leadSpeed=further.speed;}}}
   // Right lane is overtaking; return left once a safe gap opens. No opposing-lane overtakes.
   if(!rail&&e.lanes>1&&v.changing===0&&remaining>65){const other=1-v.lane,neighbours=lanes.get(e.id+':'+other)??[],safe=neighbours.every(n=>Math.abs(n.s-v.s)>Math.max(16,n.speed*1.8+spec.length));
    if(safe&&(v.lane===0&&leader&&leader.speed<desired*.83&&gap<Math.max(30,v.speed*3)||v.lane===1&&(!leader||gap>35))){v.lane=other;v.changing=5;}}
   const targetOffset=e.offset+v.lane*3.5;v.laneOffset+=T.MathUtils.clamp(targetOffset-v.laneOffset,-1.1*dt,1.1*dt);
   if(next){const angle=e.direction.angleTo(next.direction);if(angle>.15){const corner=Math.max(rail?4:2.5,Math.sqrt((rail?.6:2.5)*Math.max(5,12/angle)));desired=Math.min(desired,Math.sqrt(corner*corner+2*spec.brake*Math.max(0,remaining-4)));v.turn=e.direction.clone().cross(next.direction).dot(e.a.p)>0?-1:1;}else v.turn=0;}else desired=0;
   const holder=this.junctions.get(e.b.id),busy=holder&&holder.id!==v.id&&holder.until>this.time;
   const station=rail&&e.b.station&&v.stoppedAt!==e.b.id||v.kind==='bus'&&Math.floor(v.age/110)>v.busCycle;
   let halt=!next||(!rail&&!signalGreen(e.b,e,this.time))||!!busy;
   if(rail){const opposing=lanes.get(e.reverse+':0');if(opposing?.some(o=>!o.dead&&o.s<200))halt=true;}
   if(halt||station){const stopGap=Math.max(0,remaining-1);if(stopGap<gap){gap=stopGap;leadSpeed=0;}desired=Math.min(desired,Math.sqrt(2*spec.brake*stopGap));}
   if(station&&remaining<5&&v.speed<.5){v.dwell=rail?20+v.seed%16:12;v.busCycle=Math.floor(v.age/110);v.stoppedAt=e.b.id;v.station=e.b.station??'Bus stop';v.line=e.b.line||v.line;v.speed=0;continue;}
   // Roadside bus stops are synthetic scheduled stops, not claims about live bus routes.
   
   v.acceleration=trafficAcceleration(v.speed,Math.max(.1,desired),gap,leadSpeed,spec.accel,spec.brake);const speed=Math.max(0,v.speed+v.acceleration*dt),distance=Math.max(0,(v.speed+speed)*.5*dt);v.speed=speed;v.braking=v.acceleration<-.6||halt&&remaining<15;
   const move=Math.min(distance,Math.max(0,gap-1));if(move<distance)v.speed=Math.min(v.speed,move/dt);v.s+=move;v.distance+=move;
   if(v.s>=e.length-.15&&next&&!halt){if(e.b.out.length>2)this.junctions.set(e.b.id,{id:v.id,until:this.time+(rail?spec.length*spec.carriages/Math.max(2,v.speed):1.2)});v.s=Math.max(0,v.s-e.length);v.history.push(e.id);if(v.history.length>100)v.history.shift();v.edge=next.id;v.next=undefined;v.stoppedAt='';v.lane=Math.min(v.lane,next.lanes-1);}
  }
  for(const [key,slot]of this.junctions)if(slot.until<this.time-1)this.junctions.delete(key);
 }
 pose(v:GroundVehicle,behind=0){let e=this.network.edges.get(v.edge);if(!e)return null;let s=v.s-behind,i=v.history.length-1;while(s<0&&i>=0){const prev=this.network.edges.get(v.history[i--]);if(!prev)break;e=prev;s+=e.length;}
  const u=T.MathUtils.clamp(s/e.length,0,1),p=e.a.p.clone().lerp(e.b.p,u).normalize().multiplyScalar(6371),up=p.clone().normalize(),forward=e.direction.clone().projectOnPlane(up).normalize(),right=forward.clone().cross(up).normalize();p.addScaledVector(right,(e.kind==='rail'?0:v.laneOffset)/1000);
  // Ease orientation into the next segment while position stays on the mapped route.
  if(behind===0&&v.next){const next=this.network.edges.get(v.next);if(next&&e.length-s<12)forward.lerp(next.direction,T.MathUtils.smoothstep(12-(e.length-s),0,24)).normalize();}
  return{p,forward,up,edge:e};
 }
 get stats(){return{road:this.vehicles.filter(v=>VEHICLES[v.kind].carriages===1&&!v.dead).length,rail:this.vehicles.filter(v=>VEHICLES[v.kind].carriages>1&&!v.dead).length,stopped:this.vehicles.filter(v=>v.speed<.5&&!v.dead).length,overtaking:this.vehicles.filter(v=>v.lane===1&&!v.dead).length,wrecks:this.vehicles.filter(v=>v.dead).length,edges:this.network.edges.size,stations:[...this.network.nodes.values()].filter(n=>n.station).length};}
}
function networkEdge(network:TransportNetwork,id:string){return network.edges.get(id);}
