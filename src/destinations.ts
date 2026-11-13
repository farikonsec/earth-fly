import {SUMMITS,type Summit} from './summits';
export const DOMBAY:Summit={id:'dombay',name:'Dombay-Ulgen · Caucasus',continent:'Caucasus · regional destination',lat:43.243572,lon:41.727285,elevation:4046,coordinateSource:'https://www.peakbagger.com/peak.aspx?pid=10378',heightSource:'https://www.peakbagger.com/peak.aspx?pid=10378'};
export const ALL_PEAKS:readonly Summit[]=[...SUMMITS,DOMBAY];
/** Fixed historical/educational water datum; not a live Caspian lake-level measurement. */
export const CASPIAN={id:'caspian',lat:40.31,lon:50,elevation:-28,name:'Caspian Sea · Absheron coast'};
export function caspianRegion(lat:number,lon:number){return lat>=36&&lat<=48&&lon>=46&&lon<=55;}
