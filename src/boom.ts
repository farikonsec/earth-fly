import * as T from 'three';

/**
 * Sonic boom splash: a vapour cone that snaps into being around the aircraft as it passes Mach 1 and is left
 * behind, plus a thin shock disc racing outward. Kilometres, at the floating origin; decorative only.
 */
export class BoomFx {
 group=new T.Group();age=9;private cone:T.Mesh;private disc:T.Mesh;private axis=new T.Vector3(0,0,-1);
 constructor(){
  const make=(fragment:string)=>new T.ShaderMaterial({transparent:true,depthWrite:false,side:T.DoubleSide,toneMapped:false,uniforms:{strength:{value:0},tint:{value:new T.Color(1,1,1)}},
   vertexShader:`#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;varying vec3 vN;varying vec3 vV;void main(){vUv=uv;vec4 mv=modelViewMatrix*vec4(position,1.);vN=normalize(normalMatrix*normal);vV=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;
 #include <logdepthbuf_vertex>
}`,
   fragmentShader:`#include <common>
#include <logdepthbuf_pars_fragment>
uniform float strength;uniform vec3 tint;varying vec2 vUv;varying vec3 vN;varying vec3 vV;
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);}
void main(){
 #include <logdepthbuf_fragment>
 ${fragment}
}`});
  // Open cone, apex toward the nose. uv.y runs from the wide trailing edge (0) to the apex (1).
  const coneGeometry=new T.ConeGeometry(1,1,48,8,true).rotateX(-Math.PI/2);
  this.cone=new T.Mesh(coneGeometry,make(`float along=vUv.y,puff=noise(vec2(vUv.x*26.,along*5.))*.6+noise(vec2(vUv.x*61.,along*13.))*.4;
 float body=smoothstep(0.,.12,along)*smoothstep(.95,.35,along),edge=.35+.65*pow(1.-abs(dot(normalize(vN),normalize(vV))),1.5);
 float a=body*edge*(.45+.75*puff)*strength;gl_FragColor=vec4(tint*1.6,clamp(a,0.,1.));`));
  this.disc=new T.Mesh(new T.RingGeometry(.86,1,96),make(`float r=(length(vUv-.5)*2.-.86)/.14;float a=sin(clamp(r,0.,1.)*3.14159)*strength;gl_FragColor=vec4(tint*2.4,clamp(a,0.,1.));`));
  this.group.add(this.cone,this.disc);this.group.visible=false;
 }
 /** `travel` is the unit air-relative direction of flight in scene axes. */
 trigger(travel:T.Vector3){this.age=0;this.axis.copy(travel).normalize();this.group.visible=true;this.group.quaternion.setFromUnitVectors(new T.Vector3(0,0,-1),this.axis);}
 update(dt:number,speedKm:number,light:T.Color){
  if(this.age>2.2){this.group.visible=false;return;}this.age+=dt;const t=this.age;
  // The cone holds on the aircraft for an instant, then falls behind at flight speed while it swells and thins.
  const lag=Math.max(0,t-.18)*Math.min(speedKm,.45),grow=1-Math.exp(-t*5);
  this.cone.position.set(0,0,.012+lag);this.cone.scale.set(.03+.05*grow+t*.03,.03+.05*grow+t*.03,.05+.03*grow);
  (this.cone.material as T.ShaderMaterial).uniforms.strength.value=Math.min(1,t*14)*Math.exp(-t*2.6)*1.25;
  this.disc.position.set(0,0,.004+lag*.6);this.disc.scale.setScalar(.03+t*.55);
  (this.disc.material as T.ShaderMaterial).uniforms.strength.value=Math.exp(-t*4.5)*.9;
  for(const m of [this.cone,this.disc])((m.material as T.ShaderMaterial).uniforms.tint.value as T.Color).copy(light).multiplyScalar(.35).addScalar(.5);
 }
}
