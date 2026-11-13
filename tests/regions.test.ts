import {test,expect} from 'bun:test';
import {createHash} from 'node:crypto';
import {DOMBAY,CASPIAN,ALL_PEAKS} from '../src/destinations';
import {SUMMITS,summitTiles} from '../src/summits';
import {GeoIndex} from '../src/geodata';
import {Terrain} from '../src/terrain';
import {bundledTerrain,terrainAssetFolder} from '../src/terrain-data';
import {buildTerrainMesh} from '../src/terrain-mesh';
import {latLonToDir} from '../src/geo';
import type {V} from '../src/vector';
test('Caucasus destination extends the catalog without changing the Seven Summits list',()=>{
 expect(SUMMITS.length).toBe(8);expect(ALL_PEAKS.length).toBe(9);expect(ALL_PEAKS.some(s=>s.id==='elbrus')).toBe(true);expect(DOMBAY.elevation).toBe(4046);
 for(const s of [DOMBAY,CASPIAN])for(const z of [9,11])for(const t of summitTiles(s,z))expect(bundledTerrain(z,t.x,t.y)).toBe(true);
});
test('all regional terrain, imagery and shoreline assets match pinned hashes',async()=>{
 const manifest=await Bun.file('public/terrain/regions-manifest.json').json(),dem=await Bun.file('public/terrain/caucasus-manifest.json').json();expect(manifest.files.length).toBe(73);expect(dem.files.length).toBe(18);expect(dem.datum).toBe('EGM2008 orthometric');
 for(const f of [...manifest.files,...dem.files.map((f:{key:string;bytes:number;sha256:string})=>({...f,path:`terrain/caucasus/${f.key}.png`}))]){const bytes=new Uint8Array(await Bun.file(`public/${f.path}`).arrayBuffer());expect(bytes.length).toBe(f.bytes);expect(createHash('sha256').update(bytes).digest('hex')).toBe(f.sha256);}
 for(const t of summitTiles(DOMBAY,11))expect(terrainAssetFolder(11,t.x,t.y)).toBe('aw3d/');
});
test('large inland-water polygons remain indexed without building unbounded fine cells',async()=>{
 const data=await Bun.file('public/scenery/caspian.json').json(),index=new GeoIndex(data.features);
 expect(index.broad.length).toBe(1);expect(index.cells.size).toBe(0);expect(index.at(CASPIAN.lat,CASPIAN.lon,'water')!.elevation).toBe(-28);expect(index.at(43,41,'water')).toBeUndefined();
});
test('Caspian water uses the same negative MSL height in collision and curved terrain geometry',async()=>{
 const data=await Bun.file('public/scenery/caspian.json').json(),index=new GeoIndex(data.features),t=new Terrain();t.waterLevel=(lat,lon)=>index.at(lat,lon,'water')?.elevation??null;
 expect(t.height(CASPIAN.lat,CASPIAN.lon)).toBe(-28);
 const anchor=latLonToDir(CASPIAN.lat,CASPIAN.lon).map(v=>v*6371) as V,m=buildTerrainMesh(t,{anchor,imagery:null,segments:16}),k=(8*17+8)*3;
 expect((Math.hypot(...anchor.map((v,i)=>v+m.position[k+i]))-6371)*1000).toBeCloseTo(-28,3);expect(m.water[8*17+8]).toBe(1);expect([...m.normal].every(Number.isFinite)).toBe(true);
});
