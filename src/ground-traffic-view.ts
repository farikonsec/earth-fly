import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {GroundTraffic,VEHICLES,type VehicleKind,type GroundVehicle} from './ground-traffic';
import type {RoadEdge} from './transport-network';
import {bodyToInertial} from './geo';
import {EARTH} from './earth';
import {airVelocity} from './combat-ai';
import type {Drone} from './combat';
import type {RadarContact} from './contacts';
import type {V} from './vector';
function geometry(kind:VehicleKind){
 const s=VEHICLES[kind],body:T.BufferGeometry[]=[],dark:T.BufferGeometry[]=[],front:T.BufferGeometry[]=[],rear:T.BufferGeometry[]=[],long=s.carriages>1||['bus','lorry','van'].includes(kind),rail=s.carriages>1;
 const box=(list:T.BufferGeometry[],w:number,h:number,l:number,x=0,y=0,z=0)=>list.push(new T.BoxGeometry(w,h,l).translate(x,y,z));
 box(body,s.width,s.height*(long?.75:.38),s.length,0,s.height*(long?.48:.38));
 if(!long)box(body,s.width*.85,s.height*.5,s.length*.52,0,s.height*.72,.1);
 if(kind==='lorry'){body.pop();box(body,s.width,3.3,s.length*.74,0,2.25,1.8);box(body,s.width,2.4,3.4,0,1.6,-s.length*.38);}
 const windows=rail?9:kind==='bus'?8:kind==='lorry'?1:long?2:2;
 for(const side of[-1,1]){for(let i=0;i<windows;i++){const z=rail||kind==='bus'?-s.length*.39+i*s.length*.76/(windows-1):kind==='lorry'?-s.length*.39:(i-.5)*.9;
  box(dark,.025,rail?.8:kind==='bus'?.85:long?.7:.5,rail?1.25:kind==='bus'?.8:.75,side*(long?s.width*.501:s.width*.43),kind==='bus'?3.5:s.height*.73,z);if(kind==='bus')box(dark,.025,.7,.8,side*s.width*.501,1.9,z);}
  for(const z of rail?[-s.length*.34,-s.length*.27,s.length*.27,s.length*.34]:[-s.length*.31,s.length*.31]){const g=new T.CylinderGeometry(rail?.38:long?.43:.31,rail?.38:long?.43:.31,.19,8).rotateZ(Math.PI/2).translate(side*s.width*.47,rail?.5:long?.45:.32,z);dark.push(g);}
  box(front,.25,.16,.04,side*s.width*.32,s.height*.37,-s.length*.502);box(rear,.25,.16,.04,side*s.width*.32,s.height*.37,s.length*.502);
 }
 box(dark,s.width*.74,rail?.85:long?.8:.45,.03,0,s.height*.73,kind==='lorry'?-s.length*.49:-s.length*(long?.501:.27));
 if(kind==='taxi')box(body,.65,.13,.3,0,s.height+.05,0);
 if(rail){box(body,s.width*.94,.25,s.length*.93,0,s.height*.96);if(kind==='tube')box(body,s.width+.01,.2,s.length,0,.9);}
 const merge=(g:T.BufferGeometry[])=>{const list=g.map(x=>x.toNonIndexed()),merged=mergeGeometries(list)!;g.forEach(x=>x.dispose());list.forEach(x=>x.dispose());return merged.scale(.001,.001,.001);};
 return[merge(body),merge(dark),merge(front),merge(rear)];
}
interface Batch{meshes:T.InstancedMesh[];count:number}
export class GroundTrafficView{
 group=new T.Group();targets:Drone[]=[];contacts:RadarContact[]=[];cutaway=false;
 private batches=new Map<VehicleKind,Batch>();private ghosts=new Map<VehicleKind,Batch>();private targetPool=new Map<number,Drone>();private positions=new Map<number,{p:T.Vector3;forward:T.Vector3;up:T.Vector3;underground:boolean;vehicle:GroundVehicle}>();
 private smoke:T.InstancedMesh;private matrix=new T.Matrix4();private near=new T.Vector3();private q=new T.Quaternion();private unit=new T.Vector3(1,1,1);private ash=new T.Color(0x242126);private tint=new T.Color();
 constructor(public model:GroundTraffic,private height:(p:T.Vector3,e:RoadEdge)=>number){
  this.group.name='Autonomous road and rail traffic';
  for(const kind of Object.keys(VEHICLES) as VehicleKind[]){const geometries=geometry(kind),materials=[new T.MeshStandardMaterial({color:0xffffff,roughness:.5,metalness:.3}),new T.MeshStandardMaterial({color:0x18252b,roughness:.45,metalness:.4}),new T.MeshStandardMaterial({color:0xffedc6,emissive:0xffe4ac,emissiveIntensity:1.4}),new T.MeshStandardMaterial({color:0x670b10,emissive:0xff2736,emissiveIntensity:.6})];
   const meshes=geometries.map((g,i)=>{const m=new T.InstancedMesh(g,materials[i],VEHICLES[kind].carriages>1?220:740);m.count=0;m.frustumCulled=false;m.instanceMatrix.setUsage(T.DynamicDrawUsage);this.group.add(m);return m;});this.batches.set(kind,{meshes,count:0});
   if(VEHICLES[kind].carriages>1){const m=new T.InstancedMesh(geometries[0],new T.MeshBasicMaterial({color:0x75e3ff,transparent:true,opacity:.48,depthTest:false,depthWrite:false}),220);m.count=0;m.frustumCulled=false;m.renderOrder=100;this.group.add(m);this.ghosts.set(kind,{meshes:[m],count:0});}
  }
  this.smoke=new T.InstancedMesh(new T.IcosahedronGeometry(.001,1),new T.MeshStandardMaterial({color:0x383b3c,transparent:true,opacity:.38,depthWrite:false,roughness:1}),480);this.smoke.count=0;this.smoke.frustumCulled=false;this.group.add(this.smoke);
 }
 draw(origin:T.Vector3,time:number,enabled=true){
  this.group.visible=enabled;this.targets=[];this.contacts=[];this.positions.clear();for(const b of [...this.batches.values(),...this.ghosts.values()])b.count=0;let smoke=0;
  if(!enabled)return;const spin=new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),time/EARTH.rotation*Math.PI*2);
  for(const v of this.model.vehicles){const spec=VEHICLES[v.kind];for(let carriage=0;carriage<spec.carriages;carriage++){
   const pose=this.model.pose(v,carriage*(spec.length+1));if(!pose)continue;
   // Cull on the bare surface point first: heights are metres against a 7 km radius, and the height lookup is the
   // expensive part of this loop.
   if(this.near.set(...bodyToInertial(pose.p.toArray() as V,time,EARTH.rotation)).distanceTo(origin)>7.05)continue;
   const h=this.height(pose.p,pose.edge),body=pose.p.clone().normalize().multiplyScalar(EARTH.radius+h/1000),p=new T.Vector3(...bodyToInertial(body.toArray() as V,time,EARTH.rotation)),distance=p.distanceTo(origin);if(distance>7)continue;
   const forward=pose.forward.applyQuaternion(spin),up=pose.up.applyQuaternion(spin),right=forward.clone().cross(up).normalize();up.copy(right).cross(forward).normalize();const id=v.id*10+carriage,underground=pose.edge.tunnel;
   this.positions.set(id,{p,forward,up,underground,vehicle:v});
   const batch=this.batches.get(v.kind)!;this.q.setFromRotationMatrix(this.matrix.makeBasis(right,up,forward.clone().negate()));const at=p.clone().sub(origin);this.matrix.compose(at,this.q,this.unit);
   if(!underground||!this.cutaway){const i=batch.count++;for(const m of batch.meshes)m.setMatrixAt(i,this.matrix);batch.meshes[0].setColorAt(i,v.dead?this.ash:this.tint.setHex(v.colour));batch.meshes[3].setColorAt(i,this.tint.setScalar(v.dead?0:v.braking?3:1));}
   else{const ghost=this.ghosts.get(v.kind);if(ghost){const i=ghost.count++;ghost.meshes[0].setMatrixAt(i,this.matrix);}}
   if(v.dead){if(carriage===0&&v.wreckAge<75){for(let k=0;k<6&&smoke<480;k++){const age=(v.wreckAge+k*1.6)%9,pt=at.clone().addScaledVector(up,(spec.height+age*1.4)/1000).addScaledVector(right,Math.sin(age*.7+k)*age*.0003);this.matrix.compose(pt,this.q,this.unit.clone().multiplyScalar(1+age*.4));this.smoke.setMatrixAt(smoke++,this.matrix);}}continue;}
   const target=this.targetPool.get(id)??{id,p:p.clone(),v:new T.Vector3(),hp:spec.hp,maxHp:spec.hp,phase:0,external:true,ground:true,score:0,quietTarget:true,name:v.kind.toUpperCase(),radius:spec.length*.0005+.0006,destroy:()=>this.destroyVehicle(v.id)};
   target.collisionBox??={right:new T.Vector3(),up:new T.Vector3(),forward:new T.Vector3(),half:new T.Vector3(spec.width*.0005,spec.height*.0005,spec.length*.0005)};target.collisionBox.right.copy(right);target.collisionBox.up.copy(up);target.collisionBox.forward.copy(forward);
   target.p.copy(p).addScaledVector(up,spec.height*.0005);target.v.copy(airVelocity(p)).addScaledVector(forward,v.speed/1000);target.name=(v.line?v.line+' · ':'')+v.kind.toUpperCase()+(spec.carriages>1?` ${carriage+1}/${spec.carriages}`:'');this.targetPool.set(id,target);
   // Underground targets are protected by the terrain, but a nearby surface blast can damage them.
   if(!underground&&distance<5)this.targets.push(target);
   if(carriage===0)this.contacts.push({id:'traffic-'+v.id,name:v.line||v.kind.toUpperCase(),kind:spec.carriages>1?'rail':'road',p:target.p,v:target.v,detail:`${Math.round(v.speed*3.6)} km/h · ${v.dwell>0?'Stopping at '+(v.station||'stop'):v.lane===1?'Overtaking':pose.edge.tunnel?'Underground':pose.edge.class} · ${v.kind}`,targetId:underground?undefined:id});
  }}
  for(const [id]of this.targetPool)if(!this.positions.has(id))this.targetPool.delete(id);
  for(const b of [...this.batches.values(),...this.ghosts.values()])for(const m of b.meshes){m.count=b.count;m.instanceMatrix.needsUpdate=true;if(m.instanceColor)m.instanceColor.needsUpdate=true;}
  this.smoke.count=smoke;this.smoke.instanceMatrix.needsUpdate=true;
 }
 destroyVehicle(id:number){if(!this.model.kill(id))return;for(const [targetId,target]of this.targetPool)if(Math.floor(targetId/10)===id)target.hp=0;}
 blast(p:T.Vector3,radius=.035){for(const value of this.positions.values()){if(value.vehicle.dead)continue;if(value.p.distanceTo(p)<radius)this.destroyVehicle(value.vehicle.id);}}
}
