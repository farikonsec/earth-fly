import * as T from 'three';
import {EARTH} from './earth';
import type {Aero} from './aircraft-models';

/** Arcade air-combat pilot. Kilometres / seconds; speeds are relative to the co-rotating air. */
export type Mode='engage'|'flank'|'cruise'|'extend'|'evade';
export type Manoeuvre='break'|'jink'|'split-s'|'zoom'|'hug'|'beam';
export interface Pilot {
 mode:Mode;manoeuvre:Manoeuvre;timer:number;cool:number;side:number;dir:T.Vector3;up:T.Vector3;speed:number;boost:number;wing:number;tail:number;clock:number;gLimit:number;agl:number;escape:number;
 /** Optional top speed in km/s for slow types such as helicopters and jump jets. */
 cap?:number;
 /** Published top Mach; `machNow` is the current Mach number, for the HUD. */
 mach?:number;machNow?:number;sprint?:number;nextSprint?:number;
 /** When present the pilot flies a lift/drag/thrust energy model instead of the arcade one. */
 aero?:Aero;
}
export interface Threat {locked:boolean;missile:T.Vector3|null;gunsight:boolean}
const G=.00981,OMEGA=2*Math.PI/EARTH.rotation;
export const airVelocity=(p:T.Vector3)=>new T.Vector3(OMEGA*p.z,0,-OMEGA*p.x);
export const LIMITS={scout:9,fighter:7.5,heavy:3.2} as const;
export function createPilot(dir:T.Vector3,speed:number,gLimit:number,wing:number,mode:Mode,radial:T.Vector3):Pilot{
 return{mode,manoeuvre:'break',timer:mode==='flank'?3+wing%3:0,cool:1.5,side:wing%2?1:-1,dir:dir.clone().normalize(),up:radial.clone(),speed,boost:0,wing,tail:0,clock:wing*1.9,gLimit,agl:9,escape:0};
}
export function speedEnvelope(playerSpeed:number){return{min:Math.max(.11,.6*playerSpeed),max:Math.max(.42,1.4*playerSpeed)};}
const horizontal=(v:T.Vector3,radial:T.Vector3)=>v.clone().addScaledVector(radial,-v.dot(radial));
/**
 * Advances one pilot and returns its new inertial velocity. `ground` gives the terrain radius under a point.
 * Turn rate is load-factor limited, hard turns bleed speed, climbing costs speed and diving returns it.
 */
