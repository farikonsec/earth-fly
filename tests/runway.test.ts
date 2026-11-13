import {expect,test} from 'bun:test';import * as T from 'three';
import {advanceFlight,atmosphereVelocity,RUNWAY} from '../src/flight';import {EarthSurface} from '../src/geo';import {surfaceAttitude,settleOnSurface} from '../src/contact';import type {EarthState} from '../src/earth';import type {V} from '../src/vector';
const surface=new EarthSurface(),idle={throttle:0,hover:0,lateral:0,surge:0};
/** Parked on a smooth sphere, nose along +Z. */
function parked(){const p:V=[6371.01,0,0],q=surfaceAttitude(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,0,-1),new T.Vector3(0,0,1)),[1,0,0]);const s:EarthState={p:settleOnSurface(surface,p,0,q),v:atmosphereVelocity(p),t:0,fuel:100,status:'landed',body:'',heat:0};return{s,q};}
const speed=(s:EarthState)=>Math.hypot(...s.v.map((v,i)=>v-atmosphereVelocity(s.p)[i]))*1000;
test('take-off roll accelerates, holds the runway below rotate speed, and lifts off on rotation',()=>{const{s,q}=parked();let rolled=0;
 for(let i=0;i<2000&&s.status==='landed';i++){advanceFlight(s,.02,q,{...idle,throttle:1,rotate:(s.roll??0)>RUNWAY.rotate+3?1:0},{surface,gear:true});if(s.status==='landed'){expect((Math.hypot(...s.p)-6371)*1000).toBeLessThan(6);rolled=s.roll??0;}}
 expect(rolled).toBeGreaterThan(RUNWAY.rotate);expect(s.status).toBe('flying');expect(speed(s)).toBeGreaterThan(RUNWAY.rotate);expect(s.body).toContain('Airborne');});
test('a parked aircraft with no thrust stays parked, and brakes stop a roll',()=>{const{s,q}=parked();for(let i=0;i<200;i++)advanceFlight(s,.02,q,idle,{surface,gear:true});expect(s.status).toBe('landed');expect(s.roll??0).toBe(0);
 s.roll=80;let distance=0;for(let i=0;i<2000&&(s.roll??0)>0;i++){advanceFlight(s,.02,q,{...idle,airbrake:1},{surface,gear:true});distance+=(s.roll??0)*.02;}expect(s.roll).toBe(0);expect(s.status).toBe('landed');expect(distance).toBeGreaterThan(200);expect(distance).toBeLessThan(900);});
test('a fast, shallow gear-down arrival becomes a landing roll; a hard one is still a crash',()=>{
 const arrive=(sink:number,gear:boolean)=>{const{s,q}=parked();s.status='flying';s.p=[6371.0045,0,0];const air=atmosphereVelocity(s.p);s.v=[air[0]-sink/1000,air[1],air[2]+.11];for(let i=0;i<600&&s.status==='flying';i++)advanceFlight(s,.02,q,idle,{surface,gear});return s;};
 const good=arrive(3,true);expect(good.status).toBe('landed');expect(good.roll??0).toBeGreaterThan(60);expect(good.body).toContain('Touchdown');
 expect(arrive(25,true).status).toBe('impact');expect(arrive(3,false).status).toBe('impact');});
