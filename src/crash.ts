import * as T from 'three';

const glow=(stops:[number,string][])=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=128;const c=canvas.getContext('2d')!,g=c.createRadialGradient(64,64,0,64,64,64);for(const [at,colour] of stops)g.addColorStop(at,colour);c.fillStyle=g;c.fillRect(0,0,128,128);const t=new T.CanvasTexture(canvas);t.colorSpace=T.SRGBColorSpace;return t;};
interface Bit {p:T.Vector3;v:T.Vector3;life:number;total:number;kind:number;size:number}
/**
 * Wreck presentation at the floating origin: fireball, ground shock ring, tumbling embers and a smoke column
 * that keeps burning until the pilot respawns. Kilometres; purely decorative.
 */
export class CrashFx {
 group=new T.Group();active=false;age=0;
 private fire:T.Sprite;private ring:T.Mesh;private bits:Bit[]=[];private geometry=new T.BufferGeometry();private points:T.Points;private up=new T.Vector3(0,1,0);private drift=new T.Vector3();private capacity=420;private smokeClock=0;
 constructor(){
  this.fire=new T.Sprite(new T.SpriteMaterial({map:glow([[0,'#ffffff'],[.18,'#fff0c0'],[.5,'#ff8a2a'],[.8,'#b0200a66'],[1,'#40000000']]),blending:T.AdditiveBlending,depthWrite:false,transparent:true,toneMapped:false}));
  this.ring=new T.Mesh(new T.RingGeometry(.82,1,64),new T.MeshBasicMaterial({color:0xffffff,transparent:true,depthWrite:false,blending:T.AdditiveBlending,side:T.DoubleSide,toneMapped:false}));
  this.geometry.setAttribute('position',new T.BufferAttribute(new Float32Array(this.capacity*3),3));this.geometry.setAttribute('look',new T.BufferAttribute(new Float32Array(this.capacity*3),3));
  this.points=new T.Points(this.geometry,new T.ShaderMaterial({transparent:true,depthWrite:false,toneMapped:false,uniforms:{scale:{value:600},light:{value:new T.Color(1,1,1)}},
   vertexShader:`#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 look;uniform float scale;varying vec3 vLook;void main(){vLook=look;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=clamp(look.y*scale/max(.001,-mv.z),1.5,420.);gl_Position=projectionMatrix*mv;
 #include <logdepthbuf_vertex>
}`,
   fragmentShader:`#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 light;varying vec3 vLook;void main(){
 #include <logdepthbuf_fragment>
 float d=length(gl_PointCoord-.5)*2.,a=smoothstep(1.,.15,d);
 // look.x: 1 ember, 0 smoke; look.z: remaining life 0..1. Young smoke is lit from inside by the fire.
 vec3 ember=mix(vec3(5.,.7,.1),vec3(10.,6.,2.5),vLook.z)*a;
 vec3 smoke=mix(vec3(.05,.045,.045),vec3(.2,.19,.18),1.-vLook.z)*light+vec3(2.4,.7,.12)*pow(vLook.z,6.);
 gl_FragColor=mix(vec4(smoke,a*.5*smoothstep(0.,.12,vLook.z)),vec4(ember,a*vLook.z),vLook.x);}`}));
  this.points.frustumCulled=false;this.group.add(this.fire,this.ring,this.points);this.group.visible=false;
 }
 /** `up` is the local vertical, `travel` the unit direction the wreck was moving along the ground. */
 trigger(up:T.Vector3,travel:T.Vector3,speed:number){
  this.active=true;this.age=0;this.bits.length=0;this.smokeClock=0;this.up.copy(up).normalize();this.group.visible=true;
  const along=travel.clone().addScaledVector(this.up,-travel.dot(this.up));if(along.lengthSq()<1e-6)along.set(1,0,0).cross(this.up);along.normalize();this.drift.copy(along);
  const throwSpeed=T.MathUtils.clamp(speed*.00035,.03,.22);
  for(let i=0;i<150;i++){const dir=new T.Vector3(Math.random()-.5,Math.random()-.5,Math.random()-.5).normalize();dir.addScaledVector(this.up,Math.abs(dir.dot(this.up))*1.2+.5).addScaledVector(along,1.1).normalize();
   const life=.8+Math.random()*2.6;this.bits.push({p:this.up.clone().multiplyScalar(.004),v:dir.multiplyScalar(throwSpeed*(.25+Math.random())),life,total:life,kind:1,size:.006+Math.random()*.012});}
  this.ring.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),this.up);this.ring.position.copy(this.up).multiplyScalar(.003);
 }
 clear(){this.active=false;this.group.visible=false;this.bits.length=0;}
 update(dt:number,camera:T.PerspectiveCamera,height:number,light:T.Color){
  if(!this.active)return;this.age+=dt;const t=this.age;
  (this.points.material as T.ShaderMaterial).uniforms.scale.value=height*.5/Math.tan(camera.fov*Math.PI/360);(this.points.material as T.ShaderMaterial).uniforms.light.value.copy(light);
  // Fireball: fast bloom, slow rise, then it becomes the base of the fire.
  const burst=Math.min(1,t/1.6),flare=Math.exp(-t*1.5),mat=this.fire.material as T.SpriteMaterial;
  this.fire.position.copy(this.up).multiplyScalar(.012+.05*burst);this.fire.scale.setScalar(.05+.28*Math.sqrt(burst)*flare+.045*(1-flare)*(1+.12*Math.sin(t*23)));
  mat.color.setRGB(1,.62+.2*flare,.3+.4*flare).multiplyScalar(2.2+11*flare);
  const ring=this.ring.material as T.MeshBasicMaterial,grow=1-Math.exp(-t*2.6);this.ring.scale.setScalar(.02+.5*grow);ring.color.setRGB(1,.75,.5).multiplyScalar(2.5*Math.exp(-t*3));ring.opacity=Math.max(0,1-t*.9);this.ring.visible=t<1.3;
  // Smoke column leaning downwind of the slide.
  this.smokeClock+=dt;const every=t<2?.012:.035;
  while(this.smokeClock>every&&this.bits.length<this.capacity){this.smokeClock-=every;const life=5+Math.random()*4,spread=.012+.01*Math.random();
   this.bits.push({p:new T.Vector3(Math.random()-.5,Math.random()-.5,Math.random()-.5).multiplyScalar(spread).addScaledVector(this.up,.006),v:this.up.clone().multiplyScalar(.018+Math.random()*.022).addScaledVector(this.drift,.004+Math.random()*.006),life,total:life,kind:0,size:.03+Math.random()*.03});}
  const position=this.geometry.attributes.position as T.BufferAttribute,look=this.geometry.attributes.look as T.BufferAttribute;let n=0;
  for(const b of this.bits){b.life-=dt;if(b.life<=0)continue;
   if(b.kind){b.v.addScaledVector(this.up,-.00981*dt);b.p.addScaledVector(b.v,dt);const h=b.p.dot(this.up);if(h<.001&&b.v.dot(this.up)<0){b.p.addScaledVector(this.up,.001-h);b.v.addScaledVector(this.up,-1.35*b.v.dot(this.up)).multiplyScalar(.45);}}
   else{b.p.addScaledVector(b.v,dt);b.v.multiplyScalar(Math.exp(-dt*.12));}
   const k=b.life/b.total;position.setXYZ(n,b.p.x,b.p.y,b.p.z);look.setXYZ(n,b.kind,b.kind?b.size:b.size*(1+(1-k)*4.5),k);n++;}
  this.bits=this.bits.filter(b=>b.life>0);this.geometry.setDrawRange(0,n);position.needsUpdate=look.needsUpdate=true;
 }
}
