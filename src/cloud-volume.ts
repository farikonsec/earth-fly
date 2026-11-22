import * as T from "three";

/**
 * Tileable 3D noise for the ray-marched cloud layer.
 * R: low-frequency billow shape (value-noise FBM blended with inverted Worley).
 * G: higher-frequency inverted Worley FBM used to erode edges.
 * Decorative weather only; coverage comes from the bundled static cloud map.
 */
export function cloudNoise(size = 64): T.Data3DTexture {
  let seed = 90127;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const worley = (cells: number) => {
    const points = new Float32Array(cells * cells * cells * 3);
    for (let i = 0; i < points.length; i++) points[i] = random();
    const out = new Float32Array(size * size * size);
    for (let z = 0; z < size; z++)
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const px = (x / size) * cells, py = (y / size) * cells, pz = (z / size) * cells,
            cx = Math.floor(px), cy = Math.floor(py), cz = Math.floor(pz);
          let best = 9;
          for (let k = -1; k <= 1; k++)
            for (let j = -1; j <= 1; j++)
              for (let i = -1; i <= 1; i++) {
                const ix = cx + i, iy = cy + j, iz = cz + k,
                  o = ((((iz % cells) + cells) % cells) * cells * cells + (((iy % cells) + cells) % cells) * cells + (((ix % cells) + cells) % cells)) * 3,
                  dx = ix + points[o] - px, dy = iy + points[o + 1] - py, dz = iz + points[o + 2] - pz,
                  d = dx * dx + dy * dy + dz * dz;
                if (d < best) best = d;
              }
          out[(z * size + y) * size + x] = 1 - Math.min(1, Math.sqrt(best));
        }
    return out;
  };
  const value = (cells: number) => {
    const lattice = new Float32Array(cells * cells * cells);
    for (let i = 0; i < lattice.length; i++) lattice[i] = random();
    const at = (x: number, y: number, z: number) => lattice[((z % cells) * cells + (y % cells)) * cells + (x % cells)];
    const out = new Float32Array(size * size * size);
    for (let z = 0; z < size; z++)
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const px = (x / size) * cells, py = (y / size) * cells, pz = (z / size) * cells,
            ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
          let fx = px - ix, fy = py - iy, fz = pz - iz;
          fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
          const a = at(ix, iy, iz) + (at(ix + 1, iy, iz) - at(ix, iy, iz)) * fx,
            b = at(ix, iy + 1, iz) + (at(ix + 1, iy + 1, iz) - at(ix, iy + 1, iz)) * fx,
            c = at(ix, iy, iz + 1) + (at(ix + 1, iy, iz + 1) - at(ix, iy, iz + 1)) * fx,
            d = at(ix, iy + 1, iz + 1) + (at(ix + 1, iy + 1, iz + 1) - at(ix, iy + 1, iz + 1)) * fx;
          out[(z * size + y) * size + x] = a + (b - a) * fy + (c + (d - c) * fy - (a + (b - a) * fy)) * fz;
        }
    return out;
  };
  const w4 = worley(4), w8 = worley(8), w16 = worley(16), d6 = worley(6), d12 = worley(12), d24 = worley(24),
    v3 = value(3), v6 = value(6), v12 = value(12);
  const data = new Uint8Array(size * size * size * 2);
  for (let i = 0; i < size * size * size; i++) {
    const billow = w4[i] * 0.57 + w8[i] * 0.29 + w16[i] * 0.14,
      soft = v3[i] * 0.55 + v6[i] * 0.3 + v12[i] * 0.15,
      shape = Math.max(0, Math.min(1, soft * 0.62 + billow * 0.62 - 0.14)),
      detail = d6[i] * 0.55 + d12[i] * 0.3 + d24[i] * 0.15;
    data[i * 2] = shape * 255;
    data[i * 2 + 1] = detail * 255;
  }
  const texture = new T.Data3DTexture(data, size, size, size);
  texture.format = T.RGFormat;
  texture.type = T.UnsignedByteType;
  texture.minFilter = texture.magFilter = T.LinearFilter;
  texture.wrapS = texture.wrapT = texture.wrapR = T.RepeatWrapping;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

