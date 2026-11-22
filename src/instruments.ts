import {trueHeading} from "./navigation";
import * as T from "three";
import type { FlightTelemetry } from "./flight";
import type { Altimetry } from './altimetry';

/** Values the HUD shows that are not part of the flight telemetry. */
export interface HudExtras { altitude: number; throttle: number; boost: boolean; airbrake: boolean; fuel: number; damage: number; gear: boolean; touch: boolean }

const HUD = "#dffbe9", DIM = "rgba(223,251,233,.55)", FAINT = "rgba(223,251,233,.3)", WARN = "#ffb547", DANGER = "#ff5d5d", PLATE = "rgba(10,15,21,.72)";
const FONT = '-apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,"Segoe UI",Roboto,sans-serif';
const font = (size: number, weight = 500) => `${weight} ${size}px ${FONT}`;
const group = (n: number) => Math.round(n).toLocaleString("en-GB");

/**
 * Head-up display drawn on one canvas over the world: heading tape, speed and altitude tapes either side of the
 * flight-path marker, a light pitch ladder and the thrust bar. Thin lines in one colour, boxes only round the
 * live values; amber and red only for cautions and threats. On a phone the tapes collapse to two numbers.
 */
export class Instruments {
  canvas = document.createElement("canvas");
  ctx = this.canvas.getContext("2d")!;
  constructor() {
    this.canvas.id = "instruments";
    this.canvas.setAttribute("aria-hidden", "true");
    document.body.append(this.canvas);
  }
  draw(camera: T.PerspectiveCamera, rotation: T.Quaternion, tele: FlightTelemetry | undefined, mode: string, spaceSpeed?: number, altimetry?: Altimetry, extra?: HudExtras) {
    const w = innerWidth, h = innerHeight, dpr = Math.min(2, devicePixelRatio);
    if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
      this.canvas.width = w * dpr; this.canvas.height = h * dpr;
      this.canvas.style.width = w + "px"; this.canvas.style.height = h + "px";
    }
    const c = this.ctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    if (!tele || mode === "planet") return;
    const up = new T.Vector3(...tele.up), fwd = new T.Vector3(0, 0, -1).applyQuaternion(rotation), right = new T.Vector3(1, 0, 0).applyQuaternion(rotation);
    const pitch = (Math.asin(T.MathUtils.clamp(fwd.dot(up), -1, 1)) * 180) / Math.PI;
    const bank = Math.atan2(right.dot(up), new T.Vector3(0, 1, 0).applyQuaternion(rotation).dot(up));
    const heading = trueHeading(rotation, up);
    const compact = w < 700 || !!extra?.touch, cx = w / 2, cy = h * (compact ? 0.5 : 0.5);
    c.lineWidth = 1.2; c.strokeStyle = HUD; c.fillStyle = HUD; c.shadowColor = "rgba(0,0,0,.75)"; c.shadowBlur = 3; c.textBaseline = "middle";

    // ---- pitch ladder: 10° rungs inside a small circle, dashed below the horizon --------------------------------
    const radius = compact ? 90 : 130, perDeg = compact ? 3.2 : 4.3;
    c.save(); c.translate(cx, cy); c.beginPath(); c.arc(0, 0, radius, 0, Math.PI * 2); c.clip(); c.rotate(bank);
    c.font = font(10); c.strokeStyle = FAINT; c.fillStyle = DIM;
    for (let a = -80; a <= 80; a += 10) {
      const py = (pitch - a) * perDeg; if (Math.abs(py) > radius) continue;
      const half = a === 0 ? radius : compact ? 34 : 52, gap = compact ? 14 : 20;
      c.setLineDash(a < 0 ? [5, 4] : []); c.beginPath(); c.moveTo(-half, py); c.lineTo(-gap, py); c.moveTo(gap, py); c.lineTo(half, py); c.stroke();
      if (a !== 0) { c.textAlign = "left"; c.fillText(String(Math.abs(a)), half + 5, py); }
    }
    c.restore(); c.setLineDash([]);

