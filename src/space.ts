import * as T from "three";

/** Procedural star field with a magnitude and colour distribution. Decorative, not a catalogue. */
export function createStars(count = 9000) {
  let seed = 374;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const position = new Float32Array(count * 3), tint = new Float32Array(count * 3), magnitude = new Float32Array(count);
  const galactic = new T.Vector3(0.48, 0.74, 0.47).normalize();
  for (let i = 0; i < count; i++) {
    let direction = new T.Vector3();
    // Rejection sampling thickens the field toward the galactic plane.
    for (let attempt = 0; attempt < 6; attempt++) {
      const y = random() * 2 - 1, a = random() * Math.PI * 2, s = Math.sqrt(1 - y * y);
      direction.set(s * Math.cos(a), y, s * Math.sin(a));
      if (random() < 0.3 + 0.7 * Math.exp(-Math.pow(direction.dot(galactic) / 0.28, 2))) break;
    }
    position.set(direction.multiplyScalar(200000).toArray(), i * 3);
    const m = Math.pow(random(), 7), warmth = random();
    magnitude[i] = 0.35 + m * 3.2;
    const colour = warmth < 0.18 ? [1, 0.72, 0.52] : warmth < 0.5 ? [1, 0.93, 0.82] : warmth < 0.85 ? [0.92, 0.95, 1] : [0.7, 0.8, 1];
    tint.set(colour, i * 3);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.BufferAttribute(position, 3));
  geometry.setAttribute("tint", new T.BufferAttribute(tint, 3));
  geometry.setAttribute("magnitude", new T.BufferAttribute(magnitude, 1));
  const material = new T.ShaderMaterial({
    transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false,
    uniforms: { opacity: { value: 1 }, pixelRatio: { value: 1 }, time: { value: 0 }, twinkle: { value: 0 } },
    vertexShader: `#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 tint;attribute float magnitude;uniform float pixelRatio;uniform float time;uniform float twinkle;varying vec3 vTint;varying float vGlow;
void main(){vTint=tint;float flicker=1.+twinkle*.35*sin(time*7.+position.x*.01+position.z*.013);vGlow=magnitude*flicker;
  gl_PointSize=(1.1+magnitude*.95)*pixelRatio;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
  #include <logdepthbuf_vertex>
}`,
    fragmentShader: `#include <common>
#include <logdepthbuf_pars_fragment>
uniform float opacity;varying vec3 vTint;varying float vGlow;
void main(){
  #include <logdepthbuf_fragment>
  float d=length(gl_PointCoord-.5)*2.;float core=smoothstep(1.,.15,d);gl_FragColor=vec4(vTint*core*core*vGlow*opacity*.9,1.);}`,
  });
  const points = new T.Points(geometry, material);
  points.frustumCulled = false;
  return points;
}

/** Soft procedural galactic band behind the stars. */
export function createMilkyWay() {
  const material = new T.ShaderMaterial({
    side: T.BackSide, transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false,
    uniforms: { opacity: { value: 1 } },
    vertexShader: `#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vDirection;void main(){vDirection=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
  #include <logdepthbuf_vertex>
}`,
    fragmentShader: `#include <common>
#include <logdepthbuf_pars_fragment>
uniform float opacity;varying vec3 vDirection;
float hash(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm(vec3 p){float a=.5,s=0.;for(int i=0;i<5;i++){s+=a*noise(p);p=p*2.03+7.1;a*=.5;}return s;}
void main(){
  #include <logdepthbuf_fragment>
  if(opacity<.003)discard;
  vec3 d=normalize(vDirection),pole=normalize(vec3(.48,.74,.47)),core=normalize(cross(pole,vec3(0.,1.,0.)));
  float latitude=dot(d,pole),towardCore=dot(d,core)*.5+.5;
  float band=exp(-pow(latitude/(.1+.11*towardCore),2.));
  float dust=fbm(d*5.5+vec3(3.1,0.,1.7)),lane=smoothstep(.38,.62,fbm(d*11.+dust*1.6));
  float cloud=band*(.35+.9*dust)*(.45+.85*towardCore)*mix(1.,.28,lane*exp(-pow(latitude/.05,2.)));
  vec3 colour=mix(vec3(.42,.5,.78),vec3(1.,.82,.62),towardCore*towardCore*band)*cloud*.05;
  colour+=vec3(.012,.016,.03)*fbm(d*2.2)*.5;
  gl_FragColor=vec4(colour*opacity,1.);}`,
  });
  const mesh = new T.Mesh(new T.SphereGeometry(190000, 48, 24), material);
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * City lights for the night side, streamed once from NASA GIBS (VIIRS Earth at Night 2012,
 * Web Mercator). Static composite, not live. Absent tiles simply stay dark.
 */
export async function loadNightLights(zoom = 4, signal?: AbortSignal): Promise<T.DataTexture | null> {
  const n = 2 ** zoom, size = n * 256, canvas = new OffscreenCanvas(size, size), ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, size, size);
  let cursor = 0, loaded = 0;
  const worker = async () => {
    while (cursor < n * n) {
      const i = cursor++, x = i % n, y = Math.floor(i / n);
      try {
        const r = await fetch(`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_CityLights_2012/default/2012-01-01/GoogleMapsCompatible_Level8/${zoom}/${y}/${x}.jpg`, { signal: signal ?? AbortSignal.timeout(20000) });
        if (!r.ok) continue;
        const image = await createImageBitmap(await r.blob());
        ctx.drawImage(image, x * 256, y * 256); image.close(); loaded++;
      } catch { /* tile stays dark */ }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  if (loaded < n * n * 0.5) return null;
  const data = new Uint8Array(size * size);
  for (let row = 0; row < size; row += 256) {
    const strip = ctx.getImageData(0, row, size, 256).data;
    for (let i = 0, o = row * size; i < strip.length; i += 4, o++) {
      // The composite carries a dark blue land/ocean tint; keep only emitted warm light.
      data[o] = Math.max(0, Math.min(255, (strip[i] * 0.6 + strip[i + 1] * 0.5 - strip[i + 2] * 0.35 - 14) * 1.7));
    }
  }
  const texture = new T.DataTexture(data, size, size, T.RedFormat, T.UnsignedByteType);
  texture.wrapS = T.RepeatWrapping; texture.minFilter = T.LinearMipmapLinearFilter; texture.magFilter = T.LinearFilter;
  texture.generateMipmaps = true; texture.anisotropy = 8; texture.unpackAlignment = 1; texture.needsUpdate = true;
  return texture;
}
export const nightUniforms = { nightMap: { value: null as T.Texture | null }, nightReady: { value: 0 } };
/** geo = (longitude, latitude) in degrees; sunFacing = dot(surface normal, sun direction). */
export const nightGLSL = `
uniform sampler2D nightMap;uniform float nightReady;
vec3 cityLights(vec2 geo,float sunFacing){
  float phi=clamp(geo.y,-84.,84.)*.0174532925;
  vec2 uv=vec2(.5+geo.x/360.,.5-log(tan(.78539816+phi*.5))/6.28318530718);
  float c=texture2D(nightMap,uv).r;c=c*c*(.35+.5*c);
  return mix(vec3(1.,.56,.24),vec3(1.,.86,.66),clamp(c,0.,1.))*c*nightReady*(1.-smoothstep(-.2,.02,sunFacing))*(1.-smoothstep(83.,84.,abs(geo.y)));
}`;
