import {readTile} from '../src/mvt';
const meta=await(await fetch('https://tiles.openfreemap.org/planet')).json();const out=[];
for(let x=8183;x<=8186;x++)for(let y=5448;y<=5451;y++){
 const r=await fetch(meta.tiles[0].replace('{z}','14').replace('{x}',String(x)).replace('{y}',String(y)));if(!r.ok)throw Error('Tile '+r.status);const all=readTile(await r.arrayBuffer(),['transportation','poi']);
 const layers=Object.fromEntries(Object.entries(all).map(([name,l])=>[name,{extent:l.extent,features:l.features.filter(f=>name==='transportation'||f.properties.class==='railway').map(f=>({type:f.type,properties:Object.fromEntries(Object.entries(f.properties).filter(([k])=>['class','subclass','layer','brunnel','oneway','access','service','network','name'].includes(k))),rings:f.rings.map(a=>Array.from(a))}))}]));out.push({x,y,layers});
}
await Bun.write('public/traffic/london-network.json',JSON.stringify({source:'OpenStreetMap contributors / OpenMapTiles / OpenFreeMap',retrieved:new Date().toISOString(),zoom:14,tiles:out}));console.log(out.length,'cached central London transport tiles');
