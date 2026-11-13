import * as T from 'three';
import {createPilot,flyPilot,airVelocity,speedEnvelope,LIMITS,type Pilot} from './combat-ai';
import {AIRCRAFT,type AircraftType} from './aircraft-models';
/** Fighters met in rotation; later waves bring the heavier types. */
const ROSTER:AircraftType[]=['f16','mig29','gripen','f18','harrier','typhoon','f35','su27','f22'];
/** Pure arcade simulation, kilometres / seconds. No real-world targeting or ballistics. */
export type DroneKind='scout'|'fighter'|'heavy';
export interface Drone {score?:number;quietTarget?:boolean;collisionBox?:{right:T.Vector3;up:T.Vector3;forward:T.Vector3;half:T.Vector3};ground?:boolean;lockOn?:number;external?:boolean;name?:string;radius?:number;destroy?:()=>void;patrol?:T.Vector3;ordnance?:number;id:number;p:T.Vector3;v:T.Vector3;hp:number;phase:number;kind?:DroneKind;maxHp?:number;ai?:Pilot;hit?:number;gun?:number;burst?:number;model?:AircraftType}
/** Missiles carry a heading, an air-relative speed and the leftover launch drift; bullets only need p and v. */
export interface Shot {p:T.Vector3;v:T.Vector3;life:number;missile:boolean;target:number|null;age:number;dir?:T.Vector3;speed?:number;extra?:T.Vector3;spent?:boolean}
export const MISSILE={drop:.28,burn:3.6,thrust:.95,drag:.22};
/** A hostile round. Dodging works because the lead is solved once, at the muzzle. */
export interface EnemyShot {p:T.Vector3;v:T.Vector3;life:number;age:number;weapon?:'gun'|'rocket'|'missile';damage?:number;turn?:number;owner?:number;
 /** Boosting missiles (surface-to-air) accelerate along their heading up to maxSpeed, km/s². */ accel?:number;maxSpeed?:number;name?:string}
/** What the radar warning receiver hears: who is tracking you with a seeker, and which missiles are inbound. */
export interface Threats {locks:{p:T.Vector3;name:string;ground:boolean}[];missiles:EnemyShot[]}
export interface Burst {scale?:number;p:T.Vector3;life:number;big?:boolean;v?:T.Vector3;dust?:boolean}
export interface Popup {p:T.Vector3;text:string;life:number}
export type CombatEvent='gun'|'missile'|'hit'|'lock'|'kill'|'wave'|'enemyGun'|'damage'|'down';
const ORIGIN=new T.Vector3(),NO_TARGETS=new Map<number,T.Vector3>();
export function closestSegment(a:T.Vector3,b:T.Vector3,p:T.Vector3){const d=b.clone().sub(a);const t=T.MathUtils.clamp(p.clone().sub(a).dot(d)/Math.max(1e-12,d.lengthSq()),0,1);return a.clone().addScaledVector(d,t).distanceTo(p);}
const KINDS:Record<DroneKind,{hp:number;score:number;radius:number;agility:number}>={scout:{hp:2,score:150,radius:.07,agility:1.5},fighter:{hp:3,score:100,radius:.075,agility:1},heavy:{hp:9,score:500,radius:.14,agility:.45}};
/** Fictional, deliberately forgiving game loadouts; no real weapon performance model. */
export const LOADOUTS:Record<string,{name:string;weapon:'gun'|'rocket'|'missile';range:number;interval:number;speed:number;damage:number;turn:number}>= {
 f16:{name:'Viper · rapid cannon',weapon:'gun',range:1.8,interval:1.1,speed:1.7,damage:3,turn:0},
 mig29:{name:'Fulcrum · heavy cannon',weapon:'gun',range:2.1,interval:2,speed:1.35,damage:6,turn:0},
 gripen:{name:'Gripen · precision cannon',weapon:'gun',range:2.4,interval:2.5,speed:1.9,damage:5,turn:0},
 f18:{name:'Hornet · rocket salvo',weapon:'rocket',range:3.6,interval:6,speed:.72,damage:10,turn:0},
 harrier:{name:'Harrier · short-range rockets',weapon:'rocket',range:2.4,interval:4,speed:.55,damage:8,turn:0},
 helicopter:{name:'Gunship · rocket pods',weapon:'rocket',range:2.6,interval:5,speed:.5,damage:8,turn:0},
 typhoon:{name:'Typhoon · agile seeker',weapon:'missile',range:5,interval:13,speed:.85,damage:14,turn:.38},
 f35:{name:'Lightning · short-range seeker',weapon:'missile',range:4.4,interval:12,speed:.8,damage:12,turn:.45},
 su27:{name:'Flanker · long-range seeker',weapon:'missile',range:6.5,interval:16,speed:.95,damage:16,turn:.24},
 f22:{name:'Raptor · interceptor seeker',weapon:'missile',range:6,interval:15,speed:1,damage:15,turn:.3},
};
export class Combat {
 blast:((p:T.Vector3)=>void)|null=null;
 persistent=false;allowEngage=true;external:Drone[]=[];patrolCount=24;private replenish=0;
 get allTargets(){return [...this.targets,...this.external.filter(t=>t.hp>0)];}
 get engaged(){return this.active&&(!this.persistent||this.lock!==null||this.shots.length>0||this.incoming.length>0||this.quiet<4&&this.taken>0);}
 /** Patrols stay alive without a sortie timer. Distant aircraft follow their own moving stations. */
 startPatrol(p:T.Vector3,q:T.Quaternion,v:T.Vector3){this.start(p,q,v);this.persistent=true;this.waveBanner=0;this.targets=[];this.spawn(p,q,v);}

