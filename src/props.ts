import * as T from "three";

/** Low-poly vehicles for instancing. Each geometry is in metres, nose toward -Z, base at y = 0, with vertex colours. */
type Part = { g: T.BufferGeometry; c: [number, number, number] };
function merge(parts: Part[]) {
  const positions: number[] = [], colours: number[] = [];
  for (const { g, c } of parts) { const p = (g.index ? g.toNonIndexed() : g).getAttribute("position"); for (let i = 0; i < p.count; i++) { positions.push(p.getX(i), p.getY(i), p.getZ(i)); colours.push(...c); } }
  const out = new T.BufferGeometry(); out.setAttribute("position", new T.Float32BufferAttribute(positions, 3)); out.setAttribute("color", new T.Float32BufferAttribute(colours, 3)); out.computeVertexNormals(); return out;
}
const box = (w: number, h: number, l: number, x = 0, y = 0, z = 0) => new T.BoxGeometry(w, h, l).translate(x, y + h / 2, z);
const wing = (span: number, root: number, tip: number, sweep: number, y: number, z: number, thick = 0.4) => {
  const shape = new T.Shape([new T.Vector2(0, 0), new T.Vector2(span, -sweep), new T.Vector2(span, -sweep - tip), new T.Vector2(0, -root)]);
  const right = new T.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, y, z), left = right.clone().scale(-1, 1, 1);
  return [right, left];
};

