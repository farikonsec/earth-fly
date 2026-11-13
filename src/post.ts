import * as T from "three";
import { cloudFragment, cloudNoise } from "./cloud-volume";
import { nukeFragment, type NukeFrame } from "./nuke";

const VERT = `varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`;
const pass = (fragmentShader: string, uniforms: Record<string, T.IUniform>) =>
  new T.ShaderMaterial({ vertexShader: VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false, blending: T.NoBlending, toneMapped: false });
const hdr = (w: number, h: number) => {
  const target = new T.WebGLRenderTarget(w, h, { type: T.HalfFloatType, depthBuffer: false, magFilter: T.LinearFilter, minFilter: T.LinearFilter });
  target.texture.generateMipmaps = false;
  return target;
};

export interface PostFrame {
  camera: T.PerspectiveCamera;
  eye: T.Vector3;
  eyeNoise: T.Vector3;
  spin: number;
  sunDirection: T.Vector3;
  sunLight: T.Color;
  skyLight: T.Color;
  hazeColor: T.Color;
  hazeK: number;
  cloudFade: number;
  shellTop: number;
  time: number;
  exposure: number;
  speedBlur: number;
  shock: number;
  shockCentre: T.Vector2;
  sunScreen: T.Vector3;
  flash: number;
  damage: number;
  warp: number;
  nuke?: NukeFrame | null;
}

