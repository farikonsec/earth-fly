import {BLACKBIRD} from "./blackbird";
import { groundFrame, contactGaps, settleOnSurface, surfaceAttitude, LANDING } from "./contact";
import {atmosphereAt,liftCoefficient} from "./air";
import * as T from "three";
import { add, mul, len, dot, unit, segmentHitsSphere, type V } from "./vector";
import {
  EARTH,
  EARTH_MOONS,
  earthGravity,
  earthMoonState,
  type EarthState,
} from "./earth";
import { EarthSurface, bodyToInertial, inertialToBody } from "./geo";

/**
 * Atmospheric and surface flight for the fictional PATHFINDER spaceplane.
 * Units follow earth.ts: km and km/s for state; aerodynamics are computed in SI and converted.
 */
export const VEHICLE = {
  mass: BLACKBIRD.loadedMass, // kg
  wingArea: BLACKBIRD.wingArea, // m², fictional high-lift wing: tuned for a fictional 38 m spaceplane in Earth air
  mainThrust: .65 * 9.80665,
  boostThrust: 1.5 * 9.80665, // m/s² at full throttle (fictional fusion drive)
  torchThrust: 30 * 9.80665, // m/s² torch mode: fictional, for interplanetary speeds
  maxDynamicPressure: 180000, // Pa continuous fictional reinforced-airframe envelope
  maxLoad: 12, // g continuous structural envelope
  hoverThrust: 2.2 * 9.80665, // m/s² belly VTOL jets
  lateralThrust: 0.3 * 9.80665,
  gearClearance: LANDING.gearClearance, // m, centre of mass above footpads with gear down
  bellyClearance: LANDING.bellyClearance,
};
// Legacy profile names remain accepted only to migrate saved flights. There is one aircraft.
export let aircraftProfile:'pathfinder'|'blackbird'='pathfinder';
export function setAircraftProfile(_profile:'pathfinder'|'blackbird'){aircraftProfile='pathfinder';}
const G0 = 9.80665;

export function atmosphereDensity(altitudeM: number) {
  return atmosphereAt(altitudeM).density;
}

export interface FlightInput {
  throttle: number; // 0..1 main drive along the nose
  hover: number; // -1..1 belly jets (+ pushes up in body frame)
  lateral: number; // -1..1 along body +X
  surge: number; // -1..1 extra along nose (reverse RCS)
  airbrake?: number; // 0..1 speed-brake drag
  boost?: boolean | number;
  torch?: boolean; // main drive in torch mode
  rotate?: number; // 0..1 pull back on the runway to lift the nose
  steer?: number; // -1..1 nosewheel steering, positive turns left
}
/** Runway numbers, m/s: rotate speed, automatic lift-off, and the fastest touchdown the gear accepts. */
export const RUNWAY = { rotate: 95, liftOff: 130, touchdown: 140, sink: 6 };
export function engineAcceleration(input:Pick<FlightInput,'torch'|'boost'>){return input.torch?VEHICLE.torchThrust:VEHICLE.mainThrust+(VEHICLE.boostThrust-VEHICLE.mainThrust)*Math.max(0,Math.min(1,Number(input.boost??0)));}
export interface FlightTelemetry {
  agl: number;
  verticalSpeed: number;
  groundSpeed: number;
  airspeed: number;
  mach: number;
  alpha: number;
  beta: number;
  dynamicPressure: number;
  gLoad: number;
  heatFlux: number;
  up: V;
  airVelocity: V;
  groundVelocity?: V;
  impactSpeed: number;
  surfaceContact?: boolean;
  surfaceNormal?: V;
  groundSlope?: number;
}
export interface FlightEnv {
  surface: EarthSurface;
  gear: boolean;
  /** Wind relative to the rotating ground, inertial km/s. */ wind?: V;
}

export function localUp(p: V): V {
  const l = len(p);
  return [p[0] / l, p[1] / l, p[2] / l];
}
export function atmosphereVelocity(p: V): V {
  const w = (2 * Math.PI) / EARTH.rotation;
  return [w * p[2], 0, -w * p[0]];
}
export function surfaceRadiusKm(env: FlightEnv, p: V, t: number, minWave = 3) {
  return (
    env.surface.radiusM(inertialToBody(p, t, EARTH.rotation), minWave) / 1000
  );
}

