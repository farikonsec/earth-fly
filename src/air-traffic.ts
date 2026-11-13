import * as T from 'three';
import {latLonToDir,bodyToInertial} from './geo';
import {EARTH} from './earth';
import type {V} from './vector';
/** Public runway endpoints: OurAirports, snapshot 2026-11-11. Schedules are fictional. */
export const AIRPORTS={
 EGLL:{name:'London Heathrow',lat:51.47749,lon:-.489439,endLat:51.477681,endLon:-.433227,elevation:24,runway:'09L'},
 EGKK:{name:'London Gatwick',lat:51.145103,lon:-.212345,endLat:51.151493,endLon:-.165992,elevation:60,runway:'08R'},
 EGBB:{name:'Birmingham',lat:52.465599,lon:-1.76111,endLat:52.442964,endLon:-1.735894,elevation:93,runway:'15'},
 EGCC:{name:'Manchester',lat:53.3451004,lon:-2.2927401,endLat:53.3624001,endLon:-2.2571399,elevation:65,runway:'05L'},
 EGPH:{name:'Edinburgh',lat:55.944,lon:-3.39014,endLat:55.955898,endLon:-3.35506,elevation:34,runway:'06'},
 EGPF:{name:'Glasgow',lat:55.863499,lon:-4.44906,endLat:55.879902,endLon:-4.41831,elevation:8,runway:'05'},
 LFPG:{name:'Paris Charles de Gaulle',lat:49.0205994,lon:2.5130601,endLat:49.0237007,endLon:2.5702901,elevation:113,runway:'09R'},
} as const;
export type Airport=keyof typeof AIRPORTS;
export const AIRLINERS=[
 {name:'Airbus A320',length:37.6,span:35.8,width:3.95,engines:2,colour:0x43b7bc},
 {name:'Airbus A321',length:44.5,span:35.8,width:3.95,engines:2,colour:0xde914e},
 {name:'Airbus A330',length:63.7,span:60.3,width:5.64,engines:2,colour:0x7a9de1},
 {name:'Airbus A350',length:66.8,span:64.8,width:5.96,engines:2,colour:0xaf82d0},
 {name:'Boeing 777',length:73.9,span:64.8,width:6.2,engines:2,colour:0xe5bc5d},
 {name:'Boeing 747',length:70.7,span:64.4,width:6.5,engines:4,colour:0xe07792},
] as const;
export type TrafficPhase='Parked'|'Taxi out'|'Takeoff'|'Climb'|'Cruise'|'Descent'|'Approach'|'Landing'|'Taxi in';
interface Node {p:T.Vector3;speed:number;phase:TrafficPhase}
export interface Leg {from:Airport;to:Airport;nodes:Node[];times:number[];duration:number;roll:number;land:number;start:number}
export interface AirFlight {id:string;type:number;legs:Leg[];p:T.Vector3;v:T.Vector3;body:T.Vector3;forward:T.Vector3;up:T.Vector3;phase:TrafficPhase;route:string;gear:boolean;visible:boolean;speed:number}
const Y=new T.Vector3(0,1,0),PERIOD=14400;
const direction=(a:Airport)=>new T.Vector3(...latLonToDir(AIRPORTS[a].lat,AIRPORTS[a].lon));
export function runwayPoint(a:Airport,along:number,side=0,height=0){const r=AIRPORTS[a],u=direction(a),f=new T.Vector3(...latLonToDir(r.endLat,r.endLon)).sub(u).projectOnPlane(u).normalize(),right=f.clone().cross(u).normalize();return u.multiplyScalar(EARTH.radius).addScaledVector(f,along).addScaledVector(right,side).normalize().multiplyScalar(EARTH.radius+(r.elevation+height)/1000);}
function makeLeg(from:Airport,to:Airport,slot:number):Leg{
 const nodes:Node[]=[],add=(p:T.Vector3,speed:number,phase:TrafficPhase)=>nodes.push({p,speed,phase}),gate=.3+(slot%6)*.1,gateAlong=1.5+Math.floor(slot/6)*.14;
 add(runwayPoint(from,gateAlong,gate,6),0,'Parked');add(runwayPoint(from,.35,.09,4),.008,'Taxi out');add(runwayPoint(from,.05,0,6),.008,'Taxi out');
 add(runwayPoint(from,1.8,0,6),.082,'Takeoff');add(runwayPoint(from,5,0,220),.12,'Climb');add(runwayPoint(from,15,0,1400),.17,'Climb');
 const start=runwayPoint(from,25),end=runwayPoint(to,-40),dist=start.distanceTo(end),height=Math.min(10.7,Math.max(4.5,dist*.026));
 for(let i=1;i<=4;i++){const u=i/5,p=start.clone().lerp(end,u).normalize().multiplyScalar(EARTH.radius+height);add(p,.235,i===1?'Climb':i===4?'Descent':'Cruise');}
 add(runwayPoint(to,-35,0,1850),.16,'Descent');add(runwayPoint(to,-12,0,630),.11,'Approach');add(runwayPoint(to,-2,0,110),.08,'Approach');
 add(runwayPoint(to,.45,0,6),.072,'Landing');add(runwayPoint(to,2.1,0,6),.009,'Landing');add(runwayPoint(to,2.1,gate,6),.008,'Taxi in');add(runwayPoint(to,gateAlong,gate,6),0,'Taxi in');
 const times=[0];for(let i=1;i<nodes.length;i++)times.push(times[i-1]+2*nodes[i].p.distanceTo(nodes[i-1].p)/Math.max(.008,nodes[i].speed+nodes[i-1].speed));
 return{from,to,nodes,times,duration:times.at(-1)!,roll:times[2],land:times[13],start:0};
}
/** Constant acceleration per segment, no teleport or random walk; curved airborne corners. */
export function sampleLeg(leg:Leg,elapsed:number){
 const time=T.MathUtils.clamp(elapsed,0,leg.duration);let i=1;while(i<leg.times.length-1&&time>leg.times[i])i++;
 const a=leg.nodes[i-1],b=leg.nodes[i],duration=leg.times[i]-leg.times[i-1],u=T.MathUtils.clamp((time-leg.times[i-1])/duration,0,1),s=(2*a.speed*u+(b.speed-a.speed)*u*u)/Math.max(.008,a.speed+b.speed);
 let p=a.p.clone().lerp(b.p,s);
 if(i>=5&&i<=12){
  // Hermite tangents keep banked transitions smooth. Radius is interpolated separately to avoid cutting into the globe.
  const prev=leg.nodes[Math.max(0,i-2)].p,next=leg.nodes[Math.min(leg.nodes.length-1,i+1)].p,d=a.p.distanceTo(b.p),m0=b.p.clone().sub(prev).normalize().multiplyScalar(d),m1=next.clone().sub(a.p).normalize().multiplyScalar(d);
  p=a.p.clone().multiplyScalar(2*s*s*s-3*s*s+1).addScaledVector(m0,s*s*s-2*s*s+s).addScaledVector(b.p,-2*s*s*s+3*s*s).addScaledVector(m1,s*s*s-s*s);
 }
 p.normalize().multiplyScalar(T.MathUtils.lerp(a.p.length(),b.p.length(),s));
 return{p,phase:b.phase,speed:T.MathUtils.lerp(a.speed,b.speed,u)};
}
export class AirTraffic{
 flights:AirFlight[]=[];readonly period=PERIOD;
 constructor(){
  const destinations:Airport[]=['EGBB','LFPG','EGCC','EGPH','EGPF','LFPG'];
  const reservations=new Map<Airport,number[]>();
  const free=(a:Airport,t:number)=>(reservations.get(a)??[]).every(x=>Math.abs(x-t)>150);
  const reserve=(a:Airport,t:number)=>reservations.set(a,[...(reservations.get(a)??[]),t]);
  for(let i=0;i<18;i++){
   const from:Airport=i%3===2?'EGKK':'EGLL',to=destinations[i%6],out=makeLeg(from,to,i),back=makeLeg(to,from,i);
   let start=40+i*170;while(!free(from,start+out.roll)||!free(to,start+out.land))start+=20;
   out.start=start;reserve(from,start+out.roll);reserve(to,start+out.land);
   start+=out.duration+200;while(!free(to,start+back.roll)||!free(from,start+back.land))start+=20;
   back.start=start;reserve(to,start+back.roll);reserve(from,start+back.land);
   if(start+back.duration>=PERIOD)throw Error('Traffic schedule exceeds repeat period');
   this.flights.push({id:`EF${(101+i).toString()}`,type:i%6,legs:[out,back],p:new T.Vector3(),v:new T.Vector3(),body:new T.Vector3(),forward:new T.Vector3(),up:new T.Vector3(),phase:'Parked',route:`${from} → ${to}`,gear:true,visible:true,speed:0});
  }
 }
 update(seconds:number,t:number,ground?:(body:T.Vector3)=>number){
  const clock=((seconds%PERIOD)+PERIOD)%PERIOD;
  for(const f of this.flights){const leg=clock>=f.legs[1].start?f.legs[1]:f.legs[0],elapsed=clock-leg.start,sample=sampleLeg(leg,elapsed),before=sampleLeg(leg,elapsed-.1),after=sampleLeg(leg,elapsed+.1);
   f.body.copy(sample.p);f.phase=elapsed<0||elapsed>leg.duration?'Parked':sample.phase;f.route=`${leg.from} → ${leg.to}`;f.speed=f.phase==='Parked'?0:sample.speed;
   f.gear=['Parked','Taxi out','Takeoff','Approach','Landing','Taxi in'].includes(f.phase);
   if(ground){const floor=ground(f.body)+(AIRLINERS[f.type].width/2+2)/1000,onRunway=['Parked','Taxi out','Taxi in','Takeoff'].includes(f.phase)||f.phase==='Landing'&&elapsed>=leg.times[13];if(f.body.length()<floor||onRunway)f.body.setLength(floor);}
   f.p.set(...bodyToInertial(f.body.toArray() as V,t,EARTH.rotation));
   let tangent=after.p.clone().sub(before.p);if(tangent.lengthSq()<1e-10)tangent=runwayPoint(elapsed<0?leg.from:leg.to,2).sub(runwayPoint(elapsed<0?leg.from:leg.to,1));
   f.forward.copy(tangent.normalize().applyAxisAngle(Y,t/EARTH.rotation*Math.PI*2));f.up.copy(f.p).normalize();
   if(!f.gear){const earlier=sampleLeg(leg,elapsed-1).p,later=sampleLeg(leg,elapsed+1).p,acc=later.add(earlier).addScaledVector(sample.p,-2),radial=sample.p.clone().normalize();acc.addScaledVector(radial,-acc.dot(radial));const lift=radial.multiplyScalar(.00981).add(acc);f.up.copy(lift.normalize().applyAxisAngle(Y,t/EARTH.rotation*Math.PI*2));}
   f.v.set(Math.PI*2/EARTH.rotation*f.p.z,0,-Math.PI*2/EARTH.rotation*f.p.x).addScaledVector(f.forward,f.speed);
   f.visible=true;
  }
 }
}
