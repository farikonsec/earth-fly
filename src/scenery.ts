import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  GeoIndex,
  hash,
  type Feature,
  type Point,
  insideRing,
} from "./geodata";
import {
  latLonToDir,
  bodyToInertial,
  inertialToBody,
  dirToLatLon,
} from "./geo";
import { EARTH } from "./earth";
import type { Terrain } from "./terrain";
import type { V } from "./vector";
const KM = 0.001;
export class Scenery {
  private waterTime = { value: 0 };
  waterSky = { value: new T.Color(.22, .4, .5) };
  group = new T.Group();
  features: Feature[] = [];
  index = new GeoIndex([]);
  trees: T.InstancedMesh | null = null;
  treeCount = 0;
  waterCount = 0;
  ready = false;
  error = "";
  mask: T.CanvasTexture | null = null;
  createMask() {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 2048;
    const c = canvas.getContext("2d")!;
    c.fillStyle = "#000";
    c.fillRect(0, 0, 2048, 2048);
    for (const kind of ["forest", "water"]) {
      c.fillStyle = kind === "water" ? "#ff0000" : "#00ff00";
      for (const f of this.features) {
        if (f.kind !== kind) continue;
        c.beginPath();
        for (const ring of [
          f.ring,
          ...(f.holes ?? []).filter((r) =>
            insideRing(r[0][0], r[0][1], f.ring),
          ),
        ]) {
          ring.forEach(([lon, lat], i) => {
            const x = ((lon - 7.5) / 1.1) * 2048,
              y = ((47.05 - lat) / 0.75) * 2048;
            i ? c.lineTo(x, y) : c.moveTo(x, y);
          });
          c.closePath();
        }
        c.fill("evenodd");
      }
    }
    this.mask = new T.CanvasTexture(canvas);
    this.mask.generateMipmaps = true;
    this.mask.minFilter = T.LinearMipmapLinearFilter;
  }

