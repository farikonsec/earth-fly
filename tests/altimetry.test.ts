import {test,expect} from 'bun:test';
import * as T from 'three';
import {readAltimetry} from '../src/altimetry';
import {EarthSurface,latLonToDir,bodyToInertial,dirToLatLon} from '../src/geo';
import {EARTH,type EarthState} from '../src/earth';
import {atmosphereVelocity} from '../src/flight';
import {SUMMITS} from '../src/summits';
import type {V} from '../src/vector';
function at(lat:number,lon:number,msl:number,time=0){
 const direction=latLonToDir(lat,lon),p=bodyToInertial(direction.map(v=>v*(EARTH.radius+msl/1000)) as V,time,EARTH.rotation),
   state:EarthState={p,v:atmosphereVelocity(p),t:time,fuel:100,status:'flying',body:'',heat:0},
   q=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),new T.Vector3(...p).normalize());
 return {state,q};
}
class Flat extends EarthSurface{constructor(public elevation:number){super();}radiusM(){return EARTH.radius*1000+this.elevation;}}
test('ten metres above published Everest shows true MSL and reference difference, not a false ten metre model clearance',()=>{
 const s=SUMMITS[0],{state,q}=at(s.lat,s.lon,s.elevation+10),r=readAltimetry(state,new Flat(8729.254190139658),q,false);
 expect(r.msl).toBeCloseTo(8858.86,5);expect(r.summit!.aboveReference).toBeCloseTo(10,5);
 expect(r.clearance).toBeCloseTo(128.10580986,4);expect(r.level).toBe('critical');expect(r.message).toContain('SUMMIT PROXIMITY');expect(r.message).toContain('MISMATCH 120 m');
});
test('modeled ten metre clearance uses actual contact probes, with signed MSL and gear/attitude offsets',()=>{
 const {state,q}=at(0,0,112.1),surface=new Flat(100),belly=readAltimetry(state,surface,q,false,[]),gear=readAltimetry(state,surface,q,true,[]);
 expect(belly.msl).toBeCloseTo(112.1,5);expect(belly.datumAGL).toBeCloseTo(12.1,5);expect(belly.clearance).toBeCloseTo(10.6,5);expect(gear.clearance).toBeCloseTo(8.7,3);
 expect(belly.message).toContain('PULL UP');
 q.multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),Math.PI/2));
 expect(readAltimetry(state,surface,q,false,[]).clearance).toBeCloseTo(-2.9,3);// knife-edge: the lower wingtip (15 m out) reaches 2.9 m into the ground
 const negative=at(0,0,-20),below=readAltimetry(negative.state,new Flat(-28),negative.q,false,[]);
 expect(below.msl).toBeCloseTo(-20,6);expect(below.clearance).toBeCloseTo(6.5,5);
});
test('nearby published summit warnings are automatic for every summit and survive Earth rotation',()=>{
 for(const s of SUMMITS){const {state,q}=at(s.lat,s.lon,s.elevation+10,12345),r=readAltimetry(state,new Flat(s.elevation-100),q,false);expect(r.summit!.id).toBe(s.id);expect(r.summit!.distance).toBeLessThan(.001);expect(r.level).toBe('critical');}
 const s=SUMMITS[0],far=at(s.lat+.01,s.lon,s.elevation+10);expect(readAltimetry(far.state,new Flat(0),far.q,false).summit).toBeNull();
});
test('rising terrain ahead warns before current ground clearance becomes low',()=>{
 class Ridge extends EarthSurface{radiusM(p:V){return EARTH.radius*1000+(dirToLatLon(p).lon>.003?300:0);}}
 const {state,q}=at(0,0,200);state.v[2]-=.1;
 const r=readAltimetry(state,new Ridge(),q,false,[]);
 expect(r.clearance).toBeGreaterThan(190);expect(r.aheadClearance).toBeLessThan(0);expect(r.aheadSeconds).toBeGreaterThan(0);expect(r.level).toBe('critical');expect(r.message).toContain('TERRAIN AHEAD');
});
test('landed and impact states retain measurements without a pull-up alert',()=>{
 const {state,q}=at(0,0,3.4);
 for(const status of ['landed','impact'] as const){state.status=status;const r=readAltimetry(state,new Flat(0),q,true,[]);expect(r.clearance).toBeCloseTo(0,3);expect(r.level).toBe('none');expect(r.message).toBe('');}
});
