/**
 * One layout grid for the floating HUD panels. Every panel used to pin itself with its own fixed position, so they
 * overlapped as the window changed size. Here they are moved into three columns (left readouts, centre status
 * stack, right sensors) and CSS grid reflows the columns for phones. Panels a pilot has dragged keep their spot.
 */
const COLUMNS: Record<string, string[]> = {
  left: [".location", "#combat-panel", "#view-bar"],
  center: ["#play-toolbar", "#travel-panel", "#tour-status", "#mission-panel", "#rwr", "#surface-traffic-status", "#notice"],
  right: ["#traffic-radar", "#flight-map"],
};
const PHONE = matchMedia("(max-width: 750px), (max-width: 1000px) and (max-height: 500px)");

export function arrangeHud() {
  const hud = document.createElement("div");
  hud.id = "hud";
  for (const [name, ids] of Object.entries(COLUMNS)) {
    const col = document.createElement("div");
    col.className = `hud-col hud-${name}`;
    for (const sel of ids) { const el = document.querySelector(sel); if (el) col.append(el); }
    hud.append(col);
  }
  document.body.append(hud);
  const footer = document.querySelector("footer"), credits = document.createElement("div");
  credits.className = "credits";
  for (const id of ["imagery-credit", "scenery-credit"]) { const el = document.getElementById(id); if (el) credits.append(el); }
  footer?.insertBefore(credits, document.getElementById("clean"));
  // One door for going places: the radar's contact browser joins the tour and summit cards in Explore & Missions.
  const tools = document.getElementById("explore-tools");
  const contacts = document.getElementById("radar-contacts");
  if (contacts && tools) {
    contacts.className = "destination-card tool-card";
    contacts.innerHTML = "<small>Living skies</small><strong>Traffic &amp; satellites</strong><span>Airliners, patrols, 16,000+ orbits ↗</span>";
    tools.append(contacts);
  }
  // Phones (upright or sideways) start with the radar folded so the scope does not cover the view; the header button unfolds it.
  if (PHONE.matches) document.getElementById("traffic-radar")?.classList.add("folded");
}
