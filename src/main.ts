import {PostFX} from './post';
import {Trails} from './trails';
import {createStars,createMilkyWay,loadNightLights,nightUniforms,nightGLSL} from './space';
import {Supercruise} from './supercruise';
import {SatelliteImagery,satelliteGLSL,satelliteUniforms,updateSatelliteUniforms,webTileDefaultGLSL,webTileLocalGLSL} from './satellite';
import {Combat,LOADOUTS} from './combat';
import {AIRCRAFT} from './aircraft-models';
import {AirTraffic,AIRLINERS} from './air-traffic';
import {TrafficView} from './traffic-view';
import {SurfaceTraffic} from './surface-traffic';
import {OrbitalTraffic} from './orbital-traffic';
import {Radar} from './radar';
import {lineOfSight,type RadarContact} from './contacts';
import {CombatView} from './combat-view';
import {WORLD_DESTINATIONS} from './world-destinations';
import {BLACKBIRD} from "./blackbird";
import {WorldTour,lapPlan,freeFlightRate,TIME_RATES} from "./circumnavigation";
import {tourFlight} from "./tour-flight";
import {FlightMap,trueHeading} from "./navigation";
import { PilotInput, SonicFeedback, gameThrottle, torchThrottleLimit, flightCues, type ControlStyle } from "./pilot";
import { FlightEffects } from "./flight-effects";
import { CrashFx } from "./crash";
import { Nuke, NUKE } from "./nuke";
import { Perf } from "./perf";
import { Fleets, FLEET } from "./fleet";
import { Raid, RAID } from "./raid";
import { City } from "./city";
import { BoomFx } from "./boom";
import { WorldDetail } from "./world-detail";
import { Ships } from "./ships";
import { GroundOverlay, overlayGLSL } from "./ground-overlay";
import { Bridges } from "./bridges";
import { WaterSurface } from "./water";
import { makeDraggable } from "./draggable";
import { arrangeHud } from "./hud-layout";
import { JetWash } from "./wash";
import { SamSites, SAM } from "./sam";
import { Rwr } from "./rwr";
import { MISSIONS, MissionRun } from "./missions";
import { groundFrame, settleOnSurface, surfaceAttitude, contactGaps, LANDING } from "./contact";
import { airAppearance, environmentAt, trajectory, KARMAN_LINE } from "./environment";
import { Scenery } from "./scenery";
import { Imagery } from "./imagery";
import { parseFlight, validateStart } from "./session";
import { Terrain, terrainRecenterKm } from "./terrain";
import { TerrainBuilder } from "./terrain-builder";
import { terrainOpacity } from "./terrain-coverage";
import { SUMMITS, summitApproach, type Summit } from './summits';
import { readAltimetry, type Altimetry } from './altimetry';
import {ALL_PEAKS,CASPIAN} from './destinations';
import {GeoIndex} from './geodata';
import {findTerrainCrest,type TerrainCrest} from './terrain-crest';
import { atmosphereAt } from "./air";
import { FlightSound } from "./sound";
import { Instruments } from "./instruments";
import { earthFixedSun, solarPosition, moonPosition, siderealAngle } from "./sky";
import * as T from "three";
import { EARTH, type EarthState } from "./earth";
import {
  EarthSurface,
  latLonToDir,
  dirToLatLon,
  inertialToBody,
  bodyToInertial,
} from "./geo";
import {
  advanceFlight,
  FlightControl,
  descentAssist,
  entryAttitude,
  atmosphereVelocity,
  atmosphereDensity,
  VEHICLE, aircraftProfile,setAircraftProfile,
  type FlightTelemetry,
} from "./flight";
import { createSpaceplane } from "./spaceplane";
import { atmosphere } from "./atmosphere";
import { add, mul, len, type V } from "./vector";
const $ = (id: string) => document.getElementById(id)!;
const select = (id: string) => $(id) as HTMLSelectElement;
const input = (id: string) => $(id) as HTMLInputElement;
const state: EarthState & { tele?: FlightTelemetry } = {
  p: [9000, 0, 0],
  v: [0, 0, 0],
  t: 0,
  fuel: 100,
  status: "flying",
  body: "",
  heat: 0,
};
const rotation = new T.Quaternion(),
  control = new FlightControl(),
  surface = new Terrain(),
  keys = new Set<string>();
let throttle = 0,
  torch = false,
  gear = false,
  assist = false,
  entry = false,
  paused = false,
  ready = false,
  timeRate = 1,
  cameraMode = "chase",
  yaw = 0,
  orbitPitch = 0.18,
  zoom = 1,
  drag = false,
  lastX = 0,
  lastY = 0,
  patchAnchor = new T.Vector3(),
  patchReady = false,
  frames = 0,
  frameTime = 0;
const supercruise=new Supercruise(),satellite=new SatelliteImagery(),wideImagery=new SatelliteImagery(),combat=new Combat(),combatView=new CombatView(combat);
const airTraffic=new AirTraffic(),trafficView=new TrafficView(airTraffic),orbitTraffic=new OrbitalTraffic(),radar=new Radar(orbitTraffic);
let lastTrafficTime=0;const orbitalLabel=document.createElement('div');orbitalLabel.id='orbital-label';document.body.append(orbitalLabel);
wideImagery.fixedZoom=9;satellite.boost=1;
/** Close-range imagery: a small sharp patch under the aircraft (about 0.4 m per pixel in the UK) for low flying and landing. */
const nearImagery=new SatelliteImagery();nearImagery.boost=1;nearImagery.fixedZoom=17;
let weaponAim=new T.Vector3(0,0,-1),gunHeld=false,missileHeld=false,aimPointer:{x:number;y:number}|null=null;
const pilotInput = new PilotInput(), sonic = new SonicFeedback();
const mouseAim = { active: false, x: 0, y: 0, originX: 0, originY: 0 };
let controlStyle: ControlStyle = 'game', motionEffects = !matchMedia('(prefers-reduced-motion: reduce)').matches;
let enginePower=0,boostPower=0;
let onGround = false;
let deliveredThrottle = 0, airbrake = 0, lastEffectsTime = 0, boostActive = false;
try {
  const savedStyle = localStorage.getItem('earth-fly-controls');
  if (savedStyle === 'game' || savedStyle === 'mouse' || savedStyle === 'direct') controlStyle = savedStyle;
  const motion = localStorage.getItem('earth-fly-motion'); if (motion !== null) motionEffects = motion === 'true';
} catch {}
function clearPilot() { gunHeld=missileHeld=false;aimPointer=null; keys.clear(); pilotInput.reset(); mouseAim.active = false; mouseAim.x = mouseAim.y = 0; drag = false; }
const audio = new FlightSound(),
  instruments = new Instruments(),
  imagery = new Imagery();
let imageryRevision = -1,
  terrainRevision = -1,
  terrainClock = 0,
  streamClock = 0,
  cameraSet = false,
  solarOffset = 0,
  epoch = middayEpoch();
/** Today's date (keeps the satellite catalogue current) at London midday, so every new flight starts in daylight. */
function middayEpoch() { const d = new Date(); d.setUTCHours(12, 15, 0, 0); return d; }
let tour:WorldTour|null=null,effectiveRate=1,tourReturnPaused=false,tourLaunching=false;
const chaseRotation = new T.Quaternion();
const errors: string[] = [];
let worldPlace="";
let activeSummit: Summit | null = null, activeCaspian=false,destinationEpoch = 0;
let activeCrest:TerrainCrest|null=null,crestApproach=false;
let altimetry:Altimetry|null=null;
const summitBeacon = document.createElement('div');
summitBeacon.id='summit-beacon';summitBeacon.hidden=true;document.body.append(summitBeacon);
window.addEventListener("error", (e) => errors.push(e.message));
window.addEventListener("unhandledrejection", (e) =>
  errors.push(String(e.reason)),
);
// The scene renders into post.ts's own 4x MSAA target, so a multisampled canvas would only add a second resolve.
/** Resolution ceiling and floor for adaptive rendering. Retina at 2x costs 4x the pixels of 1x for a small gain. */
const MAX_PIXEL_RATIO = 1.5, MIN_PIXEL_RATIO = 0.8;
const renderer = new T.WebGLRenderer({
  antialias: false,
  logarithmicDepthBuffer: true,
  powerPreference: "high-performance",
});
// Checking link status after every compile forces the driver to finish it at once; keep the check for development.
renderer.debug.checkShaderErrors = import.meta.env.DEV;
renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
  errors.push(
    String(gl.getProgramInfoLog(program)) +
      String(gl.getShaderInfoLog(vertex)) +
      String(gl.getShaderInfoLog(fragment)),
  );
};
renderer.setPixelRatio(Math.min(devicePixelRatio, MAX_PIXEL_RATIO));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
renderer.autoClear = false;
const weatherMap={value:null as T.Texture|null},elevationMap={value:null as T.Texture|null};
const post=new PostFX(renderer,weatherMap,elevationMap);
let pendingRatio=0,uiClock=1,radarContacts:RadarContact[]=[];
renderer.info.autoReset=false;
const perf=new Perf(renderer.getContext() as WebGL2RenderingContext,()=>({calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,ratio:renderer.getPixelRatio(),width:renderer.domElement.width,height:renderer.domElement.height}));
const fx={settle:0,exposure:1.25,flash:0,shake:0,slow:0,lockClock:0,shellTop:6,shellClock:9,quality:1};
$("world").append(renderer.domElement);renderer.domElement.tabIndex=0;renderer.domElement.setAttribute("aria-label","Flight view. W/S pitch, A/D bank, Shift boost, Y superspeed, Z gun, X missile, C target lock, N nuclear bomb.");
const scene = new T.Scene(),
  shipScene = new T.Scene(),
  camera = new T.PerspectiveCamera(
    55,
    innerWidth / innerHeight,
    0.0005,
    1000000,
  );
const globe = new T.Group();
scene.add(globe);
const lightDir = new T.Vector3(1, 0.6, -0.2).normalize();
const sun = new T.DirectionalLight(0xfff6e9, 3.2);
const globeAmbient = new T.AmbientLight(0x9bb5ce, 0.12);
scene.add(sun, globeAmbient);
const shipSun = new T.DirectionalLight(0xfff7ed, 3.5),
  shipSky = new T.HemisphereLight(0xc4e5fa, 0x14202b, 1.8);
shipScene.add(shipSun, shipSky, new T.AmbientLight(0xb7cfeb, 0.2));
const ship = createSpaceplane();
ship.scale.setScalar(0.001);
shipScene.add(ship);
shipScene.add(combatView.group,trafficView.group,orbitTraffic.group);
const trails=new Trails(ship);shipScene.add(trails.group);
const crashFx=new CrashFx();shipScene.add(crashFx.group);let wrecked=false;
const boomFx=new BoomFx();shipScene.add(boomFx.group);
const vec=(v:T.Vector3)=>v.toArray() as V;
const nuke=new Nuke((p,t)=>surface.radiusM(inertialToBody(vec(p),t,EARTH.rotation))/1000,p=>new T.Vector3(...atmosphereVelocity(vec(p))),atmosphereDensity,
  (b,t)=>new T.Vector3(...bodyToInertial(vec(b),t,EARTH.rotation)),(p,t)=>new T.Vector3(...inertialToBody(vec(p),t,EARTH.rotation)));
shipScene.add(nuke.group);let nukeFlash=0,craterAt=-1,nukeNote='',nukeNoteUntil=0;
function dropNuke(){
  if(paused||!ready||state.status!=='flying')return;
  const say=(text:string)=>{nukeNote=text;nukeNoteUntil=performance.now()+2500;};
  if(!nuke.armed){say('☢ ONE IN THE AIR ALREADY');return;}
  if((len(state.p)-EARTH.radius)*1000>60000){say('☢ TOO HIGH TO RELEASE');return;}
  const p=new T.Vector3(...state.p);nuke.drop(p,new T.Vector3(...state.v),p.clone().normalize().negate(),state.t);audio.weaponCue('missile');
}
/** Half a second into the white-out the ground is already gone: dig the crater and mark what fell around it. */
function digCrater(){
  const b=nuke.blast;craterAt=-1;if(!b)return;
  const loc=dirToLatLon(vec(b.body)),c=NUKE.crater,dry=!b.water;
  surface.craters=[...(surface.craters??[]).slice(-5),{lat:loc.lat,lon:loc.lon,radius:c.radius,depth:dry?c.depth:0,rim:dry?c.rim:0,blast:NUKE.blast*1000}];
  surface.revision++;surface.generation++;b.cratered=true;
}
/** What the bomb does to the aircraft this frame: light, heat, the blast wave, and the cloud itself. */
function feelNuke(worldDt:number,shipP:T.Vector3){
  const ev=nuke.update(worldDt,state.t,shipP,new T.Vector3(...state.v)),flying=state.status==='flying';nukeFlash=ev.flash;
  if(ev.detonated&&nuke.blast){const loc=dirToLatLon(vec(nuke.blast.body));nuke.blast.sea=isOceanAt(loc.lat,loc.lon);nuke.blast.water=nuke.blast.sea||surface.waterLevel?.(loc.lat,loc.lon)!=null;craterAt=state.t+.5;fx.shake=Math.max(fx.shake,.6);
    // Anything afloat inside the blast ring goes down with it.
    if(fleets.nuked(new T.Vector3(...bodyToInertial(vec(nuke.blast.body),state.t,EARTH.rotation)),NUKE.blast))surface.decks=fleets.decks();}
  if(craterAt>=0&&state.t>=craterAt)digCrater();
  // Real road and rail traffic is wrecked as the front sweeps over it.
  {const age=nuke.age(state.t);if(nuke.blast&&age>=0&&age<16)surfaceTraffic.view.blast(new T.Vector3(...bodyToInertial(vec(nuke.blast.body),state.t,EARTH.rotation)),Math.min(NUKE.blast,.34*age+1.1*(1-Math.exp(-age/2.5))));}
  let damage=state.structuralDamage??0;
  if(ev.shockHit>0){
    const s=ev.shockHit;audio.nukeCue(s);fx.shake=Math.max(fx.shake,Math.min(4,s*2));sonic.pulse=1;
    if(flying&&nuke.blast){
      // The front shoves the aircraft away from ground zero and rolls it; close in, it breaks it.
      const away=shipP.clone().sub(new T.Vector3(...bodyToInertial(vec(nuke.blast.body),state.t,EARTH.rotation))).normalize(),kick=Math.min(.25,.03*s);
      state.v=[state.v[0]+away.x*kick,state.v[1]+away.y*kick,state.v[2]+away.z*kick];
      rotation.multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(Math.random()-.5,Math.random()*.3,Math.random()-.5).normalize(),Math.min(1.2,.22*s)));
      damage+=.22*s;
    }
  }
  if(flying&&!paused){damage+=ev.burn*worldDt*.45;if(ev.buffet)fx.shake=Math.max(fx.shake,1.6);}
  if(flying&&damage!==(state.structuralDamage??0))state.structuralDamage=Math.min(1,damage);
  if(flying&&(ev.kill||(damage>=1&&(ev.shockHit>0||ev.burn>0)))){supercruise.stop();state.status='impact';state.body=ev.kill||'Airframe destroyed by the blast';missions.fail('destroyed by the blast');}
  nuke.draw(shipP,camera,state.t,postFrame);
  const el=$('nuke-status') as HTMLElement,clock=(s:number)=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;let text='',danger=false;
  if(nuke.bomb){const d=nuke.impact.distanceTo(shipP);danger=d<8;text=`☢ IMPACT ${clock(nuke.eta)} · ${d.toFixed(1)} km${danger?' · GET CLEAR':''}`;}
  else{const eta=nuke.shockEta(state.t,shipP);if(eta>=0&&eta<600){danger=eta<12;text=`☢ SHOCKWAVE IN ${clock(eta)}`;}}
  if(!text&&performance.now()<nukeNoteUntil)text=nukeNote;
  el.hidden=!text||document.body.classList.contains('clean');if(el.textContent!==text)el.textContent=text;el.classList.toggle('danger',danger);
  $('drop-nuke').classList.toggle('spent',!nuke.armed);
}
(window as unknown as {earthNuke:unknown}).earthNuke={nuke,drop:dropNuke,get fleets(){return fleets;},get raid(){return raid;},get ops(){return ops;}};
/** Mach 1 crossing: vapour cone, shock disc, a double thump and a jolt. */
function sonicBoom(){const air=new T.Vector3(...state.v).sub(new T.Vector3(...atmosphereVelocity(state.p)));if(air.lengthSq()<1e-10)return;boomFx.trigger(air.normalize());audio.sonicCue();setTimeout(()=>audio.sonicCue(),140);fx.shake=Math.max(fx.shake,1.1);fx.flash=Math.max(fx.flash,.12);}
/** External camera variants; all of them keep cameraMode 'chase' so flight feedback behaves the same. */
type View='chase'|'close'|'cockpit'|'wing'|'top'|'nose'|'flyby'|'planet';
const VIEWS:{id:View;label:string}[]=[{id:'chase',label:'Chase'},{id:'close',label:'Close'},{id:'cockpit',label:'Cockpit'},{id:'wing',label:'Wing'},{id:'top',label:'Top'},{id:'nose',label:'Nose'},{id:'flyby',label:'Flyby'},{id:'planet',label:'Planet'}];
let cameraView:View='chase';const flybyPoint=new T.Vector3();let flybyUntil=-1,flybyClock=0;
function setView(view:View){cameraView=view;cameraMode=view==='cockpit'||view==='planet'?view:'chase';yaw=orbitPitch=0;zoom=1;flybyUntil=-1;const pick=$('camera') as HTMLSelectElement|null;if(pick)pick.value=view;
 document.querySelectorAll<HTMLButtonElement>('#view-bar button').forEach(b=>b.classList.toggle('on',b.dataset.view===view));document.body.dataset.view=view;}
/** Puts the aircraft back in the air 1.5 km above the wreck, on the same heading. */
function respawn(){const loc=dirToLatLon(inertialToBody(state.p,state.t,EARTH.rotation)),north=new T.Vector3(0,1,0),u=new T.Vector3(...state.p).normalize(),f=new T.Vector3(0,0,-1).applyQuaternion(rotation),e=north.clone().cross(u).normalize(),n=u.clone().cross(e);const heading=(Math.atan2(f.dot(e),f.dot(n))*180/Math.PI+360)%360;
 input('start-lat').value=loc.lat.toFixed(5);input('start-lon').value=loc.lon.toFixed(5);input('start-alt').value='1500';input('start-heading').value=heading.toFixed(0);input('start-speed').value='220';select('start-mode').value='flight';
 void ($('start-form') as HTMLFormElement).onsubmit?.(new SubmitEvent('submit',{cancelable:true}));paused=false;}
$('crash-respawn').onclick=()=>respawn();
/** Environment Agency LIDAR bare earth for the Heathrow to Docklands corridor (bundled, about 5 m). */
async function loadLondonDem(){
 try{const meta=await(await fetch('terrain/london-dtm.json')).json(),r=await fetch('terrain/london-dtm.bin.gz');if(!r.ok)return;
  // Some servers send .gz with Content-Encoding and the browser has already unzipped it: check the magic bytes.
  let bytes=await r.arrayBuffer();const head=new Uint8Array(bytes,0,2);if(head[0]===0x1f&&head[1]===0x8b)bytes=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const raw=new Int16Array(bytes);if(raw.length!==meta.cols*meta.rows)return;
  // Rows are delta-coded; a few construction pits read below -5 m and are clamped.
  for(let y=0;y<meta.rows;y++){let h=0;for(let x=0;x<meta.cols;x++){const k=y*meta.cols+x;h+=raw[k];raw[k]=Math.max(-50,h);}}
  surface.dem={...meta.bounds,cols:meta.cols,rows:meta.rows,data:raw,feather:.012};surface.revision++;surface.generation++;
 }catch{/* optional data: the global elevation remains */}
}
/** Harmless entry glow for the travel drive: the same heat-flux law as free flight, shown but never applied as damage. */
function entryGlow(){if(!supercruise.active)return 0;const h=(len(state.p)-EARTH.radius)*1000,flux=Math.sqrt(atmosphereDensity(h)/.02)*(supercruise.speed/1000)**3*.12;return T.MathUtils.clamp((flux-1.4)/5,0,1.4);}

