import {test,expect} from 'bun:test';
import {createHash} from 'node:crypto';
import {PNG} from 'pngjs';
import {SUMMITS,summitTiles,summitApproach} from '../src/summits';
import {Terrain,decodeTerrarium} from '../src/terrain';
import {bundledTerrain,terrainAssetFolder} from '../src/terrain-data';
import {buildTerrainTransition} from '../src/terrain-mesh';
import {latLonToDir} from '../src/geo';
import type {V} from '../src/vector';
async function load(s:typeof SUMMITS[number]){
 const t=new Terrain();t.global=new Float32Array(await Bun.file('public/terrain/global.f32').arrayBuffer());
 for(const z of [9,11])for(const tile of summitTiles(s,z)){
  const bytes=await Bun.file(`public/terrain/${terrainAssetFolder(z,tile.x,tile.y)}${z}/${tile.x}/${tile.y}.png`).arrayBuffer(),png=PNG.sync.read(Buffer.from(bytes)),data=new Float32Array(65536);
  for(let i=0;i<data.length;i++)data[i]=Math.max(0,decodeTerrarium(png.data[i*4],png.data[i*4+1],png.data[i*4+2]));
  t.tiles.set(`${z}/${tile.x}/${tile.y}`,{...tile,data,loaded:0});
 }
 return t;
}
test('Seven Summits list preserves both Oceania alternatives and sourced reference points',()=>{
 expect(SUMMITS.length).toBe(8);expect(SUMMITS.filter(s=>!s.alternate).length).toBe(7);expect(new Set(SUMMITS.map(s=>s.id)).size).toBe(8);
 for(const s of SUMMITS){
  expect(Math.abs(s.lat)).toBeLessThan(85);expect(Math.abs(s.lon)).toBeLessThan(180);
  expect(s.coordinateSource.startsWith('https://')).toBe(true);expect(s.heightSource.startsWith('https://')).toBe(true);
  const start=summitApproach(s);expect(start.lat).toBeLessThan(s.lat);expect(start.lon).toBe(s.lon);expect(start.altitudeMSL-s.elevation).toBeGreaterThanOrEqual(1000);
  for(const z of [9,11])for(const t of summitTiles(s,z))expect(bundledTerrain(z,t.x,t.y)).toBe(true);
 }
 expect(SUMMITS.find(s=>s.id==='everest')!.elevation).toBe(8848.86);
 expect(SUMMITS.find(s=>s.id==='aconcagua')!.elevation).toBe(6960.8);
});
test('offline summit and derived REMA assets match pinned hashes',async()=>{
 const manifest=await Bun.file('public/terrain/summits-manifest.json').json(),rema=await Bun.file('public/terrain/rema-manifest.json').json(),imagery=await Bun.file('public/imagery/summits-manifest.json').json();
 expect(manifest.files.length).toBe(216);expect(rema.files.length).toBe(18);
 expect(imagery.files.length).toBe(63);expect(imagery.date).toBe('2000-12-01');
 for(const f of [...manifest.files,...rema.files.map((f:{key:string;sha256:string;bytes:number})=>({...f,path:`terrain/rema/${f.key}.png`})),...imagery.files.map((f:{key:string;sha256:string;bytes:number})=>({...f,path:`imagery/summits/${f.key}`}))]){
  const bytes=new Uint8Array(await Bun.file(`public/${f.path}`).arrayBuffer());expect(bytes.length).toBe(f.bytes);expect(createHash('sha256').update(bytes).digest('hex')).toBe(f.sha256);
 }
 expect(rema.geoid.model).toBe('EGM96 15 arc-minute');expect(rema.summit.ellipsoidal-rema.summit.geoidUndulation).toBeCloseTo(rema.summit.orthometric,8);
 expect(rema.summit.orthometric).toBeGreaterThan(4870);expect(rema.summit.orthometric).toBeLessThan(4895);
});
test('all summit regions provide geographic relief with finite reference-height comparisons',async()=>{
 for(const s of SUMMITS){
  const t=await load(s),height=t.height(s.lat,s.lon),error=height-s.elevation;
  expect(Number.isFinite(height)).toBe(true);expect(Math.abs(error)).toBeLessThan(150);expect(height).toBeGreaterThan(2000);
  const values=[...t.tiles.values()].flatMap(tile=>[Math.min(...tile.data),Math.max(...tile.data)]);
  expect(Math.max(...values)-Math.min(...values)).toBeGreaterThan(100);
 }
});
test('Vinson corrected terrain flows through the same worker mesh height authority',async()=>{
 const s=SUMMITS.find(s=>s.id==='vinson')!,t=await load(s),height=t.height(s.lat,s.lon),anchor=latLonToDir(s.lat,s.lon).map(v=>v*6371) as V,
   mesh=buildTerrainTransition(t,{anchor,imagery:null,segments:16}),k=(8*17+8)*3,radial=Math.hypot(...anchor.map((v,i)=>v+mesh.position[k+i]));
 expect(height).toBeGreaterThan(4870);expect(height).toBeLessThan(4895);expect((radial-6371)*1000).toBeCloseTo(height,2);
 expect(t.height(s.lat-.05,s.lon)).toBeGreaterThan(2500);
});
