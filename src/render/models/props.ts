// Bedroom props: the toys scattered on the floorboards on both sides of the rug (lane).
// Seven kinds, every one thin-instanced, at most two meshes per kind (14 meshes, so the
// whole prop set is 14 draw calls per pass however many props a level scatters):
//
//   block   painted wooden alphabet block, embossed cream letters/numbers, thin frames
//           (never yellow: over grain it reads ochre, too close to the enemy tan)
//           (body: woodMaterial, instance colour / letters: cream painted wood)
//   book    hardcover with cloth-look boards and spine, cream page block and cover label
//           (cover: cloth-textured plastic, instance colour / pages: paperMaterial)
//   crayon  wax crayon lying flat, conical worn tip, paper wrapper with ink bands
//           (wax: waxMaterial / wrapper: paperMaterial, both instance colour)
//   marble  cat's-eye glass marble: tinted glass shell over four slim curved vanes
//           (core: plastic, instance colour / shell: glassMaterial, alpha blended, instance
//           tint, casts no shadow: only the core does)
//   car     die-cast toy car with rubber tyres, dark glass, chrome bumpers, door roundel
//           (body: paintedTinMaterial, instance colour / wheels + trim: rubber, vertex colours)
//   sock    soft striped sock: rolled cuff lip with dark opening, ribbed cuff, wrinkles,
//           heel patch, rounded closed toe
//           (body: fabricMaterial, instance colour / stripes: cream fabricMaterial)
//   brick   Duplo-like building bricks with studs: 2x4 and 2x2 (two meshes, one material)
//
// Colours are the toy primaries (TOY_COLORS: red, blue, yellow, purple, orange, teal),
// desaturated ~15% so the props recede behind the armies; never green or tan.
//
// GAME API
//   const kit = createPropKit(scene, look);   // once per scene (geometry + AO bake ~0.3 s)
//   kit.begin();                              // per level
//   kit.add('block', variant, x, z, yaw, scale, colorIndex);   // up to PROP_CAPACITY props
//   kit.commit();                             // uploads the instance buffers (one write)
//   kit.dispose();
// - Pivot at the ground centre of the whole prop (a stack, a cluster), front +Z; props
//   are 'neutral' (integration may add PI to yaw, it does not matter for scatter).
// - variant: any integer, wrapped by PROP_VARIANTS[kind]. For the old scenery kinds it
//   maps directly from SceneryProp.stack: block variant = stack - 1 (1..3 high; 3 = a
//   pyramid of three), book variant = stack - 1 (1..3 books), crayon variant 0.
//   crayon: 0 single, 1 crossed pair (the second leans on the first, tail on the floor),
//   2 fan of three (not touching).
//   addSceneryProp(kit, p) does that mapping for an fxLogic SceneryProp.
// - colorIndex: any integer, wrapped by PROP_COLOR_COUNT (stacks/clusters step it).
// - PROP_RADIUS[kind]: footprint radius at scale 1 for scatter spacing (keep props >= 1.2
//   off the rug: out = laneWidth/2 + 1.2 + radius*scale + ...). PROP_WEIGHTS: suggested
//   scatter mix. Buffers are preallocated; add() allocates nothing.
// - Shadows: every mesh is registered with look.addShadowCaster (static) and receives.
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { CreateBoxVertexData } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinderVertexData } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphereVertexData } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type { Look } from '../look/index.ts';
import {
  HEX,
  TOY_COLORS,
  buildMesh,
  fabricMaterial,
  fixWinding,
  glassMaterial,
  lathe,
  lin,
  mergeParts,
  paint,
  paintedTinMaterial,
  paperMaterial,
  place,
  plasticMaterial,
  roundedBox,
  rubberMaterial,
  waxMaterial,
  woodMaterial,
} from '../look/index.ts';
import type { ModelInfo, PreviewOptions, PreviewResult } from '../look/model.ts';

export const info: ModelInfo = {
  key: 'props',
  title: 'Bedroom props (blocks, books, crayons, marbles, car, sock, bricks)',
  instanced: true,
  teams: false,
  side: 'neutral',
  height: 1.6,
  triangleBudget: 1500, // per kind-mesh
  gameZ: 20,
  variants: ['all', 'scatter'],
};

export type PropKindName = 'block' | 'book' | 'crayon' | 'marble' | 'car' | 'sock' | 'brick';
export const PROP_KINDS: readonly PropKindName[] = ['block', 'book', 'crayon', 'marble', 'car', 'sock', 'brick'];
export const PROP_CAPACITY = 160;
export const PROP_COLOR_COUNT = TOY_COLORS.length;
export const PROP_DESATURATION = 0.15;

// Number of variants per kind (variant indices wrap).
//  block: 0 single, 1 two stacked, 2 three stacked, 3 pyramid of three
//  book: 0 single, 1 two stacked, 2 three stacked
//  crayon: 0 single, 1 crossed pair, 2 fan of three
//  marble: 0 three, 1 five, 2 seven with a big shooter
//  car: 0 upright, 1 tipped on its side
//  sock: 0 single, 1 a pair
//  brick: 0 2x4, 1 2x2, 2 two 2x4 crossed, 3 2x2 on a 2x4
export const PROP_VARIANTS: Record<PropKindName, number> = {
  block: 4,
  book: 3,
  crayon: 3,
  marble: 3,
  car: 2,
  sock: 2,
  brick: 4,
};

// Footprint radius at scale 1 (world units), the largest variant.
export const PROP_RADIUS: Record<PropKindName, number> = {
  block: 1.15,
  book: 1.55,
  crayon: 1.4,
  marble: 1.0,
  car: 1.3,
  sock: 1.75,
  brick: 0.95,
};

// Suggested scatter mix (sums to 1). Big hero toys (car, sock) are rare; the busy
// alphabet blocks are kept below the calmer crayons and bricks.
export const PROP_WEIGHTS: Record<PropKindName, number> = {
  block: 0.18,
  book: 0.17,
  crayon: 0.19,
  marble: 0.12,
  car: 0.06,
  sock: 0.07,
  brick: 0.21,
};

export interface PropKit {
  kinds: PropKindName[];
  radius: Record<PropKindName, number>;
  meshes: Mesh[]; // the 14 thin-instanced meshes (for culling flags, debugging)
  begin(): void;
  add(kind: PropKindName, variant: number, x: number, z: number, yaw: number, scale: number, colorIndex: number): void;
  commit(): void;
  dispose(): void;
}

// The old scenery record (src/render/fxLogic.ts SceneryProp), structurally.
export interface SceneryLike {
  kind: string;
  x: number;
  z: number;
  yaw: number;
  scale: number;
  shade: number; // 0..1
  stack: number;
  variant?: number;
}

// Adds an fxLogic SceneryProp: stack -> variant for block/book, shade -> colour.
export function addSceneryProp(kit: PropKit, p: SceneryLike): void {
  const kind = (PROP_KINDS as readonly string[]).includes(p.kind) ? (p.kind as PropKindName) : 'block';
  const variant =
    p.variant ?? (kind === 'block' || kind === 'book' ? Math.max(0, p.stack - 1) : Math.floor(p.shade * 977));
  kit.add(kind, variant, p.x, p.z, p.yaw, p.scale, Math.floor(p.shade * PROP_COLOR_COUNT * 7));
}

// Desaturated toy colour, linear (for the thin-instance colour buffer).
// The toy yellow is shifted to a cleaner lemon for props: the golden toy yellow, once
// desaturated and over wood grain, drifts toward the enemy tan.
const PROP_YELLOW = '#f2d43c';
export function propColor(i: number, out = new Color3()): Color3 {
  const key = TOY_COLORS[((i % PROP_COLOR_COUNT) + PROP_COLOR_COUNT) % PROP_COLOR_COUNT];
  const c = Color3.FromHexString(key === 'toyYellow' ? PROP_YELLOW : HEX[key]);
  const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const k = PROP_DESATURATION;
  out.set(c.r + (l - c.r) * k, c.g + (l - c.g) * k, c.b + (l - c.b) * k);
  return out.toLinearSpaceToRef(out);
}

// ---------------------------------------------------------------------------------
// geometry helpers

function box(w: number, h: number, d: number): VertexData {
  return CreateBoxVertexData({ width: w, height: h, depth: d });
}

