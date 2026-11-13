import * as T from 'three';import {WorldTour} from './circumnavigation';import {EARTH,type EarthState} from './earth';import {bodyToInertial,EarthSurface} from './geo';import {VEHICLE,aerodynamics,advanceFlight,type FlightTelemetry} from './flight';
/** Reduced-order, level constant-Mach cruise hold, with exact rotating-sphere navigation.
 * This is a navigation autopilot model, not integration of manual aerodynamic transients.
 */
export function tourFlight(tour:WorldTour,state:EarthState&{tele?:FlightTelemetry},rotation:T.Quaternion,seconds:number,surface:EarthSurface){
 const dt=tour.advance(seconds);state.t+=dt;const pose=tour.pose(),r=EARTH.radius+tour.config.altitude/1000,speed=tour.plan.speed/1000,w=2*Math.PI/EARTH.rotation,
   world=(v:T.Vector3)=>new T.Vector3(...bodyToInertial(v.toArray(),state.t,EARTH.rotation)),up=world(pose.up),forward=world(pose.direction),position=up.clone().multiplyScalar(r),omega=new T.Vector3(0,w,0),ground=forward.clone().multiplyScalar(speed),velocity=omega.clone().cross(position).add(ground),
   accel=up.clone().multiplyScalar(-speed*speed/r).add(omega.clone().cross(ground).multiplyScalar(2)).add(omega.clone().cross(omega.clone().cross(position))),
   required=accel.addScaledVector(up,EARTH.mu/(r*r)),lift=required.clone().addScaledVector(forward,-required.dot(forward)),top=lift.normalize(),
   atmosphere=aerodynamics(position.toArray(),velocity.toArray(),rotation,tour.config.altitude),qbar=atmosphere.qbar,
   alpha=Math.min(.22,required.length()*1000*VEHICLE.mass/Math.max(1,qbar*VEHICLE.wingArea*4.6)),f=forward.clone().multiplyScalar(Math.cos(alpha)).addScaledVector(top,Math.sin(alpha)),u=top.clone().multiplyScalar(Math.cos(alpha)).addScaledVector(forward,-Math.sin(alpha));
 rotation.setFromRotationMatrix(new T.Matrix4().makeBasis(f.clone().cross(u).normalize(),u,f.clone().negate()));state.p=position.toArray();state.v=velocity.toArray();state.fuel=pose.fuel;state.status='flying';
 advanceFlight(state,0,rotation,{throttle:0,hover:0,lateral:0,surge:0},{surface,gear:false});
 const aero=aerodynamics(state.p,state.v,rotation,tour.config.altitude),drag=Math.max(0,-new T.Vector3(...aero.accel).dot(forward)*1000),throttle=Math.min(1,drag/Math.max(.001,VEHICLE.boostThrust*Math.cos(alpha)));
 state.tele!.gLoad=required.length()*1000/9.80665;state.tele!.alpha=aero.alpha;state.tele!.beta=aero.beta;state.dynamicPressure=aero.qbar;return{dt,throttle,requiredThrust:drag*VEHICLE.mass,availableThrust:VEHICLE.boostThrust*VEHICLE.mass};
}
