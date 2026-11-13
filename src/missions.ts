import { BRIDGES } from "./bridges-data";
import type { Bridges, BridgeEvent } from "./bridges";

export interface Mission { id: string; title: string; detail: string; gates: string[]; start: { bridge: string; side: "east" | "west"; distance: number }; speed: number }
const one = (id: string, title: string, side: "east" | "west" = "east", distance = 600, speed = 95): Mission => ({ id: `under-${id}`, title: `Fly under ${title}`, detail: "", gates: [id], start: { bridge: id, side, distance }, speed });
/** Mission list: long runs first, then every single bridge. More big bridges can be added to bridges-data.ts. */
export const MISSIONS: Mission[] = [
  { id: "thames-run", title: "The Thames Run", detail: "Ten bridges, Tower Bridge to Westminster, in order", gates: ["tower", "london", "cannon", "southwark", "millennium", "blackfriars-rail", "blackfriars", "waterloo", "hungerford", "westminster"], start: { bridge: "tower", side: "east", distance: 700 }, speed: 95 },
  { id: "chelsea-reach", title: "Chelsea Reach", detail: "Vauxhall to Battersea: five bridges", gates: ["vauxhall", "grosvenor", "chelsea", "albert", "battersea"], start: { bridge: "vauxhall", side: "east", distance: 500 }, speed: 95 },
  { id: "forth-three", title: "Three Forth Bridges", detail: "Forth Bridge, Forth Road Bridge, Queensferry Crossing", gates: ["forth", "forth-road", "queensferry"], start: { bridge: "forth", side: "east", distance: 1500 }, speed: 120 },
  { id: "severn-pair", title: "Both Severn Crossings", detail: "Prince of Wales Bridge, then the Severn Bridge", gates: ["prince-of-wales", "severn"], start: { bridge: "prince-of-wales", side: "west", distance: 1500 }, speed: 120 },
  // About 95-100 m/s holds height hands-off at sea level; slower and the aircraft settles into the river.
  ...BRIDGES.map((b) => one(b.id, b.name, "east", b.spans || b.kind === "cantilever" ? 1500 : 600, b.spans || b.kind === "cantilever" ? 130 : 95)),
];
for (const m of MISSIONS) if (!m.detail) { const b = BRIDGES.find((x) => x.id === m.gates[0])!, main = b.clearances[b.main]; m.detail = `${main} m above high water${b.clearances.length > 1 ? ` · ${b.clearances.length} spans` : ""}${b.note ? ` · ${b.note}` : ""}`; }

/** Runs one mission: gate order, timing, best times (kept in this browser), and the result line for the HUD. */
export class MissionRun {
  active: Mission | null = null; next = 0; started = 0; finished = 0; status: "idle" | "flying" | "done" | "failed" = "idle"; last = ""; clearances: number[] = [];
  private best: Record<string, number> = (() => { try { return JSON.parse(localStorage.getItem("earth-fly-missions") ?? "{}"); } catch { return {}; } })();
  constructor(private bridges: Bridges) {}
  bestFor(id: string) { return this.best[id]; }
  start(m: Mission, time: number) { this.active = m; this.next = 0; this.started = time; this.status = "flying"; this.clearances = []; this.last = ""; this.bridges.showGate(m.gates[0]); }
  stop() { this.active = null; this.status = "idle"; this.bridges.showGate(null); }
  fail(reason: string) { if (this.status !== "flying") return; this.status = "failed"; this.last = reason; this.bridges.showGate(null); }
  /** Feed bridge events; returns a short line to flash on screen, if any. */
  events(list: BridgeEvent[], time: number): string | null {
    let flash: string | null = null;
    for (const e of list) {
      if (e.type !== "under") continue;
      const line = `Under ${e.bridge.spec.name} · ${e.clearance!.toFixed(1)} m to spare`;
      flash = line;
      if (this.status !== "flying" || !this.active || e.bridge.spec.id !== this.active.gates[this.next]) continue;
      this.clearances.push(e.clearance!); this.next++;
      if (this.next >= this.active.gates.length) {
        this.status = "done"; this.finished = time - this.started; this.bridges.showGate(null);
        const previous = this.best[this.active.id]; if (!previous || this.finished < previous) { this.best[this.active.id] = this.finished; try { localStorage.setItem("earth-fly-missions", JSON.stringify(this.best)); } catch { /* private mode */ } }
        this.last = `${this.active.title} complete · ${format(this.finished)}${previous && this.finished >= previous ? ` · best ${format(previous)}` : " · new best"}`;
      } else this.bridges.showGate(this.active.gates[this.next]);
    }
    return flash;
  }
  hud(time: number) {
    if (!this.active) return "";
    const m = this.active, total = m.gates.length, b = BRIDGES.find((x) => x.id === m.gates[Math.min(this.next, total - 1)]);
    if (this.status === "done") return `${this.last} · Enter to fly again`;
    if (this.status === "failed") return `Mission failed · ${this.last} · Enter to retry`;
    return `${m.title} · ${this.next}/${total} · next: ${b?.name ?? ""} · ${format(time - this.started)}`;
  }
}
export const format = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
