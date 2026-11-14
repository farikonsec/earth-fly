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
  const spin=s.t/EARTH.rotation*Math.PI*2,up=new T.Vector3(...inertialToBody(s.p,s.t,EARTH.rotation)).normalize(),yAxis=new T.Vector3(0,1,0);
  // Attitude in the Earth-fixed frame. Free flight keeps it as full 3D state, so the nose can loop and the wings can roll through any angle.
  const localQ=q.clone().premultiply(new T.Quaternion().setFromAxisAngle(yAxis,-spin));
  const altitude=(Math.hypot(...s.p)-EARTH.radius)*1000;
  const target=this.goal==='orbit'?400000:this.goal==='descent'?surface.radiusM(up.toArray() as V)-EARTH.radius*1000+2500:null;
  if(target!==null){
   // Guided climb or descent: wings level, nose set by the autopilot.
   let fwd=new T.Vector3(0,0,-1).applyQuaternion(localQ);fwd.addScaledVector(up,-fwd.dot(up));
   if(fwd.lengthSq()<1e-6)fwd=new T.Vector3(0,1,0).applyQuaternion(localQ).addScaledVector(up,-new T.Vector3(0,1,0).applyQuaternion(localQ).dot(up));
   if(fwd.lengthSq()<1e-6)fwd=new T.Vector3(1,0,0).cross(up);fwd.normalize().applyAxisAngle(up,(steer.roll+steer.yaw)*dt*.42);
   const delta=target-altitude;let pitch=T.MathUtils.clamp(delta/Math.max(this.speed*6,12000),-.85,.85);if(Math.abs(delta)<20){this.goal='free';pitch=0;}
   const nose=fwd.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(up,Math.sin(pitch)),right=nose.clone().cross(up).normalize(),top=right.clone().cross(nose).normalize();
   localQ.setFromRotationMatrix(new T.Matrix4().makeBasis(right,top,nose.clone().negate()));
  }else{
   // Body rates: pull loops, roll rolls, rudder yaws. A banked jet also turns a little on its own, as a real one does.
   const bank=this.bank(localQ,up),turn=-Math.sin(bank)*.28*Math.max(0,new T.Vector3(0,1,0).applyQuaternion(localQ).dot(up));
   localQ.multiply(new T.Quaternion().setFromEuler(new T.Euler(steer.pitch*.95*dt,steer.yaw*.45*dt,steer.roll*2.6*dt,'YXZ')));
   localQ.premultiply(new T.Quaternion().setFromAxisAngle(up,turn*dt)).normalize();
  }
  const nose=new T.Vector3(0,0,-1).applyQuaternion(localQ),sinP=T.MathUtils.clamp(nose.dot(up),-1,1),cosP=Math.sqrt(1-sinP*sinP);
  let ahead=nose.clone().addScaledVector(up,-sinP);if(ahead.lengthSq()<1e-10)ahead=new T.Vector3(0,1,0).applyQuaternion(localQ).addScaledVector(up,-new T.Vector3(0,1,0).applyQuaternion(localQ).dot(up));
  if(ahead.lengthSq()<1e-10)ahead=new T.Vector3(1,0,0).cross(up);ahead.normalize();
  // Trading height for speed: a dive runs up to 2.6x the selected cruise, a climb gives a little back.
  const dive=Math.max(0,-sinP),climb=Math.max(0,sinP),desired=brake?120:this.targetSpeed*(1+1.6*dive)*(1-.25*climb);this.speed+=(desired-this.speed)*(1-Math.exp(-dt/2));
  const radial=this.speed*sinP,horizontal=this.speed*cosP,angle=horizontal*dt/(EARTH.radius*1000+altitude);
  const next=up.clone().multiplyScalar(Math.cos(angle)).addScaledVector(ahead,Math.sin(angle)).normalize();
  // Parallel transport: carry the attitude over the curve of the Earth so level flight stays level.
  if(angle>0)localQ.premultiply(new T.Quaternion().setFromAxisAngle(up.clone().cross(ahead).normalize(),angle));
  let height=altitude+radial*dt;
  // Guided climbs and descents hold a terrain margin. Free flight does not: the ground is solid.
  const ground=surface.radiusM(next.toArray() as V)-EARTH.radius*1000;
  if(this.goal!=='free')height=Math.max(ground+300,height);else if(height<=ground+3){height=ground+3;this.crashed=true;}height=Math.min(10000000,height);
  s.t+=dt;s.p=bodyToInertial(next.multiplyScalar(EARTH.radius+height/1000).toArray() as V,s.t,EARTH.rotation);
  const turnOut=new T.Quaternion().setFromAxisAngle(yAxis,s.t/EARTH.rotation*Math.PI*2);q.copy(localQ.normalize()).premultiply(turnOut);
  const v=new T.Vector3(0,0,-1).applyQuaternion(q).multiplyScalar(this.speed/1000);
  s.v=v.add(new T.Vector3(...atmosphereVelocity(s.p))).toArray() as V;s.status='flying';s.heat=0;s.structuralDamage=0;s.fuel=100;this.distance+=horizontal*dt;
 }
 /** Bank angle about the nose, positive with the right wing down. */
 private bank(localQ:T.Quaternion,up:T.Vector3){const right=new T.Vector3(1,0,0).applyQuaternion(localQ),top=new T.Vector3(0,1,0).applyQuaternion(localQ);return Math.atan2(-right.dot(up),top.dot(up));}
}
