/**
 * Frame profiler overlay, off until toggled (backquote or F3, or ?perf in the address). It answers one question:
 * where does a frame go? A rolling frame-time graph, time per stage on the main thread, true GPU time where the
 * browser exposes it, draw calls, resolution and how fast the game is creating garbage.
 */
type TimerExt = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };
export class Perf {
  visible = false;
  private el = document.createElement("div"); private graph = document.createElement("canvas"); private text = document.createElement("pre");
  private times = new Float32Array(240); private cursor = 0; private stages = new Map<string, number>(); private last = 0; private start = 0;
  private ext: TimerExt | null; private active: WebGLQuery | null = null; private waiting: WebGLQuery[] = []; private gpu = 0;
  private shown = 0; private heap = 0; private alloc = 0; private heapAt = 0;
  constructor(private gl: WebGL2RenderingContext, private info: () => { calls: number; triangles: number; ratio: number; width: number; height: number }) {
    this.ext = gl.getExtension("EXT_disjoint_timer_query_webgl2") as TimerExt | null;
    this.el.id = "perf"; this.el.hidden = true; this.graph.width = 240; this.graph.height = 60; this.el.append(this.graph, this.text); document.body.append(this.el);
    if (new URLSearchParams(location.search).has("perf")) this.toggle();
  }
  toggle() { this.visible = !this.visible; this.el.hidden = !this.visible; this.stages.clear(); }
  /** Call at the top of a frame. */
  begin() {
    if (!this.visible) return;
    this.start = this.last = performance.now();
    if (this.ext && !this.active && this.waiting.length < 4) { this.active = this.gl.createQuery(); if (this.active) this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.active); }
  }
  /** Charges the time since the previous mark to `stage`. */
  mark(stage: string) {
    if (!this.visible) return;
    const now = performance.now(); this.stages.set(stage, (this.stages.get(stage) ?? now - this.last) * 0.92 + (now - this.last) * 0.08); this.last = now;
  }
  /** Call at the end of a frame with the frame interval in seconds. */
  end(dt: number) {
    if (!this.visible) return;
    const gl = this.gl, now = performance.now();
    if (this.ext && this.active) { gl.endQuery(this.ext.TIME_ELAPSED_EXT); this.waiting.push(this.active); this.active = null; }
    while (this.ext && this.waiting.length && gl.getQueryParameter(this.waiting[0], gl.QUERY_RESULT_AVAILABLE)) {
      const q = this.waiting.shift()!; if (!gl.getParameter(this.ext.GPU_DISJOINT_EXT)) this.gpu = this.gpu * 0.9 + (gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6) * 0.1; gl.deleteQuery(q);
    }
    this.times[this.cursor] = dt * 1000; this.cursor = (this.cursor + 1) % this.times.length;
    const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    if (memory && now - this.heapAt > 250) { const used = memory.usedJSHeapSize; if (used > this.heap && this.heapAt) this.alloc = this.alloc * 0.8 + ((used - this.heap) / 1048576 / ((now - this.heapAt) / 1000)) * 0.2; this.heap = used; this.heapAt = now; }
    if (now - this.shown < 250) return; this.shown = now;
    const sorted = Array.from(this.times).filter((t) => t > 0).sort((a, b) => a - b), n = sorted.length || 1, median = sorted[n >> 1] ?? 0, slow = sorted[Math.min(n - 1, Math.floor(n * 0.99))] ?? 0, info = this.info();
    const c = this.graph.getContext("2d")!; c.clearRect(0, 0, 240, 60); c.fillStyle = "#0008"; c.fillRect(0, 0, 240, 60);
    for (const [ms, colour] of [[16.7, "#4fd18a66"], [33.3, "#ffb35c66"]] as const) { c.fillStyle = colour; c.fillRect(0, 60 - ms, 240, 1); }
    for (let i = 0; i < 240; i++) { const t = this.times[(this.cursor + i) % 240]; c.fillStyle = t > 33.3 ? "#ff5e62" : t > 18 ? "#ffb35c" : "#9fe8b4"; c.fillRect(i, 60 - Math.min(60, t), 1, Math.min(60, t)); }
    const cpu = now - this.start, lines = [`${(1000 / Math.max(1, median)).toFixed(0)} fps · median ${median.toFixed(1)} ms · worst 1% ${slow.toFixed(1)} ms`,
      `main thread ${cpu.toFixed(1)} ms${this.ext ? ` · GPU ${this.gpu.toFixed(1)} ms` : " · GPU timer unavailable"}`,
      ...Array.from(this.stages, ([name, ms]) => `  ${name.padEnd(9)} ${ms.toFixed(2)} ms`),
      `${info.calls} draws · ${(info.triangles / 1000).toFixed(0)}k tris · ${info.width}×${info.height} @${info.ratio.toFixed(2)}`,
      memory ? `garbage ${this.alloc.toFixed(1)} MB/s · heap ${(this.heap / 1048576).toFixed(0)} MB` : "memory stats unavailable"];
    this.text.textContent = lines.join("\n");
  }
}
