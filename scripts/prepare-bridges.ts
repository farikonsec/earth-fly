/**
 * Bridge geometry from OpenStreetMap (ODbL): deck axis end points and width from each named bridge outline
 * (man_made=bridge), or from the deck centreline where no outline exists. Heights are not in OSM; they come from
 * src/bridges-data.ts. Source snapshots: work/bridges/*.json. Writes public/scenery/bridges.json.
 */
const files = ["thames", "severn", "forth", "westminster", "richmondrail", "forthrail"];
type G = { lat: number; lon: number }[];
const outlines = new Map<string, G>(), lines = new Map<string, G>();
for (const f of files) {
  const d = await Bun.file(`work/bridges/${f}.json`).json().catch(() => null); if (!d) continue;
  for (const e of d.elements) { const t = e.tags ?? {}, g: G = e.geometry; if (!g?.length) continue;
    if (t.man_made === "bridge" && t.name) outlines.set(t.name, g);
    else if (t.bridge && (t.highway === "primary" || t.railway === "rail") && g.length > 1) { const key = f === "westminster" ? "Westminster Bridge" : f === "richmondrail" ? "Richmond Railway Bridge" : f === "forthrail" && t.name === "East Coast (Northern) Line" ? "Forth Bridge" : ""; if (!key) continue; const old = lines.get(key); if (!old || length(g) > length(old)) lines.set(key, g); } }
}
function length(g: G) { let s = 0; for (let i = 1; i < g.length; i++) s += Math.hypot((g[i].lon - g[i - 1].lon) * 111195 * Math.cos((g[0].lat * Math.PI) / 180), (g[i].lat - g[i - 1].lat) * 111195); return s; }
// Westminster: join its carriageway pieces into one span from the westernmost to the easternmost point.
const west = await Bun.file("work/bridges/westminster.json").json(); const wpts = west.elements.filter((e: any) => e.tags?.highway === "primary").flatMap((e: any) => e.geometry); wpts.sort((a: any, b: any) => a.lon - b.lon); lines.set("Westminster Bridge", [wpts[0], wpts.at(-1)]);
const out: Record<string, { a: [number, number]; b: [number, number]; width: number }> = {};
for (const [name, g] of [...outlines, ...[...lines].filter(([n]) => !outlines.has(n))]) {
  const lat0 = g[0].lat, kx = 111195 * Math.cos((lat0 * Math.PI) / 180), ky = 111195, pts = g.map((p) => [(p.lon - g[0].lon) * kx, (p.lat - lat0) * ky]);
  let cx = 0, cy = 0; for (const [x, y] of pts) { cx += x / pts.length; cy += y / pts.length; }
  let sxx = 0, syy = 0, sxy = 0; for (const [x, y] of pts) { sxx += (x - cx) ** 2; syy += (y - cy) ** 2; sxy += (x - cx) * (y - cy); }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(angle), uy = Math.sin(angle);
  let lo = 1e9, hi = -1e9, wlo = 1e9, whi = -1e9; for (const [x, y] of pts) { const s = (x - cx) * ux + (y - cy) * uy, w = -(x - cx) * uy + (y - cy) * ux; lo = Math.min(lo, s); hi = Math.max(hi, s); wlo = Math.min(wlo, w); whi = Math.max(whi, w); }
  const at = (s: number, w = (wlo + whi) / 2): [number, number] => { const x = cx + ux * s - uy * w, y = cy + uy * s + ux * w; return [Number((lat0 + y / ky).toFixed(7)), Number((g[0].lon + x / kx).toFixed(7))]; };
  out[name] = { a: at(lo), b: at(hi), width: Math.round(Math.max(4, whi - wlo) * 10) / 10 };
}
// Long, curved crossings: take the straight main structure around the middle of the carriageway polyline.
const decks = await Bun.file("work/bridges/decks.json").json();
for (const [name, id, keep] of [["Prince of Wales Bridge", 2954405, 1800], ["Queen Elizabeth II Bridge", 20003982, 1500]] as const) {
  const g: G = decks.elements.find((e: any) => e.id === id).geometry, kx = 111195 * Math.cos((g[0].lat * Math.PI) / 180), ky = 111195;
  const pts = g.map((p) => [(p.lon - g[0].lon) * kx, (p.lat - g[0].lat) * ky]), cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const at = (s: number) => { let i = 1; while (i < pts.length - 1 && cum[i] < s) i++; const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1]); return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]; };
  const mid = cum.at(-1)! / 2, c = at(mid), p0 = at(mid - 350), p1 = at(mid + 350), dx = p1[0] - p0[0], dy = p1[1] - p0[1], l = Math.hypot(dx, dy), ux = dx / l, uy = dy / l;
  const ll = (x: number, y: number): [number, number] => [Number((g[0].lat + y / ky).toFixed(7)), Number((g[0].lon + x / kx).toFixed(7))];
  out[name] = { a: ll(c[0] - (ux * keep) / 2, c[1] - (uy * keep) / 2), b: ll(c[0] + (ux * keep) / 2, c[1] + (uy * keep) / 2), width: name.startsWith("Prince") ? 34 : 32 };
}
await Bun.write("public/scenery/bridges.json", JSON.stringify({ source: "OpenStreetMap contributors, ODbL 1.0 (bridge outlines and centrelines)", bridges: out }, null, 1));
console.log(Object.entries(out).map(([n, b]) => `${n}: ${b.width} m wide, ${Math.round(Math.hypot((b.b[1] - b.a[1]) * 111195 * Math.cos((b.a[0] * Math.PI) / 180), (b.b[0] - b.a[0]) * 111195))} m long`).join("\n"));