function axes(q: T.Quaternion) {
  return {
    forward: new T.Vector3(0, 0, -1).applyQuaternion(q).toArray() as V,
    up: new T.Vector3(0, 1, 0).applyQuaternion(q).toArray() as V,
    right: new T.Vector3(1, 0, 0).applyQuaternion(q).toArray() as V,
  };
}

/** Aerodynamic acceleration (km/s²) plus flow angles for the given attitude. */
export function aerodynamics(
  p: V,
  v: V,
  q: T.Quaternion,
  altitudeM: number,
  wind?: V,
  airbrake = 0,
  config: { gear?: boolean; agl?: number } = {},
) {
  let air = add(v, mul(atmosphereVelocity(p), -1));
  if (wind) air = add(air, mul(wind, -1));
  const speed = len(air) * 1000;
  const rho = atmosphereDensity(altitudeM),
    qbar = 0.5 * rho * speed * speed;
  const { forward, up, right } = axes(q);
  if (speed < 0.5)
    return { accel: [0, 0, 0] as V, alpha: 0, beta: 0, qbar, speed, rho };
  const vh = mul(air, 1 / len(air));
  const alpha = Math.atan2(-dot(vh, up), dot(vh, forward));
  const beta = Math.atan2(dot(vh, right), dot(vh, forward));
  const mach=speed/atmosphereAt(altitudeM).soundSpeed, shape = machEffects(mach);
  // Landing configuration: with the gear down below the flap limit the flaps run out, adding lift and drag.
  const flaps = config.gear ? 1 - Math.max(0, Math.min(1, (speed - 140) / 30)) : 0;
  // Ground effect: within about one span (17 m) of the ground the wingtip vortices are squeezed, so the wing lifts more and drags less.
  const h = Math.max(0.5, config.agl ?? 1e9) / 17, ground = (16 * h) ** 2 / (1 + (16 * h) ** 2);
  const attached = Math.abs(alpha) < 0.3 ? 1 : 0;
  const cl = (liftCoefficient(alpha) * shape.lift + flaps * 0.38 * attached) * Math.cos(beta) * (1 + 0.1 * (1 - ground));
  const cd = .5 * Math.max(0, Math.min(1, airbrake)) + 0.028 + (config.gear ? 0.024 : 0) + flaps * 0.035 + .055 * shape.induced * ground * cl * cl + 1.45 * Math.sin(alpha) ** 2 + 0.9 * Math.sin(beta) ** 2 + shape.wave;
  const cy = -1.1 * Math.sin(beta) * Math.cos(beta);
  const liftDir = add(up, mul(vh, -dot(up, vh))),
    liftLen = len(liftDir) || 1;
  const sideDir = add(right, mul(vh, -dot(right, vh))),
    sideLen = len(sideDir) || 1;
  const k = (qbar * VEHICLE.wingArea) / VEHICLE.mass / 1000; // → km/s²
  const accel = add(
    add(mul(liftDir, (cl * k) / liftLen), mul(sideDir, (cy * k) / sideLen)),
    mul(vh, -cd * k),
  );
  return { accel, alpha, beta, qbar, speed, rho };
}

/**
 * Compressibility: lift slope grows toward Mach 0.85 (Prandtl-Glauert), stalls through the transonic band and falls
 * off supersonically (Ackeret); wave drag rises from the critical Mach number, peaks just past Mach 1 and then eases;
 * the induced-drag factor grows once the flow is supersonic. Shapes are generic, not this airframe's wind-tunnel data.
 */
