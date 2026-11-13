import * as T from 'three';
import {EARTH,type EarthState} from './earth';
import {atmosphereVelocity,advanceFlight} from './flight';
import {inertialToBody,bodyToInertial,dirToLatLon,type EarthSurface} from './geo';
import type {V} from './vector';
/** Fictional travel drive. Parallel transport makes any heading a complete great-circle route. */
export class Supercruise {
 active=false;crashed=false;speed=0;targetSpeed=1200;goal:'free'|'orbit'|'descent'='free';distance=0;
 start(state:EarthState,speed=1200,goal:Supercruise['goal']='free'){this.active=true;this.crashed=false;this.speed=Math.max(80,new T.Vector3(...state.v).sub(new T.Vector3(...atmosphereVelocity(state.p))).length()*1000);this.targetSpeed=speed;this.goal=goal;}
 stop(){this.active=false;this.goal='free';}
 advance(s:EarthState,q:T.Quaternion,dt:number,surface:EarthSurface,steer:{pitch:number;roll:number;yaw:number},brake=false){
  if(!this.active||dt<=0)return;
  // Bounded geographical steps also prevent missing a rising terrain sample at super speed.
  let left=dt;while(left>1e-8&&!this.crashed){const h=Math.min(left,.025);left-=h;this.one(s,q,h,surface,steer,brake);}
  if(this.crashed){const speed=this.speed;this.stop();this.crashed=true;s.status='impact';s.body=`Terrain impact at ${(speed/1000).toFixed(2)} km/s`;return;}
  advanceFlight(s,0,q,{throttle:0,hover:0,lateral:0,surge:0},{surface,gear:false});
 }
 private one(s:EarthState,q:T.Quaternion,dt:number,surface:EarthSurface,steer:{pitch:number;roll:number;yaw:number},brake:boolean){
  const spin=s.t/EARTH.rotation*Math.PI*2,up=new T.Vector3(...inertialToBody(s.p,s.t,EARTH.rotation)).normalize();
  const localQ=q.clone().premultiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),-spin));
  let fwd=new T.Vector3(0,0,-1).applyQuaternion(localQ);let pitch=Math.asin(T.MathUtils.clamp(fwd.dot(up),-.98,.98));
  fwd.addScaledVector(up,-fwd.dot(up)).normalize();if(fwd.lengthSq()<.1)fwd=new T.Vector3(1,0,0).cross(up).normalize();
  fwd.applyAxisAngle(up,(steer.roll+steer.yaw)*dt*.42);
  const altitude=(Math.hypot(...s.p)-EARTH.radius)*1000;
  const target=this.goal==='orbit'?400000:this.goal==='descent'?surface.radiusM(up.toArray() as V)-EARTH.radius*1000+2500:null;
  if(target!==null){const delta=target-altitude;pitch=T.MathUtils.clamp(delta/Math.max(this.speed*6,12000),-.85,.85);if(Math.abs(delta)<20){this.goal='free';pitch=0;}}
  else pitch=T.MathUtils.clamp(pitch+steer.pitch*dt*.32,-1.3,1.3);
  // Trading height for speed: a dive runs up to 2.6x the selected cruise, a climb gives a little back.
  const dive=Math.max(0,-Math.sin(pitch)),climb=Math.max(0,Math.sin(pitch)),desired=brake?120:this.targetSpeed*(1+1.6*dive)*(1-.25*climb);this.speed+=(desired-this.speed)*(1-Math.exp(-dt/2));
  const radial=this.speed*Math.sin(pitch),horizontal=this.speed*Math.cos(pitch),angle=horizontal*dt/(EARTH.radius*1000+altitude);
  const next=up.clone().multiplyScalar(Math.cos(angle)).addScaledVector(fwd,Math.sin(angle)).normalize();
  const tangent=fwd.clone().multiplyScalar(Math.cos(angle)).addScaledVector(up,-Math.sin(angle)).normalize();
  let height=altitude+radial*dt;
  // Guided climbs and descents hold a terrain margin. Free flight does not: the ground is solid.
  const ground=surface.radiusM(next.toArray() as V)-EARTH.radius*1000;
  if(this.goal!=='free')height=Math.max(ground+300,height);else if(height<=ground+3){height=ground+3;this.crashed=true;}height=Math.min(10000000,height);
  const newForward=tangent.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(next,Math.sin(pitch));
  const right=newForward.clone().cross(next).normalize(),top=right.clone().cross(newForward).normalize();
  const basis=new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(right,top,newForward.clone().negate()));
  const bank=-(steer.roll+steer.yaw)*.35;basis.multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),bank));
  s.t+=dt;s.p=bodyToInertial(next.multiplyScalar(EARTH.radius+height/1000).toArray() as V,s.t,EARTH.rotation);
  q.copy(basis).premultiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),s.t/EARTH.rotation*Math.PI*2));
  const v=newForward.applyAxisAngle(new T.Vector3(0,1,0),s.t/EARTH.rotation*Math.PI*2).multiplyScalar(this.speed/1000);
  s.v=v.add(new T.Vector3(...atmosphereVelocity(s.p))).toArray() as V;s.status='flying';s.heat=0;s.structuralDamage=0;s.fuel=100;this.distance+=horizontal*dt;
 }
}