/** Half-resolution ray march. rgb = in-scattered light, a = transmittance. Distances in km. */
export const cloudFragment = /* glsl */ `
precision highp float;precision highp sampler3D;
varying vec2 vUv;
uniform sampler2D tDepth;uniform sampler3D noiseMap;uniform sampler2D weatherMap;uniform sampler2D elevationMap;
uniform mat4 inverseProjection;uniform mat4 cameraWorld;
uniform vec3 eye;uniform vec3 eyeNoise;uniform vec3 sunDirection;uniform vec3 sunLight;uniform vec3 skyLight;uniform vec3 hazeColor;
uniform float spin;uniform float depthScale;uniform float hazeK;uniform float fade;uniform float shellTop;uniform float time;
const float R=6371.;const float BASE=1.05;
vec2 sphere(vec3 o,vec3 d,float r){float b=dot(o,d),q=b*b-dot(o,o)+r*r;if(q<0.)return vec2(1e8,-1e8);float s=sqrt(q);return vec2(-b-s,-b+s);}
vec3 toBody(vec3 v){float c=cos(spin),s=sin(spin);return vec3(c*v.x-s*v.z,v.y,s*v.x+c*v.z);}
float remap(float v,float a,float b){return clamp((v-a)/max(1e-4,b-a),0.,1.);}
// Returns density; hf receives the 0..1 height inside the local cloud column.
float density(vec3 p,vec3 q,bool fine,out float hf){
  float r=length(p);vec3 d=p/r;
  vec2 uv=vec2(.5+atan(-d.z,d.x)/6.28318530718,.5+asin(clamp(d.y,-1.,1.))/3.14159265359);
  float cov=textureLod(weatherMap,uv,0.).r;
  float ground=max(0.,textureLod(elevationMap,vec2(uv.x,1.-uv.y),0.).r)*.001;
  float big=textureLod(noiseMap,q/48.+vec3(.37,.11,.73),0.).r;
  // Polar ice in the static map is not cloud; always leave gaps a pilot can fly through.
  cov*=1.-.7*smoothstep(.8,.94,abs(d.y));
  cov=min(.8,clamp(cov*1.7+(big-.5)*.95+.14,0.,1.));
  float base=BASE+ground*1.02+big*.35,thick=mix(.7,3.4,smoothstep(.15,.9,cov));
  hf=(r-R-base)/thick;
  if(hf<=0.||hf>=1.||cov<.02)return 0.;
  float shape=textureLod(noiseMap,q/7.5,0.).r;
  // Flat-ish bases, rounded tops, anvils discouraged.
  float profile=smoothstep(0.,.1,hf)*smoothstep(1.,.35+.4*cov,hf);
  float v=remap(shape*profile,1.-cov*.92,1.)*(.55+.45*smoothstep(0.,.3,hf));
  if(v<=0.)return 0.;
  if(fine){float detail=textureLod(noiseMap,q/1.45+vec3(0.,time*.004,0.),0.).g;v=remap(v,detail*.34*(1.15-hf),1.);}
  return v;
}
float hg(float mu,float g){float k=1.+g*g-2.*g*mu;return (1.-g*g)/(12.566*k*sqrt(k));}
void main(){
  vec4 v=inverseProjection*vec4(vUv*2.-1.,1.,1.);
  vec3 rayView=normalize(v.xyz),ray=normalize(mat3(cameraWorld)*rayView);
  float depth=texture2D(tDepth,vUv).r,limit=260.;
  if(depth<.99999)limit=min(limit,(exp2(depth*depthScale)-1.)/max(.05,-rayView.z));
  else{vec2 ground=sphere(eye,ray,R-.03);if(ground.x>0.)limit=min(limit,ground.x);}
  vec2 outer=sphere(eye,ray,R+shellTop),inner=sphere(eye,ray,R+BASE);
  float start=max(0.,outer.x),end=min(limit,outer.y);
  float height=length(eye)-R;
  if(height<BASE)start=max(start,inner.y);else if(inner.x>0.)end=min(end,inner.x);
  if(end<=start||fade<=.001){gl_FragColor=vec4(0.,0.,0.,1.);return;}
  float dither=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));
  vec3 eyeBody=toBody(eye),rayBody=toBody(ray),sunBody=toBody(sunDirection);
  float mu=dot(ray,sunDirection),phase=mix(hg(mu,.72),hg(mu,-.18),.4)*12.566*.55+.45;
  float t=start,trans=1.;vec3 light=vec3(0.);float hf;
  float step0=max(.06,start*.05);t+=step0*dither;
  for(int i=0;i<88;i++){
    if(t>=end||trans<.025)break;
    float stride=max(.06,t*.058);
    vec3 p=eyeBody+rayBody*t,q=eyeNoise+rayBody*t;
    float d=density(p,q,t<60.,hf);
    if(d>0.){
      float od=0.,lh;
      for(int j=0;j<4;j++){float s=.09*exp2(float(j)*1.25);od+=density(p+sunBody*s,q+sunBody*s,false,lh)*s*(j==3?2.2:1.);}
      float sigma=d*11.;
      // Beer-Lambert with a soft multiple-scattering lift and a powder term on sun-facing edges.
      float beer=max(exp(-od*9.),exp(-od*2.2)*.42);
      float powder=1.-exp(-d*6.)*.65;
      vec3 ambient=skyLight*mix(.38,1.,hf)*(.75+.25*exp(-od*3.));
      vec3 lit=sunLight*beer*powder*phase+ambient;
      lit=mix(hazeColor,lit,exp(-t*hazeK));
      float a=(1.-exp(-sigma*stride))*(1.-smoothstep(170.,250.,t));
      light+=trans*a*lit;trans*=1.-a;
    }
    t+=stride;
  }
  light*=fade;trans=mix(1.,trans,fade);
  gl_FragColor=vec4(light,trans);
}`;
