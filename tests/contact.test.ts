import { test, expect } from 'bun:test';
import * as T from 'three';
import { groundFrame, contactGaps, settleOnSurface, surfaceAttitude, LANDING } from '../src/contact';
import { EARTH, type EarthState } from '../src/earth';
import { EarthSurface, bodyToInertial, inertialToBody, latLonToDir } from '../src/geo';
import { advanceFlight, atmosphereVelocity, descentAssist, type FlightTelemetry } from '../src/flight';
import { add, mul, unit, len, dot, type V } from '../src/vector';
const idle={throttle:0,hover:0,lateral:0,surge:0};
const level=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),new T.Vector3(1,0,0));
/** A true local plane with a known inclination, intersected by radial samples. */
class Plane extends EarthSurface {
  normal:V;
  constructor(public degrees:number){super();this.normal=[Math.cos(degrees*Math.PI/180),-Math.sin(degrees*Math.PI/180),0];}
  radiusM(dir:V){return 6371000*this.normal[0]/dot(unit(dir),this.normal);}
}
function state(height=4):EarthState & {tele?: FlightTelemetry} {const p:V=[6371+height/1000,0,0];return {p,v:atmosphereVelocity(p),t:0,fuel:100,status:'flying',body:'',heat:0};}
test('terrain normals recover a known plane and rotate with the Earth',()=>{
  for(const slope of [0,5,12,30]) {
    const surface=new Plane(slope),time=2345,p=bodyToInertial([6371.004,0,0],time,EARTH.rotation),frame=groundFrame(surface,p,time),
      expected=bodyToInertial(surface.normal,time,EARTH.rotation);
    expect(frame.slope).toBeCloseTo(slope,5);
    expect(dot(frame.normal,expected)).toBeCloseTo(1,6);
  }
  for(const lat of [-90,90]) {
    const p=mul(latLonToDir(lat,180),6371.004),frame=groundFrame(new EarthSurface(),p,0);
    expect(frame.normal.every(Number.isFinite)).toBe(true);expect(frame.slope).toBeLessThan(.001);
  }
});
test('aligned gentle-slope touchdown supports all pads and holds body-fixed attitude',()=>{
  const surface=new Plane(8),s=state(),q=surfaceAttitude(level,surface.normal);
  s.p=settleOnSurface(surface,s.p,0,q);s.p=add(s.p,[.0001,0,0]);
  s.v=add(atmosphereVelocity(s.p),mul(surface.normal,-.001));
  advanceFlight(s,.2,q,idle,{surface,gear:true});expect(s.status).toBe('landed');
  const initial=inertialToBody(s.p,s.t,EARTH.rotation);
  advanceFlight(s,600,q,idle,{surface,gear:true});
  const final=inertialToBody(s.p,s.t,EARTH.rotation),frame=groundFrame(surface,s.p,s.t),up=new T.Vector3(0,1,0).applyQuaternion(q);
  expect(len(add(final,mul(initial,-1)))).toBeLessThan(.000001);
  expect(up.dot(new T.Vector3(...frame.normal))).toBeGreaterThan(.999999);
  expect(Math.abs(contactGaps(surface,s.p,s.t,q,true).gap)).toBeLessThan(.001);
  expect(contactGaps(surface,s.p,s.t,q,true).spread).toBeLessThan(.001);
});
test('gentle contact on steep ground is rejected even if aligned',()=>{
  const surface=new Plane(25),s=state(),q=surfaceAttitude(level,surface.normal);
  s.p=settleOnSurface(surface,s.p,0,q);s.p=add(s.p,[.0001,0,0]);s.v=add(atmosphereVelocity(s.p),[-.001,0,0]);
  advanceFlight(s,.2,q,idle,{surface,gear:true});expect(s.status).toBe('impact');expect(s.body).toContain('Terrain too steep');
});
test('a slope that passes the inclination limit can still reject poor attitude or uneven pad support',()=>{
  const surface=new Plane(10),s=state();
  s.p=settleOnSurface(surface,s.p,0,level);s.p=add(s.p,[.0001,0,0]);s.v=add(atmosphereVelocity(s.p),[-.001,0,0]);
  advanceFlight(s,.2,level.clone(),idle,{surface,gear:true});expect(s.status).toBe('impact');expect(s.body).toContain('Tipped over');
  class Ridge extends EarthSurface {radiusM(dir:V){const p=unit(dir);return 6371000+(p[1]>.0000005?1.5:0);}}
  const ridge=new Ridge(),r=state();r.p=settleOnSurface(ridge,r.p,0,level);r.p=add(r.p,[.0001,0,0]);r.v=add(atmosphereVelocity(r.p),[-.001,0,0]);
  advanceFlight(r,.2,level.clone(),idle,{surface:ridge,gear:true});expect(r.status).toBe('impact');expect(r.body).toContain('Uneven ground');
});
test('landing speed is resolved against the slope normal and tangent',()=>{
  const surface=new Plane(8),s=state(),q=surfaceAttitude(level,surface.normal);
  s.p=settleOnSurface(surface,s.p,0,q);s.p=add(s.p,[.0001,0,0]);s.v=add(atmosphereVelocity(s.p),mul(surface.normal,-.008));
  advanceFlight(s,.05,q,idle,{surface,gear:true});expect(s.status).toBe('impact');expect(s.tele?.impactSpeed).toBeGreaterThan(8);
});
test('descent assist aligns to a safe slope and holds above an unsafe site',()=>{
  const surface=new Plane(8),s=state(10);advanceFlight(s,0,level.clone(),idle,{surface,gear:true});
  const cmd=descentAssist(s,s.tele!,level),up=new T.Vector3(0,1,0).applyQuaternion(cmd.level);
  expect(up.dot(new T.Vector3(...surface.normal))).toBeGreaterThan(.999);
  const steep=new Plane(25);advanceFlight(s,0,level.clone(),idle,{surface:steep,gear:true});
  const hold=descentAssist(s,s.tele!,level);expect(hold.targetVs).toBe(0);expect(Number.isFinite(hold.hover)).toBe(true);
  expect(s.tele?.groundSlope).toBeGreaterThan(LANDING.maxSlope);
});
test('complete assisted descents land on gentle slopes and hold above steep slopes',async()=>{
  const {FlightControl}=await import('../src/flight');
  for(const degrees of [8,25]) {
    const surface=new Plane(degrees),s=state(60),q=level.clone(),control=new FlightControl();
    advanceFlight(s,0,q,idle,{surface,gear:true});
    for(let t=0;t<60&&s.status==='flying';t+=.02) {
      const cmd=descentAssist(s,s.tele!,q);
      control.pointTo(cmd.level);control.update(q,new T.Vector3(),.02);
      advanceFlight(s,.02,q,{...idle,hover:cmd.hover,lateral:cmd.lateral,surge:cmd.surge},{surface,gear:true});
    }
    expect(s.status).toBe(degrees===8?'landed':'flying');
    if(degrees===25)expect(s.tele!.agl).toBeGreaterThan(40);
  }
});

test('retracting gear releases contact and cannot preserve a parked hover',()=>{
  const surface=new EarthSurface(),s=state(3.4);s.status='landed';
  advanceFlight(s,1,level.clone(),idle,{surface,gear:false});
  // The belly sits 1.9 m below the pads, so the drop is an impact either way.
  expect(s.status).toBe('impact');expect(s.body).toMatch(/Landing gear retracted|Surface impact/);
});

test('a central ridge cannot support a geared landing on the belly with pads in the air',()=>{
  class CentralRidge extends EarthSurface {radiusM(dir:V){const p=unit(dir);return 6371000+(Math.hypot(p[1],p[2])*6371000<1?3:0);}}
  const surface=new CentralRidge(),s=state(),q=level.clone();
  s.p=settleOnSurface(surface,s.p,0,q);s.p=add(s.p,[.0001,0,0]);
  s.v=add(atmosphereVelocity(s.p),[-.001,0,0]);
  advanceFlight(s,.2,q,idle,{surface,gear:true});
  expect(s.status).toBe('impact');expect(s.body).toContain('Uneven ground');
});
