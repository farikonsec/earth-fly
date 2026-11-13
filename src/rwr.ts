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
    const wake = () => { if (this.audio) return; try { this.audio = new AudioContext(); this.gain = this.audio.createGain(); this.gain.gain.value = 0; this.gain.connect(this.audio.destination); this.osc = this.audio.createOscillator(); this.osc.type = "square"; this.osc.connect(this.gain); this.osc.start(); } catch { /* no audio */ } };
    addEventListener("keydown", wake, { once: true }); addEventListener("pointerdown", wake, { once: true });
  }
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
    // Tones, slowest and lowest when the threat is far, climbing in pitch and rate as it closes:
    //   lock by an aircraft: two 1 kHz beeps a second; by a SAM radar: two 650 Hz beeps a second;
    //   missile far (over 15 s): 3 Hz warble 700/900 Hz; 6-15 s: 6 Hz 1000/1300 Hz;
    //   2.5-6 s: 12 Hz 1400/1900 Hz; last 2.5 s: a steady 2.2 kHz tone.
    const t = time, beep = (rate: number) => (t * rate) % 1 < 0.45;
    let freq = 0, vol = 0;
    if (level === 1) { freq = beep(3) ? 700 : 900; vol = 0.022; }
    else if (level === 2) { freq = beep(6) ? 1000 : 1300; vol = 0.03; }
    else if (level === 3) { freq = beep(12) ? 1400 : 1900; vol = 0.04; }
    else if (level === 4) { freq = 2200; vol = 0.045; }
    else if (locks.length) { const ground = locks.every((l) => l.ground), phase = (t * 2) % 1; freq = ground ? 650 : 1000; vol = phase < 0.12 || (phase > 0.22 && phase < 0.34) ? 0.03 : 0; }
    if (freq) this.osc.frequency.setTargetAtTime(freq, this.audio.currentTime, 0.004);
    this.gain.gain.setTargetAtTime(muted ? 0 : vol, this.audio.currentTime, 0.008);
  }
}