export function machEffects(mach: number) {
  const m = Math.max(0, mach);
  const lift = m < 0.85 ? Math.min(1.4, 1 / Math.sqrt(1 - m * m)) : m < 1.2 ? 1.4 - (m - 0.85) / 0.35 * 0.25 : Math.max(0.45, (1.15 * Math.sqrt(1.2 * 1.2 - 1)) / Math.sqrt(m * m - 1));
  const rise = Math.max(0, Math.min(1, (m - 0.82) / 0.23)), wave = m < 1.05 ? 0.045 * rise * rise * (3 - 2 * rise) : 0.045 * Math.pow(1.05 / m, 1.5);
  return { lift, wave, induced: 1 + Math.max(0, Math.min(1.2, (m - 1) * 0.6)) };
}
/** Advance atmospheric flight with ground contact. Attitude is held fixed for the call. */
export function advanceFlight(
  s: EarthState & { tele?: FlightTelemetry },
  seconds: number,
  q: T.Quaternion,
  input: FlightInput,
  env: FlightEnv,
) {
  const { forward, up, right } = axes(q);
  const initial = aerodynamics(
    s.p,
    s.v,
    q,
    (len(s.p) - EARTH.radius) * 1000,
    env.wind,
    input.airbrake,
  );
  let left = seconds,
    gLoad = 0,
    heatFlux = 0,
    alpha = initial.alpha,
    beta = initial.beta,
    qbar = initial.qbar,
    impactSpeed = 0,
    surfaceContact = false;
  const clearance =
    (env.gear ? VEHICLE.gearClearance : VEHICLE.bellyClearance) / 1000;

  if (s.status === "landed" && !env.gear) s.status = "flying";
  if (s.status === "landed") {
    const frame = groundFrame(env.surface, s.p, s.t);
    // A rolling aircraft rides its suspension over small bumps; only a parked one needs every pad supported.
    const supported = (s.roll ?? 0) > 2 || contactGaps(env.surface, s.p, s.t, q, true).spread <= LANDING.gearTravel;
    if (frame.slope > LANDING.maxSlope + 1e-5 || !supported) {
      s.status = "impact";
      s.body = !supported ? "Uneven ground beyond landing gear travel" : `Terrain too steep: ${frame.slope.toFixed(1)}° (limit ${LANDING.maxSlope}°)`;
      s.tele = telemetry(s, env, q, 0, 0, 0, 0, 0, 0, true);
      return;
    }
    const upL = localUp(s.p);
    const thrustUp = dot(
      add(
        add(
          mul(
            forward,
            input.throttle *
              engineAcceleration(input),
          ),
          mul(up, input.hover * VEHICLE.hoverThrust),
        ),
        mul(forward, input.surge * VEHICLE.lateralThrust),
      ),
      upL,
    );
    if (s.fuel > 0 && thrustUp > (EARTH.mu / len(s.p) ** 2) * 1000 * 1.02)
      { s.status = "flying"; s.roll = 0; }
    else {
      // --- ground roll: thrust, wheel brakes and drag along the runway; nosewheel steering; rotate to lift off.
      let roll = s.roll ?? 0;
      const flat = add(forward, mul(upL, -dot(forward, upL))), flatLen = len(flat) || 1, along = mul(flat, 1 / flatLen);
      const push = s.fuel > 0 ? input.throttle * engineAcceleration(input) : 0,
        brake = (input.airbrake ?? 0) > 0 ? 7 : push > .05 ? 0 : 1.6,
        accel = push - brake - .25 - roll * roll * .00035;
      roll = Math.max(0, roll + accel * seconds);
      if (roll > RUNWAY.liftOff || (roll > RUNWAY.rotate && (input.rotate ?? 0) > .2)) {
        // Rotate: nose up nine degrees and fly away at the roll speed.
        s.status = "flying"; s.roll = 0;
        s.p = add(s.p, mul(upL, .0012));
        s.v = add(add(atmosphereVelocity(s.p), mul(along, roll / 1000)), mul(upL, .005));
        q.premultiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(...right), 9 * Math.PI / 180));
        s.body = `Airborne at ${roll.toFixed(0)} m/s`;
        s.tele = telemetry(s, env, q, 0, 0, 0, 0, 0, 0, true);
        return;
      }
      s.roll = roll;
      // The nose settles onto the runway after touchdown.
      // Follow the runway's slope gently; the elevation data has small bumps that would rock the airframe.
      q.slerp(surfaceAttitude(q, frame.normal), Math.min(1, seconds * 0.6));
      if (roll > .05) {
        s.p = add(s.p, mul(along, roll * seconds / 1000));
        const steer = (input.steer ?? 0) * Math.min(1, roll / 12) * (roll > 60 ? .12 : .32) * seconds;
        if (steer) q.premultiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(...upL), steer));
      }
      s.v = atmosphereVelocity(s.p);
      s.p = bodyToInertial(
        inertialToBody(s.p, s.t, EARTH.rotation),
        s.t + seconds,
        EARTH.rotation,
      );
      q.premultiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), seconds / EARTH.rotation * Math.PI * 2));
      s.t += seconds;
      { const settled = settleOnSurface(env.surface, s.p, s.t, q), was = len(s.p), target = len(settled); /* damp the suspension over elevation-data noise */ s.p = mul(unit(settled), was + (target - was) * Math.min(1, seconds * 6)); }
      // Report the roll as ground speed so the airspeed tape reads on the runway.
      { const f = axes(q).forward, u = localUp(s.p), h = add(f, mul(u, -dot(f, u))), n = len(h) || 1; s.v = add(atmosphereVelocity(s.p), mul(h, roll / n / 1000)); }
      s.tele = telemetry(s, env, q, 0, 0, 0, 0, 0, 0, true);
      return;
    }
  }

  while (left > 1e-9 && s.status === "flying") {
    const r = len(s.p),
      approxAlt = (r - EARTH.radius) * 1000;
    const dt = Math.min(
      left,
      approxAlt < 30000 ? 0.02 : approxAlt < 150000 ? 0.1 : 0.5,
    );
    const oldP = s.p,
      oldT = s.t;
    const drive =
      input.throttle * engineAcceleration(input);
    const thrustMs2 = add(
      add(
        mul(forward, drive + input.surge * VEHICLE.lateralThrust),
        mul(up, input.hover * VEHICLE.hoverThrust),
      ),
      mul(right, input.lateral * VEHICLE.lateralThrust),
    );
    const fuelScale = s.fuel > 0 ? 1 : 0;
    const thrust = mul(thrustMs2, fuelScale / 1000);
    const accelAt = (p: V, v: V, time: number) => {
      const a = aerodynamics(p, v, q, (len(p) - EARTH.radius) * 1000, env.wind, input.airbrake, { gear: env.gear, agl: s.tele?.agl });
      alpha = a.alpha;
      beta = a.beta;
      qbar = a.qbar;
      return {
        total: add(add(earthGravity(p, time), thrust), a.accel),
        aero: a.accel,
        speed: a.speed,
        rho: a.rho,
      };
    };
    const a0 = accelAt(s.p, s.v, s.t);
    const next = add(add(s.p, mul(s.v, dt)), mul(a0.total, dt * dt * 0.5));
    const a1 = accelAt(next, add(s.v, mul(a0.total, dt)), s.t + dt);
    s.v = add(s.v, mul(add(a0.total, a1.total), dt * 0.5));
    s.p = next;
    s.t += dt;
    {
    s.fuel = Math.max(
      0,
      s.fuel -
        (Math.max(0, len(thrustMs2) - drive) / G0) * dt * 0.02 -
        (drive / G0) * dt * (input.torch ? 0.0015 : 0.02),
    );
    }
    gLoad = (len(add(a1.aero, thrust)) * 1000) / G0;

    // Heating: Sutton-Graves-like √ρ·v³, shielded when the black belly faces the flow.
    const air = add(s.v, mul(atmosphereVelocity(s.p), -1)),
      airLen = len(air) || 1;
    const bellyFacing = Math.max(0, -dot(mul(air, 1 / airLen), up)); // moving belly-first into the flow
    const shield = 0.25 + 0.75 * (1 - Math.min(1, bellyFacing * 1.5));
    heatFlux =
      Math.sqrt(a1.rho / 0.02) * (a1.speed / 1000) ** 3 * 0.12 * shield;
    s.heat = Math.max(0, (s.heat ?? 0) + (heatFlux - 0.8) * dt);
    s.dynamicPressure = qbar;
    // Entry heating is shown, never fatal: the airframe glows and soaks but holds together.
    s.heat = Math.min(s.heat ?? 0, 99);
    if ((s.heat ?? 0) >= 100) {
      s.status = "impact";
      s.body = "Hull burned through during entry";
    }
    // Excess load accumulates damage; a brief excursion is not instant destruction.
    const excess=Math.max(0,qbar/VEHICLE.maxDynamicPressure-1, (len(a1.aero)*1000/G0)/VEHICLE.maxLoad-1);
    s.structuralDamage=Math.min(1,Math.max(0,(s.structuralDamage??0)+excess*excess*dt/4));
    if (s.structuralDamage >= 1) {
      s.status = "impact";
      s.body = `Structural failure after sustained overload at ${(qbar / 1000).toFixed(0)} kPa dynamic pressure, ${(a1.speed / 1000).toFixed(2)} km/s`;
    }

    const surfaceKm = surfaceRadiusKm(env, s.p, s.t, 3);
    if (s.status === "flying" && len(s.p) - surfaceKm < .05) {
      const contact = contactGaps(env.surface, s.p, s.t, q, env.gear);
      if (contact.gap <= 0) {
        surfaceContact = true;
        const upL = localUp(s.p), frame = groundFrame(env.surface, s.p, s.t),
          rel = add(s.v, mul(atmosphereVelocity(s.p), -1)),
          vn = dot(rel, frame.normal) * 1000,
          vt = len(add(rel, mul(frame.normal, -dot(rel, frame.normal)))) * 1000,
          upright = dot(up, frame.normal),
          aligned = upright > Math.cos(LANDING.maxTilt * Math.PI / 180),
          gentle = Math.abs(vn) < 6 && vt < 5,
          // Runway arrival: wheels down, wings level, a modest sink rate and any sane rolling speed.
          runway = env.gear && upright > Math.cos(16 * Math.PI / 180) && Math.abs(vn) < RUNWAY.sink && vt >= 5 && vt < RUNWAY.touchdown,
          slopeSafe = frame.slope <= LANDING.maxSlope + 1e-5,
          supported = contact.spread <= LANDING.gearTravel;
        impactSpeed = len(rel) * 1000;
        if (runway && slopeSafe) {
          s.status = "landed"; s.roll = vt;
          s.body = `Touchdown ${Math.max(0, -vn).toFixed(1)} m/s at ${vt.toFixed(0)} m/s · brake with Ctrl`;
          s.p = settleOnSurface(env.surface, s.p, s.t, q);
          s.v = add(atmosphereVelocity(s.p), mul(add(rel, mul(frame.normal, -dot(rel, frame.normal))), 1));
        } else if (env.gear && aligned && gentle && slopeSafe && supported) {
          s.status = "landed"; s.roll = 0;
          s.body = `Touchdown ${Math.max(0, -vn).toFixed(1)} m/s · slope ${frame.slope.toFixed(1)}°`;
          s.p = settleOnSurface(env.surface, s.p, s.t, q);
          s.v = atmosphereVelocity(s.p);
        } else {
          s.status = "impact";
          s.body = !slopeSafe ? `Terrain too steep: ${frame.slope.toFixed(1)}° (limit ${LANDING.maxSlope}°)`
            : !env.gear && aligned && gentle ? "Landing gear retracted"
            : !aligned && impactSpeed < 12 ? "Tipped over on touchdown"
            : !supported && gentle ? "Uneven ground beyond landing gear travel"
            : `Surface impact at ${impactSpeed.toFixed(0)} m/s`;
          s.p = mul(upL, Math.max(len(s.p), surfaceKm + clearance * .3));
        }
      }
    }
    EARTH_MOONS.forEach((m, i) => {
      if (
        segmentHitsSphere(
          add(oldP, mul(earthMoonState(i, oldT).p, -1)),
          add(s.p, mul(earthMoonState(i, s.t).p, -1)),
          m.radius,
        )
      ) {
        s.status = "impact";
        s.body = m.name;
      }
    });
    left -= dt;
  }
  s.tele = telemetry(
    s,
    env,
    q,
    alpha,
    beta,
    qbar,
    gLoad,
    heatFlux,
    impactSpeed,
    surfaceContact,
  );
}

