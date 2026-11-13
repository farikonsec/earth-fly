import * as T from 'three';
import {EARTH} from './earth';import {atmosphereAt} from './air';import {latLonToDir,dirToLatLon} from './geo';import {BLACKBIRD} from './blackbird';
export interface TourConfig{lat:number;lon:number;heading:number;altitude:number;mach:number}
export const TIME_RATES=[1,5,20,60,120,240] as const;
export function lapPlan(altitude=BLACKBIRD.cruiseAltitude,mach=BLACKBIRD.cruiseMach,rate=1){
 const speed=mach*atmosphereAt(altitude).soundSpeed,distance=2*Math.PI*(EARTH.radius*1000+altitude),seconds=distance/speed;
 return{speed,distance,seconds,wallSeconds:seconds/rate};
}
/** Great-circle mission referenced to the rotating Earth. Heading evolves along the route. */
export class WorldTour{
 readonly start:T.Vector3;readonly tangent:T.Vector3;readonly normal:T.Vector3;
 elapsed=0;angle=0;distance=0;completed=false;refuels=0;
 constructor(public config:TourConfig){
  for(const n of Object.values(config))if(!Number.isFinite(n))throw Error('Invalid tour settings');
  if(Math.abs(config.lat)>90||Math.abs(config.lon)>180||config.altitude<20000||config.altitude>BLACKBIRD.ceiling||config.mach<2.5||config.mach>3.2||config.heading<0||config.heading>360)throw Error('Tour requires 20–25.9 km and Mach 2.5–3.2');
  this.start=new T.Vector3(...latLonToDir(config.lat,config.lon));const lon=config.lon*Math.PI/180,east=new T.Vector3(-Math.sin(lon),0,-Math.cos(lon)),north=this.start.clone().cross(east),h=config.heading*Math.PI/180;
  this.tangent=north.multiplyScalar(Math.cos(h)).addScaledVector(east,Math.sin(h)).normalize();this.normal=this.start.clone().cross(this.tangent).normalize();
 }
 get plan(){return lapPlan(this.config.altitude,this.config.mach);}
 advance(seconds:number){if(!Number.isFinite(seconds)||seconds<0)throw Error('Invalid tour time');const dt=Math.min(seconds,Math.max(0,this.plan.seconds-this.elapsed));this.elapsed+=dt;this.distance=this.plan.speed*this.elapsed;this.angle=Math.min(2*Math.PI,this.distance/(EARTH.radius*1000+this.config.altitude));this.completed=this.elapsed>=this.plan.seconds-1e-7;this.refuels=Math.floor(this.distance/BLACKBIRD.range);return dt;}
 pose(){const a=this.completed?0:this.angle,up=this.start.clone().multiplyScalar(Math.cos(a)).addScaledVector(this.tangent,Math.sin(a)).normalize(),direction=this.start.clone().multiplyScalar(-Math.sin(a)).addScaledVector(this.tangent,Math.cos(a)).normalize();return{up,direction,location:dirToLatLon(up.toArray()),progress:this.completed?1:this.angle/(2*Math.PI),fuel:100*(1-this.distance%BLACKBIRD.range/BLACKBIRD.range)};}
 summary(rate:number){const p=this.pose();return{...this.config,...this.plan,wallSeconds:this.plan.seconds/rate,progress:p.progress,distance:this.distance,elapsed:this.elapsed,remaining:Math.max(0,this.plan.seconds-this.elapsed),wallRemaining:Math.max(0,this.plan.seconds-this.elapsed)/rate,refuels:this.refuels,completed:this.completed,location:p.location,start:{lat:this.config.lat,lon:this.config.lon}};}
}
/** Return a bounded physics workload; high tour rates use the dedicated cruise integrator. */
export function freeFlightRate(request:number,clearance:number,manual:boolean,landing:boolean){if(manual||landing||clearance<1500)return 1;return clearance>=120000?request:Math.min(20,request);}