/** HDR scene target, ray-marched clouds, bloom, lens response and filmic output. */
export class PostFX {
  scene: T.WebGLRenderTarget;
  enabled = true;
  clouds = true;
  private cloudTarget: T.WebGLRenderTarget;
  private merged: T.WebGLRenderTarget;
  private down: T.WebGLRenderTarget[] = [];
  private up: T.WebGLRenderTarget[] = [];
  private quad = new T.Mesh(new T.PlaneGeometry(2, 2));
  private quadScene = new T.Scene();
  private quadCamera = new T.Camera();
  private cloudPass: T.ShaderMaterial;
  private nukePass: T.ShaderMaterial;
  private nukeTarget: T.WebGLRenderTarget;
  private nukeWarm = false;
  private mergePass: T.ShaderMaterial;
  private brightPass: T.ShaderMaterial;
  private downPass: T.ShaderMaterial;
  private upPass: T.ShaderMaterial;
  private finalPass: T.ShaderMaterial;
  readonly levels = 6;
  constructor(private renderer: T.WebGLRenderer, weather: { value: T.Texture | null }, elevation: { value: T.Texture | null }) {
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    const size = renderer.getDrawingBufferSize(new T.Vector2());
    this.scene = new T.WebGLRenderTarget(size.x, size.y, { type: T.HalfFloatType, samples: 4, depthTexture: new T.DepthTexture(size.x, size.y) });
    this.scene.texture.generateMipmaps = false;
    this.cloudTarget = hdr(1, 1);
    this.merged = hdr(1, 1);
    this.nukeTarget = hdr(1, 1);
    for (let i = 0; i < this.levels; i++) { this.down.push(hdr(1, 1)); this.up.push(hdr(1, 1)); }
    this.cloudPass = pass(cloudFragment, {
      tDepth: { value: this.scene.depthTexture }, noiseMap: { value: cloudNoise() }, weatherMap: weather, elevationMap: elevation,
      inverseProjection: { value: new T.Matrix4() }, cameraWorld: { value: new T.Matrix4() },
      eye: { value: new T.Vector3() }, eyeNoise: { value: new T.Vector3() }, sunDirection: { value: new T.Vector3() },
      sunLight: { value: new T.Color() }, skyLight: { value: new T.Color() }, hazeColor: { value: new T.Color() },
      spin: { value: 0 }, depthScale: { value: 1 }, hazeK: { value: 0.01 }, fade: { value: 1 }, shellTop: { value: 6 }, time: { value: 0 },
    });
    this.nukePass = pass(nukeFragment, {
      tDepth: { value: this.scene.depthTexture }, noiseMap: this.cloudPass.uniforms.noiseMap,
      inverseProjection: { value: new T.Matrix4() }, cameraWorld: { value: new T.Matrix4() },
      centre: { value: new T.Vector3(0, -50, 0) }, axisX: { value: new T.Vector3(1, 0, 0) }, axisY: { value: new T.Vector3(0, 1, 0) }, axisZ: { value: new T.Vector3(0, 0, 1) },
      sunDirection: { value: new T.Vector3(0, 1, 0) }, sunLight: { value: new T.Color() }, skyLight: { value: new T.Color() }, hazeColor: { value: new T.Color() }, fire: { value: new T.Vector3(1, 1, 1) },
      depthScale: { value: 1 }, hazeK: { value: 0.01 }, age: { value: 30 }, fade: { value: 1 },
      cap: { value: new T.Vector4(3, 1, 0.6, 1) }, stem: { value: new T.Vector4(0.4, 1, 0, 0) }, surge: { value: new T.Vector4(2, 0.3, 1, 1) }, shock: { value: new T.Vector4(5, 1, 1, 2.6) }, bound: { value: new T.Vector2(2, 4) },
    });
    this.mergePass = pass(/* glsl */ `precision highp float;varying vec2 vUv;uniform sampler2D tScene;uniform sampler2D tCloud;uniform sampler2D tNuke;uniform sampler2D tDepth;uniform vec2 cloudTexel;uniform float cloudOn;uniform float nukeOn;
void main(){
  vec3 scene=texture2D(tScene,vUv).rgb;
  if(cloudOn<.5&&nukeOn<.5){gl_FragColor=vec4(scene,1.);return;}
  // Depth-aware upsample keeps half-resolution cloud from haloing around the aircraft and ridges.
  float depth=texture2D(tDepth,vUv).r;
  vec2 cell=vUv/cloudTexel-.5,base=(floor(cell)+.5)*cloudTexel,f=fract(cell);
  vec4 sum=vec4(0.),blast=vec4(0.);float weight=0.;
  for(int i=0;i<4;i++){vec2 o=vec2(float(i-(i/2)*2),float(i/2)),uv=base+o*cloudTexel;
    float w=mix(1.-f.x,f.x,o.x)*mix(1.-f.y,f.y,o.y)/(1e-5+abs(texture2D(tDepth,uv).r-depth)*4000.);
    if(cloudOn>.5)sum+=texture2D(tCloud,uv)*w;if(nukeOn>.5)blast+=texture2D(tNuke,uv)*w;weight+=w;}
  if(cloudOn>.5){vec4 cloud=sum/max(weight,1e-8);scene=scene*cloud.a+cloud.rgb;}
  if(nukeOn>.5){vec4 n=blast/max(weight,1e-8);scene=scene*n.a+n.rgb;}
  gl_FragColor=vec4(scene,1.);
}`, { tScene: { value: this.scene.texture }, tCloud: { value: this.cloudTarget.texture }, tNuke: { value: this.nukeTarget.texture }, nukeOn: { value: 0 }, tDepth: { value: this.scene.depthTexture }, cloudTexel: { value: new T.Vector2() }, cloudOn: { value: 1 } });
    this.brightPass = pass(/* glsl */ `precision highp float;varying vec2 vUv;uniform sampler2D tMap;uniform vec2 texel;
vec3 soft(vec3 c){float l=max(c.r,max(c.g,c.b)),k=clamp(l-.85,0.,.6);float w=max(l-1.15,k*k/2.4)/max(l,1e-4);return min(c*w,vec3(24.));}
void main(){vec3 a=soft(texture2D(tMap,vUv+texel*vec2(-1.,-1.)).rgb),b=soft(texture2D(tMap,vUv+texel*vec2(1.,-1.)).rgb),c=soft(texture2D(tMap,vUv+texel*vec2(-1.,1.)).rgb),d=soft(texture2D(tMap,vUv+texel*vec2(1.,1.)).rgb);
  // Karis-style weighting stops single hot pixels from flickering.
  float wa=1./(1.+max(a.r,max(a.g,a.b))),wb=1./(1.+max(b.r,max(b.g,b.b))),wc=1./(1.+max(c.r,max(c.g,c.b))),wd=1./(1.+max(d.r,max(d.g,d.b)));
  gl_FragColor=vec4((a*wa+b*wb+c*wc+d*wd)/(wa+wb+wc+wd),1.);}`, { tMap: { value: null }, texel: { value: new T.Vector2() } });
    this.downPass = pass(/* glsl */ `precision highp float;varying vec2 vUv;uniform sampler2D tMap;uniform vec2 texel;
void main(){vec3 c=texture2D(tMap,vUv).rgb*4.;c+=texture2D(tMap,vUv+texel*vec2(-1.,-1.)).rgb+texture2D(tMap,vUv+texel*vec2(1.,-1.)).rgb+texture2D(tMap,vUv+texel*vec2(-1.,1.)).rgb+texture2D(tMap,vUv+texel*vec2(1.,1.)).rgb;gl_FragColor=vec4(c/8.,1.);}`, { tMap: { value: null }, texel: { value: new T.Vector2() } });
    this.upPass = pass(/* glsl */ `precision highp float;varying vec2 vUv;uniform sampler2D tMap;uniform sampler2D tBase;uniform vec2 texel;uniform float spread;
void main(){vec3 c=texture2D(tMap,vUv+texel*vec2(-1.,0.)).rgb+texture2D(tMap,vUv+texel*vec2(1.,0.)).rgb+texture2D(tMap,vUv+texel*vec2(0.,-1.)).rgb+texture2D(tMap,vUv+texel*vec2(0.,1.)).rgb;
  c=c*2.+texture2D(tMap,vUv+texel*vec2(-1.,-1.)).rgb+texture2D(tMap,vUv+texel*vec2(1.,-1.)).rgb+texture2D(tMap,vUv+texel*vec2(-1.,1.)).rgb+texture2D(tMap,vUv+texel*vec2(1.,1.)).rgb;
  gl_FragColor=vec4(texture2D(tBase,vUv).rgb+c/12.*spread,1.);}`, { tMap: { value: null }, tBase: { value: null }, texel: { value: new T.Vector2() }, spread: { value: 0.8 } });
    this.finalPass = pass(/* glsl */ `precision highp float;varying vec2 vUv;
uniform sampler2D tScene;uniform sampler2D tBloom;uniform float exposure;uniform float time;uniform float aspect;
uniform float speedBlur;uniform float shock;uniform vec2 shockCentre;uniform vec3 sunScreen;uniform float flash;uniform float damage;uniform float warp;
vec3 fit(vec3 v){vec3 a=v*(v+.0245786)-.000090537,b=v*(.983729*v+.432951)+.238081;return a/b;}
vec3 aces(vec3 c){c*=exposure/.6;c=mat3(.59719,.076,.0284,.35458,.90834,.13383,.04823,.01566,.83777)*c;c=fit(c);return clamp(mat3(1.60475,-.10208,-.00327,-.53108,1.10813,-.07276,-.07367,-.00605,1.07602)*c,0.,1.);}
vec3 encode(vec3 c){return mix(c*12.92,1.055*pow(c,vec3(1./2.4))-.055,step(.0031308,c));}
float hash(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
vec3 sampleScene(vec2 uv){return texture2D(tScene,uv).rgb+texture2D(tBloom,uv).rgb*.085;}
void main(){
  vec2 uv=vUv,centred=(uv-.5)*vec2(aspect,1.);
  // Expanding refraction ring for the transonic crossing.
  if(shock>0.){vec2 d=(uv-shockCentre)*vec2(aspect,1.);float r=length(d),ring=shock*1.35,band=exp(-pow((r-ring)/.045,2.))*(1.-shock);uv-=normalize(d+1e-5)/vec2(aspect,1.)*band*.035;}
  vec3 color;
  float radial=length(centred);
  if(speedBlur>.002){
    // Radial streaking keeps the centre sharp so the aircraft and reticle stay readable.
    vec2 dir=(uv-.5)*speedBlur*.11*smoothstep(.12,.75,radial);float j=hash(gl_FragCoord.xy+time)-.5;color=vec3(0.);
    // Six taps of the scene plus one bloom read: bloom is already soft, so streaking it adds cost and no detail.
    for(int i=0;i<6;i++)color+=texture2D(tScene,uv-dir*(float(i)+j)/6.).rgb;color=color/6.+texture2D(tBloom,uv).rgb*.085;
  }else color=sampleScene(uv);
  // Slight lateral chromatic fringing toward the frame edge.
  // Only the warp drive bends the lens; normal flight stays crisp.
  float fringe=.0016*radial*radial*warp;
  if(warp>0.){color.r=mix(color.r,sampleScene(uv+(uv-.5)*fringe*2.).r,.85);color.b=mix(color.b,sampleScene(uv-(uv-.5)*fringe*2.).b,.85);}
  // Lens ghosts and a faint anamorphic streak when the sun is in or near frame.
  if(sunScreen.z>.001){vec2 s=(sunScreen.xy-.5)*vec2(aspect,1.),axis=-s;float g=0.;
    for(int i=1;i<5;i++){float k=float(i)*.42-.15,size=.035+.03*float(i);float d=length(centred-(s+axis*k*2.));g+=smoothstep(size,size*.55,d)*.012*(1.+float(i)*.35)+smoothstep(.006,0.,abs(d-size))*.01;}
    float streak=exp(-abs(centred.y-s.y)*90.)*exp(-abs(centred.x-s.x)*2.2)*.05;
    float halo=exp(-length(centred-s)*5.5)*.16;
    color+=vec3(1.,.9,.74)*(g*vec3(.7,.95,1.2)+streak*vec3(.6,.8,1.4)+halo)*sunScreen.z;}
  color+=vec3(1.,.93,.8)*flash*(.5+.5*smoothstep(.9,0.,radial));
  color=aces(color);
  // Filmic grade: gentle teal lift in shadows, warm highlights, restrained saturation boost.
  float luma=dot(color,vec3(.2126,.7152,.0722));
  color=mix(vec3(luma),color,1.09);
  color+=vec3(-.006,.002,.012)*(1.-smoothstep(0.,.35,luma));
  color*=mix(vec3(1.),vec3(1.025,1.,.965),smoothstep(.5,1.,luma));
  color*=1.-smoothstep(.55,1.25,radial)*.34;
  color=mix(color,vec3(.55,.03,.02),damage*smoothstep(.45,1.05,radial)*.75);
  color=encode(clamp(color,0.,1.));
  color+=(hash(gl_FragCoord.xy+fract(time)*61.)-.5)*.016;
  gl_FragColor=vec4(color,1.);
}`, { tScene: { value: this.merged.texture }, tBloom: { value: null }, exposure: { value: 1.25 }, time: { value: 0 }, aspect: { value: 1 }, speedBlur: { value: 0 }, shock: { value: 0 }, shockCentre: { value: new T.Vector2(0.5, 0.5) }, sunScreen: { value: new T.Vector3() }, flash: { value: 0 }, damage: { value: 0 }, warp: { value: 0 } });
    this.resize();
  }
  resize() {
    const size = this.renderer.getDrawingBufferSize(new T.Vector2()), w = Math.max(2, size.x), h = Math.max(2, size.y);
    this.scene.setSize(w, h);
    this.merged.setSize(w, h);
    const cw = Math.max(1, Math.round(w / 2)), ch = Math.max(1, Math.round(h / 2));
    this.cloudTarget.setSize(cw, ch);
    this.nukeTarget.setSize(cw, ch);
    this.mergePass.uniforms.cloudTexel.value.set(1 / cw, 1 / ch);
    let bw = w, bh = h;
    for (let i = 0; i < this.levels; i++) {
      bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
      this.down[i].setSize(bw, bh); this.up[i].setSize(bw, bh);
    }
  }
  begin() {
    this.renderer.setRenderTarget(this.enabled ? this.scene : null);
    this.renderer.clear();
  }
  private draw(material: T.ShaderMaterial, target: T.WebGLRenderTarget | null) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCamera);
  }
  finish(frame: PostFrame) {
    if (!this.enabled) return;
    const cloudsOn = this.clouds && frame.cloudFade > 0.001;
    if (cloudsOn) {
      const u = this.cloudPass.uniforms;
      u.inverseProjection.value.copy(frame.camera.projectionMatrixInverse);
      u.cameraWorld.value.copy(frame.camera.matrixWorld);
      u.eye.value.copy(frame.eye); u.eyeNoise.value.copy(frame.eyeNoise); u.sunDirection.value.copy(frame.sunDirection);
      u.sunLight.value.copy(frame.sunLight); u.skyLight.value.copy(frame.skyLight); u.hazeColor.value.copy(frame.hazeColor);
      u.spin.value = frame.spin; u.depthScale.value = Math.log2(frame.camera.far + 1); u.hazeK.value = frame.hazeK;
      u.fade.value = frame.cloudFade; u.shellTop.value = frame.shellTop; u.time.value = frame.time;
      this.draw(this.cloudPass, this.cloudTarget);
    }
    const nuke = frame.nuke ?? null;
    // The first frame draws the pass once with stand-in values so its shader is compiled before a bomb goes off.
    if (nuke || !this.nukeWarm) {
      const u = this.nukePass.uniforms; this.nukeWarm = true;
      u.inverseProjection.value.copy(frame.camera.projectionMatrixInverse); u.cameraWorld.value.copy(frame.camera.matrixWorld);
      u.sunDirection.value.copy(frame.sunDirection); u.sunLight.value.copy(frame.sunLight); u.skyLight.value.copy(frame.skyLight); u.hazeColor.value.copy(frame.hazeColor);
      u.depthScale.value = Math.log2(frame.camera.far + 1); u.hazeK.value = frame.hazeK;
      if (nuke) {
        u.centre.value.copy(nuke.centre); u.axisX.value.copy(nuke.axisX); u.axisY.value.copy(nuke.axisY); u.axisZ.value.copy(nuke.axisZ);
        u.age.value = nuke.age; u.fade.value = nuke.fade; u.cap.value.copy(nuke.cap); u.stem.value.copy(nuke.stem); u.surge.value.copy(nuke.surge); u.shock.value.copy(nuke.shock); u.fire.value.copy(nuke.fire); u.bound.value.copy(nuke.bound);
      }
      this.draw(this.nukePass, this.nukeTarget);
    }
    this.mergePass.uniforms.nukeOn.value = nuke ? 1 : 0;
    this.mergePass.uniforms.cloudOn.value = cloudsOn ? 1 : 0;
    this.draw(this.mergePass, this.merged);
    const texel = (t: T.WebGLRenderTarget, scale = 1) => new T.Vector2(scale / t.width, scale / t.height);
    this.brightPass.uniforms.tMap.value = this.merged.texture;
    this.brightPass.uniforms.texel.value.copy(texel(this.merged, 0.5));
    this.draw(this.brightPass, this.down[0]);
    for (let i = 1; i < this.levels; i++) {
      this.downPass.uniforms.tMap.value = this.down[i - 1].texture;
      this.downPass.uniforms.texel.value.copy(texel(this.down[i - 1]));
      this.draw(this.downPass, this.down[i]);
    }
    for (let i = this.levels - 2; i >= 0; i--) {
      const source = i === this.levels - 2 ? this.down[i + 1] : this.up[i + 1];
      this.upPass.uniforms.tMap.value = source.texture;
      this.upPass.uniforms.tBase.value = this.down[i].texture;
      this.upPass.uniforms.texel.value.copy(texel(source));
      this.draw(this.upPass, this.up[i]);
    }
    const f = this.finalPass.uniforms;
    f.tBloom.value = this.up[0].texture; f.exposure.value = frame.exposure; f.time.value = frame.time % 1000;
    f.aspect.value = frame.camera.aspect; f.speedBlur.value = frame.speedBlur; f.shock.value = frame.shock;
    f.shockCentre.value.copy(frame.shockCentre); f.sunScreen.value.copy(frame.sunScreen); f.flash.value = frame.flash;
    f.damage.value = frame.damage; f.warp.value = frame.warp;
    this.draw(this.finalPass, null);
  }
}
