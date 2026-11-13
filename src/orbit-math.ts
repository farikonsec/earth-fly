import {json2satrec,propagate,gstime,eciToGeodetic,type OMMJsonObject,type SatRec,type EciVec3} from 'satellite.js';
import {EARTH} from './earth';
import {bodyToInertial,latLonToDir} from './geo';
import type {V} from './vector';
export type OrbitalElement=OMMJsonObject;
export const elementTime=(s:OrbitalElement)=>Date.parse(s.EPOCH.endsWith('Z')?s.EPOCH:s.EPOCH+'Z');
/** Preserve WGS84 geographic latitude/longitude/height on the game's mean-radius sphere. */
function mappedPosition(p:EciVec3<number>,theta:number,t:number):V{
 const geo=eciToGeodetic(p,theta),d=latLonToDir(geo.latitude*180/Math.PI,geo.longitude*180/Math.PI),r=EARTH.radius+geo.height;
 return bodyToInertial(d.map(x=>x*r) as V,t,EARTH.rotation);
}
/** SGP4 TEME -> geographic Earth -> Y-up game frame. km and km/s, UTC throughout. */
export function orbitState(rec:SatRec,utc:number,simulationTime:number){
 const date=new Date(utc),pv=propagate(rec,date);if(!pv||!pv.position||!pv.velocity)return null;
 const theta=gstime(date),omega=7.29211514670698e-5,p=mappedPosition(pv.position,theta,simulationTime);
 // Numerical Jacobian maps the velocity through the same ellipsoid-to-sphere transform.
 // Central difference avoids adding orbital acceleration to the reported derivative.
 const h=.05,offset=(sign:number)=>mappedPosition({x:pv.position.x+pv.velocity.x*h*sign,y:pv.position.y+pv.velocity.y*h*sign,z:pv.position.z+pv.velocity.z*h*sign},theta+omega*h*sign,simulationTime+h*sign),before=offset(-1),after=offset(1),v=after.map((x,i)=>(x-before[i])/(2*h)) as V;
 if(![...p,...v].every(Number.isFinite)||Math.hypot(...p)<EARTH.radius)return null;
 return {p,v,speed:Math.hypot(pv.velocity.x,pv.velocity.y,pv.velocity.z)};
}
export {json2satrec};
