import * as T from 'three';
import {lineOfSight,type RadarContact} from './contacts';
import type {OrbitalTraffic} from './orbital-traffic';
import {dirToLatLon,inertialToBody} from './geo';
import {EARTH} from './earth';
import type {Threats} from './combat';
import {airVelocity} from './combat-ai';
const RANGES=[2,5,10,25,50,100,250,500,2000,50000];
const colours={hostile:'#ff827b',civil:'#6ce4c7',orbital:'#88b9ff',ground:'#ffb35c',road:'#d0d9df',rail:'#d8aaff',friendly:'#7fd4ff',sub:'#c08bff',cruise:'#ff4f6d'};
export class Radar{
 element=document.createElement('section');canvas=document.createElement('canvas');dialog=document.createElement('dialog');selected:string|null=null;range=25;filter='all';contacts:RadarContact[]=[];visible:RadarContact[]=[];onSelect:((c:RadarContact)=>void)|null=null;onRendezvous:((id:number)=>void)|null=null;onNow:(()=>void)|null=null;
 private ctx=this.canvas.getContext('2d')!;private summary:HTMLElement;private detail:HTMLElement;private list:HTMLElement;private search:HTMLInputElement;private origin=new T.Vector3();private time=0;private utc=0;private last=0;private picks:{c:RadarContact;x:number;y:number}[]=[];
 constructor(private orbits:OrbitalTraffic){
  this.element.id='traffic-radar';this.element.setAttribute('aria-label','Aircraft radar');
  this.element.innerHTML='<header><strong>RADAR <span>•</span></strong><button id="radar-contacts">Contacts ↗</button><button id="radar-size" title="Larger radar">⤢</button><button id="radar-fold" title="Collapse radar">−</button></header><div class="radar-body"></div><footer><div class="radar-zoom"><button id="radar-in" title="Zoom in (or scroll on the scope)">−</button><span id="radar-range">25 km</span><button id="radar-out" title="Zoom out">+</button></div><span id="radar-count"></span></footer><div id="radar-summary">Acquiring traffic…</div>';
  this.canvas.width=this.canvas.height=440;this.canvas.setAttribute('aria-label','Heading-up radar. Click a contact to track it.');this.element.querySelector('.radar-body')!.append(this.canvas);document.body.append(this.element);this.summary=this.element.querySelector('#radar-summary')!;
  // Range steps by button or mouse wheel over the scope; the size button doubles as a quick way to read crowded scopes.
  const step=(d:number)=>{const i=Math.max(0,Math.min(RANGES.length-1,RANGES.indexOf(this.range)+d));this.range=RANGES[i];this.element.querySelector('#radar-range')!.textContent=`${this.range.toLocaleString()} km`;this.last=0;};
  this.element.querySelector<HTMLButtonElement>('#radar-in')!.onclick=()=>step(-1);this.element.querySelector<HTMLButtonElement>('#radar-out')!.onclick=()=>step(1);
  this.canvas.addEventListener('wheel',e=>{e.preventDefault();step(e.deltaY>0?1:-1);},{passive:false});
  this.element.querySelector<HTMLButtonElement>('#radar-size')!.onclick=()=>this.element.classList.toggle('large');
  this.element.querySelector<HTMLButtonElement>('#radar-fold')!.onclick=()=>this.element.classList.toggle('folded');
  this.canvas.onclick=e=>{const r=this.canvas.getBoundingClientRect(),x=(e.clientX-r.left)/r.width*220,y=(e.clientY-r.top)/r.height*220,best=this.picks.map(p=>({...p,d:Math.hypot(p.x-x,p.y-y)})).sort((a,b)=>a.d-b.d)[0];if(best&&best.d<15)this.choose(best.c);};
  this.dialog.id='radar-dialog';this.dialog.innerHTML='<div class="radar-dialog-head"><div><h2>Traffic</h2></div><button id="radar-close" aria-label="Close contacts">×</button></div><div class="radar-tools"><input id="radar-search" placeholder="Search" aria-label="Search contacts"><select id="radar-filter" aria-label="Contact category"><option value="all">All</option><option value="hostile">Hostile</option><option value="civil">Airliners</option><option value="orbital">Satellites</option><option value="road">Road</option><option value="rail">Rail</option></select><button id="radar-now">Now</button></div><p id="orbital-source"></p><div class="radar-columns"><div id="radar-list"></div><aside id="radar-detail"></aside></div>';
  document.body.append(this.dialog);this.list=this.dialog.querySelector('#radar-list')!;this.detail=this.dialog.querySelector('#radar-detail')!;this.search=this.dialog.querySelector('#radar-search')!;
  this.element.querySelector<HTMLButtonElement>('#radar-contacts')!.onclick=()=>{this.renderList();this.dialog.showModal();};this.dialog.querySelector<HTMLButtonElement>('#radar-close')!.onclick=()=>this.dialog.close();
  this.search.oninput=()=>this.renderList();this.dialog.querySelector<HTMLSelectElement>('#radar-filter')!.onchange=e=>{this.filter=(e.target as HTMLSelectElement).value;this.renderList();};this.dialog.querySelector<HTMLButtonElement>('#radar-now')!.onclick=()=>this.onNow?.();
 }
 choose(c:RadarContact){this.selected=c.id;if(c.kind==='orbital')this.orbits.selected=Number(c.id.slice(4));this.onSelect?.(c);this.renderDetail(c);}
 private renderDetail(c:RadarContact){
  const pos=dirToLatLon(inertialToBody(c.p.toArray() as [number,number,number],this.time,EARTH.rotation)),distance=c.p.distanceTo(this.origin),height=(c.p.length()-EARTH.radius);
  this.detail.replaceChildren();const h=document.createElement('h3');h.textContent=c.name;h.style.color=colours[c.kind];this.detail.append(h);
  for(const text of[c.detail,`${distance.toFixed(2)} km range · ${height.toFixed(3)} km above modeled mean sea level`,`${pos.lat.toFixed(5)}°, ${pos.lon.toFixed(5)}°`,c.kind==='orbital'?`Element epoch: ${c.epoch} UTC`:'Autonomous simulation · fictional schedule',lineOfSight(this.origin,c.p)?'Line of sight available':'Below radar horizon — catalog tracking only']){const p=document.createElement('p');p.textContent=text;this.detail.append(p);}
  if(c.kind==='orbital'){const b=document.createElement('button');b.textContent='Rendezvous · match orbit';b.onclick=()=>{this.onRendezvous?.(Number(c.id.slice(4)));this.dialog.close();};this.detail.append(b);const p=document.createElement('p');p.textContent='SGP4 estimate. Public active classification does not confirm operational status. Destruction affects this game session only.';this.detail.append(p);}
 }
 private renderList(){
  const q=this.search.value.toLowerCase(),base=this.contacts.filter(c=>(this.filter==='all'||this.filter===c.kind)&&`${c.name} ${c.detail}`.toLowerCase().includes(q)).sort((a,b)=>a.p.distanceToSquared(this.origin)-b.p.distanceToSquared(this.origin)),ids=new Set(base.map(c=>c.id));
  if(this.filter==='orbital'||this.filter==='all'&&q){for(const row of this.orbits.search(q||'ISS')){const id=Number(row.NORAD_CAT_ID);if(ids.has(`sat-${id}`)||this.orbits.destroyed.has(id))continue;const s=this.orbits.state(id,this.utc,this.time);if(s)base.push({id:`sat-${id}`,name:row.OBJECT_NAME,kind:'orbital',p:new T.Vector3(...s.p),v:new T.Vector3(...s.v),detail:`NORAD ${id} · ${s.speed.toFixed(3)} km/s · SGP4`,epoch:row.EPOCH,targetId:1000000+id});}}
  this.list.replaceChildren();for(const c of base.slice(0,80)){const b=document.createElement('button'),strong=document.createElement('strong'),small=document.createElement('small');strong.textContent=c.name;strong.style.color=colours[c.kind];small.textContent=`${c.p.distanceTo(this.origin).toFixed(1)} km · ${c.detail}`;b.append(strong,small);b.onclick=()=>this.choose(c);this.list.append(b);}if(!base.length)this.list.textContent='No matching contacts. Search the orbital catalog by name or NORAD number.';
  this.dialog.querySelector('#orbital-source')!.textContent=`${new Date(this.utc).toISOString().replace('T',' ').slice(0,19)} UTC · ${this.orbits.status}. Catalog retrieved ${this.orbits.source?.retrieved??'…'}. Positions are propagated estimates. Civil routes use synthetic timetables.`;
 }
 draw(contacts:RadarContact[],origin:T.Vector3,heading:number,t:number,utc:number,threats?:Threats){
  this.contacts=contacts;this.origin.copy(origin);this.time=t;this.utc=utc;const now=performance.now();if(now-this.last<(threats?.missiles.length?50:100))return;this.last=now;
  const c=this.ctx;c.setTransform(2,0,0,2,0,0);c.clearRect(0,0,220,220);const cx=110,cy=110,r=93;
  const bg=c.createRadialGradient(cx,cy,0,cx,cy,r);bg.addColorStop(0,'#15393f');bg.addColorStop(1,'#071b25');c.fillStyle=bg;c.beginPath();c.arc(cx,cy,r,0,Math.PI*2);c.fill();
  c.lineWidth=.6;c.strokeStyle='#69a8a544';for(const fraction of[.25,.5,.75,1]){c.beginPath();c.arc(cx,cy,r*fraction,0,Math.PI*2);c.stroke();}c.beginPath();c.moveTo(cx-r,cy);c.lineTo(cx+r,cy);c.moveTo(cx,cy-r);c.lineTo(cx,cy+r);c.stroke();
  c.font='9px monospace';c.textAlign='center';c.fillStyle='#afc9cd';c.fillText(`${Math.round(heading).toString().padStart(3,'0')}° TRUE`,110,10);c.fillText('HEADING UP · SLANT RANGE',110,216);
  const radial=origin.clone().normalize(),east=new T.Vector3(0,1,0).cross(radial).normalize(),north=radial.clone().cross(east),hdg=heading*Math.PI/180;this.picks=[];
  this.visible=contacts.filter(x=>x.p.distanceTo(origin)<=this.range&&lineOfSight(origin,x.p)).sort((a,b)=>a.p.distanceToSquared(origin)-b.p.distanceToSquared(origin));
  const labelBoxes:{x:number;y:number}[]=[];const sweep=(now/6000)%(Math.PI*2);c.strokeStyle='#76eac855';c.beginPath();c.moveTo(cx,cy);c.lineTo(cx+Math.sin(sweep)*r,cy-Math.cos(sweep)*r);c.stroke();
  for(const [i,k]of [...this.visible.filter((c,i)=>c.kind!=='road'&&c.kind!=='rail'||c.id===this.selected||i<40)].sort((a,b)=>a.id===this.selected?-1:b.id===this.selected?1:0).entries()){const rel=k.p.clone().sub(origin),bearing=Math.atan2(rel.dot(east),rel.dot(north))-hdg,rr=rel.length()/this.range*r,x=cx+Math.sin(bearing)*rr,y=cy-Math.cos(bearing)*rr,selected=k.id===this.selected;c.strokeStyle=c.fillStyle=colours[k.kind];c.lineWidth=selected?2:1;
   // Friendly: circle. Submarine contact: half circle (sonar symbol) with its uncertainty ring. Cruise missile: small cross.
   c.beginPath();if(k.kind==='friendly'){c.arc(x,y,3.5,0,Math.PI*2);}else if(k.kind==='sub'){c.arc(x,y,4,0,Math.PI);c.closePath();if(k.altitude!==undefined){c.moveTo(x+Math.min(40,k.altitude/this.range*93),y);c.arc(x,y,Math.min(40,k.altitude/this.range*93),0,Math.PI*2);}}else if(k.kind==='cruise'){c.moveTo(x-4,y);c.lineTo(x+4,y);c.moveTo(x,y-4);c.lineTo(x,y+4);}else if(k.kind==='road'||k.kind==='rail'){c.rect(x-2,y-2,4,k.kind==='rail'?7:4);}else if(k.kind==='ground'){c.moveTo(x,y-4);c.lineTo(x+4,y+3);c.lineTo(x-4,y+3);c.closePath();c.moveTo(x-5,y+5);c.lineTo(x+5,y+5);}else if(k.kind==='civil'){c.moveTo(x,y-4);c.lineTo(x+4,y+3);c.lineTo(x-4,y+3);c.closePath();}else if(k.kind==='orbital'){c.rect(x-2.5,y-2.5,5,5);}else{c.moveTo(x,y-4);c.lineTo(x+4,y);c.lineTo(x,y+4);c.lineTo(x-4,y);c.closePath();}c.stroke();
   if(selected){c.beginPath();c.arc(x,y,8,0,Math.PI*2);c.stroke();}if(selected||i<3&&!labelBoxes.some(b=>Math.abs(b.y-y)<13&&Math.abs(b.x-x)<100)){c.textAlign=x>110?'right':'left';c.font='8px monospace';c.fillText((k.kind==='civil'?k.name.split(' · ')[0]:k.name).slice(0,15),x+(x>110?-7:7),y-5);labelBoxes.push({x,y});}this.picks.push({c:k,x,y});
  }
  // Threats: whoever holds a seeker on us gets a pulsing ring and a strobe line; inbound missiles are flashing red
  // dots with a vector showing the next five seconds of travel.
  const place=(q:T.Vector3)=>{const rel=q.clone().sub(origin),b=Math.atan2(rel.dot(east),rel.dot(north))-hdg,rr=Math.min(r,rel.length()/this.range*r);return{x:cx+Math.sin(b)*rr,y:cy-Math.cos(b)*rr,edge:rel.length()>this.range};};
  if(threats){const pulse=.5+.5*Math.sin(now/90);
   for(const l of threats.locks){const a=place(l.p);c.strokeStyle=`rgba(255,190,90,${.5+.5*pulse})`;c.lineWidth=1.5;c.beginPath();c.arc(a.x,a.y,7+3*pulse,0,Math.PI*2);c.stroke();c.setLineDash([3,3]);c.beginPath();c.moveTo(cx,cy);c.lineTo(a.x,a.y);c.stroke();c.setLineDash([]);}
   for(const m of threats.missiles){const a=place(m.p),b=place(m.p.clone().addScaledVector(m.v.clone().sub(airVelocity(m.p)),5));if(now%300<200){c.fillStyle='#ff3b30';c.beginPath();c.arc(a.x,a.y,3.2,0,Math.PI*2);c.fill();}c.strokeStyle='#ff3b30';c.lineWidth=1;c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();}
   if(threats.missiles.length){c.strokeStyle=`rgba(255,59,48,${.35+.5*pulse})`;c.lineWidth=3;c.beginPath();c.arc(cx,cy,r+2,0,Math.PI*2);c.stroke();}}
  c.fillStyle='#ecfff5';c.beginPath();c.moveTo(cx,cy-6);c.lineTo(cx+4,cy+5);c.lineTo(cx,cy+2);c.lineTo(cx-4,cy+5);c.closePath();c.fill();
  this.element.querySelector('#radar-count')!.textContent=`${this.visible.length} returns`;
  const selected=contacts.find(x=>x.id===this.selected);this.summary.textContent=threats?.missiles.length?`⚠ ${threats.missiles.length} missile${threats.missiles.length>1?'s':''} inbound`:selected?`${selected.name} · ${selected.p.distanceTo(origin).toFixed(1)} km${lineOfSight(origin,selected.p)?'':' · BELOW HORIZON'}`:`${contacts.filter(c=>c.kind==='hostile').length} patrols · ${contacts.filter(c=>c.kind==='ground').length} SAM sites · ${contacts.filter(c=>c.kind==='civil').length} airliners · ${this.orbits.valid.toLocaleString()} orbits`;
  if(this.dialog.open&&Math.floor(now/1000)!==Math.floor((now-110)/1000)){this.renderList();if(selected)this.renderDetail(selected);}
 }
}