    // ---- flight-path marker (where the aircraft is actually going) ----------------------------------------------
    c.strokeStyle = HUD; c.fillStyle = HUD;
    const velocity = new T.Vector3(...tele.airVelocity);
    let mx = cx, my = cy;
    if (velocity.length() > 0.01) {
      const p = velocity.normalize().multiplyScalar(10).add(camera.position).project(camera);
      mx = ((p.x + 1) / 2) * w; my = ((1 - p.y) / 2) * h;
      if (Math.hypot(mx - cx, my - cy) > radius) { const k = radius / Math.hypot(mx - cx, my - cy); mx = cx + (mx - cx) * k; my = cy + (my - cy) * k; }
    }
    c.beginPath(); c.arc(mx, my, 7, 0, Math.PI * 2); c.moveTo(mx - 17, my); c.lineTo(mx - 7, my); c.moveTo(mx + 7, my); c.lineTo(mx + 17, my); c.moveTo(mx, my - 7); c.lineTo(mx, my - 14); c.stroke();
    if (Math.abs(tele.alpha) > 0.28 && tele.dynamicPressure > 500) { c.fillStyle = WARN; c.font = font(12, 600); c.textAlign = "center"; c.fillText("STALL", mx, my + 30); c.fillStyle = HUD; }

    // ---- heading tape --------------------------------------------------------------------------------------------
    const tapeW = compact ? 220 : 340, top = compact ? 62 : 30, perHdg = compact ? 3 : 3.4;
    c.save(); c.beginPath(); c.rect(cx - tapeW / 2, top - 6, tapeW, 40); c.clip();
    c.strokeStyle = FAINT; c.beginPath(); c.moveTo(cx - tapeW / 2, top + 22); c.lineTo(cx + tapeW / 2, top + 22); c.stroke();
    c.strokeStyle = HUD; c.font = font(11); c.textAlign = "center";
    for (let d = Math.floor(heading / 5) * 5 - 60; d <= heading + 60; d += 5) {
      const x = cx + (d - heading) * perHdg, major = d % 10 === 0, n = ((d % 360) + 360) % 360;
      c.beginPath(); c.moveTo(x, top + 22); c.lineTo(x, top + (major ? 15 : 18)); c.stroke();
      if (n % 30 === 0) c.fillText(n === 0 ? "N" : n === 90 ? "E" : n === 180 ? "S" : n === 270 ? "W" : String(n).padStart(3, "0"), x, top + 6);
    }
    c.restore();
    const hdg = String(Math.round(heading) % 360).padStart(3, "0");
    c.font = font(13, 600); c.textAlign = "center"; plate(c, cx - 22, top - 4, 44, 19); c.fillStyle = HUD; c.fillText(hdg, cx, top + 6);
    c.beginPath(); c.moveTo(cx - 4, top + 26); c.lineTo(cx, top + 31); c.lineTo(cx + 4, top + 26); c.stroke();

    // ---- speed and altitude ---------------------------------------------------------------------------------------
    const alt = extra?.altitude ?? 0, speed = spaceSpeed ?? tele.airspeed, clearance = altimetry?.clearance ?? tele.agl;
    const altColour = altimetry?.level === "critical" ? DANGER : altimetry?.level === "caution" ? WARN : HUD;
    const speedText = spaceSpeed === undefined ? group(speed) : spaceSpeed.toFixed(2), speedSub = spaceSpeed === undefined ? `M ${tele.mach.toFixed(2)} · ${tele.gLoad.toFixed(1)} g` : "km/s";
    const vs = `${tele.verticalSpeed >= 0 ? "+" : "−"}${group(Math.abs(tele.verticalSpeed))} m/s`, radio = clearance < 600 ? ` · R ${group(clearance)}` : "";
    if (compact) {
      c.textAlign = "right"; c.font = font(20, 600); c.fillText(speedText, cx - 118, cy); c.font = font(10, 600); c.fillStyle = DIM; c.fillText(spaceSpeed === undefined ? `M/S · M ${tele.mach.toFixed(2)}` : "KM/S", cx - 118, cy + 18);
      c.textAlign = "left"; c.fillStyle = altColour; c.font = font(20, 600); c.fillText(group(alt), cx + 118, cy); c.font = font(10, 600); c.fillStyle = DIM; c.fillText(`M${radio}`, cx + 118, cy + 18);
    } else {
      const span = 150, sx = cx - 250, ax = cx + 250;
      // Speed tape: 10 m/s per 30 px, labels every 20.
      if (spaceSpeed === undefined) tape(c, sx, cy, span, speed, 10, 30, 20, "left");
      c.font = font(17, 600); c.textAlign = "right"; pointer(c, sx - 66, cy, 60, "right"); c.fillStyle = HUD; c.fillText(speedText, sx - 12, cy);
      c.font = font(10); c.fillStyle = DIM; c.fillText(speedSub, sx, cy + span + 14);
      // Altitude tape: 50 m per 30 px, labels every 100.
      tape(c, ax, cy, span, alt, 50, 30, 100, "right");
      c.font = font(17, 600); c.textAlign = "left"; pointer(c, ax + 6, cy, 72, "left"); c.fillStyle = altColour; c.fillText(group(alt), ax + 14, cy);
      c.font = font(10); c.fillStyle = altColour === HUD ? DIM : altColour; c.fillText(vs + radio, ax, cy + span + 14);
    }

