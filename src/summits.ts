/** WGS84 summit references, checked 2026-10-18. Heights are MSL references, not DEM corrections. */
export interface Summit {
  id:string; name:string; continent:string; lat:number; lon:number; elevation:number;
  coordinateSource:string; heightSource:string; alternate?:boolean;
}
const peak=(id:number)=>`https://www.peakbagger.com/peak.aspx?pid=${id}`;
export const SUMMITS:readonly Summit[]=[
  {id:'everest',name:'Everest',continent:'Asia',lat:27.988257,lon:86.925145,elevation:8848.86,coordinateSource:peak(10640),heightSource:'https://www.tourismdepartment.gov.np/files/statistics/46.pdf'},
  {id:'aconcagua',name:'Aconcagua',continent:'South America',lat:-32.653099,lon:-70.012088,elevation:6960.8,coordinateSource:peak(8594),heightSource:'https://www.ign.gob.ar/Novedades/NuevaAlturaAconcagua'},
  {id:'denali',name:'Denali',continent:'North America',lat:63.069042,lon:-151.006347,elevation:6190.488,coordinateSource:peak(271),heightSource:'https://www.nps.gov/articles/denali-crp-summit-survey.htm'},
  {id:'kilimanjaro',name:'Kilimanjaro · Uhuru Peak',continent:'Africa',lat:-3.076448,lon:37.354034,elevation:5895,coordinateSource:peak(11202),heightSource:peak(11202)},
  {id:'elbrus',name:'Elbrus · west summit',continent:'Europe',lat:43.353811,lon:42.436098,elevation:5642,coordinateSource:peak(10381),heightSource:'https://volcano.si.edu/volcano.cfm?vn=214010'},
  {id:'vinson',name:'Mount Vinson',continent:'Antarctica',lat:-78.525483,lon:-85.617147,elevation:4892,coordinateSource:peak(12108),heightSource:peak(12108)},
  {id:'carstensz',name:'Carstensz Pyramid · Puncak Jaya',continent:'Oceania',lat:-4.078531,lon:137.158077,elevation:4884,coordinateSource:peak(11360),heightSource:peak(11360)},
  {id:'kosciuszko',name:'Mount Kosciuszko',continent:'Australia · alternate list',lat:-36.456076,lon:148.263399,elevation:2228,coordinateSource:peak(11624),heightSource:'https://www.ga.gov.au/scientific-topics/national-location-information/landforms/highest-mountains',alternate:true},
];
export function summitTiles(s:Pick<Summit,'lat'|'lon'>,z:number){
  const n=2**z,x=Math.floor((s.lon+180)/360*n),y=Math.floor((1-Math.asinh(Math.tan(s.lat*Math.PI/180))/Math.PI)/2*n);
  return Array.from({length:9},(_,i)=>({z,x:((x+i%3-1)%n+n)%n,y:y+Math.floor(i/3)-1}));
}
export function summitApproach(s:Summit){const north=s.id==='dombay';return {lat:s.lat+(north?1:-1)*8/111.195,lon:s.lon,heading:north?180:0,altitudeMSL:s.elevation+1600,speed:180};}
