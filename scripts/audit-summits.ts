import {PNG} from 'pngjs';
import {Terrain,decodeTerrarium} from '../src/terrain';
import {SUMMITS,summitTiles} from '../src/summits';
import {terrainAssetFolder,opticalTerrain} from '../src/terrain-data';
import {ALL_PEAKS} from '../src/destinations';
import {findTerrainCrest} from '../src/terrain-crest';
const results=[];
for(const s of ALL_PEAKS){
 const t=new Terrain();t.global=new Float32Array(await Bun.file('public/terrain/global.f32').arrayBuffer());
 for(const z of [9,11,12])for(const tile of summitTiles(s,z)){
  if(z===12&&!opticalTerrain(z,tile.x,tile.y))continue;
  const png=PNG.sync.read(Buffer.from(await Bun.file(`public/terrain/${terrainAssetFolder(z,tile.x,tile.y)}${z}/${tile.x}/${tile.y}.png`).arrayBuffer())),data=new Float32Array(65536);
  for(let i=0;i<65536;i++)data[i]=Math.max(0,decodeTerrarium(png.data[i*4],png.data[i*4+1],png.data[i*4+2]));
  t.tiles.set(`${z}/${tile.x}/${tile.y}`,{...tile,data,loaded:0});
 }
 const model=t.height(s.lat,s.lon),fine=s.id==='elbrus'||s.id==='dombay',spacing=40075016.686*Math.cos(s.lat*Math.PI/180)/(2**(fine?12:11)*256),crest=findTerrainCrest(t,s);
 results.push({...s,terrainAtReferenceMetres:model,terrainMinusReferenceMetres:model-s.elevation,modeledCrest:crest,crestMinusPublishedHeightMetres:crest.elevation-s.elevation,tilePixelSpacingMetres:spacing,terrainSource:s.id==='vinson'?'REMA v2.0 32m → EGM96 orthometric, resampled':fine?'JAXA AW3D30 / EGM96 orthometric, resampled':'Mapzen / Tilezen, source resolution varies',imagery:s.id==='vinson'?{source:'NASA Blue Marble',detail:'coarse regional imagery'}:{source:'NASA Landsat WELD v3.1',epoch:'2000-12-01',nominalSourceResolutionMetres:30},photorealistic:false});
 console.log(`${s.name}: reference ${s.elevation.toFixed(1)} m; terrain ${model.toFixed(1)} m; delta ${(model-s.elevation).toFixed(1)} m; grid ${spacing.toFixed(1)} m/px`);
}
await Bun.write('public/terrain/summits-audit.json',JSON.stringify({checked:'2026-10-18',note:'Reference points are approximate WGS84. Tile sampling density is not source accuracy. Height discrepancies are not corrected by artificial peaks. Imagery is historic/regional, not close-range photogrammetry; Vinson imagery remains coarse.',summits:results},null,2)+'\n');
