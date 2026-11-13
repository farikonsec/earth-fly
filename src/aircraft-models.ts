import * as T from "three";

/** Recognisable low-poly silhouettes. Plan shapes are in metres, nose toward -Z; the result is in kilometres. */
export type AircraftType = "f22" | "f35" | "f16" | "f18" | "mig29" | "su27" | "typhoon" | "gripen" | "harrier" | "jumbo" | "helicopter";
type Plan = [number, number][]; // (x outboard, z aft) for one side, root leading edge first
interface Spec {
  name: string; length: number; width: number; height: number; colour: number; trim: number;
  wing: Plan; wingY?: number; dihedral?: number; stab?: Plan; stabDihedral?: number; canard?: Plan;
  fins: 1 | 2; finCant?: number; fin: Plan; finZ: number; finSpread?: number;
  engines: number; spread?: number; nozzleZ: number; canopyZ: number; canopy?: [number, number, number];
  intakes?: "side" | "chin" | "cheek"; sting?: boolean; pods?: number; scale: number;
  /** Combat character: load limit in g, hit points, score, hit radius in km, and an optional top speed in km/s. */
  /** Published top speed as a Mach number at altitude; the energy model and transonic drag decide what is reachable lower down. */
  mach?: number;
  g: number; hp: number; score: number; radius: number; cap?: number; role: "fighter" | "scout" | "heavy" | "helicopter";
  /** Point-mass aerodynamics from public figures: wing loading kg/m², thrust-to-weight with afterburner, CLmax, zero-lift drag, induced-drag factor. Absent for the helicopter. */
  aero?: Aero;
}
export interface Aero { wl: number; tw: number; clmax: number; cd0: number; k: number }
export const AIRCRAFT: Record<AircraftType, Spec> = {
  f22: { name: "F-22 RAPTOR", mach: 2.25, length: 18.9, width: 3.4, height: 1.7, colour: 0x7c8590, trim: 0x565e68, wing: [[1.6, -3.2], [6.8, 3.4], [6.8, 4.8], [1.6, 6.2]], stab: [[1.5, 5.8], [4.3, 8.2], [4.3, 9.4], [1.5, 9.2]], fins: 2, finCant: 28, fin: [[0, 3.2], [2.6, 6.6], [2.6, 8.2], [0, 7.6]], finZ: 0, finSpread: 1.9, engines: 2, spread: 1.1, nozzleZ: 8.6, canopyZ: -4.4, intakes: "cheek", scale: 3.2, g: 9, hp: 4, score: 200, radius: 0.08, role: "fighter", aero: { wl: 375, tw: 1.09, clmax: 1.6, cd0: 0.019, k: 0.13 } },
  f35: { name: "F-35 LIGHTNING", mach: 1.6, length: 15.7, width: 3.2, height: 1.9, colour: 0x6f7780, trim: 0x4c535b, wing: [[1.5, -1.8], [5.3, 2.6], [5.3, 3.8], [1.5, 4.6]], stab: [[1.4, 4.4], [3.6, 6.4], [3.6, 7.4], [1.4, 7.4]], fins: 2, finCant: 20, fin: [[0, 2.6], [2.3, 5.4], [2.3, 6.8], [0, 6.2]], finZ: 0, finSpread: 1.7, engines: 1, nozzleZ: 7.2, canopyZ: -3.4, intakes: "cheek", scale: 3.2, g: 8.5, hp: 4, score: 180, radius: 0.075, role: "fighter", aero: { wl: 526, tw: 0.87, clmax: 1.5, cd0: 0.022, k: 0.14 } },
  f16: { name: "F-16 VIPER", mach: 2.0, length: 15, width: 1.7, height: 1.9, colour: 0x8a929b, trim: 0x5a626b, wing: [[0.9, -1.2], [4.7, 2.3], [4.7, 3.4], [0.9, 3.6]], stab: [[0.8, 4.6], [2.9, 6.2], [2.9, 7], [0.8, 7]], stabDihedral: -8, fins: 1, fin: [[0, 2.8], [3.1, 6.2], [3.1, 7.4], [0, 7.2]], finZ: 0, engines: 1, nozzleZ: 7.1, canopyZ: -3.6, canopy: [0.55, 0.75, 2.2], intakes: "chin", scale: 3.2, g: 9, hp: 2, score: 150, radius: 0.07, role: "scout", aero: { wl: 431, tw: 1.1, clmax: 1.55, cd0: 0.02, k: 0.12 } },
  f18: { name: "F/A-18 HORNET", mach: 1.8, length: 17.1, width: 2.4, height: 1.9, colour: 0x8f979f, trim: 0x636b73, wing: [[1.2, -0.6], [5.7, 1.4], [5.7, 3], [1.2, 3.6]], stab: [[1.1, 5.2], [3.5, 6.8], [3.5, 7.8], [1.1, 7.8]], fins: 2, finCant: 20, fin: [[0, 1.6], [2.9, 4.4], [2.9, 5.6], [0, 5.4]], finZ: 0, finSpread: 1.3, engines: 2, spread: 0.75, nozzleZ: 8, canopyZ: -4.2, intakes: "side", scale: 3.2, g: 7.5, hp: 3, score: 130, radius: 0.075, role: "fighter", aero: { wl: 453, tw: 0.96, clmax: 1.7, cd0: 0.024, k: 0.13 } },
  mig29: { name: "MiG-29 FULCRUM", mach: 2.25, length: 17.3, width: 2.8, height: 1.6, colour: 0x7f8a82, trim: 0x55605a, wing: [[1.6, -1.6], [5.6, 2.4], [5.6, 3.6], [1.6, 4.2]], stab: [[1.6, 5], [3.8, 6.8], [3.8, 7.8], [1.6, 7.6]], fins: 2, finCant: 6, fin: [[0, 2.8], [3, 5.6], [3, 6.8], [0, 6.8]], finZ: 0, finSpread: 1.6, engines: 2, spread: 1.15, nozzleZ: 8.2, canopyZ: -4.3, intakes: "side", scale: 3.2, g: 9, hp: 3, score: 140, radius: 0.075, role: "fighter", aero: { wl: 395, tw: 1.09, clmax: 1.6, cd0: 0.023, k: 0.13 } },
  su27: { name: "Su-27 FLANKER", mach: 2.35, length: 21.9, width: 3.4, height: 1.8, colour: 0x6f8aa8, trim: 0x4a6384, wing: [[1.8, -2.4], [7.3, 2.8], [7.3, 4.4], [1.8, 5.2]], stab: [[1.8, 6.2], [4.9, 8.4], [4.9, 9.6], [1.8, 9.4]], fins: 2, finCant: 2, fin: [[0, 3.6], [3.6, 6.8], [3.6, 8.4], [0, 8.4]], finZ: 0, finSpread: 2.1, engines: 2, spread: 1.35, nozzleZ: 9.6, canopyZ: -5.6, intakes: "side", sting: true, scale: 3.2, g: 9, hp: 5, score: 220, radius: 0.085, role: "fighter", aero: { wl: 377, tw: 1.07, clmax: 1.65, cd0: 0.021, k: 0.12 } },
  typhoon: { name: "TYPHOON", mach: 2.0, length: 16, width: 2.3, height: 1.8, colour: 0x9aa2a8, trim: 0x6d757b, wing: [[1.1, -2.6], [5.5, 4.4], [5.5, 5.2], [1.1, 5.6]], canard: [[0.9, -5.6], [2.6, -4.3], [2.6, -3.7], [0.9, -4]], fins: 1, fin: [[0, 1.6], [3.4, 5.6], [3.4, 6.8], [0, 6.6]], finZ: 0, engines: 2, spread: 0.6, nozzleZ: 7.6, canopyZ: -4, intakes: "chin", scale: 3.2, g: 9, hp: 3, score: 160, radius: 0.075, role: "fighter", aero: { wl: 312, tw: 1.15, clmax: 1.5, cd0: 0.02, k: 0.15 } },
  gripen: { name: "SAAB GRIPEN", mach: 2.0, length: 14.1, width: 1.8, height: 1.7, colour: 0x969ea4, trim: 0x687076, wing: [[0.9, -1.8], [4.2, 3.6], [4.2, 4.3], [0.9, 4.6]], canard: [[0.8, -3.6], [2.3, -2.6], [2.3, -2.1], [0.8, -2.2]], fins: 1, fin: [[0, 1.8], [2.9, 5.2], [2.9, 6.2], [0, 6]], finZ: 0, engines: 1, nozzleZ: 6.8, canopyZ: -3.6, intakes: "side", scale: 3.2, g: 9, hp: 2, score: 150, radius: 0.07, role: "scout", aero: { wl: 283, tw: 0.97, clmax: 1.45, cd0: 0.021, k: 0.16 } },
  harrier: { name: "HARRIER", mach: 0.9, length: 14.3, width: 2.2, height: 2.2, colour: 0x5d666b, trim: 0x3f474c, wing: [[0.9, -1.4], [4.6, 1.4], [4.6, 2.4], [0.9, 2.6]], wingY: 0.9, dihedral: -11, stab: [[0.7, 4.6], [2.3, 5.8], [2.3, 6.5], [0.7, 6.4]], stabDihedral: -14, fins: 1, fin: [[0, 2.6], [2.9, 5.6], [2.9, 6.6], [0, 6.6]], finZ: 0, engines: 1, nozzleZ: 6.6, canopyZ: -4, canopy: [0.6, 0.8, 1.9], intakes: "side", scale: 3.2, g: 6.5, hp: 2, score: 120, radius: 0.07, cap: 0.3, role: "scout", aero: { wl: 460, tw: 1.0, clmax: 1.4, cd0: 0.03, k: 0.11 } },
  jumbo: { name: "747 JUMBO", mach: 0.86, length: 70.6, width: 6.5, height: 7.4, colour: 0xe6e9ec, trim: 0x2f5fa8, wing: [[3, -8], [32, 12], [32, 15], [3, 7]], wingY: -1.6, dihedral: 6, stab: [[2.4, 24], [11, 31], [11, 33.5], [2.4, 31]], stabDihedral: 6, fins: 1, fin: [[0, 21], [10.5, 31], [10.5, 34], [0, 33]], finZ: 0, engines: 0, pods: 4, nozzleZ: 33, canopyZ: -29, canopy: [2.6, 1.9, 8], scale: 1.9, g: 2.5, hp: 14, score: 600, radius: 0.16, role: "heavy", aero: { wl: 650, tw: 0.25, clmax: 1.3, cd0: 0.017, k: 0.045 } },
  helicopter: { name: "ATTACK HELICOPTER", mach: 0.25, length: 15, width: 1.6, height: 2.2, colour: 0x4d5645, trim: 0x33392d, wing: [[0.7, -1.2], [2.6, -0.6], [2.6, 0.5], [0.7, 0.6]], wingY: -0.2, fins: 1, fin: [[0, 6.2], [2.4, 7.8], [2.4, 8.6], [0, 8.4]], finZ: 0, engines: 0, nozzleZ: 2, canopyZ: -3.2, canopy: [0.65, 0.95, 2.6], scale: 3.4, g: 3, hp: 4, score: 170, radius: 0.075, cap: 0.085, role: "helicopter" },
};
const KM = 0.001;
/** Thin slab from a one-sided plan, mirrored about the centreline. */
function surface(plan: Plan, thickness: number, mirror = true) {
  const shape = new T.Shape(plan.map(([x, z]) => new T.Vector2(x, -z))), geometries: T.BufferGeometry[] = [];
  for (const side of mirror ? [1, -1] : [1]) { const g = new T.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false }); g.translate(0, 0, -thickness / 2); g.rotateX(-Math.PI / 2); if (side < 0) g.scale(-1, 1, 1); geometries.push(g); }
  return geometries;
}
function glow(stops: [number, string][]) { const canvas = document.createElement("canvas"); canvas.width = canvas.height = 64; const c = canvas.getContext("2d")!, g = c.createRadialGradient(32, 32, 0, 32, 32, 32); for (const [at, colour] of stops) g.addColorStop(at, colour); c.fillStyle = g; c.fillRect(0, 0, 64, 64); const t = new T.CanvasTexture(canvas); t.colorSpace = T.SRGBColorSpace; return t; }
let flame: T.Texture | null = null;

