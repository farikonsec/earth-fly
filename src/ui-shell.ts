/**
 * The game's screen layout. During flight only the HUD canvas and a few anchored widgets show: the objective
 * (top left), the radar and menu button (top right), threats and messages (top and bottom centre) and the weapons
 * (bottom right). Everything else lives in one menu, opened with Esc or the ☰ button, which pauses the game.
 *
 * The existing controls keep their ids and handlers: they are moved into the menu here rather than rebuilt, so all
 * of main.ts's wiring keeps working.
 */
export interface ShellApi {
  paused(): boolean;
  setPaused(on: boolean): void;
  /** A mission, operation, dogfight or tour is running and can be ended from the menu. */
  activity(): string | null;
  endActivity(): void;
}

const $ = (id: string) => document.getElementById(id);
const touch = matchMedia("(pointer: coarse)");

interface Section { id: string; label: string; build: (body: HTMLElement) => void }

export class Shell {
  menu = document.createElement("div");
  private button = document.createElement("button");
  private nav = document.createElement("nav");
  private body = document.createElement("div");
  private sections: Section[] = [];
  private wasPaused = false;
  private end = document.createElement("button");
  constructor(private api: ShellApi) {
    document.body.classList.add("shell");
    this.anchor();
    this.buildMenu();
    if (touch.matches) this.touchControls();
    touch.addEventListener("change", () => location.reload());
  }

  get open() { return !this.menu.hidden; }
  toggle(force?: boolean) {
    const open = force ?? !this.open;
    if (open === this.open) return;
    if (open) { this.wasPaused = this.api.paused(); this.api.setPaused(true); this.refresh(); }
    else this.api.setPaused(this.wasPaused);
    this.menu.hidden = !open;
    document.body.classList.toggle("menu-open", open);
    if (!open) (document.querySelector("#world canvas") as HTMLElement | null)?.focus({ preventScroll: true });
  }

  /** Moves the in-flight widgets into fixed corners. */
  private anchor() {
    const corner = (id: string, ids: string[]) => {
      const box = document.createElement("div"); box.id = id; box.className = "anchor";
      for (const sel of ids) { const el = document.querySelector(sel); if (el) box.append(el); }
      document.body.append(box); return box;
    };
    corner("anchor-objective", ["#mission-panel", "#combat-panel", "#tour-status", "#raid-status", "#nuke-status", "#sonar-panel"]);
    corner("anchor-alerts", ["#rwr", "#travel-panel"]);
    corner("anchor-messages", ["#notice", "#bridge-flash"]);
    const right = corner("anchor-sensors", ["#traffic-radar"]);
    this.button.id = "menu-button"; this.button.setAttribute("aria-label", "Menu (Esc)"); this.button.title = "Menu · Esc";
    this.button.innerHTML = '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M2 5h14M2 9h14M2 13h14"/></svg>';
    this.button.onclick = () => this.toggle();
    right.prepend(this.button);
    corner("anchor-weapons", ["#combat-actions"]);
    const credit = document.querySelector(".credits"); if (credit) corner("anchor-credit", [".credits"]);
    // Hold-to-fire buttons read better with plain labels.
    const label = (id: string, text: string, key: string) => { const b = $(id); if (b) b.innerHTML = `<span>${text}</span><kbd>${key}</kbd>`; };
    label("fire-gun", "GUN", "Z"); label("fire-missile", "MSL", "X"); label("lock-target", "LOCK", "C"); label("drop-nuke", "NUKE", "N");
  }