// Local vertex AO (like bakeVertexAO in look/geometry.ts, but only rays against
// triangles near each vertex, so the whole kit bakes in tens of ms instead of seconds).
interface LocalAo {
  samples?: number;
  maxDist?: number;
  strength?: number;
  ground?: boolean;
}
function bakeLocalAO(vd: VertexData, o: LocalAo = {}): VertexData {
  const p = vd.positions!;
  const nrm = vd.normals!;
  const idx = vd.indices!;
  const nv = p.length / 3;
  const nt = idx.length / 3;
  const samples = o.samples ?? 12;
  const maxDist = o.maxDist ?? 0.3;
  const strength = o.strength ?? 0.6;
  const ground = o.ground ?? true;
  let minY = Infinity;
  for (let i = 1; i < p.length; i += 3) minY = Math.min(minY, p[i]);
  // Triangle bounding spheres.
  const sph = new Float32Array(nt * 4);
  for (let t = 0; t < nt; t++) {
    const a = idx[t * 3] * 3,
      b = idx[t * 3 + 1] * 3,
      c = idx[t * 3 + 2] * 3;
    const cx = (p[a] + p[b] + p[c]) / 3,
      cy = (p[a + 1] + p[b + 1] + p[c + 1]) / 3,
      cz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
    let r = 0;
    for (const v of [a, b, c]) r = Math.max(r, Math.hypot(p[v] - cx, p[v + 1] - cy, p[v + 2] - cz));
    sph.set([cx, cy, cz, r], t * 4);
  }
  const dirs: number[] = [];
  for (let k = 0; k < samples; k++) {
    const u = (k + 0.5) / samples;
    const r = Math.sqrt(u);
    const a = k * 2.399963;
    dirs.push(r * Math.cos(a), r * Math.sin(a), Math.sqrt(1 - u));
  }
  const colors = vd.colors ? Float32Array.from(vd.colors) : new Float32Array(nv * 4).fill(1);
  const near: number[] = [];
  for (let v = 0; v < nv; v++) {
    const ox = p[v * 3],
      oy = p[v * 3 + 1],
      oz = p[v * 3 + 2];
    const nx = nrm[v * 3],
      ny = nrm[v * 3 + 1],
      nz = nrm[v * 3 + 2];
    near.length = 0;
    for (let t = 0; t < nt; t++) {
      const ex = sph[t * 4] - ox,
        ey = sph[t * 4 + 1] - oy,
        ez = sph[t * 4 + 2] - oz;
      const lim = maxDist + sph[t * 4 + 3];
      if (ex * ex + ey * ey + ez * ez < lim * lim) near.push(t);
    }
    const tx0 = Math.abs(nx) < 0.9 ? 1 : 0;
    const ty0 = tx0 ? 0 : 1;
    let tx = ty0 * nz,
      ty = -tx0 * nz,
      tz = tx0 * ny - ty0 * nx;
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    const bx = ny * tz - nz * ty,
      by = nz * tx - nx * tz,
      bz = nx * ty - ny * tx;
    const sx = ox + nx * 1e-3,
      sy = oy + ny * 1e-3,
      sz = oz + nz * 1e-3;
    let hit = 0;
    for (let k = 0; k < samples; k++) {
      const a = dirs[k * 3],
        b = dirs[k * 3 + 1],
        c = dirs[k * 3 + 2];
      const dx = tx * a + bx * b + nx * c,
        dy = ty * a + by * b + ny * c,
        dz = tz * a + bz * b + nz * c;
      if (ground && dy < -1e-6 && (sy - minY) / -dy < maxDist) {
        hit++;
        continue;
      }
      for (const t of near) {
        if (rayTri(p, idx, t * 3, sx, sy, sz, dx, dy, dz, maxDist)) {
          hit++;
          break;
        }
      }
    }
    const ao = 1 - strength * (hit / samples);
    colors[v * 4] *= ao;
    colors[v * 4 + 1] *= ao;
    colors[v * 4 + 2] *= ao;
  }
  vd.colors = colors;
  return vd;
}

function rayTri(
  p: ArrayLike<number>,
  idx: ArrayLike<number>,
  t: number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxT: number,
): boolean {
  const a = idx[t] * 3,
    b = idx[t + 1] * 3,
    c = idx[t + 2] * 3;
  const e1x = p[b] - p[a],
    e1y = p[b + 1] - p[a + 1],
    e1z = p[b + 2] - p[a + 2];
  const e2x = p[c] - p[a],
    e2y = p[c + 1] - p[a + 1],
    e2z = p[c + 2] - p[a + 2];
  const px = dy * e2z - dz * e2y,
    py = dz * e2x - dx * e2z,
    pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (det > -1e-9 && det < 1e-9) return false;
  const inv = 1 / det;
  const sx = ox - p[a],
    sy = oy - p[a + 1],
    sz = oz - p[a + 2];
  const u = (sx * px + sy * py + sz * pz) * inv;
  if (u < 0 || u > 1) return false;
  const qx = sy * e1z - sz * e1y,
    qy = sz * e1x - sx * e1z,
    qz = sx * e1y - sy * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < 0 || u + v > 1) return false;
  const d = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return d > 1e-4 && d < maxT;
}

// Bakes AO over two parts together (so each darkens the other), then splits them again.
function bakePair(
  a: VertexData,
  b: VertexData,
  samples: number,
  strength: number,
  ground = true,
  maxDist = 0.3,
): [VertexData, VertexData] {
  const na = a.positions!.length / 3;
  const ia = a.indices!.length;
  const all = mergeParts([a, b]);
  bakeLocalAO(all, { samples, strength, ground, maxDist });
  return [slice(all, 0, na, 0, ia), slice(all, na, all.positions!.length / 3, ia, all.indices!.length)];
}

function slice(vd: VertexData, v0: number, v1: number, i0: number, i1: number): VertexData {
  const out = new VertexData();
  out.positions = Array.from(vd.positions!).slice(v0 * 3, v1 * 3);
  out.normals = Array.from(vd.normals!).slice(v0 * 3, v1 * 3);
  if (vd.uvs) out.uvs = Array.from(vd.uvs).slice(v0 * 2, v1 * 2);
  if (vd.colors) out.colors = Array.from(vd.colors).slice(v0 * 4, v1 * 4);
  out.indices = Array.from(vd.indices!)
    .slice(i0, i1)
    .map((i) => i - v0);
  return out;
}

// Scales x/z of vertices by a factor that runs from 1 at y0 to k at y1 (a tapered cabin).
function taper(vd: VertexData, y0: number, y1: number, kx: number, kz: number): VertexData {
  const p = vd.positions!;
  for (let i = 0; i < p.length; i += 3) {
    const t = Math.max(0, Math.min(1, (p[i + 1] - y0) / (y1 - y0)));
    p[i] *= 1 + (kx - 1) * t;
    p[i + 2] *= 1 + (kz - 1) * t;
  }
  return vd;
}

// Colours lathe vertices by their height: bands [y0, y1, rgb] (others white).
function bandColors(vd: VertexData, bands: readonly [number, number, number][]): VertexData {
  const p = vd.positions!;
  const n = p.length / 3;
  const c = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const y = p[i * 3 + 1];
    let v = 1;
    for (const [a, b, k] of bands) if (y >= a && y <= b) v = k;
    c.set([v, v, v, 1], i * 4);
  }
  vd.colors = c;
  return vd;
}

// Builds a VertexData from raw arrays with rough outward normals, then fixes the winding
// and recomputes smooth normals from it.
function rawMesh(
  positions: number[],
  indices: number[],
  roughNormals: number[],
  uvs: number[],
  colors?: number[],
): VertexData {
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = roughNormals;
  vd.uvs = uvs;
  fixWinding(vd);
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, vd.indices, normals);
  vd.normals = normals;
  if (colors) vd.colors = colors;
  return vd;
}

// ---------------------------------------------------------------------------------
// alphabet block: unit cube centred on the origin (instances place it), cream letters

const BLOCK = 1.0;
type Seg = [number, number, number, number];
const LETTERS: Record<string, Seg[]> = {
  A: [
    [-0.22, -0.27, 0, 0.27],
    [0, 0.27, 0.22, -0.27],
    [-0.12, -0.05, 0.12, -0.05],
  ],
  B: [
    [-0.18, -0.27, -0.18, 0.27],
    [-0.18, 0.27, 0.1, 0.27],
    [0.1, 0.27, 0.17, 0.14],
    [0.17, 0.14, 0.1, 0.01],
    [-0.18, 0.01, 0.12, 0.01],
    [0.12, 0.01, 0.2, -0.13],
    [0.2, -0.13, 0.12, -0.27],
    [0.12, -0.27, -0.18, -0.27],
  ],
  E: [
    [-0.17, -0.27, -0.17, 0.27],
    [-0.17, 0.27, 0.19, 0.27],
    [-0.17, 0.0, 0.12, 0.0],
    [-0.17, -0.27, 0.19, -0.27],
  ],
  H: [
    [-0.18, -0.27, -0.18, 0.27],
    [0.18, -0.27, 0.18, 0.27],
    [-0.18, 0, 0.18, 0],
  ],
  // Numbers mixed in, so a scatter of blocks reads less templated.
  '4': [
    [0.1, -0.27, 0.1, 0.27],
    [0.1, 0.27, -0.2, -0.07],
    [-0.2, -0.07, 0.2, -0.07],
  ],
  '7': [
    [-0.18, 0.27, 0.19, 0.27],
    [0.19, 0.27, -0.04, -0.27],
  ],
};
const LETTER_T = 0.095; // stroke width
const EMBOSS = 0.045; // how far letters stand proud