function telemetry(
  s: EarthState,
  env: FlightEnv,
  q: T.Quaternion,
  alpha: number,
  beta: number,
  qbar: number,
  gLoad: number,
  heatFlux: number,
  impactSpeed: number,
  surfaceContact = false,
): FlightTelemetry {
  // Co-rotating air only exists near Earth; far out, report motion relative to Earth' centre.
  const upL = localUp(s.p),
    air =
      len(s.p) - EARTH.radius > 250
        ? s.v
        : add(
            add(s.v, mul(atmosphereVelocity(s.p), -1)),
            mul(env.wind ?? [0, 0, 0], -1),
          );
  const clearance =
    (env.gear ? VEHICLE.gearClearance : VEHICLE.bellyClearance) / 1000;
  const agl = (len(s.p) - clearance - surfaceRadiusKm(env, s.p, s.t, 3)) * 1000;
  const frame = agl < 2000 ? groundFrame(env.surface, s.p, s.t) : null;
  // Vertical and ground speed are relative to the surface, not the wind: a parked ship reads zero in a gale.
  const ground =
    len(s.p) - EARTH.radius > 250
      ? s.v
      : add(s.v, mul(atmosphereVelocity(s.p), -1));
  const vs = dot(ground, upL) * 1000;
  return {
    agl,
    verticalSpeed: vs,
    groundSpeed: len(add(ground, mul(upL, -dot(ground, upL)))) * 1000,
    airspeed: len(air) * 1000,
    mach: (len(air) * 1000) / atmosphereAt((len(s.p)-EARTH.radius)*1000).soundSpeed,
    alpha,
    beta,
    dynamicPressure: qbar,
    gLoad,
    heatFlux,
    up: upL,
    airVelocity: air,
    groundVelocity: ground,
    impactSpeed,
    surfaceContact,
    surfaceNormal: frame?.normal,
    groundSlope: frame?.slope,
  };
}

