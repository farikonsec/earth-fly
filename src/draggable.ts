/**
 * Floating panels you can drag by their header and that come to the front when touched, so one never stays hidden
 * behind another. Every load starts docked in the HUD grid (hud-layout.ts); a dragged panel floats for this session
 * only, and double-clicking its header docks it again. Positions saved by older versions are purged so they can
 * no longer pull panels out of the grid.
 */
let top = 30;
const KEY = "earth-fly-panel-";
const TOUCH = matchMedia("(pointer: coarse)");
const INTERACTIVE = "button,select,input,textarea,a,canvas,label";

function place(el: HTMLElement, x: number, y: number) {
  const r = el.getBoundingClientRect(), maxX = Math.max(0, innerWidth - Math.min(r.width, innerWidth)), maxY = Math.max(0, innerHeight - 40);
  el.classList.add("floating");
  Object.assign(el.style, { position: "fixed", left: `${Math.min(Math.max(0, x), maxX)}px`, top: `${Math.min(Math.max(0, y), maxY)}px`, right: "auto", bottom: "auto", margin: "0", transform: "none" });
}

export function makeDraggable(el: HTMLElement, handle: HTMLElement = el) {
  const id = el.id;
  handle.classList.add("drag-handle"); handle.title ||= "Drag to undock · double-click to dock";
  el.addEventListener("pointerdown", () => { el.style.zIndex = String(++top); }, true);
  try { localStorage.removeItem(KEY + id); } catch { /* storage blocked */ }
  let start: { x: number; y: number; left: number; top: number; id: number } | null = null, moved = false;
  handle.addEventListener("pointerdown", (e) => {
    if (TOUCH.matches || e.button !== 0 || (e.target as HTMLElement).closest(INTERACTIVE)) return;
    const r = el.getBoundingClientRect(); start = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, id: e.pointerId }; moved = false;
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener("pointermove", (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (!moved && Math.hypot(dx, dy) < 4) return;
    moved = true; el.classList.add("dragging"); place(el, start.left + dx, start.top + dy);
  });
  const end = (e: PointerEvent) => {
    if (!start || e.pointerId !== start.id) return;
    start = null; el.classList.remove("dragging");
  };
  handle.addEventListener("pointerup", end); handle.addEventListener("pointercancel", end);
  handle.addEventListener("dblclick", (e) => {
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
    el.classList.remove("floating");
    for (const k of ["position", "left", "top", "right", "bottom", "margin", "transform"]) el.style.removeProperty(k);
  });
  addEventListener("resize", () => { if (el.style.left) { const r = el.getBoundingClientRect(); place(el, r.left, r.top); } });
}
