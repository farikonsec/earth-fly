/** Offline reference coverage. Sources and hashes live in public/terrain/detail-manifest.json. */
import { SUMMITS, summitTiles } from './summits';
import {ALL_PEAKS,CASPIAN,DOMBAY} from './destinations';
const summitKeys=new Set([...ALL_PEAKS,CASPIAN].flatMap(s=>[9,11].flatMap(z=>summitTiles(s,z).map(t=>`${z}/${t.x}/${t.y}`))));
const remaKeys=new Set([9,11].flatMap(z=>summitTiles(SUMMITS.find(s=>s.id==='vinson')!,z).map(t=>`${z}/${t.x}/${t.y}`)));
const caucasusKeys=new Set([DOMBAY,SUMMITS.find(s=>s.id==='elbrus')!].flatMap(s=>summitTiles(s,11).map(t=>`11/${t.x}/${t.y}`)));
const opticalKeys=new Set([DOMBAY,SUMMITS.find(s=>s.id==='elbrus')!].flatMap(s=>[11,12].flatMap(z=>summitTiles(s,z).map(t=>`${z}/${t.x}/${t.y}`))));
export function opticalTerrain(z:number,x:number,y:number){return opticalKeys.has(`${z}/${x}/${y}`);}
export function terrainAssetFolder(z:number,x:number,y:number){const key=`${z}/${x}/${y}`;return remaKeys.has(key)?'rema/':opticalKeys.has(key)?'aw3d/':caucasusKeys.has(key)?'caucasus/':'';}
export function remaTerrain(z:number,x:number,y:number){return remaKeys.has(`${z}/${x}/${y}`);}
export function summitTerrain(z:number,x:number,y:number){return summitKeys.has(`${z}/${x}/${y}`);}
export const REFERENCE_DETAIL = { z: 11, minX: 1067, maxX: 1070, minY: 721, maxY: 725 };
export function bundledTerrain(z: number, x: number, y: number) {
  return (z === 9 && x >= 265 && x <= 270 && y >= 179 && y <= 184) ||
    (z === REFERENCE_DETAIL.z && x >= REFERENCE_DETAIL.minX && x <= REFERENCE_DETAIL.maxX &&
      y >= REFERENCE_DETAIL.minY && y <= REFERENCE_DETAIL.maxY) || summitTerrain(z,x,y)||opticalTerrain(z,x,y);
}