function letterOnFrontFace(segs: Seg[], half: number): VertexData[] {
  const parts: VertexData[] = [];
  for (const [mx1, y1, mx2, y2] of segs) {
    // Mirror x: the +Z face is seen from +Z, where +X is on the viewer's left.
    const x1 = -mx1;
    const x2 = -mx2;
    const len = Math.hypot(x2 - x1, y2 - y1) + LETTER_T * 0.9;
    const ang = Math.atan2(y2 - y1, x2 - x1);
    parts.push(
      place(box(len, LETTER_T, EMBOSS), { x: (x1 + x2) / 2, y: (y1 + y2) / 2, z: half + EMBOSS / 2 - 0.004, rz: ang }),
    );
  }
  // Raised frame around the face (the classic alphabet-block border).
  // Thin and low, so the frame stays quieter than the glyph.
  const f = 0.046;
  const e = half - 0.085;
  const fe = EMBOSS * 0.55;
  parts.push(place(box(2 * e + f, f, fe), { y: e, z: half + fe / 2 - 0.004 }));
  parts.push(place(box(2 * e + f, f, fe), { y: -e, z: half + fe / 2 - 0.004 }));
  parts.push(place(box(f, 2 * e - f, fe), { x: e, z: half + fe / 2 - 0.004 }));
  parts.push(place(box(f, 2 * e - f, fe), { x: -e, z: half + fe / 2 - 0.004 }));
  return parts;
}

function blockGeometry(): [VertexData, VertexData] {
  const half = BLOCK / 2;
  const body = roundedBox(BLOCK, BLOCK, BLOCK, 0.085, 3);
  const faces: [string, number, number][] = [
    ['A', 0, 0],
    ['B', Math.PI, 0],
    ['E', Math.PI / 2, 0],
    ['4', -Math.PI / 2, 0],
    ['H', 0, -Math.PI / 2],
    ['7', 0, Math.PI / 2],
  ];
  const letterParts: VertexData[] = [];
  for (const [ch, ry, rx] of faces) {
    const m = mergeParts(letterOnFrontFace(LETTERS[ch], half));
    letterParts.push(place(m, { ry, rx }));
  }
  const letters = mergeParts(letterParts);
  return bakePair(body, letters, 8, 0.55, false, 0.12);
}

// ---------------------------------------------------------------------------------
// book: W (x) x D (z) x H, spine on -X, lying flat on y = 0

const BOOK_W = 1.75;
const BOOK_D = 2.35;
const BOOK_H = 0.36;

function bookGeometry(): [VertexData, VertexData] {
  const tb = 0.05; // board thickness
  const cover: VertexData[] = [];
  cover.push(place(roundedBox(BOOK_W, tb, BOOK_D, 0.022, 2), { y: tb / 2 }));
  cover.push(place(roundedBox(BOOK_W, tb, BOOK_D, 0.022, 2), { y: BOOK_H - tb / 2 }));
  // Rounded spine: a flattened cylinder along Z joining the boards.
  const sx = -BOOK_W / 2 + 0.07;
  cover.push(
    place(CreateCylinderVertexData({ height: BOOK_D, diameter: BOOK_H, tessellation: 16 }), {
      rx: Math.PI / 2,
      sx: 0.55,
      x: sx,
      y: BOOK_H / 2,
    }),
  );
  // Raised bands across the spine.
  for (const z of [-0.78, -0.62, 0.62, 0.78]) {
    cover.push(
      place(CreateCylinderVertexData({ height: 0.045, diameter: BOOK_H + 0.035, tessellation: 16 }), {
        rx: Math.PI / 2,
        sx: 0.6,
        x: sx - 0.006,
        y: BOOK_H / 2,
        z,
      }),
    );
  }
  const pages: VertexData[] = [];
  const inner = BOOK_H - 2 * tb;
  const n = 5;
  for (let i = 0; i < n; i++) {
    const h = inner / n;
    const jw = [0.0, 0.025, 0.012, 0.03, 0.006][i];
    const jd = [0.02, 0.0, 0.028, 0.01, 0.022][i];
    const w = BOOK_W - 0.1 - jw;
    const slab = place(roundedBox(w, h - 0.003, BOOK_D - 0.1 - jd, 0.008, 1), {
      x: -BOOK_W / 2 + 0.03 + w / 2,
      y: tb + h * (i + 0.5),
    });
    const shade = [1, 0.93, 0.98, 0.9, 0.96][i];
    pages.push(paint(slab, [shade, shade * 0.985, shade * 0.95]));
  }
  // Cover label with two printed title lines.
  const labelY = BOOK_H + 0.006;
  pages.push(
    paint(place(roundedBox(0.92, 0.012, 0.62, 0.005, 1), { x: 0.12, y: labelY, z: 0.42 }), [0.98, 0.95, 0.86]),
  );
  const ink = lin('ink');
  pages.push(
    paint(place(box(0.62, 0.014, 0.08), { x: 0.12, y: labelY + 0.002, z: 0.53 }), [
      ink.r * 2.2,
      ink.g * 2.2,
      ink.b * 2.2,
    ]),
  );
  pages.push(
    paint(place(box(0.42, 0.014, 0.05), { x: 0.12, y: labelY + 0.002, z: 0.34 }), [ink.r * 3, ink.g * 3, ink.b * 3]),
  );
  // Spine label (a small paper label across the spine's outer face).
  pages.push(
    paint(place(box(0.014, BOOK_H * 0.5, 0.46), { x: sx - BOOK_H * 0.275 - 0.004, y: BOOK_H / 2 }), [0.97, 0.93, 0.82]),
  );
  return bakePair(mergeParts(cover), mergeParts(pages), 8, 0.6, true, 0.12);
}

// ---------------------------------------------------------------------------------
// crayon: lying along Z, tip at +Z, resting on the floor

const CRAYON_R = 0.165;
const CRAYON_L = 2.2;

function crayonGeometry(): [VertexData, VertexData] {
  const r = CRAYON_R;
  const h = CRAYON_L / 2;
  const wax = lathe(
    [
      [0, -h],
      [r - 0.02, -h],
      [r - 0.004, -h + 0.012],
      [r, -h + 0.04],
      [r, 0.66],
      [r - 0.012, 0.7],
      [0.07, 1.0],
      [0.05, h - 0.015],
      [0.03, h],
      [0, h],
    ],
    18,
  );
  const rw = r + 0.012;
  const wrapper = lathe(
    [
      [r - 0.002, -0.96],
      [rw, -0.955],
      [rw, -0.86],
      [rw, -0.858],
      [rw, -0.79],
      [rw, -0.788],
      [rw, -0.73],
      [rw, -0.728],
      [rw, -0.68],
      [rw, -0.678],
      [rw, 0.36],
      [rw, 0.362],
      [rw, 0.43],
      [rw, 0.432],
      [rw, 0.5],
      [rw, 0.502],
      [rw, 0.6],
      [r - 0.002, 0.606],
    ],
    18,
  );
  // Ink bands near both ends of the wrapper (darker versions of the crayon colour).
  bandColors(wrapper, [
    [-0.859, -0.789, 0.28],
    [-0.729, -0.679, 0.28],
    [0.361, 0.431, 0.3],
    [0.501, 0.62, 0.62],
  ]);
  paint(wax, [1, 1, 1]);
  const lay = { rx: Math.PI / 2 }; // axis through the origin; instances lift it by r
  place(wax, lay);
  place(wrapper, lay);
  return bakePair(wax, wrapper, 8, 0.5, true, 0.1);
}

// ---------------------------------------------------------------------------------
// marble: twisted vane core (instance colour) inside a clear glass shell

const MARBLE_R = 0.24;

