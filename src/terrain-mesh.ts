import * as T from 'three';
import { Terrain, mercator } from './terrain';
import { dirToLatLon } from './geo';
import type { V } from './vector';
import { terrainOffset } from './terrain-coverage';
import {renderedTerrainSampler,type TerrainSnapshot} from './terrain-reprojection';
export interface MeshRequest {
  anchor: V;
  imagery: { x: number; y: number; z: number } | null;
  segments?: number;
  generation?: number;
  recenterFrom?:number;
}
/** Runs in a worker; uses the same height authority as flight collision. */
export function buildTerrainMesh(surface: Terrain, request: MeshRequest) {
  const started = performance.now(), N = request.segments ?? 256,
    anchor = new T.Vector3(...request.anchor),
    east = new T.Vector3(0,1,0).cross(anchor).normalize();
  if (east.lengthSq() < .1) east.set(1,0,0);
  const north = anchor.clone().normalize().cross(east).normalize(),
    count = (N+1)**2, position = new Float32Array(count*3),
    uv = new Float32Array(count*2), color = new Float32Array(count*3),
    geography = new Float32Array(count*2), water = new Float32Array(count), index = new Uint32Array(N*N*6),
    centerU = .5 + dirToLatLon(request.anchor).lon/360;
  for (let j=0;j<=N;j++) for(let i=0;i<=N;i++) {
    const p = anchor.clone()
      .addScaledVector(east, terrainOffset(i/N*2-1))
      .addScaledVector(north, terrainOffset(j/N*2-1))
      .normalize().multiplyScalar(6371), k=j*(N+1)+i,
      loc=dirToLatLon(p.toArray() as V), elevation=surface.height(loc.lat,loc.lon),
      fade=T.MathUtils.smoothstep(Math.min(i,j,N-i,N-j)/N,0,.08);
    p.multiplyScalar((6371+elevation*.001*fade)/6371).sub(anchor);
    position.set(p.toArray(),k*3);
    const snow=T.MathUtils.smoothstep(elevation,2600,3600);
    color.set([1+.8*snow,1+.9*snow,1+1.1*snow],k*3);
    water[k]=surface.waterLevel?.(loc.lat,loc.lon)==null?0:1;
    let u=.5+loc.lon/360;
    if(u-centerU>.5)u-=1;
    if(u-centerU<-.5)u+=1;
    // Interpolate continuously across the dateline; the global texture repeats in longitude.
    geography.set([(u-.5)*360,loc.lat],k*2);
    const origin=request.imagery;
    if(origin) {
      const m=mercator(loc.lat,loc.lon,origin.z), n=2**origin.z;
      let dx=m.x-origin.x;
      if(dx>n/2)dx-=n;
      if(dx<-n/2)dx+=n;
      uv.set([dx/3,1-(m.y-origin.y)/3],k*2);
    } else uv.set([u,.5+loc.lat/180],k*2);
    if(i<N && j<N) {
      const a=k,b=a+1,c=a+N+1,d=c+1;
      index.set([a,b,c,b,d,c],(j*N+i)*6);
    }
  }
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.BufferAttribute(position,3));
  geometry.setIndex(new T.BufferAttribute(index,1));
  geometry.computeVertexNormals();
  const normal=geometry.attributes.normal.array as Float32Array;
  geometry.dispose();
  return { position,uv,color,geography,water,index,normal, milliseconds:performance.now()-started };
}
export type TerrainMesh = ReturnType<typeof buildTerrainMesh>;

function normals(position:Float32Array,index:Uint32Array){const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(position,3));g.setIndex(new T.BufferAttribute(index,1));g.computeVertexNormals();const normal=g.attributes.normal.array as Float32Array;g.dispose();return normal;}

/** Both elevation endpoints share the same grid, so the GPU and collision use the same blend. */
export function buildTerrainTransition(surface: Terrain, request: MeshRequest,previous?:TerrainSnapshot) {
  const started = performance.now(), blend = surface.blend;
  try {
    surface.blend = 1;
    const target = buildTerrainMesh(surface, request);
    surface.blend = 0;
    const base = surface.previous ? buildTerrainMesh(surface, request) : target;
    const recenterHeight=new Float32Array(target.position.length/3*2);
    let recenterNormal=target.normal,recenterBaseNormal=base.normal,recentered=false;
    if(previous&&previous.generation===request.generation&&Math.hypot(...request.anchor.map((v,i)=>v-previous.anchor[i]))<2){
      const sampleTarget=renderedTerrainSampler(previous),sameOld=previous.basePosition===previous.position,sameNew=base.position===target.position,
        sampleBase=sameOld?sampleTarget:renderedTerrainSampler(previous,previous.basePosition),targetPositions=target.position.slice(),basePositions=sameNew?targetPositions:base.position.slice();
      let covered=0;
      for(let k=0;k<target.position.length/3;k++){
        const x=request.anchor[0]+target.position[k*3],y=request.anchor[1]+target.position[k*3+1],z=request.anchor[2]+target.position[k*3+2],radius=Math.hypot(x,y,z),direction:V=[x/radius,y/radius,z/radius],
          baseRadius=sameNew?radius:Math.hypot(request.anchor[0]+base.position[k*3],request.anchor[1]+base.position[k*3+1],request.anchor[2]+base.position[k*3+2]),oldTarget=sampleTarget(direction),oldBase=sameOld?oldTarget:sampleBase(direction);
        if(oldTarget===null||oldBase===null)continue;covered++;
        // Keep the new surface where the previous patch has no triangle coverage.
        const deltaTarget=oldTarget-radius,deltaBase=oldBase-baseRadius;
        recenterHeight[k*2]=deltaBase;recenterHeight[k*2+1]=deltaTarget;
        for(let i=0;i<3;i++){targetPositions[k*3+i]+=direction[i]*deltaTarget;if(!sameNew)basePositions[k*3+i]+=direction[i]*deltaBase;}
      }
      if(covered){recenterNormal=normals(targetPositions,target.index);recenterBaseNormal=base.position===target.position?recenterNormal:normals(basePositions,target.index);recentered=true;}
    }
    return { ...target, basePosition: base.position, baseNormal: base.normal, baseColor: base.color,
      recenterHeight,recenterNormal,recenterBaseNormal,recentered,milliseconds: performance.now() - started };
  } finally { surface.blend = blend; }
}
export type TerrainTransition = ReturnType<typeof buildTerrainTransition>;
