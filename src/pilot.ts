const clamp = (v: number, min = -1, max = 1) => Math.max(min, Math.min(max, v));
export type ControlStyle = 'game' | 'mouse' | 'direct';
export interface PilotAxes { pitch: number; yaw: number; roll: number }
/**
 * Rate-independent virtual stick. In game mode a held roll input rolls at full rate through any angle, so the jet
 * can roll and loop freely; only a centred stick near upright eases back to wings level.
 */
export class PilotInput {
  value: PilotAxes = { pitch: 0, yaw: 0, roll: 0 };
  reset() { this.value = { pitch: 0, yaw: 0, roll: 0 }; }
  update(raw: PilotAxes, bank: number, speed: number, qbar: number, dt: number, style: ControlStyle) {
    if (style === 'direct') return { ...raw };
    const w = 1 - Math.exp(-Math.max(0, dt) / .12);
    for (const key of ['pitch', 'yaw', 'roll'] as const) this.value[key] += (clamp(raw[key]) - this.value[key]) * w;
    const atmospheric = qbar > 100, rolling = Math.abs(raw.roll) > .05, pulling = Math.abs(raw.pitch) > .05, upright = Math.abs(bank) < 1.15;
    // Wings level returns only when nothing is commanded and the jet is the right way up; mid-loop or inverted it holds what it has.
    const level = atmospheric && !rolling && !pulling && upright ? clamp(-bank * 2 / 1.3) : 0;
    // Coordinated heading rate is g*tan(bank)/v; projection onto body yaw is g*sin(bank)/v. Only meaningful in an ordinary banked turn.
    const coordinate = atmospheric && upright && !pulling ? 9.80665 * Math.sin(bank) / Math.max(80, speed) / .4 : 0;
    return {
      pitch: this.value.pitch,
      yaw: clamp(this.value.yaw + coordinate),
      roll: rolling || !atmospheric ? this.value.roll : level,
    };
  }
}
/** Game-mode limiter preserves dynamic-pressure margin; it is not a complete safety autopilot. */
export function gameThrottle(request: number, boost: boolean, brake: boolean, qbar: number) {
  if (brake) return 0;
  return Math.min(boost ? 1 : request, clamp((110000 - qbar) / 25000, 0, 1));
}
/** Crossing detector is simulation-driven, hysteretic, and never fires just because a scene loads above Mach 1. */
export class SonicFeedback {
  armed = false;
  initialized = false;
  crossings = 0;
  pulse = 0;
  lastCrossing = -Infinity;
  reset() { this.armed = false; this.initialized = false; this.crossings = 0; this.pulse = 0; this.lastCrossing = -Infinity; }
  update(mach: number, altitude: number, density: number, time: number, dt: number, flying: boolean) {
    this.pulse = Math.max(0, this.pulse - Math.max(0, dt) / 2.4);
    const air = altitude < 50000 && density > .001 && flying;
    if (!this.initialized) { this.initialized = true; this.armed = air && mach < .95; return false; }
    if (!air) { this.armed = false; return false; }
    if (mach < .92 && time - this.lastCrossing > 5) this.armed = true;
    if (this.armed && mach >= 1.005) {
      this.armed = false; this.crossings++; this.pulse = 1; this.lastCrossing = time; return true;
    }
    return false;
  }
}
export function flightCues(mach: number, speed: number, density: number, qbar: number) {
  const air = clamp(density / .15, 0, 1),
    transonic = Math.exp(-(((mach - 1) / .09) ** 2)) * air;
  return { transonic, flow: clamp((speed - 65) / 320, 0, 1) * air,
    buffet: transonic * clamp(qbar / 20000, 0, 1), fov: Math.min(18, speed / 22) * air };
}
/** Dense-air torch interlock: smooth density/pressure fade, including residual engine spool. */
export function torchThrottleLimit(density:number,qbar:number){
 const smooth=(x:number,a:number,b:number)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
 const orbital=(1-smooth(density,.0001,.02))*(1-smooth(qbar,1000,10000));
 return .65/30+(1-.65/30)*orbital;
}
