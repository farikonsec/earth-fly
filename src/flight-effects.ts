import * as T from 'three';
import type { V } from './vector';
/** HERO: a lower-atmosphere proxy for a wing vapor collar and air-relative streaks make the Mach crossing tangible. */
export class FlightEffects {
  group = new T.Group();
  private count = 140;
  private positions = new Float32Array(this.count * 6);
  private particles = new Float32Array(this.count * 3);
  private geometry = new T.BufferGeometry();
  flowMaterial = new T.LineBasicMaterial({ color: 0xd7eeef, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, blending: T.AdditiveBlending });
  private time = { value: 0 };
  private opacity = { value: 0 };
  vaporMaterial = new T.ShaderMaterial({
    uniforms: { time: this.time, opacity: this.opacity }, transparent: true, depthWrite: false, side: T.DoubleSide,
    vertexShader: 'varying vec2 vUV;void main(){vUV=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: 'uniform float time;uniform float opacity;varying vec2 vUV;float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}void main(){float edge=pow(max(0.,sin(vUV.y*3.14159)),.8);float wisps=.35+.65*noise(vUV*vec2(10.,6.)+vec2(time*.3,-time*.5));gl_FragColor=vec4(.92,.97,1.,opacity*edge*wisps);}',
  });
  vapor: T.Mesh;
  constructor() {
    let seed = 8713;
    for (let i = 0; i < this.particles.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; this.particles[i] = (seed / 4294967296 - .5) * .5; }
    this.geometry.setAttribute('position', new T.BufferAttribute(this.positions, 3));
    const streaks = new T.LineSegments(this.geometry, this.flowMaterial); streaks.frustumCulled = false;
    const cone = new T.ConeGeometry(.018, .026, 64, 12, true); cone.rotateX(-Math.PI / 2); cone.translate(0, 0, .004);
    this.vapor = new T.Mesh(cone, this.vaporMaterial); this.vapor.frustumCulled = false;
    this.group.add(streaks, this.vapor);
  }
  update(dt: number, airVelocity: V, rotation: T.Quaternion, flow: number, transonic: number, time: number, visible: boolean, motion: boolean, altitude = 0, warp = 0) {
    this.group.visible = visible;
    this.vapor.quaternion.copy(rotation);
    this.time.value = time; this.opacity.value = visible && motion ? transonic * .22 * Math.exp(-Math.max(0,altitude)/4500) : 0;
    this.vapor.visible = this.opacity.value > .003;
    this.flowMaterial.opacity = motion ? flow * .12 + warp * .5 : 0;
    this.flowMaterial.color.setRGB(.84,.93,.94).lerp(new T.Color(.5,1.2,2.6),warp);
    const speed = Math.hypot(...airVelocity), length = Math.min(.018+warp*.09, speed * .027);
    for (let i = 0; i < this.count; i++) {
      for (let axis = 0; axis < 3; axis++) {
        const k = i * 3 + axis;
        this.particles[k] -= airVelocity[axis] * dt;
        this.particles[k] = ((this.particles[k] + .25) % .5 + .5) % .5 - .25;
        this.positions[i * 6 + axis] = this.particles[k];
        this.positions[i * 6 + 3 + axis] = this.particles[k] + (speed > .001 ? airVelocity[axis] / speed * length : 0);
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
  }
}
