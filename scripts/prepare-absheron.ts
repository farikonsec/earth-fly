import {createHash} from 'node:crypto';
import {insideRing} from '../src/geodata';
const existing=await Bun.file('public/scenery/absheron-manifest.json').json().catch(()=>null),sourceHash=createHash('sha256').update(await Bun.file('public/scenery/absheron-osm-source.json').bytes()).digest('hex');
if(existing&&existing.sourceHash!==sourceHash)throw Error('Pinned OSM snapshot mismatch');
const base=await Bun.file('public/scenery/caspian.json').json(),osm=await Bun.file('public/scenery/absheron-osm-source.json').json(),ways=osm.elements.filter((e:any)=>e.nodes[0]!==e.nodes.at(-1));
const chains:{nodes:number[];geometry:{lon:number;lat:number}[]}[]=[];
while(ways.length){const a=ways.shift(),nodes=[...a.nodes],geometry=[...a.geometry];let changed=true;while(changed){changed=false;for(let i=0;i<ways.length;i++){const w=ways[i];if(w.nodes[0]===nodes.at(-1)){nodes.push(...w.nodes.slice(1));geometry.push(...w.geometry.slice(1));}else if(w.nodes.at(-1)===nodes[0]){nodes.unshift(...w.nodes.slice(0,-1));geometry.unshift(...w.geometry.slice(0,-1));}else continue;ways.splice(i,1);changed=true;break;}}chains.push({nodes,geometry});}
const chain=chains.sort((a,b)=>b.nodes.length-a.nodes.length)[0].geometry.map(p=>[p.lon,p.lat]);if(chain.length<1000)throw Error('Coastline incomplete');
const old=base.features[0],ring=old.ring.slice(0,-1),distance=(a:number[],b:number[])=>Math.hypot((a[0]-b[0])*.76,a[1]-b[1]),nearest=(p:number[])=>ring.reduce((best:number,q:number[],i:number)=>distance(p,q)<distance(p,ring[best])?i:best,0),a=nearest(chain[0]),b=nearest(chain.at(-1)!);
const rotate=(index:number)=>[...ring.slice(index),...ring.slice(0,index)],rot=rotate(a),bi=(b-a+ring.length)%ring.length;
const length=(r:number[][])=>r.slice(1).reduce((n,p,i)=>n+distance(p,r[i]),0),forward=length(rot.slice(0,bi+1))<length([...rot.slice(bi),rot[0]]);
const ordered=forward?chain:[...chain].reverse(),start=forward?a:b,end=forward?b:a,remaining=rotate(end),count=(start-end+ring.length)%ring.length;
if(distance(ordered[0],ring[start])>.12||distance(ordered.at(-1)!,ring[end])>.12)throw Error('Coast join too distant');
const merged=[...ordered,...remaining.slice(0,count+1),ordered[0]],holes=[...old.holes??[]];
for(const e of osm.elements){if(e.nodes[0]!==e.nodes.at(-1))continue;const island=e.geometry.map((p:any)=>[p.lon,p.lat]);if(insideRing(island[0][0],island[0][1],merged)&&!holes.some(r=>insideRing(island[0][0],island[0][1],r)))holes.push(island);}
const data={...base,source:'Natural Earth 1:10m Caspian with OpenStreetMap Absheron coast and islands',license:'Natural Earth public domain; OpenStreetMap contributors ODbL 1.0',osmTimestamp:osm.osm3s.timestamp_osm_base,osmQuery:'way["natural"="coastline"](40.1,49.6,40.65,50.65);out geom;',features:[{...old,id:'caspian/absheron-osm',ring:merged,holes}]};
await Bun.write('public/scenery/absheron.json',JSON.stringify(data));
await Bun.write('public/scenery/absheron-manifest.json',JSON.stringify({source:'https://www.openstreetmap.org/copyright',sourceSnapshot:'absheron-osm-source.json',sourceHash,derivedHash:createHash('sha256').update(JSON.stringify(data)).digest('hex'),coastVertices:chain.length,mergedVertices:merged.length,islands:holes.length,joinErrorKm:[distance(ordered[0],ring[start])*111.195,distance(ordered.at(-1)!,ring[end])*111.195],license:'ODbL 1.0 / Natural Earth public domain'},null,2));console.log({vertices:merged.length,holes:holes.length,forward});
