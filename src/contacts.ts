import * as T from 'three';
export interface RadarContact {id:string;name:string;kind:'hostile'|'civil'|'orbital'|'ground'|'road'|'rail'|'friendly'|'sub'|'cruise';p:T.Vector3;v:T.Vector3;detail:string;altitude?:number;epoch?:string;stale?:boolean;targetId?:number}
/** Occlusion uses the modeled spherical Earth, never shows a target through the far side. */
export function lineOfSight(a:T.Vector3,b:T.Vector3,radius=6371){const d=b.clone().sub(a),t=T.MathUtils.clamp(-a.dot(d)/Math.max(1e-10,d.lengthSq()),0,1);return a.clone().addScaledVector(d,t).length()>=radius-.02;}
