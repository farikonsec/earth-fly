import {trueHeading} from "./navigation";
import * as T from "three";
import type { FlightTelemetry } from "./flight";
import type { Altimetry } from './altimetry';
export class Instruments {
  canvas = document.createElement("canvas");
  ctx = this.canvas.getContext("2d")!;
  constructor() {
    this.canvas.id = "instruments";
    this.canvas.setAttribute("aria-hidden", "true");
    document.body.append(this.canvas);
  }
  draw(
    camera: T.PerspectiveCamera,
    rotation: T.Quaternion,
    tele: FlightTelemetry | undefined,
    mode: string,
    spaceSpeed?: number,
    altimetry?:Altimetry,
  ) {
    const w = innerWidth,
      h = innerHeight,
      dpr = Math.min(2, devicePixelRatio);
    if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
      this.canvas.style.width = w + "px";
      this.canvas.style.height = h + "px";
    }
    const c = this.ctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    if (!tele || mode === "planet") return;
    const up = new T.Vector3(...tele.up),
      fwd = new T.Vector3(0, 0, -1).applyQuaternion(rotation),
      right = new T.Vector3(1, 0, 0).applyQuaternion(rotation);
    const pitch =
        (Math.asin(T.MathUtils.clamp(fwd.dot(up), -1, 1)) * 180) / Math.PI,
      bank = Math.atan2(
        right.dot(up),
        new T.Vector3(0, 1, 0).applyQuaternion(rotation).dot(up),
      ),
      heading = trueHeading(rotation,up);
    const x = w * 0.5,
      y = h * (w<650?.56:.5),hudScale=w<650?.66:1;
    c.save();
    c.translate(x, y);c.scale(hudScale,hudScale);
    c.strokeStyle = "rgba(182,255,218,.7)";
    c.fillStyle = "#c2f9df";
    c.shadowColor = "#001d26";
    c.shadowBlur = 3;
    c.lineWidth = 1;
    c.font = "10px monospace";
    c.save();
    c.beginPath();
    c.rect(-170, -145, 340, 290);
    c.clip();
    c.rotate(bank);
    for (let a = -60; a <= 60; a += 10) {
      const py = (pitch - a) * 4.3;
      if (Math.abs(py) > 145) continue;
      c.setLineDash(a < 0 ? [5, 5] : []);
      const width = a === 0 ? 135 : 65;
      c.beginPath();
      c.moveTo(-width, py);
      c.lineTo(-20, py);
      c.moveTo(20, py);
      c.lineTo(width, py);
      c.stroke();
      if (a !== 0) {
        c.fillText(String(a), -width - 23, py + 3);
        c.fillText(String(a), width + 8, py + 3);
      }
    }
    c.restore();
    c.setLineDash([]);
    c.font = "11px monospace";
    c.save();c.beginPath();c.rect(-140,-205,280,48);c.clip();
    for(let delta=-65;delta<=65;delta++){const degree=Math.round(heading)+delta;if(((degree%10)+10)%10)continue;const px=(degree-heading)*3.2;c.beginPath();c.moveTo(px,-190);c.lineTo(px,-184);c.stroke();const d=(degree%360+360)%360;const label=d===0?'N':d===90?'E':d===180?'S':d===270?'W':String(d).padStart(3,'0');c.textAlign='center';c.fillText(label,px,-195);}
    c.restore();c.textAlign='center';c.fillText('▼',0,-177);c.fillText(`${String(Math.round(heading)%360).padStart(3, "0")}° TRUE`,0,-161);c.textAlign='left';
    c.fillText(spaceSpeed === undefined ? `M ${tele.mach.toFixed(2)}` : `${spaceSpeed.toFixed(2)} km/s`, -200, 5);
    c.fillStyle=altimetry?.level==='critical'?'#ff9c87':altimetry?.level==='caution'?'#ffd099':'#c2f9df';
    c.fillText(`${(altimetry?.clearance??tele.agl).toFixed(1)} m MODEL CLR`,155,5);
    c.fillStyle='#c2f9df';
    c.fillText(`${tele.gLoad.toFixed(1)} G`, -200, 24);
    if (Math.abs(tele.alpha) > 0.28 && tele.dynamicPressure > 500) {
      c.fillStyle = "#ffc18c";
      c.textAlign = "center";
      c.fillText("STALL · LOWER THE NOSE", 0, 155);
    }
    const velocity = new T.Vector3(...tele.airVelocity);
    if (velocity.length() > 0.01) {
      const p = velocity
        .normalize()
        .multiplyScalar(10)
        .add(camera.position)
        .project(camera);
      const vx = (p.x * w) / 2/hudScale,
        vy = ((-p.y * h) / 2+h*.5-y)/hudScale;
      if (Math.abs(vx) < 210 && Math.abs(vy) < 150) {
        c.beginPath();
        c.arc(vx, vy, 7, 0, Math.PI * 2);
        c.moveTo(vx - 17, vy);
        c.lineTo(vx - 7, vy);
        c.moveTo(vx + 7, vy);
        c.lineTo(vx + 17, vy);
        c.moveTo(vx, vy - 7);
        c.lineTo(vx, vy - 14);
        c.stroke();
      }
    }
    if (mode === "cockpit") {
      c.restore();c.save();c.translate(w/2,h/2);
      c.fillStyle = "#0a141ded";
      c.beginPath();
      c.moveTo(-w / 2, h / 2);
      c.lineTo(-w / 2, h * 0.3);
      c.lineTo(-w * 0.18, h * 0.23);
      c.lineTo(w * 0.18, h * 0.23);
      c.lineTo(w / 2, h * 0.3);
      c.lineTo(w / 2, h / 2);
      c.fill();
      c.strokeStyle = "#46616d";
      c.stroke();
      c.fillStyle = "#86a5ae";
      c.font = "10px monospace";
      c.fillText("PATHFINDER / ESV-01", -70, h * 0.28);
    }
    c.restore();
  }
}
