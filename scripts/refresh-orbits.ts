/** Manual refresh only. One request; never run per frame or per client. */
const url='https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json';
const r=await fetch(url);if(!r.ok)throw Error(`CelesTrak ${r.status}; retain previous snapshot, do not retry in a loop.`);
const rows=await r.json();if(!Array.isArray(rows)||rows.length<1000||!rows.some(x=>x.NORAD_CAT_ID===25544))throw Error('Incomplete catalog; previous snapshot retained');
await Bun.write('public/orbits/active.json',JSON.stringify(rows));
await Bun.write('public/orbits/source.json',JSON.stringify({url,retrieved:new Date().toISOString(),count:rows.length,notice:'Public active-group snapshot. Operational status is not independently confirmed. SGP4 estimates, not live telemetry.'},null,2));
console.log(`Saved ${rows.length} orbital records.`);