const flightEffects = new FlightEffects();
shipScene.add(flightEffects.group);
const atmospherePass = atmosphere();
const loader = new T.TextureLoader();
const load = (p: string) => loader.loadAsync(p);
const seaNear={value:0};
const earthMaterial = new T.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.9,
});
const earthMesh = new T.Mesh(
  new T.SphereGeometry(EARTH.radius, 512, 256),
  earthMaterial,
);
globe.add(earthMesh);
earthMaterial.onBeforeCompile=shader=>{shader.uniforms.oceanMask=oceanMask;shader.uniforms.groundHaze={value:groundHaze};shader.uniforms.seaNear=seaNear;Object.assign(shader.uniforms,nightUniforms,satelliteUniforms(satellite),satelliteUniforms(wideImagery,"context"));earthMaterial.userData.shader=shader;shader.fragmentShader='uniform sampler2D oceanMask;uniform vec3 groundHaze;uniform float seaNear;\n'+webTileDefaultGLSL+nightGLSL+satelliteGLSL.replaceAll('Satellite','Context').replaceAll('satellite','context')+satelliteGLSL+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
#ifdef USE_MAP
diffuseColor.rgb=blendSatellite(blendContext(diffuseColor.rgb,vec2((vMapUv.x-.5)*360.,(vMapUv.y-.5)*180.)),vec2((vMapUv.x-.5)*360.,(vMapUv.y-.5)*180.));
#endif`).replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
#if defined(USE_MAP) && NUM_DIR_LIGHTS > 0
totalEmissiveRadiance+=cityLights(vec2((vMapUv.x-.5)*360.,(vMapUv.y-.5)*180.),dot(normalize(vNormal),directionalLights[0].direction))*1.5;
#endif`).replace('#include <opaque_fragment>',`
#if defined(USE_MAP) && NUM_DIR_LIGHTS > 0
// Distant sea shares the local water model so the terrain patch edge does not show.
{float sea=smoothstep(.35,.65,texture2D(oceanMask,vMapUv).r)*seaNear*(1.-smoothstep(78.,84.,(vMapUv.y-.5)*180.));
 if(sea>0.){vec3 seaV=normalize(vViewPosition),seaL=directionalLights[0].direction,seaR=reflect(-seaV,normal);float seaLit=max(0.,dot(normal,seaL)),seaF=.02+.98*pow(1.-max(0.,dot(normal,seaV)),5.);
  vec3 seaSky=mix(groundHaze*1.55,groundHaze*vec3(.42,.68,1.3),pow(clamp(dot(seaR,normal),0.,1.),.55));
  float seaGlint=pow(max(0.,dot(seaR,seaL)),36.)*44.*.018*.22*smoothstep(0.,.1,dot(normal,seaL));
  outgoingLight=mix(outgoingLight,mix(vec3(.004,.038,.07)*(.1+.9*seaLit),seaSky,seaF*.9)+vec3(1.,.9,.72)*seaGlint*3.2,sea);}}
#endif
#include <opaque_fragment>`);};
const cloudMat = new T.MeshStandardMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.65,
  depthWrite: false,
  roughness: 1,
  side: T.DoubleSide,
});
const clouds = new T.Mesh(
  new T.SphereGeometry(EARTH.radius + 11, 256, 128),
  cloudMat,
);
globe.add(clouds);
const stars=createStars(),milkyWay=createMilkyWay();
scene.add(milkyWay,stars);
const sunBall = new T.Mesh(
  new T.SphereGeometry(1000, 24, 16),
  new T.MeshBasicMaterial({ color: new T.Color(1,.93,.8).multiplyScalar(60), toneMapped:false }),
);
scene.add(sunBall);
const moon = new T.Mesh(
  new T.SphereGeometry(1737.4, 64, 32),
  new T.MeshStandardMaterial({ color: 0xc0bbb0, roughness: 1 }),
);
scene.add(moon);
const marker = new T.Mesh(
  new T.SphereGeometry(35, 12, 8),
  new T.MeshBasicMaterial({ color: 0xa5ebc8 }),
);
scene.add(marker);
let earthPixels: Uint8ClampedArray | undefined,
  imageW = 0,
  imageH = 0;