function marbleGeometry(): [VertexData, VertexData] {
  const R = MARBLE_R;
  const shell = CreateSphereVertexData({ diameter: 2 * R, segments: 16 }); // centred; instances lift it
  // Cat's-eye insert: four slim leaf-shaped blades radiating from the axis, confined to the
  // inner ~70% of the radius, with a gentle twist (not a propeller).
  const parts: VertexData[] = [];
  const nu = 3;
  const nv = 9;
  const blades = 4;
  for (let vane = 0; vane < blades; vane++) {
    for (const side of [1, -1]) {
      const pos: number[] = [];
      const nrm: number[] = [];
      const uv: number[] = [];
      const idx: number[] = [];
      for (let j = 0; j <= nv; j++) {
        const v = -1 + (2 * j) / nv;
        const yy = v * R * 0.68;
        // Leaf profile: widest in the middle, pointed at both ends.
        const reach = Math.pow(Math.max(0, 1 - v * v), 0.7) * R * 0.66;
        const ang = (vane * Math.PI * 2) / blades + v * 0.45 + (vane % 2) * 0.12;
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        for (let i = 0; i <= nu; i++) {
          const u = 0.04 * R + (i / nu) * reach;
          // Curved blade: it bows a little sideways toward its edge.
          const bow = (i / nu) * (i / nu) * 0.12 * reach;
          pos.push(c * u - s * bow, yy, s * u + c * bow);
          nrm.push(-s * side, 0, c * side);
          uv.push(i / nu, j / nv);
        }
      }
      for (let j = 0; j < nv; j++) {
        for (let i = 0; i < nu; i++) {
          const a = j * (nu + 1) + i;
          idx.push(a, a + 1, a + nu + 2, a, a + nu + 2, a + nu + 1);
        }
      }
      const vd = new VertexData();
      vd.positions = pos;
      vd.normals = nrm;
      vd.uvs = uv;
      vd.indices = idx;
      parts.push(fixWinding(vd));
    }
  }
  return [mergeParts(parts), shell];
}

// ---------------------------------------------------------------------------------
// toy car: 2.4 long, front +Z

const CAR_L = 2.4;
const CAR_W = 1.08;

function carGeometry(): [VertexData, VertexData] {
  const body: VertexData[] = [];
  const glassC: [number, number, number] = [0.05, 0.055, 0.07];
  // Lower body.
  body.push(place(roundedBox(CAR_W, 0.36, CAR_L - 0.06, 0.15, 2), { y: 0.36 }));
  // Bonnet bulge and boot.
  body.push(place(taper(roundedBox(0.84, 0.1, 0.62, 0.05, 1), 0, 0.05, 0.9, 0.9), { y: 0.55, z: 0.72 }));
  // Wheel-arch flares wider than the body, over the tyres.
  for (const z of [-0.76, 0.76]) body.push(place(roundedBox(CAR_W + 0.12, 0.13, 0.64, 0.06, 1), { y: 0.47, z }));
  // Glasshouse (dark vertex colour = glossy dark glass under the paint's clearcoat).
  const glass = paint(taper(roundedBox(0.86, 0.28, 1.12, 0.08, 2), -0.14, 0.14, 0.86, 0.78), glassC);
  body.push(place(glass, { y: 0.54 + 0.13, z: -0.2 }));
  // Roof, B and C pillars.
  body.push(place(taper(roundedBox(0.8, 0.08, 0.9, 0.04, 1), -0.04, 0.04, 0.95, 0.94), { y: 0.83, z: -0.22 }));
  body.push(place(taper(box(0.82, 0.26, 0.09), -0.13, 0.13, 0.87, 1), { y: 0.67, z: -0.16 }));
  body.push(place(taper(box(0.84, 0.26, 0.14), -0.13, 0.13, 0.86, 1), { y: 0.67, z: -0.66 }));
  // Spoiler at the back.
  body.push(place(box(0.9, 0.05, 0.16), { y: 0.64, z: -1.12 }));
  const bodyVd = mergeParts(body);

  const trim: VertexData[] = [];
  const dark = lin('tread');
  const tyre: [number, number, number] = [dark.r, dark.g, dark.b];
  const hub: [number, number, number] = [0.62, 0.63, 0.66];
  const wheel = lathe(
    [
      [0, 0.115],
      [0.11, 0.115],
      [0.135, 0.12],
      [0.135, 0.121],
      [0.22, 0.12],
      [0.265, 0.085],
      [0.27, -0.06],
      [0.24, -0.11],
      [0, -0.12],
    ],
    14,
  );
  // Hub face lighter (radius < 0.134), tyre dark.
  {
    const p = wheel.positions!;
    const c = new Float32Array((p.length / 3) * 4);
    for (let i = 0; i < p.length / 3; i++) {
      const rr = Math.hypot(p[i * 3], p[i * 3 + 2]);
      const isHub = rr < 0.1355 && p[i * 3 + 1] > 0.1;
      c.set(isHub ? [...hub, 1] : [...tyre, 1], i * 4);
    }
    wheel.colors = c;
  }
  for (const z of [-0.76, 0.76]) {
    for (const sgn of [-1, 1]) {
      const w = new VertexData();
      w.positions = Array.from(wheel.positions!);
      w.normals = Array.from(wheel.normals!);
      w.uvs = Array.from(wheel.uvs!);
      w.colors = Array.from(wheel.colors!);
      w.indices = Array.from(wheel.indices!);
      trim.push(place(w, { rz: sgn < 0 ? Math.PI / 2 : -Math.PI / 2, x: sgn * (CAR_W / 2 - 0.02), y: 0.27, z }));
    }
  }
  const chrome: [number, number, number] = [0.7, 0.71, 0.74];
  trim.push(paint(place(roundedBox(CAR_W - 0.04, 0.13, 0.12, 0.05, 1), { y: 0.25, z: CAR_L / 2 - 0.05 }), chrome));
  trim.push(paint(place(roundedBox(CAR_W - 0.04, 0.13, 0.12, 0.05, 1), { y: 0.25, z: -CAR_L / 2 + 0.05 }), chrome));
  trim.push(paint(place(box(0.46, 0.1, 0.04), { y: 0.4, z: CAR_L / 2 - 0.02 }), [0.08, 0.08, 0.09]));
  const headC = lin('#fff1c4');
  for (const x of [-0.33, 0.33]) {
    trim.push(
      paint(
        place(CreateCylinderVertexData({ height: 0.04, diameter: 0.15, tessellation: 10 }), {
          rx: Math.PI / 2,
          x,
          y: 0.42,
          z: CAR_L / 2 - 0.02,
        }),
        [headC.r, headC.g, headC.b],
      ),
    );
    const tail = lin('#c0392b');
    trim.push(paint(place(box(0.2, 0.08, 0.04), { x, y: 0.43, z: -CAR_L / 2 + 0.02 }), [tail.r, tail.g, tail.b]));
  }
  // Door roundels with a racing number "1".
  const cream = lin('#f6edd6');
  const ink = lin('ink');
  for (const sgn of [-1, 1]) {
    trim.push(
      paint(
        place(CreateCylinderVertexData({ height: 0.02, diameter: 0.34, tessellation: 14 }), {
          rz: Math.PI / 2,
          x: sgn * (CAR_W / 2 + 0.002),
          y: 0.37,
          z: 0.02,
        }),
        [cream.r, cream.g, cream.b],
      ),
    );
    trim.push(
      paint(place(box(0.02, 0.2, 0.045), { x: sgn * (CAR_W / 2 + 0.012), y: 0.37, z: 0.02 }), [ink.r, ink.g, ink.b]),
    );
    trim.push(
      paint(place(box(0.02, 0.05, 0.06), { x: sgn * (CAR_W / 2 + 0.012), y: 0.44, z: 0.02 + 0.035 * sgn * -1 }), [
        ink.r,
        ink.g,
        ink.b,
      ]),
    );
  }
  return bakePair(bodyVd, mergeParts(trim), 8, 0.6, true, 0.2);
}

// ---------------------------------------------------------------------------------
// sock: a soft, flattened knitted tube swept along an L-shaped path lying on the floor:
// rolled cuff lip with a dark opening, ribbed cuff band, three stripes, compression
// wrinkles along the leg, a heel patch, and a rounded closed toe.
// Returns [coloured body, cream parts] sharing one vertex buffer layout.

const SOCK_RING = 16;

