import type { Terrain, Tile } from './terrain';
import type { Feature } from './geodata';
import type { MeshRequest, TerrainTransition } from './terrain-mesh';
import type { TerrainJob } from './terrain.worker';
/** One in-flight build, incremental tile copies, and reset epochs bound memory and reject stale jobs. */
export class TerrainBuilder {
  private worker: Worker;
  private ids=new WeakMap<Tile,number>();
  private sent=new Set<number>();
  private sequence=0;
  private tileSequence=0;
  private epoch=0;
  private initialized=false;
  busy=false;
  completed=0;
  discarded=0;
  milliseconds=0;
  error='';
  accepted=0;
  retainedMeshes=0;
  retainedBytes=0;
  constructor(private accept:(mesh:TerrainTransition,request:MeshRequest)=>boolean) {
    this.worker=new Worker(new URL('./terrain.worker.ts',import.meta.url),{type:'module'});
    this.worker.onmessage=({data})=>{
      this.busy=false;
      if(data.error) { this.error=data.error; return; }
      if(data.epoch!==this.epoch) { this.discarded++;return; }
      this.milliseconds=data.mesh.milliseconds;
      this.retainedMeshes=data.retainedMeshes;this.retainedBytes=data.retainedBytes;
      this.completed++;
      if(this.accept(data.mesh,data.request))this.accepted=data.id;
    };
    this.worker.onerror=(event)=>{this.error=event.message;this.busy=false;};
  }
  private sentGrade:Terrain['grade']=null;private sentDem:Terrain['dem']=null;private sentCuts:Terrain['cuts']=null;private sentCraters:Terrain['craters']=null;
  invalidate(){this.epoch++;this.accepted=0;}
  build(surface:Terrain,water:Feature[],request:MeshRequest) {
    if(this.busy || this.error)return false;
    const added:[number,Tile][]=[], keep=new Set<number>();
    const entries=(map:Map<string,Tile>)=>Array.from(map,([key,tile]):[string,number]=>{
      let id=this.ids.get(tile);
      if(id===undefined){id=++this.tileSequence;this.ids.set(tile,id);}
      keep.add(id);
      if(!this.sent.has(id) && !added.some(([existing])=>existing===id))added.push([id,tile]);
      return [key,id];
    });
    const job:TerrainJob={id:++this.sequence,epoch:this.epoch,request,
      current:entries(surface.tiles),previous:surface.previous?entries(surface.previous):null,
      blend:surface.blend,added};
    if(!this.initialized){job.global=surface.global;job.polarNorth=surface.polarNorth;job.polarSouth=surface.polarSouth;job.water=water.filter(f=>f.kind==='water');}
    if(surface.grade!==this.sentGrade){job.grade=surface.grade;this.sentGrade=surface.grade;}
    if(surface.dem!==this.sentDem){job.dem=surface.dem;this.sentDem=surface.dem;}
    if(surface.cuts!==this.sentCuts){job.cuts=surface.cuts;this.sentCuts=surface.cuts;}
    if(surface.craters!==this.sentCraters){job.craters=surface.craters;this.sentCraters=surface.craters;}
    this.busy=true;
    try {this.worker.postMessage(job);this.sent=keep;this.initialized=true;return true;}
    catch(error){this.error=String(error);this.busy=false;return false;}
  }
}
