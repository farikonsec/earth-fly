import {test,expect} from 'bun:test';
import {createHash} from 'node:crypto';
import {PNG} from 'pngjs';
import {Terrain,mercator, type Tile} from '../src/terrain';
import {bundledTerrain} from '../src/terrain-data';
import {buildTerrainTransition} from '../src/terrain-mesh';
import {latLonToDir} from '../src/geo';
import type {V} from '../src/vector';
function tile(z:number,x:number,y:number,h:number):Tile{return {z,x,y,loaded:0,data:new Float32Array(65536).fill(h)};}
test('fine tile outer edge blends to its loaded parent rather than global relief',()=>{
  const t=new Terrain();t.global.fill(100);
  t.tiles.set('9/256/256',tile(9,256,256,1000));
  t.tiles.set('11/1025/1025',tile(11,1025,1025,2000));
  const lon=(1025+.00001)/2048*360-180,lat=Math.atan(Math.sinh(Math.PI*(1-2*(1025.5)/2048)))*180/Math.PI;
  expect(t.height(lat,lon)).toBeGreaterThan(990);
  expect(t.height(lat,lon)).toBeLessThan(1010);
  const centerLon=(1025.5)/2048*360-180;
  expect(t.height(lat,centerLon)).toBeCloseTo(2000,4);
});
test('mesh synchronization holds collision at old height until matching endpoints are ready',()=>{
  const t=new Terrain();t.global.fill(100);t.meshSync=true;
  t.staged.set('9/256/255',tile(9,256,255,1000));
  const generation=t.generation;
  t.advance(.1,.1,.1,10000);
  expect(t.generation).toBe(generation+1);expect(t.transitionReady).toBe(false);
  t.advance(2,.1,.1,10000);expect(t.blend).toBe(0);expect(t.height(.1,.1)).toBeCloseTo(100);
  t.transitionReady=true;t.advance(1.5,.1,.1,10000);
  expect(t.height(.1,.1)).toBeCloseTo(550);expect(t.generation).toBe(generation+1);
  t.advance(1.5,.1,.1,10000);expect(t.height(.1,.1)).toBeCloseTo(1000);
});
test('GPU endpoint interpolation matches collision height throughout an elevation blend',()=>{
  const t=new Terrain();t.global.fill(100);
  t.staged.set('9/256/255',tile(9,256,255,1000));t.applyStaged(false);t.blend=.37;
  const anchor=latLonToDir(.1,.1).map(x=>x*6371) as V,
    mesh=buildTerrainTransition(t,{anchor,imagery:null,segments:16}),k=(8*17+8)*3;
  expect(t.blend).toBe(.37);
  for(const blend of [0,.1,.25,.5,.75,1]) {
    t.blend=blend;const w=blend*blend*(3-2*blend),p=anchor.map((a,i)=>a+mesh.basePosition[k+i]+(mesh.position[k+i]-mesh.basePosition[k+i])*w);
    expect((Math.hypot(...p)-6371)*1000).toBeCloseTo(t.height(.1,.1),2);
  }
});
test('explicit placement releases a waiting elevation transition',()=>{
  const t=new Terrain();t.meshSync=true;t.staged.set('9/256/255',tile(9,256,255,1000));
  t.applyStaged(false);expect(t.transitionReady).toBe(false);
  t.applyStaged();expect(t.transitionReady).toBe(true);expect(t.previous).toBeNull();expect(t.blend).toBe(1);
});
test('all offline detail tiles match their pinned source manifest and contain geographic relief',async()=>{
  const manifest=await Bun.file('public/terrain/detail-manifest.json').json();expect(manifest.files.length).toBe(20);
  for(const file of manifest.files) {
    const bytes=await Bun.file(`public/terrain/${file.key}.png`).arrayBuffer(),[z,x,y]=file.key.split('/').map(Number);
    expect(createHash('sha256').update(new Uint8Array(bytes)).digest('hex')).toBe(file.sha256);
    expect(bundledTerrain(z,x,y)).toBe(true);
    const png=PNG.sync.read(Buffer.from(bytes));expect(png.width).toBe(256);expect(png.height).toBe(256);
  }
  const p=mercator(46.565,7.835,11),x=Math.floor(p.x),y=Math.floor(p.y),png=PNG.sync.read(Buffer.from(await Bun.file(`public/terrain/11/${x}/${y}.png`).arrayBuffer()));
  const heights=Array.from({length:65536},(_,i)=>png.data[i*4]*256+png.data[i*4+1]+png.data[i*4+2]/256-32768);
  expect(Math.max(...heights)-Math.min(...heights)).toBeGreaterThan(500);
});