function isOcean() { const loc = dirToLatLon(inertialToBody(state.p, state.t, EARTH.rotation)); return isOceanAt(loc.lat, loc.lon); }
function isOceanAt(lat: number, lon: number) {
  if (!earthPixels) return false;
  const loc = { lat, lon };
  if (scenery.index.at(loc.lat, loc.lon, "water")) return true;
  const x = Math.floor((((((loc.lon + 180) / 360) % 1) + 1) % 1) * imageW),
    y = Math.max(
      0,
      Math.min(imageH - 1, Math.floor(((90 - loc.lat) / 180) * imageH)),
    ),
    i = (y * imageW + x) * 4;
  return earthPixels[i] > 127;
}
// A local, finely tessellated spherical patch avoids the globe's large triangles at touchdown.
const patchGeo = new T.BufferGeometry();
const terrainMaterial = earthMaterial.clone();
terrainMaterial.vertexColors = true;
terrainMaterial.transparent = true;
const regionalImagery = { value: 0 };
const patch = new T.Mesh(patchGeo, terrainMaterial);
patch.frustumCulled = false;
const terrainScene = new T.Scene();
const terrainAmbient = new T.AmbientLight(0xaecadf, 0.35);
const groundHaze = new T.Color(.16, .28, .4);
let groundHazeDensity = 1;
const terrainBlend = { value: 1 };
const waterClock={value:0},waterLight={value:new T.Vector3(1,0,0)},caspianMask={value:null as T.CanvasTexture|null},absheronMask={value:null as T.CanvasTexture|null},londonMask={value:null as T.CanvasTexture|null},oceanMask={value:null as T.Texture|null};
function makeCaspianMask(features:import('./geodata').Feature[]){
 const canvas=document.createElement('canvas');canvas.width=canvas.height=2048;const c=canvas.getContext('2d')!;c.fillStyle='#000';c.fillRect(0,0,2048,2048);c.fillStyle='#fff';for(const f of features){c.beginPath();for(const ring of [f.ring,...f.holes??[]]){ring.forEach(([lon,lat],i)=>{const x=(lon-46)/10*2048,y=(48-lat)/13*2048;i?c.lineTo(x,y):c.moveTo(x,y);});c.closePath();}c.fill('evenodd');}const tex=new T.CanvasTexture(canvas);tex.minFilter=T.LinearFilter;caspianMask.value=tex;regionSources[0]=canvas;
 const close=document.createElement('canvas');close.width=close.height=2048;const ctx=close.getContext('2d')!;ctx.fillStyle='#000';ctx.fillRect(0,0,2048,2048);ctx.fillStyle='#fff';for(const f of features){ctx.beginPath();for(const ring of [f.ring,...f.holes??[]]){ring.forEach(([lon,lat],i)=>{const x=(lon-49.5)/1.2*2048,y=(40.7-lat)/.6*2048;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.closePath();}ctx.fill('evenodd');}absheronMask.value=new T.CanvasTexture(close);absheronMask.value.minFilter=T.LinearFilter;regionSources[1]=close;packRegionMasks();
}
/** Thames and Docklands mask over 0.17°W–0.01°E, 51.475°–51.535°N, about 6 m per texel. */
function makeLondonMask(features:import('./geodata').Feature[]){const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=1024;const c=canvas.getContext('2d')!;c.fillStyle='#000';c.fillRect(0,0,2048,1024);c.fillStyle='#fff';for(const f of features){c.beginPath();f.ring.forEach(([lon,lat],i)=>{const x=(lon+.17)/.18*2048,y=(51.535-lat)/.06*1024;i?c.lineTo(x,y):c.moveTo(x,y);});c.closePath();c.fill();}const tex=new T.CanvasTexture(canvas);tex.minFilter=T.LinearFilter;londonMask.value=tex;regionSources[2]=canvas;packRegionMasks();}
/**
 * The three regional water masks share one texture (Caspian in red, Absheron in green, Thames in blue):
 * the terrain shader is at the GPU's 16-texture limit.
 */
const regionSources:(HTMLCanvasElement|null)[]=[null,null,null],regionMask={value:null as T.CanvasTexture|null};
function packRegionMasks(){
 const out=document.createElement('canvas');out.width=out.height=2048;const c=out.getContext('2d')!;c.fillStyle='#000';c.fillRect(0,0,2048,2048);
 regionSources.forEach((source,i)=>{if(!source)return;const tint=document.createElement('canvas');tint.width=tint.height=2048;const t=tint.getContext('2d')!;t.drawImage(source,0,0,2048,2048);t.globalCompositeOperation='multiply';t.fillStyle=['#ff0000','#00ff00','#0000ff'][i];t.fillRect(0,0,2048,2048);c.globalCompositeOperation='lighter';c.drawImage(tint,0,0);});
 regionMask.value?.dispose();regionMask.value=new T.CanvasTexture(out);regionMask.value.minFilter=T.LinearFilter;
}
/** Local frame of the terrain patch for precise imagery lookup: anchor tile at zoom 17 split into whole and fraction. */
const planeWater={value:0};
const terrainFrame={planeWater,groundTile:{value:new T.Vector4()},groundPhi:{value:0},groundEastV:{value:new T.Vector3()},groundNorthV:{value:new T.Vector3()},waveOrigin:{value:new T.Vector2()}};
function setGroundFrame(){
 const up=patchAnchor.clone().normalize(),east=new T.Vector3(0,1,0).cross(up).normalize(),north=up.clone().cross(east).normalize(),loc=dirToLatLon(up.toArray() as V);
 const n=2**17,x=((loc.lon+180)/360)*n,r=loc.lat*Math.PI/180,y=((1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2)*n;
 terrainFrame.groundTile.value.set(Math.floor(x),x-Math.floor(x),Math.floor(y),y-Math.floor(y));terrainFrame.groundPhi.value=r;terrainFrame.groundEastV.value.copy(east);terrainFrame.groundNorthV.value.copy(north);
 // Water waves run on metres from a half-degree reference: precise near the aircraft, and continuous when the patch re-anchors.
 const refLat=Math.round(loc.lat*2)/2,refLon=Math.round(loc.lon*2)/2;terrainFrame.waveOrigin.value.set((loc.lon-refLon)*111320*Math.cos(refLat*Math.PI/180),(loc.lat-refLat)*110540);
}
const recenterBlend={value:1};
let recenterStarted=-Infinity,displayedImageryRevision=-1,recenterCount=0;
let displayedGeneration = -1;
terrainScene.add(patch, terrainAmbient);
const scenery = new Scenery(surface);
terrainScene.add(scenery.group);
const city = new City(surface);
terrainScene.add(city.group);
const detail = new WorldDetail(surface, city);
terrainScene.add(detail.group);
const groundOverlay = new GroundOverlay();groundOverlay.skipWater.push([-0.17,51.475,0.01,51.535]);
const bridges = new Bridges(surface);terrainScene.add(bridges.group);
const surfaceTraffic=new SurfaceTraffic(surface,detail,bridges);terrainScene.add(surfaceTraffic.group);combat.blast=p=>surfaceTraffic.view.blast(p);
// Floating panels: drag by the header, touch to bring to the front, double-click the header to reset.
{const views=$('view-bar'),grip=document.createElement('div');grip.className='panel-grip';grip.textContent='⠿ VIEWS';views.prepend(grip);makeDraggable(views,grip);
 makeDraggable($('desk'),document.querySelector<HTMLElement>('#desk .desk-head')!);makeDraggable(radar.element,radar.element.querySelector('header')!);makeDraggable($('combat-panel'),$('combat-score'));}
// Surface-to-air batteries on land around the aircraft, and the warning receiver that hears them and enemy seekers.
const sams=new SamSites((lat,lon)=>surface.height(lat,lon),(lat,lon)=>!scenery.index.at(lat,lon,'water')&&!isOceanAt(lat,lon)),rwr=new Rwr();terrainScene.add(sams.group);
const fleets=new Fleets(),raid=new Raid();shipScene.add(fleets.group,raid.group);surface.decks=fleets.decks();
const fleetLabels=document.createElement('div');fleetLabels.id='fleet-labels';document.body.append(fleetLabels);
const fleetTags=fleets.groups.map(g=>{const el=document.createElement('div');el.className='fleet-tag '+g.spec.side;fleetLabels.append(el);return el;});
const swanTag=document.createElement('div');swanTag.className='fleet-tag hostile';fleetLabels.append(swanTag);
/** Combat scenarios: where they stand and what the HUD says. `check` returns a result line when the scenario ends. */
let raidBand=0,raidNoteUntil=0,opsSince=0;
const ops={id:'',title:'',status:'idle' as 'idle'|'flying'|'done'|'failed',line:'',check:null as null|(()=>{done?:string;failed?:string;now:string}),restart:null as null|(()=>void)};
function opsHud(){if(!ops.id)return '';if(ops.status==='flying'&&ops.check){const r=ops.check();if(r.done){ops.status='done';ops.line=r.done;}else if(r.failed){ops.status='failed';ops.line=r.failed;}else ops.line=r.now;if(state.status==='impact'&&ops.status==='flying'){ops.status='failed';ops.line='You were lost';}}
  return ops.status==='done'?`${ops.title} · ${ops.line} · Enter to fly again`:ops.status==='failed'?`Mission failed · ${ops.line} · Enter to retry`:`${ops.title} · ${ops.line}`;}
/** A point `km` from a place along a compass bearing. */
function offsetFrom(lat:number,lon:number,bearing:number,km:number){const b=bearing*Math.PI/180;return {lat:lat+km*Math.cos(b)/111.2,lon:lon+km*Math.sin(b)/(111.2*Math.cos(lat*Math.PI/180))};}
async function beginAt(lat:number,lon:number,altitude:number,heading:number,speed:number){
  stopTour();stopSuper();combat.clear();missions.stop();
  input('start-lat').value=lat.toFixed(6);input('start-lon').value=lon.toFixed(6);input('start-alt').value=String(altitude);input('start-heading').value=heading.toFixed(1);input('start-speed').value=String(speed);select('start-mode').value='flight';
  await ($('start-form') as HTMLFormElement).onsubmit?.(new SubmitEvent('submit',{cancelable:true}));
  throttle=.8;paused=false;renderer.domElement.focus({preventScroll:true});
}
const OPS=[
  {id:'white-swans',small:'Intercept',title:'Stop the White Swans',detail:'Three Tu-160 bombers and six Su-27s are inbound to nuke London. Shoot the bombers down before they release.',start:async()=>{
    raid.launch(260);const p=offsetFrom(RAID.target.lat,RAID.target.lon,RAID.bearing,150);await beginAt(p.lat,p.lon,RAID.altitude*1000,RAID.bearing,520);const number=raid.number;
    ops.check=()=>raid.number!==number?{now:'',failed:'the raid got through'}:!raid.alive?{now:'',done:'all three bombers down · London is safe'}:raid.released?{now:'',failed:'a bomber released over London'}:{now:`${raid.alive}/3 bombers · ${Math.max(0,raid.distance).toFixed(0)} km out · ${Math.floor(raid.eta/60)}:${String(Math.floor(raid.eta%60)).padStart(2,'0')}`};}},
  {id:'red-fleet',small:'Strike',title:'Nuke the Red Fleet',detail:'Sink the hostile carrier in the Channel. Its escorts kill anything they can track: come in under 8 m, or faster than Mach 3.',start:async()=>{
    const g=fleets.groups.find(x=>x.spec.side==='hostile')!,p=offsetFrom(g.spec.lat,g.spec.lon,g.spec.heading+180,90);for(const s of g.ships){s.alive=true;s.sink=0;s.drone.hp=s.drone.maxHp!;}surface.decks=fleets.decks();
    await beginAt(p.lat,p.lon,9000,g.spec.heading,450);let sunkAt=-1;
    ops.check=()=>{if(!g.ships[0].alive&&sunkAt<0)sunkAt=state.t;return sunkAt>=0&&state.t-sunkAt>40?{now:'',done:'carrier sunk and you got away'}:sunkAt>=0?{now:`carrier sunk · survive ${Math.ceil(40-(state.t-sunkAt))} s`}:{now:`carrier ${g.distance.toFixed(0)} km · ${g.ships.filter(s=>s.alive).length} afloat`};};}},
  {id:'deck-landing',small:'Recovery',title:'Land on the carrier',detail:'A friendly deck 450 m long, 32 m above the sea. Gear down, 70 m/s over the stern.',start:async()=>{
    const g=fleets.groups.find(x=>x.spec.side==='friendly')!,p=offsetFrom(g.spec.lat,g.spec.lon,g.spec.heading+180,7);await beginAt(p.lat,p.lon,320,g.spec.heading,95);
    ops.check=()=>state.status==='landed'&&surface.deckAt(...latLon())>0?{now:'',done:'on deck · welcome aboard'}:{now:`deck ${g.distance.toFixed(1)} km · heading ${Math.round((g.spec.heading+360)%360)}°`};}},
];
function latLon():[number,number]{const l=dirToLatLon(inertialToBody(state.p,state.t,EARTH.rotation));return [l.lat,l.lon];}
async function startOps(o:typeof OPS[number]){ops.id=o.id;ops.title=o.title;ops.status='idle';ops.line='';ops.restart=()=>void startOps(o);await o.start();ops.status='flying';opsSince=performance.now();worldPlace=o.title;}
raid.onRelease=(p,v)=>{if(nuke.armed)nuke.drop(p,v,p.clone().normalize().negate(),state.t);};
/** Ships, the raid and their on-screen tags, once per frame. */
function runWarfare(worldDt:number,shipP:T.Vector3,alt:number){
  const shipV=new T.Vector3(...state.v),flying=state.status==='flying';
  fleets.update(worldDt,state.t,shipP,shipV,alt,flying,combat);raid.update(worldDt,state.t,shipP,shipV,flying,combat);
  const clean=document.body.classList.contains('clean')||cameraMode==='planet',tag=(el:HTMLElement,p:T.Vector3,text:string)=>{
    const v=p.clone().sub(shipP).project(camera),front=p.clone().sub(shipP).sub(camera.position).dot(camera.getWorldDirection(new T.Vector3()))>0;
    el.hidden=clean||!front||Math.abs(v.x)>.95||Math.abs(v.y)>.9;if(el.hidden)return;el.style.left=`${(v.x*.5+.5)*innerWidth}px`;el.style.top=`${(-v.y*.5+.5)*innerHeight}px`;if(el.textContent!==text)el.textContent=text;};
  fleets.groups.forEach((g,i)=>{if(g.distance>90||g.distance<2.5){fleetTags[i].hidden=true;return;}const hostile=g.spec.side==='hostile',inside=hostile&&g.distance<FLEET.engage;fleetTags[i].classList.toggle('alert',inside);tag(fleetTags[i],g.p,`${hostile?'✖':'✚'} ${g.spec.name.split(' · ').pop()} ${g.distance.toFixed(0)} km${inside?' · IN RANGE':''}`);});
  const swans=raid.alive&&raid.distance>-140?raid.centre.distanceTo(shipP):1e9;
  if(swans>120||swans<3)swanTag.hidden=true;else tag(swanTag,raid.centre,`✖ WHITE SWANS ${swans.toFixed(0)} km`);
  // The raid warning is a brief call-out when the bombers cross 300, 150 and 50 km, not a standing banner.
  const status=$('raid-status') as HTMLElement,eta=raid.eta,band=eta<0?0:raid.distance<50?3:raid.distance<150?2:raid.distance<300?1:0;
  if(band>raidBand&&ops.id!=='white-swans')raidNoteUntil=performance.now()+7000;raidBand=band;
  const text=band&&performance.now()<raidNoteUntil?`⚠ WHITE SWANS · ${Math.max(0,raid.distance).toFixed(0)} km from London · ${Math.floor(eta/60)}:${String(Math.floor(eta%60)).padStart(2,'0')}`:'';
  status.hidden=!text||clean;if(status.textContent!==text)status.textContent=text;
}
const water = new WaterSurface(groundOverlay.uniforms),waterScene=new T.Scene(),wash=new JetWash();waterScene.add(water.mesh,wash.mesh);
let overWaterAt=-1,overWater=false;
const missions = new MissionRun(bridges);let bridgePrev: T.Vector3 | null = null, bridgeFlash = 0, holdAgl: number | null = null, missionTrim: number | null = null, holdI = 0, holdVs = 0, holdAcc = 0;
city.exclude = (lat, lon) => bridges.covers(lat, lon); detail.exclude = city.exclude;
const ships = new Ships();ships.sunk=(lat,lon)=>surface.blast(lat,lon)>.25;
terrainScene.add(ships.group);
const terrainSun = new T.DirectionalLight(0xfff6df, 3.2);
terrainScene.add(terrainSun);
terrainMaterial.onBeforeCompile = (shader) => {
  Object.assign(shader.uniforms,nightUniforms,satelliteUniforms(satellite),satelliteUniforms(wideImagery,"context"),satelliteUniforms(nearImagery,"near"),groundOverlay.uniforms);Object.assign(shader.uniforms,terrainFrame);
  // The GPU allows 16 textures here: the context and close-range layers skip their cross-fade texture.
  const single=satelliteGLSL.replace('readSatellite(satellitePrevious,satellitePreviousOrigin,geo)','vec4(0.)');
  shader.fragmentShader=webTileLocalGLSL+overlayGLSL+nightGLSL+single.replaceAll('Satellite','Context').replaceAll('satellite','context')+single.replaceAll('Satellite','Near').replaceAll('satellite','near')+satelliteGLSL+shader.fragmentShader;
  shader.uniforms.absheronOverview={value:imagery.overview};shader.uniforms.overviewOrigin={value:new T.Vector2(imagery.overviewOrigin.x,imagery.overviewOrigin.y)};
  shader.uniforms.weatherMap=weatherMap;shader.uniforms.waterClock=waterClock;shader.uniforms.waterLight=waterLight;shader.uniforms.regionMask=regionMask;shader.uniforms.oceanMask=oceanMask;
  shader.uniforms.globalImagery = { value: earthMaterial.map };
  shader.uniforms.regionalImagery = regionalImagery;
  shader.uniforms.landMask = { value: scenery.mask };
  shader.uniforms.terrainBlend = terrainBlend;
  shader.uniforms.recenterBlend=recenterBlend;
  shader.uniforms.groundAnchor={value:patchAnchor.clone()};
  shader.uniforms.groundHaze = { value: groundHaze };
  shader.uniforms.groundHazeDensity = { value: groundHazeDensity };
  shader.uniforms.groundOrigin = {
    value: new T.Vector3(
      ...patchAnchor.toArray().map((x) => ((x % 1.28) + 1.28) % 1.28),
    ),
  };
  terrainMaterial.userData.shader = shader;
  shader.vertexShader =
    "attribute float water;varying float vTerrainWater;\n"+
    "uniform vec3 groundEastV;uniform vec3 groundNorthV;varying vec2 vLocalEN;\n"+
    "attribute vec2 recenterHeight;attribute vec3 recenterNormal;attribute vec3 recenterBaseNormal;uniform float recenterBlend;uniform vec3 groundAnchor;\n"+
    "attribute vec3 basePosition;attribute vec3 baseNormal;attribute vec3 baseColor;uniform float terrainBlend;attribute vec2 geography;varying vec2 vGeography;varying vec3 vGroundP;uniform vec3 groundOrigin;\n" +
    shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace(
    "#include <begin_vertex>",
    "#include <begin_vertex>\ntransformed=mix(basePosition,position,terrainBlend);transformed+=normalize(transformed+groundAnchor)*mix(recenterHeight.x,recenterHeight.y,terrainBlend)*(1.-recenterBlend);vGeography=geography;vLocalEN=vec2(dot(transformed,groundEastV),dot(transformed,groundNorthV));vGroundP=(transformed+groundOrigin)*200.;vTerrainWater=water;",
  );
  shader.vertexShader = shader.vertexShader.replace("#include <beginnormal_vertex>",
    "#include <beginnormal_vertex>\nobjectNormal=normalize(mix(mix(recenterBaseNormal,recenterNormal,terrainBlend),mix(baseNormal,normal,terrainBlend),recenterBlend));");
  shader.vertexShader = shader.vertexShader.replace("#include <color_vertex>",
    "#include <color_vertex>\nvColor.rgb=mix(baseColor,color.rgb,terrainBlend);");
  shader.fragmentShader =
    "uniform vec2 waveOrigin;uniform float planeWater;uniform sampler2D weatherMap;varying float vTerrainWater;uniform float waterClock;uniform vec3 waterLight;uniform sampler2D regionMask;uniform sampler2D oceanMask;\n"+
    "uniform sampler2D absheronOverview;uniform vec2 overviewOrigin;uniform sampler2D globalImagery;uniform float regionalImagery;varying vec2 vGeography;varying vec3 vGroundP;uniform sampler2D landMask;uniform vec3 groundHaze;uniform float groundHazeDensity;\nfloat groundHash(vec3 p){return fract(sin(dot(mod(p,256.),vec3(127.1,311.7,74.7)))*43758.5453);}\nfloat grain(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(groundHash(i),groundHash(i+vec3(1,0,0)),f.x),mix(groundHash(i+vec3(0,1,0)),groundHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(groundHash(i+vec3(0,0,1)),groundHash(i+vec3(1,0,1)),f.x),mix(groundHash(i+vec3(0,1,1)),groundHash(i+vec3(1,1,1)),f.x),f.y),f.z);}\n" +
    shader.fragmentShader;
  shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
    #ifdef USE_MAP
      vec2 globalUV=vec2(.5+vGeography.x/360.,.5+vGeography.y/180.);
      vec4 globalColor=texture2D(globalImagery,globalUV);
      float mercLat=clamp(vGeography.y,-85.,85.)*.01745329252;
      vec2 overviewUV=vec2((vGeography.x+180.)/360.*1024.,(1.-log(tan(mercLat)+1./cos(mercLat))/3.14159265359)*512.);
      overviewUV=(overviewUV-overviewOrigin)/3.;overviewUV.y=1.-overviewUV.y;
      float overviewEdge=min(min(overviewUV.x,overviewUV.y),min(1.-overviewUV.x,1.-overviewUV.y));
      globalColor=mix(globalColor,texture2D(absheronOverview,clamp(overviewUV,0.,1.)),smoothstep(0.,.08,overviewEdge));
      float edge=min(min(vMapUv.x,vMapUv.y),min(1.-vMapUv.x,1.-vMapUv.y));
      float regionalWeight=regionalImagery*smoothstep(0.,.08,edge);
      vec4 regionalColor=texture2D(map,clamp(vMapUv,vec2(0.),vec2(1.)));
      regionalWeight*=smoothstep(.002,.012,max(regionalColor.r,max(regionalColor.g,regionalColor.b)));
      diffuseColor*=vec4(applyOverlay(blendNear(blendSatellite(blendContext(mix(globalColor.rgb,regionalColor.rgb,regionalWeight),vGeography),vGeography),vGeography),vGeography),1.);
    #endif
  `);
  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <opaque_fragment>",
    `vec2 landUV=(vGeography-vec2(7.5,46.3))/vec2(1.1,.75);vec4 land=vec4(0.);if(all(greaterThanEqual(landUV,vec2(0.)))&&all(lessThanEqual(landUV,vec2(1.))))land=texture2D(landMask,landUV);if(land.r>.5)discard;outgoingLight=mix(outgoingLight,outgoingLight*vec3(.36,.55,.38),land.g*.8);
    float viewDistance=length(vViewPosition),footprint=max(length(dFdx(vGroundP)),length(dFdy(vGroundP)));
    vec3 sunView=normalize(mat3(viewMatrix)*waterLight);float sunFacing=dot(normal,sunView);
    // Three bands of ground texture, each faded before it can alias.
    float fine=1.-smoothstep(.2,.9,footprint*4.),mid=1.-smoothstep(.2,.9,footprint*.7),broad=1.-smoothstep(.2,.9,footprint*.09);
    float tone=1.+(grain(vGroundP*4.)-.5)*.42*fine+(grain(vGroundP*.7)-.5)*.36*mid+(grain(vGroundP*.09)-.5)*.26*broad;
    vec3 rough=(vec3(grain(vGroundP*1.3),grain(vGroundP*1.3+19.7),grain(vGroundP*1.3-41.3))-.5)*mid+(vec3(grain(vGroundP*.21),grain(vGroundP*.21+7.1),grain(vGroundP*.21-13.9))-.5)*broad*1.4;
    float relief=clamp(max(0.,dot(normalize(normal+rough*.55),sunView))/max(.08,sunFacing),.45,1.7);
    outgoingLight*=tone*mix(1.,relief,step(0.,sunFacing));
    // Approximate cloud shadow: same coverage map as the sky, broken up at cumulus scale.
    float cover=texture2D(weatherMap,vec2(.5+vGeography.x/360.,.5+vGeography.y/180.)).a*(1.-.7*smoothstep(55.,70.,abs(vGeography.y)));
    cover=clamp(cover*1.7+(grain(vGroundP*.0011+vec3(0.,waterClock*.0009,0.))*.6+grain(vGroundP*.0043)*.4-.5)*1.5+.08,0.,1.);
    outgoingLight*=1.-.32*smoothstep(.64,.9,cover)*smoothstep(0.,.15,sunFacing);
    // From orbit a city is one glowing patch; from the air above it the glow resolves into dim lit streets.
    // The orbital night-lights map is a glow; close up it would wash whole towns beige, so it fades in only with distance.
    outgoingLight+=cityLights(vGeography,sunFacing)*.9*mix(.025,1.,smoothstep(15.,160.,viewDistance));
    // Street lighting on painted roads and airfields after dark.
    outgoingLight+=vec3(1.,.62,.3)*overlayPaint*overlayNight*.035*(1.-smoothstep(.2,9.,viewDistance)*.6);
    outgoingLight=mix(outgoingLight,groundHaze,1.-exp(-viewDistance*.012*groundHazeDensity));
#include <opaque_fragment>`,
  );
  shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
    vec2 seaUV=vec2(.5+vGeography.x/360.,.5+vGeography.y/180.);
    float waterBlend=texture2D(oceanMask,seaUV).r;
    vec2 lakeUV=(vGeography-vec2(46.,35.))/vec2(10.,13.);
    if(all(greaterThanEqual(lakeUV,vec2(0.)))&&all(lessThanEqual(lakeUV,vec2(1.))))waterBlend=texture2D(regionMask,lakeUV).r;
    vec2 coastUV=(vGeography-vec2(49.5,40.1))/vec2(1.2,.6);
    if(all(greaterThanEqual(coastUV,vec2(0.)))&&all(lessThanEqual(coastUV,vec2(1.))))waterBlend=texture2D(regionMask,coastUV).g;
    vec2 thamesUV=(vGeography-vec2(-.17,51.475))/vec2(.18,.06);
    float thames=0.;if(all(greaterThanEqual(thamesUV,vec2(0.)))&&all(lessThanEqual(thamesUV,vec2(1.))))thames=texture2D(regionMask,thamesUV).b;
    waterBlend=max(waterBlend,thames);
    float rawWater=waterBlend;
    waterBlend=smoothstep(.35,.65,waterBlend);
    // Fine satellite land colour protects small islands missing from the coarse ocean mask.
    vec4 islandDetail=readSatellite(satelliteMap,satelliteOrigin,vGeography);
    float warmLand=smoothstep(.92,1.15,islandDetail.r/max(.015,islandDetail.b));
    waterBlend*=1.-warmLand*islandDetail.a*satelliteReady*satelliteFade;
    // A silty tidal river reads as warm land in imagery; the surveyed outline wins.
    waterBlend=max(waterBlend,smoothstep(.35,.65,thames));
    // Painted rivers, canals and lakes from the ground overlay share the same water shading.
    waterBlend=max(waterBlend,overlayWater);float inland=overlayWater;
    // Within reach of the mirror surface, terrain still flagged as river is the bank sloping out of it: wet foreshore, not more water.
    float shoreline=planeWater*(1.-smoothstep(4.,6.5,viewDistance))*max(smoothstep(.35,.65,thames),overlayWater);
    waterBlend*=1.-shoreline;outgoingLight*=1.-.45*shoreline;
    // Animated vector-noise ripples; every octave fades with its pixel footprint so distant water stays calm.
    float T=waterClock;
    vec3 wave=vec3(0.);float resolved=0.;
    for(int o=0;o<4;o++){
      float f=o==0?.055:o==1?.33:o==2?1.25:4.2,amp=o==0?1.25:o==1?.9:o==2?.55:.3,speed=o==0?.35:o==1?.9:o==2?1.6:2.6;
      float w=1.-smoothstep(.18,.8,footprint*f);if(w<=0.)continue;
      // Near the aircraft the waves use precise local metres (vGroundP is absolute and too coarse for 1 m ripples).
      vec2 wm=waveOrigin+vLocalEN*1000.;vec3 q=dot(vLocalEN,vLocalEN)<100.?vec3(wm.x,0.,wm.y)*.2*f:vGroundP*f;
      wave+=(vec3(grain(q+vec3(T*speed*.31,0.,T*speed*.22)),grain(q*1.07+vec3(31.7,T*speed*.27,5.2)),grain(q*.93+vec3(-T*speed*.19,17.3,T*speed*.3)))-.5)*amp*w;resolved+=amp*w;
    }
    resolved/=3.;
    vec3 N=normalize(normal+wave*.16*(1.-.7*smoothstep(.35,.65,thames))),V=normalize(vViewPosition),L=sunView;
    float lit=max(0.,sunFacing),facing=max(0.,dot(N,V)),fresnel=.02+.98*pow(1.-facing,5.);
    vec3 R=reflect(-V,N);float skyward=clamp(dot(R,normal),0.,1.);
    // Reflected sky: bright haze at the horizon falling to deeper blue overhead.
    vec3 sky=mix(groundHaze*1.55,groundHaze*vec3(.42,.68,1.3),pow(skyward,.55));
    float shore=1.-smoothstep(.5,.97,rawWater);
    vec3 body=mix(vec3(.004,.038,.07),vec3(.02,.21,.2),shore*.85)*(.1+.9*lit);
    // The tideway is silt-laden and shallow: a pale grey-green body that mostly mirrors the sky.
    float river=max(smoothstep(.35,.65,thames),inland);body=mix(body,vec3(.05,.078,.075)*(.1+.9*lit),river);fresnel=mix(fresnel,max(fresnel,.5),river);
    body+=vec3(.0,.05,.045)*pow(max(0.,dot(wave,sunView))*2.,2.)*lit*resolved;
    // Unresolved waves widen the glitter path instead of producing a mirror.
    float shininess=mix(36.,520.,resolved*resolved);
    float glint=pow(max(0.,dot(R,L)),shininess)*(shininess+8.)*.018*(.22+.78*resolved*resolved)*smoothstep(0.,.1,sunFacing);
    float caps=(1.-river)*smoothstep(.71,.8,grain(vGroundP*.5+vec3(T*.25,0.,T*.2))*.6+grain(vGroundP*2.1-vec3(0.,T*.4,0.))*.4)*(1.-smoothstep(.2,.9,footprint*2.1))*.35;
    vec3 waterColor=mix(body,sky,fresnel*.9)+vec3(1.,.9,.72)*glint*3.2+vec3(.8,.86,.9)*caps*(.08+.92*lit);
    // The tideway keeps its true colour from the imagery (silt, boats, moorings) under a soft sky sheen.
    waterColor=mix(waterColor,mix(outgoingLight*.92,sky,fresnel*.55)+vec3(1.,.9,.72)*glint*2.,river*.3);
    waterColor=mix(waterColor,groundHaze,1.-exp(-viewDistance*.012*groundHazeDensity));
    outgoingLight=mix(outgoingLight,waterColor,waterBlend);
    // A static artistic Arctic ice pack; imagery is a cloud-free summer composite, not live sea ice.
    float ice=smoothstep(78.,84.,vGeography.y)*waterBlend;
    float crack=smoothstep(.46,.53,grain(vGroundP*.02));
    vec3 iceColor=mix(vec3(.24,.43,.5),vec3(.76,.88,.91),crack)*(.12+.88*lit);
    iceColor=mix(iceColor,groundHaze,1.-exp(-viewDistance*.012*groundHazeDensity));
    outgoingLight=mix(outgoingLight,iceColor,ice);
    #include <opaque_fragment>
  `);
};
const terrainBuilder = new TerrainBuilder((mesh, request) => {
  if (imageryRevision !== imagery.revision || request.generation !== surface.generation) {
    terrainRevision = imageryRevision = -1;
    return false;
  }
  patchAnchor.set(...request.anchor);
  regionalImagery.value = request.imagery ? 1 : 0;
  for (const [name, data, size] of [
    ["position", mesh.position, 3], ["normal", mesh.normal, 3],
    ["uv", mesh.uv, 2], ["color", mesh.color, 3],
    ["geography", mesh.geography, 2],
    ["water",mesh.water,1],
    ["basePosition", mesh.basePosition, 3], ["baseNormal", mesh.baseNormal, 3],
    ["baseColor", mesh.baseColor, 3],
    ["recenterHeight",mesh.recenterHeight,2],
    ["recenterNormal",mesh.recenterNormal,3],["recenterBaseNormal",mesh.recenterBaseNormal,3],
  ] as const) {
    const attribute = patchGeo.getAttribute(name);
    if (attribute && attribute.array.length === data.length) {
      (attribute.array as Float32Array).set(data);
      attribute.needsUpdate = true;
    } else patchGeo.setAttribute(name, new T.BufferAttribute(data.slice(), size));
  }
  if (!patchGeo.index) patchGeo.setIndex(new T.BufferAttribute(mesh.index, 1));
  patchGeo.boundingSphere = null;
  const map = request.imagery ? imagery.texture : earthMaterial.map;
  if (terrainMaterial.map !== map) {
    terrainMaterial.map = map;
    terrainMaterial.needsUpdate = true;
  }
  if (terrainMaterial.userData.shader)
    terrainMaterial.userData.shader.uniforms.groundOrigin.value.set(
      ...patchAnchor.toArray().map(x => ((x % 1.28) + 1.28) % 1.28),
    );
  terrainMaterial.userData.shader?.uniforms.groundAnchor.value.copy(patchAnchor);
  setGroundFrame();
  recenterStarted=mesh.recentered?performance.now():-Infinity;recenterBlend.value=mesh.recentered?0:1;
  if(mesh.recentered)recenterCount++;
  displayedGeneration = surface.generation;
  displayedImageryRevision=imagery.revision;
  surface.transitionReady = true;
  patchReady = true;
  return true;
});
function invalidatePatch() {
  patchReady = false;
  recenterStarted=-Infinity;recenterBlend.value=1;
  terrainBuilder.invalidate();
}
function updatePatch() {
  const body = inertialToBody(state.p, state.t, EARTH.rotation),
    anchor = new T.Vector3(...body).normalize().multiplyScalar(EARTH.radius);
  // A bounded lead keeps the dense area near a moving craft while a worker job is in flight.
  if(!paused&&state.status==='flying'&&(state.tele?.agl??1e9)<500){
    const lead=Math.min(.6,terrainBuilder.milliseconds/1000),future=state.p.map((v,i)=>v+state.v[i]*lead) as V;
    anchor.set(...inertialToBody(future,state.t+lead,EARTH.rotation)).normalize().multiplyScalar(EARTH.radius);
  }
  // At safe approach height, spend the densest geometry on the mountain being inspected.
  // Close to ground, the aircraft keeps priority for clearance and landing detail.
  if(activeSummit && (state.tele?.agl??0)>1500){
    const focus=crestApproach&&activeCrest?activeCrest:activeSummit;
    const target=new T.Vector3(...latLonToDir(focus.lat,focus.lon)).multiplyScalar(EARTH.radius);
    if(target.distanceTo(anchor)<25)anchor.copy(target);
  }
  if (terrainBuilder.busy) return;
  if(recenterBlend.value<1)return;
  if (!patchReady || patchAnchor.distanceTo(anchor) > terrainRecenterKm(state.tele?.agl) ||
      terrainRevision !== surface.generation || imageryRevision !== imagery.revision) {
    const loc = activeSummit ?? dirToLatLon(body),sameSurface=patchReady&&displayedGeneration===surface.generation&&displayedImageryRevision===imagery.revision,
      distance=patchAnchor.distanceTo(anchor);
    // Elevation/imagery updates keep the current grid when nearby, so their existing blend remains coherent.
    if(patchReady&&!sameSurface&&distance<2)anchor.copy(patchAnchor);
    if (terrainBuilder.build(surface, scenery.features, {
      anchor: anchor.toArray() as V,
      generation: surface.generation,
      imagery: imagery.contains(loc.lat, loc.lon) ? imagery.origin : null,
      recenterFrom:sameSurface&&distance<2?terrainBuilder.accepted:undefined,
    })) {
      terrainRevision = surface.generation;
      imageryRevision = imagery.revision;
    }
  }
}
function levelAt(
  lat: number,
  lon: number,
  alt: number,
  heading = 90,
  pitch = 0,
  speed = 0,
  aoa = 0,
) {
  const up = new T.Vector3(...latLonToDir(lat, lon)),
    east = new T.Vector3(
      -Math.sin((lon * Math.PI) / 180),
      0,
      -Math.cos((lon * Math.PI) / 180),
    ).normalize(),
    north = up.clone().cross(east),
    h = (heading * Math.PI) / 180;
  const tangent = north
      .multiplyScalar(Math.cos(h))
      .addScaledVector(east, Math.sin(h)),
    a = (pitch * Math.PI) / 180,
    fwd = tangent
      .clone()
      .multiplyScalar(Math.cos(a))
      .addScaledVector(up, Math.sin(a)),
    // Velocity along the flight path: pitch minus angle of attack (taken before `up` is rescaled for the position).
    path = tangent.clone().multiplyScalar(Math.cos(a - aoa * Math.PI / 180)).addScaledVector(up, Math.sin(a - aoa * Math.PI / 180)),
    right = fwd.clone().cross(up).normalize(),
    top = right.clone().cross(fwd).normalize();
  rotation.setFromRotationMatrix(
    new T.Matrix4().makeBasis(right, top, fwd.clone().negate()),
  );
  state.p = up
    .multiplyScalar(EARTH.radius + (alt + surface.height(lat, lon)) / 1000)
    .toArray() as V;
  state.v = add(
    atmosphereVelocity(state.p),
    mul(path.toArray() as V, speed / 1000),
  );
}
function prepareGroundStart() {
  const frame = groundFrame(surface, state.p, state.t);
  rotation.copy(surfaceAttitude(rotation, frame.normal));
  state.p = settleOnSurface(surface, state.p, state.t, rotation);
  const contact = contactGaps(surface, state.p, state.t, rotation, true);
  if (frame.slope > LANDING.maxSlope || contact.spread > LANDING.gearTravel) {
    state.status = "impact";
    state.body = frame.slope > LANDING.maxSlope
      ? `Landing site too steep: ${frame.slope.toFixed(1)}° (limit ${LANDING.maxSlope}°)`
      : "Landing site too uneven for the gear";
  }
}
function reset(name = select("scenario").value) {
  supercruise.stop();combat.clear();worldPlace="";
  if(name==='caspian'){void flyCaspian();return;}
  if(name==='summit')name='valley';
  destinationEpoch++;activeSummit=null;activeCaspian=false;activeCrest=null;crestApproach=false;imagery.focusSummit=null;
  tour=null;$("tour-status").hidden=true;
  cameraSet = false;flightMap.reset();
  select("scenario").value = name;
  state.t = 0;streamClock=0;
  trails.reset();sonic.reset(); enginePower=0;boostPower=0;deliveredThrottle = airbrake = 0; lastEffectsTime = 0; boostActive = false;
  state.fuel = 100;
  state.heat = 0;
  state.structuralDamage = 0;
  state.status = "flying";
  state.body = "";
  state.tele = undefined;
  throttle = 0;
  torch = false;
  gear = false;
  assist = false;
  entry = false;
  paused = false;
  invalidatePatch();
  terrainClock = 1;
  control.reset();
  clearPilot();
  yaw = 0;
  orbitPitch = 0.18;
  zoom = 1;
  if (name === "valley") {
    levelAt(46.727, 7.98, 250, 65, 2.1, 160);
    throttle = 0.4;
  } else if (name === "alps") {
    levelAt(46.55, 8.0, 1000, 75, 3, 150);
    throttle = 0.35;
  } else if (name === "slope") {
    levelAt(46.565, 7.835, 60, 90, 0, 0);
    gear = true;
    assist = true;
  } else if (name === "overview" || name === "orbit") {
    const lat = name === "orbit" ? 27 : 18,
      lon = name === "orbit" ? 15 : 16,
      altitudeMSL = name === "orbit" ? 400000 : 2400000;
    levelAt(lat, lon, altitudeMSL - surface.height(lat, lon), 90, 0, 0);
    state.v = new T.Vector3(0, 0, -1).applyQuaternion(rotation)
      .multiplyScalar(Math.sqrt(EARTH.mu / len(state.p))).toArray() as V;
  }
  else if (name === "entry") {
    levelAt(34, 12, 100000, 105, -6, 7600);
    entry = true;
  } else if (name === "mach") {
    levelAt(37.6, 14, 11000 - surface.height(37.6, 14), 90, 0, 265);
    throttle = .15;
  } else if (name === "coast") {
    levelAt(37.6, 14, 8000, 25, 5, 220);
    throttle = 0.08;
  } else if (name === "surface") {
    levelAt(24, 12, VEHICLE.gearClearance, 90, 0, 0);
    gear = true;
    state.status = "landed";
  } else if (name === "departure") {
    levelAt(24, 12, 80000, 90, 65, 1300);
    throttle = 0.7;
    torch = true;
  }
  if (state.status === "landed") prepareGroundStart();
  const u = new T.Vector3(...state.p).normalize(),
    e = new T.Vector3(0, 1, 0).cross(u).normalize();
  lightDir.copy(u).multiplyScalar(0.7).addScaledVector(e, 0.7).normalize();
  solarOffset = 0;
  sun.position.copy(lightDir).multiplyScalar(10000);
  shipSun.position.copy(lightDir).multiplyScalar(100);
  sunBall.position.copy(lightDir).multiplyScalar(160000);
  advanceFlight(
    state,
    0,
    rotation,
    { throttle: 0, hover: 0, lateral: 0, surge: 0 },
    { surface, gear },
  );
  sync();
}
function sync() {
  ($("throttle") as HTMLInputElement).value = String(throttle * 100);
  $("power").textContent = airbrake ? "AIRBRAKE" : boostActive ? `${Math.round(deliveredThrottle * 100)}% BOOST` : `${Math.round(throttle * 100)}%`;
  $("torch").classList.toggle("on", torch);
  $("gear").classList.toggle("on", gear);
  $("assist").classList.toggle("on", assist);
  $("pause").innerHTML = paused ? "Resume <kbd>Space</kbd>" : "Pause <kbd>Space</kbd>";
  $("pause").classList.toggle("on", paused);
  $("drive-label").textContent = airbrake > 0 ? "AIRBRAKE · CTRL" : boostActive ? "BOOST · SHIFT" : entry
    ? "ENTRY ATTITUDE HOLD"
    : torch
      ? "TORCH DRIVE · 30 G"
      : "MAIN DRIVE";
}
function stepPhysics(dt: number) {
  if (paused || !ready || state.status === "impact") return;
  const key = (k: string) => (keys.has(k) ? 1 : 0);
  if (controlStyle === 'direct') throttle = T.MathUtils.clamp(
    throttle + (key('shift') - key('control')) * dt * .5, 0, 1);
  const pad = navigator.getGamepads?.()[0];
  const dead = (v: number) => Math.abs(v) < .12 ? 0 : (Math.sign(v) * (Math.abs(v) - .12)) / .88;
  const raw = {
    pitch: (controlStyle === 'direct' ? key('s') - key('w') : key('w') - key('s')) + (controlStyle === 'direct' ? key('arrowdown') - key('arrowup') : key('arrowup') - key('arrowdown')) - dead(pad?.axes[1] ?? 0) - mouseAim.y,
    yaw: key('q') - key('e') - dead(pad?.axes[2] ?? 0),
    roll: key('a') - key('d') + key('arrowleft') - key('arrowright') - dead(pad?.axes[0] ?? 0) - mouseAim.x,
  };
  const manual = Math.abs(raw.pitch) + Math.abs(raw.yaw) + Math.abs(raw.roll) > .001;
  if (manual) { entry = false; assist = false; }
  const localVertical = new T.Vector3(...state.p).normalize(),
    rightAxis = new T.Vector3(1, 0, 0).applyQuaternion(rotation),
    topAxis = new T.Vector3(0, 1, 0).applyQuaternion(rotation),
    bank = Math.atan2(rightAxis.dot(localVertical), topAxis.dot(localVertical));
  const commands = pilotInput.update(raw, bank, state.tele?.airspeed ?? 0, state.tele?.dynamicPressure ?? 0, dt, controlStyle);
  const stick = assist || entry ? new T.Vector3() : new T.Vector3(commands.pitch, commands.yaw, commands.roll);
  // Fly-by-wire angle-of-attack limit, as on a modern fighter: the stick asks for pitch, but the nose is not allowed to run
  // ahead of the wing. Held back at about 15 degrees, the jet turns as hard as its lift allows and never stalls out of a loop.
  if (controlStyle !== 'direct' && state.tele && state.tele.dynamicPressure > 100 && state.tele.airspeed > 45) {
    const a = state.tele.alpha, room = (x: number) => T.MathUtils.clamp((.27 - x) / .09, 0, 1);
    if (stick.x > 0 && a > 0) stick.x *= room(a); else if (stick.x < 0 && a < 0) stick.x *= room(-a);
  }
  // Low-level hold during missions: with the stick centred the jet holds the height it was released at, so a river
  // run at 8 m is flyable. Any pitch input takes over at once; the hold re-captures when the stick is centred again.
  if (missions.active && missions.status !== 'failed' && controlStyle !== 'direct' && state.tele && state.tele.agl < 200 && !assist && !entry) {
    if (Math.abs(raw.pitch) > .001) { holdAgl = null; holdI = 0; }
    else {
      // Holds height above the datum, not above the ground: river LIDAR ripples by a metre and the jet should not chase it.
      const h = (len(state.p) - EARTH.radius) * 1000, vs = state.tele.verticalSpeed, error = (holdAgl ??= h) - h;
      holdI = T.MathUtils.clamp(holdI + error * dt, -120, 120);
      holdAcc += ((vs - holdVs) / Math.max(dt, 1e-3) - holdAcc) * Math.min(1, dt / .15); holdVs = vs;
      stick.x += T.MathUtils.clamp(error * .1 - vs * .22 + holdI * .09 - holdAcc * .14, -.6, .6) / Math.max(.5, Math.cos(bank));
    }
  } else { holdAgl = null; holdI = 0; }
  control.maxRate.set(controlStyle === 'direct' ? .35 : .65, controlStyle === 'direct' ? .24 : .55, controlStyle === 'direct' ? .7 : 1.9);
  const boosting = controlStyle !== 'direct' && (keys.has('shift') || (pad?.buttons[7]?.value ?? 0) > .2);
  boostActive = boosting;
  airbrake = controlStyle !== 'direct' && (keys.has('control') || (pad?.buttons[6]?.value ?? 0) > .2) ? 1 : 0;
  deliveredThrottle = controlStyle !== 'direct' && !torch
    ? gameThrottle(throttle, boosting, !!airbrake, state.tele?.dynamicPressure ?? 0)
    : controlStyle !== 'direct' ? airbrake ? 0 : boosting ? 1 : throttle : throttle;
  // The torch is an orbital drive; protect the vehicle from its 30 g thrust in dense air.
  const torchLimit=torchThrottleLimit(atmosphereDensity((len(state.p)-EARTH.radius)*1000),state.tele?.dynamicPressure??0);
  if(torch)deliveredThrottle=Math.min(deliveredThrottle,torchLimit);
  
  boostPower+=((boostActive?1:0)-boostPower)*(1-Math.exp(-dt/.8));
  enginePower+=(deliveredThrottle-enginePower)*(1-Math.exp(-dt/(deliveredThrottle<enginePower?.18:.8)));
  let flight = {
    throttle: torch?Math.min(enginePower,torchLimit):enginePower,
    boost:boostPower,
    airbrake,
    torch,
    hover: key("r") - key("f"),
    lateral: key("l") - key("j"),
    surge: key("i") - key("k"),
    rotate: Math.max(0, raw.pitch),
    steer: T.MathUtils.clamp(raw.roll + raw.yaw, -1, 1),
  };
  if (state.tele && entry && state.tele.airspeed > 50)
    control.pointTo(entryAttitude(state.tele, 40));
  if (state.tele && assist) {
    const cmd = descentAssist(state, state.tele, rotation);
    control.pointTo(cmd.level);
    flight.hover = Math.max(flight.hover, cmd.hover);
    flight.lateral = cmd.lateral;
    flight.surge = cmd.surge;
    flight.throttle = 0;
    if (state.tele.agl < 400) gear = true;
  }
  if (state.status !== "landed")
    control.update(
      rotation,
      stick,
      dt,
      state.tele && !flight.hover
        ? {
            alpha: state.tele.alpha,
            beta: state.tele.beta,
            qbar: state.tele.dynamicPressure,
            speed: state.tele.airspeed,
            loadFactor: controlStyle !== "direct" ? 1 / Math.max(.5, Math.cos(bank)) : 1,
          }
        : undefined,
    );
  const terrainLocation = dirToLatLon(
    inertialToBody(state.p, state.t, EARTH.rotation),
  );
  surface.advance(
    dt,
    terrainLocation.lat,
    terrainLocation.lon,
    (len(state.p) - EARTH.radius) * 1000,
  );
  deliveredThrottle = state.fuel > 0 ? flight.throttle : 0;
  advanceFlight(state, dt, rotation, flight, { surface, gear });
  // Game mode: a modern fighter has thrust to spare, so a jet that is pulling through a loop or flying on its side or
  // back is not allowed to fall below manoeuvring speed. Push along the nose, up to about 3 g, until it has 150 m/s again.
  if (controlStyle !== 'direct' && state.status === 'flying' && state.tele && !airbrake && state.tele.dynamicPressure > 100 && state.tele.agl > 30) {
    const nose = new T.Vector3(0, 0, -1).applyQuaternion(rotation), steep = Math.abs(nose.dot(localVertical)) > .45 || topAxis.dot(localVertical) < .35 || Math.abs(raw.pitch) > .5;
    const push = steep ? Math.min(32, Math.max(0, 165 - state.tele.airspeed) * .6) * Math.max(.6, enginePower) : 0;
    if (push > 0) state.v = [state.v[0] + nose.x * push * dt / 1000, state.v[1] + nose.y * push * dt / 1000, state.v[2] + nose.z * push * dt / 1000];
  }
  if (sonic.update(state.tele?.mach ?? 0, (len(state.p) - EARTH.radius) * 1000,
      atmosphereDensity((len(state.p) - EARTH.radius) * 1000), state.t, dt, state.status === 'flying')) sonicBoom();
  if (((state.status as string) === "landed" || state.tele?.surfaceContact) && isOcean() && !surface.deckAt(...latLon())) {
    state.status = "impact";
    state.body = Math.abs(bank) > .26 ? `Wingtip caught the water at ${Math.round(Math.abs(bank) * 180 / Math.PI)}° of bank` : "Splashdown · the belly touched the water";
  }
  if (state.status === "landed") { assist = false; control.reset(); if (!onGround) { onGround = true; throttle = 0; } } else onGround = false;
  sync();
}
function streamScenery(dt:number){
  streamClock += dt;
  if (streamClock > 4 && (state.tele?.agl ?? 1e9) > 500) {
    streamClock = 0;
    const loc = dirToLatLon(inertialToBody(state.p, state.t, EARTH.rotation));
    void (async () => {
      await surface.warm(loc.lat, loc.lon, 9);
      if ((state.tele?.agl ?? 1e9) < 12000){await surface.warm(loc.lat, loc.lon, 11);await surface.warmRegionalDetail(loc.lat,loc.lon);}
    })();
    void imagery.warm(loc.lat, loc.lon);
  }
}
const flightMap=new FlightMap((lat,lon)=>{($('start-lat') as HTMLInputElement).value=lat.toFixed(5);($('start-lon') as HTMLInputElement).value=lon.toFixed(5);openPlanner();});
function step(dt:number){
 if(paused||!ready||state.status==='impact')return;
 if(supercruise.active){effectiveRate=combat.engaged?1:Math.min(timeRate,20);const key=(k:string)=>keys.has(k)?1:0;supercruise.advance(state,rotation,dt*effectiveRate,surface,{pitch:key('w')-key('s')+key('arrowup')-key('arrowdown')-mouseAim.y,roll:key('a')-key('d')+key('arrowleft')-key('arrowright')-mouseAim.x,yaw:key('q')-key('e')},keys.has('control'));deliveredThrottle=.8;boostActive=true;gear=assist=entry=false;const loc=dirToLatLon(inertialToBody(state.p,state.t,EARTH.rotation));surface.advance(dt*effectiveRate,loc.lat,loc.lon,(len(state.p)-EARTH.radius)*1000);{const h=(len(state.p)-EARTH.radius)*1000;if(sonic.update(supercruise.speed/(h<11000?340-h*.0041:295),h,atmosphereDensity(h),state.t,dt*effectiveRate,(state.status as string)==='flying'))sonicBoom();}streamScenery(dt);return;}
 const manual=[...keys].some(k=>('wasdqeirfjkl'.includes(k)&&k.length===1)||['arrowup','arrowdown','arrowleft','arrowright'].includes(k))||mouseAim.active||[...(navigator.getGamepads?.()[0]?.axes??[])].some(x=>Math.abs(x)>.15);
 if(tour?.completed)stopTour();
 if(tour&&!tour.completed){
  if(manual){stopTour(true);}
  else{effectiveRate=timeRate;const result=tourFlight(tour,state,rotation,dt*timeRate,surface);deliveredThrottle=result.throttle;enginePower=result.throttle;boostPower=1;boostActive=true;gear=false;torch=false;assist=entry=false;
   surface.advance(result.dt,tour.pose().location.lat,tour.pose().location.lon,tour.config.altitude);
   if(tour.completed){paused=true;timeRate=effectiveRate=1;select("warp").value="1";}
   streamClock+=dt;if(streamClock>1){streamClock=0;const loc=tour.pose().location;void surface.warm(loc.lat,loc.lon,9);void imagery.warm(loc.lat,loc.lon);}
   return;
  }
 }
 effectiveRate=freeFlightRate(combat.engaged?1:timeRate,altimetry?.clearance??state.tele?.agl??0,manual,assist||state.status==='landed');
 let left=dt*effectiveRate;while(left>1e-8&&!paused&&(state.status as string)!=='impact'){const h=Math.min((state.tele?.agl??0)>120000?.1:.02,left);stepPhysics(h);left-=h;}streamScenery(dt);
}
const cameraAbs = new T.Vector3();
function draw(dt: number) {
  recenterBlend.value=T.MathUtils.smoothstep(performance.now()-recenterStarted,0,350);
  altimetry=readAltimetry(state,surface,rotation,gear);
  const shipP = new T.Vector3(...state.p),
    up = shipP.clone().normalize();
  globe.position.copy(shipP).negate();
  globe.rotation.y = (state.t / EARTH.rotation) * Math.PI * 2;
  clouds.rotation.y = state.t * 0.000004;
  const alt = (shipP.length() - EARTH.radius) * 1000;
  scenery.update(state.p, state.t);
  city.update(state.p, state.t);
  const groundSpeed = state.status === 'flying' ? (state.tele?.airspeed ?? 0) : 0;
  detail.update(state.p, state.t, groundSpeed);
  if(patchReady&&detail.group.visible){const count=patchGeo.getAttribute('position')?.count??0;if(count)detail.correction.update(detail.anchorPoint,patchGeo,patchAnchor,Math.round(Math.sqrt(count))-1,terrainBlend.value,recenterBlend.value,surface.revision);}
  ships.update(state.p, state.t, city.near && alt < 8000);
  bridges.night = city.night.value; bridges.update(state.p, state.t);
  // Bridges: crash into them, or thread them. Checked between this frame's and last frame's positions.
  {const here=new T.Vector3(...inertialToBody(state.p,state.t,EARTH.rotation));
   if(bridgePrev&&state.status==='flying'&&!paused&&alt<600){const events=bridges.check(bridgePrev,here);
    const hit=events.find(e=>e.type==='hit');
    if(hit){const speed=new T.Vector3(...state.v).sub(new T.Vector3(...atmosphereVelocity(state.p))).length()*1000;supercruise.stop();state.status='impact';state.body=`Hit ${hit.bridge.spec.name} at ${speed.toFixed(0)} m/s`;missions.fail(`hit ${hit.bridge.spec.name}`);}
    else{const line=missions.events(events,state.t);if(line){$('bridge-flash').textContent=line;bridgeFlash=2.4;}}}
   bridgePrev=state.status==='flying'?here:null;}
  bridgeFlash=Math.max(0,bridgeFlash-dt);($('bridge-flash') as HTMLElement).hidden=bridgeFlash<=0;
  {const panel=$('mission-panel') as HTMLElement,text=opsHud()||missions.hud(state.t);panel.hidden=!text;if(text)panel.textContent=text;panel.dataset.status=ops.id?ops.status:missions.status;panel.classList.toggle('quiet',!!ops.id&&ops.status==='flying'&&performance.now()-opsSince>8000);}
  {const loc=dirToLatLon(inertialToBody(state.p,state.t,EARTH.rotation));groundOverlay.update(loc.lat,loc.lon,detail.overlayTiles(),detail.revision,performance.now()/1000,alt<14000);groundOverlay.uniforms.overlayNight.value=city.night.value;}
  satellite.update(dt);wideImagery.update(dt);nearImagery.update(dt);
  const satLoc=dirToLatLon(inertialToBody(state.p,state.t,EARTH.rotation));
  wideImagery.fixedZoom=alt<20000?11:alt<150000?9:7;
  if(alt<2000000)void wideImagery.warm(satLoc.lat,satLoc.lon,alt,0);
  if(alt<550000)void satellite.warm(satLoc.lat,satLoc.lon,alt,groundSpeed);
  {const agl=state.tele?.agl??alt,speed=groundSpeed;nearImagery.fixedZoom=agl<450?17:16;if(agl<1800&&speed<300&&!supercruise.active)void nearImagery.warm(satLoc.lat,satLoc.lon,agl,speed);}
  if(earthMaterial.userData.shader)updateSatelliteUniforms(earthMaterial.userData.shader.uniforms,satellite);
  if(terrainMaterial.userData.shader)updateSatelliteUniforms(terrainMaterial.userData.shader.uniforms,satellite);
  for(const material of [earthMaterial,terrainMaterial])if(material.userData.shader)updateSatelliteUniforms(material.userData.shader.uniforms,wideImagery,'context');
  if(terrainMaterial.userData.shader){const u=terrainMaterial.userData.shader.uniforms;updateSatelliteUniforms(u,nearImagery,'near');const agl=state.tele?.agl??alt;if(u.nearReady)u.nearReady.value*=1-T.MathUtils.smoothstep(agl,1400,2200);if(u.nearPreviousReady)u.nearPreviousReady.value*=1-T.MathUtils.smoothstep(agl,1400,2200);}
  if (displayedGeneration === surface.generation)
    terrainBlend.value = surface.blend * surface.blend * (3 - 2 * surface.blend);
  imagery.altitude=alt;
  const geographic=dirToLatLon(inertialToBody(state.p,state.t,EARTH.rotation)),caspianView=Math.hypot((geographic.lat-40.4)*111,(geographic.lon-50.05)*85)<100;
  if(caspianView&&!imagery.busy&&imagery.origin?.z!==(alt>3500?10:12))void imagery.warm(geographic.lat,geographic.lon);
  terrainMaterial.opacity = caspianView?1-T.MathUtils.smoothstep(alt,350000,500000):terrainOpacity(alt);
  patch.visible = terrainMaterial.opacity > 0 && patchReady;
  terrainClock += dt;
  if ((alt < 90000 || caspianView&&alt<500000) && terrainClock > 0.16) {
    updatePatch();
    terrainClock = 0;
  }
  // Geometry may update at a lower rate; its floating-origin transform must follow every frame.
  if (patchReady) {
    patch.rotation.y = (state.t / EARTH.rotation) * Math.PI * 2;
    patch.position
      .set(
        ...bodyToInertial(patchAnchor.toArray() as V, state.t, EARTH.rotation),
      )
      .sub(shipP);
  }
  if (!cameraSet) {
    chaseRotation.copy(rotation);
    cameraSet = true;
  }
  chaseRotation.slerp(rotation, 1 - Math.exp(-dt * 4));
  const cameraRotation = cameraMode === "chase" ? chaseRotation : rotation;
  const fwd = new T.Vector3(0, 0, -1).applyQuaternion(cameraRotation),
    right = new T.Vector3(1, 0, 0).applyQuaternion(cameraRotation),
    top = new T.Vector3(0, 1, 0).applyQuaternion(cameraRotation);
  if (cameraMode === "planet") {
    const center = shipP.clone().negate(),
      normal = up.clone().applyAxisAngle(new T.Vector3(0, 1, 0), yaw),
      side = new T.Vector3(0, 1, 0);
    camera.position
      .copy(center)
      .addScaledVector(normal, 18000 * zoom)
      .addScaledVector(side, 3000 * orbitPitch);
    camera.up.set(0, 1, 0);
    camera.lookAt(center);
    marker.visible = true;
    marker.position.set(0, 0, 0);
    ship.visible = false;
  } else if (cameraMode === "cockpit") {
    camera.position.copy(fwd).multiplyScalar(0.011).addScaledVector(top, 0.003);
    camera.up.copy(top);
    const look = fwd
      .clone()
      .applyAxisAngle(top, -yaw * 0.4)
      .applyAxisAngle(right, orbitPitch * 0.3);
    camera.lookAt(camera.position.clone().add(look));
    marker.visible = false;
    ship.visible = false;
  } else if (cameraView !== 'chase') {
    // --- extra external views. Mouse orbit and zoom apply to all of them.
    const orbit=(v:T.Vector3)=>v.applyAxisAngle(up,yaw).applyAxisAngle(right,orbitPitch*.22).multiplyScalar(zoom);
    ship.visible=true;marker.visible=false;camera.up.copy(up);
    if(cameraView==='close'){camera.position.copy(orbit(fwd.clone().multiplyScalar(-.048).addScaledVector(top,.011)));camera.lookAt(fwd.clone().multiplyScalar(.25).addScaledVector(top,.004));}
    else if(cameraView==='wing'){camera.position.copy(orbit(right.clone().multiplyScalar(.075).addScaledVector(fwd,-.012).addScaledVector(top,.012)));camera.lookAt(fwd.clone().multiplyScalar(.012));}
    else if(cameraView==='top'){camera.position.copy(up).multiplyScalar(.2*zoom).addScaledVector(fwd,-.03);camera.up.copy(fwd);camera.lookAt(fwd.clone().multiplyScalar(.04));}
    else if(cameraView==='nose'){camera.position.copy(orbit(fwd.clone().multiplyScalar(.1).addScaledVector(top,.02).addScaledVector(right,.022)));camera.lookAt(new T.Vector3());}
    else{
      // Flyby: the camera waits in the air ahead and the aircraft tears past it.
      const air=new T.Vector3(...atmosphereVelocity(state.p)),travel=new T.Vector3(...state.v).sub(air),speed=travel.length(),here=new T.Vector3(...state.p);
      flybyClock+=dt;
      if(flybyClock>flybyUntil||flybyPoint.distanceTo(here)>Math.max(.5,speed*4)){const lead=T.MathUtils.clamp(speed*2.2,.12,6);flybyPoint.copy(here).addScaledVector(travel.lengthSq()>1e-10?travel.clone().normalize():fwd,lead).addScaledVector(right,(Math.random()<.5?-1:1)*(.03+lead*.06)).addScaledVector(up,-.006+lead*.03);
        const floor=surface.radiusM(inertialToBody(flybyPoint.toArray() as V,state.t,EARTH.rotation))/1000+.012;if(flybyPoint.length()<floor)flybyPoint.setLength(floor);flybyClock=0;flybyUntil=4.4;}
      else if(!paused)flybyPoint.addScaledVector(air,dt*effectiveRate);
      camera.position.copy(flybyPoint).sub(here);camera.lookAt(new T.Vector3());
    }
  } else {
    const offset = fwd
      .clone()
      .multiplyScalar(controlStyle === "direct" ? -.145 : -.10 - Math.min(.035, (state.tele?.airspeed ?? 0) * .00008))
      .addScaledVector(
        top,
        T.MathUtils.lerp(0.04, 0.135, T.MathUtils.clamp(alt / 600000, 0, 1)),
      )
      .applyAxisAngle(up, yaw);
    offset.applyAxisAngle(right, orbitPitch * 0.22).multiplyScalar(zoom);
    camera.position.copy(offset);
    // Keep the chase horizon level; aircraft bank remains visible against it.
    camera.up.copy(up);
    camera.lookAt(fwd.clone().multiplyScalar(.35).addScaledVector(top,.018));
    ship.visible = true;
    marker.visible = false;
  }
  if(state.status==='flying'&&!paused&&alt<1500){const loc=dirToLatLon(inertialToBody(state.p,state.t,EARTH.rotation));if(city.hit(loc.lat,loc.lon,alt-2)||detail.hit(loc.lat,loc.lon,alt-2)){const speed=new T.Vector3(...state.v).sub(new T.Vector3(...atmosphereVelocity(state.p))).length()*1000;supercruise.stop();state.status='impact';state.body=`Hit a building at ${speed.toFixed(0)} m/s`;}}
  // --- crash: one explosion per impact, wreck burns until respawn
  if(state.status==='impact'&&!wrecked){wrecked=true;const air=new T.Vector3(...state.v).sub(new T.Vector3(...atmosphereVelocity(state.p)));crashFx.trigger(up,air.lengthSq()>1e-10?air.clone().normalize():fwd,air.length()*1000);fx.flash=1;fx.shake=2.2;audio.weaponCue('hit');audio.weaponCue('missile');combat.crash();trails.reset();document.body.classList.add('crashed');$('crash-reason').textContent=state.body;}
  else if(state.status!=='impact'&&wrecked){wrecked=false;crashFx.clear();document.body.classList.remove('crashed');}
  if(wrecked){ship.visible=false;camera.position.copy(fwd).multiplyScalar(-.16-.05*Math.min(1,crashFx.age/3)).addScaledVector(up,.07+.03*Math.min(1,crashFx.age/3)).applyAxisAngle(up,crashFx.age*.07);camera.up.copy(up);camera.lookAt(up.clone().multiplyScalar(.03));}
  crashFx.update(dt,camera,innerHeight*renderer.getPixelRatio(),shipSun.color);
  boomFx.update(dt,new T.Vector3(...state.v).sub(new T.Vector3(...atmosphereVelocity(state.p))).length(),shipSun.color);
  const cues = flightCues(state.tele?.mach ?? 0, state.tele?.airspeed ?? 0, atmosphereDensity(alt), state.tele?.dynamicPressure ?? 0);
  if (motionEffects && cameraMode !== 'planet' && controlStyle !== 'direct' && !paused && state.status === 'flying') {
    fx.shake*=Math.exp(-dt*4);
    // A gentle, low-frequency nudge: transonic buffet and weapon hits only. Fast jitter read as the world shaking.
    const shake = cues.buffet * .35 + fx.shake * 3, t = state.t;
    camera.position.addScaledVector(right, (Math.sin(t * 9.1) + .5 * Math.sin(t * 15.7)) * .00004 * shake)
      .addScaledVector(top, (Math.sin(t * 7.3) + .5 * Math.sin(t * 13.1)) * .00003 * shake);
  }
  if (cameraMode !== "planet") {
    const abs = camera.position.clone().add(shipP),
      body = inertialToBody(abs.toArray() as V, state.t, EARTH.rotation),
      minimum = surface.radiusM(body) / 1000 + 0.008;
    if (abs.length() < minimum) {
      abs.setLength(minimum);
      camera.position.copy(abs.sub(shipP));
    }
  }
  camera.fov = T.MathUtils.lerp(
    camera.fov,
    cameraMode === "planet"
      ? 55
      : !motionEffects ? 58 : controlStyle === "direct" ? 55 + Math.min(12, (state.tele?.airspeed ?? 0) / 60)
        : 58 + cues.fov * .3 + (supercruise.active ? 6 : 0),
    1 - Math.exp(-dt * .6),
  );
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  summitBeacon.hidden=true;
  if(activeSummit && cameraMode!=='planet'){
    const s=activeSummit,target=crestApproach&&activeCrest?activeCrest:s,body=latLonToDir(target.lat,target.lon).map(v=>v*(EARTH.radius+target.elevation/1000)) as V,
      position=new T.Vector3(...bodyToInertial(body,state.t,EARTH.rotation)).sub(shipP),distance=position.length(),
      local=position.clone().applyMatrix4(camera.matrixWorldInverse),projected=position.clone().project(camera);
    if(local.z<0&&distance<200&&Math.abs(projected.x)<.93&&projected.y>-.75&&projected.y<.65){
      const halfWidth=Math.min(130,(innerWidth-32)/2);
      summitBeacon.hidden=false;summitBeacon.style.left=`${T.MathUtils.clamp((projected.x*.5+.5)*innerWidth,halfWidth+16,innerWidth-halfWidth-16)}px`;summitBeacon.style.top=`${(-projected.y*.5+.5)*innerHeight}px`;
      summitBeacon.textContent=`◇ ${s.name}${crestApproach?' · MODEL CREST':''} · ${distance.toFixed(1)} km`;
    }
  }
  const effectsDt = Math.min(.05, Math.max(0, state.t - lastEffectsTime)); lastEffectsTime = state.t;
  flightEffects.update(effectsDt, state.tele?.airVelocity ?? [0, 0, 0], rotation,
    supercruise.active?1:cues.flow, cues.transonic, state.t, cameraMode !== 'planet' && (alt < 50000||supercruise.active) && state.status === 'flying', motionEffects,alt,supercruise.active?Math.min(1,supercruise.speed/5000):0);
  const celestialDate = new Date(
    epoch.getTime() + state.t * 1000 + solarOffset * 3600000,
  );
  const astronomicalSun = earthFixedSun(celestialDate).applyAxisAngle(new T.Vector3(0,1,0),state.t/EARTH.rotation*Math.PI*2);
  lightDir.copy(astronomicalSun);waterClock.value=state.t;waterLight.value.copy(lightDir);
  sun.position.copy(lightDir).multiplyScalar(10000);
  shipSun.position.copy(lightDir).multiplyScalar(100);
  sunBall.position.copy(lightDir).multiplyScalar(160000).add(camera.position);
  moon.position
    .copy(
      moonPosition(celestialDate).applyAxisAngle(
        new T.Vector3(0, 1, 0),
        -siderealAngle(celestialDate) + state.t/EARTH.rotation*Math.PI*2,
      ),
    )
    .sub(shipP);
  cameraAbs.copy(camera.position).add(shipP);
  stars.position.copy(camera.position);
  const appearance = airAppearance(alt, up.dot(lightDir));
  {const m=stars.material as T.ShaderMaterial,visible=appearance.stars/.65*T.MathUtils.clamp((fx.exposure-1.15)/1.1+T.MathUtils.smoothstep(alt,40000,120000)*.55,0,1);m.uniforms.opacity.value=visible;m.uniforms.pixelRatio.value=renderer.getPixelRatio();m.uniforms.time.value=state.t;m.uniforms.twinkle.value=Math.min(1,atmosphereDensity(alt)/.4);(milkyWay.material as T.ShaderMaterial).uniforms.opacity.value=visible*T.MathUtils.clamp((fx.exposure-1.2)/1.1+T.MathUtils.smoothstep(alt,80000,200000)*.5,0,1);milkyWay.position.copy(camera.position);}
  groundHaze.setRGB(...appearance.haze);
  scenery.waterSky.value.setRGB(appearance.haze[0] * 1.375, appearance.haze[1] * (10 / 7), appearance.haze[2] * 1.25);
  groundHazeDensity = appearance.hazeDensity;
  terrainAmbient.intensity = appearance.skyLight;
  {const camBody=new T.Vector3(...inertialToBody(cameraAbs.toArray() as V,state.t,EARTH.rotation));water.update(camBody,(cameraAbs.length()-EARTH.radius)*1000,shipP.toArray() as V,state.t);
   // Jet wash: is there water under us (checked ten times a second), how high is it, how hard are we hitting it?
   const shipBody=new T.Vector3(...inertialToBody(state.p,state.t,EARTH.rotation)),sl=dirToLatLon(shipBody.toArray() as V);
   if(Math.abs(state.t-overWaterAt)>.1){overWaterAt=state.t;overWater=state.status==='flying'&&(!!scenery.index.at(sl.lat,sl.lon,'water')||groundOverlay.isWater(sl.lat,sl.lon)||isOcean());}
   const waterLevel=water.active?water.level:surface.height(sl.lat,sl.lon),groundV=new T.Vector3(...inertialToBody(add(state.v,mul(atmosphereVelocity(state.p),-1)),state.t,EARTH.rotation)).multiplyScalar(1000);
   const day=T.MathUtils.smoothstep(up.dot(lightDir),-.02,.12);
   wash.update({body:shipBody,velocity:groundV,water:waterLevel,over:overWater,throttle:enginePower,time:state.t,dt:paused?0:dt},shipP.toArray() as V,{color:terrainSun.color.clone().multiplyScalar(terrainSun.intensity*day*.45),ambient:groundHaze.clone().multiplyScalar(.6+1.4*appearance.skyLight),haze:groundHaze,hazeK:0});
   water.wash(sl.lat,sl.lon,wash.intensity,(shipBody.length()-EARTH.radius)*1000-waterLevel-1.5,state.t);
   planeWater.value=water.active?1:0;
   water.light(lightDir,terrainSun.color.clone().multiplyScalar(terrainSun.intensity),T.MathUtils.smoothstep(up.dot(lightDir),-.02,.12),groundHaze,groundHazeDensity,appearance.skyLight);}
  globeAmbient.intensity = .015 + .105 * T.MathUtils.smoothstep(up.dot(lightDir), -.15, .15);
  if (terrainMaterial.userData.shader)
    terrainMaterial.userData.shader.uniforms.groundHazeDensity.value = groundHazeDensity;
  cloudMat.opacity = .62*T.MathUtils.smoothstep(alt,28000,50000);
  clouds.visible = alt>28000;
  perf.mark('world');renderer.info.reset();
  if(pendingRatio){renderer.setPixelRatio(pendingRatio);renderer.setSize(innerWidth,innerHeight);post.resize();pendingRatio=0;}
  post.begin();
  const worldDt=paused?0:Math.max(0,state.t-lastTrafficTime);lastTrafficTime=state.t;
  uiClock+=dt;const slowUi=uiClock>=.1||paused;if(slowUi)uiClock=0;surfaceTraffic.view.labels=slowUi;
  surfaceTraffic.update(worldDt,state.t,shipP,alt);
  renderer.render(scene, camera);
  const u = atmospherePass.material.uniforms;
  u.eye.value.copy(cameraAbs);
  u.inverseProjection.value.copy(camera.projectionMatrixInverse);
  u.cameraRotation.value.copy(camera.matrixWorld);
  u.sunDirection.value.copy(lightDir);
  seaNear.value=1-T.MathUtils.smoothstep(alt,20000,140000);
  u.gain.value=T.MathUtils.lerp(1.25,.72,T.MathUtils.smoothstep(alt,25000,220000));
  if (!new URLSearchParams(location.search).has("raw"))
    renderer.render(atmospherePass.scene, atmospherePass.camera);
  terrainSun.position.copy(lightDir).multiplyScalar(10000);
  // Local terrain owns its depth, including mapped surfaces below the globe's sea-level shell.
  // The river surface draws after the whole local scene against its depth, so only what stands above the water hides it.
  if (patch.visible){water.reflect(renderer,camera,[terrainScene,shipScene]);renderer.clearDepth();renderer.render(terrainScene, camera);if(water.active||wash.mesh.visible)renderer.render(waterScene,camera);}
  // The blast pass needs the terrain's depth to char the ground and hide the cloud behind hills, so keep it while a blast is in range.
  if(!postFrame.nuke)renderer.clearDepth();
  ship.quaternion.copy(rotation);
  shipSky.intensity = appearance.shipSky;
  const hovering = keys.has("r") || assist;
  ship.userData.update({
    throttle: state.status === "impact" ? 0 : deliveredThrottle,
    torch,
    hover: hovering ? 1 : 0,
    pitch: control.angularVelocity.x,
    roll: control.angularVelocity.z,
    gear: gear ? 1 : 0,
    heat: Math.max(Math.min(2, (state.heat ?? 0) / 30), entryGlow()),
    flow: state.tele
      ? new T.Vector3(...state.tele.airVelocity).applyQuaternion(
          rotation.clone().invert(),
        )
      : null,
    time: state.t,
    ambient: Math.min(1, atmosphereDensity(alt) / 1.225),
  });
  weaponAim.set(0,0,-1).applyQuaternion(rotation);
  if(aimPointer&&combat.active){const v=new T.Vector3(aimPointer.x,aimPointer.y,.5).unproject(camera).sub(camera.position).normalize();if(v.dot(weaponAim)>.6)weaponAim.copy(v);}
  for(const drone of combat.targets){const body=inertialToBody(drone.p.toArray() as V,state.t,EARTH.rotation),minimum=surface.radiusM(body)/1000+.3;if(drone.p.length()<minimum)drone.p.setLength(minimum);}
  
  const trafficUTC=celestialDate.getTime();
  airTraffic.update(trafficUTC/1000,state.t,body=>body.distanceTo(new T.Vector3(...inertialToBody(state.p,state.t,EARTH.rotation)))<20?surface.radiusM(body.toArray() as V)/1000:body.length()-.004);
  trafficView.draw(shipP);orbitTraffic.update(trafficUTC,state.t,shipP);combat.external=[...orbitTraffic.targets,...sams.targets,...surfaceTraffic.targets,...fleets.targets,...raid.targets];
  runWarfare(paused?0:worldDt,shipP,alt);
  {const shipBody=new T.Vector3(...inertialToBody(state.p,state.t,EARTH.rotation));sams.update(paused?0:worldDt,state.t,shipP,shipBody,alt,state.tele?.agl??alt,state.status==='flying',combat);}
  if(!combat.active&&!combat.completed&&state.status!=='impact')combat.startPatrol(shipP,rotation,new T.Vector3(...state.v));
  combat.allowEngage=state.status==='flying'&&alt<50000;
  feelNuke(worldDt,shipP);
  if(!paused&&state.status!=='impact')combat.advance(worldDt,shipP,rotation,new T.Vector3(...state.v),weaponAim,state.status==='flying'&&(gunHeld||keys.has('z')),state.status==='flying'&&(missileHeld||keys.has('x')));
  if(slowUi)radarContacts=[...surfaceTraffic.contacts,...fleets.contacts,...raid.contacts,...combat.targets.map(d=>({id:'enemy-'+d.id,name:d.model?AIRCRAFT[d.model].name:'HOSTILE',kind:'hostile' as const,p:d.p,v:d.v,detail:(d.model?LOADOUTS[d.model]?.name:'Patrol')+' · '+(d.ai?.mode??'patrol'),targetId:d.id})),...sams.targets.map(d=>({id:'sam-'+d.id,name:'SAM BATTERY',kind:'ground' as const,p:d.p,v:d.v,detail:`Surface-to-air · ${SAM.detect} km radar · ${SAM.ceiling} km ceiling`,targetId:d.id})),...airTraffic.flights.map(f=>({id:f.id,name:f.id+' · '+AIRLINERS[f.type].name,kind:'civil' as const,p:f.p,v:f.v,detail:f.route+' · '+f.phase+' · '+Math.round(f.speed*3600)+' km/h'})),...orbitTraffic.contacts];
  const contacts=radarContacts;
  const threats=combat.threats();threats.locks.push(...sams.locks(),...fleets.locks());
  // The radar scope, moving map and numeric readouts repaint ten times a second; redrawing them every frame cost more than it showed.
  if(slowUi)radar.draw(contacts,shipP,trueHeading(rotation,up),state.t,trafficUTC,threats);
  rwr.update(threats,shipP,new T.Vector3(...state.v),trueHeading(rotation,up),performance.now()/1000,paused||state.status!=='flying'||!audio.enabled);
  const tracked=contacts.find(c=>c.id===radar.selected);orbitalLabel.hidden=true;
  if(tracked&&lineOfSight(shipP,tracked.p)){const relative=tracked.p.clone().sub(shipP),view=relative.clone().applyMatrix4(camera.matrixWorldInverse),pos=relative.project(camera);if(view.z<0&&Math.abs(pos.x)<.88&&Math.abs(pos.y)<.8){orbitalLabel.hidden=false;orbitalLabel.style.left=((pos.x*.5+.5)*innerWidth)+'px';orbitalLabel.style.top=((-pos.y*.5+.5)*innerHeight-18)+'px';orbitalLabel.textContent=tracked.name+'\n'+tracked.p.distanceTo(shipP).toFixed(2)+' km · '+tracked.detail;}}

  if(combat.active&&!combat.persistent&&combat.lock===null&&!combat.completed&&(fx.lockClock+=dt)>.35){fx.lockClock=0;combat.select(shipP,weaponAim);}
  detail.drawLabels(camera,state.p,state.t,!document.body.classList.contains('clean')&&!combat.engaged&&state.status!=='impact'&&cameraMode!=='planet');
  combatView.daylight=T.MathUtils.smoothstep(shipP.clone().normalize().dot(lightDir),-.1,.2);
  combatView.draw(camera,shipP,rotation,weaponAim,state.t,cameraMode!=='planet',new T.Vector3(...state.v));
  {const flying=state.status==='flying'&&cameraMode!=='planet',air=Math.min(1,atmosphereDensity(alt)/.45),day=T.MathUtils.smoothstep(up.dot(lightDir),-.1,.15);
   trails.update(state.t,shipP,rotation,camera.position,{tips:flying?Math.min(1,Math.max(0,((state.tele?.gLoad??1)-2.4)/3)*air+cues.transonic*.7):0,contrail:flying&&alt>7500&&alt<15500&&deliveredThrottle>.12&&!supercruise.active?.8:0,energy:flying&&supercruise.active?Math.min(1,.35+supercruise.speed/8000):flying&&torch&&deliveredThrottle>.3?.55:0},new T.Color(1,1,1).multiplyScalar(.12+.95*day),new T.Color(.45,1.3,3.2).multiplyScalar(supercruise.active?1.6:1));}
  renderer.render(shipScene, camera);
  perf.mark('scene');
  finishFrame(dt,alt,up,cues);
  instruments.draw(camera, rotation, state.tele, cameraMode, alt >= KARMAN_LINE ? len(state.v) : undefined,altimetry);
  audio.update(
    deliveredThrottle,
    state.tele?.airspeed ?? 0,
    atmosphereDensity(alt),
    paused || state.status === "impact",
    hovering,
  );
  if(!paused&&state.status==='flying'&&altimetry.level==='critical')audio.terrainCue();
  flightMap.satellite=satellite;flightMap.wideImagery=wideImagery;
  const here = dirToLatLon(inertialToBody(state.p, state.t, EARTH.rotation));
  $("terrain-status").textContent = terrainBuilder.error
    ? "Terrain mesh unavailable · reload to retry"
    : surface.describe(here.lat, here.lon) + (surface.detailHeld ? " · update held near ground" : surface.previous ? surface.transitionReady ? " · refining surface" : " · preparing transition" : "");
  $("scenery-status").textContent =
    scenery.ready && scenery.group.visible
      ? "Alpine lakes & forests · mapped boundaries"
      : "Detailed regional scenery unavailable here";
  $("sound").classList.toggle("on", audio.enabled);$("sound").querySelector(".sound-icon")!.textContent=audio.enabled?"🔊":"🔇";$("sound").setAttribute("aria-label",audio.enabled?"Sound on":"Sound off");
  if(slowUi)updateUI(alt);
  frames++;
  frameTime += dt;
  if (frameTime > 1) {
    $("fps").textContent = `${Math.round(frames / frameTime)} FPS`;
    // Adaptive resolution aims for a steady 55-60 fps: shed pixels after two slow seconds, win them back after
    // four fast ones. The gap between the thresholds stops it hunting up and down.
    {const rate=frames/frameTime,ratio=renderer.getPixelRatio(),live=!paused&&!document.hidden,ceiling=Math.min(devicePixelRatio,MAX_PIXEL_RATIO);
     // Resizing the canvas clears it, so the change waits for the start of the next frame; doing it here left a dark frame on screen.
     // The first 12 seconds of a flight are spent loading scenery, so the frame rate then says nothing about the hardware.
     const apply=(next:number)=>{pendingRatio=next;fx.slow=fx.quality=0;};fx.settle=live?fx.settle+1:fx.settle;if(fx.settle<12){fx.slow=fx.quality=0;}
     fx.slow=rate<48&&live&&fx.settle>=12?fx.slow+1:0;if(fx.slow>=2&&ratio>MIN_PIXEL_RATIO)apply(Math.max(MIN_PIXEL_RATIO,ratio-.2));
     fx.quality=rate>57&&live&&fx.settle>=12?fx.quality+1:0;if(fx.quality>=4&&ratio<ceiling)apply(Math.min(ceiling,ratio+.1));}
    frames = 0;
    frameTime = 0;
  }
}
const postFrame={camera,eye:cameraAbs,eyeNoise:new T.Vector3(),spin:0,sunDirection:lightDir,sunLight:new T.Color(),skyLight:new T.Color(),hazeColor:new T.Color(),hazeK:.01,cloudFade:1,shellTop:6,time:0,exposure:1.25,speedBlur:0,shock:0,shockCentre:new T.Vector2(.5,.5),sunScreen:new T.Vector3(),flash:0,damage:0,warp:0,nuke:null as ReturnType<Nuke['frame']>};
const Y_AXIS=new T.Vector3(0,1,0);
function finishFrame(dt:number,alt:number,up:T.Vector3,cues:{flow:number;transonic:number;buffet:number;fov:number}){
  const spin=state.t/EARTH.rotation*Math.PI*2,elevation=up.dot(lightDir),day=T.MathUtils.smoothstep(elevation,-.1,.1),high=T.MathUtils.smoothstep(elevation,0,.35);
  const eyeBody=cameraAbs.clone().applyAxisAngle(Y_AXIS,-spin),wrap=(v:number)=>((v%48)+48)%48;
  postFrame.eyeNoise.set(wrap(eyeBody.x+state.t*.007),wrap(eyeBody.y),wrap(eyeBody.z+state.t*.004));postFrame.spin=spin;
  postFrame.sunLight.setRGB(T.MathUtils.lerp(1,1,high),T.MathUtils.lerp(.42,.95,high),T.MathUtils.lerp(.16,.88,high)).multiplyScalar(2.15*day);
  postFrame.skyLight.setRGB(.004+.3*day,.006+(.2+.2*high)*day,.013+(.3+.28*high)*day);
  postFrame.hazeColor.copy(groundHaze);postFrame.hazeK=.012*groundHazeDensity;
  postFrame.cloudFade=cameraMode==='planet'?0:1-T.MathUtils.smoothstep(alt,30000,52000);
  fx.shellClock+=dt;
  if(fx.shellClock>.5&&alt<60000){fx.shellClock=0;const loc=dirToLatLon(eyeBody.toArray() as V);let top=0;for(let y=-3;y<=3;y++)for(let x=-3;x<=3;x++)top=Math.max(top,surface.coarse(T.MathUtils.clamp(loc.lat+y,-89.9,89.9),loc.lon+x/Math.max(.2,Math.cos(loc.lat*Math.PI/180))));fx.shellTop=5.1+top/1000*1.02;}
  postFrame.shellTop=fx.shellTop;postFrame.time=state.t;
  fx.exposure+=(T.MathUtils.lerp(2.5,1.22,T.MathUtils.smoothstep(elevation,-.22-Math.min(.3,alt/1500000),.06))-fx.exposure)*(1-Math.exp(-dt*1.2));postFrame.exposure=fx.exposure;
  const superFactor=supercruise.active?Math.min(1,supercruise.speed/6000):0,dense=Math.min(1,atmosphereDensity(alt)/.05);
  postFrame.warp=motionEffects?superFactor:0;
  postFrame.speedBlur=motionEffects&&cameraMode!=='planet'&&state.status!=='impact'?Math.min(.6,superFactor*(.25+.3*dense)):0;
  const pulse=motionEffects?sonic.pulse:0;postFrame.shock=pulse>0?1-pulse:0;
  const centre=new T.Vector3(0,0,0).project(camera);postFrame.shockCentre.set(centre.x*.5+.5,centre.y*.5+.5);
  const sunView=lightDir.clone().multiplyScalar(1000).add(camera.position).project(camera),behind=lightDir.dot(camera.getWorldDirection(new T.Vector3()))<=0;
  const b=cameraAbs.dot(lightDir),blocked=b<0&&cameraAbs.lengthSq()-b*b<EARTH.radius*EARTH.radius;
  const edge=Math.max(Math.abs(sunView.x),Math.abs(sunView.y));
  postFrame.sunScreen.set(sunView.x*.5+.5,sunView.y*.5+.5,behind||blocked?0:(1-T.MathUtils.smoothstep(edge,.85,1.25))*T.MathUtils.smoothstep(elevation,-.05,.12));
  city.night.value=1-T.MathUtils.smoothstep(up.dot(lightDir),-.12,.1);city.hazeColor.value.copy(postFrame.hazeColor);city.hazeK.value=postFrame.hazeK;city.sky.value.copy(postFrame.skyLight);
  fx.flash*=Math.exp(-dt*5);postFrame.flash=fx.flash+nukeFlash;postFrame.nuke=nuke.frame(state.t,cameraAbs);postFrame.damage=Math.min(1,(state.structuralDamage??0)*1.2+Math.max(0,(state.heat??0)-60)/80+(combat.active?combat.hurt*.55+Math.max(0,.6-combat.health/100)*.5:0));
  perf.mark('interface');
  post.finish(postFrame);
  perf.mark('post');
}
function updateUI(alt: number) {
  const t = state.tele,
    environment = environmentAt(alt),
    space = environment.space,
    orbit = trajectory(state),
    loc = dirToLatLon(inertialToBody(state.p, state.t, EARTH.rotation));
  $("altitude").innerHTML =
    alt >= 100000
      ? `${(alt / 1000).toLocaleString("en-GB", { maximumFractionDigits: 0 })}<small>km</small>`
      : `${alt.toLocaleString("en-GB", { minimumFractionDigits:1,maximumFractionDigits: 1 })}<small>m</small>`;
  $('clearance-readout').textContent=altimetry&&alt<100000?`MODEL CLEARANCE ${altimetry.clearance.toFixed(1)} m`:'MODEL CLEARANCE —';
  document.body.classList.toggle('summit-active',!!altimetry?.summit);document.body.classList.toggle('super-active',supercruise.active);
  $('clearance-readout').className=`clearance-readout ${altimetry?.level??'none'}`;
  $('altimetry-reference').textContent=altimetry?.summit?`${altimetry.summit.name} reference ${altimetry.summit.aboveReference>=0?'+':''}${altimetry.summit.aboveReference.toFixed(1)} m · ${altimetry.summit.distance.toFixed(0)} m horizontal offset`:'Aircraft reference point · clearance uses modeled contact probes';
  const v = space ? len(state.v) : (t?.airspeed ?? 0) / 1000;
  $("speed").innerHTML = space
    ? `${v.toFixed(2)}<small>km/s</small>`
    : `${(v * 1000).toFixed(0)}<small>m/s</small>`;
  $("speed-label").textContent = space ? "EARTH-RELATIVE VELOCITY" : "AIRSPEED";
  $("vertical").innerHTML =
    `${(t?.verticalSpeed ?? 0).toFixed(0)}<small>m/s</small>`;
  { const shown = Math.round((state.status === 'landed' || controlStyle === 'direct' ? throttle : deliveredThrottle) * 100); $('throttle-readout').innerHTML = `${shown}<small>% ${gear ? '· GEAR' : ''}</small>`; ($('throttle-bar').firstElementChild as HTMLElement).style.width = shown + '%'; }
  $("systems").innerHTML =
    `${state.fuel.toFixed(0)}<small>% / ${(state.heat ?? 0).toFixed(0)}%</small>`;
  $("coordinates").textContent =
    `${Math.abs(loc.lat).toFixed(2)}° ${loc.lat >= 0 ? "N" : "S"} · ${Math.abs(loc.lon).toFixed(2)}° ${loc.lon >= 0 ? "E" : "W"}`;
  $('summit-flight').hidden=!activeSummit&&!activeCaspian;
  if(activeCaspian)$('summit-flight').textContent=`Caspian Sea · fixed water reference −28 m MSL · mapped shoreline · ${imagery.status}. Not a live water-level measurement.`;
  if(activeSummit){
    const s=activeSummit,h=surface.height(s.lat,s.lon),delta=h-s.elevation;
    $('summit-flight').textContent=`${s.name} · reference ${s.elevation.toLocaleString(undefined,{maximumFractionDigits:2})} m MSL · sampled terrain ${h.toFixed(0)} m (${delta>=0?'+':''}${delta.toFixed(0)} m). ${imagery.status}. Approximate depiction.`;
    if(activeCrest)$('summit-flight').textContent+=` ${crestApproach?'Target: modeled crest':'Nearby modeled crest'} ${activeCrest.elevation.toFixed(0)} m · ${activeCrest.offsetMetres.toFixed(0)} m from reference. Surveyed summit position unresolved.`;
  }
  const heading=trueHeading(rotation,new T.Vector3(...state.p).normalize());
  flightMap.update(loc.lat,loc.lon,heading,state.t,scenery.features,imagery);
  const date=new Date(epoch.getTime()+state.t*1000+solarOffset*3600000),solar=solarPosition(date,loc.lat,loc.lon);
  $('solar-readout').textContent=`${date.toISOString().slice(0,19).replace('T',' ')} UTC · SUN ${solar.azimuth.toFixed(0)}° AZ / ${solar.elevation.toFixed(1)}° EL`;
  $("clock").textContent = new Date(state.t * 1000).toISOString().slice(11, 19);
  const phase =
    state.status === "impact"
      ? "FLIGHT ENDED"
      : paused
        ? "PAUSED"
        : state.status === "landed"
          ? "ON THE SURFACE"
          : space
            ? orbit.phase.toUpperCase()
            : "ATMOSPHERIC FLIGHT";
  $("phase").textContent = phase;
  const mach = t?.mach ?? 0, inAir = !space && atmosphereDensity(alt) > .001;
  $('mach-regime').textContent = !inAir ? 'SPACE FLIGHT' : `${mach >= 1.005 ? 'SUPERSONIC' : mach >= .85 ? 'TRANSONIC' : 'SUBSONIC'} · M ${mach.toFixed(2)}`;
  $('mach-regime').classList.toggle('supersonic', inAir && mach >= 1.005);
  $('mach-fill').style.width = `${inAir ? Math.min(100, mach / 1.5 * 100) : 0}%`;
  $('run-goal').textContent = tour ? `CRUISE HOLD · ${timeRate}× · GREAT CIRCLE` : select('scenario').value === 'mach'
    ? sonic.crossings ? 'MACH 1 REACHED · HOLD CTRL TO BRAKE' : 'MACH RUN · HOLD SHIFT TO BREAK MACH 1'
    : controlStyle === 'direct' ? 'DIRECT · SHIFT / CTRL THROTTLE' : controlStyle === 'mouse' ? 'HOLD LEFT MOUSE TO STEER · SHIFT BOOST' : 'W / S PITCH · A / D BANK · SHIFT BOOST';
  $('mach-flash').hidden = sonic.pulse <= 0 || altimetry?.level==='critical';
  $('mach-flash').style.opacity = String(motionEffects ? sonic.pulse : sonic.pulse > 0 ? 1 : 0);
  $('boost').classList.toggle('on', boostActive);
  $('airbrake').classList.toggle('on', airbrake > 0);
  const mouseStick = $('mouse-stick'); mouseStick.hidden = !mouseAim.active;
  mouseStick.style.left = `${mouseAim.originX}px`; mouseStick.style.top = `${mouseAim.originY}px`;
  (mouseStick.firstElementChild as HTMLElement).style.transform = `translate(${mouseAim.x * 38}px,${mouseAim.y * 38}px)`;
  $('boost').firstChild!.textContent = controlStyle === 'direct' ? 'Throttle + ' : 'Boost ';
  $('airbrake').firstChild!.textContent = controlStyle === 'direct' ? 'Throttle − ' : 'Airbrake ';
  $('motion-effects').textContent = motionEffects ? 'Motion on' : 'Motion off';
  select('controls').value = controlStyle;
  $("air-layer").textContent = environment.label;
  $("air-range").textContent = environment.range;
  const site = $("landing-site");
  site.hidden = !t || t.agl > 1500 || t.groundSlope === undefined;
  site.textContent = t?.groundSlope === undefined ? "" : `Ground slope ${t.groundSlope.toFixed(1)}° · ${LANDING.maxSlope}° landing limit`;
  site.classList.toggle("unsafe", (t?.groundSlope ?? 0) > LANDING.maxSlope);
  $("space-boundary").textContent = space
    ? "Above the 100 km Kármán line"
    : `${((KARMAN_LINE - Math.max(0, alt)) / 1000).toFixed(1)} km to the Kármán line`;
  $("region").textContent = state.status === "landed" ? "Back on Earth."
    : space ? "The blue planet."
    : alt >= 50000 ? "At the edge of space."
    : alt >= 12000 ? "Above the weather."
    : "A world to explore.";
  $('aircraft-readout').textContent='PATHFINDER X1 · fusion / VTOL / orbital drive · SR-71 inspired cruise · reinforced hull';
  $('time-readout').textContent=`TIME ${paused?'PAUSED · ':''}${effectiveRate}× active / ${timeRate}× requested${!tour&&effectiveRate<timeRate?' · free flight limited; cruise hold enables 60–240×':''}`;
  if(tour){const summary=tour.summary(timeRate);$('tour-title').textContent=tour.completed?'FULL EARTH LAP COMPLETE':'SR-71 · GREAT-CIRCLE CRUISE';$('tour-progress').textContent=`${(summary.progress*100).toFixed(1)}% · ${(summary.distance/1000).toFixed(0)} / ${(tour.plan.distance/1000).toFixed(0)} km · virtual refuels ${summary.refuels}`;$('tour-meter').setAttribute('value',String(summary.progress));$('tour-eta').textContent=`${(summary.remaining/3600).toFixed(2)} h simulated · ${(summary.wallRemaining/60).toFixed(1)} min at ${timeRate}× · ${summary.completed?'returned to start':'heading follows great circle'}`;}
  $("reference-height").textContent = `${(alt / 1000).toFixed(1)} km above mean sea level`;
  $("reference-orbit").textContent = `${orbit.circularSpeed.toFixed(2)} km/s`;
  $("reference-escape").textContent = `${orbit.escapeSpeed.toFixed(2)} km/s`;
  $("reference-period").textContent = `${(orbit.circularPeriod / 60).toFixed(1)} min`;
  const density = atmosphereAt(alt).density;
  $("reference-airlimit").textContent = alt > 86000 ? "Negligible modeled air load"
    : `${Math.sqrt(2 * VEHICLE.maxDynamicPressure / density).toFixed(0)} m/s airspeed`;
  $("reference-trajectory").textContent = space
    ? `${orbit.phase} · predicted perigee ${(orbit.perigee / 1000).toFixed(0)} km`
    : "Powered atmospheric flight · terrain clearance required";
  let message = paused
    ? "SIMULATION PAUSED"
    : state.status === "impact"
      ? `${state.body.toUpperCase()} · START / RESET TO TRY AGAIN`
      : state.status === "landed"
        ? (state.roll ?? 0) > 2 ? `ROLLING ${(state.roll ?? 0).toFixed(0)} m/s · CTRL BRAKES · W ROTATES AT 95` : "= OR SHIFT FOR THRUST · W TO ROTATE AT 95 m/s · R FOR VERTICAL LIFT"
        : assist
          ? (t?.groundSlope ?? 0) > LANDING.maxSlope && (t?.agl ?? 1e9) < 150
            ? "STEEP TERRAIN · ASSIST HOLDING · CHOOSE ANOTHER SITE"
            : "DESCENT ASSIST · BRAKING AND ALIGNING WITH TERRAIN"
          : entry
            ? "ENTRY ATTITUDE HOLD · BELLY SHIELD INTO THE FLOW"
            : boostActive && !torch && (t?.dynamicPressure ?? 0) > 85000
              ? "AIR LOAD GOVERNOR · CLIMB FOR MORE SPEED"
            : torch && alt < 30000
              ? "DENSE AIR · TORCH LIMITED TO NORMAL DRIVE"
              : (t?.dynamicPressure ?? 0) > VEHICLE.maxDynamicPressure*.85
                ? "HIGH DYNAMIC PRESSURE · REDUCE SPEED"
                : (state.heat ?? 0) > 65
                  ? "HULL TEMPERATURE CRITICAL"
                  : "";

  if((state.structuralDamage??0)>0.01)message+=` · AIRFRAME DAMAGE ${((state.structuralDamage??0)*100).toFixed(0)}%`;
  if((t?.gLoad??0)>9&&(t?.dynamicPressure??0)>500)message+=' · HIGH G LOAD · EASE STICK';
  if(altimetry?.message)message=`${message?message+' · ':''}${altimetry.message}`;
  $('notice').classList.toggle('terrain-danger',altimetry?.level==='critical');
  $('notice').classList.toggle('terrain-caution',altimetry?.level==='caution');
  $("notice").textContent = message;
}
$("restart").onclick = () => activeSummit && select('scenario').value==='summit' ? void flySummit(activeSummit,crestApproach) : reset();
$("pause").onclick = () => {
  paused = !paused;
  sync();
};
$("torch").onclick = () => {
  torch = !torch;
  sync();
};
$("gear").onclick = () => {
  gear = !gear;
  sync();
};
$("assist").onclick = () => {
  assist = !assist;
  entry = false;
  sync();
};
$("throttle-down").onclick = () => { throttle = Math.max(0, Math.round(throttle * 10 - 1) / 10); sync(); };
$("throttle-up").onclick = () => { throttle = Math.min(1, Math.round(throttle * 10 + 1) / 10); sync(); };
$("credits-toggle").onclick = () => { const open = document.body.classList.toggle("credits-open"); $("credits-toggle").setAttribute("aria-expanded", String(open)); };
$("throttle").oninput = (e) => {
  throttle = Number((e.target as HTMLInputElement).value) / 100;
  sync();
};
select("camera").onchange = () => {
  setView(select("camera").value as View);
  yaw = 0;
  orbitPitch = 0;
  zoom = 1;
};
select("warp").onchange = () => {timeRate = Number(select("warp").value);if(!TIME_RATES.includes(timeRate as 1))timeRate=1;};
document.querySelectorAll("select").forEach((element) => {
  element.addEventListener("change", () => element.blur());
});
select('controls').onchange = () => {
  controlStyle = select('controls').value as ControlStyle; clearPilot(); control.reset();
  try { localStorage.setItem('earth-fly-controls', controlStyle); } catch {}
};
$('motion-effects').onclick = () => {
  motionEffects = !motionEffects;
  try { localStorage.setItem('earth-fly-motion', String(motionEffects)); } catch {}
};
for (const [id, key] of [['boost', 'shift'], ['airbrake', 'control']]) {
  const button = $(id);
  button.onpointerdown = event => { keys.add(key); button.setPointerCapture(event.pointerId); };
  button.onpointerup = button.onpointercancel = button.onlostpointercapture = () => keys.delete(key);
  button.onkeydown = event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); keys.add(key); } };
  button.onkeyup = () => keys.delete(key);
  button.onblur = () => keys.delete(key);
}
$("collapse").onclick = () => $("desk").classList.toggle("collapsed");
$("clean").onclick = () => document.body.classList.toggle("clean");
const guide = $("guide") as HTMLDialogElement;
$("help-button").onclick = () => {
  clearPilot();
  paused = true;
  sync();
  guide.showModal();
};
$("close-guide").onclick = () => guide.close();
guide.addEventListener("close", () => {
  paused = false;
  clearPilot();
  sync();
});
window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (["boost", "airbrake"].includes((e.target as HTMLElement).id) && [" ", "Enter"].includes(e.key)) return;
  if ((e.target as HTMLInputElement).type === "range" && k.startsWith("arrow")) return;
  if (
    guide.open ||
    document.querySelector("dialog[open]") ||
    ["SELECT", "TEXTAREA"].includes((e.target as HTMLElement).tagName) ||
    ((e.target as HTMLInputElement).tagName === "INPUT" &&
      (e.target as HTMLInputElement).type !== "range")
  )
    return;
  if ([" ", "enter", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k))
    e.preventDefault();
  keys.add(k);
  if (e.repeat) return;
  if(k==='c'&&combat.active)combat.select(new T.Vector3(...state.p),weaponAim);
  if(k==='n')dropNuke();
  if(k==='`'||k==='f3'){perf.toggle();e.preventDefault();}
  if(ops.id&&(ops.status!=='flying'||state.status==='impact')&&(k==='enter'||k==='r')){ops.restart?.();return;}
  if(missions.active&&(missions.status!=='flying'||state.status==='impact')&&(k==='enter'||k==='r')){void startMission(missions.active);return;}
  if(state.status==='impact'&&(k==='enter'||k==='r')){respawn();return;}
  if(k==='escape'&&missions.active)missions.stop();
  if(k==='y'){toggleSuper();}
  if(k==='escape'&&!radar.dialog.open){combat.clear();stopSuper();}

  if (k === " ") paused = !paused;
  if (k === "=") throttle = Math.min(1, Math.round(throttle * 10 + 1) / 10);
  if (k === "-") throttle = Math.max(0, Math.round(throttle * 10 - 1) / 10);
  if (k === "+") throttle = 1;
  if (k === "_") throttle = 0;
  if (k === "m") torch = !torch;
  if (k === "g") gear = !gear;
  if (k === "v") {
    assist = !assist;
    entry = false;
  }
  if (k === "b") {
    entry = !entry;
    assist = false;
  }
  if (k === "h") document.body.classList.toggle("clean");
  if (/^[1-8]$/.test(k) && !e.ctrlKey && !e.metaKey && !e.altKey) setView(VIEWS[Number(k) - 1].id);
  sync();
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener("blur", () => {
  clearPilot();
  paused = true;
  sync();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    clearPilot();
    paused = true;
    sync();
  }
});
renderer.domElement.addEventListener("pointerdown", (e) => {
  if(combat.active&&e.button===0&&controlStyle!=='mouse'){gunHeld=true;renderer.domElement.setPointerCapture(e.pointerId);return;}
  drag = true;
  if (controlStyle === 'mouse' && e.button === 0) {
    mouseAim.active = true; mouseAim.originX = e.clientX; mouseAim.originY = e.clientY;
  }
  lastX = e.clientX;
  lastY = e.clientY;
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener("pointermove", (e) => {
  aimPointer={x:e.clientX/innerWidth*2-1,y:1-e.clientY/innerHeight*2};
  if (!drag) return;
  if (mouseAim.active) {
    mouseAim.x = T.MathUtils.clamp((e.clientX - mouseAim.originX) / 150, -1, 1);
    mouseAim.y = T.MathUtils.clamp((e.clientY - mouseAim.originY) / 150, -1, 1);
    return;
  }
  yaw += (e.clientX - lastX) * 0.007;
  orbitPitch = T.MathUtils.clamp(
    orbitPitch + (e.clientY - lastY) * 0.009,
    -3,
    3,
  );
  lastX = e.clientX;
  lastY = e.clientY;
});
const releaseAim = () => { gunHeld=false; drag = false; mouseAim.active = false; mouseAim.x = mouseAim.y = 0; };
renderer.domElement.addEventListener('pointerup', releaseAim);
renderer.domElement.addEventListener('pointercancel', releaseAim);
renderer.domElement.addEventListener('lostpointercapture', releaseAim);
renderer.domElement.addEventListener('contextmenu', event => event.preventDefault());
renderer.domElement.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    zoom = T.MathUtils.clamp(zoom * Math.exp(e.deltaY * 0.001), 0.45, 5);
  },
  { passive: false },
);
window.addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);post.resize();
});
Promise.all([
  load("textures/earth.jpg"),
  load("textures/clouds.png"),
  load("textures/water.png"),
])
  .then(async ([earth, cloud, water]) => {
    oceanMask.value=water;water.wrapS=T.RepeatWrapping;
    earth.colorSpace = T.SRGBColorSpace;
    earth.wrapS = T.RepeatWrapping;
    earth.anisotropy = renderer.capabilities.getMaxAnisotropy();
    earthMaterial.map = earth;
    earthMaterial.needsUpdate = true;
    terrainMaterial.map = earth;
    terrainMaterial.needsUpdate = true;
    cloud.colorSpace = T.SRGBColorSpace;
    cloud.wrapS=T.RepeatWrapping;weatherMap.value=cloud;
    cloudMat.map = cloud;
    cloudMat.needsUpdate = true;
    const c = document.createElement("canvas");
    imageW = c.width = water.image.width;
    imageH = c.height = water.image.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(water.image, 0, 0);
    earthPixels = ctx.getImageData(0, 0, imageW, imageH).data;
    const roughness = ctx.getImageData(0, 0, imageW, imageH);
    for (let i = 0; i < roughness.data.length; i += 4) {
      const value = 240 - roughness.data[i] * 0.7;
      roughness.data[i] = roughness.data[i + 1] = roughness.data[i + 2] = value;
    }
    ctx.putImageData(roughness, 0, 0);
    earthMaterial.roughnessMap = new T.CanvasTexture(c);
    earthMaterial.roughnessMap.wrapS = T.RepeatWrapping;
    earthMaterial.needsUpdate = true;
    await imagery.warmOverview();
    await surface.init();
    {const half=new Uint16Array(surface.global.length);for(let i=0;i<half.length;i++)half[i]=T.DataUtils.toHalfFloat(Math.max(0,surface.global[i]));const tex=new T.DataTexture(half,720,361,T.RedFormat,T.HalfFloatType);tex.minFilter=tex.magFilter=T.LinearFilter;tex.wrapS=T.RepeatWrapping;tex.needsUpdate=true;elevationMap.value=tex;}
    // Only an Alpine scenario or summit needs the Bernese Oberland warmed before the first frame; the default is London.
    const query=new URLSearchParams(location.search),defaultStart=!query.get('scenario')&&!query.get('summit');
    if(!defaultStart){await surface.warm(46.55, 8.0, 9);void imagery.warm(46.55, 8.0);await surface.warm(46.727, 7.98, 9);await surface.warmReferenceDetail();}
    await scenery.init().catch((e) => {
      scenery.error = String(e);
    });
    const inland=await(await fetch('scenery/absheron.json')).json();
    makeCaspianMask(inland.features);
    scenery.features.push(...inland.features);
    void loadLondonDem();void bridges.load();
    const thames=await fetch('scenery/london-water.json').then(r=>r.ok?r.json():null).catch(()=>null);if(thames){makeLondonMask(thames.features);scenery.features.push(...thames.features);ships.load(thames.features);}
    scenery.index=new GeoIndex(scenery.features);
    surface.waterLevel=(lat,lon)=>scenery.index.at(lat,lon,'water')?.elevation??null;
    surface.meshSync = true;
    surface.live = true;
    ready = true;
    void loadNightLights().then(texture=>{if(texture){nightUniforms.nightMap.value=texture;nightUniforms.nightReady.value=1;}}).catch(()=>{});
    const requested=query.get("scenario");if(requested)reset(requested);
    // Default sortie: airborne over the Thames at Wandsworth, 450 m up, heading for Westminster and the City 4 km ahead.
    // The loading screen stays up until the aircraft is placed, so nothing else flashes first.
    if(defaultStart){input('start-lat').value='51.482';input('start-lon').value='-0.180';input('start-alt').value='450';input('start-heading').value='61';input('start-speed').value='140';select('start-mode').value='flight';await ($('start-form') as HTMLFormElement).onsubmit?.(new SubmitEvent('submit',{cancelable:true}));throttle=.55;}
    const summitId=new URLSearchParams(location.search).get('summit'),summit=ALL_PEAKS.find(s=>s.id===summitId);
    if(summit)void flySummit(summit);
    // Compile shaders in parallel and upload first textures behind the loading screen, so the first seconds of
    // flight do not stall on one blocking compile per new material. Capped so a slow driver cannot hold the load.
    await Promise.race([Promise.all([scene,shipScene,terrainScene,waterScene].map(s=>renderer.compileAsync(s,camera).catch(()=>{}))),new Promise(r=>setTimeout(r,4000))]);
    draw(0.016);
    $("loading").hidden = true;
    $("loading").style.display = "none";
  })
  .catch((e) => {
    $("loading").querySelector("p")!.textContent =
      `Could not load local Earth assets: ${e}`;
    errors.push(String(e));
  });