  private buildMenu() {
    this.menu.id = "menu"; this.menu.hidden = true; this.menu.setAttribute("role", "dialog"); this.menu.setAttribute("aria-label", "Menu");
    const brand = document.createElement("span"); brand.className = "menu-brand"; brand.textContent = "EARTH FLY";
    this.body.className = "menu-body";
    this.nav.append(brand);
    const item = (label: string, action: () => void) => { const a = document.createElement("button"); a.className = "menu-item"; a.textContent = label; a.onclick = action; this.nav.append(a); return a; };
    item("Resume", () => this.toggle(false));
    const move = (body: HTMLElement, ...ids: string[]) => { for (const id of ids) { const el = $(id) ?? document.querySelector(id); if (el) body.append(el); } };
    const card = (body: HTMLElement, kicker: string, title: string, text: string, action: () => void) => {
      const b = document.createElement("button"); b.className = "menu-card"; b.innerHTML = `<small>${kicker}</small><strong>${title}</strong><span>${text}</span>`;
      b.onclick = () => { this.toggle(false); action(); }; body.append(b); return b;
    };
    this.sections = [
      { id: "fly", label: "Fly", build: (b) => {
        const grid = document.createElement("div"); grid.className = "menu-cards"; b.append(grid);
        card(grid, "Missions", "Missions & places", "Operations, bridge runs, tours and every destination.", () => $("explore-world")?.click());
        card(grid, "Combat", "Dogfight", "A 90-second sortie against fighters.", () => $("practice-start")?.click());
        card(grid, "Anywhere", "Pick a start", "Choose any point on Earth, height and heading.", () => $("planner-button")?.click());
        const presets = document.createElement("div"); presets.className = "menu-row"; b.append(presets);
        move(presets, "#desk label.field:has(#scenario)", "restart");
      } },
      { id: "map", label: "Map", build: (b) => move(b, "flight-map") },
      { id: "camera", label: "Camera", build: (b) => { move(b, "view-bar"); const hint = document.createElement("p"); hint.className = "menu-hint"; hint.textContent = "Keys 1–8 switch views in flight."; b.append(hint); } },
      { id: "aircraft", label: "Aircraft", build: (b) => {
        const row = document.createElement("div"); row.className = "menu-toggles"; b.append(row);
        move(row, "pause", "gear", "torch", "assist", "super-toggle");
        move(b, "travel-panel");
      } },
      { id: "settings", label: "Settings", build: (b) => {
        const row = document.createElement("div"); row.className = "menu-toggles"; b.append(row);
        move(row, "sound", "motion-effects", "clean");
        const fields = document.createElement("div"); fields.className = "menu-fields"; b.append(fields);
        move(fields, "#desk label.field:has(#controls)", "#desk label.field:has(#warp)", "#desk label.field:has(#solar-time)");
        const save = document.createElement("div"); save.className = "menu-toggles"; b.append(save); move(save, "save", "resume");
        const foot = document.createElement("div"); foot.className = "menu-foot"; b.append(foot); move(foot, "fps", "credits-toggle");
      } },
      { id: "help", label: "Controls", build: (b) => {
        b.insertAdjacentHTML("beforeend", `<dl class="keys">
          <dt>W A S D / arrows</dt><dd>Pitch and roll</dd><dt>Q E</dt><dd>Yaw</dd><dt>− =</dt><dd>Thrust</dd><dt>Shift · Ctrl</dt><dd>Boost · airbrake</dd>
          <dt>Z · X · C</dt><dd>Gun · missile · lock</dd><dt>G · V · M</dt><dd>Gear · land assist · torch</dd><dt>1–8</dt><dd>Camera</dd><dt>Y</dt><dd>Superspeed</dd>
          <dt>Space</dt><dd>Pause</dd><dt>H</dt><dd>Hide HUD</dd><dt>Esc</dt><dd>Menu</dd></dl>`);
        move(b, "help-button");
      } },
    ];
    for (const s of this.sections) {
      const body = document.createElement("section"); body.className = "menu-section"; body.dataset.section = s.id; body.hidden = true;
      const h = document.createElement("h2"); h.textContent = s.label; body.append(h); s.build(body); this.body.append(body);
      item(s.label, () => this.show(s.id)).dataset.section = s.id;
    }
    this.end.className = "menu-item danger"; this.end.onclick = () => { this.api.endActivity(); this.toggle(false); };
    this.nav.append(this.end);
    const foot = document.createElement("span"); foot.className = "menu-foot-note"; foot.textContent = touch.matches ? "Tap ☰ to resume" : "Esc to resume"; this.nav.append(foot);
    this.menu.append(this.nav, this.body);
    document.body.append(this.menu);
    // Opening another dialog (explorer, guide, planner) from the menu leaves flight paused behind it.
    for (const id of ["explore-world", "practice-start", "planner-button", "help-button"]) $(id)?.addEventListener("click", () => { if (this.open) this.toggle(false); });
    this.show("fly");
  }
  private show(id: string) {
    for (const s of Array.from(this.body.querySelectorAll<HTMLElement>(".menu-section"))) s.hidden = s.dataset.section !== id;
    for (const b of Array.from(this.nav.querySelectorAll<HTMLElement>(".menu-item"))) b.classList.toggle("on", b.dataset.section === id);
  }
  private refresh() {
    const activity = this.api.activity();
    this.end.hidden = !activity; this.end.textContent = activity ? `End ${activity}` : "";
  }

