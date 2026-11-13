import type {Terrain} from './terrain';
import type {Summit} from './summits';
export interface TerrainCrest{lat:number;lon:number;elevation:number;offsetMetres:number;searchRadiusMetres:number;}
/** A sampled model maximum near a catalog point, never a replacement surveyed coordinate. */
export function findTerrainCrest(surface:Pick<Terrain,'height'>,reference:Pick<Summit,'lat'|'lon'>):TerrainCrest{
 const radius=1000,metresLat=111195,metresLon=metresLat*Math.cos(reference.lat*Math.PI/180);
 let best={east:0,north:0,height:surface.height(reference.lat,reference.lon)};
 const sample=(east:number,north:number)=>{if(Math.hypot(east,north)>radius)return;const height=surface.height(reference.lat+north/metresLat,reference.lon+east/metresLon);if(Number.isFinite(height)&&height>best.height)best={east,north,height};};
 for(let north=-radius;north<=radius;north+=25)for(let east=-radius;east<=radius;east+=25)sample(east,north);
 const coarse={...best};for(let north=coarse.north-25;north<=coarse.north+25;north+=2.5)for(let east=coarse.east-25;east<=coarse.east+25;east+=2.5)sample(east,north);
 return {lat:reference.lat+best.north/metresLat,lon:reference.lon+best.east/metresLon,elevation:best.height,offsetMetres:Math.hypot(best.east,best.north),searchRadiusMetres:radius};
}