let last = performance.now();
function frame(now: number) {
  const dt = Math.max(0.001, Math.min(tour&&!tour.completed?.25:.05, (now - last) / 1000));
  last = now;
  if (ready) {
    perf.begin();
    step(dt);
    perf.mark('physics');
    draw(dt);
    perf.end(dt);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
arrangeHud();
Object.defineProperty(window, "earthStatus", {
  get: () => ({
    ready,
    altimetry,
    region:activeCaspian?'caspian':activeSummit?.id??null,
    summit:activeSummit?{...activeSummit,terrainHeight:surface.height(activeSummit.lat,activeSummit.lon),heightError:surface.height(activeSummit.lat,activeSummit.lon)-activeSummit.elevation}:null,
    terrainCrest:activeCrest,crestApproach,
    paused,
    status: state.status,
    altitude: (len(state.p) - EARTH.radius) * 1000,
    environment: environmentAt((len(state.p) - EARTH.radius) * 1000),
    trajectory: trajectory(state),
    speed: len(state.v) * 1000,
    position: [...state.p],
    fuel: state.fuel,
    heat: state.heat,
    structuralDamage:state.structuralDamage??0,
    navigation:{heading:trueHeading(rotation,new T.Vector3(...state.p).normalize()),mapSpan:flightMap.span,following:flightMap.following,trail:flightMap.trail.length,sun:solarPosition(new Date(epoch.getTime()+state.t*1000+solarOffset*3600000),...Object.values(dirToLatLon(inertialToBody(state.p,state.t,EARTH.rotation))) as [number,number])},
    camera: cameraMode,
    tele: state.tele,
    errors: [...errors],
    triangles: renderer.info.render.triangles,
    scenery: {
      ready: scenery.ready,
      error: scenery.error,
      trees: scenery.treeCount,
      water: scenery.waterCount,
      visible: scenery.group.visible,
    },
    imagery: imagery.status,
    imageryDetail:{origin:imagery.origin,focus:imagery.focusSummit,busy:imagery.busy},
    terrain: {
      status: surface.status,
      mesh: { anchor: patchAnchor.toArray(), recenterKm: terrainRecenterKm(state.tele?.agl), busy: terrainBuilder.busy, completed: terrainBuilder.completed, discarded: terrainBuilder.discarded, milliseconds: terrainBuilder.milliseconds, error: terrainBuilder.error,recenterBlend:recenterBlend.value,recenterCount,accepted:terrainBuilder.accepted,retainedMeshes:terrainBuilder.retainedMeshes,retainedBytes:terrainBuilder.retainedBytes },
      tiles: surface.tiles.size,
      pending: surface.requests,
      error: surface.lastError,
      staged: surface.staged.size,
      blend: surface.blend,
      generation: surface.generation,
      transitionReady: surface.transitionReady,
      displayedGeneration,
      displayedBlend: terrainBlend.value,
      held: surface.detailHeld,
    },
    traffic:{surface:surfaceTraffic.stats,airliners:airTraffic.flights.map(f=>({id:f.id,type:AIRLINERS[f.type].name,phase:f.phase,route:f.route,speed:f.speed,p:f.p.toArray()})),orbitCatalog:orbitTraffic.rows.length,propagated:orbitTraffic.valid,orbitalStatus:orbitTraffic.status,destroyed:orbitTraffic.destroyed.size,radarReturns:radar.visible.length,utc:new Date(epoch.getTime()+state.t*1000+solarOffset*3600000).toISOString(),persistentPatrol:combat.persistent},
    supercruise:{active:supercruise.active,speed:supercruise.speed,goal:supercruise.goal,distance:supercruise.distance},satellite:{status:satellite.status,loaded:satellite.loaded,cache:satellite.cacheSize,origin:satellite.origin},combat:{active:combat.active,score:combat.score,hits:combat.hits,shots:combat.shots.length,targets:combat.targets.length,lock:combat.lock,lockTime:combat.lockTime,city:city.progress,detail:detail.progress,remaining:combat.remaining,completed:combat.completed,health:combat.health,taken:combat.taken,incoming:combat.incoming.length,down:combat.down},
    timeAcceleration:{requested:timeRate,effective:effectiveRate},aircraft:aircraftProfile,tour:tour?.summary(timeRate)??null,
    controls: controlStyle, deliveredThrottle, airbrake, motionEffects, boostActive,
    pilot: { mouseActive: mouseAim.active, aim: [mouseAim.x, mouseAim.y] },
    sonic: { crossings: sonic.crossings, pulse: sonic.pulse, audioCues: audio.boomsPlayed, audioState: audio.context?.state, lastCue: audio.lastCue },
    torch,
    gear,
    assist,
    throttle,
    time: state.t,
  }),
});
Object.defineProperty(window, "earthDebug", {
  value: {
    reset: (name: string) => {
      select("scenario").value = name;
      reset(name);
    },
    tick: (seconds: number) => {
      const was = paused;
      paused = false;
      for (let t = 0; seconds - t > 1e-8; t += 0.02)
        step(Math.min(0.02, seconds - t));
      paused = was;
      draw(0.016);
    },
    setUTC:(iso:string)=>{const date=Date.parse(iso);if(!Number.isFinite(date))throw Error('Invalid UTC');epoch=new Date(date-state.t*1000);solarOffset=0;},
    terrain: surface,
    supercruise,combat,satellite,nearImagery,city,detail,groundOverlay,bridges,water,sams,missions,surfaceTraffic,startMission:(id:string)=>startMission(MISSIONS.find(m=>m.id===id)!),airTraffic,orbitTraffic,radar,
    view: { post,postFrame,fx,wideImagery,scene, patch, camera, renderer, atmospherePass, globe, scenery, flightEffects, audio,imagery,flightMap },
    state,
    rotation,
    keys,
    draw: () => draw(0.016),
    setPaused: (v: boolean) => {
      paused = v;
      sync();
    },
    setThrottle: (v: number) => {
      throttle = T.MathUtils.clamp(v, 0, 1);
      sync();
    },
    setTorch: (v: boolean) => {
      torch = v;
      sync();
    },
    startTour:(config:{lat:number;lon:number;heading:number;altitude:number;mach:number},rate=120)=>startTour(config,rate),
    setCamera: (v: string) => {
      cameraMode = v;
      select("camera").value = v;
      draw(0.016);
    },
  },
});

window.addEventListener(
  "pointerdown",
  () => {
    void audio.start();
  },
  { once: true },
);
window.addEventListener(
  "keydown",
  () => {
    void audio.start();
  },
  { once: true },
);
$("sound").onclick = () => {
  audio.enabled = !audio.enabled;
  try {
    localStorage.setItem("earth-fly-sound", String(audio.enabled));
  } catch {}
  void audio.start();
};
try {
  audio.enabled = localStorage.getItem("earth-fly-sound") !== "false";
} catch {
  audio.enabled = true;
}
$("solar-time").oninput = () =>
  (solarOffset = Number(($("solar-time") as HTMLInputElement).value));

const planner = $("planner") as HTMLDialogElement;
let plannerWasPaused = false;
function openPlanner() {
  plannerWasPaused = paused;
  paused = true;
  clearPilot();
  planner.showModal();
}
$("planner-button").onclick = openPlanner;
$('summits-button').onclick=()=>{openPlanner();select('summit-destination').focus();};
for(const s of ALL_PEAKS){const option=document.createElement('option');option.value=s.id;option.dataset.collection=s.id==='dombay'?'regional':'summits';option.textContent=`${s.name} · ${s.continent}`;select('summit-destination').append(option);}
function updateSummitReference(){
 const s=ALL_PEAKS.find(s=>s.id===select('summit-destination').value)!;
 $('summit-reference').textContent=`${s.elevation.toLocaleString(undefined,{maximumFractionDigits:2})} m MSL · ${s.lat.toFixed(6)}°, ${s.lon.toFixed(6)}° WGS84${s.alternate?' · Kosciuszko / Bass alternate':''}`;
 ($('summit-height-source') as HTMLAnchorElement).href=s.heightSource;
 ($('summit-coordinate-source') as HTMLAnchorElement).href=s.coordinateSource;
}
select('summit-destination').onchange=updateSummitReference;updateSummitReference();
$('summit-fly').onclick=()=>void flySummit(ALL_PEAKS.find(s=>s.id===select('summit-destination').value)!);
$('crest-fly').onclick=()=>void flySummit(ALL_PEAKS.find(s=>s.id===select('summit-destination').value)!,true);
async function flySummit(s:Summit,modeled=false){
 const operation=++destinationEpoch,wasPaused=paused,button=$('summit-fly') as HTMLButtonElement;
 paused=true;clearPilot();button.disabled=true;($('crest-fly') as HTMLButtonElement).disabled=true;$('summit-error').textContent=`Preparing ${s.name} terrain and imagery…`;sync();
 try{
  await surface.warm(s.lat,s.lon,9);await surface.warm(s.lat,s.lon,11);await surface.warmRegionalDetail(s.lat,s.lon);
  for(let i=0;i<150&&imagery.busy&&operation===destinationEpoch;i++)await new Promise(r=>setTimeout(r,100));
  if(operation!==destinationEpoch)return;
  imagery.focusSummit=s.id;await imagery.warm(s.lat,s.lon);
  if(operation!==destinationEpoch)return;
  surface.applyStaged();reset('alps');
  const crest=findTerrainCrest(surface,s),target=modeled?{...s,lat:crest.lat,lon:crest.lon,elevation:crest.elevation}:s;
  const start=summitApproach(target),height=Math.max(start.altitudeMSL,surface.height(start.lat,start.lon)+1600);
  levelAt(start.lat,start.lon,height-surface.height(start.lat,start.lon),start.heading,1, start.speed);
  activeSummit=s;activeCrest=crest;crestApproach=modeled;imagery.focusSummit=s.id;select('scenario').value='summit';throttle=.4;
  epoch=new Date(s.lat<0?'2026-12-21T12:00:00Z':'2026-06-21T12:00:00Z');solarOffset=-s.lon/15;
  ($('solar-time') as HTMLInputElement).value=String(solarOffset);
  advanceFlight(state,0,rotation,{throttle:0,hover:0,lateral:0,surge:0},{surface,gear:false});
  cameraSet=false;invalidatePatch();plannerWasPaused=false;if(planner.open)planner.close();
  $('summit-error').textContent='';sync();
 }catch(error){if(operation===destinationEpoch){paused=wasPaused;$('summit-error').textContent=String(error);sync();}}
 finally{button.disabled=false;($('crest-fly') as HTMLButtonElement).disabled=false;}
}
async function flyCaspian(){
 const operation=++destinationEpoch,wasPaused=paused;
 paused=true;clearPilot();$('summit-error').textContent='Preparing Caspian coast…';sync();
 try{
  await surface.warm(CASPIAN.lat,CASPIAN.lon,9);await surface.warm(CASPIAN.lat,CASPIAN.lon,11);
  for(let i=0;i<150&&imagery.busy&&operation===destinationEpoch;i++)await new Promise(r=>setTimeout(r,100));
  if(operation!==destinationEpoch)return;
  imagery.altitude=1000;imagery.focusSummit='caspian';await imagery.warm(CASPIAN.lat,CASPIAN.lon);
  if(operation!==destinationEpoch)return;
  surface.applyStaged();reset('alps');levelAt(CASPIAN.lat,CASPIAN.lon,1000,330,2,160);
  activeCaspian=true;flightMap.reset();flightMap.span=2;imagery.focusSummit='caspian';select('scenario').value='caspian';throttle=.4;
  epoch=new Date('2026-06-21T12:00:00Z');solarOffset=-CASPIAN.lon/15;($('solar-time') as HTMLInputElement).value=String(solarOffset);
  advanceFlight(state,0,rotation,{throttle:0,hover:0,lateral:0,surge:0},{surface,gear:false});
  cameraSet=false;invalidatePatch();plannerWasPaused=false;if(planner.open)planner.close();$('summit-error').textContent='';sync();
 }catch(error){if(operation===destinationEpoch){paused=wasPaused;$('summit-error').textContent=String(error);sync();}}
}
$("close-planner").onclick = () => planner.close();
planner.addEventListener("close", () => {
  paused = plannerWasPaused;
  sync();
});
$("start-form").onsubmit = async (event) => {
  event.preventDefault();
  const launch = $("launch") as HTMLButtonElement;
  launch.disabled = true;
  $("planner-error").textContent = "Preparing elevation…";
  try {
    const lat = Number(($("start-lat") as HTMLInputElement).value),
      lon = Number(($("start-lon") as HTMLInputElement).value),
      alt = Number(($("start-alt") as HTMLInputElement).value),
      heading = Number(($("start-heading") as HTMLInputElement).value),
      speed = Number(($("start-speed") as HTMLInputElement).value);
    validateStart(lat, lon, alt, heading, speed);
    await surface.warm(lat, lon, 9);
    if (alt < 12000 || select("start-mode").value === "surface"){await surface.warm(lat, lon, 11);await surface.warmRegionalDetail(lat,lon);}
    surface.applyStaged();
    void imagery.warm(lat, lon);
    reset("alps");
    const mode = select("start-mode").value;
    const height =
      mode === "surface"
        ? VEHICLE.gearClearance
        : mode === "orbit"
          ? Math.max(160000, alt)
          : alt;
    let velocity = speed;
    if (mode === "orbit") {
      const p = latLonToDir(lat, lon),
        east = new T.Vector3(0, 1, 0).cross(new T.Vector3(...p)).normalize();
      velocity =
        Math.sqrt(EARTH.mu / (EARTH.radius + height / 1000)) * 1000 -
        new T.Vector3(
          ...atmosphereVelocity(mul(p, EARTH.radius + height / 1000)),
        ).dot(east);
    }
    levelAt(
      lat,
      lon,
      mode === "orbit" ? height-surface.height(lat,lon) : height,
      heading,
      mode === "descent" ? -6 : mode === "surface" || mode === "orbit" ? 0 : missionTrim ?? 3,
      mode === "surface" ? 0 : velocity,
      mode === "flight" ? missionTrim ?? 0 : 0,
    );
    missionTrim = null;
    if(mode==='orbit')state.v=new T.Vector3(0,0,-1).applyQuaternion(rotation).multiplyScalar(Math.sqrt(EARTH.mu/len(state.p))).toArray() as V;
    gear = mode === "surface";
    state.status = mode === "surface" ? "landed" : "flying";
    if (state.status === "landed") prepareGroundStart();
    entry = mode === "descent";
    throttle = mode === "flight" ? 0.1 : 0;
    advanceFlight(
      state,
      0,
      rotation,
      { throttle: 0, hover: 0, lateral: 0, surge: 0 },
      { surface, gear },
    );
    cameraSet = false;
    epoch=middayEpoch();solarOffset=0;
    invalidatePatch();
    plannerWasPaused = false;
    planner.close();
    $("planner-error").textContent = "";
    sync();
  } catch (e) {
    $("planner-error").textContent = String(e);
  } finally {
    launch.disabled = false;
  }
};
$("save").onclick = () => {
  if (state.status === "impact") return;
  try {
    const { tele, ...savedState } = state;
    localStorage.setItem(
      "earth-fly-save",
      JSON.stringify({
        version: 1,
        state: savedState,
        rotation: rotation.toArray(),
        epoch: epoch.toISOString(),aircraft:aircraftProfile,timeRate,solarOffset,tour:tour?{config:tour.config,elapsed:tour.elapsed}:null,
      }),
    );
    $("save").textContent = "Saved ✓";
    setTimeout(() => ($("save").textContent = "Save flight"), 2000);
  } catch {
    $("notice").textContent = "Browser storage unavailable";
  }
};
$("resume").onclick = async () => {
  try {
    const saved = parseFlight(localStorage.getItem("earth-fly-save") ?? "null");
    const loc = dirToLatLon(
      inertialToBody(saved.state.p, saved.state.t, EARTH.rotation),
    );
    paused = true;
    await surface.warm(loc.lat, loc.lon);
    if ((len(saved.state.p) - EARTH.radius) * 1000 - surface.height(loc.lat, loc.lon) < 12000){
      await surface.warm(loc.lat,loc.lon,11);await surface.warmRegionalDetail(loc.lat,loc.lon);
    }
    surface.applyStaged();
    stopTour();applyAircraft(saved.aircraft??"pathfinder");
    Object.assign(state, saved.state, { tele: undefined });
    rotation.fromArray(saved.rotation);
    epoch = new Date(saved.epoch);solarOffset=saved.solarOffset??0;($('solar-time') as HTMLInputElement).value=String(solarOffset);timeRate=saved.timeRate??1;select("warp").value=String(timeRate);
    if(saved.tour){tour=new WorldTour(saved.tour.config);tour.advance(saved.tour.elapsed);$("tour-status").hidden=false;flightMap.reset();flightMap.span=100;setTourMap(tour);}
    throttle = 0;
    gear = state.status === "landed";
    assist = entry = false;
    cameraSet = false;
    invalidatePatch();
    control.reset();
    paused = !!tour?.completed;
    sync();
  } catch (e) {
    $("notice").textContent = String(e);
  }
};
renderer.domElement.addEventListener("webglcontextlost", (event) => {
  event.preventDefault();
  paused = true;
  $("notice").textContent =
    "Graphics context lost · reload to recover; your last save remains available";
});
renderer.domElement.addEventListener("webglcontextrestored", () =>
  location.reload(),
);

function applyAircraft(_profile:'blackbird'|'pathfinder'){setAircraftProfile('pathfinder');select('aircraft').value='pathfinder';for(const id of ['torch','assist'])($(id) as HTMLButtonElement).disabled=false;}
select('aircraft').onchange=()=>{stopTour();applyAircraft(select('aircraft').value as 'pathfinder'|'blackbird');};
function stopTour(preserveKeys=false){if(!tour)return;const held=[...keys];tour=null;timeRate=effectiveRate=1;select('warp').value='1';flightMap.route=[];$('tour-status').hidden=true;boostActive=false;boostPower=0;throttle=enginePower=Math.min(1,deliveredThrottle*VEHICLE.boostThrust/VEHICLE.mainThrust);control.reset();clearPilot();if(preserveKeys)for(const key of held)keys.add(key);}
function startTour(config:{lat:number;lon:number;heading:number;altitude:number;mach:number},rate:number){
 const next=new WorldTour(config);if(!TIME_RATES.includes(rate as 1))throw Error('Unsupported time rate');
 const instant=epoch.getTime()+state.t*1000+solarOffset*3600000;reset('mach');epoch=new Date(instant);($('solar-time') as HTMLInputElement).value='0';applyAircraft('blackbird');tour=next;timeRate=effectiveRate=rate;select('warp').value=String(rate);state.t=0;gear=torch=assist=entry=false;
 tourFlight(tour,state,rotation,0,surface);flightMap.reset();flightMap.span=100;setTourMap(tour);
 $('tour-status').hidden=false;cameraSet=false;invalidatePatch();paused=false;clearPilot();sync();draw(.016);
}
$('tour-stop').onclick=()=>{stopTour();sync();};
const tourDialog=$('tour-planner') as HTMLDialogElement;
function tourPlan(){try{const altitude=Number(($('tour-alt') as HTMLInputElement).value),mach=Number(($('tour-mach') as HTMLInputElement).value),rate=Number(select('tour-rate').value),p=lapPlan(altitude,mach,rate);$('tour-plan').textContent=`${(p.distance/1000).toFixed(0)} km full lap · ${(p.speed*3.6).toFixed(0)} km/h · ${(p.seconds/3600).toFixed(2)} h simulated · ${(p.wallSeconds/60).toFixed(2)} min at ${rate}×.`;}catch{}}
$('tour-button').onclick=()=>{tourReturnPaused=paused;paused=true;const loc=dirToLatLon(inertialToBody(state.p,state.t,EARTH.rotation));($('tour-lat') as HTMLInputElement).value=String(loc.lat);($('tour-lon') as HTMLInputElement).value=String(loc.lon);tourDialog.showModal();tourPlan();sync();};
$('tour-current').onclick=()=>{const loc=dirToLatLon(inertialToBody(state.p,state.t,EARTH.rotation));($('tour-lat') as HTMLInputElement).value=String(loc.lat);($('tour-lon') as HTMLInputElement).value=String(loc.lon);};
$('tour-everest').onclick=()=>{($('tour-lat') as HTMLInputElement).value='27.988257';($('tour-lon') as HTMLInputElement).value='86.925145';};
for(const id of ['tour-alt','tour-mach','tour-rate'])$(id).oninput=tourPlan;
$('tour-close').onclick=()=>tourDialog.close();tourDialog.addEventListener('close',()=>{if(tourLaunching){tourLaunching=false;return;}paused=tourReturnPaused;sync();});
$('tour-form').onsubmit=e=>{e.preventDefault();try{const config={lat:Number(($('tour-lat') as HTMLInputElement).value),lon:Number(($('tour-lon') as HTMLInputElement).value),heading:Number(($('tour-heading') as HTMLInputElement).value),altitude:Number(($('tour-alt') as HTMLInputElement).value),mach:Number(($('tour-mach') as HTMLInputElement).value)},rate=Number(select('tour-rate').value);tourReturnPaused=false;tourLaunching=true;tourDialog.close();startTour(config,rate);}catch(error){$('tour-error').textContent=String(error);}};

function setTourMap(route:WorldTour){flightMap.route=Array.from({length:181},(_,i)=>{const a=i/180*Math.PI*2,u=route.start.clone().multiplyScalar(Math.cos(a)).addScaledVector(route.tangent,Math.sin(a));return dirToLatLon(u.toArray());});}

// World playground controls share the regular planner and flight state.
function toggleSuper(goal:'free'|'orbit'|'descent'='free'){
 stopTour();if(supercruise.active&&goal==='free')stopSuper();else{supercruise.start(state,Number(select('super-speed').value),goal);paused=false;torch=assist=entry=false;gear=false;state.status='flying';}
 sync();
}
$('super-toggle').onclick=()=>toggleSuper();$('climb-orbit').onclick=()=>toggleSuper('orbit');$('descend-world').onclick=()=>toggleSuper('descent');
select('super-speed').onchange=()=>{supercruise.targetSpeed=Number(select('super-speed').value);};
$('practice-start').onclick=()=>{stopTour();timeRate=1;select('warp').value='1';if(state.status!=='flying')toggleSuper();combat.start(new T.Vector3(...state.p),rotation,new T.Vector3(...state.v));paused=false;renderer.domElement.focus({preventScroll:true});};
$('practice-stop').onclick=()=>{combat.startPatrol(new T.Vector3(...state.p),rotation,new T.Vector3(...state.v));};$('lock-target').onclick=()=>combat.select(new T.Vector3(...state.p),weaponAim);$('drop-nuke').onclick=dropNuke;
for(const [id,missile]of [['fire-gun',false],['fire-missile',true]] as const){const b=$(id);b.onpointerdown=e=>{if(missile)missileHeld=true;else gunHeld=true;b.setPointerCapture(e.pointerId);};b.onpointerup=b.onpointercancel=b.onlostpointercapture=()=>{if(missile)missileHeld=false;else gunHeld=false;};b.onclick=e=>{if(e.detail===0)combat.fire(new T.Vector3(...state.p),new T.Vector3(...state.v),weaponAim,missile);};}
combat.ground=p=>surface.radiusM(inertialToBody(p.toArray() as V,state.t,EARTH.rotation))/1000;
combat.event=kind=>{if(kind==='enemyGun')return;audio.weaponCue(kind==='kill'||kind==='damage'||kind==='down'?'hit':kind==='wave'?'lock':kind);if(kind==='kill'){fx.flash=Math.min(.5,fx.flash+.22);fx.shake=1;}else if(kind==='down'){fx.flash=.7;fx.shake=1.6;}else if(kind==='damage')fx.shake=Math.max(fx.shake,.8);else if(kind==='hit')fx.shake=Math.max(fx.shake,.35);};
const worldDialog=$('world-explorer') as HTMLDialogElement;let explorePaused=false;
$('explore-world').onclick=()=>{explorePaused=paused;paused=true;clearPilot();worldDialog.showModal();};
$('explore-close').onclick=()=>worldDialog.close();$('explore-coordinates').onclick=()=>{worldDialog.close();$('planner-button').click();};let exploreHandoff=false;worldDialog.addEventListener('close',()=>{if(exploreHandoff){exploreHandoff=false;return;}paused=explorePaused;});
// Tools inside Explore open their own dialog: put the pause back as it was before Explore, then let the tool take over.
for(const id of ['tour-button','summits-button','radar-contacts'])$(id).addEventListener('click',()=>{if(!worldDialog.open)return;paused=explorePaused;exploreHandoff=true;worldDialog.close();},true);
/** Puts the aircraft at a mission start and arms its gates. */
async function startMission(m:typeof MISSIONS[number]){
 ops.id='';if(!bridges.ready)await bridges.load();
 const first=bridges.eastSide(m.start.bridge),side=m.start.side==='east'?first:-first,rough=bridges.startFor(m.start.bridge,side,m.start.distance);if(!rough)return;
 // Fine ground first: a bridge placed on the coarse global grid would sit at the wrong water level.
 await surface.warm(rough.lat,rough.lon,11);surface.applyStaged();bridges.relevel(m.start.bridge);const start=bridges.startFor(m.start.bridge,side,m.start.distance)!;
 stopSuper();combat.clear();
 input('start-lat').value=start.lat.toFixed(6);input('start-lon').value=start.lon.toFixed(6);input('start-alt').value=Math.max(2.5,start.alt-surface.height(start.lat,start.lon)).toFixed(1);missionTrim=Math.min(12,4.6*(130/m.speed)**2);input('start-heading').value=start.heading.toFixed(1);input('start-speed').value=String(m.speed);select('start-mode').value='flight';
 await ($('start-form') as HTMLFormElement).onsubmit?.(new SubmitEvent('submit',{cancelable:true}));
 throttle=.26;paused=false;bridgePrev=null;holdAgl=null;holdI=0;missions.start(m,state.t);worldPlace=m.title;renderer.domElement.focus({preventScroll:true});
}
for(const o of OPS){const b=document.createElement('button');b.className='destination-card mission-card ops-card';b.innerHTML='<small>'+o.small+'</small><strong>'+o.title+'</strong><span>'+o.detail+'</span>';b.onclick=()=>{worldDialog.close();void startOps(o);};$('mission-grid').append(b);}
for(const m of MISSIONS){const b=document.createElement('button');b.className='destination-card mission-card';const best=missions.bestFor(m.id);
 b.innerHTML='<small>'+(m.gates.length>1?m.gates.length+' bridges':'Fly under')+'</small><strong>'+m.title.replace(/^Fly under /,'')+'</strong><span>'+m.detail+(best?' · best '+Math.floor(best/60)+':'+(best%60).toFixed(1).padStart(4,'0'):'')+'</span>';
 b.onclick=()=>{worldDialog.close();void startMission(m);};$('mission-grid').append(b);}
for(const d of WORLD_DESTINATIONS){const b=document.createElement('button');b.className='destination-card';b.innerHTML='<small>'+d.region+'</small><strong>'+d.name+'</strong><span>'+Math.abs(d.lat).toFixed(1)+'° '+(d.lat>=0?'N':'S')+' · '+Math.abs(d.lon).toFixed(1)+'° '+(d.lon>=0?'E':'W')+' ↗</span>';b.onclick=async()=>{b.disabled=true;try{const mode=select('explore-mode').value;worldDialog.close();$('start-lat').setAttribute('value',String(d.lat));for(const [id,v]of [['start-lat',d.lat],['start-lon',d.lon],['start-alt',mode==='orbit'?400000:mode==='descent'?120000:mode==='surface'?0:d.alt],['start-heading',d.heading],['start-speed',mode==='descent'?1500:220]] as const)($(id)as HTMLInputElement).value=String(v);select('start-mode').value=mode;await ($('start-form') as HTMLFormElement).onsubmit?.(new SubmitEvent('submit',{cancelable:true}));worldPlace=d.name;renderer.domElement.focus({preventScroll:true});}finally{b.disabled=false;}};$('destination-grid').append(b);}
setInterval(()=>{if(worldPlace)$('region').textContent=worldPlace;const travel=supercruise.active;$('super-toggle').classList.toggle('on',travel);$('super-toggle').innerHTML=travel?'Superspeed on <kbd>Y</kbd>':'Superspeed <kbd>Y</kbd>';$('super-readout').textContent=travel?(supercruise.goal==='free'?'TERRAIN SHIELD':supercruise.goal==='orbit'?'CLIMBING TO 400 KM':'DESCENDING TO 2.5 KM AGL')+' · '+(supercruise.speed/1000).toFixed(2)+' km/s · fictional drive':'Y superspeed · W/S climb/dive · Ctrl brake';$('combat-panel').hidden=!combat.engaged;document.body.classList.toggle('combat-active',combat.engaged);$('combat-score').textContent=combat.completed?(combat.down?'SHOT DOWN · ':'SORTIE COMPLETE · ')+combat.score.toLocaleString()+' PTS':(combat.persistent?'PATROL':'WAVE '+combat.wave)+' · '+combat.score.toLocaleString()+' PTS'+(combat.persistent?'':' · '+Math.ceil(combat.remaining)+'s');$('combat-help').textContent=combat.completed?'Start another sortie to beat your score.':combat.lockTime>=.85?'TARGET LOCKED · X to launch':'C lock · Z / click gun · X missile · turn hard to dodge fire';},100);

function stopSuper(){if(!supercruise.active)return;supercruise.stop();const alt=(len(state.p)-EARTH.radius)*1000;if(alt<90000){const safe=Math.min(1200,Math.sqrt(140000/Math.max(.00001,atmosphereDensity(alt))));const av=new T.Vector3(...atmosphereVelocity(state.p)),relative=new T.Vector3(...state.v).sub(av);if(relative.length()*1000>safe)state.v=relative.setLength(safe/1000).add(av).toArray() as V;}control.reset();clearPilot();throttle=.4;timeRate=1;select('warp').value='1';}

for(const b of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-flight-key]'))){const key=b.dataset.flightKey!;b.onpointerdown=e=>{keys.add(key);b.setPointerCapture(e.pointerId);e.preventDefault();};b.onpointerup=b.onpointercancel=b.onlostpointercapture=()=>keys.delete(key);}
// Camera bar: one button per view, same order as the number keys.
{const bar=document.getElementById('view-bar');if(bar){VIEWS.forEach((v,i)=>{const b=document.createElement('button');b.dataset.view=v.id;b.innerHTML=`<kbd>${i+1}</kbd><span>${v.label}</span>`;b.title=`${v.label} view · press ${i+1}`;b.onclick=()=>{setView(v.id);renderer.domElement.focus({preventScroll:true});};bar.append(b);});}
 const pick=document.getElementById('camera') as HTMLSelectElement|null;if(pick){pick.innerHTML=VIEWS.map((v,i)=>`<option value="${v.id}">${i+1} · ${v.label}</option>`).join('');}
 setView('chase');}

radar.onSelect=c=>{if(c.targetId!==undefined&&c.p.distanceTo(new T.Vector3(...state.p))<25){combat.lock=c.targetId;combat.lockTime=0;}else combat.lock=null;};
radar.onNow=()=>{epoch=new Date(Date.now()-state.t*1000);solarOffset=0;input('solar-time').value='0';};
radar.onRendezvous=id=>{const instant=Date.now(),orbital=orbitTraffic.state(id,instant,state.t);if(!orbital)return;stopTour();supercruise.stop();combat.clear();
 epoch=new Date(instant-state.t*1000);solarOffset=0;input('solar-time').value='0';const pos=new T.Vector3(...orbital.p),velocity=new T.Vector3(...orbital.v),forward=velocity.clone().normalize(),up=pos.clone().normalize(),right=forward.clone().cross(up).normalize(),top=right.clone().cross(forward).normalize();
 state.p=pos.addScaledVector(forward,-1).toArray() as V;state.v=velocity.toArray() as V;rotation.setFromRotationMatrix(new T.Matrix4().makeBasis(right,top,forward.negate()));state.status='flying';state.body='';state.heat=0;state.structuralDamage=0;state.fuel=100;state.tele=undefined;
 throttle=0;torch=gear=assist=entry=false;timeRate=1;select('warp').value='1';cameraMode='chase';cameraSet=false;paused=false;lastTrafficTime=state.t;clearPilot();invalidatePatch();trails.reset();orbitTraffic.selected=id;radar.selected='sat-'+id;combat.startPatrol(new T.Vector3(...state.p),rotation,new T.Vector3(...state.v));combat.lock=1000000+id;sync();
};