function sockGeometry(): [VertexData, VertexData] {
  const ctrl: [number, number][] = [
    [-0.36, 1.42],
    [-0.31, 0.88],
    [-0.29, 0.32],
    [-0.22, -0.1],
    [0.14, -0.29],
    [0.6, -0.31],
    [1.02, -0.24],
  ];
  const cr = (t: number): [number, number, number, number] => {
    const segs = ctrl.length - 1;
    const f = Math.min(segs - 1e-6, Math.max(0, t) * segs);
    const i = Math.floor(f);
    const u = f - i;
    const p0 = ctrl[Math.max(0, i - 1)],
      p1 = ctrl[i],
      p2 = ctrl[i + 1],
      p3 = ctrl[Math.min(segs, i + 2)];
    const cat = (a: number, b: number, c: number, d: number): number =>
      0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
    const dcat = (a: number, b: number, c: number, d: number): number =>
      0.5 * (-a + c + 2 * (2 * a - 5 * b + 4 * c - d) * u + 3 * (-a + 3 * b - 3 * c + d) * u * u);
    return [
      cat(p0[0], p1[0], p2[0], p3[0]),
      cat(p0[1], p1[1], p2[1], p3[1]),
      dcat(p0[0], p1[0], p2[0], p3[0]),
      dcat(p0[1], p1[1], p2[1], p3[1]),
    ];
  };
  const CUFF = 0.1;
  const STRIPES: [number, number][] = [
    [0.15, 0.175],
    [0.235, 0.26],
    [0.32, 0.345],
  ];
  const HEEL: [number, number] = [0.45, 0.62];
  const TOE = 0.87;
  const WRINKLES = [0.205, 0.29, 0.385];
  // Stations along the tube: t (0 cuff .. 1 toe), axial offset along the tangent, scale of
  // the cross-section, vertex shade, and whether the surface faces inward (sock interior).
  interface Station {
    t: number;
    ax: number;
    sc: number;
    shade: number;
    inner: boolean;
  }
  const st: Station[] = [];
  // Inside the opening (dark), then the rolled lip curling out to the cuff.
  st.push({ t: 0, ax: 0.14, sc: 0.78, shade: 0.16, inner: true });
  st.push({ t: 0, ax: 0.04, sc: 0.8, shade: 0.28, inner: true });
  st.push({ t: 0, ax: -0.02, sc: 0.86, shade: 0.7, inner: false });
  st.push({ t: 0, ax: -0.045, sc: 0.96, shade: 0.95, inner: false });
  st.push({ t: 0, ax: -0.035, sc: 1.04, shade: 1, inner: false });
  st.push({ t: 0, ax: -0.008, sc: 1.05, shade: 1, inner: false });
  const ts: number[] = [];
  const N = 40;
  for (let i = 0; i <= N; i++) ts.push(i / N);
  ts.push(CUFF, HEEL[0], HEEL[1], TOE);
  for (const [a, c] of STRIPES) ts.push(a, c);
  ts.sort((a, c) => a - c);
  for (let i = 0; i < ts.length; i++)
    if (i === 0 || ts[i] - ts[i - 1] > 4e-3) st.push({ t: ts[i], ax: 0, sc: 1, shade: 1, inner: false });
  // Rounded toe: the cross-section shrinks on a quarter circle past the end.
  const toeN = 5;
  for (let k = 1; k <= toeN; k++) {
    const ph = (k / toeN) * (Math.PI / 2);
    st.push({ t: 1, ax: Math.sin(ph) * 0.2, sc: Math.max(0.03, Math.cos(ph)), shade: 1, inner: false });
  }

  const gauss = (t: number, c: number, w: number): number => Math.exp(-(((t - c) / w) ** 2));
  const ring = SOCK_RING;
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const heelDir: number[] = []; // per station: how far each ring vertex faces the heel side
  for (const s of st) {
    const t = s.t;
    const [cx0, cz0, dx, dz] = cr(t);
    const dl = Math.hypot(dx, dz) || 1;
    const tx = dx / dl,
      tz = dz / dl;
    const nx = -tz,
      nz = tx;
    // Cross-section half width (a) and top height (b): the foot a touch wider and flatter.
    let a = 0.29 + 0.03 * Math.min(1, Math.max(0, (t - 0.45) / 0.2));
    let b = 0.145 - 0.02 * Math.min(1, Math.max(0, (t - 0.45) / 0.2));
    // Compression wrinkles: soft rings of bunched cloth along the leg.
    let w = 0;
    for (const c of WRINKLES) w += gauss(t, c, 0.022);
    a *= 1 + 0.05 * w;
    b *= 1 + 0.34 * w - 0.1 * gauss(t, 0.245, 0.02);
    // Heel pocket: bulges out behind the bend.
    const heel =
      t > HEEL[0] - 0.03 && t < HEEL[1] + 0.03
        ? Math.sin(Math.min(1, Math.max(0, (t - HEEL[0] + 0.03) / (HEEL[1] - HEEL[0] + 0.06))) * Math.PI)
        : 0;
    b *= 1 + 0.18 * heel;
    // Ribbed cuff a little wider.
    if (t <= CUFF && s.ax === 0) a *= 1.06;
    if (s.ax !== 0 && !s.inner) a *= 1.06;
    const wig = 0.025 * Math.sin(t * 13 + 0.8);
    const cx = cx0 - 0.11 * heel + nx * wig + tx * s.ax;
    const cz = cz0 - 0.1 * heel + nz * wig + tz * s.ax;
    const yc = 0.36 * b * s.sc + 0.006;
    for (let j = 0; j <= ring; j++) {
      const th = -Math.PI / 2 + (j / ring) * Math.PI * 2;
      const sn = Math.sin(th),
        cs = Math.cos(th);
      // Knit ribs on the cuff run along the sock.
      const rib = t <= CUFF && s.ax === 0 ? 1 + 0.035 * Math.cos(j * Math.PI) : 1;
      // Flat underside (the cloth lies on the floor), rounded top.
      const yy = sn > 0 ? b * sn : 0.36 * b * sn;
      const off = a * s.sc * rib * Math.sign(cs) * Math.pow(Math.abs(cs), 0.85);
      pos.push(cx + nx * off, Math.max(0.003, yc + yy * s.sc * rib), cz + nz * off);
      const k = s.inner ? -1 : 1;
      const lipBlend = s.ax < 0 ? 0.6 : 0; // the lip faces out of the opening
      nrm.push(
        k * nx * cs * (1 - lipBlend) - tx * lipBlend,
        k * sn * (1 - lipBlend),
        k * nz * cs * (1 - lipBlend) - tz * lipBlend,
      );
      uv.push((j / ring) * 2, t * 7 + s.ax);
      col.push(s.shade, s.shade, s.shade, 1);
      // Heel side: the outer corner of the bend (towards -x, -z).
      heelDir.push(-(nx * cs) * 0.7 - nz * cs * 0.7 + sn * 0.2);
    }
  }
  const idxA: number[] = [];
  const idxB: number[] = [];
  const row = ring + 1;
  for (let k = 0; k < st.length - 1; k++) {
    const s0 = st[k],
      s1 = st[k + 1];
    const mid = (s0.t + s1.t) / 2;
    const lipOrToe = s0.ax !== 0 || s1.ax !== 0 || s0.sc !== 1 || s1.sc !== 1;
    const banded = mid <= CUFF || mid >= TOE || STRIPES.some(([a, c]) => mid >= a && mid <= c);
    for (let j = 0; j < ring; j++) {
      const a = k * row + j;
      const c = a + row;
      const heelPatch = mid > HEEL[0] && mid < HEEL[1] && heelDir[a] + heelDir[a + 1] > 0.6;
      const target = lipOrToe || banded || heelPatch ? idxB : idxA;
      target.push(a, c, c + 1, a, c + 1, a + 1);
    }
  }
  // Close the deep end of the opening with a dark disc.
  {
    const s0 = st[0];
    const [cx0, cz0, dx, dz] = cr(0);
    const dl = Math.hypot(dx, dz) || 1;
    const centre = pos.length / 3;
    pos.push(cx0 + (dx / dl) * s0.ax, 0.06, cz0 + (dz / dl) * s0.ax);
    nrm.push(-dx / dl, 0, -dz / dl);
    uv.push(0.5, 0);
    col.push(0.12, 0.12, 0.12, 1);
    for (let j = 0; j < ring; j++) {
      idxB.push(centre, j, j + 1);
      // Orient by the disc normal (towards the opening).
      nrm[j * 3] = (nrm[j * 3] - dx / dl) * 0.5;
      nrm[j * 3 + 2] = (nrm[j * 3 + 2] - dz / dl) * 0.5;
    }
  }
  // Fix winding for both lists together, smooth normals, recentre on the footprint, AO.
  const all = rawMesh(pos, [...idxA, ...idxB], nrm, uv, col);
  const p = all.positions!;
  let x0 = Infinity,
    x1 = -Infinity,
    z0 = Infinity,
    z1 = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    x0 = Math.min(x0, p[i]);
    x1 = Math.max(x1, p[i]);
    z0 = Math.min(z0, p[i + 2]);
    z1 = Math.max(z1, p[i + 2]);
  }
  const ox = (x0 + x1) / 2,
    oz = (z0 + z1) / 2;
  for (let i = 0; i < p.length; i += 3) {
    p[i] -= ox;
    p[i + 2] -= oz;
  }
  bakeLocalAO(all, { samples: 10, strength: 0.55, maxDist: 0.14 });
  const ii = all.indices!;
  const mk = (from: number, to: number): VertexData => {
    const vd = new VertexData();
    vd.positions = all.positions;
    vd.normals = all.normals;
    vd.uvs = all.uvs;
    vd.colors = all.colors;
    vd.indices = Array.from(ii).slice(from, to);
    return vd;
  };
  return [mk(0, idxA.length), mk(idxA.length, ii.length)];
}

// ---------------------------------------------------------------------------------
// building bricks: stud pitch 0.4, body 0.48 high, studs 0.16

const PITCH = 0.4;
const BRICK_H = 0.48;

