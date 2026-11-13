import {test,expect} from 'bun:test';
import {PNG} from 'pngjs';
import {createHash} from 'node:crypto';
import {Terrain,decodeTerrarium,mercator} from '../src/terrain';
import {findTerrainCrest} from '../src/terrain-crest';
import {ALL_PEAKS} from '../src/destinations';
import {summitTiles} from '../src/summits';
import {terrainAssetFolder,opticalTerrain} from '../src/terrain-data';
import {latLonToDir} from '../src/geo';
import {buildTerrainTransition} from '../src/terrain-mesh';
import {renderedTerrainSampler} from '../src/terrain-reprojection';
import type {V} from '../src/vector';
test('zoom-12 detail blends at its missing outer neighbours into the loaded zoom-11 parent',()=>{
 const t=new Terrain();t.global.fill(100);
 for(const z of [11,12]){const m=mercator(43,42,z),x=Math.floor(m.x),y=Math.floor(m.y);t.tiles.set(`${z}/${x}/${y}`,{z,x,y,loaded:0,data:new Float32Array(65536).fill(z===12?3000:2000)});}
 const m=mercator(43,42,12),x=Math.floor(m.x),y=Math.floor(m.y),lat=Math.atan(Math.sinh(Math.PI*(1-2*(y+.5)/4096)))*180/Math.PI,center=(x+.5)/4096*360-180,edge=(x+.000001)/4096*360-180;
 expect(t.height(lat,center)).toBeCloseTo(3000,4);expect(t.height(lat,edge)).toBeGreaterThan(1999);expect(t.height(lat,edge)).toBeLessThan(2001);
});
test('modeled crest search remains within its geographic radius and refines a nearby peak',()=>{
 const reference={lat:43,lon:42},m=111195,c=Math.cos(43*Math.PI/180),height=(lat:number,lon:number)=>{const e=(lon-42)*m*c,n=(lat-43)*m;return 5000-Math.hypot(e-137.5,n+212.5);},crest=findTerrainCrest({height},reference);
 expect(crest.elevation).toBeCloseTo(5000,5);expect(crest.offsetMetres).toBeCloseTo(Math.hypot(137.5,212.5),4);expect(crest.searchRadiusMetres).toBe(1000);
 const outside=findTerrainCrest({height:(lat,lon)=>height(lat,lon)+((lat-43)*m>1100?100000:0)},reference);expect(outside.elevation).toBe(crest.elevation);
 const flat=findTerrainCrest({height:()=>100},reference);expect(flat.lat).toBe(reference.lat);expect(flat.lon).toBe(reference.lon);
});
test('optical Caucasus bundle preserves pinned assets, datum and source-quality provenance',async()=>{
 const manifest=await Bun.file('public/terrain/aw3d-manifest.json').json();expect(manifest.files.length).toBe(36);expect(manifest.datum).toBe('EGM96 orthometric');
 for(const f of manifest.files){const bytes=new Uint8Array(await Bun.file(`public/terrain/aw3d/${f.key}.png`).arrayBuffer());expect(bytes.length).toBe(f.bytes);expect(createHash('sha256').update(bytes).digest('hex')).toBe(f.sha256);expect(f.missing).toBe(0);}
 for(const r of manifest.regions){expect(r.sourceCrestWithin1000m.mask).toBe(0);expect(r.crestOffsetMetres).toBeLessThan(1000);expect(r.sourceAssets.every((a:{maskURL:string;itemURL:string})=>a.maskURL.endsWith('MSK.tiff')&&a.itemURL.endsWith('.json'))).toBe(true);}
});
test('finer Caucasus height authority reaches the worker and improves nearby measured crests without replacing references',async()=>{
 for(const id of ['dombay','elbrus']){
  const s=ALL_PEAKS.find(s=>s.id===id)!,t=new Terrain();t.global=new Float32Array(await Bun.file('public/terrain/global.f32').arrayBuffer());
  for(const z of [9,11,12])for(const tile of summitTiles(s,z)){
   const png=PNG.sync.read(Buffer.from(await Bun.file(`public/terrain/${terrainAssetFolder(z,tile.x,tile.y)}${z}/${tile.x}/${tile.y}.png`).arrayBuffer())),data=new Float32Array(65536);
   for(let i=0;i<data.length;i++)data[i]=decodeTerrarium(png.data[i*4],png.data[i*4+1],png.data[i*4+2]);t.tiles.set(`${z}/${tile.x}/${tile.y}`,{...tile,data,loaded:0});
   if(z===12)expect(opticalTerrain(z,tile.x,tile.y)).toBe(true);
  }
  const crest=findTerrainCrest(t,s),referenceHeight=t.height(s.lat,s.lon),anchor=latLonToDir(crest.lat,crest.lon).map(v=>v*6371) as V,mesh=buildTerrainTransition(t,{anchor,imagery:null,segments:16}),k=(8*17+8)*3;
  expect(crest.elevation).toBeGreaterThan(id==='dombay'?3950:5625);expect(crest.elevation).toBeLessThan(s.elevation);expect(crest.offsetMetres).toBeGreaterThan(100);expect(s.elevation-referenceHeight).toBeGreaterThan(50);
  expect((Math.hypot(...anchor.map((v,i)=>v+mesh.position[k+i]))-6371)*1000).toBeCloseTo(crest.elevation,2);expect(t.describe(crest.lat,crest.lon)).toContain('optical');
  const dense=buildTerrainTransition(t,{anchor,imagery:null}),sample=renderedTerrainSampler({anchor,segments:256,position:dense.position,basePosition:dense.basePosition});
  for(let north=-239.3;north<250;north+=37.3)for(let east=-244.1;east<250;east+=33.7){
   if(Math.hypot(east,north)>250)continue;const lat=crest.lat+north/111195,lon=crest.lon+east/(111195*Math.cos(crest.lat*Math.PI/180)),height=(sample(latLonToDir(lat,lon))!-6371)*1000;
   expect(Math.abs(height-t.height(lat,lon))).toBeLessThan(2.5);
  }
 }
});
