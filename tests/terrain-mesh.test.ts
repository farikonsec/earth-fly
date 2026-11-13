import { test, expect } from 'bun:test';
import { Terrain, mercator, terrainRecenterKm } from '../src/terrain';
import { buildTerrainMesh } from '../src/terrain-mesh';
import { latLonToDir } from '../src/geo';
import type { V } from '../src/vector';
import { terrainOffset, terrainOpacity, regionalWeight } from '../src/terrain-coverage';
function anchor(lat:number,lon:number):V {
  return latLonToDir(lat,lon).map(x=>x*6371) as V;
}
test('worker mesh center shares blended terrain and lake collision height',()=>{
  const t=new Terrain(),lat=46.727,lon=7.98,m=mercator(lat,lon,9),
    x=Math.floor(m.x),y=Math.floor(m.y);
  t.global.fill(100);
  t.tiles.set(`9/${x}/${y}`,{z:9,x,y,loaded:0,data:new Float32Array(65536).fill(1000)});
  t.previous=new Map();t.blend=.5;
  const a=anchor(lat,lon);
  for(const height of [550,564]) {
    if(height===564)t.waterLevel=()=>564;
    const mesh=buildTerrainMesh(t,{anchor:a,imagery:null,segments:16}), k=(8*17+8)*3;
    const radial=Math.hypot(a[0]+mesh.position[k],a[1]+mesh.position[k+1],a[2]+mesh.position[k+2]);
    expect((radial-6371)*1000).toBeCloseTo(height,2);
    expect(t.height(lat,lon)).toBeCloseTo(height,2);
  }
});
test('worker mesh normals face outward and global UVs stay continuous at dateline and poles',()=>{
  const t=new Terrain();
  for(const [lat,lon] of [[0,180],[90,0],[-90,180],[46.55,8]]) {
    const a=anchor(lat,lon),m=buildTerrainMesh(t,{anchor:a,imagery:null,segments:16}), k=(8*17+8)*3;
    expect([...m.position,...m.normal,...m.uv].every(Number.isFinite)).toBe(true);
    expect(Math.hypot(...m.normal.slice(k,k+3))).toBeCloseTo(1,5);
    expect(m.normal[k]*a[0]+m.normal[k+1]*a[1]+m.normal[k+2]*a[2]).toBeGreaterThan(6370);
    expect(Math.max(...m.uv.filter((_,i)=>i%2===0))-Math.min(...m.uv.filter((_,i)=>i%2===0))).toBeLessThanOrEqual(lat===0?.04:1);
    expect(m.index.length).toBe(16*16*6);
  }
});

test('dense central grid keeps the vertex budget and monotone 600 km horizon',()=>{
  let previous=-Infinity;
  for(let i=0;i<=256;i++) {
    const d=i/128-1,offset=terrainOffset(d);
    expect(offset).toBeGreaterThanOrEqual(previous);previous=offset;
    if(Math.abs(d)<=.5)expect(offset).toBeCloseTo(d*.64,10);
    expect(terrainOffset(-d)).toBeCloseTo(-offset,10);
  }
  expect(terrainOffset(1)).toBeCloseTo(600,10);
  expect(terrainOffset(1/128)*1000).toBeCloseTo(5,10);
  const t=new Terrain(),a=anchor(0,0),m=buildTerrainMesh(t,{anchor:a,imagery:null});
  expect(m.position.length/3).toBe(66049);
  const k=(128*257+256)*3,p=a.map((x,i)=>x+m.position[k+i]);
  expect(Math.acos(p[0]/Math.hypot(...p))*6371).toBeGreaterThan(590);
});

test('regional imagery feather rejects out-of-coverage coordinates continuously at all four edges',()=>{
  expect(regionalWeight(.5,.5)).toBe(1);
  for(const d of [-1,0,.00001,.04,.08,.5]) {
    const w=regionalWeight(d,.5);
    expect(w).toBeGreaterThanOrEqual(0);expect(w).toBeLessThanOrEqual(1);
    expect(regionalWeight(1-d,.5)).toBeCloseTo(w,9);
    expect(regionalWeight(.5,d)).toBeCloseTo(w,9);
    expect(regionalWeight(.5,1-d)).toBeCloseTo(w,9);
  }
  expect(regionalWeight(-1,.5)).toBe(0);
  expect(regionalWeight(.00001,.5)).toBeLessThan(.000001);
  expect(regionalWeight(.04,.5)).toBeCloseTo(.5,8);
});

test('geography interpolates through the dateline without sampling the opposite side of Earth',()=>{
  const t=new Terrain();
  for(const lon of [-180,-179.99,179.99,180]) {
    const mesh=buildTerrainMesh(t,{anchor:anchor(0,lon),imagery:null,segments:32});
    const longitudes=mesh.geography.filter((_,i)=>i%2===0);
    expect(Math.max(...longitudes)-Math.min(...longitudes)).toBeLessThan(11);
    for(let j=0;j<=32;j++)for(let i=0;i<32;i++)
      expect(Math.abs(longitudes[j*33+i+1]-longitudes[j*33+i])).toBeLessThan(3);
  }
});

test('terrain altitude handoff is bounded and continuous through the former cutoff',()=>{
  expect(terrainOpacity(0)).toBe(1);expect(terrainOpacity(50000)).toBe(1);
  expect(terrainOpacity(70000)).toBe(.5);expect(terrainOpacity(90000)).toBe(0);
  let previous=1;
  for(let altitude=0;altitude<=100000;altitude+=100) {
    const opacity=terrainOpacity(altitude);
    expect(opacity).toBeGreaterThanOrEqual(0);expect(opacity).toBeLessThanOrEqual(previous);
    expect(previous-opacity).toBeLessThan(.004);previous=opacity;
  }
});

test('approach recentering follows AGL rather than height above sea level',()=>{
  expect(terrainRecenterKm(0)).toBe(.08);
  expect(terrainRecenterKm(500)).toBe(.08);
  expect(terrainRecenterKm(3000)).toBe(.3);
  expect(terrainRecenterKm(20000)).toBe(1);
});
