import { test, expect } from "bun:test";
import * as T from "three";
import { EARTH, type EarthState, energy } from "../src/earth";
import { EarthSurface, latLonToDir, dirToLatLon } from "../src/geo";
import {
  advanceFlight,
  atmosphereDensity,
  atmosphereVelocity,
  VEHICLE,
} from "../src/flight";
import { add, mul, len, type V } from "../src/vector";
const surface = new EarthSurface(),
  q = new T.Quaternion().setFromRotationMatrix(
    new T.Matrix4().makeBasis(
      new T.Vector3(0, 0, -1),
      new T.Vector3(1, 0, 0),
      new T.Vector3(0, -1, 0),
    ),
  );
const idle = { throttle: 0, hover: 0, lateral: 0, surge: 0 };
function make(alt: number, v: V = [0, 0, 0]): EarthState {
  return {
    p: [EARTH.radius + alt / 1000, 0, 0],
    v,
    t: 0,
    fuel: 100,
    status: "flying",
    body: "",
    heat: 0,
  };
}
test("geography wraps and matches sphere UV convention", () => {
  for (const lat of [-90, -60, 0, 45, 90])
    for (const lon of [-179, -90, 0, 90, 179]) {
      const got = dirToLatLon(latLonToDir(lat, lon));
      expect(got.lat).toBeCloseTo(lat, 7);
      expect(got.lon).toBeCloseTo(lon, 7);
    }
});
test("Earth atmosphere has sea level density and thins out to space", () => {
  expect(atmosphereDensity(0)).toBeCloseTo(1.225);
  expect(atmosphereDensity(100000)).toBeLessThan(0.00001);
});
test("circular orbit remains above 399 km over ten minutes", () => {
  const s = make(400000, [0, Math.sqrt(EARTH.mu / (EARTH.radius + 400)), 0]);
  advanceFlight(s, 600, q, idle, { surface, gear: false });
  expect(s.status).toBe("flying");
  expect(len(s.p) - EARTH.radius).toBeCloseTo(400, 1);
});
test("hover jets lift a parked spaceplane against Earth gravity", () => {
  const s = make(VEHICLE.gearClearance);
  s.status = "landed";
  s.v = atmosphereVelocity(s.p);
  advanceFlight(s, 3, q, { ...idle, hover: 1 }, { surface, gear: true });
  expect(s.status).toBe("flying");
  expect((len(s.p) - EARTH.radius) * 1000).toBeGreaterThan(40);
});
test("safe geared touchdown lands and holds the rotating ground", () => {
  const s = make(3.5);
  s.v = add(atmosphereVelocity(s.p), [-0.001, 0, 0]);
  advanceFlight(s, 0.2, q, idle, { surface, gear: true });
  expect(s.status).toBe("landed");
  advanceFlight(s, 10, q, idle, { surface, gear: true });
  expect((len(s.p) - EARTH.radius) * 1000).toBeCloseTo(3.4, 4);
});
test("hard impact does not become a landing", () => {
  const s = make(7);
  s.v = add(atmosphereVelocity(s.p), [-0.03, 0, 0]);
  advanceFlight(s, 0.3, q, idle, { surface, gear: true });
  expect(s.status).toBe("impact");
});
test("a gentle belly landing without gear fails", () => {
  const s = make(1.6); // belly 1.5 m below the centre: 0.1 m above the ground
  s.v = add(atmosphereVelocity(s.p), [-0.001, 0, 0]);
  advanceFlight(s, 0.2, q, idle, { surface, gear: false });
  expect(s.status).toBe("impact");
  expect(s.body).toBe("Landing gear retracted");
});
test("an upward flight crosses the atmosphere boundary without resetting", () => {
  const s = make(99000, [1.5, 0, 0]);
  const noseUp = new T.Quaternion().setFromUnitVectors(
    new T.Vector3(0, 0, -1),
    new T.Vector3(1, 0, 0),
  );
  advanceFlight(
    s,
    20,
    noseUp,
    { ...idle, throttle: 1, torch: true },
    { surface, gear: false },
  );
  expect(s.status).toBe("flying");
  expect((len(s.p) - EARTH.radius) * 1000).toBeGreaterThan(150000);
  expect(s.t).toBeCloseTo(20, 5);
});
test("retrograde atmosphere entry crosses 100 km and generates drag and heat", () => {
  const s = make(102000, [-0.3, 7.6, 0]);
  const entryQ = new T.Quaternion().setFromRotationMatrix(
    new T.Matrix4().makeBasis(
      new T.Vector3(0, 0, -1),
      new T.Vector3(0.766, -0.643, 0),
      new T.Vector3(-0.643, -0.766, 0),
    ),
  );
  advanceFlight(s, 10, entryQ, idle, { surface, gear: false });
  expect(s.status).toBe("flying");
  expect((len(s.p) - EARTH.radius) * 1000).toBeLessThan(100000);
  expect(s.dynamicPressure).toBeGreaterThan(1);
});
test("torch can put the craft on an escape trajectory", () => {
  const s = make(400000);
  const noseUp = new T.Quaternion().setFromUnitVectors(
    new T.Vector3(0, 0, -1),
    new T.Vector3(1, 0, 0),
  );
  advanceFlight(
    s,
    45,
    noseUp,
    { ...idle, throttle: 1, torch: true },
    { surface, gear: false },
  );
  expect(s.status).toBe("flying");
  expect(energy(s)).toBeGreaterThan(0);
});

test("belly heat shield reduces heating in dense reentry flow", () => {
  const unshielded = make(65000, [0, 7.6, 0]);
  const shielded = make(65000, [0, 7.6, 0]);
  const bellyToFlow = new T.Quaternion().setFromUnitVectors(
    new T.Vector3(0, 1, 0),
    new T.Vector3(0, -1, 0),
  );
  advanceFlight(unshielded, 0.5, q, idle, { surface, gear: false });
  advanceFlight(shielded, 0.5, bellyToFlow, idle, { surface, gear: false });
  expect(shielded.heat).toBeGreaterThan(0);
  expect(shielded.heat!).toBeLessThan(unshielded.heat!);
});
