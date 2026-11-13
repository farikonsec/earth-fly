import {terrainOffset} from './terrain-coverage';
import type {V} from './vector';
export interface TerrainSnapshot {anchor:V;segments:number;position:Float32Array;basePosition:Float32Array;generation?:number;}
function dot(a:V,b:V){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
function cross(a:V,b:V):V{return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
function normalized(a:V):V{const n=Math.hypot(...a);return a.map(v=>v/n) as V;}
/** Ray/triangle sampling of a rendered structured mesh, rather than its underlying DEM. */
export function renderedTerrainSampler(snapshot:TerrainSnapshot,positions=snapshot.position){
 const N=snapshot.segments,up=normalized(snapshot.anchor),east0=cross([0,1,0],up),east:V=Math.hypot(...east0)===0?[1,0,0]:normalized(east0),north=normalized(cross(up,east)),offsets=Array.from({length:N+1},(_,i)=>terrainOffset(i/N*2-1));
 const bracket=(x:number)=>{if(x<offsets[0]||x>offsets[N])return -1;let lo=0,hi=N;while(hi-lo>1){const mid=(lo+hi)>>1;if(offsets[mid]<=x)lo=mid;else hi=mid;}return lo;};
 return (direction:V)=>{
  const length=Math.hypot(...direction),dx=direction[0]/length,dy=direction[1]/length,dz=direction[2]/length,forward=dx*up[0]+dy*up[1]+dz*up[2];if(forward<=0)return null;
  const x=6371*(dx*east[0]+dy*east[1]+dz*east[2])/forward,y=6371*(dx*north[0]+dy*north[1]+dz*north[2])/forward,i=bracket(x),j=bracket(y);if(i<0||j<0)return null;
  const fx=(x-offsets[i])/(offsets[i+1]-offsets[i]),fy=(y-offsets[j])/(offsets[j+1]-offsets[j]),a=j*(N+1)+i,ids=fx+fy<=1?[a,a+1,a+N+1]:[a+1,a+N+2,a+N+1],
   ia=ids[0]*3,ib=ids[1]*3,ic=ids[2]*3,ax=snapshot.anchor[0]+positions[ia],ay=snapshot.anchor[1]+positions[ia+1],az=snapshot.anchor[2]+positions[ia+2],
   bx=positions[ib]-positions[ia],by=positions[ib+1]-positions[ia+1],bz=positions[ib+2]-positions[ia+2],cx=positions[ic]-positions[ia],cy=positions[ic+1]-positions[ia+1],cz=positions[ic+2]-positions[ia+2],nx=by*cz-bz*cy,ny=bz*cx-bx*cz,nz=bx*cy-by*cx,denominator=dx*nx+dy*ny+dz*nz;
  if(Math.abs(denominator)<1e-16)return null;const radius=(ax*nx+ay*ny+az*nz)/denominator;return Number.isFinite(radius)&&radius>0?radius:null;
 };
}