function brickGeometry(nx: number, nz: number): VertexData {
  const w = nx * PITCH - 0.012;
  const d = nz * PITCH - 0.012;
  const parts: VertexData[] = [place(roundedBox(w, BRICK_H, d, 0.035, 2), { y: BRICK_H / 2 })];
  const stud = lathe(
    [
      [0.122, 0],
      [0.122, 0.13],
      [0.116, 0.155],
      [0.1, 0.165],
      [0, 0.165],
    ],
    16,
  );
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const s = new VertexData();
      s.positions = Array.from(stud.positions!);
      s.normals = Array.from(stud.normals!);
      s.uvs = Array.from(stud.uvs!);
      s.indices = Array.from(stud.indices!);
      parts.push(place(s, { x: (i - (nx - 1) / 2) * PITCH, y: BRICK_H - 0.004, z: (j - (nz - 1) / 2) * PITCH }));
    }
  }
  return bakeLocalAO(mergeParts(parts), { samples: 8, strength: 0.55, maxDist: 0.12 });
}

// ---------------------------------------------------------------------------------
// instance batches

class Batch {
  readonly mesh: Mesh;
  private readonly matrices: Float32Array;
  private readonly colors: Float32Array | null;
  private count = 0;
  private readonly cap: number;

  constructor(mesh: Mesh, cap: number, colored: boolean) {
    this.mesh = mesh;
    this.cap = cap;
    this.matrices = new Float32Array(cap * 16);
    // Identity matrices, so bounds stay finite while a mesh has no instances.
    for (let i = 0; i < cap; i++)
      this.matrices[i * 16] = this.matrices[i * 16 + 5] = this.matrices[i * 16 + 10] = this.matrices[i * 16 + 15] = 1;
    this.colors = colored ? new Float32Array(cap * 4).fill(1) : null;
    mesh.thinInstanceSetBuffer('matrix', this.matrices, 16, false);
    if (this.colors) mesh.thinInstanceSetBuffer('color', this.colors, 4, false);
    mesh.thinInstanceCount = 0;
    mesh.isVisible = false;
    mesh.doNotSyncBoundingInfo = true;
  }

  reset(): void {
    this.count = 0;
  }

  push(m: Matrix, c: Color3 | null): void {
    if (this.count >= this.cap) return;
    m.copyToArray(this.matrices, this.count * 16);
    if (this.colors && c) {
      const o = this.count * 4;
      this.colors[o] = c.r;
      this.colors[o + 1] = c.g;
      this.colors[o + 2] = c.b;
      this.colors[o + 3] = 1;
    }
    this.count++;
  }

  commit(): void {
    const m = this.mesh;
    m.thinInstanceCount = this.count;
    m.thinInstanceBufferUpdated('matrix');
    if (this.colors) m.thinInstanceBufferUpdated('color');
    m.isVisible = this.count > 0;
    if (this.count > 0) m.thinInstanceRefreshBoundingInfo(false);
  }
}

// Most instances one add() writes into each mesh of a kind.
const PER_PROP = { block: 3, book: 3, crayon: 3, marble: 7, car: 1, sock: 2, brick4: 2, brick2: 1 };

