import { mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { REFERENCE_DETAIL as bounds } from '../src/terrain-data';
const root = new URL('../public/terrain/', import.meta.url), files: { key: string; sha256: string; bytes: number; url: string }[] = [];
const manifestFile = Bun.file(new URL('detail-manifest.json', root));
const pinned: Map<string, string> = new Map(await manifestFile.exists()
  ? (await manifestFile.json()).files.map((file: {key:string;sha256:string}) => [file.key, file.sha256]) : []);
for (let x = bounds.minX; x <= bounds.maxX; x++) {
  await mkdir(new URL(`${bounds.z}/${x}/`, root), { recursive: true });
  for (let y = bounds.minY; y <= bounds.maxY; y++) {
    const key = `${bounds.z}/${x}/${y}`, path = new URL(`${key}.png`, root),
      url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${key}.png`;
    let bytes: Uint8Array;
    if (await Bun.file(path).exists()) bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
    else {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw Error(`${key}: HTTP ${response.status}`);
      bytes = new Uint8Array(await response.arrayBuffer());
    }
    const png = PNG.sync.read(Buffer.from(bytes));
    if (png.width !== 256 || png.height !== 256) throw Error(`Invalid tile ${key}`);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (pinned.has(key) && pinned.get(key) !== sha256) throw Error(`Pinned checksum mismatch: ${key}`);
    await Bun.write(path, bytes);
    files.push({ key, sha256, bytes: bytes.length, url });
  }
  console.log(`Validated detail column ${x}`);
}
await Bun.write(new URL('detail-manifest.json', root), JSON.stringify({
  source: 'Mapzen terrain tiles / Tilezen Joerd, Terrarium encoding',
  documentation: 'https://github.com/tilezen/joerd/blob/master/docs/use-service.md',
  attribution: 'ATTRIBUTION.md', bounds, files,
}, null, 2) + '\n');
console.log(`${files.length} tiles, ${files.reduce((sum, file) => sum + file.bytes, 0)} bytes; SHA-256 manifest saved`);
