import * as T from 'three';
import {Combat,MISSILE,type Drone,type EnemyShot} from './combat';
import {airVelocity} from './combat-ai';
import {AIRCRAFT,buildAircraft,type AircraftType} from './aircraft-models';

const radial=(stops:[number,string][],size=128)=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=size;const c=canvas.getContext('2d')!,g=c.createRadialGradient(size/2,size/2,0,size/2,size/2,size/2);for(const [at,colour] of stops)g.addColorStop(at,colour);c.fillStyle=g;c.fillRect(0,0,size,size);const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;return texture;};
const hot=(r:number,g:number,b:number,k:number)=>new T.Color(r,g,b).multiplyScalar(k);

/** Air-to-air missile, nose toward -Z. Drawn slightly over scale so it reads from the chase camera. */
function missileModel(){
 const group=new T.Group(),skin=new T.MeshStandardMaterial({color:0xe8eaec,metalness:.35,roughness:.45}),dark=new T.MeshStandardMaterial({color:0x2b2f35,metalness:.5,roughness:.5});
 const body=new T.Mesh(new T.CylinderGeometry(.00016,.00016,.0042,10),skin);body.rotation.x=Math.PI/2;group.add(body);
 const nose=new T.Mesh(new T.ConeGeometry(.00016,.0009,10),dark);nose.rotation.x=-Math.PI/2;nose.position.z=-.00255;group.add(nose);
 const band=new T.Mesh(new T.CylinderGeometry(.000165,.000165,.0003,10),dark);band.rotation.x=Math.PI/2;band.position.z=-.0012;group.add(band);
 for(let i=0;i<4;i++){const a=i*Math.PI/2+Math.PI/4;
  const fin=new T.Mesh(new T.BoxGeometry(.0011,.00003,.0008),dark);fin.position.set(Math.cos(a)*.0005,Math.sin(a)*.0005,.0017);fin.rotation.z=a;group.add(fin);
  const canard=new T.Mesh(new T.BoxGeometry(.0006,.00003,.0004),skin);canard.position.set(Math.cos(a)*.00035,Math.sin(a)*.00035,-.0014);canard.rotation.z=a;group.add(canard);}
 group.scale.setScalar(1.6);
 return group;
}
function droneModel(){
 const group=new T.Group(),hull=new T.MeshStandardMaterial({color:0x1c2733,metalness:.85,roughness:.32,emissive:new T.Color(0,0,0)}),trim=new T.MeshStandardMaterial({color:0x4a1c16,metalness:.6,roughness:.4});
 const body=new T.Mesh(new T.OctahedronGeometry(1,1),hull);body.scale.set(.02,.014,.075);group.add(body);
 const wing=new T.BufferGeometry();
 wing.setAttribute('position',new T.BufferAttribute(new Float32Array([0,0,-.035, .095,0,.05, 0,0,.035, 0,0,-.035, 0,0,.035, -.095,0,.05, 0,.006,-.02, .06,0,.045, 0,.004,.03, 0,.006,-.02, 0,.004,.03, -.06,0,.045]),3));wing.computeVertexNormals();
 const wings=new T.Mesh(wing,new T.MeshStandardMaterial({color:0x151d27,metalness:.8,roughness:.35,side:T.DoubleSide}));group.add(wings);
 for(const side of [-1,1]){const fin=new T.Mesh(new T.BoxGeometry(.003,.026,.03),trim);fin.position.set(side*.022,.014,.045);fin.rotation.z=-side*.45;group.add(fin);
  const tip=new T.Mesh(new T.SphereGeometry(.004,8,6),new T.MeshBasicMaterial({color:hot(1,.12,.06,7),toneMapped:false}));tip.position.set(side*.093,0,.05);group.add(tip);}
 const eye=new T.Mesh(new T.SphereGeometry(.007,10,8),new T.MeshBasicMaterial({color:hot(1,.2,.08,9),toneMapped:false}));eye.position.set(0,.004,-.062);group.add(eye);
 const engine=new T.Sprite(new T.SpriteMaterial({map:radial([[0,'#fff'],[.25,'#ffb070'],[1,'#ff300000']]),color:hot(1,.45,.2,5),blending:T.AdditiveBlending,depthWrite:false,transparent:true,toneMapped:false}));engine.position.set(0,0,.08);engine.scale.setScalar(.07);group.add(engine);
 group.userData={hull,engine};
 return group;
}