export function flyPilot(a:Pilot,position:T.Vector3,dt:number,player:{p:T.Vector3;v:T.Vector3;aim:T.Vector3},threat:Threat,ground:(p:T.Vector3)=>number,random:()=>number){
 const radial=position.clone().normalize(),playerAir=player.v.clone().sub(airVelocity(player.p)),playerSpeed=Math.min(a.cap??.65,Math.max(.08,playerAir.length()));
 const heading=playerAir.lengthSq()>1e-6?playerAir.clone().normalize():player.aim.clone(),envelope=speedEnvelope(playerSpeed);
 // Supersonic by choice: a pilot goes through Mach 1 to close a distant target, to run from a missile, to extend or
 // break away, or to stay with a supersonic opponent; otherwise it stays just under the barrier, where turning is best.
 const altM=Math.max(0,(position.length()-EARTH.radius)*1000),sound=(altM<11000?340.3-.0041*altM:295)/1000,top=(a.mach??1.6)*sound;
 // Each pilot also flies an occasional supersonic transit run: 30-45 s straight and level at full power, every two to
 // four minutes at its own times, unless it is under threat.
 a.nextSprint??=60+((a.wing*97)%180);if(a.clock>a.nextSprint){a.sprint=30+(a.wing*7)%15;a.nextSprint=a.clock+120+((a.wing*53+Math.floor(a.clock))%120);}a.sprint=Math.max(0,(a.sprint??0)-dt);
 const ahead=player.p.clone().sub(position),intercept=ahead.length()>4&&ahead.normalize().dot(a.dir)>.5;
 const dash=intercept||a.sprint>0||!!threat.missile||a.mode==='extend'||a.mode==='evade'||playerAir.length()>sound*.95;
 envelope.max=dash?Math.max(envelope.max,top):Math.min(envelope.max,.95*sound,top);envelope.min=Math.min(envelope.min,envelope.max*.6);
 if(a.cap){envelope.max=Math.min(envelope.max,a.cap);envelope.min=Math.min(envelope.min,a.cap*.45);}
 const toPlayer=player.p.clone().sub(position),distance=Math.max(1e-4,toPlayer.length()),line=toPlayer.clone().divideScalar(distance);
 a.agl=position.length()-ground(position);a.clock+=dt;a.timer-=dt;a.cool=Math.max(0,a.cool-dt);
 const heavy=a.gLimit<4,danger=threat.missile||threat.locked||threat.gunsight;
 // --- decisions
 if(danger&&a.mode!=='evade'&&a.cool<=0){
  a.mode='evade';a.side=random()<.5?-1:1;a.timer=2.2+random()*1.8;
  const options:Manoeuvre[]=heavy?['jink','break']:threat.missile?['beam','break','split-s','hug']:['break','jink','split-s','zoom','hug'];
  const allowed=options.filter(m=>m==='split-s'?a.agl>1.8:m==='hug'?a.agl>.45&&a.agl<4:m==='zoom'?a.speed>envelope.min*1.25:true);
  a.manoeuvre=allowed[Math.floor(random()*allowed.length)]??'break';
 }else if(a.mode==='evade'&&a.timer<=0){a.cool=danger?.5:1.4;a.mode=distance<2.2&&!heavy?'extend':heavy?'cruise':'engage';a.timer=2.5+random()*2.5;}
 else if(a.mode==='extend'&&a.timer<=0){a.mode='engage';a.tail=0;}
 else if(a.mode==='flank'&&(a.timer<=0||distance<1.6))a.mode='engage';
 if(distance>11&&a.mode!=='evade')a.mode=heavy?'cruise':'engage';
 // --- where the pilot wants the nose, and how fast
 let want=a.dir.clone(),target=playerSpeed,boost=0,effort=.8;
 const side=radial.clone().cross(a.dir).normalize().multiplyScalar(a.side);
 if(a.mode==='engage'){
  // Lead pursuit toward a firing position behind the player.
  const slot=player.p.clone().addScaledVector(heading,-(.65+.22*a.wing)).addScaledVector(radial.clone().cross(heading).normalize(),(a.wing%2?1:-1)*.22*(1+a.wing*.5));
  const lead=Math.min(3.5,distance/Math.max(.1,a.speed))*.7;
  want=slot.addScaledVector(playerAir,lead).sub(position).addScaledVector(airVelocity(position).sub(airVelocity(player.p)),-lead).normalize();
  const behind=line.dot(heading)>.5&&distance<1.4;
  target=distance>2.5?envelope.max:behind?playerSpeed*.98:distance<.7?playerSpeed*.8:playerSpeed*1.15;boost=distance>2.5?1:0;
  a.tail=behind?a.tail+dt:Math.max(0,a.tail-dt*.5);
  if(a.tail>5+a.wing){a.mode='extend';a.timer=3+random()*2;a.side=random()<.5?-1:1;a.tail=0;}
  if(distance<.16)want=line.clone().negate().add(radial.clone().multiplyScalar(.4)).normalize();
 }else if(a.mode==='flank'){
  // Offset approach: arrive on the player's beam before turning in.
  const beam=player.p.clone().addScaledVector(radial.clone().cross(heading).normalize(),a.side*2.2).addScaledVector(heading,1.2).addScaledVector(radial,.25*a.side);
  want=beam.sub(position).normalize();target=envelope.max*.9;boost=.6;
 }else if(a.mode==='cruise'){
  const station=player.p.clone().addScaledVector(heading,3.2).addScaledVector(radial.clone().cross(heading).normalize(),Math.sin(a.clock*.13)*1.4).addScaledVector(radial,.2);
  want=station.sub(position).normalize();target=distance>4.5?envelope.max:playerSpeed;effort=.6;
 }else if(a.mode==='extend'){
  want=horizontal(line.clone().negate(),radial).add(side.clone().multiplyScalar(.45)).add(radial.clone().multiplyScalar(.12)).normalize();target=envelope.max;boost=1;
 }else{
  effort=1;boost=1;target=envelope.max;
  const away=horizontal(line.clone().negate(),radial).normalize();
  switch(a.manoeuvre){
   case'break':want=side.clone().add(a.dir.clone().multiplyScalar(.25)).add(radial.clone().multiplyScalar(.15*a.side)).normalize();target=playerSpeed;break;
   case'jink':want=a.dir.clone().add(side.clone().multiplyScalar(Math.sin(a.clock*5.2)*.95)).add(radial.clone().multiplyScalar(Math.cos(a.clock*3.7)*.55)).normalize();break;
   case'split-s':{const forward=horizontal(a.dir,radial).normalize();want=a.timer>1.7?forward.multiplyScalar(.25).addScaledVector(radial,-1).normalize():forward.negate().addScaledVector(radial,-.1).normalize();boost=.2;break;}
   case'zoom':want=horizontal(a.dir,radial).normalize().multiplyScalar(.45).addScaledVector(radial,1).normalize();break;
   case'hug':want=horizontal(a.dir,radial).normalize().add(side.clone().multiplyScalar(.35*Math.sin(a.clock*1.3))).addScaledVector(radial,T.MathUtils.clamp((.3-a.agl)*1.4,-.75,.5)).normalize();break;
   case'beam':{// Put the missile on the beam, then break hard into it at the last moment.
    const from=threat.missile?threat.missile.clone().sub(position).normalize():line;const beamDir=radial.clone().cross(from).normalize().multiplyScalar(a.side);
    want=threat.missile&&threat.missile.distanceTo(position)<.55?from.clone().multiplyScalar(.5).add(beamDir).addScaledVector(radial,-.4).normalize():beamDir.add(away.multiplyScalar(.2)).normalize();break;}
  }
 }
 // --- terrain: never trade a kill for a mountain
 let floor=0,blocked=false;
 for(const look of [1.1,2.6,4.5,8]){const ahead=position.clone().addScaledVector(a.dir,a.speed*look),margin=ahead.length()-ground(ahead),need=.22+.05*look;if(margin<need){floor=Math.max(floor,(need-margin)/need*(1.6-look*.15)+.35);if(need-margin>look*a.speed*.25)blocked=true;}}
 if(a.agl<.18)floor=Math.max(floor,1.4);
 if(blocked||a.escape&&floor>0){
  // A wall that cannot be out-climbed: turn along it toward whichever side is lower.
  if(!a.escape){const probe=(sign:number)=>{const d=horizontal(a.dir,radial).normalize().applyAxisAngle(radial,sign*1.05),q=position.clone().addScaledVector(d,a.speed*4);return q.length()-ground(q);};a.escape=probe(1)>=probe(-1)?1:-1;}
  want=horizontal(a.dir,radial).normalize().applyAxisAngle(radial,a.escape*1.25).addScaledVector(radial,Math.min(1.2,floor)).normalize();effort=1;
 }else{
  a.escape=0;
  if(floor>0){want=horizontal(want,radial).normalize().addScaledVector(radial,Math.min(2.2,floor)).normalize();effort=1;}
 }
 if(floor>0&&a.mode==='evade'&&a.manoeuvre==='split-s')a.manoeuvre='break';
 // --- flight: g-limited turn, energy bleed, gravity
 // A transit run holds heading and altitude at the top of the envelope; any threat cancels it.
 if((a.sprint??0)>0){if(danger)a.sprint=0;else{want=horizontal(a.dir,radial).normalize();target=envelope.max;boost=1;effort=.4;}}
 // Load available: the structure's g limit, or what the wing can lift at this speed and air density, whichever is lower.
 const metres=a.speed*1000,height=Math.max(0,position.length()-EARTH.radius),rho=1.225*Math.exp(-height/8.5),q=.5*rho*metres*metres;
 const available=a.aero?Math.min(a.gLimit,q*a.aero.clmax/(a.aero.wl*9.81)):a.gLimit;
 const rate=(a.aero?Math.max(available,.3)*G/Math.max(.05,a.speed):Math.max(a.gLimit*G/Math.max(.05,a.speed),.16))*effort,angle=a.dir.angleTo(want),step=Math.min(angle,rate*dt),before=a.dir.clone();
 if(angle>1e-5){const axis=a.dir.clone().cross(want);if(axis.lengthSq()<1e-10)axis.copy(radial);a.dir.applyAxisAngle(axis.normalize(),step).normalize();}
 const load=rate*dt>0?step/(rate*dt):0;
 // A transit run goes for the top of the envelope whatever the tactical picture asks for.
 a.boost+=(boost-a.boost)*(1-Math.exp(-dt*3));
 if(a.aero){
  // Energy model: thrust (with afterburner and altitude lapse) minus parasite and induced drag, minus gravity along the path.
  const pulled=Math.max(1,step/Math.max(dt,1e-6)*a.speed/G),cl=Math.min(a.aero.clmax*1.15,pulled*a.aero.wl*9.81/Math.max(1,q));
  // Transonic wave drag: parasite drag roughly doubles through Mach 0.85-1.05 and eases again towards Mach 2.
  const mach=a.speed/sound,wave=1+1.6*T.MathUtils.smoothstep(mach,.85,1.05)-.7*T.MathUtils.smoothstep(mach,1.2,2.2);a.machNow=mach;
  const drag=q*(a.aero.cd0*wave+a.aero.k*cl*cl)/a.aero.wl,throttle=a.speed<target-.004?(boost>.5?1:.72):a.speed>target+.01?.05:.45;
  const thrust=a.aero.tw*9.81*throttle*Math.pow(rho/1.225,.7),brake=a.speed>target+.03?q*.05/a.aero.wl:0;
  a.speed+=((thrust-drag-brake)/1000-a.dir.dot(radial)*G)*dt;
 }else a.speed+=T.MathUtils.clamp(target-a.speed,-.07*dt,(.028+.035*a.boost)*dt)-load*load*.022*dt*(a.speed/.3)-a.dir.dot(radial)*G*dt;
 a.speed=T.MathUtils.clamp(a.speed,envelope.min*.7,envelope.max*1.2);
 const lift=a.dir.clone().sub(before).multiplyScalar(a.speed/Math.max(dt,1e-4)).addScaledVector(radial,G);
 if(lift.lengthSq()>1e-12)a.up.lerp(lift.normalize(),1-Math.exp(-dt*6)).normalize();
 return airVelocity(position).addScaledVector(a.dir,a.speed);
}
