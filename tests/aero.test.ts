import {expect,test} from 'bun:test';import * as T from 'three';
import {aerodynamics,machEffects,atmosphereVelocity} from '../src/flight';import {createPilot,flyPilot,airVelocity} from '../src/combat-ai';import {AIRCRAFT} from '../src/aircraft-models';import type {V} from '../src/vector';
const p:V=[6371.3,0,0],level=(speed:number,alphaDeg:number)=>{const q=new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),alphaDeg*Math.PI/180);const air=atmosphereVelocity(p);return{v:[air[0],air[1],air[2]-speed/1000] as V,q};};
test('compressibility: lift slope peaks transonic and falls supersonic; wave drag rises after Mach 0.82 and eases',()=>{
 expect(machEffects(.3).lift).toBeGreaterThan(1);expect(machEffects(.84).lift).toBeGreaterThan(machEffects(.3).lift);expect(machEffects(2.5).lift).toBeLessThan(machEffects(.3).lift);
 expect(machEffects(.7).wave).toBe(0);expect(machEffects(1.05).wave).toBeGreaterThan(machEffects(.95).wave);expect(machEffects(2.5).wave).toBeLessThan(machEffects(1.1).wave);expect(machEffects(2).induced).toBeGreaterThan(machEffects(.8).induced);});
test('landing configuration lifts more and drags more; ground effect cuts induced drag near the runway',()=>{const{v,q}=level(85,6);
 const clean=aerodynamics(p,v,q,300),dirty=aerodynamics(p,v,q,300,undefined,0,{gear:true}),low=aerodynamics(p,v,q,300,undefined,0,{agl:2});
 const up=(a:{accel:V})=>a.accel[1],back=(a:{accel:V})=>a.accel[2];
 expect(up(dirty)).toBeGreaterThan(up(clean));expect(back(dirty)).toBeGreaterThan(back(clean));expect(back(low)).toBeLessThan(back(clean));expect(up(low)).toBeGreaterThan(up(clean));});
test('enemy energy model: the wing limits g when slow and high, and a 747 accelerates far slower than a Typhoon',()=>{
 const at=(km:number)=>new T.Vector3(0,0,6371+km),player={p:new T.Vector3(0,0,6371+3).addScaledVector(new T.Vector3(1,0,0),20),v:new T.Vector3(),aim:new T.Vector3(1,0,0)};player.v.copy(airVelocity(player.p)).add(new T.Vector3(.25,0,0));
 const calm={locked:false,missile:null,gunsight:false},random=()=>.5;
 const turn=(type:'f16'|'typhoon'|'jumbo',speed:number,km:number)=>{const a=createPilot(new T.Vector3(1,0,0),speed,AIRCRAFT[type].g,0,'evade',at(km).normalize());a.aero=AIRCRAFT[type].aero;a.manoeuvre='break';a.timer=60;a.cool=9;const before=a.dir.clone();flyPilot(a,at(km),.02,player,calm,()=>6371,random);return before.angleTo(a.dir)/.02;};
 // F-16 at 300 m/s low: structure-limited 9 g. At 120 m/s and 10 km the wing gives far less.
 expect(turn('f16',.3,.5)).toBeCloseTo(9*.00981/.3,3);expect(turn('f16',.12,10)).toBeLessThan(.4*9*.00981/.12);
 const accelerate=(type:'typhoon'|'jumbo')=>{const a=createPilot(new T.Vector3(1,0,0),.2,AIRCRAFT[type].g,0,'extend',at(3).normalize());a.aero=AIRCRAFT[type].aero;a.timer=60;const start=a.speed;for(let i=0;i<250;i++)flyPilot(a,at(3),.02,player,calm,()=>6371,random);return a.speed-start;};
 expect(accelerate('typhoon')).toBeGreaterThan(accelerate('jumbo')*2.5);});
