import {EARTH} from './earth';
import {inertialToBody} from './geo';
import {WorldTour,TIME_RATES,type TourConfig} from "./circumnavigation";
import type { EarthState } from "./earth";
export interface SavedFlight {
  version: 1;
  state: EarthState;
  rotation: number[];
  epoch: string;
  aircraft?:"pathfinder"|"blackbird";timeRate?:number;solarOffset?:number;tour?:{config:TourConfig;elapsed:number}|null;
}
export function parseFlight(raw: string): SavedFlight {
  const a = JSON.parse(raw);
  if (
    a?.version !== 1 ||
    !a.state ||
    !Array.isArray(a.rotation) ||
    a.rotation.length !== 4
  )
    throw Error("Unsupported saved flight");
  const s = a.state;
  for (const v of [s.p, s.v])
    if (
      !Array.isArray(v) ||
      v.length !== 3 ||
      v.some((n: unknown) => typeof n !== "number" || !Number.isFinite(n))
    )
      throw Error("Invalid flight vectors");
  if (
    Math.hypot(...s.p) < 6370 ||
    Math.hypot(...s.p) > 1e8 ||
    Math.hypot(...s.v) > 1000 ||
    !Number.isFinite(s.t) ||
    s.t < 0 ||
    !Number.isFinite(s.fuel) ||
    s.fuel < 0 ||
    s.fuel > 100 ||
    (s.heat !== undefined &&
      (!Number.isFinite(s.heat) || s.heat < 0 || s.heat >= 100)) ||
    (s.structuralDamage !== undefined && (!Number.isFinite(s.structuralDamage)||s.structuralDamage<0||s.structuralDamage>=1)) ||
    !["flying", "landed"].includes(s.status) ||
    a.rotation.some(
      (n: unknown) => typeof n !== "number" || !Number.isFinite(n),
    ) ||
    !Number.isFinite(Date.parse(a.epoch))
  )
    throw Error("Invalid saved flight");
  if(a.aircraft!==undefined&&!['pathfinder','blackbird'].includes(a.aircraft))throw Error('Invalid aircraft profile');
  if(a.timeRate!==undefined&&!TIME_RATES.includes(a.timeRate))throw Error('Invalid time acceleration');
  if(a.solarOffset!==undefined&&(!Number.isFinite(a.solarOffset)||Math.abs(a.solarOffset)>24))throw Error('Invalid solar offset');
  if(a.tour){const route=new WorldTour(a.tour.config);if(!Number.isFinite(a.tour.elapsed)||a.tour.elapsed<0||a.tour.elapsed>route.plan.seconds)throw Error('Invalid saved world tour');route.advance(a.tour.elapsed);const body=inertialToBody(s.p,s.t,EARTH.rotation),r=Math.hypot(...body),up=route.pose().up;if(Math.abs((r-EARTH.radius)*1000-route.config.altitude)>1||Math.hypot(...body.map((v:number,i:number)=>v/r-up.getComponent(i)))>1e-5)throw Error('Saved tour position does not match progress');}
  const norm = Math.hypot(...a.rotation);
  if (Math.abs(norm - 1) > 0.01) throw Error("Invalid saved attitude");
  return {
    version: 1,
    state: {
      p: [...s.p] as [number, number, number],
      v: [...s.v] as [number, number, number],
      t: s.t,
      fuel: s.fuel,
      status: s.status,
      body: typeof s.body === "string" ? s.body : "",
      heat: s.heat ?? 0,
      structuralDamage:s.structuralDamage??0,
    },
    rotation: [...a.rotation],
    epoch: a.epoch,aircraft:a.aircraft,timeRate:a.timeRate,solarOffset:a.solarOffset,tour:a.tour??null,
  };
}
export function validateStart(
  lat: number,
  lon: number,
  alt: number,
  heading: number,
  speed: number,
) {
  if (
    ![lat, lon, alt, heading, speed].every(Number.isFinite) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180 ||
    alt < 0 ||
    alt > 10000000 ||
    heading < 0 ||
    heading > 360 ||
    speed < 0 ||
    speed > 15000
  )
    throw Error(
      "Choose latitude −90…90, longitude −180…180, altitude 0…10,000,000 m and speed 0…15,000 m/s.",
    );
}