 active=false;targets:Drone[]=[];shots:Shot[]=[];bursts:Burst[]=[];popups:Popup[]=[];score=0;hits=0;fired=0;kills=0;wave=1;remaining=90;lock:number|null=null;lockTime=0;gunCooldown=0;missileCooldown=0;combo=0;comboClock=0;best=0;completed=false;hitFlash=0;waveBanner=0;
 /** Player hull 0..100. It regenerates after a few quiet seconds; at zero the sortie ends. */
 health=100;hurt=0;quiet=0;taken=0;down=false;incoming:EnemyShot[]=[];hurtFrom=new T.Vector3();
 event:((kind:CombatEvent,at?:T.Vector3)=>void)|null=null;private serial=0;private lockAnnounced=false;private seed=7919;private scatter=4241;private rail=1;private attitude=new T.Quaternion();private ticks=0;
 /** Terrain radius in km under an inertial point; defaults to the sea-level sphere. */
 ground:(p:T.Vector3)=>number=()=>6371;
 private random=()=>{this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296;};
 start(p:T.Vector3,q:T.Quaternion,v:T.Vector3){this.clear();this.active=true;this.waveBanner=2.5;this.spawn(p,q,v);}
 clear(){this.persistent=false;this.replenish=0;this.active=false;this.targets=[];this.shots=[];this.bursts=[];this.popups=[];this.score=this.hits=this.fired=this.combo=this.kills=0;this.comboClock=0;this.wave=1;this.remaining=90;this.completed=false;this.lock=null;this.lockTime=0;this.gunCooldown=this.missileCooldown=0;this.hitFlash=0;this.waveBanner=0;this.health=100;this.hurt=this.quiet=this.taken=0;this.down=false;this.incoming=[];}
 spawn(p:T.Vector3,q:T.Quaternion,v:T.Vector3){const forward=new T.Vector3(0,0,-1).applyQuaternion(q),right=new T.Vector3(1,0,0).applyQuaternion(q),up=new T.Vector3(0,1,0).applyQuaternion(q);
  const count=this.persistent?Math.max(0,this.patrolCount-this.targets.length):Math.min(16,10+this.wave),air=airVelocity(p),playerAir=v.clone().sub(air),speed=this.persistent?.23:Math.max(.08,playerAir.length()),heading=playerAir.lengthSq()>1e-6?playerAir.clone().normalize():forward,radial=p.clone().normalize(),envelope=speedEnvelope(speed);
  void right;void up;
  const across=radial.clone().cross(heading).normalize();
  for(let i=0;i<count;i++){
   // Every third wave escorts an airliner; even waves bring a gunship down low.
   const model:AircraftType=i%12===11?'helicopter':ROSTER[(this.wave*2+i-2+ROSTER.length*4)%ROSTER.length],spec=AIRCRAFT[model];
   const kind:DroneKind=spec.role==='heavy'||spec.role==='helicopter'?'heavy':spec.role==='scout'?'scout':'fighter';
   // Pairs arrive from ahead and from the beams; some merge head-on, others swing wide to flank.
   const headOn=kind!=='heavy'&&i%3===0,lateral=((i%3)-1)*(2.2+this.random()*1.6)+(this.random()-.5),range=kind==='heavy'?5:4+this.random()*3+i*.25;
   const at=p.clone().addScaledVector(heading,this.persistent?Math.cos(i*2.39996)*(8+i*.65):range).addScaledVector(across,this.persistent?Math.sin(i*2.39996)*(8+i*.65):lateral).addScaledVector(radial,.2+this.random()*.9);
   if(this.persistent)at.setLength(this.ground(at)+1.2+(i%5)*.65);
   const floor=this.ground(at)+.5;if(at.length()<floor)at.setLength(floor);if(model==='helicopter')at.setLength(this.ground(at)+.22);
   const dir=headOn?heading.clone().negate().addScaledVector(across,-lateral*.08).normalize():heading.clone().addScaledVector(across,-Math.sign(lateral||1)*.3).normalize();
   const ai=createPilot(dir,Math.min(spec.cap??9,T.MathUtils.clamp(speed*(headOn?1.1:.95),envelope.min,envelope.max)),spec.g,i,kind==='heavy'?'cruise':headOn?'engage':'flank',at.clone().normalize());
   ai.cap=spec.cap;ai.aero=spec.aero;ai.mach=spec.mach;void LIMITS;
   this.targets.push({patrol:this.persistent?at.clone():undefined,ordnance:4+i*.7,id:++this.serial,p:at,v:airVelocity(at).addScaledVector(ai.dir,ai.speed),hp:spec.hp,maxHp:spec.hp,phase:i*1.7+this.wave,kind,ai,model});
  }
 }
 /** Adds one piloted fighter at a given place and heading: used when a formation's escorts break off to fight. */
 scramble(model:AircraftType,at:T.Vector3,dir:T.Vector3,speed:number){const spec=AIRCRAFT[model],ai=createPilot(dir.clone(),speed,spec.g,this.targets.length,'engage',at.clone().normalize());ai.cap=spec.cap;ai.aero=spec.aero;ai.mach=spec.mach;
  const t:Drone={ordnance:3,id:++this.serial,p:at.clone(),v:airVelocity(at).addScaledVector(dir,speed),hp:spec.hp,maxHp:spec.hp,phase:this.serial*1.7,kind:'fighter',ai,model};this.targets.push(t);return t;}
 select(p:T.Vector3,aim:T.Vector3){const candidates=this.allTargets.filter(t=>t.p.distanceTo(p)<25&&t.p.clone().sub(p).normalize().dot(aim)>.45).sort((a,b)=>b.p.clone().sub(p).normalize().dot(aim)-a.p.clone().sub(p).normalize().dot(aim));const i=candidates.findIndex(t=>t.id===this.lock);this.lock=candidates[(i+1)%candidates.length]?.id??null;this.lockTime=0;this.lockAnnounced=false;}
 fire(p:T.Vector3,v:T.Vector3,aim:T.Vector3,missile=false){if(!this.active||this.completed||(missile?this.missileCooldown>0:this.gunCooldown>0)||this.shots.length>=96)return false;
  if(missile){if(this.shots.filter(s=>s.missile).length>=10)return false;this.missileCooldown=.7;
   // Rail launch: the round drops clear of alternating pylons, then the motor lights.
   const right=new T.Vector3(1,0,0).applyQuaternion(this.attitude),down=new T.Vector3(0,-1,0).applyQuaternion(this.attitude),air=airVelocity(p),relative=v.clone().sub(air),speed=Math.max(0,relative.dot(aim));this.rail=-this.rail;
   const extra=relative.addScaledVector(aim,-speed).addScaledVector(down,.009);
   this.shots.push({p:p.clone().addScaledVector(right,.0046*this.rail).addScaledVector(down,.0022),v:air.addScaledVector(aim,speed).add(extra),life:9,missile,target:this.lockTime>=.85?this.lock:null,age:0,dir:aim.clone(),speed,extra});
  }else{this.gunCooldown=.04;
   // About two milliradians of dispersion: a cone of fire, not a laser.
   const jitter=()=>{this.scatter=(Math.imul(this.scatter,1664525)+1013904223)>>>0;return this.scatter/4294967296-.5;},d=aim.clone().add(new T.Vector3(jitter(),jitter(),jitter()).multiplyScalar(.0045)).normalize();
   this.shots.push({p:p.clone().addScaledVector(aim,.02),v:v.clone().addScaledVector(d,2.3),life:1.8,missile,target:null,age:0});}
  this.fired++;this.event?.(missile?'missile':'gun');return true;
 }
 advance(dt:number,p:T.Vector3,q:T.Quaternion,v:T.Vector3,aim:T.Vector3,gun=false,missile=false){
  if(!this.active||dt<=0||this.completed)return;
  let left=Math.min(dt,this.persistent?60:1);this.sweep=this.shots.length>0||gun||missile;const endpoints=this.sweep?this.external.map(t=>({target:t,p:t.p.clone()})):[];
  // Orbital positions supplied by the host are at the end of this frame. Sweep them
  // through the same substeps as projectiles, then restore the authoritative positions.
  for(const {target}of endpoints)target.p.addScaledVector(target.v,-left);
  while(left>1e-7){const h=Math.min(this.persistent?.05:.02,left);left-=h;this.tick(h,p,q,v,aim,gun,missile);}
  for(const {target,p:end}of endpoints)target.p.copy(end);
 }
 /** True while the player has rounds in the air; only then do the hundreds of external targets need sweeping and testing. */
 private sweep=false;
 /** The player flew into the ground: the sortie ends the same way as being shot down. */
 threats():Threats{const locks=this.targets.filter(t=>(t.lockOn??0)>.3).map(t=>({p:t.p,name:t.model?AIRCRAFT[t.model].name:'HOSTILE',ground:false}));
  return {locks,missiles:this.incoming.filter(s=>s.weapon==='missile'&&s.life>0)};}
 crash(){if(!this.active||this.completed)return;this.health=0;this.down=this.completed=true;this.best=Math.max(this.best,this.score);this.shots=[];this.incoming=[];this.lock=null;}
 /** Fixed forward guns for scouts and fighters, a slow turret for the heavy. Bursts, then a pause. */
 private enemyFire(t:Drone,dt:number,p:T.Vector3,v:T.Vector3){
  const a=t.ai!;if(!this.allowEngage)return;const load=LOADOUTS[t.model??'f16']??LOADOUTS.f16;t.ordnance=Math.max(0,(t.ordnance??6)-dt);t.gun=Math.max(0,(t.gun??1.5+this.random()*2)-dt);
  if(this.waveBanner>0||a.mode==='evade'||a.mode==='extend'||t.model==='jumbo')return;
  const heavy=t.kind==='heavy',muzzle=load.speed,toPlayer=p.clone().sub(t.p),distance=toPlayer.length();
  // Seekers must hold the target for 1.5 s before launch: that dwell is what the warning receiver hears as a lock.
  const tracking=load.weapon==='missile'&&distance<load.range*1.25&&a.dir.dot(toPlayer.clone().normalize())>.85;t.lockOn=tracking?(t.lockOn??0)+dt:0;
  if(load.weapon!=='gun'&&distance<load.range&&distance>.35&&a.dir.dot(toPlayer.clone().normalize())>.88&&t.ordnance===0&&(load.weapon!=='missile'||(t.lockOn??0)>1.5)){
   const direction=toPlayer.clone().addScaledVector(v.clone().sub(t.v),Math.min(2,distance/load.speed)).normalize();
   this.incoming.push({p:t.p.clone().addScaledVector(direction,.04),v:t.v.clone().addScaledVector(direction,load.speed),age:0,life:Math.min(12,load.range/load.speed+2),weapon:load.weapon,damage:load.damage,turn:load.turn,owner:t.id});t.ordnance=load.interval+this.random()*3;this.event?.('enemyGun',t.p);
  }
  if(distance>(heavy?2.6:1.7)||distance<.08)return;
  const aim=toPlayer.addScaledVector(v.clone().sub(t.v),distance/muzzle).normalize();
  if(!heavy&&a.dir.dot(aim)<.93||t.gun>0)return;
  if(!t.burst)t.burst=heavy?3:5;
  t.burst--;t.gun=t.burst?(heavy?.22:.09):load.interval+this.random()*1.6;
  const spread=heavy?.06:.044,d=aim.add(new T.Vector3(this.random()-.5,this.random()-.5,this.random()-.5).multiplyScalar(spread)).normalize();
  this.incoming.push({p:t.p.clone().addScaledVector(d,.03),v:t.v.clone().addScaledVector(d,load.weapon==='gun'?muzzle:1.4),life:2.2,age:0,weapon:'gun',damage:load.weapon==='gun'?load.damage:2});this.event?.('enemyGun',t.p);
 }
 private tick(dt:number,p:T.Vector3,q:T.Quaternion,v:T.Vector3,aim:T.Vector3,gun:boolean,missile:boolean){
  this.attitude.copy(q);this.ticks++;
  this.hitFlash=Math.max(0,this.hitFlash-dt*4);this.waveBanner=Math.max(0,this.waveBanner-dt);
  this.comboClock=Math.max(0,this.comboClock-dt);if(!this.comboClock)this.combo=0;
  if(!this.persistent)this.remaining=Math.max(0,this.remaining-dt);if(!this.remaining&&!this.persistent){this.completed=true;this.best=Math.max(this.best,this.score);this.shots=[];this.lock=null;return;}
  this.gunCooldown=Math.max(0,this.gunCooldown-dt);this.missileCooldown=Math.max(0,this.missileCooldown-dt);
  const target=this.lock===null?undefined:this.targets.find(t=>t.id===this.lock)??this.external.find(t=>t.id===this.lock&&t.hp>0);
  if(target&&target.p.distanceTo(p)<25&&target.p.clone().sub(p).normalize().dot(aim)>.8){this.lockTime=Math.min(1,this.lockTime+dt);if(this.lockTime>=.85&&!this.lockAnnounced){this.lockAnnounced=true;this.event?.('lock');}}
  else{this.lockTime=0;this.lockAnnounced=false;if(!target)this.lock=null;}
  if(gun)this.fire(p,v,aim);if(missile)this.fire(p,v,aim,true);
  const collisionTargets=this.sweep?this.allTargets:this.targets,oldTargets=this.shots.length?new Map(collisionTargets.map(t=>[t.id,t.p.clone()])):NO_TARGETS;
  for(const t of this.targets){
   t.hit=Math.max(0,(t.hit??0)-dt*5);
   if(t.ai){
    const inbound=this.shots.find(s=>s.missile&&s.target===t.id&&s.p.distanceTo(t.p)<3.2),distance=t.p.distanceTo(p);
    const nearMiss=this.shots.some(s=>!s.missile&&s.p.distanceToSquared(t.p)<.03);
    let opponent={p,v,aim};
    if(t.patrol){const stationRadius=t.patrol.length();t.patrol.addScaledVector(airVelocity(t.patrol),dt).setLength(stationRadius);
     if(!this.allowEngage||distance>7){const up=t.patrol.clone().normalize(),east=new T.Vector3(0,1,0).cross(up).normalize(),north=up.clone().cross(east),angle=t.ai.clock*.025+t.phase;
      const station=t.patrol.clone().addScaledVector(east,Math.cos(angle)*3).addScaledVector(north,Math.sin(angle)*3);opponent={p:station,v:airVelocity(station).addScaledVector(east,-Math.sin(angle)*.22).addScaledVector(north,Math.cos(angle)*.22),aim:east};}
    }
    t.v.copy(flyPilot(t.ai,t.p,dt,opponent,{locked:this.lock===t.id&&this.lockTime>.25,missile:inbound?inbound.p:null,gunsight:nearMiss||distance<3.5&&t.p.clone().sub(p).normalize().dot(aim)>.993},this.ground,this.random));
   }
   t.p.addScaledVector(t.v,dt);
   if(t.ai)this.enemyFire(t,dt,p,v);
   if(t.ai){const floor=this.ground(t.p)+.03;if(t.p.length()<floor)t.p.setLength(floor);}
  }
  if(this.sweep)for(const t of this.external)t.p.addScaledVector(t.v,dt);
  for(const s of this.shots){const old=s.p.clone();s.age+=dt;s.life-=dt;
   const goal=s.missile?collisionTargets.find(t=>t.id===s.target&&t.hp>0):undefined;
   if(s.missile&&s.dir&&s.extra){
    // Drop, boost, coast. Steering is turn-rate limited toward the predicted intercept point.
    if(s.age>MISSILE.drop){s.extra.multiplyScalar(Math.exp(-dt*4));s.speed=s.age<MISSILE.burn?s.speed!+MISSILE.thrust*dt:s.speed!*Math.exp(-dt*MISSILE.drag);
     if(goal){const relative=goal.p.clone().sub(s.p),distance=relative.length(),targetAir=goal.v.clone().sub(airVelocity(goal.p)),closing=Math.max(.25,s.speed!-targetAir.dot(relative)/Math.max(1e-6,distance)),want=relative.addScaledVector(targetAir,Math.min(4,distance/closing)).normalize(),angle=s.dir.angleTo(want),rate=T.MathUtils.clamp(.4/Math.max(.05,s.speed!),.45,2.5);
      if(angle>1e-5){const axis=s.dir.clone().cross(want);if(axis.lengthSq()>1e-12)s.dir.applyAxisAngle(axis.normalize(),Math.min(angle,rate*dt)).normalize();}}}
    s.v.copy(airVelocity(s.p)).addScaledVector(s.dir,s.speed!).add(s.extra);}
   s.p.addScaledVector(s.v,dt);
   // Clip at the first terrain crossing, then test vehicles on that visible segment.
   const groundHit=s.p.length()<this.ground(s.p);
   if(groundHit){let lo=0,hi=1;for(let i=0;i<8;i++){const mid=(lo+hi)/2,point=old.clone().lerp(s.p,mid);if(point.length()<this.ground(point))hi=mid;else lo=mid;}s.p.copy(old.clone().lerp(s.p,(lo+hi)/2));}
   if(s.missile&&s.life<=0&&!s.spent){s.spent=true;this.bursts.push({p:s.p.clone(),life:.65,v:s.v.clone()});}
   const swept=s.p.distanceTo(old);
   for(const t of collisionTargets){if(t.hp<=0)continue;const oldTarget=oldTargets.get(t.id)!,kind=t.external?{radius:t.radius??.02,score:t.score??250}:t.model?AIRCRAFT[t.model]:KINDS[t.kind??'fighter'];
    const extra=s.missile?(t.quietTarget?.003:.04):0,bound=swept+kind.radius+extra+t.p.distanceTo(oldTarget);if(t.p.distanceToSquared(s.p)>bound*bound)continue;
    const relativeOld=old.clone().sub(oldTarget),relativeNew=s.p.clone().sub(t.p);
    if(t.collisionBox?segmentBox(relativeOld,relativeNew,t.collisionBox,extra):closestSegment(relativeOld,relativeNew,ORIGIN)<kind.radius+extra){
    t.hp-=s.missile?3:1;t.hit=1;s.life=-1;s.spent=true;this.hits++;this.hitFlash=1;this.event?.('hit',s.p);this.bursts.push({p:s.p.clone(),life:.65,v:t.v.clone(),scale:t.quietTarget?.12:1});
    if(s.missile)this.blast?.(t.p.clone());
    if(t.hp<=0){t.destroy?.();if(kind.score>0)this.combo++;this.comboClock=4;this.kills++;const gain=kind.score*Math.min(5,this.combo);this.score+=gain;this.bursts.push({p:t.p.clone(),life:1.2,big:true,v:t.v.clone(),scale:t.quietTarget?Math.max(.04,Math.min(.12,(t.radius??.003)*7)):1});this.popups.push({p:t.p.clone(),text:kind.score>0?`+${gain}${this.combo>1?` ×${Math.min(5,this.combo)}`:''}`:'DESTROYED',life:1.6});this.event?.('kill',t.p);}
    break;
   }}
   if(groundHit&&!s.spent){s.life=-1;s.spent=true;this.bursts.push(s.missile?{p:s.p.clone(),life:.65,v:airVelocity(s.p)}:{p:s.p.clone(),life:.5,v:airVelocity(s.p),dust:true});if(s.missile)this.blast?.(s.p.clone());}
  }
  this.hurt=Math.max(0,this.hurt-dt*2.2);this.quiet+=dt;if(this.quiet>4)this.health=Math.min(100,this.health+8*dt);
  for(const s of this.incoming){const old=s.p.clone().sub(p);s.age+=dt;s.life-=dt;
   if(s.weapon==='missile'&&s.turn){const air=airVelocity(s.p),relative=s.v.clone().sub(air),speed=s.accel?Math.min(s.maxSpeed??2,relative.length()+s.accel*dt):relative.length(),dir=relative.normalize(),want=p.clone().sub(s.p).normalize(),angle=dir.angleTo(want),axis=dir.clone().cross(want);if(axis.lengthSq()>1e-12)dir.applyAxisAngle(axis.normalize(),Math.min(angle,s.turn*dt));s.v.copy(air).addScaledVector(dir,speed);}
   s.p.addScaledVector(s.v,dt);if(s.p.length()<this.ground(s.p)){s.life=-1;continue;}
   // Tested in the player's frame so a fast ship cannot outrun the check between frames.
   if(closestSegment(old,old.clone().addScaledVector(s.v.clone().sub(v),dt),ORIGIN)<.028){s.life=-1;this.health=Math.max(0,this.health-(s.damage??4));this.hurt=1;this.quiet=0;this.taken++;this.hurtFrom.copy(s.v).sub(v).normalize().negate();this.event?.('damage',s.p);}
  }
  this.incoming=this.incoming.filter(s=>s.life>0).slice(-64);
  if(this.health<=0){this.down=this.completed=true;this.best=Math.max(this.best,this.score);this.shots=[];this.incoming=[];this.lock=null;this.bursts.push({p:p.clone(),life:1.2,big:true,v:v.clone()});this.event?.('down',p);return;}
  this.shots=this.shots.filter(s=>s.life>0);this.targets=this.targets.filter(t=>t.hp>0&&(this.persistent||t.p.distanceTo(p)<(t.model?40:60)));
  for(const b of this.bursts){b.life-=dt;if(b.v)b.p.addScaledVector(b.v,dt);}this.bursts=this.bursts.filter(b=>b.life>0).slice(-32);
  for(const u of this.popups)u.life-=dt;this.popups=this.popups.filter(u=>u.life>0).slice(-8);
  this.replenish+=dt;if(this.persistent&&this.replenish>30&&this.targets.length<this.patrolCount){this.replenish=0;const base=this.targets.find(t=>t.patrol)?.patrol??p;this.spawn(base,q,v);}
  if(!this.targets.length&&!this.persistent){this.wave++;this.remaining=Math.min(120,this.remaining+15);this.waveBanner=2.5;this.spawn(p,q,v);this.lock=null;this.lockTime=0;this.event?.('wave');}
 }
}

/** Swept segment against a moving vehicle's oriented body box. Coordinates are relative to its centre. */
export function segmentBox(a:T.Vector3,b:T.Vector3,box:NonNullable<Drone['collisionBox']>,padding=0){let lo=0,hi=1;const d=b.clone().sub(a);for(const [axis,half]of[[box.right,box.half.x],[box.up,box.half.y],[box.forward,box.half.z]] as const){const p=a.dot(axis),v=d.dot(axis),h=half+padding;if(Math.abs(v)<1e-12){if(Math.abs(p)>h)return false;continue;}let l=(-h-p)/v,r=(h-p)/v;if(l>r)[l,r]=[r,l];lo=Math.max(lo,l);hi=Math.min(hi,r);if(lo>hi)return false;}return true;}
