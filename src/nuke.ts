import * as T from "three";

/**
 * A 150-kiloton surface burst. Arcade timing on real proportions: a half-kilometre fireball, a shock front that
 * starts supersonic and settles to the speed of sound, and a cloud that climbs through the tropopause to about
 * 17 km over several minutes. Distances in km, times in simulation seconds.
 */
export const NUKE = { fireball: 0.5, severe: 1.8, blast: 4.5, scorch: 2.6, top: 17, life: 780, crater: { radius: 450, depth: 110, rim: 26 } };
// Retarded by a drag chute to about 120 m/s near the ground, so it falls behind the aircraft that dropped it.
const MU = 398600.4418, DRAG = 0.556;

/** Shock front radius (km) at `age` seconds: a fast early blast that relaxes to 340 m/s. */
export const shockRadius = (age: number) => 0.34 * age + 1.1 * (1 - Math.exp(-age / 2.5));
/** Peak overpressure felt at `d` km, as a unitless strength: about 5 at 2 km, 1 at 6 km, 0.1 at 30 km. */
export const shockStrength = (d: number) => Math.min(12, Math.pow(6 / Math.max(0.4, d), 1.5));
/** Sea burst: a train of ring waves behind a front moving at WAVE.speed km/s. Height in km at `r` km from the centre. */
export const WAVE = { speed: 0.09, length: 0.95, height: 0.075, reach: 13 };
export function waveHeight(r: number, age: number) {
  const x = WAVE.speed * age - r; if (x <= 0 || r > WAVE.reach) return 0;
  const k = Math.min(1, x / 0.35), rise = k * k * (3 - 2 * k), calm = Math.min(1, Math.max(0, (age - 90) / 60)), core = Math.min(1, Math.max(0, (r - 0.15) / 0.35));
  return WAVE.height * rise * Math.exp(-x / 2.6) * (1.3 / (r + 1.3)) * (1 - calm * calm * (3 - 2 * calm)) * core * Math.sin((6.2832 * x) / WAVE.length);
}
const cloudTop = (age: number) => 0.3 + (NUKE.top - 0.3) * (1 - Math.exp(-age / 100));

export interface NukeFrame {
  centre: T.Vector3; axisX: T.Vector3; axisY: T.Vector3; axisZ: T.Vector3; age: number; fade: number;
  /** cap: centre height, radius, half thickness, emission. stem: radius. surge: radius, height, density, scorch. shock: radius, ring, condensation, scorch radius. */
  cap: T.Vector4; stem: T.Vector4; surge: T.Vector4; shock: T.Vector4; fire: T.Vector3; bound: T.Vector2;
}
export interface Shape { top: number; capZ: number; capR: number; capT: number; stemR: number; surgeR: number; surgeH: number; heat: number }
export function cloudShape(age: number): Shape {
  const top = cloudTop(age), capR = Math.min(NUKE.fireball, 0.05 + age * 2.5) + 0.11 * Math.pow(Math.max(0, top - 0.3), 1.45), capT = Math.min(capR * 0.62, 2.4);
  return { top, capZ: Math.max(capT * 0.55, top - capT), capR, capT, stemR: 0.15 + 0.1 * capR, surgeR: 0.6 + 3.6 * (1 - Math.exp(-age / 25)), surgeH: 0.15 + 0.3 * (1 - Math.exp(-age / 30)),
    heat: 70 * Math.exp(-age / 1.1) + 14 * Math.exp(-age / 16) + 2.2 * Math.exp(-age / 70) };
}
const RAMP: [number, number, number, number][] = [[0, 1, 0.96, 0.88], [2, 1, 0.86, 0.6], [6, 1, 0.66, 0.3], [20, 1, 0.4, 0.11], [60, 0.95, 0.2, 0.05], [200, 0.7, 0.1, 0.03]];
function fireColour(age: number, out: T.Vector3) {
  let i = 0; while (i < RAMP.length - 2 && age > RAMP[i + 1][0]) i++;
  const a = RAMP[i], b = RAMP[i + 1], k = Math.min(1, Math.max(0, (age - a[0]) / (b[0] - a[0])));
  return out.set(a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k);
}