  /** Phones: a thumb stick on the left, a thrust slider on the right edge, fire buttons in reach of the right thumb. */
  private touchControls() {
    document.body.classList.add("touch-ui");
    const stick = document.createElement("div"); stick.id = "touch-stick"; stick.innerHTML = "<i></i>"; document.body.append(stick);
    const knob = stick.querySelector("i") as HTMLElement, held = new Set<string>();
    const press = (key: string, on: boolean) => {
      if (on === held.has(key)) return;
      if (on) held.add(key); else held.delete(key);
      dispatchEvent(new KeyboardEvent(on ? "keydown" : "keyup", { key }));
    };
    let pointer = -1;
    const move = (e: PointerEvent) => {
      const r = stick.getBoundingClientRect(), max = r.width / 2, dx = e.clientX - (r.left + max), dy = e.clientY - (r.top + max), d = Math.hypot(dx, dy), k = Math.min(1, max / Math.max(d, 1));
      knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      const x = dx / max, y = dy / max, dead = 0.28;
      press("a", x < -dead); press("d", x > dead); press("w", y < -dead); press("s", y > dead); // up climbs, as the old arrow pad did
    };
    stick.addEventListener("pointerdown", (e) => { pointer = e.pointerId; move(e); e.preventDefault(); try { stick.setPointerCapture(pointer); } catch { /* pointer already gone */ } });
    stick.addEventListener("pointermove", (e) => { if (e.pointerId === pointer) move(e); });
    const release = () => { pointer = -1; knob.style.transform = ""; for (const k of [...held]) press(k, false); };
    stick.addEventListener("pointerup", release); stick.addEventListener("pointercancel", release);

    const slider = document.createElement("div"); slider.id = "touch-thrust"; slider.innerHTML = "<b>0%</b><i></i>"; document.body.append(slider);
    const fill = slider.querySelector("i") as HTMLElement, readout = slider.querySelector("b") as HTMLElement, range = $("throttle") as HTMLInputElement | null;
    const set = (e: PointerEvent) => {
      const r = slider.getBoundingClientRect(), t = Math.max(0, Math.min(1, (r.bottom - e.clientY) / r.height));
      if (range) { range.value = String(Math.round(t * 100)); range.dispatchEvent(new Event("input", { bubbles: true })); }
    };
    let thumb = -1;
    slider.addEventListener("pointerdown", (e) => { thumb = e.pointerId; set(e); e.preventDefault(); try { slider.setPointerCapture(thumb); } catch { /* pointer already gone */ } });
    slider.addEventListener("pointermove", (e) => { if (e.pointerId === thumb) set(e); });
    slider.addEventListener("pointerup", () => { thumb = -1; });
    const sync = () => { const t = Number(range?.value ?? 0) / 100; fill.style.height = `${t * 100}%`; readout.textContent = `${Math.round(t * 100)}%`; requestAnimationFrame(sync); };
    requestAnimationFrame(sync);
    // Boost and airbrake ride above the slider; the old arrow pad goes.
    const extras = document.createElement("div"); extras.id = "touch-extras"; document.body.append(extras);
    for (const b of Array.from(document.querySelectorAll<HTMLElement>('#touch-flight [data-flight-key="shift"], #touch-flight [data-flight-key="control"]'))) extras.append(b);
  }
}
