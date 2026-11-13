import {test,expect} from 'bun:test';
import * as T from 'three';
import {PilotInput,SonicFeedback,gameThrottle,flightCues} from '../src/pilot';
import {sonicWave} from '../src/sound';
import {advanceFlight,atmosphereVelocity,FlightControl,type FlightTelemetry} from '../src/flight';
import {EARTH,type EarthState} from '../src/earth';
import {EarthSurface} from '../src/geo';
import {add,type V} from '../src/vector';
const zero={pitch:0,yaw:0,roll:0};
test('virtual stick smoothing is independent of frame rate and released bank commands level the wings',()=>{
 const a=new PilotInput(),b=new PilotInput();let x=zero,y=zero;
 for(let t=0;t<1;t+=.01)x=a.update({pitch:1,yaw:0,roll:1},0,160,10000,.01,'game');
 for(let t=0;t<1;t+=.02)y=b.update({pitch:1,yaw:0,roll:1},0,160,10000,.02,'game');
 expect(x.pitch).toBeCloseTo(y.pitch,5);expect(x.pitch).toBeGreaterThan(.99);
 const centered=new PilotInput().update(zero,.4,160,10000,.02,'game');expect(centered.roll).toBeLessThan(0);expect(centered.yaw).toBeGreaterThan(0);
 expect(new PilotInput().update(zero,.4,160,0,.02,'game').roll).toBe(0);
 expect(a.update({pitch:-1,yaw:.5,roll:1},.4,160,10000,.02,'direct')).toEqual({pitch:-1,yaw:.5,roll:1});
});
test('boost governor reduces engine demand under high air load and brake cuts it',()=>{
 expect(gameThrottle(.15,true,false,10000)).toBe(1);expect(gameThrottle(1,true,false,106000)).toBeLessThan(.2);
 expect(gameThrottle(1,true,false,110000)).toBe(0);expect(gameThrottle(1,true,true,1000)).toBe(0);
});
test('Mach event is hysteretic, requires air and never fires from merely loading a supersonic scene',()=>{
 const s=new SonicFeedback();s.update(.9,11000,.36,0,.02,true);expect(s.update(1.01,11000,.36,1,.02,true)).toBe(true);
 for(let t=2;t<10;t++)expect(s.update(1.02,11000,.36,t,.02,true)).toBe(false);
 expect(s.crossings).toBe(1);s.update(.9,11000,.36,11,.02,true);expect(s.update(1.01,11000,.36,12,.02,true)).toBe(true);
 s.reset();expect(s.update(1.5,11000,.36,0,0,true)).toBe(false);expect(s.update(1.6,11000,.36,1,.02,true)).toBe(false);
 s.reset();s.update(.8,400000,0,0,0,true);expect(s.update(28,400000,0,1,.02,true)).toBe(false);
 s.reset();s.update(.8,11000,.36,0,0,true);expect(s.update(1.1,11000,.36,1,.02,false)).toBe(false);
});
test('airflow and buffet cues are bounded and absent in vacuum',()=>{
 expect(flightCues(28,7600,0,0).flow).toBe(0);expect(flightCues(28,7600,0,0).buffet).toBe(0);
 expect(flightCues(1,300,.36,20000).buffet).toBeGreaterThan(.9);
 expect(flightCues(1.5,450,.36,20000).buffet).toBeLessThan(.01);
});
test('synthesized sonic cue is finite, bounded and decays instead of clipping',()=>{
 const wave=sonicWave(48000);expect(wave.length).toBe(55200);expect(wave.every(Number.isFinite)).toBe(true);
 const peak=wave.reduce((a,b)=>Math.max(a,Math.abs(b)),0);expect(peak).toBeGreaterThan(.3);expect(peak).toBeLessThan(.95);
 const rms=(start:number,end:number)=>Math.sqrt(wave.slice(start,end).reduce((a,b)=>a+b*b,0)/(end-start));
 expect(rms(1000,10000)).toBeGreaterThan(rms(45000,55000)*10);
});
function simulate(braking=false) {
 const surface=new EarthSurface(),q=new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(new T.Vector3(0,0,-1),new T.Vector3(1,0,0),new T.Vector3(0,-1,0))),
   p:V=[EARTH.radius+11,0,0],s:EarthState&{tele?:FlightTelemetry}={p,v:add(atmosphereVelocity(p),[0,265/1000,0]),t:0,fuel:100,status:'flying',body:'',heat:0},
   control=new FlightControl(),feedback=new SonicFeedback();let maxQ=0,maxMach=0;
 control.maxRate.set(.65,.4,1.3);advanceFlight(s,0,q,{throttle:0,hover:0,lateral:0,surge:0},{surface,gear:false});
 for(let t=0;t<60&&s.status==='flying';t+=.02) {
   control.update(q,new T.Vector3(),.02,s.tele);
   advanceFlight(s,.02,q,{throttle:gameThrottle(.15,true,braking,s.tele?.dynamicPressure??0),boost:true,airbrake:braking?1:0,hover:0,lateral:0,surge:0},{surface,gear:false});
   maxQ=Math.max(maxQ,s.tele!.dynamicPressure);maxMach=Math.max(maxMach,s.tele!.mach);
   feedback.update(s.tele!.mach,11000,.36,s.t,.02,true);
 }
 return {s,maxQ,maxMach,feedback};
}
test('game boost crosses Mach 1 and stays within pressure/heat limits for a full minute',()=>{
 const result=simulate();expect(result.s.status).toBe('flying');expect(result.maxMach).toBeGreaterThan(1.1);
 expect(result.maxQ).toBeLessThan(110000);expect(result.s.heat).toBeLessThan(10);expect(result.feedback.crossings).toBe(1);
});
test('airbrake slows the aircraft rather than granting free supersonic safety',()=>{
 const boosted=simulate(),braked=simulate(true);expect(braked.s.tele!.airspeed).toBeLessThan(boosted.s.tele!.airspeed);
 expect(braked.feedback.crossings).toBe(0);
});
