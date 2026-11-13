import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {AIRLINERS,type AirTraffic} from './air-traffic';
export function buildAirliner(type:number){
 const spec=AIRLINERS[type],g=new T.Group(),skin=new T.MeshStandardMaterial({color:0xecf1f3,metalness:.3,roughness:.48}),trim=new T.MeshStandardMaterial({color:spec.colour,metalness:.35,roughness:.4}),dark=new T.MeshStandardMaterial({color:0x122435,metalness:.6,roughness:.25});
 const add=(geo:T.BufferGeometry,mat:T.Material,x=0,y=0,z=0)=>{const m=new T.Mesh(geo,mat);m.position.set(x,y,z);g.add(m);return m;};
 const radius=spec.width/2,profile:T.Vector2[]=[];for(let i=0;i<=20;i++){const u=i/20;profile.push(new T.Vector2(radius*Math.min(1,Math.pow(Math.sin(Math.PI*u),.24)),(u-.5)*spec.length));}
 add(new T.LatheGeometry(profile,16).rotateX(Math.PI/2),skin);
 const wing=(points:number[][],mat:T.Material)=>{const geo=new T.ExtrudeGeometry(new T.Shape(points.map(([x,z])=>new T.Vector2(x,-z))),{depth:.28,bevelEnabled:false});geo.rotateX(-Math.PI/2);return add(geo,mat,0,-radius*.45);};
 for(const side of [-1,1]){
  wing([[side*1,-5],[side*spec.span/2,9],[side*spec.span/2,11],[side*2,5]],skin);
  wing([[side*1,spec.length*.32],[side*spec.span*.18,spec.length*.45],[side*spec.span*.18,spec.length*.48],[side*1,spec.length*.43]],skin);
  // Winglets and conventional under-wing engines.
  add(new T.BoxGeometry(.2,2.3,1.2),trim,side*spec.span/2,1,10);
  for(let e=0;e<spec.engines/2;e++){const x=side*spec.span*(e===0?.19:.33),z=spec.span*(e===0?.015:.09),r=spec.width*(spec.engines===4?.21:.3);
   add(new T.CylinderGeometry(r,r*.88,r*2.8,14).rotateX(Math.PI/2),skin,x,-radius*1.08,z);add(new T.CircleGeometry(r*.8,14),dark,x,-radius*1.08,z-r*1.41);}
  for(let i=0;i<Math.floor(spec.length/1.3)-8;i++)add(new T.BoxGeometry(.06,.25,.38),dark,side*radius*.98,radius*.28,-spec.length*.32+i*1.3);
  add(new T.SphereGeometry(.19,6,5),new T.MeshBasicMaterial({color:side<0?0xff4356:0x52ffd1,toneMapped:false}),side*spec.span/2,.2,10);
 }
 const tail=wing([[0,spec.length*.27],[0,spec.length*.47],[7,spec.length*.47],[7,spec.length*.4]],trim);tail.rotation.z=Math.PI/2;tail.position.y=radius*.5;
 add(new T.SphereGeometry(1,12,6).scale(radius*.8,radius*.25,2),dark,0,radius*.65,-spec.length*.40);
 if(type===5)add(new T.SphereGeometry(1,12,6).scale(radius*.86,1.4,9),skin,0,radius*.8,-spec.length*.26);
 const gear=new T.Group();for(const x of [-radius*.7,radius*.7,0]){const z=x===0?-spec.length*.3:spec.length*.08,m=new T.Mesh(new T.BoxGeometry(.4,2,.4),dark);m.position.set(x,-radius-1,z);gear.add(m);const wheel=new T.Mesh(new T.CylinderGeometry(.6,.6,.5,10).rotateZ(Math.PI/2),dark);wheel.position.set(x,-radius-2,z);gear.add(wheel);}g.add(gear);
 for(const material of[skin,trim,dark]){const meshes=g.children.filter((o):o is T.Mesh=>o instanceof T.Mesh&&o.material===material),geometries=meshes.map(m=>{m.updateMatrix();return (m.geometry.index?m.geometry.toNonIndexed():m.geometry.clone()).applyMatrix4(m.matrix);});const merged=mergeGeometries(geometries);if(merged){for(const m of meshes){g.remove(m);m.geometry.dispose();}g.add(new T.Mesh(merged,material));}for(const geo of geometries)geo.dispose();}
 g.scale.setScalar(.001);g.userData.gear=gear;return g;
}
export class TrafficView{
 group=new T.Group();models:T.Group[];
 constructor(private traffic:AirTraffic){this.models=traffic.flights.map(f=>{const g=buildAirliner(f.type);this.group.add(g);return g;});}
 draw(origin:T.Vector3){this.traffic.flights.forEach((f,i)=>{const m=this.models[i];m.visible=f.visible&&f.p.distanceToSquared(origin)<160*160;if(!m.visible)return;m.position.copy(f.p).sub(origin);const right=f.forward.clone().cross(f.up).normalize(),top=right.clone().cross(f.forward).normalize();m.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(right,top,f.forward.clone().negate()));m.userData.gear.visible=f.gear;});}
}
