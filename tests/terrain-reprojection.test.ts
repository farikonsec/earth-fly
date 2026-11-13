import {test,expect} from 'bun:test';
import {Terrain} from '../src/terrain';
import {buildTerrainTransition} from '../src/terrain-mesh';
import {renderedTerrainSampler,type TerrainSnapshot} from '../src/terrain-reprojection';
import {latLonToDir} from '../src/geo';
import type {V} from '../src/vector';
const anchor=(lat:number,lon:number)=>latLonToDir(lat,lon).map(v=>v*6371) as V;
test('rendered triangle sampler stays finite at poles/dateline and rejects the back of Earth',()=>{
 for(const [lat,lon] of [[46.7,8],[0,180],[89.99,179.99],[-89.99,-179.99]]){
  const t=new Terrain();t.global.fill(500);const a=anchor(lat,lon),m=buildTerrainTransition(t,{anchor:a,imagery:null,segments:64}),sample=renderedTerrainSampler({anchor:a,segments:64,position:m.position,basePosition:m.basePosition});
  expect(sample(latLonToDir(lat,lon))!).toBeCloseTo(6371.5,5);expect(sample(a.map(v=>-v) as V)).toBeNull();
 }
});
test('reprojection preserves both old rendered elevation endpoints and blends to the finer new surface',()=>{
 const t=new Terrain(),lat=46.7,lon=8,a=anchor(lat,lon),n=128;t.previous=new Map();t.blend=.37;
 t.height=(p,q)=>{const x=(p-lat)*111195,y=(q-lon)*111195*Math.cos(lat*Math.PI/180),hill=120*Math.exp(-((x-40)**2+(y+15)**2)/17000),w=t.blend*t.blend*(3-2*t.blend);return 900+hill+80*w;};
 const old=buildTerrainTransition(t,{anchor:a,imagery:null,segments:n,generation:7}),snapshot:TerrainSnapshot={anchor:a,segments:n,position:old.position,basePosition:old.basePosition,generation:7},b=anchor(lat+.00065,lon+.00035),m=buildTerrainTransition(t,{anchor:b,imagery:null,segments:n,generation:7},snapshot);
 expect(t.blend).toBe(.37);expect(m.recentered).toBe(true);
 for(const w of [0,.25,.7,1]){
  const positions=new Float32Array(old.position.length);for(let k=0;k<positions.length;k++)positions[k]=old.basePosition[k]+(old.position[k]-old.basePosition[k])*w;
  const sample=renderedTerrainSampler(snapshot,positions);
  for(const [i,j] of [[64,64],[61,67],[70,60],[55,57]]){
   const id=j*(n+1)+i,k=id*3,body=b.map((v,axis)=>v+m.basePosition[k+axis]+(m.position[k+axis]-m.basePosition[k+axis])*w) as V,radius=Math.hypot(...body),delta=m.recenterHeight[id*2]*(1-w)+m.recenterHeight[id*2+1]*w;
   expect(Math.abs((radius+delta-sample(body)!)*1000)).toBeLessThan(.03);
   let last=-Infinity;for(const blend of [0,.1,.5,.9,1]){const correction=delta*(1-blend);expect(Math.abs(correction)).toBeLessThanOrEqual(Math.abs(delta)+1e-12);const progress=Math.abs(delta)-Math.abs(correction);expect(progress).toBeGreaterThanOrEqual(last);last=progress;}
  }
 }
 expect([...m.recenterNormal,...m.recenterBaseNormal].every(Number.isFinite)).toBe(true);
 const center=(64*129+64)*3;expect(Math.hypot(...m.recenterNormal.slice(center,center+3))).toBeCloseTo(1,5);
});
test('old geometry cannot be reused across generations or large location jumps',()=>{
 const t=new Terrain(),a=anchor(46.7,8),old=buildTerrainTransition(t,{anchor:a,imagery:null,segments:16,generation:1}),snapshot={anchor:a,segments:16,position:old.position,basePosition:old.basePosition,generation:1};
 for(const request of [{anchor:a,imagery:null,generation:2,segments:16},{anchor:anchor(47,8),imagery:null,generation:1,segments:16}]){
  const m=buildTerrainTransition(t,request,snapshot);expect(m.recentered).toBe(false);expect(m.recenterHeight.every(v=>v===0)).toBe(true);
 }
});
