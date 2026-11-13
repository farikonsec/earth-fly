import * as T from "three";
/** Single-scattering visual approximation in km; not a full spectral/weather model. */
export function atmosphere() {
  const material = new T.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: T.CustomBlending, blendSrc: T.OneFactor, blendDst: T.OneMinusSrcAlphaFactor, blendSrcAlpha: T.OneFactor, blendDstAlpha: T.OneMinusSrcAlphaFactor,
    uniforms: {
      eye: { value: new T.Vector3() },
      inverseProjection: { value: new T.Matrix4() },
      cameraRotation: { value: new T.Matrix4() },
      sunDirection: { value: new T.Vector3() },
      gain: { value: 1.25 },
    },
    vertexShader: `varying vec2 screenUV;void main(){screenUV=uv;gl_Position=vec4(position.xy,0.,1.);}`,
    fragmentShader: `precision highp float;
varying vec2 screenUV;
uniform vec3 eye;uniform mat4 inverseProjection;uniform mat4 cameraRotation;uniform vec3 sunDirection;uniform float gain;
vec2 sphere(vec3 o,vec3 d,float r){float b=dot(o,d),q=b*b-dot(o,o)+r*r;if(q<0.)return vec2(1e8,-1e8);float s=sqrt(q);return vec2(-b-s,-b+s);}
void main(){
  vec4 v=inverseProjection*vec4(screenUV*2.-1.,1.,1.);
  vec3 ray=normalize(mat3(cameraRotation)*v.xyz);
  vec2 shell=sphere(eye,ray,6471.);
  float start=max(0.,shell.x),end=shell.y;
  vec2 ground=sphere(eye,ray,6370.8);
  if(ground.x>0.)end=min(end,ground.x);
  if(end<=start){gl_FragColor=vec4(0.);return;}
  vec3 optical=vec3(0.),light=vec3(0.);
  float mu=dot(ray,sunDirection),phaseR=.75*(1.+mu*mu);
  float g=.76,phaseM=(1.-g*g)/pow(max(.04,1.+g*g-2.*g*mu),1.5);
  vec3 betaR=vec3(.0058,.0135,.0331),betaM=vec3(.004);
  for(int i=0;i<48;i++){
    // Concentrate samples near a low observer, where aerosol density changes fastest.
    float a=float(i)/48.,b=(float(i)+1.)/48.;
    float warp=1.-smoothstep(0.,30.,length(eye)-6371.);
    float ta=mix(a,a*a,warp),tb=mix(b,b*b,warp);
    float stride=(end-start)*(tb-ta);
    vec3 p=eye+ray*(start+(ta+tb)*.5*(end-start));
    float h=max(0.,length(p)-6371.),rhoR=exp(-h/8.5),rhoM=exp(-h/1.2);
    vec3 scatterR=betaR*rhoR,scatterM=betaM*rhoM;
    // Broad ozone absorption centred in the stratosphere.
    vec3 ozone=vec3(.00065,.00188,.000085)*max(0.,1.-abs(h-25.)/15.);
    vec3 segment=(scatterR+scatterM+ozone)*stride;
    vec2 shadow=sphere(p,sunDirection,6370.8);
    float elevation=dot(normalize(p),sunDirection);
    float day=shadow.x>0.?0.:smoothstep(-.15,.12,elevation);
    float sunMass=1./max(.06,elevation+.16);
    vec3 sunTrans=exp(-(betaR*rhoR*8.5+betaM*rhoM*1.2+ozone*15.)*sunMass);
    light+=exp(-optical-segment*.5)*(scatterR*(.012+day*phaseR*1.05)+scatterM*day*phaseM*.3)*stride*sunTrans;
    optical+=segment;
  }
  // Luminance-weighted extinction keeps surface contrast when looking down from altitude.
  float alpha=1.-exp(-dot(optical,vec3(.3,.45,.25)));
  gl_FragColor=vec4(light*gain,clamp(alpha,0.,.995));
}`,
  });
  const scene = new T.Scene();
  scene.add(new T.Mesh(new T.PlaneGeometry(2, 2), material));
  return { scene, material, camera: new T.Camera() };
}