    // ---- thrust (PC; on a phone the thrust slider shows it) --------------------------------------------------------
    if (extra && !compact) {
      const x = 28, bottom = h - 34, rail = 110, t = Math.max(0, Math.min(1, extra.throttle));
      c.shadowBlur = 0; c.fillStyle = "rgba(255,255,255,.16)"; c.fillRect(x, bottom - rail, 4, rail);
      c.fillStyle = HUD; c.fillRect(x, bottom - rail * t, 4, rail * t);
      if (extra.boost) { c.fillStyle = WARN; c.fillRect(x, bottom - rail, 4, rail * 0.12); }
      c.shadowBlur = 3; c.textAlign = "left";
      c.font = font(10, 600); c.fillStyle = DIM; c.fillText(extra.airbrake ? "AIRBRAKE" : extra.boost ? "THRUST · BOOST" : "THRUST", x + 16, bottom - 54);
      c.font = font(26, 500); c.fillStyle = HUD; c.fillText(`${Math.round(t * 100)}%`, x + 14, bottom - 30);
      const notes = [extra.gear ? "Gear down" : "", extra.damage > 0.5 ? `Hull ${Math.round(100 - extra.damage)}%` : "", extra.fuel < 99.5 ? `Fuel ${Math.round(extra.fuel)}%` : ""].filter(Boolean);
      c.font = font(10, 600); c.fillStyle = extra.damage > 30 || extra.fuel < 15 ? WARN : DIM; c.fillText(notes.join(" · ").toUpperCase(), x + 16, bottom - 8);
    }

    if (mode === "cockpit") {
      c.shadowBlur = 0; c.fillStyle = "rgba(10,20,29,.93)";
      c.beginPath(); c.moveTo(0, h); c.lineTo(0, h * 0.8); c.lineTo(w * 0.32, h * 0.73); c.lineTo(w * 0.68, h * 0.73); c.lineTo(w, h * 0.8); c.lineTo(w, h); c.fill();
      c.strokeStyle = "#46616d"; c.stroke();
    }
    c.shadowBlur = 0;
  }
}

/** A dark plate behind a live value. */
function plate(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  c.save(); c.shadowBlur = 0; c.fillStyle = PLATE; c.strokeStyle = HUD; c.beginPath(); c.roundRect(x, y, w, h, 3); c.fill(); c.stroke(); c.restore();
}
/** Readout box with a point toward the tape. */
function pointer(c: CanvasRenderingContext2D, x: number, y: number, w: number, side: "left" | "right") {
  c.save(); c.shadowBlur = 0; c.fillStyle = PLATE; c.strokeStyle = HUD; c.beginPath();
  if (side === "right") { c.moveTo(x, y - 11); c.lineTo(x + w - 8, y - 11); c.lineTo(x + w, y); c.lineTo(x + w - 8, y + 11); c.lineTo(x, y + 11); }
  else { c.moveTo(x + 8, y - 11); c.lineTo(x + w, y - 11); c.lineTo(x + w, y + 11); c.lineTo(x + 8, y + 11); c.lineTo(x, y); }
  c.closePath(); c.fill(); c.stroke(); c.restore();
}
/** A vertical tape centred on `value`: ticks every `step`, `px` apart, labels every `label`. */
function tape(c: CanvasRenderingContext2D, x: number, cy: number, span: number, value: number, step: number, px: number, label: number, side: "left" | "right") {
  c.save(); c.beginPath(); c.rect(x - 70, cy - span, 140, span * 2); c.clip();
  c.strokeStyle = FAINT; c.beginPath(); c.moveTo(x, cy - span); c.lineTo(x, cy + span); c.stroke();
  c.strokeStyle = HUD; c.fillStyle = DIM; c.font = font(11); c.textAlign = side === "left" ? "right" : "left";
  const first = Math.floor((value - (span / px) * step) / step) * step;
  for (let v = first; v <= value + (span / px) * step; v += step) {
    const y = cy - ((v - value) / step) * px, major = v % label === 0, len = major ? 8 : 4, dx = side === "left" ? -len : len;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + dx, y); c.stroke();
    if (major && Math.abs(y - cy) > 16) c.fillText(group(v), x + (side === "left" ? -12 : 12), y);
  }
  c.restore();
}
