export const wrap=(v:number)=>((v+180)%360+360)%360-180;
const R=6371,D=Math.PI/180;
/** Polar stereographic inset avoids longitude collapse and empty map halves at ±90°. */
export function mapProjection(center:{lat:number;lon:number},span:number,w:number,h:number){
 const polar=Math.abs(center.lat)>75,sign=Math.sign(center.lat)||1;
 const xy=(lat:number,lon:number)=>{const r=2*R*Math.tan((90-sign*lat)*D/2);return{x:r*Math.sin(lon*D),y:sign*r*Math.cos(lon*D)};};
 const origin=xy(center.lat,center.lon),scale=w/(span*111.195),sy=span*Math.max(.12,Math.cos(center.lat*D))*h/w;
 const project=(lat:number,lon:number):[number,number]=>{if(!polar)return[w*(.5+wrap(lon-center.lon)/span),h*(.5-(lat-center.lat)/sy)];const p=xy(lat,lon);return[w/2+(p.x-origin.x)*scale,h/2+(p.y-origin.y)*scale];};
 const invert=(x:number,y:number)=>{if(!polar)return{lat:Math.max(-90,Math.min(90,center.lat+(.5-y/h)*sy)),lon:wrap(center.lon+(x/w-.5)*span)};const xx=(x-w/2)/scale+origin.x,yy=(y-h/2)/scale+origin.y,r=Math.hypot(xx,yy);return{lat:sign*(90-2*Math.atan(r/(2*R))/D),lon:wrap(Math.atan2(xx,sign*yy)/D)};};
 return{project,invert,polar,sy,kmPerQuarter:polar?span*111.195/4:span*111.195*Math.cos(center.lat*D)/4,headingOffset:polar?-sign*center.lon:0};
}