// Cheap deterministic hash of a prop's position (no allocation).
function hash(x: number, z: number, k: number): number {
  const s = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

// Geometry (with baked AO) is built on the first createPropKit and reused afterwards:
// buildMesh copies it into GPU buffers, so it can be shared between scenes.
interface PropGeometry {
  block: [VertexData, VertexData];
  book: [VertexData, VertexData];
  crayon: [VertexData, VertexData];
  marble: [VertexData, VertexData];
  car: [VertexData, VertexData];
  sock: [VertexData, VertexData];
  brick4: VertexData;
  brick2: VertexData;
}
let geometryCache: PropGeometry | null = null;
function propGeometry(): PropGeometry {
  geometryCache ??= {
    block: blockGeometry(),
    book: bookGeometry(),
    crayon: crayonGeometry(),
    marble: marbleGeometry(),
    car: carGeometry(),
    sock: sockGeometry(),
    brick4: brickGeometry(2, 4),
    brick2: brickGeometry(2, 2),
  };
  return geometryCache;
}

export function createPropKit(scene: Scene, look: Look): PropKit {
  const root = new TransformNode('propKit', scene);
  const mat = <T extends PBRMaterial>(key: string, make: () => T): T => look.material(`props-${key}`, make);

  const blockMat = mat('block', () => woodMaterial(scene, null, { instanceColor: true, normalStrength: 0.25 }));
  const letterMat = mat('letters', () => woodMaterial(scene, '#e0d2b2', { roughness: 0.64, normalStrength: 0.1 }));
  const coverMat = mat('cover', () =>
    plasticMaterial(scene, null, {
      instanceColor: true,
      texture: 'fabric',
      roughness: 0.78,
      normalStrength: 0.35,
      textureScale: 3,
    }),
  );
  const pageMat = mat('pages', () => paperMaterial(scene, 'paper', { normalStrength: 0.25 }));
  const waxMat = mat('wax', () => waxMaterial(scene, null, { instanceColor: true }));
  const wrapMat = mat('wrapper', () => paperMaterial(scene, null, { instanceColor: true, roughness: 0.8 }));
  const coreMat = mat('marbleCore', () =>
    plasticMaterial(scene, null, { instanceColor: true, roughness: 0.25, clearcoat: 0.5 }),
  );
  const glassMat = mat('marbleGlass', () => {
    const g = glassMaterial(scene, null, {
      instanceColor: true,
      alpha: 0.42,
      envIntensity: 2.2,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      roughness: 0.03,
    });
    g.backFaceCulling = true;
    // Stronger rim: reflections ride on top of the transparency (Fresnel at the edge).
    g.useRadianceOverAlpha = true;
    g.useSpecularOverAlpha = true;
    return g;
  });
  const carMat = mat('car', () => paintedTinMaterial(scene, null, { instanceColor: true }));
  const trimMat = mat('carTrim', () => rubberMaterial(scene, null, { roughness: 0.62 }));
  const sockMat = mat('sock', () => {
    const m = fabricMaterial(scene, null, { instanceColor: true, textureScale: 2, normalStrength: 0.7 });
    m.sheen.intensity = 0.18;
    return m;
  });
  const sockCreamMat = mat('sockCream', () =>
    fabricMaterial(scene, '#efe6d2', { textureScale: 2, normalStrength: 0.7 }),
  );
  const brickMat = mat('brick', () =>
    plasticMaterial(scene, null, { instanceColor: true, clearcoat: 0.3, roughness: 0.36 }),
  );

  const g = propGeometry();
  const [blockBody, blockLetters] = g.block;
  const [bookCover, bookPages] = g.book;
  const [crayonWax, crayonWrap] = g.crayon;
  const [marbleCore, marbleShell] = g.marble;
  const [carBody, carTrim] = g.car;
  const [sockA, sockB] = g.sock;

  const C = PROP_CAPACITY;
  const mk = (name: string, vd: VertexData, m: PBRMaterial, per: number, colored: boolean, casts = true): Batch => {
    const mesh = buildMesh(scene, `prop-${name}`, vd, m);
    mesh.parent = root;
    // The clear marble glass casts no shadow (a solid disc reads as an opaque ball); only
    // its swirl core does.
    if (casts) look.addShadowCaster(mesh);
    look.receiveShadows(mesh);
    return new Batch(mesh, C * per, colored);
  };
  const b = {
    blockBody: mk('blockBody', blockBody, blockMat, PER_PROP.block, true),
    blockLetters: mk('blockLetters', blockLetters, letterMat, PER_PROP.block, false),
    bookCover: mk('bookCover', bookCover, coverMat, PER_PROP.book, true),
    bookPages: mk('bookPages', bookPages, pageMat, PER_PROP.book, false),
    crayonWax: mk('crayonWax', crayonWax, waxMat, PER_PROP.crayon, true),
    crayonWrap: mk('crayonWrap', crayonWrap, wrapMat, PER_PROP.crayon, true),
    marbleCore: mk('marbleCore', marbleCore, coreMat, PER_PROP.marble, true),
    marbleShell: mk('marbleShell', marbleShell, glassMat, PER_PROP.marble, true, false),
    carBody: mk('carBody', carBody, carMat, PER_PROP.car, true),
    carTrim: mk('carTrim', carTrim, trimMat, PER_PROP.car, false),
    sock: mk('sock', sockA, sockMat, PER_PROP.sock, true),
    sockCream: mk('sockCream', sockB, sockCreamMat, PER_PROP.sock, false),
    brick4: mk('brick2x4', g.brick4, brickMat, PER_PROP.brick4, true),
    brick2: mk('brick2x2', g.brick2, brickMat, PER_PROP.brick2, true),
  };
  // The glass shell draws after the opaque core.
  b.marbleShell.mesh.alphaIndex = 1;
  const batches = Object.values(b);

  // Scratch (no allocation in add()).
  const prop = new Matrix();
  const local = new Matrix();
  const world = new Matrix();
  const q = new Quaternion();
  const sv = new Vector3();
  const tv = new Vector3();
  const col = new Color3();
  const palette: Color3[] = [];
  for (let i = 0; i < PROP_COLOR_COUNT; i++) palette.push(propColor(i));

  const colorOf = (i: number, jitter: number): Color3 => {
    const c = palette[((i % PROP_COLOR_COUNT) + PROP_COLOR_COUNT) % PROP_COLOR_COUNT];
    const k = 0.96 + jitter * 0.08;
    return col.set(c.r * k, c.g * k, c.b * k);
  };
  // Writes `local` (scale, yaw/pitch/roll, offset in prop space) x prop matrix.
  const part = (
    sx: number,
    sy: number,
    sz: number,
    ry: number,
    rx: number,
    rz: number,
    x: number,
    y: number,
    z: number,
  ): Matrix => {
    Quaternion.RotationYawPitchRollToRef(ry, rx, rz, q);
    sv.set(sx, sy, sz);
    tv.set(x, y, z);
    Matrix.ComposeToRef(sv, q, tv, local);
    local.multiplyToRef(prop, world);
    return world;
  };

  // Face-up orientations for alphabet blocks (pitch, roll) so each shows other letters.
  // No upside-down roll: the front letters never show rotated 180 degrees.
  const FACE_UP: readonly [number, number][] = [
    [0, 0],
    [Math.PI / 2, 0],
    [-Math.PI / 2, 0],
    [0, Math.PI / 2],
    [0, -Math.PI / 2],
  ];
  const BLOCK_COLORS = [0, 1, 3, 4, 5]; // TOY_COLORS without yellow
  const blockScale = (x: number, z: number, i: number): number => 0.9 + hash(x, z, i + 11) * 0.14;

  function addBlock(variant: number, x: number, z: number, ci: number): void {
    const v = variant % 4;
    const n = v === 0 ? 1 : v === 1 ? 2 : 3;
    // Pyramid base: two blocks side by side, yaw kept small and spaced by their rotated
    // half-extents (s/2 * (cos + sin)) plus a gap, so the corners never meet.
    const s0 = blockScale(x, z, 0);
    const s1 = blockScale(x, z, 1);
    let y = 0;
    for (let i = 0; i < n; i++) {
      const h1 = hash(x, z, i + 1);
      const h2 = hash(x, z, i + 11);
      const s = blockScale(x, z, i);
      const [rx, rz] = FACE_UP[Math.floor(h1 * FACE_UP.length) % FACE_UP.length];
      let yaw = (h2 - 0.5) * 0.9;
      let px = 0;
      let py = 0;
      let pz = 0;
      if (v === 3) {
        if (i < 2) {
          yaw = (h2 - 0.5) * 0.3;
          const ext = (sc: number, ya: number): number =>
            ((BLOCK * sc) / 2) * (Math.cos(Math.abs(ya)) + Math.sin(Math.abs(ya)));
          const e0 = ext(s0, (hash(x, z, 11) - 0.5) * 0.3);
          const e1 = ext(s1, (hash(x, z, 12) - 0.5) * 0.3);
          const mid = (e0 - e1) / 2; // centre the pair
          px = i === 0 ? -e0 - 0.025 + mid : e1 + 0.025 + mid;
          pz = i === 1 ? 0.06 : 0;
        } else {
          // The top block bridges both (rests on the taller one).
          px = 0.02;
          pz = 0.03;
          py = BLOCK * Math.max(s0, s1);
        }
      } else {
        // Each block sits exactly on the one below (its real scaled height).
        py = y;
        px = (h1 - 0.5) * 0.12 * i;
        y += BLOCK * s;
      }
      const m = part(s, s, s, yaw, rx, rz, px, py + (BLOCK * s) / 2, pz);
      // No yellow on wood: under the grain it turns ochre, too close to the enemy tan.
      const bc = ci + i * 2;
      b.blockBody.push(m, colorOf(BLOCK_COLORS[((bc % 5) + 5) % 5], h1));
      b.blockLetters.push(m, null);
    }
  }

  function addBook(variant: number, x: number, z: number, ci: number): void {
    const n = (variant % 3) + 1;
    let y = 0;
    for (let i = 0; i < n; i++) {
      const h = hash(x, z, i + 3);
      // Lower books are bigger; each is turned a little on the one below.
      const sw = 1 - i * 0.1 + (h - 0.5) * 0.08;
      const sh = 0.85 + h * 0.4;
      const yaw = i === 0 ? 0 : (h - 0.5) * 0.9;
      const m = part(sw, sh, sw, yaw, 0, 0, (h - 0.5) * 0.2 * i, y, (hash(x, z, i + 7) - 0.5) * 0.2 * i);
      b.bookCover.push(m, colorOf(ci + i * 2 + (i > 0 ? 1 : 0), h));
      b.bookPages.push(m, null);
      y += BOOK_H * sh;
    }
  }

  function addCrayon(variant: number, x: number, z: number, ci: number): void {
    const v = variant % 3;
    const R = CRAYON_R;
    const lift = R + 0.012; // axis height of a crayon lying flat (wrapper radius)
    if (v === 1) {
      // Crossed pair: the first lies flat; the second leans across it, its tail end on
      // the floor and its body resting on the first one's top.
      const h0 = hash(x, z, 5);
      const h1 = hash(x, z, 6);
      const len0 = 0.85 + h0 * 0.15;
      const len1 = 0.85 + h1 * 0.15;
      const yaw0 = -0.55;
      const yaw1 = 0.6;
      const d0x = Math.sin(yaw0),
        d0z = Math.cos(yaw0);
      const d1x = Math.sin(yaw1),
        d1z = Math.cos(yaw1);
      const half1 = (CRAYON_L / 2) * len1;
      // Crossing point on the first crayon's axis; the second crosses it 0.3 of its half
      // length in front of its own centre, so the tail is 1.3 half-lengths from it.
      const cx = 0.2 * d0x,
        cz = 0.2 * d0z;
      const dist = 1.3 * half1;
      // Axis-over-axis height where they touch: two wrapper radii, over the skew factor of
      // the crossing (~0.95), plus what the tail sinks by tilting (lift * (1 - cos)).
      const touch = (2 * lift) / 0.95 + 0.005;
      let pitch = Math.asin(Math.min(0.9, touch / dist));
      pitch = Math.asin(Math.min(0.9, (touch + lift * (1 - Math.cos(pitch))) / dist));
      const cp = Math.cos(pitch),
        sp = Math.sin(pitch);
      const tailY = lift * cp; // the tail's lower rim just touches the floor
      const c1x = cx - d1x * 0.3 * half1 * cp;
      const c1z = cz - d1z * 0.3 * half1 * cp;
      const c1y = tailY + half1 * sp;
      // Centre the pair on the pivot.
      const mx = c1x / 2;
      const mz = c1z / 2;
      // Crossing must stay at the lifted height: lift the flat one exactly to `lift`.
      const ry0 = h0 * Math.PI * 2;
      const ry1 = h1 * Math.PI * 2;
      // Compose roll (about the axis) and pitch before the yaw: part() applies Z, X, Y.
      b.crayonWax.push(part(1, 1, len0, yaw0, 0, ry0, -mx, lift, -mz), colorOf(ci, h0));
      b.crayonWrap.push(world, colorOf(ci, h0));
      b.crayonWax.push(part(1, 1, len1, yaw1, -pitch, ry1, c1x - mx, c1y, c1z - mz), colorOf(ci + 1, h1));
      b.crayonWrap.push(world, colorOf(ci + 1, h1));
      return;
    }
    const n = v === 0 ? 1 : 3;
    for (let i = 0; i < n; i++) {
      const h = hash(x, z, i + 5);
      const len = i === 2 ? 0.7 : 0.85 + h * 0.15; // worn-down crayons are shorter
      // Fan of three, spread so neighbours never touch (axes >= 2 radii apart).
      const yaw = v === 2 ? (i - 1) * 0.18 : 0;
      const ox = v === 2 ? (i - 1) * 0.6 : 0;
      const oz = v === 2 && i === 2 ? -0.2 : 0;
      const roll = h * Math.PI * 2;
      const m = part(1, 1, len, yaw, 0, roll, ox, lift, oz);
      b.crayonWax.push(m, colorOf(ci + i, h));
      b.crayonWrap.push(m, colorOf(ci + i, h));
    }
  }

  // Cluster layout (x, z, scale), relaxed offline so every pair stays >= 1.02 x the sum
  // of radii apart even with the +-0.03 position and +-5% scale jitter below.
  const MARBLES: readonly [number, number, number][] = [
    [0, 0, 1.35],
    [0.644, 0.258, 1],
    [0.13, -0.681, 1],
    [-0.566, -0.377, 0.95],
    [-0.563, 0.405, 1],
    [0.59, -0.323, 0.92],
    [-0.023, 0.693, 1],
  ];
  const shellTint = new Color3();
  function addMarbles(variant: number, x: number, z: number, ci: number): void {
    const n = [3, 5, 7][variant % 3];
    for (let i = 0; i < n; i++) {
      const [mx, mz, ms] = MARBLES[i];
      const h = hash(x, z, i + 9);
      const s = (i === 0 && n < 7 ? 1 : ms) * (0.95 + h * 0.1);
      const jx = (hash(x, z, i + 21) - 0.5) * 0.06;
      const jz = (hash(x, z, i + 31) - 0.5) * 0.06;
      const m = part(s, s, s, h * 6.28, (h - 0.5) * 2.4, hash(x, z, i + 41) * 3, mx + jx, MARBLE_R * s, mz + jz);
      const c = colorOf(ci + i * 2 + (i > 2 ? 1 : 0), h);
      // Dark, faintly tinted glass body: it should not milk over the rug; the rim and highlight
      // come from the reflections riding over the transparency.
      shellTint.set(0.1 + c.r * 0.3, 0.1 + c.g * 0.3, 0.1 + c.b * 0.3);
      b.marbleCore.push(m, c);
      b.marbleShell.push(m, shellTint);
    }
  }
  function addCar(variant: number, x: number, z: number, ci: number): void {
    const h = hash(x, z, 13);
    const m =
      variant % 2 === 1
        ? part(1, 1, 1, 0, 0, Math.PI / 2, 0.45, CAR_W / 2 + 0.12, 0) // tipped on its left side
        : part(1, 1, 1, 0, 0, 0, 0, 0, 0);
    b.carBody.push(m, colorOf(ci, h));
    b.carTrim.push(m, null);
  }

  function addSock(variant: number, x: number, z: number, ci: number): void {
    const n = (variant % 2) + 1;
    for (let i = 0; i < n; i++) {
      const h = hash(x, z, i + 17);
      // A pair lies nested side by side (the second shifted along the leg), never through
      // each other.
      const m =
        i === 0
          ? part(1, 1, 1, 0, 0, 0, n === 2 ? -0.38 : 0, 0, n === 2 ? -0.38 : 0)
          : part(0.97, 1, 0.97, 0.06 * (h - 0.5), 0, 0, 0.4, 0, 0.4);
      b.sock.push(m, colorOf(ci, h));
      b.sockCream.push(m, null);
    }
  }

  function addBrick(variant: number, x: number, z: number, ci: number): void {
    const v = variant % 4;
    const h = hash(x, z, 23);
    if (v === 1) {
      b.brick2.push(part(1, 1, 1, 0, 0, 0, 0, 0, 0), colorOf(ci, h));
      return;
    }
    b.brick4.push(part(1, 1, 1, 0, 0, 0, 0, 0, 0), colorOf(ci, h));
    if (v === 2) b.brick4.push(part(1, 1, 1, Math.PI / 2, 0, 0, 0, BRICK_H, 0.2), colorOf(ci + 3, h));
    else if (v === 3) b.brick2.push(part(1, 1, 1, 0, 0, 0, 0, BRICK_H, PITCH), colorOf(ci + 2, h));
  }

  const kit: PropKit = {
    kinds: [...PROP_KINDS],
    radius: { ...PROP_RADIUS },
    meshes: batches.map((x) => x.mesh),
    begin() {
      for (const x of batches) x.reset();
    },
    add(kind, variant, x, z, yaw, scale, colorIndex) {
      const v = Math.abs(Math.floor(variant));
      const ci = Math.floor(colorIndex);
      Quaternion.RotationYawPitchRollToRef(yaw, 0, 0, q);
      sv.set(scale, scale, scale);
      tv.set(x, 0, z);
      Matrix.ComposeToRef(sv, q, tv, prop);
      switch (kind) {
        case 'block':
          addBlock(v, x, z, ci);
          break;
        case 'book':
          addBook(v, x, z, ci);
          break;
        case 'crayon':
          addCrayon(v, x, z, ci);
          break;
        case 'marble':
          addMarbles(v, x, z, ci);
          break;
        case 'car':
          addCar(v, x, z, ci);
          break;
        case 'sock':
          addSock(v, x, z, ci);
          break;
        case 'brick':
          addBrick(v, x, z, ci);
          break;
      }
    },
    commit() {
      for (const x of batches) x.commit();
    },
    dispose() {
      for (const x of batches) look.removeShadowCaster(x.mesh);
      root.dispose();
    },
  };
  (kit as PropKit & { root: TransformNode }).root = root;
  return kit;
}

// ---------------------------------------------------------------------------------
// preview

export function preview(scene: Scene, look: Look, opts: PreviewOptions): PreviewResult {
  const kit = createPropKit(scene, look) as PropKit & { root: TransformNode };
  kit.begin();
  if (opts.variant && (PROP_KINDS as readonly string[]).includes(opts.variant)) {
    // Close-up of one kind (not listed in info.variants): every variant in a row.
    const kind = opts.variant as PropKindName;
    const n = PROP_VARIANTS[kind];
    const step = PROP_RADIUS[kind] * 2.1;
    for (let i = 0; i < n; i++) kit.add(kind, i, (i - (n - 1) / 2) * step, 0, 0.35, 1, i);
  } else if (opts.variant === 'scatter') {
    // A lane edge: props on both sides of the 10-wide rug, >= 1.2 off it, like the game.
    let s = 1234567;
    const rand = (): number => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const kinds = PROP_KINDS;
    const pick = (): PropKindName => {
      let r = rand();
      for (const k of kinds) {
        r -= PROP_WEIGHTS[k];
        if (r <= 0) return k;
      }
      return 'block';
    };
    // Like scatterScenery: reject a candidate whose footprint meets an earlier prop's.
    const placed: [number, number, number][] = [];
    for (let i = 0, tries = 0; i < 70 && tries < 2000; tries++) {
      const side = i % 2 === 0 ? -1 : 1;
      const kind = pick();
      const scale = 0.85 + rand() * 0.3;
      const r = PROP_RADIUS[kind] * scale;
      const out = 5 + 1.2 + r + Math.pow(rand(), 1.6) * 16;
      const z = -40 + rand() * 64;
      const x = side * out;
      if (placed.some(([px, pz, pr]) => Math.hypot(px - x, pz - z) < pr + r)) continue;
      placed.push([x, z, r]);
      i++;
      kit.add(kind, Math.floor(rand() * 8), x, z, rand() * Math.PI * 2, scale, Math.floor(rand() * 6));
    }
  } else {
    // Still life, ~12 x 8: back row books and car, middle blocks and bricks, front
    // crayons, marbles and socks.
    const P = Math.PI;
    kit.add('book', 0, -4.6, -2.6, 0.15, 1, 1);
    kit.add('book', 1, -1.6, -2.7, -0.2, 1, 3);
    kit.add('book', 2, 1.5, -2.6, 0.25, 1, 0);
    kit.add('car', 0, 4.6, -2.4, P * 0.15 + 0.4, 1, 0);
    kit.add('block', 0, -5.3, 0.4, 0.3, 1, 0);
    kit.add('block', 1, -3.9, 0.5, -0.2, 1, 1);
    kit.add('block', 2, -2.5, 0.3, 0.5, 1, 2);
    kit.add('block', 3, -0.6, 0.6, 0.1, 1, 4);
    kit.add('brick', 0, 1.2, 0.6, 0.4, 1, 1);
    kit.add('brick', 1, 2.4, 0.9, -0.3, 1, 2);
    kit.add('brick', 2, 3.7, 0.5, 0.2, 1, 0);
    kit.add('brick', 3, 5.2, 0.7, -0.5, 1, 3);
    kit.add('crayon', 0, -5.2, 3.0, 1.2, 1, 0);
    kit.add('crayon', 1, -3.4, 3.2, 1.7, 1, 1);
    kit.add('crayon', 2, -1.5, 3.1, 1.5, 1, 3);
    kit.add('marble', 0, 0.3, 3.0, 0, 1, 1);
    kit.add('marble', 1, 1.5, 3.3, 0.5, 1, 4);
    kit.add('marble', 2, 2.8, 3.1, 1.1, 1, 5);
    kit.add('sock', 0, 5.0, 3.4, 0.3, 1, 5);
    kit.add('car', 1, 0.8, -5.4, 1.9, 1, 1);
    kit.add('sock', 1, -5.2, -6.6, -0.4, 1, 1);
    kit.add('marble', 0, 3.6, -5.3, 0.7, 1, 2);
  }
  kit.commit();
  return {
    root: kit.root,
    dispose() {
      kit.dispose();
    },
  };
}
