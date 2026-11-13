import { test, expect } from "bun:test";
import * as T from "three";
import { atmosphereAt, liftCoefficient } from "../src/air";
import { mercator, decodeTerrarium, Terrain } from "../src/terrain";
import { parseFlight, validateStart } from "../src/session";
import { sunDirection, moonPosition } from "../src/sky";
import { latLonToDir } from "../src/geo";
import {
  aerodynamics,
  atmosphereVelocity,
  advanceFlight,
  VEHICLE,
} from "../src/flight";
import { EARTH, type EarthState } from "../src/earth";
import { EarthSurface } from "../src/geo";
import { PNG } from "pngjs";
test("standard atmosphere matches sea level and 11 km reference conditions", () => {
  expect(atmosphereAt(0).density).toBeCloseTo(1.225, 3);
  expect(atmosphereAt(11000).temperature).toBeCloseTo(216.65, 1);
  expect(atmosphereAt(11000).pressure).toBeCloseTo(22632, 0);
  expect(atmosphereAt(20000).density).toBeLessThan(atmosphereAt(11000).density);
});
test("stall reduces lift after the attached-flow limit", () => {
  expect(liftCoefficient(0.25)).toBeGreaterThan(liftCoefficient(0.4));
  expect(liftCoefficient(-0.25)).toBeCloseTo(-liftCoefficient(0.25), 6);
});
test("Mercator wraps the dateline and remains finite at both poles", () => {
  expect(mercator(0, 180, 9).x).toBe(mercator(0, -180, 9).x);
  for (const lat of [-90, 90]) {
    const p = mercator(lat, 180, 9);
    expect(Number.isFinite(p.y)).toBe(true);
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeLessThan(512);
  }
});
test("Terrarium decoding preserves sub-metre elevation", () => {
  expect(decodeTerrarium(128, 0, 0)).toBe(0);
  expect(decodeTerrarium(143, 160, 128)).toBe(4000.5);
});
test("bundled global terrain is finite and shares its radius authority", async () => {
  const terrain = new Terrain();
  terrain.global = new Float32Array(
    await Bun.file("public/terrain/global.f32").arrayBuffer(),
  );
  for (const [lat, lon] of [
    [46.55, 8],
    [27, 86],
    [90, 0],
    [-90, 0],
    [0, 180],
  ]) {
    const height = terrain.height(lat, lon);
    expect(Number.isFinite(height)).toBe(true);
    expect(height).toBeGreaterThanOrEqual(0);
    expect(height).toBeLessThan(9000);
    expect(terrain.radiusM(latLonToDir(lat, lon))).toBeCloseTo(
      6371000 + height,
      3,
    );
  }
});
test("reference tiles contain measured high-relief terrain", async () => {
  const png = PNG.sync.read(
    Buffer.from(await Bun.file("public/terrain/9/267/182.png").arrayBuffer()),
  );
  let min = 9000,
    max = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const h = decodeTerrarium(png.data[i], png.data[i + 1], png.data[i + 2]);
    min = Math.min(min, h);
    max = Math.max(max, h);
  }
  expect(max - min).toBeGreaterThan(2000);
  expect(max).toBeGreaterThan(3500);
});
test("arbitrary starts reject invalid coordinates and permit both poles", () => {
  expect(() => validateStart(NaN, 0, 500, 0, 150)).toThrow();
  expect(() => validateStart(91, 0, 500, 0, 150)).toThrow();
  expect(() => validateStart(0, 181, 500, 0, 150)).toThrow();
  expect(() => validateStart(-90, 180, 0, 0, 0)).not.toThrow();
});
test("saved flight parser rejects malformed and unsafe state", () => {
  expect(() => parseFlight("null")).toThrow();
  expect(() => parseFlight('{"version":2}')).toThrow();
  const valid = {
    version: 1,
    state: {
      p: [6372, 0, 0],
      v: [0, 0.2, 0],
      t: 1,
      fuel: 90,
      status: "flying",
      body: "",
    },
    rotation: [0, 0, 0, 1],
    epoch: "2026-06-21T10:00:00Z",
  };
  expect(parseFlight(JSON.stringify(valid)).state.fuel).toBe(90);
  valid.state.p = [0, 0, 0];
  expect(() => parseFlight(JSON.stringify(valid))).toThrow();
});
test("solar and lunar visuals have finite normalized direction and correct scale", () => {
  const date = new Date("2026-06-21T12:00:00Z");
  expect(sunDirection(date).length()).toBeCloseTo(1, 6);
  expect(sunDirection(date).y).toBeGreaterThan(0.35);
  expect(moonPosition(date).length()).toBeCloseTo(384400, 4);
});
test("banking redirects aerodynamic lift horizontally", () => {
  const p: [number, number, number] = [6372, 0, 0],
    v = atmosphereVelocity(p);
  v[1] = 0.15;
  const level = new T.Quaternion().setFromRotationMatrix(
    new T.Matrix4().makeBasis(
      new T.Vector3(0, 0, -1),
      new T.Vector3(1, 0, 0),
      new T.Vector3(0, -1, 0),
    ),
  );
  const pitched = level
    .clone()
    .multiply(
      new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), 0.12),
    );
  const banked = pitched
    .clone()
    .multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), 0.6));
  const a = aerodynamics(p, v, pitched, 1000),
    b = aerodynamics(p, v, banked, 1000);
  expect(Math.abs(b.accel[2])).toBeGreaterThan(Math.abs(a.accel[2]) + 0.001);
});
test("empty fuel cannot lift a landed ship", () => {
  const s: EarthState = {
    p: [EARTH.radius + VEHICLE.gearClearance / 1000, 0, 0],
    v: [0, 0, 0],
    t: 0,
    fuel: 0,
    status: "landed",
    body: "",
  };
  const q = new T.Quaternion().setFromUnitVectors(
    new T.Vector3(0, 1, 0),
    new T.Vector3(1, 0, 0),
  );
  advanceFlight(
    s,
    1,
    q,
    { throttle: 1, hover: 1, lateral: 0, surge: 0, torch: true },
    { surface: new EarthSurface(), gear: true },
  );
  expect(s.status).toBe("landed");
});

