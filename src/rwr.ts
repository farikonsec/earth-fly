import * as T from "three";
import type { Threats } from "./combat";

/**
 * Radar warning receiver: a banner under the toolbar and a tone. A seeker holding you gives a steady double beep and
 * an amber LOCKED line; an inbound missile gives a warble that climbs in pitch and rate as its time to impact falls, and a red
 * line with clock bearing, range and time to impact.
 */
export class Rwr {
  element = document.createElement("div");
  private audio: AudioContext | null = null; private gain: GainNode | null = null; private osc: OscillatorNode | null = null;
  private mode: "quiet" | "lock" | "missile" = "quiet";
  constructor() {
    this.element.id = "rwr"; this.element.setAttribute("role", "alert"); this.element.hidden = true; document.body.append(this.element);
    // Browsers only allow sound after a gesture: create the tone generator on the first key or click.
    const wake = () => { if (this.audio) return; try { this.audio = new AudioContext(); this.gain = this.audio.createGain(); this.gain.gain.value = 0; this.gain.connect(this.audio.destination); this.osc = this.audio.createOscillator(); this.osc.type = "triangle"; this.osc.connect(this.gain); this.osc.start(); } catch { /* no audio */ } };
    addEventListener("keydown", wake, { once: true }); addEventListener("pointerdown", wake, { once: true });
  }
  private lastMode = "quiet"; private since = 0;
  /** Clock bearing (1-12) of a point relative to the nose, in the local horizontal plane. */
  static clock(rel: T.Vector3, up: T.Vector3, heading: number) {
    const east = new T.Vector3(0, 1, 0).cross(up).normalize(), north = up.clone().cross(east);
    const deg = ((((Math.atan2(rel.dot(east), rel.dot(north)) * 180) / Math.PI - heading) % 360) + 360) % 360;
    return Math.round(deg / 30) % 12 || 12;
  }
  update(threats: Threats, p: T.Vector3, v: T.Vector3, heading: number, time: number, muted: boolean) {
    const up = p.clone().normalize(), lines: string[] = [];
    const missiles = threats.missiles.map((m) => {
      const rel = m.p.clone().sub(p), range = rel.length(), closing = -m.v.clone().sub(v).dot(rel) / Math.max(range, 1e-6);
      return { m, rel, range, closing, eta: closing > 0.02 ? range / closing : Infinity };
    }).filter((x) => x.closing > 0 && x.range < 90).sort((a, b) => a.eta - b.eta);
    for (const x of missiles.slice(0, 2)) lines.push(`<b class="missile">${x.m.name === "SAM" && x.m.age < 4 ? "SAM LAUNCH" : "MISSILE"}</b> ${Rwr.clock(x.rel, up, heading)} o'clock · ${x.range.toFixed(1)} km${Number.isFinite(x.eta) ? " · " + x.eta.toFixed(0) + " s" : ""}${missiles.length > 2 && x === missiles[1] ? ` <i>+${missiles.length - 2}</i>` : ""}`);
    const locks = threats.locks.slice().sort((a, b) => a.p.distanceTo(p) - b.p.distanceTo(p));
    // One line for whoever is tracking: the nearest, and a count of the rest. Inbound missiles push it out entirely.
    if (locks.length && !missiles.length) { const l = locks[0]; lines.push(`<b class="lock">LOCK</b> ${l.name} · ${Rwr.clock(l.p.clone().sub(p), up, heading)} o'clock · ${l.p.distanceTo(p).toFixed(0)} km${locks.length > 1 ? ` <i>+${locks.length - 1}</i>` : ""}`); }
    this.element.hidden = !lines.length; this.element.innerHTML = lines.join("<br>");
    this.element.classList.toggle("inbound", missiles.length > 0);
    // Urgency from the nearest inbound missile's time to impact (and range when it is not closing yet).
    const lead = missiles[0], eta = lead ? Math.min(lead.eta, lead.range / 1.2) : Infinity;
    const level = !lead ? 0 : eta > 15 ? 1 : eta > 6 ? 2 : eta > 2.5 ? 3 : 4;
    this.element.dataset.urgency = String(level);
    this.mode = missiles.length ? "missile" : locks.length ? "lock" : "quiet";
    if (!this.audio || !this.gain || !this.osc) return;
    // Soft triangle tones, kept short so they inform without nagging:
    //   being tracked: two low blips when the lock starts, then one quiet blip every 6 s;
    //   missile far (over 15 s): one blip a second; 6-15 s: a slow two-note warble;
    //   2.5-6 s: a faster warble; last 2.5 s: a steady tone. Nothing goes above 1.1 kHz.
    if (this.mode !== this.lastMode) { this.lastMode = this.mode; this.since = time; }
    const t = time, held = t - this.since, beep = (rate: number, duty = 0.45) => (t * rate) % 1 < duty;
    let freq = 0, vol = 0;
    if (level === 1) { freq = 620; vol = beep(1, 0.12) ? 0.014 : 0; }
    else if (level === 2) { freq = beep(3) ? 700 : 860; vol = 0.016; }
    else if (level === 3) { freq = beep(7) ? 820 : 1040; vol = 0.022; }
    else if (level === 4) { freq = 1100; vol = 0.026; }
    else if (locks.length) { const ground = locks.every((l) => l.ground); freq = ground ? 440 : 560; vol = (held < 0.12 || (held > 0.22 && held < 0.34)) || (held > 1 && held % 6 < 0.1) ? 0.014 : 0; }
    if (freq) this.osc.frequency.setTargetAtTime(freq, this.audio.currentTime, 0.004);
    this.gain.gain.setTargetAtTime(muted ? 0 : vol, this.audio.currentTime, 0.008);
  }
}
