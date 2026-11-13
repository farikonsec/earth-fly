import type { Quaternion } from 'three';
import { EARTH, type EarthState } from './earth';
import { contactGaps } from './contact';
import { inertialToBody, latLonToDir, type EarthSurface } from './geo';
import type { Summit } from './summits';
import {ALL_PEAKS as SUMMITS} from './destinations';
import type { V } from './vector';
export type AlertLevel='none'|'caution'|'critical';
export interface Altimetry {
  msl:number; terrainElevation:number; datumAGL:number; clearance:number;
  aheadClearance:number; aheadSeconds:number;
  summit:{id:string;name:string;distance:number;referenceHeight:number;aboveReference:number;modelDifference:number}|null;
  level:AlertLevel; message:string;
}
function distance(a:V,b:V){return Math.atan2(Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]),(a[0]*b[0]+a[1]*b[1]+a[2]*b[2]))*EARTH.radius*1000;}
/** Simulator position, collision probes and published references remain distinct measurements. */
export function readAltimetry(state:EarthState,surface:EarthSurface,rotation:Quaternion,gear:boolean,known:readonly Summit[]=SUMMITS):Altimetry{
 const radius=Math.hypot(...state.p),body=inertialToBody(state.p,state.t,EARTH.rotation),msl=(radius-EARTH.radius)*1000,
   terrainElevation=surface.radiusM(body)-EARTH.radius*1000,datumAGL=msl-terrainElevation,
   clearance=contactGaps(surface,state.p,state.t,rotation,gear).gap;
 let summit:Altimetry['summit']=null;
 for(const s of known){const direction=latLonToDir(s.lat,s.lon),d=distance(body,direction);if(d<=500&&(!summit||d<summit.distance))summit={id:s.id,name:s.name,distance:d,referenceHeight:s.elevation,aboveReference:msl-s.elevation,modelDifference:surface.radiusM(direction)-EARTH.radius*1000-s.elevation};}
 let aheadClearance=clearance,aheadSeconds=0;
 // Advisory constant-velocity samples, not a guarantee of clearance along a manoeuvre.
 if(state.status==='flying'&&msl<30000&&clearance<5000){
  for(let dt=.5;dt<=8;dt+=.5){
   const p=state.p.map((v,i)=>v+state.v[i]*dt) as V,
     gap=contactGaps(surface,p,state.t+dt,rotation,gear).gap;
   if(gap<aheadClearance){aheadClearance=gap;aheadSeconds=dt;}
  }
 }
 let level:AlertLevel='none',message='';
 if(state.status==='flying'){
  if(clearance<30){level='critical';message=`PULL UP · MODEL CLEARANCE ${clearance.toFixed(1)} m`;}
  else if(aheadClearance<30&&aheadSeconds>0){level='critical';message=`TERRAIN AHEAD · PULL UP · ${aheadSeconds.toFixed(1)} s LOOK-AHEAD`;}
  else if(clearance<150){level='caution';message=`LOW CLEARANCE · ${clearance.toFixed(1)} m ABOVE MODELED GROUND`;}
  else if(aheadClearance<150&&aheadSeconds>0){level='caution';message=`TERRAIN AHEAD · LOW PREDICTED CLEARANCE`;}
  if(summit&&summit.aboveReference<150){
   const reference=`${summit.aboveReference<0?'BELOW':'ABOVE'} ${summit.name.toUpperCase()} REFERENCE ${Math.abs(summit.aboveReference).toFixed(1)} m`;
   if(summit.aboveReference<30){level='critical';message=clearance<30?`${message} · ${reference}`:`SUMMIT PROXIMITY · ${reference}`;}
   else if(level==='none'){level='caution';message=`SUMMIT PROXIMITY · ${reference}`;}
   if(Math.abs(summit.modelDifference)>5)message+=` · TERRAIN REFERENCE MISMATCH ${Math.abs(summit.modelDifference).toFixed(0)} m`;
  }
 }
 return {msl,terrainElevation,datumAGL,clearance,aheadClearance,aheadSeconds,summit,level,message};
}