test("atmospheric integration is stable across frame durations", () => {
  const q = new T.Quaternion().setFromRotationMatrix(
    new T.Matrix4().makeBasis(
      new T.Vector3(0, 0, -1),
      new T.Vector3(1, 0, 0),
      new T.Vector3(0, -1, 0),
    ),
  );
  const p: [number, number, number] = [6375, 0, 0],
    v = atmosphereVelocity(p);
  v[1] = 0.15;
  const initial: EarthState = {
      p,
      v,
      t: 0,
      fuel: 100,
      status: "flying",
      body: "",
      heat: 0,
    },
    a = structuredClone(initial),
    b = structuredClone(initial),
    input = { throttle: 0.1, hover: 0, lateral: 0, surge: 0 },
    env = { surface: new EarthSurface(), gear: false };
  for (let i = 0; i < 100; i++) advanceFlight(a, 0.02, q, input, env);
  for (let i = 0; i < 40; i++) advanceFlight(b, 0.05, q, input, env);
  expect(
    new T.Vector3(...a.p).distanceTo(new T.Vector3(...b.p)) * 1000,
  ).toBeLessThan(0.1);
  expect(a.status).toBe(b.status);
});

test("adjacent loaded elevation tiles do not create a false valley at the seam", () => {
  const terrain = new Terrain();
  const data = new Float32Array(65536).fill(1000);
  for (const x of [255, 256])
    terrain.tiles.set(`9/${x}/256`, { data, z: 9, x, y: 256, loaded: 0 });
  const lat =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * 256.5) / 512))) * 180) / Math.PI;
  expect(terrain.height(lat, -0.000001)).toBeCloseTo(1000, 4);
  expect(terrain.height(lat, 0.000001)).toBeCloseTo(1000, 4);
});

test("regional imagery does not claim coverage after a distant teleport", async () => {
  const { Imagery } = await import("../src/imagery");
  const imagery = new Imagery();
  imagery.origin = { x: 132, y: 89, z: 8 };
  expect(imagery.contains(46.55, 8)).toBe(true);
  expect(imagery.contains(-33.8, 151.2)).toBe(false);
});
