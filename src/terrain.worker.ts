import { Terrain, type Tile, type TerrainGrade, type LocalDem, type TerrainCut, type Crater } from './terrain';
import { GeoIndex, type Feature } from './geodata';
import { buildTerrainTransition, type MeshRequest } from './terrain-mesh';
import type {TerrainSnapshot} from './terrain-reprojection';
export interface TerrainJob {
  id: number; epoch: number; request: MeshRequest;
  global?: Float32Array;polarNorth?:Float32Array|null;polarSouth?:Float32Array|null; water?: Feature[];
  added: [number,Tile][]; current: [string,number][];
  previous: [string,number][] | null; blend: number; grade?: TerrainGrade|null; dem?: LocalDem|null; cuts?: TerrainCut[]|null; craters?: Crater[]|null;
}
const surface=new Terrain(), tiles=new Map<number,Tile>();
const snapshots=new Map<number,TerrainSnapshot>();
self.onmessage=(event: MessageEvent<TerrainJob>)=>{
  const job=event.data;
  try {
    if(job.global)surface.global=job.global;
    if(job.polarNorth)surface.polarNorth=job.polarNorth;if(job.polarSouth)surface.polarSouth=job.polarSouth;
    if(job.grade!==undefined)surface.grade=job.grade;
    if(job.dem!==undefined)surface.dem=job.dem;
    if(job.cuts!==undefined)surface.cuts=job.cuts;if(job.craters!==undefined)surface.craters=job.craters;
    if(job.water) {
      const index=new GeoIndex(job.water);
      surface.waterLevel=(lat,lon)=>index.at(lat,lon,'water')?.elevation ?? null;
    }
    for(const [id,tile] of job.added) tiles.set(id,tile);
    const restore=(entries:[string,number][])=>new Map(entries.map(([key,id])=>[key,tiles.get(id)!]));
    surface.tiles=restore(job.current);
    surface.previous=job.previous ? restore(job.previous):null;
    surface.blend=job.blend;
    const keep=new Set([...job.current,...(job.previous??[])].map(([,id])=>id));
    for(const id of tiles.keys())if(!keep.has(id))tiles.delete(id);
    const mesh=buildTerrainTransition(surface,job.request,job.request.recenterFrom?snapshots.get(job.request.recenterFrom):undefined);
    const position=mesh.position.slice(),basePosition=mesh.basePosition===mesh.position?position:mesh.basePosition.slice();
    snapshots.set(job.id,{anchor:job.request.anchor,segments:job.request.segments??256,generation:job.request.generation,position,basePosition});
    for(const id of snapshots.keys())if(id!==job.id&&id!==job.request.recenterFrom)snapshots.delete(id);
    const retainedBytes=[...snapshots.values()].reduce((n,s)=>n+s.position.byteLength+(s.position===s.basePosition?0:s.basePosition.byteLength),0);
    self.postMessage({id:job.id,epoch:job.epoch,request:job.request,mesh,retainedMeshes:snapshots.size,retainedBytes},
      {transfer:[...new Set([mesh.position.buffer,mesh.uv.buffer,mesh.color.buffer,mesh.geography.buffer,mesh.water.buffer,mesh.index.buffer,mesh.normal.buffer,mesh.basePosition.buffer,mesh.baseNormal.buffer,mesh.baseColor.buffer,mesh.recenterHeight.buffer,mesh.recenterNormal.buffer,mesh.recenterBaseNormal.buffer])]});
  } catch(error) { self.postMessage({id:job.id,epoch:job.epoch,error:String(error)}); }
};
