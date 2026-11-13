/**
 * Environment Agency LIDAR Composite DTM (bare earth, 1 m source) for the Heathrow to Docklands corridor,
 * resampled by the EA WCS to about 5 m on a lat/lon grid. Open Government Licence v3.0.
 * Writes public/terrain/london-dtm.bin.gz (Int16 decimetres, row-delta coded) and london-dtm.json.
 * Raw chunks are cached in work/lidar/. Run: bun scripts/prepare-london-lidar.ts
 */
import { existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
const BOX = { west: -0.52, east: 0.06, south: 51.44, north: 51.56 }, COLS = 8040, ROWS = 2680, CX = 8, CY = 4;
const coverage = "13787b9a-26a4-4775-8523-806d13af58fc__Lidar_Composite_Elevation_DTM_1m";
const base = "https://environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m/wcs";
/** Minimal reader for the uncompressed, single-strip-or-striped float32 GeoTIFF the service returns. */
function readTiff(buffer: ArrayBuffer) {
  const v = new DataView(buffer), le = v.getUint16(0) === 0x4949, u16 = (o: number) => v.getUint16(o, le), u32 = (o: number) => v.getUint32(o, le);
  const ifd = u32(4), n = u16(ifd), tags = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12, tag = u16(e), type = u16(e + 2), count = u32(e + 4), size = type === 3 ? 2 : 4, at = count * size <= 4 ? e + 8 : u32(e + 8), values: number[] = [];
    for (let k = 0; k < Math.min(count, 100000); k++) values.push(type === 3 ? u16(at + k * 2) : u32(at + k * 4));
    tags.set(tag, values);
  }
  const width = tags.get(256)![0], height = tags.get(257)![0], compression = tags.get(259)?.[0] ?? 1;
  if (compression !== 1) throw Error(`Compressed TIFF (${compression})`);
  const out = new Float32Array(width * height);
  if (tags.has(324)) {
    // Tiled layout: tiles run left to right, top to bottom; edge tiles are padded.
    const tw = tags.get(322)![0], th = tags.get(323)![0], across = Math.ceil(width / tw);
    tags.get(324)!.forEach((offset, t) => { const ox = (t % across) * tw, oy = Math.floor(t / across) * th; for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) { const X = ox + x, Y = oy + y; if (X < width && Y < height) out[Y * width + X] = v.getFloat32(offset + (y * tw + x) * 4, le); } });
  } else {
    const offsets = tags.get(273)!, rowsPer = tags.get(278)?.[0] ?? height;
    offsets.forEach((offset, s) => { const rows = Math.min(rowsPer, height - s * rowsPer); for (let k = 0; k < rows * width; k++) out[s * rowsPer * width + k] = v.getFloat32(offset + k * 4, le); });
  }
  return { width, height, data: out };
}
const grid = new Float32Array(COLS * ROWS).fill(NaN), cw = COLS / CX, ch = ROWS / CY;
for (let j = 0; j < CY; j++) for (let i = 0; i < CX; i++) {
  const west = BOX.west + ((BOX.east - BOX.west) * i) / CX, east = BOX.west + ((BOX.east - BOX.west) * (i + 1)) / CX, north = BOX.north - ((BOX.north - BOX.south) * j) / CY, south = BOX.north - ((BOX.north - BOX.south) * (j + 1)) / CY;
  const file = `work/lidar/chunk-${i}-${j}.tif`;
  // Large requests time out on the service (it reads the 1 m source), so a chunk is fetched as four quarters.
  const fetchPart = async (part: string, w: number, e: number, s: number, n: number, pw: number, ph: number) => {
    if (existsSync(part)) return;
    const url = `${base}?service=WCS&version=2.0.1&request=GetCoverage&coverageId=${coverage}&format=image/tiff&subsettingCrs=http://www.opengis.net/def/crs/EPSG/0/4326&outputCrs=http://www.opengis.net/def/crs/EPSG/0/4326&subset=Lat(${s.toFixed(7)},${n.toFixed(7)})&subset=Long(${w.toFixed(7)},${e.toFixed(7)})&scalesize=i(${pw}),j(${ph})`;
    for (let attempt = 0; attempt < 16; attempt++) {
      const r = await fetch(url, { headers: { "User-Agent": "earth-fly-prepare/0.24" }, signal: AbortSignal.timeout(180000) }).catch(() => null);
      if (r?.ok && (r.headers.get("content-type") ?? "").includes("tiff")) { await Bun.write(part, await r.arrayBuffer()); await Bun.sleep(2500); return; }
      // The service rate-limits (429): back off generously.
      console.log(`${part} retry ${attempt + 1} ${r?.status}`); await Bun.sleep((r?.status === 429 ? 30000 : 6000) * Math.min(attempt + 1, 4));
    }
    throw Error(`${part} failed`);
  };
  let pixels: Float32Array, pw0 = cw, ph0 = ch;
  if (existsSync(file)) { const t = readTiff(await Bun.file(file).arrayBuffer()); pixels = t.data; pw0 = t.width; ph0 = t.height; }
  else {
    pixels = new Float32Array(cw * ch); const wl = Math.floor(cw / 2), ht = Math.floor(ch / 2);
    for (const [qx, qy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const x0 = qx ? wl : 0, pw = qx ? cw - wl : wl, y0 = qy ? ht : 0, ph = qy ? ch - ht : ht;
      const w = west + ((east - west) * x0) / cw, e = west + ((east - west) * (x0 + pw)) / cw, n = north - ((north - south) * y0) / ch, s = north - ((north - south) * (y0 + ph)) / ch, part = `work/lidar/chunk-${i}-${j}-${qx}${qy}.tif`;
      await fetchPart(part, w, e, s, n, pw, ph);
      const q = readTiff(await Bun.file(part).arrayBuffer()); if (q.width !== pw || q.height !== ph) throw Error(`${part} is ${q.width}x${q.height}`);
      for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) pixels[(y0 + y) * cw + x0 + x] = q.data[y * pw + x];
    }
  }
  console.log(`chunk ${i},${j}`);
  if (pw0 !== cw || ph0 !== ch) throw Error(`chunk ${i},${j} is ${pw0}x${ph0}`);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const h = pixels[y * cw + x]; grid[(j * ch + y) * COLS + i * cw + x] = h > -100 && h < 2000 ? h : NaN; }
}
// No-data (river surfaces, a few voids): fill by repeated neighbour averaging so the grid is complete.
let holes = 0; for (const h of grid) if (Number.isNaN(h)) holes++;
const holesBefore = holes;
for (let pass = 0; pass < 400 && holes; pass++) {
  holes = 0;
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const k = y * COLS + x; if (!Number.isNaN(grid[k])) continue; let s = 0, c = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= COLS || yy >= ROWS) continue; const h = grid[yy * COLS + xx]; if (!Number.isNaN(h)) { s += h; c++; } }
    if (c) grid[k] = s / c; else holes++;
  }
}
const coded = new Int16Array(COLS * ROWS); let min = 1e9, max = -1e9;
for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) { const k = y * COLS + x, h = Math.round((Number.isNaN(grid[k]) ? 0 : grid[k]) * 10); min = Math.min(min, h); max = Math.max(max, h); coded[k] = h - (x ? Math.round((Number.isNaN(grid[k - 1]) ? 0 : grid[k - 1]) * 10) : 0); }
const zipped = gzipSync(new Uint8Array(coded.buffer), { level: 9 });
await Bun.write("public/terrain/london-dtm.bin.gz", zipped);
const meta = { source: "Environment Agency LIDAR Composite DTM 1m (WCS, resampled ~5 m)", license: "Open Government Licence v3.0. © Environment Agency copyright and/or database right. All rights reserved.", bounds: BOX, cols: COLS, rows: ROWS, encoding: "int16 decimetres, each row delta-coded west to east, gzip", order: "row 0 = north edge, pixel centres", minM: min / 10, maxM: max / 10, filledNoData: holesBefore, bytes: zipped.length, sha256: createHash("sha256").update(zipped).digest("hex") };
await Bun.write("public/terrain/london-dtm.json", JSON.stringify(meta, null, 1)); console.log(meta);
