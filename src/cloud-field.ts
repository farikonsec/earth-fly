import * as T from 'three';
import {latLonToDir,dirToLatLon,inertialToBody,bodyToInertial} from './geo';
import {EARTH} from './earth';
import type {V}from'./vector';
/** Decorative, stable geographic cumulus patches; not live weather. One instanced draw. */
export class CloudField {
 mesh:T.InstancedMesh;private anchor='';private points:{p:V;size:number;seed:number}[]=[];
 private material:T.ShaderMaterial;
 constructor(){this.material=new T.ShaderMaterial({transparent:true,depthWrite:false,side:T.DoubleSide,uniforms:{light:{value:new T.Vector3()},ambient:{value:1}},vertexShader:`attribute mat4 instanceMatrix;varying vec2 cloudUV;varying float variation;void main(){cloudUV=uv;variation=instanceMatrix[3].w;vec4 center=modelViewMatrix*vec4(instanceMatrix[3].xyz,1.);center.xy+=position.xy*instanceMatrix[0].x;gl_Position=projectionMatrix*center;}`,fragmentShader:`precision highp float;varying vec2 cloudUV;varying float variation;uniform vec3 light;uniform float ambient;
 float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
 void main(){vec2 p=(cloudUV-.5)*vec2(2.,2.8);float n=noise(p*3.+variation)*.5+noise(p*7.-variation)*.25+noise(p*14.)*.125;float edge=1.-dot(p,p)+n*.6;float a=smoothstep(.1,.65,edge)*.72;if(a<.01)discard;vec3 shade=mix(vec3(.31,.4,.48),vec3(.98,.98,.94),smoothstep(-.8,.8,p.y+n*.5));gl_FragColor=vec4(shade*ambient,a);}`});
  // Three injects instanceMatrix automatically when USE_INSTANCING is enabled.
  this.material.vertexShader=this.material.vertexShader.replace('attribute mat4 instanceMatrix;','');
  this.mesh=new T.InstancedMesh(new T.PlaneGeometry(1,1),this.material,90);this.mesh.frustumCulled=false;this.mesh.renderOrder=5;
 }
 update(p:V,time:number,light:T.Vector3,ground:(lat:number,lon:number)=>number){const loc=dirToLatLon(inertialToBody(p,time,EARTH.rotation)),alt=(Math.hypot(...p)-EARTH.radius)*1000;
  this.mesh.visible=alt<50000&&Math.abs(loc.lat)<72;if(!this.mesh.visible)return;
  const cx=Math.floor(loc.lon/.3),cy=Math.floor(loc.lat/.3),key=`${cx}/${cy}`;
  if(key!==this.anchor){this.anchor=key;this.points=[];for(let y=-2;y<=2;y++)for(let x=-2;x<=2;x++){let seed=Math.sin((cx+x)*127.1+(cy+y)*311.7)*43758.5453;seed-=Math.floor(seed);if(seed<.38)continue;const lat=(cy+y+.5)*.3,lon=(cx+x+.5)*.3,h=Math.max(2300,ground(lat,lon)+1300);for(let k=0;k<3;k++){const dir=latLonToDir(lat+k*.006,lon+k*.012);this.points.push({p:dir.map(v=>v*(EARTH.radius+h/1000))as V,size:1.4+seed*1.8,seed:seed*10+k});}}}
  const sorted=this.points.map(o=>({...o,relative:new T.Vector3(...bodyToInertial(o.p,time,EARTH.rotation)).sub(new T.Vector3(...p))})).sort((a,b)=>b.relative.lengthSq()-a.relative.lengthSq());
  this.mesh.count=sorted.length;const matrix=new T.Matrix4();sorted.forEach((o,i)=>{matrix.makeScale(o.size,o.size,o.size).setPosition(o.relative);matrix.elements[15]=o.seed;this.mesh.setMatrixAt(i,matrix);});this.mesh.instanceMatrix.needsUpdate=true;
  const day=new T.Vector3(...p).normalize().dot(light);this.material.uniforms.ambient.value=.15+.85*T.MathUtils.smoothstep(day,-.1,.2);
 }
}
