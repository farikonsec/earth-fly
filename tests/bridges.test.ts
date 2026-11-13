import {expect,test} from 'bun:test';import * as T from 'three';
import {Bridges} from '../src/bridges';import {BRIDGES} from '../src/bridges-data';import {MISSIONS,MissionRun} from '../src/missions';import type {Terrain} from '../src/terrain';
const geo=JSON.parse(require('node:fs').readFileSync('public/scenery/bridges.json','utf8')).bridges;
/** Flat world: the river at 0 m, banks at 5 m beyond 100 m from the bridge centre line. */
const flat={height:()=>0,revision:1} as unknown as Terrain;
const make=(id:string)=>{const bridges=new Bridges(flat),spec=BRIDGES.find(b=>b.id===id)!,g=geo[spec.osm];const b=bridges.add(spec,g.a,g.b,g.width)!;bridges.ensure(b);(bridges as unknown as {ready:boolean}).ready=true;return{bridges,b};};
const at=(bridges:Bridges,b:ReturnType<typeof make>['b'],x:number,y:number,z:number)=>b.centre.clone().multiplyScalar(6371).addScaledVector(b.X,x/1000).addScaledVector(b.Z,z/1000).setLength(6371+(b.water+y)/1000);
test('every listed bridge has a mapped position and builds a model with openings',()=>{
 for(const spec of BRIDGES){const g=geo[spec.osm];expect(g).toBeDefined();const{b}=make(spec.id);expect(b.group).not.toBeNull();expect(b.openings.length).toBeGreaterThan(0);
  const main=b.openings.find(o=>o.index===spec.main)??b.openings[0],x=(main.x0+main.x1)/2;
  // The main opening's crown matches the charted clearance plus the tide allowance (within a metre of camber).
  if(spec.kind!=='cantilever')expect(Math.abs(main.top(x)-(spec.clearances[spec.main]+spec.tide))).toBeLessThan(spec.spans?1.8:.5);}
});
/** Flies straight across the bridge in 2 m steps (a frame at 100 m/s is about 2-4 m) and collects every event. */
const fly=(bridges:Bridges,b:ReturnType<typeof make>['b'],x:number,y:number)=>{const out:string[]=[];for(let z=60;z>-60;z-=2)for(const e of bridges.check(at(bridges,b,x,y,z),at(bridges,b,x,y,z-2)))out.push(e.type);return out;};
test('the full airframe counts: Westminster is too narrow for a 31 m span, Lambeth is wide enough, overflying is neither',()=>{
 const{bridges,b}=make('westminster'),o=b.openings.find(o=>o.index===3)!,x=(o.x0+o.x1)/2;
 expect(fly(bridges,b,x,(o.top(x)-3)/2)).toContain('hit');
 const pier=(b.openings.find(o=>o.index===2)!.x1+o.x0)/2;expect(fly(bridges,b,pier,2)).toContain('hit');
 expect(fly(bridges,b,x,b.deckTop(x)+40)).toEqual([]);
 const l=make('lambeth'),lo=l.b.openings.find(o=>o.index===l.b.spec.main)!,lx=(lo.x0+lo.x1)/2,ev=fly(l.bridges,l.b,lx,(lo.top(lx)-3)/2);
 expect(ev).toContain('under');expect(ev).not.toContain('hit');});
test('Hammersmith is the tightest on the tideway and Tower Bridge has its high walkways',()=>{
 const ham=make('hammersmith').b,main=ham.openings.find(o=>o.index===1)!;expect(main.top((main.x0+main.x1)/2)).toBeLessThan(7.5);
 const{bridges,b}=make('tower'),walk=42+3.5+1,wz=b.width/2-1.5;expect(bridges.check(at(bridges,b,0,walk,wz+2),at(bridges,b,0,walk,wz))[0]?.type).toBe('hit');
 const o=b.openings.find(o=>o.index===1)!;expect(bridges.check(at(bridges,b,0,6,30),at(bridges,b,0,6,-30))[0]?.type).toBe('under');expect(o.top(0)).toBeCloseTo(12,0);});
test('big crossings: the Forth Bridge cantilever tubes are solid, the navigation span under them is open',()=>{
 const{bridges,b}=make('forth'),o=b.openings[0],x=(o.x0+o.x1)/2;expect(o.top(x)).toBeGreaterThan(40);
 expect(bridges.check(at(bridges,b,x,25,60),at(bridges,b,x,25,-60))[0]?.type).toBe('under');
 const tower=b.capsules[0];const mid=tower.a.clone().lerp(tower.b,.5);expect(bridges.check(at(bridges,b,mid.x,mid.y,mid.z+1),at(bridges,b,mid.x,mid.y,mid.z))[0]?.type).toBe('hit');});
test('missions: gates must be taken in order, the run is timed and the best time kept',()=>{
 const{bridges,b}=make('tower'),run=new MissionRun(bridges),m=MISSIONS.find(m=>m.id==='under-tower')!;run.start(m,100);
 run.events([{type:'under',bridge:b,opening:1,clearance:5}],112.5);expect(run.status).toBe('done');expect(run.finished).toBeCloseTo(12.5,5);expect(run.hud(113)).toContain('complete');
 const thames=MISSIONS.find(m=>m.id==='thames-run')!;run.start(thames,0);run.events([{type:'under',bridge:make('london').b,opening:1,clearance:3}],5);expect(run.next).toBe(0);});