/**
 * Fly-by-wire attitude: stick commands body rates, the controller chases them with a short time constant.
 * In air, pitch trims toward a gliding angle of attack and yaw weathervanes out sideslip, so banking turns the ship.
 */
export class FlightControl {
  angularVelocity = new T.Vector3();
  assisted = true;
  target: T.Quaternion | null = null;
  maxRate = new T.Vector3(0.35, 0.24, 0.7); // pitch, yaw, roll rad/s; precise by default
  reset() {
    this.angularVelocity.set(0, 0, 0);
    this.target = null;
  }
  pointTo(rotation: T.Quaternion) {
    this.target = rotation.clone();
  }
  update(
    rotation: T.Quaternion,
    stick: T.Vector3,
    seconds: number,
    flow?: { alpha: number; beta: number; qbar: number; loadFactor?: number; speed?: number },
  ) {
    if (stick.lengthSq() > 1e-4) this.target = null;
    let remaining = Math.max(0, Math.min(seconds, 0.25));
    const air = flow ? Math.min(1, flow.qbar / 250) : 0;
    while (remaining > 1e-9) {
      const dt = Math.min(remaining, 1 / 240);
      const command = new T.Vector3(
        stick.x * this.maxRate.x * (flow && flow.qbar>500 ? Math.min(1, 6*G0/Math.max(60,flow.speed??160)/this.maxRate.x) : 1),
        stick.y * this.maxRate.y,
        stick.z * this.maxRate.z,
      );
      if (flow && air > 0) {
        const trim = Math.min(.23, 9.80665*VEHICLE.mass * (flow.loadFactor ?? 1) / Math.max(100,flow.qbar) / VEHICLE.wingArea / 4.6);
        if (Math.abs(stick.x) < 0.05)
          command.x += -Math.sin(flow.alpha - trim) * 1.1 * air;
        command.y -= Math.sin(flow.beta) * 1.6 * air;
      }
      let accel: T.Vector3;
      if (this.target) {
        const error = rotation.clone().invert().multiply(this.target);
        if (error.w < 0) error.set(-error.x, -error.y, -error.z, -error.w);
        const want = new T.Vector3(error.x, error.y, error.z)
          .multiplyScalar(4.2)
          .clampLength(0, 0.8);
        accel = want.sub(this.angularVelocity).multiplyScalar(5);
      } else if (this.assisted || air > 0.2) {
        accel = command.sub(this.angularVelocity).multiplyScalar(7.2);
      } else {
        accel = new T.Vector3(stick.x, stick.y, stick.z).multiplyScalar(1.6);
      }
      this.angularVelocity.addScaledVector(accel.clampLength(0, 4.5), dt);
      const speed = this.angularVelocity.length();
      if (speed > 1e-9)
        rotation
          .multiply(
            new T.Quaternion().setFromAxisAngle(
              this.angularVelocity.clone().divideScalar(speed),
              speed * dt,
            ),
          )
          .normalize();
      remaining -= dt;
    }
  }
}