/** One thrown object: where it stood (km, radians), when the front reaches it, and how it flies (m/s). */
interface Piece { r: number; a: number; t0: number; out: number; lift: number; axis: T.Vector3; spin: number; size: T.Vector3 }
const DEBRIS_LIFE = 50;
export interface NukeEvents { detonated: boolean; shockHit: number; kill: string; flash: number; burn: number; buffet: number }
/** `water` is any water under the burst; `sea` is open ocean, where ring waves can run. */
interface Blast { body: T.Vector3; t0: number; shocked: boolean; water: boolean; sea?: boolean; cratered: boolean }
export interface WaveLight { sunDirection: T.Vector3; sunLight: T.Color; skyLight: T.Color }

export class Nuke {
  group = new T.Group();
  bomb: { p: T.Vector3; v: T.Vector3; dropped: number } | null = null;
  blast: Blast | null = null;
  /** Seconds until the falling bomb reaches the ground, and where (inertial km). */
  eta = 0; impact = new T.Vector3(); flash = 0; drops = 0;
  /** The predicted impact point in the Earth-fixed frame; the ground turns under the bomb while it falls. */
  private impactBody = new T.Vector3();
  private model: T.Group; private marker: T.Sprite; private predicted = -1; private wave: T.Mesh; private waveMaterial: T.ShaderMaterial;
  private thrown = new T.Group(); private sets: { mesh: T.InstancedMesh; pieces: Piece[] }[] = [];
  private frameData: NukeFrame = { centre: new T.Vector3(), axisX: new T.Vector3(), axisY: new T.Vector3(), axisZ: new T.Vector3(), age: 0, fade: 1, cap: new T.Vector4(), stem: new T.Vector4(), surge: new T.Vector4(), shock: new T.Vector4(), fire: new T.Vector3(), bound: new T.Vector2() };
  /** `ground` returns the surface radius (km) under an inertial point; `wind` the air's inertial velocity; `density` air density at a height in metres. */
  constructor(private ground: (p: T.Vector3, time: number) => number, private wind: (p: T.Vector3) => T.Vector3, private density: (altitudeM: number) => number, private toInertial: (body: T.Vector3, time: number) => T.Vector3, private toBody: (p: T.Vector3, time: number) => T.Vector3) {
    const steel = new T.MeshStandardMaterial({ color: 0x5d665c, metalness: 0.55, roughness: 0.45 }), band = new T.MeshStandardMaterial({ color: 0xe9c21a, metalness: 0.3, roughness: 0.5 });
    const g = (this.model = new T.Group());
    const body = new T.Mesh(new T.CapsuleGeometry(0.00035, 0.0022, 6, 14), steel); body.rotation.x = Math.PI / 2; g.add(body);
    const stripe = new T.Mesh(new T.CylinderGeometry(0.000356, 0.000356, 0.0003, 14), band); stripe.rotation.x = Math.PI / 2; stripe.position.z = -0.0006; g.add(stripe);
    for (let i = 0; i < 4; i++) { const fin = new T.Mesh(new T.BoxGeometry(0.0009, 0.00004, 0.0008), steel); fin.rotation.z = (i * Math.PI) / 2; fin.position.z = 0.0013; g.add(fin); }
    g.scale.setScalar(2.2); g.visible = false;
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 128; const c = canvas.getContext("2d")!;
    c.strokeStyle = "#ff3b30"; c.lineWidth = 7; c.beginPath(); c.arc(64, 64, 52, 0, 7); c.stroke(); c.lineWidth = 4; c.beginPath(); c.arc(64, 64, 26, 0, 7); c.moveTo(64, 0); c.lineTo(64, 34); c.moveTo(64, 94); c.lineTo(64, 128); c.moveTo(0, 64); c.lineTo(34, 64); c.moveTo(94, 64); c.lineTo(128, 64); c.stroke();
    this.marker = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(canvas), transparent: true, depthTest: false, depthWrite: false, toneMapped: false, color: new T.Color(4, 1.2, 1) })); this.marker.visible = false; this.marker.renderOrder = 9;
    // Ring waves: a disc of water around the burst, lifted in the vertex shader and thrown away where the sea is calm.
    this.waveMaterial = new T.ShaderMaterial({ side: T.DoubleSide, toneMapped: false,
      uniforms: { age: { value: 0 }, reach: { value: WAVE.reach }, wave: { value: new T.Vector3(WAVE.speed, WAVE.length, WAVE.height) }, sunLocal: { value: new T.Vector3(0, 1, 0) }, camLocal: { value: new T.Vector3() }, sunLight: { value: new T.Color(1, 1, 1) }, skyLight: { value: new T.Color(0.4, 0.5, 0.6) } },
      vertexShader: `#include <common>
#include <logdepthbuf_pars_vertex>
uniform float age;uniform float reach;uniform vec3 wave;varying vec3 vLocal;varying vec2 vPlane;
float crest(float r,out float env,out float phase){float x=wave.x*age-r;env=0.;phase=0.;if(x<=0.)return 0.;
 env=smoothstep(0.,.35,x)*exp(-x/2.6)*(1.3/(r+1.3))*(1.-smoothstep(90.,150.,age))*smoothstep(.15,.5,r);phase=6.2832*x/wave.y;return wave.z*env*sin(phase);}
void main(){vec2 q=position.xy*reach;float r=length(q),env,phase;float h=crest(r,env,phase);
 vLocal=vec3(q.x,h-r*r/12742.+.0005,q.y);vPlane=q;
 vec4 mv=modelViewMatrix*vec4(vLocal,1.);gl_Position=projectionMatrix*mv;
 #include <logdepthbuf_vertex>
}`,
      fragmentShader: `#include <common>
#include <logdepthbuf_pars_fragment>
uniform float age;uniform vec3 wave;uniform vec3 sunLocal;uniform vec3 camLocal;uniform vec3 sunLight;uniform vec3 skyLight;varying vec3 vLocal;varying vec2 vPlane;
float hash(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);}
void main(){
 float r=length(vPlane),x=wave.x*age-r;if(x<=0.)discard;
 float shape=smoothstep(0.,.35,x)*exp(-x/2.6)*(1.-smoothstep(90.,150.,age))*smoothstep(.15,.5,r),env=shape*(1.3/(r+1.3));
 if(env<.012)discard;
 #include <logdepthbuf_fragment>
 float phase=6.2832*x/wave.y,slope=-wave.z*env*cos(phase)*6.2832/wave.y;vec2 dir=vPlane/max(r,1e-4);
 float chop=noise(vPlane*38.)+.5*noise(vPlane*91.+age*.4);
 vec3 n=normalize(vec3(-slope*dir.x+(chop-.75)*.12,1.,-slope*dir.y+(noise(vPlane*38.+7.)-.5)*.12)),v=normalize(camLocal-vLocal);
 float fres=.03+.97*pow(1.-max(dot(n,v),0.),5.),lit=max(dot(n,sunLocal),0.);
 vec3 deep=vec3(.012,.07,.1)*(sunLight*(.25+.75*lit)+skyLight),sky=skyLight*1.35+sunLight*.08;
 vec3 col=mix(deep,sky,fres)+sunLight*pow(max(dot(reflect(-v,n),sunLocal),0.),160.)*1.5;
 // Breaking crests and the torn water just behind the front carry foam.
 float foam=smoothstep(.25,.85,sin(phase)+(chop-.75)*.9)*smoothstep(.02,.2,env)+smoothstep(.5,.0,x)*.6*shape;
 col=mix(col,vec3(.86,.9,.93)*(sunLight*(.3+.5*lit)+skyLight),clamp(foam,0.,1.)*(.55+.45*chop/1.5));
 gl_FragColor=vec4(col,1.);
}` });
    this.wave = new T.Mesh(new T.RingGeometry(0.01, 1, 192, 140), this.waveMaterial); this.wave.frustumCulled = false; this.wave.visible = false; this.wave.matrixAutoUpdate = false;
    this.group.add(g, this.marker, this.wave, this.thrown);
    this.thrown.matrixAutoUpdate = false; this.thrown.visible = false;
    // Things the blast wave picks up: masonry, cars and railway carriages, drawn over scale so they read from the air.
    let seed = 20611; const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const profile = new T.Shape([[-2.2, 0], [2.2, 0], [2.2, 0.75], [1.3, 0.8], [0.8, 1.45], [-1, 1.45], [-1.6, 0.8], [-2.2, 0.7]].map(([x, y]) => new T.Vector2(x, y)));
    const car = new T.ExtrudeGeometry(profile, { depth: 1.8, bevelEnabled: false }).translate(0, -0.7, -0.9), box = new T.BoxGeometry(1, 1, 1);
    const kinds: { geometry: T.BufferGeometry; count: number; size: () => T.Vector3; colour: () => T.Color; heavy: number }[] = [
      { geometry: box, count: 1100, heavy: 1, size: () => new T.Vector3(3 + random() * 16, 2 + random() * 9, 3 + random() * 14), colour: () => new T.Color().setHSL(0.06 + random() * 0.05, 0.08 + random() * 0.18, 0.03 + random() * 0.13) },
      { geometry: car, count: 320, heavy: 0.8, size: () => new T.Vector3(3, 3, 3), colour: () => new T.Color().setHSL(random(), random() < 0.45 ? 0.7 : 0.05, 0.08 + random() * 0.25) },
      { geometry: box, count: 48, heavy: 1.5, size: () => new T.Vector3(46, 7.5, 6.5), colour: () => new T.Color([0xb3202a, 0x1f4f9c, 0xd8dbe0, 0xe0a81c][Math.floor(random() * 4)]) },
    ];
    for (const kind of kinds) {
      const mesh = new T.InstancedMesh(kind.geometry, new T.MeshStandardMaterial({ roughness: 0.75, metalness: kind.geometry === car ? 0.5 : 0.1 }), kind.count), pieces: Piece[] = [];
      mesh.frustumCulled = false;
      for (let i = 0; i < kind.count; i++) {
        const r = 0.35 + Math.pow(random(), 0.7) * (NUKE.blast - 0.6), s = Math.min(6, shockStrength(r));
        let lo = 0, hi = 30; for (let k = 0; k < 22; k++) { const mid = (lo + hi) / 2; if (shockRadius(mid) < r) lo = mid; else hi = mid; }
        pieces.push({ r, a: random() * 6.2832, t0: hi + random() * 0.4, out: (30 + 55 * s * random()) / kind.heavy, lift: ((18 + 50 * random()) * Math.min(1.6, Math.sqrt(s))) / kind.heavy, axis: new T.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize(), spin: (1 + random() * 5) / kind.heavy, size: kind.size().multiplyScalar(0.001) });
        mesh.setColorAt(i, kind.colour());
      }
      this.sets.push({ mesh, pieces }); this.thrown.add(mesh);
    }
  }
  get armed() { return !this.bomb; }
  age(time: number) { return this.blast ? time - this.blast.t0 : -1; }
  drop(p: T.Vector3, v: T.Vector3, down: T.Vector3, time: number) {
    if (this.bomb) return false;
    this.bomb = { p: p.clone().addScaledVector(down, 0.004), v: v.clone().addScaledVector(down, 0.006), dropped: time }; this.predicted = -1; this.drops++; return true;
  }
  clear() { this.bomb = null; this.blast = null; this.flash = 0; this.model.visible = this.marker.visible = false; }
  private step(p: T.Vector3, v: T.Vector3, h: number) {
    const r = p.length(), air = v.clone().sub(this.wind(p)), rho = this.density((r - 6371) * 1000);
    v.addScaledVector(p, (-MU / (r * r * r)) * h).addScaledVector(air, -DRAG * rho * air.length() * h); p.addScaledVector(v, h);
  }
  /** Advances the bomb and the blast, and reports what the aircraft at `ship` feels this frame. */
  update(dt: number, time: number, ship: T.Vector3, shipV: T.Vector3): NukeEvents {
    const events: NukeEvents = { detonated: false, shockHit: 0, kill: "", flash: 0, burn: 0, buffet: 0 };
    const b = this.bomb;
    if (b) {
      let left = Math.min(dt, 30);
      while (left > 1e-6) {
        const h = Math.min(0.05, left); this.step(b.p, b.v, h); left -= h;
        if (b.p.length() - 6371 < 9.2 && b.p.length() <= this.ground(b.p, time)) {
          const body = this.toBody(b.p, time).setLength(this.ground(b.p, time));
          this.blast = { body, t0: time, shocked: false, water: false, cratered: false }; this.bomb = null; events.detonated = true;
          const d = b.p.distanceTo(ship); this.flash = Math.min(4, 14 / (d * 0.5 + 1.5));
          if (d < NUKE.fireball * 1.6) events.kill = "Vaporised in the fireball";
          break;
        }
      }
      if (this.bomb && (this.predicted < 0 || time - this.predicted > 0.25)) {
        // Fly a copy ahead to find the impact point and time; coarse steps are enough for a countdown.
        const p = b.p.clone(), v = b.v.clone(); let t = 0;
        for (; t < 400; t += 0.25) { this.step(p, v, 0.25); if (p.length() - 6371 < 9.2 && p.length() <= this.ground(p, time + t)) break; }
        this.eta = t; this.impactBody.copy(this.toBody(p, time + t)); this.predicted = time;
      } else if (this.bomb) this.eta = Math.max(0, this.eta - dt);
      if (this.bomb) this.impact.copy(this.toInertial(this.impactBody, time));
    }
    this.flash *= Math.exp(-dt * 0.9); events.flash = this.flash;
    const blast = this.blast;
    if (blast) {
      const age = time - blast.t0, centre = this.toInertial(blast.body, time), rel = ship.clone().sub(centre), d = rel.length(), up = centre.clone().normalize();
      const front = shockRadius(age);
      if (!blast.shocked && front >= d) { blast.shocked = true; events.shockHit = shockStrength(d); if (events.shockHit > 4.2) events.kill = "Torn apart by the blast wave"; }
      if (age < 6 && d < 4) events.burn = ((4 - d) / 4) * Math.exp(-age / 1.5);
      if (age < NUKE.life) {
        // Inside the cloud: the first half-minute is fire, after that it is violent air and grit.
        const s = cloudShape(age), h = rel.dot(up), r = Math.sqrt(Math.max(0, d * d - h * h));
        const inCap = Math.hypot(r / s.capR, (h - s.capZ) / s.capT) < 0.9, inStem = h > 0 && h < s.capZ && r < s.stemR * 1.2;
        if (blast.sea && h > -0.05 && h < waveHeight(r, age)) events.kill ||= "Swallowed by the wave";
        if (inCap || inStem) { if (age < 25) events.kill ||= "Flew into the fireball"; else { events.buffet = 1; if (age < 150) events.burn = Math.max(events.burn, 0.5 * (1 - age / 150)); } }
      }
    }
    void shipV;
    return events;
  }
  /** Seconds until the shock front reaches a point `d` km from ground zero, or -1 once it has passed. */
  shockEta(time: number, ship: T.Vector3) {
    const blast = this.blast; if (!blast || blast.shocked) return -1;
    const d = ship.distanceTo(this.toInertial(blast.body, time)), age = time - blast.t0; if (d > 400) return -1;
    let lo = age, hi = age + d / 0.34 + 1; for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (shockRadius(mid) < d) lo = mid; else hi = mid; }
    return hi - age;
  }
  /** Places the falling bomb and its impact marker relative to the aircraft. */
  draw(ship: T.Vector3, camera: T.Camera, time: number, light: WaveLight) {
    const blast = this.blast, age = blast ? time - blast.t0 : 0, w = this.wave;
    w.visible = !!blast?.sea && age < 150;
    if (blast && w.visible) {
      const centre = this.toInertial(blast.body, time), up = centre.clone().normalize(), x = new T.Vector3(0, 1, 0).cross(up); if (x.lengthSq() < 1e-6) x.set(1, 0, 0); x.normalize(); const z = new T.Vector3().crossVectors(x, up), u = this.waveMaterial.uniforms, cam = camera.position.clone().sub(centre.sub(ship));
      w.matrix.makeBasis(x, up, z).setPosition(centre); w.matrixWorldNeedsUpdate = true;
      u.age.value = age; u.camLocal.value.set(cam.dot(x), cam.dot(up), cam.dot(z)); u.sunLocal.value.set(light.sunDirection.dot(x), light.sunDirection.dot(up), light.sunDirection.dot(z)); u.sunLight.value.copy(light.sunLight); u.skyLight.value.copy(light.skyLight);
    }
    this.thrown.visible = !!blast && !blast.water && age < DEBRIS_LIFE;
    if (blast && this.thrown.visible) {
      const centre = this.toInertial(blast.body, time), up = centre.clone().normalize(), x = new T.Vector3(0, 1, 0).cross(up); if (x.lengthSq() < 1e-6) x.set(1, 0, 0); x.normalize();
      this.thrown.matrix.makeBasis(x, up, new T.Vector3().crossVectors(x, up)).setPosition(centre.sub(ship)); this.thrown.matrixWorldNeedsUpdate = true;
      const m = new T.Matrix4(), q = new T.Quaternion(), at = new T.Vector3(), scale = new T.Vector3();
      for (const set of this.sets) {
        set.pieces.forEach((p, i) => {
          // Ballistic arc from the moment the front arrives; a piece shrinks away a few seconds after it lands.
          const t = age - p.t0, air = (2 * p.lift) / 9.81, tt = Math.min(t, air), gone = t <= 0 || t > air + 4;
          if (gone) scale.set(0, 0, 0); else scale.copy(p.size).multiplyScalar(t > air ? 1 - (t - air) / 4 : Math.min(1, t * 4));
          const d = p.r + (p.out * (1 - Math.exp(-0.22 * tt))) / 220, h = Math.max(0, p.lift * tt - 4.905 * tt * tt) / 1000;
          m.compose(at.set(Math.cos(p.a) * d, h + p.size.y * 0.4, Math.sin(p.a) * d), q.setFromAxisAngle(p.axis, p.spin * tt), scale); set.mesh.setMatrixAt(i, m);
        });
        set.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    const b = this.bomb; this.model.visible = this.marker.visible = !!b; if (!b) return;
    this.model.position.copy(b.p).sub(ship);
    const air = b.v.clone().sub(this.wind(b.p)); if (air.lengthSq() > 1e-12) this.model.lookAt(this.model.position.clone().add(air));
    this.marker.position.copy(this.impact).sub(ship); this.marker.scale.setScalar(Math.max(0.03, this.marker.position.distanceTo(camera.position) * 0.045));
  }
  /** Uniform values for the volumetric pass, relative to the camera. Null when there is nothing in range to draw. */
  frame(time: number, cameraAbs: T.Vector3): NukeFrame | null {
    const blast = this.blast; if (!blast) return null;
    const f = this.frameData, centre = this.toInertial(blast.body, time), age = time - blast.t0;
    if (centre.distanceTo(cameraAbs) > 600) return null;
    f.centre.copy(centre).sub(cameraAbs); f.axisY.copy(centre).normalize();
    f.axisX.set(0, 1, 0).cross(f.axisY); if (f.axisX.lengthSq() < 1e-6) f.axisX.set(1, 0, 0); f.axisX.normalize(); f.axisZ.crossVectors(f.axisX, f.axisY);
    const s = cloudShape(age), front = shockRadius(age), wet = blast.water ? 1 : 0;
    // Over water the stem starts as a fat column of thrown water and the surge is spray that travels further.
    if (wet) { s.stemR += 0.3 * Math.exp(-age / 22); s.surgeR *= 1.35; s.surgeH *= 1.4; }
    f.age = age; f.fade = 1 - T.MathUtils.smoothstep(age, NUKE.life - 240, NUKE.life);
    f.cap.set(s.capZ, s.capR, s.capT, s.heat); f.stem.set(s.stemR, 1 - 0.45 * T.MathUtils.smoothstep(age, 180, 480), wet, 0);
    f.surge.set(s.surgeR, s.surgeH, (1 - T.MathUtils.smoothstep(age, wet ? 240 : 150, wet ? 520 : 420)) * T.MathUtils.smoothstep(age, 0.4, 3), blast.water ? 0 : T.MathUtils.smoothstep(age, 0.2, 2.5));
    const ring = front < 60 ? T.MathUtils.smoothstep(age, 0.2, 1) / (1 + front * 0.22) : 0, wilson = age > 1.2 && age < 8 ? Math.sin(((age - 1.2) / 6.8) * Math.PI) : 0;
    f.shock.set(front, ring, wilson, NUKE.scorch); fireColour(age, f.fire);
    const mid = s.top / 2; let reach = Math.max(s.top - mid + 0.4, Math.hypot(s.capR * 1.25, s.capZ - mid) + 0.3, Math.hypot(s.surgeR, mid) + 0.3);
    if (wilson > 0) reach = Math.max(reach, Math.hypot(front, mid) + 0.4);
    f.bound.set(mid, reach);
    return f;
  }
}

/** Half-resolution pass: ground decals from scene depth (scorch, shock ring, fire light) under a ray-marched cloud. rgb adds, a multiplies the scene. */
export const nukeFragment = /* glsl */ `
precision highp float;precision highp sampler3D;
varying vec2 vUv;
uniform sampler2D tDepth;uniform sampler3D noiseMap;
uniform mat4 inverseProjection;uniform mat4 cameraWorld;
uniform vec3 centre;uniform vec3 axisX;uniform vec3 axisY;uniform vec3 axisZ;uniform vec3 sunDirection;uniform vec3 sunLight;uniform vec3 skyLight;uniform vec3 hazeColor;uniform vec3 fire;
uniform float depthScale;uniform float hazeK;uniform float age;uniform float fade;
uniform vec4 cap;uniform vec4 stem;uniform vec4 surge;uniform vec4 shock;uniform vec2 bound;
vec2 sphere(vec3 o,vec3 d,float r){float b=dot(o,d),q=b*b-dot(o,o)+r*r;if(q<0.)return vec2(1e8,-1e8);float s=sqrt(q);return vec2(-b-s,-b+s);}
// x: density, y: heat (0..1, hottest in the core), z: 1 in the cap, 0 in dust.
vec3 field(vec3 l,bool fine){
  float h=l.y;if(h<-.03)return vec3(0.);
  float r=length(l.xz),zc=cap.x,Rc=cap.y,tc=cap.z,d=0.,heat=0.,white=0.;
  float v=(h-zc)/tc;if(v<0.)v*=1.7;
  float e=length(vec2(r/Rc,v));
  if(e<1.2){
    vec3 lc=vec3(l.x,h-zc,l.z)/Rc;
    float n=textureLod(noiseMap,lc*.8+vec3(.13,-age*.004,.71),0.).r;
    // The core stays solid; billows eat into the outer shell only.
    d=clamp((1.12-e)*2.4-(1.-n)*1.3*smoothstep(.15,.8,e),0.,1.);heat=smoothstep(1.05,.35,e);white=1.;
  }
  if(h<zc){
    float rs=stem.x*(1.+1.5*exp(-h/.3)+1.1*smoothstep(zc-2.*tc,zc,h));
    if(r<rs*1.25){
      float n=textureLod(noiseMap,vec3(l.x,h-age*.045,l.z)/(1.5*stem.x+.25)+vec3(.5,0.,.2),0.).r;
      float s=clamp((1.1-r/rs)*2.2-(1.-n)*1.45,0.,1.)*smoothstep(-.03,.05,h)*stem.y;
      if(s>d){d=s;heat=max(heat*.6,smoothstep(1.,0.,r/rs)*smoothstep(zc*.3,zc,h)*.55);white=white*.5;}
    }
    if(surge.z>0.&&h<surge.y*1.3&&r<surge.x*1.1){
      float n=textureLod(noiseMap,vec3(l.x,h*2.+age*.01,l.z)/1.3,0.).r;
      float s=clamp((1.05-r/surge.x)*3.,0.,1.)*smoothstep(surge.y*(.55+.75*n),0.,h)*(.45+.55*smoothstep(.25,.9,r/surge.x))*clamp(n*2.2-.5,0.,1.)*surge.z*.8;
      if(s>d){d=s;white=0.;heat*=.3;}
    }
  }
  if(fine&&d>0.&&d<1.){float det=textureLod(noiseMap,l*1.9+vec3(0.,-age*.02,0.),0.).g;d=clamp((d-det*.32)/(1.-det*.32),0.,1.);}
  return vec3(d,heat,white);
}
void main(){
  vec4 v=inverseProjection*vec4(vUv*2.-1.,1.,1.);
  vec3 rayView=normalize(v.xyz),ray=normalize(mat3(cameraWorld)*rayView);
  float depth=texture2D(tDepth,vUv).r,limit=1e5;bool solid=depth<.99999;
  if(solid)limit=(exp2(depth*depthScale)-1.)/max(.05,-rayView.z);
  vec3 o=-centre,lo=vec3(dot(o,axisX),dot(o,axisY),dot(o,axisZ)),ld=vec3(dot(ray,axisX),dot(ray,axisY),dot(ray,axisZ));
  vec3 sunLocal=vec3(dot(sunDirection,axisX),dot(sunDirection,axisY),dot(sunDirection,axisZ)),firePos=vec3(0.,cap.x,0.);
  float E=cap.w,haze=exp(-min(limit,400.)*.012);
  vec3 add=vec3(0.);float mul=1.;
  if(solid&&limit>.04){
    vec3 g=lo+ld*limit;float gr=length(g.xz);
    if(abs(g.y)<9.&&gr<max(shock.x,shock.w)+3.){
      vec2 nz=textureLod(noiseMap,vec3(g.x,.37,g.z)*.7,0.).rg;float fine=textureLod(noiseMap,vec3(g.x,.11,g.z)*4.3,0.).g;
      // Scorch: charred to ash inside, ragged at the edge, with fires that flicker for minutes.
      float sr=shock.w*(.72+.56*nz.r),s=smoothstep(sr,sr*.3,gr)*surge.w*smoothstep(3.,1.,g.y);
      mul*=1.-.9*s;add+=vec3(.014,.012,.011)*s*(sunLight*.35+skyLight)*(.4+1.2*fine*fine);
      float embers=pow(fine,5.)*smoothstep(.35,.6,nz.g)*s*exp(-age/260.)*(.55+.45*sin(age*4.+fine*60.));
      add+=vec3(9.,2.2,.25)*embers*smoothstep(sr*1.1,sr*.25,gr);
      // The fireball lights the ground it stands on.
      float dl=length(g-firePos);add+=fire*E*.05*cap.y*cap.y/(dl*dl+cap.y*cap.y)*smoothstep(-.2,.3,dot(normalize(firePos-g),vec3(0.,1.,0.))+.2);
      // Shock front: a bright dust wall racing outward, with a low haze kicked up behind it.
      float width=.035+.012*shock.x,band=exp(-pow((gr-shock.x)/width,2.))*shock.y;
      float wake=smoothstep(shock.x,shock.x-.4,gr)*smoothstep(shock.x-5.,shock.x-.6,gr)*shock.y;
      vec3 dust=vec3(.62,.56,.48)*(sunLight*.3+skyLight*.9);
      add+=dust*(band*(.5+.9*nz.r)+wake*.35*(.5+nz.r));mul*=1.-min(.75,band*.6+wake*.45);
      // Sea burst: a boiling white patch where the column fell back.
      if(stem.z>.5){float froth=smoothstep(1.,.45,gr/(.5+min(2.6,age*.06)))*smoothstep(.3,3.,age)*(1.-smoothstep(200.,420.,age))*(.45+.75*nz.r)*smoothstep(.4,-.05,g.y);add+=vec3(.8,.85,.88)*(sunLight*.3+skyLight)*froth;mul*=1.-.8*froth;}
    }
    add*=haze;mul=mix(1.,mul,haze);
  }
  vec3 light=vec3(0.);float trans=1.;
  vec2 hit=sphere(lo-vec3(0.,bound.x,0.),ld,bound.y);
  float start=max(0.,hit.x),end=min(limit,hit.y);
  // Nothing exists under the ground plane; skip that part of the ray.
  if(ld.y<0.){float tg=-lo.y/ld.y;if(lo.y>0.)end=min(end,tg+.05);}else if(lo.y<0.&&ld.y>0.)start=max(start,-lo.y/ld.y);
  if(end>start&&fade>.001){
    float dither=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))+fract(age*7.)));
    float stride=(end-start)/72.,t=start+stride*dither,mu=dot(ld,sunLocal),phase=.75+.45*mu*mu+.5*pow(max(mu,0.),6.);
    float reach=max(.12,cap.y*.3),whiten=smoothstep(25.,260.,age);
    for(int i=0;i<72;i++){
      if(trans<.02)break;
      vec3 p=lo+ld*t;vec3 f=field(p,true);float d=f.x*fade;
      // Condensation shell riding just behind the shock front in the first seconds.
      float w=0.;if(shock.z>0.){float rr=length(p);w=exp(-pow((rr-shock.x*.94)/(.05+.03*shock.x),2.))*shock.z*smoothstep(.02,.25,p.y)*smoothstep(3.2,1.2,p.y)*.1;}
      if(d+w>.003){
        float od=field(p+sunLocal*reach,false).x*reach+field(p+sunLocal*reach*3.,false).x*reach*2.;
        float beer=max(exp(-od*5.),exp(-od*1.2)*.35),below=smoothstep(cap.x+cap.z,cap.x-cap.z*2.,p.y);
        vec3 albedo=mix(vec3(.3,.25,.2),mix(vec3(.3,.25,.22),vec3(.9,.88,.86),whiten),f.z);
        if(stem.z>.5)albedo=mix(vec3(.84,.87,.9),albedo,f.z*(1.-whiten)*.6);
        float df=length(p-firePos);
        vec3 lit=albedo*(sunLight*beer*phase*.5+skyLight*(.55+.45*clamp(p.y/max(1.,cap.x),0.,1.))*(1.-.35*below));
        lit+=albedo*fire*E*.1*cap.y*cap.y/(df*df+cap.y*cap.y);
        // Incandescent gas: blinding at first, then a furnace glow seen through cracks in the smoke.
        vec3 glow=fire*E*f.y*f.y*2.6;
        lit=mix(hazeColor,lit+glow,exp(-t*hazeK));
        if(w>0.){lit=mix(lit,(sunLight*.5*phase+skyLight)*.95,w/(d+w));}
        float a=1.-exp(-(d*9.+w*2.)*stride*(1.+2.*f.y*min(E,3.)));
        light+=trans*a*lit;trans*=1.-a;
      }
      t+=stride;if(t>=end)break;
    }
  }
  gl_FragColor=vec4(light+trans*add,trans*mul);
}`;
