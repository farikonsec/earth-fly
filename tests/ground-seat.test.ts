import {expect,test} from 'bun:test';import * as T from 'three';
import {buildTerrainMesh} from '../src/terrain-mesh';import {meshHeight} from '../src/terrain-sample';import {latLonToDir} from '../src/geo';import type {Terrain} from '../src/terrain';import type {V} from '../src/vector';
test('the drawn-mesh height is recovered at any point, and differs from the exact height on rough ground far out',()=>{
 // Rolling hills: 60 m swells every ~1.5 km.
 const hills=(lat:number,lon:number)=>200+60*Math.sin(lat*420)*Math.cos(lon*260);
 const surface={height:hills,waterLevel:null} as unknown as Terrain,anchor=new T.Vector3(...latLonToDir(50.85,11.7)).multiplyScalar(6371);
 const mesh=buildTerrainMesh(surface,{anchor:anchor.toArray() as V,imagery:null,segments:128}),g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(mesh.position,3));
 // Close to the anchor the mesh is dense and matches; several km out its facets cut through the hills.
 const near=meshHeight(g,anchor,128,1,50.8505,11.7004)!;expect(Math.abs(near-hills(50.8505,11.7004))).toBeLessThan(1.5);
 let worst=0;for(let k=0;k<40;k++){const la=50.85+.03*Math.sin(k),lo=11.7+.045*Math.cos(k*1.7),h=meshHeight(g,anchor,128,1,la,lo);if(h!==null)worst=Math.max(worst,Math.abs(h-hills(la,lo)));}
 expect(worst).toBeGreaterThan(5);
 // At grid vertices the sampler reproduces the mesh exactly.
 const k=64*129+90,p=new T.Vector3(mesh.position[k*3],mesh.position[k*3+1],mesh.position[k*3+2]).add(anchor),lat=Math.asin(p.y/p.length())*180/Math.PI,lon=Math.atan2(-p.z,p.x)*180/Math.PI;
 expect(Math.abs(meshHeight(g,anchor,128,1,lat,lon)!-(p.length()-6371)*1000)).toBeLessThan(.05);});
