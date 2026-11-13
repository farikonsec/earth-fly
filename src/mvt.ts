/**
 * Minimal Mapbox Vector Tile reader: just enough protobuf to pull named layers out of a tile.
 * Geometry comes back in tile units (0..extent, y down). Polygons keep their ring order.
 */
export interface MvtFeature { type: 1 | 2 | 3; properties: Record<string, string | number | boolean>; rings: Float32Array[] }
export interface MvtLayer { extent: number; features: MvtFeature[] }

class Reader {
  pos = 0;
  constructor(public bytes: Uint8Array, public end = bytes.length) {}
  varint() { let result = 0, shift = 0, b: number; do { b = this.bytes[this.pos++]; result += (b & 0x7f) * 2 ** shift; shift += 7; } while (b >= 0x80 && this.pos <= this.end); return result; }
  skip(wire: number) { if (wire === 0) this.varint(); else if (wire === 1) this.pos += 8; else if (wire === 2) this.pos += this.varint(); else if (wire === 5) this.pos += 4; else throw Error("Unsupported wire type"); }
  sub() { const length = this.varint(), r = new Reader(this.bytes, this.pos + length); r.pos = this.pos; this.pos += length; return r; }
}
const utf8 = new TextDecoder();
function value(r: Reader): string | number | boolean {
  let out: string | number | boolean = "";
  const view = new DataView(r.bytes.buffer, r.bytes.byteOffset);
  while (r.pos < r.end) {
    const tag = r.varint(), field = tag >> 3, wire = tag & 7;
    if (field === 1) { const n = r.varint(); out = utf8.decode(r.bytes.subarray(r.pos, r.pos + n)); r.pos += n; }
    else if (field === 2) { out = view.getFloat32(r.pos, true); r.pos += 4; }
    else if (field === 3) { out = view.getFloat64(r.pos, true); r.pos += 8; }
    else if (field === 4 || field === 5) out = r.varint();
    else if (field === 6) { const n = r.varint(); out = n % 2 ? -(n + 1) / 2 : n / 2; }
    else if (field === 7) out = r.varint() !== 0;
    else r.skip(wire);
  }
  return out;
}
function geometry(r: Reader): Float32Array[] {
  const rings: Float32Array[] = []; let x = 0, y = 0, current: number[] = [];
  while (r.pos < r.end) {
    const command = r.varint(), id = command & 7, count = command >> 3;
    if (id === 1 || id === 2) {
      for (let i = 0; i < count; i++) {
        const dx = r.varint(), dy = r.varint(); x += dx % 2 ? -(dx + 1) / 2 : dx / 2; y += dy % 2 ? -(dy + 1) / 2 : dy / 2;
        if (id === 1 && current.length) { rings.push(new Float32Array(current)); current = []; }
        current.push(x, y);
      }
    } else if (id === 7 && current.length) { rings.push(new Float32Array(current)); current = []; }
  }
  if (current.length) rings.push(new Float32Array(current));
  return rings;
}
/** Decodes only the layers named in `wanted`. */
export function readTile(buffer: ArrayBuffer, wanted: string[]): Record<string, MvtLayer> {
  const out: Record<string, MvtLayer> = {}, tile = new Reader(new Uint8Array(buffer));
  while (tile.pos < tile.end) {
    const tag = tile.varint();
    if (tag >> 3 !== 3) { tile.skip(tag & 7); continue; }
    const layer = tile.sub(), start = layer.pos;
    let name = "", extent = 4096; const keys: string[] = [], values: (string | number | boolean)[] = [], features: Reader[] = [];
    while (layer.pos < layer.end) {
      const t = layer.varint(), field = t >> 3;
      if (field === 1) { const n = layer.varint(); name = utf8.decode(layer.bytes.subarray(layer.pos, layer.pos + n)); layer.pos += n; if (!wanted.includes(name)) break; }
      else if (field === 2) features.push(layer.sub());
      else if (field === 3) { const n = layer.varint(); keys.push(utf8.decode(layer.bytes.subarray(layer.pos, layer.pos + n))); layer.pos += n; }
      else if (field === 4) values.push(value(layer.sub()));
      else if (field === 5) extent = layer.varint();
      else layer.skip(t & 7);
    }
    // Field order is not guaranteed: a layer whose name arrived late is re-read once the name is known.
    if (!wanted.includes(name)) { if (name || layer.pos >= layer.end) continue; layer.pos = start; continue; }
    const list: MvtFeature[] = [];
    for (const f of features) {
      let type: 1 | 2 | 3 = 1, rings: Float32Array[] = []; const properties: MvtFeature["properties"] = {};
      while (f.pos < f.end) {
        const t = f.varint(), field = t >> 3;
        if (field === 2) { const tags = f.sub(); while (tags.pos < tags.end) { const k = tags.varint(), v = tags.varint(); properties[keys[k]] = values[v]; } }
        else if (field === 3) type = f.varint() as 1 | 2 | 3;
        else if (field === 4) rings = geometry(f.sub());
        else f.skip(t & 7);
      }
      list.push({ type, properties, rings });
    }
    out[name] = { extent, features: list };
  }
  return out;
}