/**
 * Descent assist: hover jets and attitude bring the ship down gently over the current spot.
 * Returns the jet commands; the caller applies them as FlightInput and points the attitude controller.
 */
/** Attitude that presents the belly to the flow at the given angle of attack, wings level. */
export function entryAttitude(tele: FlightTelemetry, alphaDeg = 40) {
  const vh = new T.Vector3(...tele.airVelocity).normalize(),
    upL = new T.Vector3(...tele.up);
  const right = vh.clone().cross(upL).normalize(),
    liftUp = right.clone().cross(vh).normalize(),
    a = (alphaDeg * Math.PI) / 180;
  const fwd = vh
      .clone()
      .multiplyScalar(Math.cos(a))
      .addScaledVector(liftUp, Math.sin(a)),
    up = liftUp
      .clone()
      .multiplyScalar(Math.cos(a))
      .addScaledVector(vh, -Math.sin(a));
  return new T.Quaternion().setFromRotationMatrix(
    new T.Matrix4().makeBasis(
      fwd.clone().cross(up).normalize(),
      up,
      fwd.clone().negate(),
    ),
  );
}

export function descentAssist(
  s: EarthState,
  tele: FlightTelemetry,
  q: T.Quaternion,
) {
  const upL = new T.Vector3(...tele.up);
  const { forward, up, right } = axes(q);
  const g = (EARTH.mu / len(s.p) ** 2) * 1000;
  const safeSlope = (tele.groundSlope ?? 0) <= LANDING.maxSlope + 1e-5;
  const targetVs = !safeSlope && tele.agl < 150 ? 0 : -T.MathUtils.clamp(tele.agl / 7, 1.2, 45);
  const blend = safeSlope ? 1 - T.MathUtils.smoothstep(tele.agl, 20, 150) : 0;
  const normal = upL.clone().lerp(new T.Vector3(...(tele.surfaceNormal ?? tele.up)), blend).normalize();
  // Radar-referenced like a real landing system: track descent rate and null drift over the ground, so wind
  // cannot carry an assisted ship off the pad.
  const ground = new T.Vector3(
    ...(tele.groundVelocity ?? tele.airVelocity),
  ).multiplyScalar(1000);
  const horizontal = ground.clone().addScaledVector(normal, -ground.dot(normal));
  // Desired inertial acceleration (m/s²): cancel gravity, track descent rate, null drift.
  const want = upL
    .clone()
    .multiplyScalar(g)
    .addScaledVector(normal, (targetVs - ground.dot(normal)) * 1.4)
    .addScaledVector(horizontal, -0.55);
  const hover = T.MathUtils.clamp(
    want.dot(new T.Vector3(...up)) / VEHICLE.hoverThrust,
    0,
    1,
  );
  const lateral = T.MathUtils.clamp(
    want.dot(new T.Vector3(...right)) / VEHICLE.lateralThrust,
    -1,
    1,
  );
  const surge = T.MathUtils.clamp(
    want.dot(new T.Vector3(...forward)) / VEHICLE.lateralThrust,
    -1,
    1,
  );
  const level = surfaceAttitude(q, normal.toArray() as V);
  return { hover, lateral, surge, level, targetVs };
}
