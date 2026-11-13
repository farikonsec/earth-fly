import { test, expect } from "bun:test";
import { GeoIndex, insideFeature, hash, type Feature } from "../src/geodata";
import { Terrain, mercator, type Tile } from "../src/terrain";
const forest: Feature = {
  id: "test",
  kind: "forest",
  name: "",
  ring: [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
    [0, 0],
  ],
  holes: [
    [
      [0.4, 0.4],
      [0.6, 0.4],
      [0.6, 0.6],
      [0.4, 0.6],
      [0.4, 0.4],
    ],
  ],
};
test("geographic masks respect holes and exclude points outside a mapped boundary", () => {
  expect(insideFeature(0.2, 0.2, forest)).toBe(true);
  expect(insideFeature(0.5, 0.5, forest)).toBe(false);
  expect(insideFeature(2, 0.2, forest)).toBe(false);
  const g = new GeoIndex([forest]);
  expect(g.at(0.2, 0.2, "forest")?.id).toBe("test");
  expect(g.at(0.5, 0.5, "forest")).toBeUndefined();
});
test("procedural placement uses reproducible bounded seeds", () => {
  expect(hash(4, 7)).toBe(hash(4, 7));
  expect(hash(4, 7)).not.toBe(hash(7, 4));
  for (let i = -20; i < 20; i++) {
    expect(hash(i, i + 4)).toBeGreaterThanOrEqual(0);
    expect(hash(i, i + 4)).toBeLessThan(1);
  }
});
test("bundled lake geometry has its documented level and separates land from water", async () => {
  const j = await Bun.file("public/scenery/alps.json").json(),
    index = new GeoIndex(j.features);
  expect(j.license).toBe("ODbL-1.0");
  expect(index.at(46.727, 7.98, "water")?.name).toBe("Brienzersee");
  expect(index.at(46.727, 7.98, "water")?.elevation).toBe(564);
  expect(index.at(46.55, 8, "water")).toBeUndefined();
  expect(
    j.features.filter((f: Feature) => f.kind === "river").length,
  ).toBeGreaterThan(10);
  expect(
    j.features.filter((f: Feature) => f.kind === "forest").length,
  ).toBeGreaterThan(500);
});
function staged() {
  const t = new Terrain(),
    lat = 0.1,
    lon = 0.1,
    p = mercator(lat, lon, 9),
    x = Math.floor(p.x),
    y = Math.floor(p.y);
  const tile: Tile = {
    data: new Float32Array(65536).fill(1000),
    z: 9,
    x,
    y,
    loaded: 0,
  };
  t.staged.set(`9/${x}/${y}`, tile);
  return { t, lat, lon };
}
test("downloaded terrain remains staged when it threatens aircraft clearance", () => {
  const { t, lat, lon } = staged();
  t.advance(0.1, lat, lon, 1200);
  expect(t.detailHeld).toBe(true);
  expect(t.height(lat, lon)).toBe(0);
  expect(t.staged.size).toBe(1);
});
test("safe detail transitions interpolate the same height authority over three seconds", () => {
  const { t, lat, lon } = staged();
  t.advance(0.1, lat, lon, 5000);
  expect(t.height(lat, lon)).toBe(0);
  t.advance(1.5, lat, lon, 5000);
  expect(t.height(lat, lon)).toBeCloseTo(500);
  t.advance(1.5, lat, lon, 5000);
  expect(t.height(lat, lon)).toBeCloseTo(1000);
  expect(t.previous).toBeNull();
});
test("paused location preparation can explicitly commit detail and lake height overrides relief", () => {
  const { t, lat, lon } = staged();
  t.applyStaged();
  expect(t.height(lat, lon)).toBeCloseTo(1000);
  t.waterLevel = (a, b) => (a === lat && b === lon ? 564 : null);
  expect(t.height(lat, lon)).toBe(564);
});

test("explicit location preparation finishes an existing terrain blend", () => {
  const { t, lat, lon } = staged();
  t.advance(0.1, lat, lon, 5000);
  t.advance(1, lat, lon, 5000);
  expect(t.height(lat, lon)).toBeLessThan(1000);
  t.applyStaged();
  expect(t.height(lat, lon)).toBeCloseTo(1000);
  expect(t.previous).toBeNull();
});
