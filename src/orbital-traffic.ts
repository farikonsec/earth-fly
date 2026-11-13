import * as T from 'three';
import {json2satrec,orbitState,elementTime,type OrbitalElement} from './orbit-math';
import type {RadarContact} from './contacts';
import type {Drone} from './combat';
import {lineOfSight} from './contacts';
export function satelliteModel(iss=false){
 const g=new T.Group(),metal=new T.MeshStandardMaterial({color:0xd3d4c8,metalness:.75,roughness:.35}),panel=new T.MeshStandardMaterial({color:0x203969,metalness:.6,roughness:.3,side:T.DoubleSide}),gold=new T.MeshStandardMaterial({color:0xb89c42,metalness:.75,roughness:.4});
 const add=(geo:T.BufferGeometry,m:T.Material,x=0,y=0,z=0)=>{const o=new T.Mesh(geo,m);o.position.set(x,y,z);g.add(o);};
 if(iss){add(new T.BoxGeometry(.095,.002,.003),metal);for(let i=-2;i<=2;i++){add(new T.CylinderGeometry(.002,.002,.015,10).rotateX(Math.PI/2),metal,i*.006,0,0);}for(const side of [-1,1])for(let i=0;i<4;i++){const x=side*(.016+i*.01);add(new T.BoxGeometry(.008,.00015,.032),panel,x,0,.022);add(new T.BoxGeometry(.008,.00015,.032),panel,x,0,-.022);}}
 else{add(new T.BoxGeometry(.003,.003,.004),gold);for(const side of [-1,1])add(new T.BoxGeometry(.012,.0001,.005),panel,side*.008);add(new T.ConeGeometry(.002,.001,12),metal,0,.002);}
 return g;
}
export class OrbitalTraffic{
 rows:OrbitalElement[]=[];contacts:RadarContact[]=[];targets:Drone[]=[];destroyed=new Set<number>();group=new T.Group();status='Loading orbital catalog';valid=0;source:{retrieved:string;count:number}|null=null;selected:number|null=25544;private assembly=new Map<number,number>();
 private shownModels=0;private skipped=0;private ids=new Int32Array();private index=new Map<number,number>();private distance=new Float64Array();private worker=new Worker(new URL('./orbits.worker.ts',import.meta.url),{type:'module'});private values=new Float64Array();private utc=0;private frameT=0;private busy=false;private lastRequest=-Infinity;private records=new Map<number,ReturnType<typeof json2satrec>>();private models=new Map<number,T.Group>();private lastScan=-Infinity;private nearest:number[]=[];private pointGeo=new T.BufferGeometry();private points:T.Points;private dots=new Float32Array(512*3);private colors=new Float32Array(512*3);
 constructor(){
  this.pointGeo.setAttribute('position',new T.BufferAttribute(this.dots,3));this.pointGeo.setAttribute('color',new T.BufferAttribute(this.colors,3));
  this.points=new T.Points(this.pointGeo,new T.PointsMaterial({size:2,sizeAttenuation:false,vertexColors:true,transparent:true,opacity:.8,depthWrite:false}));this.points.frustumCulled=false;this.group.add(this.points);this.pointGeo.setDrawRange(0,0);
  this.worker.onmessage=e=>{const d=e.data;if(d.type==='ready'){this.rows=d.rows;this.ids=Int32Array.from(this.rows,row=>Number(row.NORAD_CAT_ID));this.index=new Map(Array.from(this.ids,(id,i)=>[id,i]));this.distance=new Float64Array(this.rows.length);
   // Docked catalog entries often share exactly the station's element set. Keep their names searchable,
   // but render/target the physical assembly once instead of stacking coincident spacecraft.
   const stations=this.rows.filter(r=>r.NORAD_CAT_ID===25544||r.OBJECT_NAME==='CSS (TIANHE)');
   for(const row of this.rows)for(const station of stations)if(row.NORAD_CAT_ID!==station.NORAD_CAT_ID&&row.EPOCH===station.EPOCH&&row.MEAN_MOTION===station.MEAN_MOTION&&row.MEAN_ANOMALY===station.MEAN_ANOMALY&&row.RA_OF_ASC_NODE===station.RA_OF_ASC_NODE)this.assembly.set(Number(row.NORAD_CAT_ID),Number(station.NORAD_CAT_ID));
   this.status=`${this.rows.length.toLocaleString()} catalog objects`;return;}this.busy=false;if(d.type==='positions'){this.values=d.values;this.utc=d.utc;this.frameT=d.t;this.valid=d.valid;this.lastScan=-Infinity;}else this.status=d.message;};
  this.worker.onerror=()=>{this.status='Orbital worker unavailable';this.busy=false;};
  this.worker.postMessage({type:'load',url:new URL('orbits/active.json',document.baseURI).href});
  fetch('orbits/source.json').then(r=>r.ok?r.json():null).then(s=>this.source=s).catch(()=>{});
 }
 search(query:string){const q=query.trim().toLowerCase();return this.rows.filter(r=>r.OBJECT_NAME.toLowerCase().includes(q)||String(r.NORAD_CAT_ID)===q).slice(0,30);}
 state(id:number,utc:number,t:number){const at=this.index.get(id),row=at===undefined?undefined:this.rows[at];if(!row||this.destroyed.has(id))return null;let rec=this.records.get(id);if(!rec){rec=json2satrec(row);this.records.set(id,rec);if(this.records.size>600)this.records.delete(this.records.keys().next().value!);}try{return orbitState(rec,utc,t);}catch{return null;}}
 destroy=(id:number)=>{id=this.assembly.get(id)??id;this.destroyed.add(id);for(const [part,parent]of this.assembly)if(parent===id)this.destroyed.add(part);this.targets=this.targets.filter(t=>t.id!==1000000+id);const m=this.models.get(id);if(m)m.visible=false;};
 update(utc:number,t:number,origin:T.Vector3){
  const now=performance.now();if(this.rows.length&&!this.busy&&(now-this.lastRequest>1000||Math.abs(utc-this.utc)>10000)){this.busy=true;this.lastRequest=now;this.worker.postMessage({utc,t});}
  // With nothing near enough to model or target, the dots are hundreds of km away and a few frames of lag cannot be
  // seen; refresh them every third frame. Anything close is updated every frame.
  if(this.targets.length===0&&this.shownModels===0&&++this.skipped%3!==0)return;
  // Never extrapolate a catalog frame across a date/time jump or a long paused worker.
  const delta=(utc-this.utc)/1000,frameValid=this.values.length>0&&Math.abs(delta)<300&&Math.abs((t-this.frameT)-delta)<.1;
  if(frameValid&&now-this.lastScan>450){this.lastScan=now;
   // Nearest 511 of ~17,000 without allocating per object: distances into a typed array, a native numeric sort of a
   // copy gives the cut-off, and only the survivors are ordered.
   const dist=this.distance,n=this.rows.length;for(let i=0;i<n;i++){const k=i*7,x=this.values[k],y=this.values[k+1],z=this.values[k+2];dist[i]=Number.isFinite(x)&&!this.destroyed.has(this.ids[i])?(x-origin.x)**2+(y-origin.y)**2+(z-origin.z)**2:Infinity;}
   const cut=n>511?Float64Array.from(dist).sort()[510]:Infinity,keep:number[]=[];for(let i=0;i<n&&keep.length<511;i++)if(dist[i]<=cut&&dist[i]<Infinity)keep.push(i);
   this.nearest=keep.sort((a,b)=>dist[a]-dist[b]);}
  const selectedIndex=this.selected==null?-1:this.index.get(this.selected)??-1,indices=new Set(frameValid?this.nearest:[]);if(selectedIndex>=0)indices.add(selectedIndex);
  const old=new Map(this.targets.map(t=>[t.id,t]));this.contacts=[];this.targets=[];let dots=0,models=0;
  for(const m of this.models.values())m.visible=false;
  for(const i of indices){const r=this.rows[i],id=Number(r.NORAD_CAT_ID);if(this.destroyed.has(id))continue;const k=i*7,approx=new T.Vector3(this.values[k],this.values[k+1],this.values[k+2]);
   const exact=Math.abs(delta)>2||id===this.selected||approx.distanceToSquared(origin)<2500,s=exact?this.state(id,utc,t):null;if(exact&&!s)continue;
   const p=s?new T.Vector3(...s.p):approx.addScaledVector(new T.Vector3(this.values[k+3],this.values[k+4],this.values[k+5]),delta),v=s?new T.Vector3(...s.v):new T.Vector3(this.values[k+3],this.values[k+4],this.values[k+5]);
   if(!Number.isFinite(p.x))continue;const distance=p.distanceTo(origin),speed=s?.speed??this.values[k+6],stale=Math.abs(utc-elementTime(r))>7*86400000;
   const contact:RadarContact={id:`sat-${id}`,name:r.OBJECT_NAME,kind:'orbital',p,v,detail:`NORAD ${id} · ${speed.toFixed(3)} km/s · SGP4${stale?' · OLD ELEMENTS':''}`,epoch:r.EPOCH,stale,targetId:1000000+(this.assembly.get(id)??id)};if(!this.assembly.has(id)||id===this.selected){if(this.assembly.has(id))contact.detail+=' · docked assembly record';this.contacts.push(contact);}if(this.assembly.has(id))continue;
   if(distance<25){const target=old.get(1000000+id)??{id:1000000+id,p:p.clone(),v:v.clone(),hp:id===25544?8:3,maxHp:id===25544?8:3,phase:0,external:true,name:r.OBJECT_NAME,radius:id===25544?.055:.014,destroy:()=>this.destroy(id)};target.p.copy(p);target.v.copy(v);this.targets.push(target);}
   if(!lineOfSight(origin,p))continue;
   if(distance<25&&models<32){models++;let model=this.models.get(id);if(!model){model=satelliteModel(id===25544);this.models.set(id,model);this.group.add(model);}model.visible=true;model.position.copy(p).sub(origin);model.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),p.clone().normalize());}
   else if(distance<1600&&dots<512){this.dots.set(p.clone().sub(origin).toArray(),dots*3);this.colors.set(id===this.selected?[1,.82,.36]:[.54,.76,1],dots*3);dots++;}
  }
  // Keep GPU resources bounded while exploring thousands of catalog objects.
  for(const [id,m]of this.models)if(!m.visible&&this.models.size>48){m.traverse(o=>{if(o instanceof T.Mesh){o.geometry.dispose();for(const mat of Array.isArray(o.material)?o.material:[o.material])mat.dispose();}});this.group.remove(m);this.models.delete(id);}
  this.shownModels=models;this.pointGeo.setDrawRange(0,dots);this.pointGeo.attributes.position.needsUpdate=true;this.pointGeo.attributes.color.needsUpdate=true;
 }
}