/** Arcade combat presentation: drone models, tracers, missiles, fireballs and the targeting overlay. */
export class CombatView {
 group=new T.Group();canvas=document.createElement('canvas');private ctx=this.canvas.getContext('2d')!;
 private drones:T.Group[]=[];private shots:T.Mesh[]=[];private missiles:T.Group[]=[];private muzzle:T.Sprite;private trail=new WeakMap<object,T.Vector3>();
 /** 0 at night, 1 in daylight; set by the host so smoke is not self-lit after dark. */
 daylight=1;private hostile:T.Mesh[]=[];private flames:T.Sprite[]=[];private fire:T.Sprite[]=[];private rings:T.Sprite[]=[];
 private sparks:{p:T.Vector3;v:T.Vector3;life:number;smoke:boolean;size:number;grow?:number;age?:number;dense?:boolean}[]=[];private sparkGeometry=new T.BufferGeometry();private sparkPoints:T.Points;
 private seen=new WeakSet<object>();private last=0;private capacity=6000;
 constructor(public model:Combat){
  this.canvas.id='combat-hud';document.body.append(this.canvas);
  // One slot per target; each slot builds a type's model the first time that type appears in it.
  for(let i=0;i<24;i++){const g=new T.Group();g.userData.models=new Map<AircraftType,T.Group>();this.drones.push(g);this.group.add(g);}void droneModel;
  // Unit tracer: bright head at +Y, tapering to a thin tail. Scaled per round in draw().
  const tracer=new T.CylinderGeometry(1,.12,1,6).translate(0,-.5,0),tracerMaterial=new T.MeshBasicMaterial({color:hot(1,.78,.42,9),toneMapped:false,transparent:true,blending:T.AdditiveBlending,depthWrite:false}),missileMaterial=new T.MeshStandardMaterial({color:0xd9dde2,metalness:.5,roughness:.4});
  const flameMap=radial([[0,'#ffffff'],[.2,'#ffe2a8'],[.55,'#ff7a22aa'],[1,'#ff200000']]);
  for(let i=0;i<96;i++){const s=new T.Mesh(tracer,tracerMaterial);s.userData={tracerMaterial,missileMaterial};this.shots.push(s);this.group.add(s);}
  const hostileMaterial=new T.MeshBasicMaterial({color:hot(.3,1,.4,8),toneMapped:false,transparent:true,blending:T.AdditiveBlending,depthWrite:false});
  for(let i=0;i<64;i++){const s=new T.Mesh(tracer,hostileMaterial);this.hostile.push(s);this.group.add(s);}
  for(let i=0;i<10;i++){const g=missileModel();this.missiles.push(g);this.group.add(g);}
  this.muzzle=new T.Sprite(new T.SpriteMaterial({map:flameMap,color:hot(1,.8,.5,8),blending:T.AdditiveBlending,depthWrite:false,transparent:true,toneMapped:false}));this.muzzle.visible=false;this.group.add(this.muzzle);
  for(let i=0;i<30;i++){const f=new T.Sprite(new T.SpriteMaterial({map:flameMap,color:hot(1,.7,.4,6),blending:T.AdditiveBlending,depthWrite:false,transparent:true,toneMapped:false}));this.flames.push(f);this.group.add(f);}
  const ringMap=(()=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const c=canvas.getContext('2d')!,g=c.createRadialGradient(128,128,70,128,128,127);g.addColorStop(0,'#fff0');g.addColorStop(.72,'#fff6');g.addColorStop(.88,'#fff');g.addColorStop(1,'#fff0');c.fillStyle=g;c.fillRect(0,0,256,256);return new T.CanvasTexture(canvas);})();
  for(let i=0;i<32;i++){const f=new T.Sprite(new T.SpriteMaterial({map:flameMap,blending:T.AdditiveBlending,depthWrite:false,transparent:true,toneMapped:false}));this.fire.push(f);this.group.add(f);
   const r=new T.Sprite(new T.SpriteMaterial({map:ringMap,blending:T.AdditiveBlending,depthWrite:false,transparent:true,toneMapped:false}));this.rings.push(r);this.group.add(r);}
  this.sparkGeometry.setAttribute('position',new T.BufferAttribute(new Float32Array(this.capacity*3),3));this.sparkGeometry.setAttribute('look',new T.BufferAttribute(new Float32Array(this.capacity*3),3));
  this.sparkPoints=new T.Points(this.sparkGeometry,new T.ShaderMaterial({transparent:true,depthWrite:false,toneMapped:false,uniforms:{scale:{value:1},day:{value:1}},
   vertexShader:`#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 look;uniform float scale;varying vec3 vLook;void main(){vLook=look;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=clamp(look.y*scale/max(.001,-mv.z),look.x<-.5?3.:1.5,260.);gl_Position=projectionMatrix*mv;
 #include <logdepthbuf_vertex>
}`,
   fragmentShader:`#include <common>
#include <logdepthbuf_pars_fragment>
uniform float day;varying vec3 vLook;void main(){
 #include <logdepthbuf_fragment>
 float d=length(gl_PointCoord-.5)*2.;float a=smoothstep(1.,0.,d);
 // look.x: 1 = glowing spark, 0 = smoke, -1 = dense exhaust smoke; look.z = remaining life 0..1
 float dense=step(vLook.x,-.5),kind=max(vLook.x,0.);
 vec3 spark=mix(vec3(6.,1.2,.25),vec3(9.,6.,3.),vLook.z)*a*a;vec3 smoke=mix(vec3(.8,.82,.85),vec3(.95,.95,.94),dense)*day;
 gl_FragColor=mix(vec4(smoke,a*mix(.34,.6,dense)*vLook.z),vec4(spark,a*vLook.z),kind);}`}));
  this.sparkPoints.frustumCulled=false;this.group.add(this.sparkPoints);
 }
 /**
  * Hostile missile exhaust. Air-to-air seekers leave a short grey line. A surface-to-air missile kicks up a dust cloud
  * at launch, then lays a thick white column every 25 m through its 12 s motor burn that hangs and spreads for
  * 20-30 s, the way photographs of SAM launches show it; a hot plume rides at the tail while the motor burns.
  */
 private exhaust(s:EnemyShot){
  const sam=s.name==='SAM',wind=airVelocity(s.p),dir=s.v.clone().sub(wind).normalize(),up=s.p.clone().normalize();
  if(sam&&!this.seen.has(s)){this.seen.add(s);for(let k=0;k<16;k++){const d=new T.Vector3(Math.random()-.5,Math.random()*.4,Math.random()-.5).normalize();this.emit(s.p.clone().addScaledVector(up,-.012),wind.clone().addScaledVector(d,.012+Math.random()*.01),8+Math.random()*6,true,.04+Math.random()*.03,.18,true);}}
  if(sam&&s.age>12){this.trail.delete(s);return;}
  const from=this.trail.get(s);this.trail.set(s,s.p.clone());if(!from)return;
  const spacing=sam?.025:.025,gap=from.distanceTo(s.p),n=Math.min(sam?80:10,Math.max(1,Math.floor(gap/spacing)));
  for(let k=1;k<=n;k++){const at=from.clone().lerp(s.p,k/n).addScaledVector(dir,-.004),drift=wind.clone().addScaledVector(new T.Vector3(Math.random()-.5,Math.random()-.5,Math.random()-.5),sam?.002:.004).addScaledVector(up,sam?.0008:0);
   this.emit(at,drift,sam?18+Math.random()*10:2.2,true,sam?.03+Math.random()*.012:.009,sam?.22:0,sam);}
  this.emit(s.p.clone().addScaledVector(dir,-.006),s.v.clone().multiplyScalar(.9).addScaledVector(wind,.1),.05,false,sam?.028:.014);
 }
 /** `grow`: fractional size gained per second, for exhaust columns that spread as they hang in the air. */
 private emit(p:T.Vector3,v:T.Vector3,life:number,smoke:boolean,size:number,grow=0,dense=false){if(this.sparks.length>=this.capacity)this.sparks.shift();this.sparks.push({p:p.clone(),v:v.clone(),life,smoke,size,grow,age:0,dense});}
 draw(camera:T.PerspectiveCamera,p:T.Vector3,q:T.Quaternion,aim:T.Vector3,time:number,enabled:boolean,velocity=new T.Vector3()){
  const m=this.model,w=innerWidth,h=innerHeight,dpr=Math.min(devicePixelRatio,2),c=this.ctx;if(this.canvas.width!==w*dpr||this.canvas.height!==h*dpr){this.canvas.width=w*dpr;this.canvas.height=h*dpr;this.canvas.style.width=w+'px';this.canvas.style.height=h+'px';}c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);this.group.visible=m.active&&enabled;
  const dt=T.MathUtils.clamp(time-this.last,0,.05);this.last=time;
  if(!this.group.visible){this.sparks.length=0;return;}
  const project=(world:T.Vector3)=>{const relative=world.clone().sub(p),view=relative.clone().applyMatrix4(camera.matrixWorldInverse),ndc=relative.project(camera);return{x:(ndc.x*.5+.5)*w,y:(-.5*ndc.y+.5)*h,front:view.z<0,visible:view.z<0&&Math.abs(ndc.x)<1&&Math.abs(ndc.y)<1};};
  const radialUp=p.clone().normalize();
  // --- drones
  for(let i=0;i<this.drones.length;i++){const d=m.targets[i],mesh=this.drones[i];mesh.visible=!!d;if(!d)continue;
   const type:AircraftType=d.model??(d.kind==='heavy'?'jumbo':d.kind==='scout'?'f16':'f18'),models=mesh.userData.models as Map<AircraftType,T.Group>;
   let craft=models.get(type);if(!craft){craft=buildAircraft(type);models.set(type,craft);mesh.add(craft);}for(const [k,g] of models)g.visible=k===type;
   mesh.position.copy(d.p).sub(p);
   const forward=d.ai?d.ai.dir.clone():d.v.clone().normalize();if(forward.lengthSq()<1e-9)forward.set(0,0,-1).applyQuaternion(q);forward.normalize();
   // Bank into the turn: the wings sit perpendicular to the lift vector the pilot is pulling.
   const lift=d.ai?d.ai.up:radialUp,right=forward.clone().cross(lift).normalize(),top=right.clone().cross(forward).normalize();
   mesh.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(right,top,forward.clone().negate()));
   (craft.userData.hull as T.MeshStandardMaterial).emissive.setRGB(1,.5,.25).multiplyScalar((d.hit??0)*3);
   for(const e of craft.userData.engines as T.Sprite[])e.scale.setScalar(e.userData.base*(.7+1.7*(d.ai?.boost??.3))*(1+.12*Math.sin(time*23+d.phase)));
   if(craft.userData.rotor)(craft.userData.rotor as T.Object3D).rotation.y=time*34;
  }
  // --- shots
  let flame=0,rocket=0;const eye=camera.position,unitY=new T.Vector3(0,1,0);
  // A tracer is a short streak: its length is what the eye integrates in about 20 ms, its width is held near a pixel.
  const streak=(mesh:T.Mesh,at:T.Vector3,v:T.Vector3,age:number)=>{const relative=v.clone().sub(velocity),speed=relative.length(),here=at.clone().sub(p),width=Math.max(.00035,here.distanceTo(eye)*.0011);
   mesh.position.copy(here);mesh.quaternion.setFromUnitVectors(unitY,relative.divideScalar(Math.max(1e-6,speed)));mesh.scale.set(width,Math.min(speed*.022,speed*age+.004),width);};
  for(let i=0;i<this.shots.length;i++){const s=m.shots[i],mesh=this.shots[i];mesh.visible=!!s&&!s.missile;if(!s)continue;
   if(!s.missile){mesh.material=mesh.userData.tracerMaterial;streak(mesh,s.p,s.v,s.age);continue;}
   const body=this.missiles[rocket++];if(!body)continue;
   const nose=(s.dir??s.v.clone().sub(velocity)).clone().normalize(),here=s.p.clone().sub(p),burning=s.age>MISSILE.drop&&s.age<MISSILE.burn;
   body.visible=true;body.position.copy(here);body.quaternion.setFromUnitVectors(new T.Vector3(0,0,-1),nose);
   if(burning){
    // Motor plume: a white-hot core and two cooler puffs behind it.
    for(let k=0;k<3;k++){const f=this.flames[flame++];if(!f)break;f.visible=true;f.position.copy(here).addScaledVector(nose,-(.005+k*.007));const flick=.85+.3*Math.sin(time*(70+k*13)+i*3);f.scale.setScalar((k?.016-k*.004:.02)*flick);(f.material as T.SpriteMaterial).color.setRGB(1,k?.6:.86,k?.3:.62).multiplyScalar(k?5:11);}
    // Smoke is laid every ~16 m along the path and stays in the air it was made in.
    const from=this.trail.get(s)??s.p.clone(),gap=from.distanceTo(s.p),n=Math.min(8,Math.floor(gap/.016));
    if(n>0){const wind=airVelocity(s.p);for(let k=1;k<=n;k++)this.emit(from.clone().lerp(s.p,k/n).addScaledVector(nose,-.006),wind.clone().addScaledVector(new T.Vector3(Math.random()-.5,Math.random()-.5,Math.random()-.5),.004),2.3+Math.random()*.6,true,.007+Math.random()*.004);this.trail.set(s,s.p.clone());}
    else if(!this.trail.has(s))this.trail.set(s,s.p.clone());
   }
  }
  for(;rocket<this.missiles.length;rocket++)this.missiles[rocket].visible=false;
  for(;flame<this.flames.length;flame++)this.flames[flame].visible=false;
  for(let i=0;i<this.hostile.length;i++){const s=m.incoming[i],mesh=this.hostile[i];mesh.visible=!!s;if(s){streak(mesh,s.p,s.v,s.age);if(s.weapon&&s.weapon!=='gun'){mesh.scale.x*=3;mesh.scale.z*=3;mesh.scale.y=Math.max(.02,mesh.scale.y);if(dt>0)this.exhaust(s);}}}
  // Muzzle flash: lives for the frame a round leaves, at the gun port under the nose.
  const firing=m.gunCooldown>.012&&!m.completed;this.muzzle.visible=firing;if(firing){this.muzzle.position.copy(aim).multiplyScalar(.0155).addScaledVector(radialUp,-.0012);this.muzzle.scale.setScalar(.006+Math.random()*.007);(this.muzzle.material as T.SpriteMaterial).rotation=Math.random()*6.28;}
  // --- explosions
  for(let i=0;i<this.fire.length;i++){const b=m.bursts[i],f=this.fire[i],r=this.rings[i];f.visible=r.visible=!!b;if(!b)continue;
   if(b.dust){f.visible=r.visible=false;if(!this.seen.has(b)){this.seen.add(b);for(let k=0;k<3;k++)this.emit(b.p.clone().addScaledVector(radialUp,.004+k*.004),(b.v??velocity).clone().addScaledVector(radialUp,.01+Math.random()*.012),1.1+Math.random()*.7,true,.012+Math.random()*.008);}continue;}
   const scale=b.scale??1,total=b.big?1.2:.65,age=1-b.life/total,size=(b.big?.36:.07)*scale;
   if(!this.seen.has(b)){this.seen.add(b);const n=b.big?46:7;for(let k=0;k<n;k++){const dir=new T.Vector3(Math.random()-.5,Math.random()-.5,Math.random()-.5).normalize();this.emit(b.p,(b.v??velocity).clone().addScaledVector(dir,(b.big?.5:.25)*(.25+Math.random())*scale),.5+Math.random()*(b.big?1.1:.4),false,(b.big?.02:.012)*scale);}
    if(b.big)for(let k=0;k<16;k++){const dir=new T.Vector3(Math.random()-.5,Math.random()-.5,Math.random()-.5).normalize();this.emit(b.p.clone().addScaledVector(dir,.03*scale),(b.v??velocity).clone().addScaledVector(dir,.07*scale),2.2+Math.random(),true,.16*scale);}}
   f.position.copy(b.p).sub(p);f.scale.setScalar(size*(.25+1.1*Math.sqrt(age)));
   const mat=f.material as T.SpriteMaterial;mat.color.setRGB(1,T.MathUtils.lerp(.62,.16,age),T.MathUtils.lerp(.28,.02,age)).multiplyScalar(T.MathUtils.lerp(b.big?7:4.5,0,age));mat.opacity=1-age*age;
   r.visible=!!b.big;r.position.copy(f.position);r.scale.setScalar((.08+age*.95)*scale);(r.material as T.SpriteMaterial).color.setRGB(1,.6,.3).multiplyScalar(1.4*(1-age));(r.material as T.SpriteMaterial).opacity=Math.max(0,1-age*1.3);
  }
  // --- sparks and smoke
  const position=this.sparkGeometry.attributes.position as T.BufferAttribute,look=this.sparkGeometry.attributes.look as T.BufferAttribute;let n=0;
  for(const s of this.sparks){s.life-=dt;if(s.life<=0)continue;s.p.addScaledVector(s.v,dt);if(!s.smoke)s.v.lerp(velocity,1-Math.exp(-dt*.9));
   position.setXYZ(n,s.p.x-p.x,s.p.y-p.y,s.p.z-p.z);s.age=(s.age??0)+dt;look.setXYZ(n,s.smoke?(s.dense?-1:0):1,s.size*(s.smoke?1+(1.5-Math.min(1.5,s.life))*1.6+(s.grow??0)*Math.min(s.age,25):1),Math.min(1,s.life/(s.smoke?(s.grow?6:1.2):.6)));n++;}
  this.sparks=this.sparks.filter(s=>s.life>0);this.sparkGeometry.setDrawRange(0,n);position.needsUpdate=look.needsUpdate=true;
  (this.sparkPoints.material as T.ShaderMaterial).uniforms.scale.value=h*dpr*.5/Math.tan(camera.fov*Math.PI/360);(this.sparkPoints.material as T.ShaderMaterial).uniforms.day.value=.12+.88*this.daylight;
  if(m.engaged)this.hud(c,project,p,velocity,aim,time,w,h);
 }
 private hud(c:CanvasRenderingContext2D,project:(v:T.Vector3)=>{x:number;y:number;front:boolean;visible:boolean},p:T.Vector3,velocity:T.Vector3,aim:T.Vector3,time:number,w:number,h:number){
  const m=this.model,mono='600 10px ui-monospace,SFMono-Regular,Menlo,monospace';c.lineCap='round';
  const bracket=(x:number,y:number,s:number)=>{const k=s*.42;c.beginPath();for(const [sx,sy] of [[-1,-1],[1,-1],[1,1],[-1,1]]){c.moveTo(x+sx*s,y+sy*(s-k));c.lineTo(x+sx*s,y+sy*s);c.lineTo(x+sx*(s-k),y+sy*s);}c.stroke();};
  const reticle=project(p.clone().addScaledVector(aim,5));
  // SAM batteries are external ground targets: boxed like aircraft out to 40 km, no edge arrows beyond that.
  for(const d of [...m.targets,...m.external.filter(t=>t.ground&&t.hp>0&&(!t.quietTarget||t.id===m.lock)&&t.p.distanceTo(p)<40)]){const z=project(d.p),distance=d.p.distanceTo(p),locked=d.id===m.lock,acquired=locked&&m.lockTime>=.85,colour=acquired?'#9dffb0':locked?'#ffd27a':'#ff7a5c';
   c.strokeStyle=c.fillStyle=colour;c.shadowColor=colour;c.shadowBlur=8;
   if(!z.visible){
    // Edge arrow toward targets outside the frame.
    let dx=z.x-w/2,dy=z.y-h/2;if(!z.front){dx=-dx;dy=-dy;}const a=Math.atan2(dy,dx),rx=w/2-46,ry=h/2-46,k=1/Math.max(Math.abs(Math.cos(a))/rx,Math.abs(Math.sin(a))/ry),x=w/2+Math.cos(a)*k,y=h/2+Math.sin(a)*k;
    c.save();c.translate(x,y);c.rotate(a);c.beginPath();c.moveTo(12,0);c.lineTo(-6,-8);c.lineTo(-2,0);c.lineTo(-6,8);c.closePath();c.globalAlpha=.9;c.fill();c.restore();
    c.font=mono;c.textAlign='center';c.fillText(`${distance.toFixed(1)}`,x-Math.cos(a)*22,y-Math.sin(a)*22+3);continue;}
   const size=T.MathUtils.clamp((d.model==='jumbo'?150:64)/Math.max(.6,distance),13,58)+(acquired?3*Math.sin(time*14):0);
   c.lineWidth=acquired?2.2:1.6;bracket(z.x,z.y,size);
   c.font=mono;c.textAlign='center';c.fillText(`${acquired?'LOCKED':locked?'ACQUIRING':(d.name??(d.model?AIRCRAFT[d.model].name:(d.kind??'drone').toUpperCase()))+((d.ai?.machNow??0)>1?` · M${d.ai!.machNow!.toFixed(1)}`:'')+(d.ai?.mode==='evade'?' · EVADING':d.burst?' · FIRING':d.ai&&d.ai.tail>1?' · ON YOUR SIX':'')} · ${distance.toFixed(1)} KM`,z.x,z.y-size-9);
   const max=d.maxHp??3,bar=Math.min(60,size*1.6);c.globalAlpha=.35;c.fillRect(z.x-bar/2,z.y+size+7,bar,3);c.globalAlpha=1;c.fillRect(z.x-bar/2,z.y+size+7,bar*Math.max(0,d.hp)/max,3);
   if(locked){c.lineWidth=2;c.beginPath();c.arc(z.x,z.y,size+9,-Math.PI/2,-Math.PI/2+Math.PI*2*Math.min(1,m.lockTime/.85));c.stroke();
    // Gun lead: where to aim so that rounds and target arrive together.
    const lead=project(d.p.clone().addScaledVector(d.v.clone().sub(velocity),distance/2.3));if(lead.visible){c.lineWidth=1.2;c.setLineDash([3,4]);c.beginPath();c.moveTo(z.x,z.y);c.lineTo(lead.x,lead.y);c.stroke();c.setLineDash([]);c.beginPath();c.arc(lead.x,lead.y,6,0,Math.PI*2);c.stroke();c.fillRect(lead.x-1,lead.y-1,2,2);}}
  }
  // Reticle follows the pointer inside the weapon cone.
  c.shadowColor='#bfffe0';c.shadowBlur=10;c.strokeStyle='#e4fff1';c.fillStyle='#e4fff1';c.lineWidth=1.6;const R=13,spin=time*.6;
  c.beginPath();for(let i=0;i<4;i++){const a=spin+i*Math.PI/2;c.moveTo(reticle.x+Math.cos(a)*R,reticle.y+Math.sin(a)*R);c.lineTo(reticle.x+Math.cos(a)*(R+9),reticle.y+Math.sin(a)*(R+9));}c.stroke();
  c.beginPath();c.arc(reticle.x,reticle.y,R,0,Math.PI*2);c.globalAlpha=.55;c.stroke();c.globalAlpha=1;c.fillRect(reticle.x-1.5,reticle.y-1.5,3,3);
  if(m.hitFlash>0){c.strokeStyle='#fff';c.shadowColor='#ffb070';c.globalAlpha=m.hitFlash;c.lineWidth=2.4;c.beginPath();for(const [sx,sy] of [[-1,-1],[1,-1],[1,1],[-1,1]]){c.moveTo(reticle.x+sx*8,reticle.y+sy*8);c.lineTo(reticle.x+sx*17,reticle.y+sy*17);}c.stroke();c.globalAlpha=1;}
  c.shadowBlur=12;c.textAlign='center';
  for(const u of m.popups){const z=project(u.p);if(!z.visible)continue;c.globalAlpha=Math.min(1,u.life*1.4);c.fillStyle='#ffe2a1';c.shadowColor='#ff9d4d';c.font='700 20px ui-monospace,SFMono-Regular,Menlo,monospace';c.fillText(u.text,z.x,z.y-34-(1.6-u.life)*46);}
  c.globalAlpha=1;
  if(m.combo>1){c.fillStyle='#ffd27a';c.shadowColor='#ff9d4d';c.font='700 13px ui-monospace,SFMono-Regular,Menlo,monospace';c.fillText(`COMBO ×${Math.min(5,m.combo)}`,reticle.x,reticle.y+44);c.globalAlpha=.8;c.fillRect(reticle.x-30,reticle.y+51,60*m.comboClock/4,2);c.globalAlpha=1;}
  if(m.waveBanner>0&&!m.completed){const a=Math.min(1,m.waveBanner,(2.5-m.waveBanner)*3);c.globalAlpha=Math.max(0,a);c.fillStyle='#fff';c.shadowColor='#ff7a5c';c.shadowBlur=24;c.font='200 54px system-ui,sans-serif';c.fillText(`WAVE ${m.wave}`,w/2,h*.3);c.font=mono;c.fillStyle='#ffc9a8';c.fillText(`${m.targets.length} HOSTILE AIRCRAFT · AIM WITH THE MOUSE · HOLD CLICK TO FIRE`,w/2,h*.3+26);c.globalAlpha=1;}
  // Hull bar, and an arc on the side the last hit came from.
  if(!m.completed){const low=m.health<35,colour=low?'#ff5a4d':m.health<70?'#ffd27a':'#bfffe0',panel=document.getElementById('combat-panel')?.getBoundingClientRect(),bw=panel?.width||180,bx=panel?panel.left:w/2-bw/2,by=panel?panel.bottom+24:h-74;c.shadowBlur=8;c.shadowColor=colour;c.fillStyle=colour;c.globalAlpha=.25;c.fillRect(bx,by,bw,4);c.globalAlpha=low?.65+.35*Math.sin(time*12):1;c.fillRect(bx,by,bw*m.health/100,4);c.font=mono;c.textAlign='left';c.fillText(`HULL ${Math.ceil(m.health)}${m.hurt>0?' · TAKING FIRE':low?' · BREAK AWAY':''}`,bx,by-7);c.textAlign='center';c.globalAlpha=1;
   if(m.hurt>0){const z=project(p.clone().addScaledVector(m.hurtFrom,5));let dx=z.x-w/2,dy=z.y-h/2;if(!z.front){dx=-dx;dy=-dy;}const a=Math.atan2(dy,dx);c.strokeStyle='#ff5a4d';c.shadowColor='#ff2a1a';c.shadowBlur=18;c.lineWidth=5;c.globalAlpha=m.hurt;c.beginPath();c.arc(w/2,h/2,Math.min(w,h)*.3,a-.32,a+.32);c.stroke();c.globalAlpha=1;}}
  if(m.down){c.fillStyle='#fff';c.shadowColor='#ff5a4d';c.shadowBlur=24;c.font='200 50px system-ui,sans-serif';c.fillText('SHOT DOWN',w/2,h*.32);c.font='600 15px ui-monospace,SFMono-Regular,Menlo,monospace';c.fillStyle='#ffc9c0';c.fillText(`${m.score.toLocaleString()} PTS · ${m.kills} KILLS · WAVE ${m.wave} · BEST ${Math.max(m.best,m.score).toLocaleString()}`,w/2,h*.32+32);}
  else if(m.completed){c.fillStyle='#fff';c.shadowColor='#9dffb0';c.shadowBlur=24;c.font='200 50px system-ui,sans-serif';c.fillText('SORTIE COMPLETE',w/2,h*.32);c.font='600 15px ui-monospace,SFMono-Regular,Menlo,monospace';c.fillStyle='#c9ffd6';c.fillText(`${m.score.toLocaleString()} PTS · ${m.kills} KILLS · ${m.fired?Math.round(m.hits/m.fired*100):0}% ACCURACY · BEST ${Math.max(m.best,m.score).toLocaleString()}`,w/2,h*.32+32);}
  c.shadowBlur=0;
 }
}
export type {Drone};
