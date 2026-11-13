import { test, expect } from 'bun:test';
import * as T from 'three';
import { environmentAt, AIR_LAYERS, airAppearance, trajectory } from '../src/environment';
import { EARTH, type EarthState, energy } from '../src/earth';
import { advanceFlight, VEHICLE, atmosphereVelocity } from '../src/flight';
import { atmosphereAt } from '../src/air';
import { EarthSurface } from '../src/geo';
import { dot, len } from '../src/vector';
const idle = { throttle: 0, hover: 0, lateral: 0, surge: 0 };
const surface = new EarthSurface();
function orbit(h: number): EarthState {
  const r = EARTH.radius + h/1000;
  return { p: [r,0,0],v: [0,Math.sqrt(EARTH.mu/r),0],t:0,fuel:100,status:'flying',body:'',heat:0 };
}
test('scientific labels retain atmospheric layer above the space boundary',()=>{
  for(const l of AIR_LAYERS) {
    expect(environmentAt(l.bottom).layer).toBe(l.name);
    expect(environmentAt(l.top-.001).layer).toBe(l.name);
  }
  expect(environmentAt(99999).space).toBe(false);
  expect(environmentAt(100000).label).toBe('Space · Thermosphere');
  expect(environmentAt(400000).label).toBe('Space · Thermosphere');
  expect(environmentAt(10000000).label).toBe('Space · Beyond the exosphere');
});
test('sky and ground haze fade continuously with altitude and remain dark at night',()=>{
  let previous=Infinity;
  for(let h=0;h<=150000;h+=1000) {
    const a=airAppearance(h,1);
    expect(a.hazeDensity).toBeLessThanOrEqual(previous);
    previous=a.hazeDensity;
    expect(Object.values(a).flat().every(Number.isFinite)).toBe(true);
  }
  for(const h of [12000,50000,85000,100000,700000]) {
    expect(Math.abs(airAppearance(h-.01,1).skyLight-airAppearance(h+.01,1).skyLight)).toBeLessThan(.00001);
  }
  expect(airAppearance(40000,1).stars).toBeGreaterThan(airAppearance(0,1).stars);
  expect(airAppearance(0,-1).haze.reduce((a,b)=>a+b)).toBeLessThan(.03);
  expect(airAppearance(0,-1).skyLight).toBeLessThan(.03);
});
test('400 km circular orbit has expected speed, period and perigee',()=>{
  const info=trajectory(orbit(400000));
  expect(info.circularSpeed).toBeCloseTo(7.6726,3);
  expect(info.escapeSpeed).toBeCloseTo(10.8507,3);
  expect(info.circularPeriod/60).toBeCloseTo(92.414,2);
  expect(info.perigee).toBeCloseTo(400000,1);
  expect(info.phase).toBe('Earth orbit');
});
test('altitude alone does not turn a suborbital climb into orbit or an inbound flyby into escape',()=>{
  const s=orbit(400000);
  s.v=[1,0,0];expect(trajectory(s).phase).toBe('Suborbital flight');
  s.v=[12,0,0];expect(trajectory(s).phase).toBe('Escape trajectory');
  s.v=[-12,0,0];expect(trajectory(s).phase).toBe('Unbound approach');
});
test('an entire unpowered Earth circuit closes at two altitudes',()=>{
  for(const altitude of [400000,1000000]) {
    const s=orbit(altitude),start=[...s.p],period=trajectory(s).circularPeriod;
    let swept=0;
    for(let elapsed=0;elapsed<period;) {
      const dt=Math.min(10,period-elapsed),before=[...s.p];
      advanceFlight(s,dt,new T.Quaternion(),idle,{surface,gear:false});
      swept+=Math.acos(Math.min(1,Math.max(-1,dot(before as [number,number,number],s.p)/(Math.hypot(...before)*len(s.p)))));
      elapsed+=dt;
    }
    expect(s.status).toBe('flying');
    expect(swept).toBeCloseTo(2*Math.PI,3);
    expect(Math.hypot(...s.p.map((x,i)=>x-start[i]))).toBeLessThan(.01);
  }
});
test('torch reaches orbital and escape speed; orbital airspeed near ground breaks the airframe',()=>{
  const s=orbit(400000);s.v=[0,0,0];
  const q=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,0,-1),new T.Vector3(0,1,0));
  advanceFlight(s,40,q,{...idle,throttle:1,torch:true},{surface,gear:false});
  expect(s.status).toBe('flying');
  expect(len(s.v)).toBeGreaterThan(trajectory(s).escapeSpeed);
  expect(energy(s)).toBeGreaterThan(0);
  const low=orbit(1000),pressure=.5*atmosphereAt(1000).density*(len(low.v)*1000)**2;
  expect(pressure).toBeGreaterThan(VEHICLE.maxDynamicPressure*100);
  advanceFlight(low,.1,new T.Quaternion(),idle,{surface,gear:false});
  expect(low.status).toBe('impact');
  expect(low.body).toContain('Structural failure');
  const ceiling=Math.sqrt(2*VEHICLE.maxDynamicPressure/atmosphereAt(0).density);
  expect(ceiling).toBeGreaterThan(541);expect(ceiling).toBeLessThan(543);
});
