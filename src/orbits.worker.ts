/// <reference lib="webworker" />
import {json2satrec,orbitState,type OrbitalElement} from './orbit-math';
let rows:OrbitalElement[]=[],records:ReturnType<typeof json2satrec>[]=[];
self.onmessage=async(e:MessageEvent)=>{try{
 if(e.data.type==='load'){const r=await fetch(e.data.url);if(!r.ok)throw Error(`Catalog HTTP ${r.status}`);rows=await r.json();records=rows.map(s=>json2satrec(s));self.postMessage({type:'ready',rows});return;}
 const {utc,t}=e.data,values=new Float64Array(rows.length*7);values.fill(NaN);let valid=0;
 for(let i=0;i<records.length;i++){try{const s=orbitState(records[i],utc,t);if(s){values.set([...s.p,...s.v,s.speed],i*7);valid++;}}catch{ /* rejected or decayed object */ }}
 self.postMessage({type:'positions',utc,t,values,valid},[values.buffer]);
 }catch(error){self.postMessage({type:'error',message:String(error)});}};