  anchor = new T.Vector3(...latLonToDir(46.72, 8)).multiplyScalar(EARTH.radius);
  constructor(private terrain: Terrain) {
    this.group.name = "Mapped Alpine scenery";
  }
  async init() {
    const r = await fetch("scenery/alps.json");
    if (!r.ok) throw Error("Reference scenery unavailable");
    const data = await r.json();
    if (data.version !== 1) throw Error("Unsupported scenery");
    this.features = data.features;
    for (const f of this.features) {
      if (f.kind === "water" && !Number.isFinite(f.elevation)) {
        const samples = f.ring
          .filter(
            (_, i) => i % Math.max(1, Math.floor(f.ring.length / 32)) === 0,
          )
          .map(([lon, lat]) => this.terrain.height(lat, lon))
          .sort((a, b) => a - b);
        f.elevation = samples[Math.floor(samples.length * 0.25)] ?? 0;
      }
    }
    this.index = new GeoIndex(this.features);
    this.terrain.waterLevel = (lat, lon) => {
      const f = this.index.at(lat, lon, "water");
      return f ? f.elevation! : null;
    };
    this.terrain.revision++;
    this.createMask();
    this.buildWater();
    this.buildForest();
    this.ready = true;
  }
  private position(lon: number, lat: number, height: number) {
    return new T.Vector3(...latLonToDir(lat, lon))
      .multiplyScalar(EARTH.radius + height * KM)
      .sub(this.anchor);
  }
  private buildWater() {
    const lakeMat = new T.MeshStandardMaterial({
      color: 0x103c49,
      roughness: 0.32,
      metalness: 0.15,
      side: T.DoubleSide,
    });
    lakeMat.onBeforeCompile = (shader) => {
      shader.uniforms.waterTime = this.waterTime;
      shader.uniforms.waterSky = this.waterSky;
      shader.vertexShader = "varying vec3 vWaterP;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvWaterP=position;",
      );
      shader.fragmentShader =
        "uniform float waterTime;uniform vec3 waterSky;varying vec3 vWaterP;\n" +
        shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <normal_fragment_begin>",
        "#include <normal_fragment_begin>\nfloat footprint=max(length(dFdx(vWaterP)),length(dFdy(vWaterP)));float ripple=(1.-smoothstep(.3,3.,length(vViewPosition)))*(1.-smoothstep(.001,.008,footprint));vec2 w=vWaterP.xz;normal=normalize(normal+vec3(sin(dot(w,vec2(320.,173.))+waterTime*1.2)+.4*sin(dot(w,vec2(-154.,213.))-waterTime*.8),sin(dot(w,vec2(219.,-310.))-waterTime)+.3*sin(dot(w,vec2(115.,70.))+waterTime*.7),0.)*.03*ripple);",
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <opaque_fragment>",
        "float lakeF=.02+.98*pow(1.-abs(dot(normal,normalize(vViewPosition))),5.);outgoingLight=mix(outgoingLight*vec3(.55,.82,.86),waterSky*1.35,lakeF*.92);\n#include <opaque_fragment>",
      );
    };
    for (const f of this.features) {
      if (f.kind !== "water") continue;
      const origin = f.ring[0],
        scaleX = 111.195 * Math.cos((origin[1] * Math.PI) / 180),
        scaleY = 111.195;
      const to2 = (p: Point) =>
        new T.Vector2((p[0] - origin[0]) * scaleX, (p[1] - origin[1]) * scaleY);
      const shape = new T.Shape(f.ring.map(to2));
      for (const ring of f.holes ?? [])
        if (insideRing(ring[0][0], ring[0][1], f.ring))
          shape.holes.push(new T.Path(ring.map(to2)));
      const g = new T.ShapeGeometry(shape),
        pos = g.getAttribute("position");
      for (let i = 0; i < pos.count; i++) {
        const lon = origin[0] + pos.getX(i) / scaleX,
          lat = origin[1] + pos.getY(i) / scaleY,
          p = this.position(lon, lat, (f.elevation ?? 0) + 0.35);
        pos.setXYZ(i, p.x, p.y, p.z);
      }
      g.computeVertexNormals();
      const mesh = new T.Mesh(g, lakeMat);
      mesh.name = f.name || f.id;
      mesh.renderOrder = 1;
      this.group.add(mesh);
      this.waterCount++;
    }
    const riverMat = new T.MeshStandardMaterial({
      color: 0x429aa3,
      roughness: 0.35,
      metalness: 0.05,
      side: T.DoubleSide,
    });
    for (const f of this.features) {
      if (f.kind !== "river") continue;
      const positions: number[] = [],
        indices: number[] = [];
      let ceiling = 10000;
      for (let i = 0; i < f.ring.length; i++) {
        const [lon, lat] = f.ring[i],
          next = f.ring[Math.min(i + 1, f.ring.length - 1)],
          prev = f.ring[Math.max(0, i - 1)],
          dx = (next[0] - prev[0]) * Math.cos((lat * Math.PI) / 180),
          dy = next[1] - prev[1],
          l = Math.hypot(dx, dy) || 1,
          half = (f.width ?? 18) / 2 / 111195,
          water = this.index.at(lat, lon, "water");
        ceiling = Math.min(
          ceiling,
          water?.elevation ?? this.terrain.height(lat, lon),
        );
        for (const side of [-1, 1]) {
          const p = this.position(
            lon - (((side * dy) / l) * half) / Math.cos((lat * Math.PI) / 180),
            lat + ((side * dx) / l) * half,
            ceiling + 0.5,
          );
          positions.push(...p.toArray());
        }
        if (i > 0) {
          const a = i * 2;
          indices.push(a - 2, a - 1, a, a - 1, a + 1, a);
        }
      }
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
      g.setIndex(indices);
      g.computeVertexNormals();
      const m = new T.Mesh(g, riverMat);
      m.name = f.name || "River";
      this.group.add(m);
    }
  }
  private buildForest() {
    const parts: T.BufferGeometry[] = [];
    const add = (g: T.BufferGeometry, color: number) => {
      const colors = new Float32Array(g.getAttribute("position").count * 3),
        c = new T.Color(color);
      for (let i = 0; i < colors.length; i += 3) colors.set(c.toArray(), i);
      g.setAttribute("color", new T.BufferAttribute(colors, 3));
      parts.push(g);
    };
    const trunk = new T.CylinderGeometry(0.00045, 0.0006, 0.006, 4);
    trunk.translate(0, 0.003, 0);
    add(trunk, 0x665441);
    for (const [radius, height, y] of [
      [0.0042, 0.009, 0.008],
      [0.0033, 0.008, 0.012],
      [0.0022, 0.006, 0.016],
    ]) {
      const cone = new T.ConeGeometry(radius, height, 5);
      cone.translate(0, y, 0);
      add(cone, 0x365641);
    }
    const geometry = mergeGeometries(parts);
    for (const p of parts) p.dispose();
    const material = new T.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
    });
    material.onBeforeCompile = (s) => {
      s.fragmentShader = s.fragmentShader.replace(
        "#include <opaque_fragment>",
        `float keep=1.-smoothstep(10.,24.,length(vViewPosition));float dither=fract(sin(dot(floor(gl_FragCoord.xy),vec2(12.9898,78.233)))*43758.5453);if(dither>keep)discard;\n#include <opaque_fragment>`,
      );
    };
    const candidates: { lon: number; lat: number; seed: number }[] = [];
    const used = new Set<string>();
    for (const f of this.features) {
      if (f.kind !== "forest") continue;
      const xs = f.ring.map((p) => p[0]),
        ys = f.ring.map((p) => p[1]),
        minX = Math.floor(Math.min(...xs) / 0.0005),
        maxX = Math.ceil(Math.max(...xs) / 0.0005),
        minY = Math.floor(Math.min(...ys) / 0.00035),
        maxY = Math.ceil(Math.max(...ys) / 0.00035);
      for (let y = minY; y <= maxY; y++)
        for (let x = minX; x <= maxX; x++) {
          const key = `${x}/${y}`;
          if (used.has(key)) continue;
          used.add(key);
          const seed = hash(x, y),
            lon = (x + 0.15 + 0.7 * seed) * 0.0005,
            lat = (y + 0.15 + 0.7 * hash(y, x)) * 0.00035;
          if (
            this.index.at(lat, lon, "forest") &&
            !this.index.at(lat, lon, "water")
          )
            candidates.push({ lon, lat, seed });
        }
    }
    candidates.sort((a, b) => a.seed - b.seed);
    const trees = new T.InstancedMesh(
        geometry,
        material,
        Math.min(32000, candidates.length),
      ),
      dummy = new T.Object3D(),
      up = new T.Vector3(0, 1, 0);
    let count = 0;
    for (const p of candidates) {
      if (count >= 32000) break;
      const h = this.terrain.height(p.lat, p.lon);
      if (h > 2300 || h < 0) continue;
      const slope =
        Math.hypot(
          this.terrain.height(p.lat + 0.00018, p.lon) - h,
          this.terrain.height(p.lat, p.lon + 0.00026) - h,
        ) / 20;
      if (slope > 0.85) continue;
      dummy.position.copy(this.position(p.lon, p.lat, h));
      dummy.quaternion.setFromUnitVectors(
        up,
        new T.Vector3(...latLonToDir(p.lat, p.lon)),
      );
      dummy.rotateY(p.seed * Math.PI * 2);
      dummy.scale.setScalar(
        0.7 + hash(Math.floor(p.lon * 1e6), Math.floor(p.lat * 1e6)) * 0.65,
      );
      dummy.updateMatrix();
      trees.setMatrixAt(count, dummy.matrix);
      trees.setColorAt(
        count,
        new T.Color().setRGB(
          0.7 + p.seed * 0.4,
          0.8 + p.seed * 0.3,
          0.65 + p.seed * 0.3,
        ),
      );
      count++;
    }
    trees.count = count;
    trees.instanceMatrix.needsUpdate = true;
    trees.computeBoundingSphere();
    this.treeCount = count;
    this.trees = trees;
    this.group.add(trees);
  }
  update(position: V, time: number) {
    this.waterTime.value = time;
    const body = inertialToBody(position, time, EARTH.rotation),
      loc = dirToLatLon(body);
    this.group.visible =
      loc.lat > 46.2 && loc.lat < 47.2 && loc.lon > 7.3 && loc.lon < 8.8;
    if (!this.group.visible) return;
    this.group.rotation.y = (time / EARTH.rotation) * Math.PI * 2;
    this.group.position
      .set(...bodyToInertial(this.anchor.toArray() as V, time, EARTH.rotation))
      .sub(new T.Vector3(...position));
  }
}
