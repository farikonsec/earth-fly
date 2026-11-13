/**
 * Tidal Thames, its creeks and the Docklands basins from OpenStreetMap (ODbL).
 * Source snapshots: work/london/water.json (Overpass, natural=water in 51.475,-0.17,51.535,0.01) and
 * work/london/thames-relations.json (relation(id:28934,70347,11511596);out geom;), the tideway multipolygons.
 * Writes public/scenery/london-water.json. Run: bun scripts/prepare-london-water.ts
 */
import {createHash} from 'node:crypto';
const bytes=await Bun.file('work/london/water.json').bytes(),osm=JSON.parse(new TextDecoder().decode(bytes));
const area=(r:number[][])=>{let a=0;for(let i=0,j=r.length-1;i<r.length;j=i++)a+=(r[j][0]-r[i][0])*(r[j][1]+r[i][1]);return Math.abs(a/2)*111195*111195*Math.cos(51.5*Math.PI/180);};
const features=[];
for(const e of osm.elements){
 if(e.type!=='way'||!e.geometry||e.geometry.length<4)continue;const g=e.geometry,t=e.tags??{};if(g[0].lat!==g.at(-1).lat||g[0].lon!==g.at(-1).lon)continue;
 const ring=g.map((p:any)=>[Number(p.lon.toFixed(6)),Number(p.lat.toFixed(6))]),size=area(ring),cx=ring.reduce((n:number,p:number[])=>n+p[0],0)/ring.length,cy=ring.reduce((n:number,p:number[])=>n+p[1],0)/ring.length;
 // Sea-level water only: the tideway, and the docks that open onto it. Park ponds and canals sit higher and stay as imagery.
 const tideway=t.tidal==='yes'||t.water==='river',dock=/^(basin|dock|harbour)$/.test(t.water??'')||/dock|basin/i.test(t.name??'')||(!t.water&&size>8000);
 if(!(tideway&&size>1500)&&!(dock&&size>6000&&cx>-.075&&cy<51.515))continue;
 features.push({id:'london/w'+e.id,kind:'water',name:t.name??(tideway?'River Thames':'Dock'),ring,elevation:0,water:t.water??'river'});
}
// Multipolygon relations: stitch outer member ways end to end into closed rings.
const relations=JSON.parse(new TextDecoder().decode(await Bun.file('work/london/thames-relations.json').bytes()));
for(const e of relations.elements){
 if(e.type!=='relation')continue;const t=e.tags??{};if(!(t.tidal==='yes'||t.water==='river'))continue;
 const ways=(e.members??[]).filter((m:any)=>m.type==='way'&&m.role!=='inner'&&m.geometry?.length>1).map((m:any)=>m.geometry.map((p:any)=>[Number(p.lon.toFixed(6)),Number(p.lat.toFixed(6))]));
 const same=(a:number[],b:number[])=>a[0]===b[0]&&a[1]===b[1];let part=0;
 while(ways.length){const ring=ways.shift()!;let grown=true;
  while(grown&&!same(ring[0],ring.at(-1)!)){grown=false;for(let i=0;i<ways.length;i++){const w=ways[i];
   if(same(w[0],ring.at(-1)!))ring.push(...w.slice(1));else if(same(w.at(-1)!,ring.at(-1)!))ring.push(...[...w].reverse().slice(1));else if(same(w.at(-1)!,ring[0]))ring.unshift(...w.slice(0,-1));else if(same(w[0],ring[0]))ring.unshift(...[...w].reverse().slice(0,-1));else continue;
   ways.splice(i,1);grown=true;break;}}
  if(same(ring[0],ring.at(-1)!)&&ring.length>3&&area(ring)>1500)features.push({id:`london/r${e.id}/${part++}`,kind:'water',name:t.name??'River Thames',ring,elevation:0,water:'river'});
  else console.log('open ring dropped',e.id,ring.length);}
}
const data={version:1,source:'OpenStreetMap natural=water, central London',license:'OpenStreetMap contributors, ODbL 1.0',osmTimestamp:osm.osm3s.timestamp_osm_base,sourceHash:createHash('sha256').update(bytes).digest('hex'),bounds:{west:-.17,south:51.475,east:.01,north:51.535},features};
await Bun.write('public/scenery/london-water.json',JSON.stringify(data));
console.log(features.length,'features',features.reduce((n,f)=>n+f.ring.length,0),'vertices',(JSON.stringify(data).length/1024).toFixed(0)+' KB',features.slice(0,6).map(f=>f.name));