/** A twin-engine narrowbody (A320-sized, 38 m) with white fuselage; livery colour comes from instance colour on the tail via a second mesh. */
export function airlinerGeometry() {
  const white: [number, number, number] = [0.93, 0.94, 0.95], grey: [number, number, number] = [0.6, 0.62, 0.65], dark: [number, number, number] = [0.15, 0.16, 0.18];
  const body = new T.CylinderGeometry(2, 2, 30, 14, 1).rotateX(Math.PI / 2).translate(0, 4.1, 1);
  const nose = new T.SphereGeometry(2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2).scale(1, 1, 2.1).translate(0, 4.1, -14);
  const tail = new T.ConeGeometry(2, 7, 14, 1, true).rotateX(-Math.PI / 2).translate(0, 4.6, 19.5);
  const parts: Part[] = [{ g: body, c: white }, { g: nose, c: white }, { g: tail, c: white }];
  for (const g of wing(17, 7, 1.8, 6.5, 3, 3)) parts.push({ g, c: grey });
  for (const g of wing(6, 3.5, 1.4, 3, 5.2, 18.5, 0.25)) parts.push({ g, c: white });
  for (const side of [-1, 1]) { parts.push({ g: new T.CylinderGeometry(1.1, 0.95, 4, 10).rotateX(Math.PI / 2).translate(side * 5.6, 2.2, -1.5), c: grey }); parts.push({ g: box(0.3, 0.9, 1, side * 2.4, 0, 1), c: dark }); }
  parts.push({ g: box(0.3, 0.9, 1, 0, 0, -11), c: dark });
  parts.push({ g: new T.BoxGeometry(0.3, 0.5, 2.2).translate(0, 5.6, -12.4), c: dark }); // cockpit windows band
  return merge(parts);
}
/** The airline tail fin, coloured per instance. */
export function finGeometry() { const s = new T.Shape([new T.Vector2(0, 0), new T.Vector2(5, 7.5), new T.Vector2(7.5, 7.5), new T.Vector2(6, 0)]); return new T.ExtrudeGeometry(s, { depth: 0.35, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(0.17, 5.6, 16.5); }

export type Vessel = "clipper" | "barge" | "cruiser" | "cargo" | "tug";
export const VESSELS: Record<Vessel, { length: number; speed: number }> = { clipper: { length: 35, speed: 11 }, barge: { length: 30, speed: 3 }, cruiser: { length: 187, speed: 0 }, cargo: { length: 90, speed: 4 }, tug: { length: 16, speed: 4 } };
/** Hull and superstructure for each vessel type, built at its real length. */
export function vesselGeometry(type: Vessel) {
  const hullColour: Record<Vessel, [number, number, number]> = { clipper: [0.12, 0.18, 0.3], barge: [0.2, 0.17, 0.14], cruiser: [0.42, 0.45, 0.48], cargo: [0.55, 0.12, 0.1], tug: [0.12, 0.12, 0.14] };
  const L = VESSELS[type].length, B = type === "cruiser" ? 20 : type === "cargo" ? 14 : type === "clipper" ? 9 : type === "barge" ? 8 : 6;
  // Hull: a lofted box with a pointed bow.
  const shape = new T.Shape([new T.Vector2(-B / 2, L / 2), new T.Vector2(B / 2, L / 2), new T.Vector2(B / 2, -L * 0.3), new T.Vector2(0, -L / 2), new T.Vector2(-B / 2, -L * 0.3)]);
  const hull = new T.ExtrudeGeometry(shape, { depth: type === "cruiser" ? 6 : 2.4, bevelEnabled: false }).rotateX(Math.PI / 2).translate(0, type === "cruiser" ? 6 : 2.4, 0);
  const parts: Part[] = [{ g: hull, c: hullColour[type] }], white: [number, number, number] = [0.9, 0.9, 0.88], grey: [number, number, number] = [0.5, 0.52, 0.55];
  if (type === "clipper") { parts.push({ g: box(B * 0.8, 2.6, L * 0.55, 0, 2.4, -1), c: white }, { g: box(B * 0.82, 0.8, L * 0.5, 0, 3.3, -1), c: [0.1, 0.14, 0.2] }); }
  if (type === "barge") { parts.push({ g: box(B * 0.85, 1.2, L * 0.7, 0, 2.4, -2), c: [0.35, 0.3, 0.22] }); }
  if (type === "tug") { parts.push({ g: box(B * 0.6, 3, L * 0.35, 0, 2.4, -1), c: white }, { g: box(1, 3, 1, 0, 5.4, 1.5), c: [0.7, 0.15, 0.1] }); }
  if (type === "cargo") { for (let i = 0; i < 6; i++) parts.push({ g: box(B * 0.8, 2.6, 8, 0, 2.4, -L * 0.3 + i * 9), c: ([[0.2, 0.35, 0.6], [0.65, 0.3, 0.15], [0.3, 0.45, 0.3]] as [number, number, number][])[i % 3] }); parts.push({ g: box(B * 0.9, 9, 10, 0, 2.4, L * 0.38), c: white }); }
  if (type === "cruiser") {
    // HMS Belfast in Admiralty disruptive camouflage greys: two forward and two aft triple turrets, bridge, two funnels and masts.
    parts.push({ g: box(13, 6, 70, 0, 6, -5), c: grey }, { g: box(8, 7, 14, 0, 12, -18), c: [0.62, 0.65, 0.68] }, { g: box(3.5, 9, 4, 0, 12, -2), c: [0.3, 0.32, 0.35] }, { g: box(3.5, 9, 4, 0, 12, 14), c: [0.3, 0.32, 0.35] });
    for (const z of [-62, -46, 50, 66]) parts.push({ g: box(7, 3.2, 8, 0, z < 0 && z > -50 ? 9 : 6, z), c: [0.48, 0.5, 0.53] }, { g: box(5, 0.8, 12, 0, z < 0 && z > -50 ? 10.6 : 7.6, z - 9), c: [0.3, 0.32, 0.35] });
    parts.push({ g: new T.CylinderGeometry(0.4, 0.5, 26, 6).translate(0, 25, -14), c: [0.3, 0.3, 0.3] }, { g: new T.CylinderGeometry(0.35, 0.45, 20, 6).translate(0, 20, 22), c: [0.3, 0.3, 0.3] });
  }
  return merge(parts);
}
/** A V-shaped foam wake, length 1, apex at the origin, opening toward +Z. Alpha fades with distance in the shader. */
export function wakeGeometry() {
  const g = new T.BufferGeometry(), pos: number[] = [], uv: number[] = [];
  for (const side of [-1, 1]) { pos.push(0, 0, 0, side * 0.32, 0, 1, side * 0.18, 0, 1); uv.push(0, 0, 1, 1, 0.5, 1); }
  pos.push(-0.06, 0, 0, 0.06, 0, 0, 0, 0, 1.2); uv.push(0, 0, 0, 0, 0.5, 1);
  g.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2)); return g;
}