/** Returns a group with userData { hull, engines, rotor }. `hull` flashes on hits; `engines` are the nozzle glows. */
export function buildAircraft(type: AircraftType) {
  const s = AIRCRAFT[type], group = new T.Group(), body = new T.Group();
  const hull = new T.MeshStandardMaterial({ color: s.colour, metalness: 0.55, roughness: 0.45, side: T.DoubleSide, emissive: new T.Color(0, 0, 0) }),
    trim = new T.MeshStandardMaterial({ color: s.trim, metalness: 0.5, roughness: 0.5, side: T.DoubleSide }), glass = new T.MeshStandardMaterial({ color: 0x1b2a33, metalness: 0.9, roughness: 0.12 });
  const add = (g: T.BufferGeometry, m: T.Material, at?: [number, number, number]) => { const mesh = new T.Mesh(g, m); if (at) mesh.position.set(...at); body.add(mesh); return mesh; };
  const half = s.length / 2;
  // Fuselage: a spindle, sharper at the nose than the tail.
  const profile: T.Vector2[] = []; for (let i = 0; i <= 14; i++) { const u = i / 14, r = Math.pow(Math.sin(Math.PI * Math.pow(u, type === "jumbo" ? 0.55 : 0.72)), type === "jumbo" ? 0.42 : 0.7); profile.push(new T.Vector2(Math.max(0.02, r), (u - 0.5) * s.length)); }
  const fuselage = new T.LatheGeometry(profile, 14); fuselage.rotateX(Math.PI / 2); fuselage.scale(s.width / 2, s.height / 2, type === "helicopter" ? 0.55 : 1);
  add(fuselage, hull, type === "helicopter" ? [0, 0, -2.6] : undefined);
  const canopy = s.canopy ?? [0.5, 0.6, 1.9]; add(new T.SphereGeometry(1, 12, 8).scale(canopy[0], canopy[1], canopy[2]), glass, [0, s.height * (type === "jumbo" ? 0.3 : 0.36), s.canopyZ]);
  const wingRoot = s.wingY ?? 0, tilt = ((s.dihedral ?? 0) * Math.PI) / 180;
  surface(s.wing, type === "jumbo" ? 0.9 : 0.22).forEach((g, i) => { const m = add(g, hull, [0, wingRoot, 0]); m.rotation.z = (i ? -1 : 1) * tilt; });
  if (s.stab) surface(s.stab, 0.16).forEach((g, i) => { const m = add(g, hull, [0, type === "jumbo" ? 1.2 : 0.1, 0]); m.rotation.z = ((i ? -1 : 1) * (s.stabDihedral ?? 0) * Math.PI) / 180; });
  if (s.canard) surface(s.canard, 0.12).forEach((g) => add(g, trim, [0, 0.35, 0]));
  // Fins: the plan is drawn in the wing plane, then stood up and canted outward.
  for (const side of s.fins === 2 ? [1, -1] : [0]) { const g = surface(s.fin, 0.16, false)[0]; g.rotateZ(Math.PI / 2 - (side * (s.finCant ?? 0) * Math.PI) / 180); add(g, trim, [side * (s.finSpread ?? 0), s.height * 0.3, s.finZ]); }
  if (s.intakes === "side" || s.intakes === "cheek") for (const side of [1, -1]) add(new T.BoxGeometry(s.intakes === "cheek" ? 1.1 : 0.8, 0.9, s.length * 0.28), trim, [side * (s.width * 0.42), -0.15, -s.length * 0.06]);
  if (s.intakes === "chin") add(new T.BoxGeometry(1.1, 0.7, s.length * 0.26), trim, [0, -s.height * 0.42, -s.length * 0.1]);
  if (s.sting) { const c = new T.ConeGeometry(0.45, 4.2, 8); c.rotateX(Math.PI / 2); add(c, hull, [0, 0.1, half + 0.9]); }
  if (type === "jumbo") {
    add(new T.BoxGeometry(s.width * 1.01, 0.5, s.length * 0.72), trim, [0, 0.4, 0]);
    for (const side of [1, -1]) for (const [x, z] of [[11.5, -1.5], [21, 5.5]]) { const pod = new T.CylinderGeometry(1.25, 1.05, 5.4, 12); pod.rotateX(Math.PI / 2); add(pod, hull, [side * x, -3 + x * 0.1, z]); add(new T.BoxGeometry(0.3, 1.6, 3.4), hull, [side * x, -1.9 + x * 0.1, z + 0.8]); }
  }
  let rotor: T.Object3D | null = null;
  if (type === "helicopter") {
    const boom = new T.CylinderGeometry(0.28, 0.5, 8, 8); boom.rotateX(Math.PI / 2); add(boom, hull, [0, 0.35, 3.4]);
    add(new T.CylinderGeometry(0.25, 0.25, 1, 8), trim, [0, 1.45, -2.4]);
    rotor = new T.Group(); for (let i = 0; i < 4; i++) { const blade = new T.Mesh(new T.BoxGeometry(7.3, 0.05, 0.42), trim); blade.position.x = 3.65; const arm = new T.Group(); arm.rotation.y = (i * Math.PI) / 2; arm.add(blade); rotor.add(arm); }
    const disc = new T.Mesh(new T.CircleGeometry(7.3, 40).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ color: 0x20261c, transparent: true, opacity: 0.16, side: T.DoubleSide, depthWrite: false })); rotor.add(disc);
    rotor.position.set(0, 2, -2.4); body.add(rotor);
    const tail = new T.Mesh(new T.CircleGeometry(1.4, 20).rotateY(Math.PI / 2), new T.MeshBasicMaterial({ color: 0x20261c, transparent: true, opacity: 0.3, side: T.DoubleSide, depthWrite: false })); tail.position.set(0.35, 1.6, 7.6); body.add(tail);
    for (const side of [1, -1]) { add(new T.CylinderGeometry(0.22, 0.22, 2.2, 8).rotateX(Math.PI / 2), trim, [side * 2.2, -0.45, -0.4]); add(new T.BoxGeometry(0.12, 1, 0.12), trim, [side * 0.9, -1.4, -2.6]); add(new T.CylinderGeometry(0.28, 0.28, 0.2, 10).rotateZ(Math.PI / 2), trim, [side * 0.9, -1.9, -2.6]); }
  }
  flame ??= glow([[0, "#ffffff"], [0.25, "#ffc890"], [1, "#ff401000"]]);
  const engines: T.Sprite[] = [], nozzles: [number, number, number][] = s.pods ? [[11.5, -1.9, 1.6], [-11.5, -1.9, 1.6], [21, -1, 8.6], [-21, -1, 8.6]] : s.engines === 2 ? [[s.spread ?? 1, 0, s.nozzleZ], [-(s.spread ?? 1), 0, s.nozzleZ]] : s.engines === 1 ? [[0, 0, s.nozzleZ]] : [];
  for (const at of nozzles) {
    if (!s.pods) { const n = new T.CylinderGeometry(0.55, 0.7, 1.2, 12, 1, true); n.rotateX(Math.PI / 2); add(n, new T.MeshStandardMaterial({ color: 0x25282c, metalness: 0.8, roughness: 0.4, side: T.DoubleSide }), [at[0], at[1], at[2] - 0.5]); }
    const sprite = new T.Sprite(new T.SpriteMaterial({ map: flame, color: new T.Color(1, 0.5, 0.22).multiplyScalar(5), blending: T.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false })); sprite.position.set(at[0], at[1], at[2] + 0.4); sprite.userData.base = s.pods ? 2.2 : 3.2; body.add(sprite); engines.push(sprite);
  }
  // Navigation lights help pick out attitude at a distance.
  const tip = s.wing[1]; for (const side of [1, -1]) { const lamp = new T.Mesh(new T.SphereGeometry(0.16, 6, 5), new T.MeshBasicMaterial({ color: new T.Color(side > 0 ? 0.1 : 1, side > 0 ? 1 : 0.1, 0.1).multiplyScalar(6), toneMapped: false })); lamp.position.set(side * tip[0], wingRoot + tip[0] * Math.sin(tilt), tip[1]); body.add(lamp); }
  body.scale.setScalar(KM * s.scale); group.add(body);
  group.userData = { hull, engines, rotor, type };
  return group;
}
