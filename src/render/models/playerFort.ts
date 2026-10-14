// Player fort: a moulded green plastic toy fort (classic playset) along the bottom of the
// lane. Built procedurally so its width follows the lane.
//
// Layout (local units, pivot at the ground centre of the footprint, front = +Z = up the lane):
//   - a moulded base plinth (printed cream star decal in the courtyard) over the whole footprint (width x depth), courtyard on top
//   - the crenellated front wall along +Z (top of merlons 1.42) with moulded stones on both
//     faces and a plank wall-walk behind it, reached by short stairs
//   - a central gatehouse (top 1.56) with an arched wooden double door on both faces (iron
//     straps, brass rivets and ring pulls; braces on the inside), a brass star above the gate
//   - two round corner towers at the front corners (top 1.8) with a corbelled crenellated
//     rim, arrow slits, a hatch, and a green flag with a cream star on the left one
//   - low side and rear walls, a flagstone courtyard with crates, barrels and cannonballs
// Everything near the middle of the front stays under 1.6 so the cannon (lane z = 1.5)
// stays clear; only the corner towers and the flag go higher, out at the lane edges.
//
// Draw calls: 4 meshes (plastic, wood, brass, flag), one material each. Plastic and
// wood carry vertex colours (palette greens, dark iron straps) with ambient occlusion
// baked against the fort's own parts at build time (~30-60 ms).
//
// GAME API
//   const fort = createPlayerFort(scene, look, { width: lane.width + 0.36, depth: LAYOUT.playerBaseDepth });
//   fort.root.position.set(0, 0, LAYOUT.playerBaseZ - depth / 2);   // yaw 0 (side 'player')
//   fort.hpBarAnchor  local point (0, 1.9, depth/2 - 0.2): hang the HP bar there
//                     (world: Vector3.TransformCoordinates(anchor, fort.root.getWorldMatrix())).
//   fort.setFlash(k)  0..1 white-hot hit flash (emissive on the fort's own materials).
//   fort.setDamage(f) 0..1; visual stages at 0.25 / 0.5 / 0.75 (merlons knocked off and
//                     lying on the wall-walk / in the courtyard, cracks with stress-whitened
//                     halos, scorch marks, flag tilted, wall bites, a door hanging). Only
//                     swaps cached vertex data when the stage changes (~1-3 ms).
//   Warm-up:          the fort builds stages 1-3 by itself in the background, starting 3
//                     frames after creation, <= ~4-8 ms of work per frame (geometry, then AO
//                     in chunks) via scene.onBeforeRenderObservable; done within ~30-60
//                     frames, i.e. long before the first enemy reaches the wall. If
//                     setDamage needs a stage that is not ready yet it finishes it
//                     synchronously (only possible in the first second).
//   fort.prewarm()    optional: build all stages now (e.g. behind a loading screen).
//   fort.dispose()    disposes meshes and its own materials (never the shared textures).
// Shadows: all four meshes cast (static), plastic and wood receive. Nothing to do for
// integration beyond look.fitShadows covering z down to the fort's back edge.
import type { Scene } from '@babylonjs/core/scene';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateTorusVertexData } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type { Look } from '../look/index.ts';
import {
  HEX,
  brassMaterial,
  fixWinding,
  lathe,
  lin,
  mergeParts,
  paint,
  place,
  plasticMaterial,
  woodMaterial,
} from '../look/index.ts';
import type { ModelInfo, PreviewOptions, PreviewResult } from '../look/model.ts';

export const info: ModelInfo = {
  key: 'playerFort',
  title: 'Player fort (green plastic)',
  instanced: false,
  teams: false,
  side: 'player',
  height: 1.8,
  triangleBudget: 8000,
  gameZ: -1.5,
  variants: ['intact', 'damaged'],
};

export interface FortOptions {
  width: number; // 6..12 (lane width + 0.36)
  depth: number; // 3 (LAYOUT.playerBaseDepth)
}

export interface FortModel {
  root: TransformNode;
  hpBarAnchor: Vector3;
  setFlash(k: number): void;
  setDamage(frac: number): void;
  /** Builds every damage stage now (optional; a background warm-up does it anyway). */
  prewarm(): void;
  dispose(): void;
}

// ---------------------------------------------------------------- small geometry kit
type V3 = [number, number, number];
type Occ = { kind: 'box'; min: V3; max: V3 } | { kind: 'cyl'; x: number; z: number; r: number; y0: number; y1: number };

function hash(i: number, salt: number): number {
  const s = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

// Builds a flat-shaded convex-polygon soup into a VertexData; polygons are fanned from
// their centroid and oriented outward from `centre`.
class Soup {
  pos: number[] = [];
  nrm: number[] = [];
  ind: number[] = [];
  poly(pts: readonly V3[], centre: V3 = [0, 0, 0]): void {
    const n = pts.length;
    let nx = 0,
      ny = 0,
      nz = 0,
      cx = 0,
      cy = 0,
      cz = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[i],
        b = pts[(i + 1) % n];
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
      cx += a[0] / n;
      cy += a[1] / n;
      cz += a[2] / n;
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    if ((cx - centre[0]) * nx + (cy - centre[1]) * ny + (cz - centre[2]) * nz < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const base = this.pos.length / 3;
    this.pos.push(cx, cy, cz);
    this.nrm.push(nx, ny, nz);
    for (const p of pts) {
      this.pos.push(p[0], p[1], p[2]);
      this.nrm.push(nx, ny, nz);
    }
    for (let i = 0; i < n; i++) this.ind.push(base, base + 1 + i, base + 1 + ((i + 1) % n));
  }
  quad(pts: readonly V3[], centre: V3 = [0, 0, 0]): void {
    // Quads: two triangles (no centre vertex).
    const before = this.pos.length;
    this.poly(pts, centre);
    if (pts.length !== 4) return;
    // Replace the fan with a plain 2-triangle quad (drop the centroid's triangles).
    const base = before / 3;
    this.ind.splice(this.ind.length - 12, 12, base + 1, base + 2, base + 3, base + 1, base + 3, base + 4);
  }
  vd(): VertexData {
    const vd = new VertexData();
    vd.positions = this.pos;
    vd.normals = this.nrm;
    vd.indices = this.ind;
    return fixWinding(vd);
  }
}

// A chamfered (bevelled) box centred on the origin: crisp moulded edges for 44 triangles.
function chamferBox(w: number, h: number, d: number, c: number, bottom = true): VertexData {
  const H = [w / 2, h / 2, d / 2];
  const cc = Math.min(c, H[0] * 0.8, H[1] * 0.8, H[2] * 0.8);
  const I = [H[0] - cc, H[1] - cc, H[2] - cc];
  const s = new Soup();
  const pt = (a: number, va: number, b: number, vb: number, cA: number, vc: number): V3 => {
    const p: V3 = [0, 0, 0];
    p[a] = va;
    p[b] = vb;
    p[cA] = vc;
    return p;
  };
  for (let f = 0; f < 3; f++) {
    const u = (f + 1) % 3,
      v = (f + 2) % 3;
    for (const sg of [-1, 1]) {
      if (!bottom && f === 1 && sg === -1) continue;
      s.quad([
        pt(f, sg * H[f], u, -I[u], v, -I[v]),
        pt(f, sg * H[f], u, I[u], v, -I[v]),
        pt(f, sg * H[f], u, I[u], v, I[v]),
        pt(f, sg * H[f], u, -I[u], v, I[v]),
      ]);
    }
  }
  for (let a = 0; a < 3; a++) {
    for (let b = a + 1; b < 3; b++) {
      const k = 3 - a - b;
      for (const sa of [-1, 1])
        for (const sb of [-1, 1]) {
          if (!bottom && ((a === 1 && sa < 0) || (b === 1 && sb < 0))) continue;
          s.quad([
            pt(a, sa * H[a], b, sb * I[b], k, -I[k]),
            pt(a, sa * H[a], b, sb * I[b], k, I[k]),
            pt(a, sa * I[a], b, sb * H[b], k, I[k]),
            pt(a, sa * I[a], b, sb * H[b], k, -I[k]),
          ]);
        }
    }
  }
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) {
        if (!bottom && sy < 0) continue;
        const t = s.pos.length;
        s.poly([
          [sx * H[0], sy * I[1], sz * I[2]],
          [sx * I[0], sy * H[1], sz * I[2]],
          [sx * I[0], sy * I[1], sz * H[2]],
        ]);
        // Triangles: drop the centroid fan, keep one triangle.
        const base = t / 3;
        s.ind.splice(s.ind.length - 9, 9, base + 1, base + 2, base + 3);
      }
  return s.vd();
}

// A block with only its top edges bevelled and no bottom (merlons, wall bodies, posts):
// 18 triangles; the bevel catches the highlight seen from above.
function topBlock(w: number, h: number, d: number, c: number): VertexData {
  const s = new Soup();
  const W = w / 2,
    H = h / 2,
    D = d / 2;
  const cc = Math.min(c, W * 0.8, H * 0.8, D * 0.8);
  const corners: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const Bv: V3[] = corners.map(([a, b]) => [a * W, -H, b * D]);
  const Sv: V3[] = corners.map(([a, b]) => [a * W, H - cc, b * D]);
  const Tv: V3[] = corners.map(([a, b]) => [a * (W - cc), H, b * (D - cc)]);
  const ctr: V3 = [0, -H * 0.5, 0];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    s.quad([Bv[i], Bv[j], Sv[j], Sv[i]], ctr);
    s.quad([Sv[i], Sv[j], Tv[j], Tv[i]], ctr);
  }
  s.quad(Tv, ctr);
  return s.vd();
}

// A raised moulded tile (stone, flagstone, plank): a chamfered top on sloped sides, open
// underneath. Built in its own frame (x along U, y along N, z along V) then oriented.
function tile(w: number, d: number, h: number, c: number): VertexData {
  const s = new Soup();
  const W = w / 2,
    D = d / 2,
    iw = Math.max(0.001, W - c),
    id = Math.max(0.001, D - c);
  const top: V3[] = [
    [-iw, h, -id],
    [iw, h, -id],
    [iw, h, id],
    [-iw, h, id],
  ];
  const bot: V3[] = [
    [-W, 0, -D],
    [W, 0, -D],
    [W, 0, D],
    [-W, 0, D],
  ];
  const ctr: V3 = [0, -0.5, 0];
  s.quad(top, ctr);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    s.quad([bot[i], bot[j], top[j], top[i]], ctr);
  }
  return s.vd();
}

// A flat quad (decal strip) in its own frame, x along U, z along V, facing +y: 2 triangles.
function flat(w: number, d: number, h: number): VertexData {
  const s = new Soup();
  s.quad(
    [
      [-w / 2, h, -d / 2],
      [w / 2, h, -d / 2],
      [w / 2, h, d / 2],
      [-w / 2, h, d / 2],
    ],
    [0, -1, 0],
  );
  return s.vd();
}

// Extrudes a 2D polygon (star-shaped around its centroid) in XY, depth along Z, centred on z = 0.
function slab(pts: readonly [number, number][], depth: number): VertexData {
  const s = new Soup();
  const z = depth / 2;
  let cx = 0,
    cy = 0;
  for (const p of pts) {
    cx += p[0] / pts.length;
    cy += p[1] / pts.length;
  }
  const ctr: V3 = [cx, cy, 0];
  s.poly(
    pts.map((p) => [p[0], p[1], z] as V3),
    ctr,
  );
  s.poly(
    pts.map((p) => [p[0], p[1], -z] as V3),
    ctr,
  );
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i],
      b = pts[(i + 1) % pts.length];
    s.quad(
      [
        [a[0], a[1], -z],
        [b[0], b[1], -z],
        [b[0], b[1], z],
        [a[0], a[1], z],
      ],
      ctr,
    );
  }
  return s.vd();
}

function starPts(r: number, inner: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * inner : r;
    out.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  return out;
}

// Maps local coordinates into a frame: p' = o + U x + V y + N z (normals likewise).
function orient(vd: VertexData, o: V3, U: V3, V: V3, N: V3): VertexData {
  const p = vd.positions!,
    n = vd.normals!;
  const P: number[] = [],
    Q: number[] = [];
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i],
      y = p[i + 1],
      z = p[i + 2];
    P.push(
      o[0] + U[0] * x + V[0] * y + N[0] * z,
      o[1] + U[1] * x + V[1] * y + N[1] * z,
      o[2] + U[2] * x + V[2] * y + N[2] * z,
    );
    const a = n[i],
      b = n[i + 1],
      c = n[i + 2];
    Q.push(U[0] * a + V[0] * b + N[0] * c, U[1] * a + V[1] * b + N[1] * c, U[2] * a + V[2] * b + N[2] * c);
  }
  vd.positions = P;
  vd.normals = Q;
  return vd;
}

// Box-projected UVs (grain along V = world y on vertical faces, z on horizontal ones).
function boxUV(vd: VertexData, scale: number, rot = false): VertexData {
  const p = vd.positions!,
    n = vd.normals!;
  const uv: number[] = [];
  for (let i = 0; i < p.length; i += 3) {
    const ax = Math.abs(n[i]),
      ay = Math.abs(n[i + 1]),
      az = Math.abs(n[i + 2]);
    let u: number, v: number;
    if (ay >= ax && ay >= az) {
      u = p[i];
      v = p[i + 2];
    } else if (ax >= az) {
      u = p[i + 2];
      v = p[i + 1];
    } else {
      u = p[i];
      v = p[i + 1];
    }
    if (rot) uv.push(v * scale, u * scale);
    else uv.push(u * scale, v * scale);
  }
  vd.uvs = uv;
  return vd;
}

// ---------------------------------------------------------------- vertex AO against parts
const AO_DIRS: number[] = (() => {
  const out: number[] = [];
  const n = 14;
  for (let k = 0; k < n; k++) {
    const u = (k + 0.5) / n;
    const r = Math.sqrt(u);
    const a = k * 2.399963;
    out.push(r * Math.cos(a), r * Math.sin(a), Math.sqrt(1 - u));
  }
  return out;
})();

function rayOcc(o: Occ, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): boolean {
  if (o.kind === 'box') {
    let t0 = 0,
      t1 = maxT;
    const org = [ox, oy, oz],
      dir = [dx, dy, dz];
    for (let a = 0; a < 3; a++) {
      if (Math.abs(dir[a]) < 1e-9) {
        if (org[a] < o.min[a] || org[a] > o.max[a]) return false;
        continue;
      }
      let ta = (o.min[a] - org[a]) / dir[a],
        tb = (o.max[a] - org[a]) / dir[a];
      if (ta > tb) {
        const t = ta;
        ta = tb;
        tb = t;
      }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return false;
    }
    return t1 > 1e-4;
  }
  // Vertical cylinder (side and caps).
  const px = ox - o.x,
    pz = oz - o.z;
  const a = dx * dx + dz * dz;
  const b = 2 * (px * dx + pz * dz);
  const c = px * px + pz * pz - o.r * o.r;
  if (c <= 0 && oy >= o.y0 && oy <= o.y1) return true;
  if (a > 1e-9) {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / (2 * a);
      if (t > 1e-4 && t < maxT) {
        const y = oy + dy * t;
        if (y >= o.y0 && y <= o.y1) return true;
      }
    }
  }
  if (Math.abs(dy) > 1e-9) {
    for (const yc of [o.y0, o.y1]) {
      const t = (yc - oy) / dy;
      if (t > 1e-4 && t < maxT) {
        const x = px + dx * t,
          z = pz + dz * t;
        if (x * x + z * z <= o.r * o.r) return true;
      }
    }
  }
  return false;
}

function occBounds(o: Occ): [V3, V3] {
  return o.kind === 'box'
    ? [o.min, o.max]
    : [
        [o.x - o.r, o.y0, o.z - o.r],
        [o.x + o.r, o.y1, o.z + o.r],
      ];
}

// Bakes AO into vertex colours in chunks of `chunk` vertices, yielding between chunks so a
// background warm-up can spread the work over several frames.
function* bakeAO(
  vd: VertexData,
  occs: readonly Occ[],
  maxDist = 0.45,
  strength = 0.62,
  chunk = 1e9,
): Generator<void, void, void> {
  const p = vd.positions!,
    n = vd.normals!;
  const nv = p.length / 3;
  const col = vd.colors ? Float32Array.from(vd.colors) : new Float32Array(nv * 4).fill(1);
  vd.colors = col;
  const bounds = occs.map(occBounds);
  const near: Occ[] = [];
  const nd = AO_DIRS.length / 3;
  for (let v = 0; v < nv; v++) {
    if (v > 0 && v % chunk === 0) yield;
    const nx = n[v * 3],
      ny = n[v * 3 + 1],
      nz = n[v * 3 + 2];
    const ox = p[v * 3] + nx * 0.004,
      oy = p[v * 3 + 1] + ny * 0.004,
      oz = p[v * 3 + 2] + nz * 0.004;
    near.length = 0;
    for (let i = 0; i < occs.length; i++) {
      const [mn, mx] = bounds[i];
      if (
        ox > mn[0] - maxDist &&
        ox < mx[0] + maxDist &&
        oy > mn[1] - maxDist &&
        oy < mx[1] + maxDist &&
        oz > mn[2] - maxDist &&
        oz < mx[2] + maxDist
      )
        near.push(occs[i]);
    }
    const tx0 = Math.abs(nx) < 0.9 ? 1 : 0,
      ty0 = tx0 ? 0 : 1;
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
    let hit = 0;
    for (let k = 0; k < nd; k++) {
      const a = AO_DIRS[k * 3],
        b = AO_DIRS[k * 3 + 1],
        c = AO_DIRS[k * 3 + 2];
      const dx = tx * a + bx * b + nx * c,
        dy = ty * a + by * b + ny * c,
        dz = tz * a + bz * b + nz * c;
      if (dy < -1e-6 && oy / -dy < maxDist) {
        hit++;
        continue;
      }
      for (const o of near)
        if (rayOcc(o, ox, oy, oz, dx, dy, dz, maxDist)) {
          hit++;
          break;
        }
    }
    const ao = 1 - strength * (hit / nd);
    col[v * 4] *= ao;
    col[v * 4 + 1] *= ao;
    col[v * 4 + 2] *= ao;
  }
}

// ---------------------------------------------------------------- the fort
interface StageData {
  plastic: VertexData;
  wood: VertexData;
  brass: VertexData;
  cloth: VertexData;
}

class Acc {
  parts: VertexData[] = [];
  add(vd: VertexData, c: Color3): VertexData {
    paint(vd, c);
    this.parts.push(vd);
    return vd;
  }
}

const mix = (a: Color3, b: Color3, t: number): Color3 => Color3.Lerp(a, b, t);

// Builds one damage stage. A generator: it yields after the geometry and between AO
// chunks, so the background warm-up never spends more than ~10-20 ms in one frame.
function* buildStage(W: number, D: number, stage: number, chunk = 1e9): Generator<void, StageData, void> {
  const hw = W / 2,
    hd = D / 2;
  const P = new Acc(),
    Wd = new Acc(),
    B = new Acc(),
    C = new Acc();
  const occ: Occ[] = [];

  const green = lin(HEX.green),
    dark = lin(HEX.greenDark),
    light = lin(HEX.greenLight);
  const towerCol = mix(green, dark, 0.45);
  const trim = mix(green, dark, 0.8);
  const stone = mix(green, light, 0.12);
  const plank = mix(green, light, 0.28);
  const crackCol = lin('#16230f'); // deep green-black, not pure black
  const stubCol = mix(trim, lin(HEX.paper), 0.08); // break faces: still green, a little paler
  const whitened = mix(green, lin(HEX.paper), 0.5); // narrow stress-whitened bands at breaks
  const halo = mix(green, lin(HEX.paper), 0.32); // stress halo either side of a crack
  // Courtyard: darker and less saturated than the walls, with deep grout between flags.
  const desat = (c: Color3, k: number): Color3 => {
    const l = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
    return mix(c, new Color3(l, l, l), k);
  };
  const flagCol = desat(mix(green, dark, 0.32), 0.22);
  const groutCol = desat(mix(dark, new Color3(0, 0, 0), 0.45), 0.2);
  const ironCol = new Color3(0.06, 0.055, 0.05);
  const woodCol = new Color3(1, 1, 1);

  const boxOcc = (w: number, h: number, d: number, x: number, y0: number, z: number): void => {
    occ.push({ kind: 'box', min: [x - w / 2, y0, z - d / 2], max: [x + w / 2, y0 + h, z + d / 2] });
  };
  // Axis-aligned chamfered box with its bottom at y0.
  const box = (
    acc: Acc,
    w: number,
    h: number,
    d: number,
    x: number,
    y0: number,
    z: number,
    col: Color3,
    c = 0.03,
    isOcc = true,
    bottom = false,
  ): VertexData => {
    const vd = place(bottom ? chamferBox(w, h, d, c, true) : topBlock(w, h, d, c * 1.2), { x, y: y0 + h / 2, z });
    if (isOcc) boxOcc(w, h, d, x, y0, z);
    return acc.add(vd, col);
  };
  const tint = (c: Color3, i: number, salt: number, amt = 0.06): Color3 => c.scale(1 - amt / 2 + hash(i, salt) * amt);
  // Moulded green plastic hatch (bevelled lid, raised frame, cross braces, ring pull):
  // replaces the plain wooden slabs that read as untextured placeholders.
  const hatch = (w: number, d: number, x: number, y: number, z: number): void => {
    const lid = mix(trim, dark, 0.25);
    P.add(place(chamferBox(w + 0.06, 0.03, d + 0.06, 0.012, false), { x, y: y + 0.015, z }), mix(trim, dark, 0.55));
    P.add(place(chamferBox(w, 0.045, d, 0.016, false), { x, y: y + 0.035, z }), lid);
    for (const k of [-0.25, 0.25])
      P.add(
        place(chamferBox(w * 0.9, 0.018, 0.035, 0.008, false), { x, y: y + 0.066, z: z + k * d }),
        mix(lid, light, 0.2),
      );
    P.add(place(chamferBox(0.035, 0.018, d * 0.9, 0.008, false), { x, y: y + 0.066, z }), mix(lid, light, 0.2));
    P.add(
      place(CreateTorusVertexData({ diameter: Math.min(w, d) * 0.28, thickness: 0.018, tessellation: 12 }), {
        x,
        y: y + 0.08,
        z: z + d * 0.32,
      }),
      mix(lid, light, 0.35),
    );
  };

  const T = 0.36; // front wall thickness
  const wallTop = 1.12;
  const zWallOut = hd,
    zWallIn = hd - T,
    zWall = hd - T / 2;
  const walkTop = 0.75;
  const walkD = 0.55;
  const zWalkIn = zWallIn - walkD;
  const tR = 0.82; // tower base radius
  const tx = hw - tR; // tower centre x
  const tz = hd - tR + 0.02;
  const gw = 1.25; // gatehouse half width
  const zG0 = hd - 0.85,
    zG1 = hd + 0.06; // gatehouse back / front faces
  const gTop = 1.28;
  const courtY = 0.16;

  // ---- base plinth (courtyard floor)
  {
    const vd = place(chamferBox(W, courtY, D, 0.05, false), { y: courtY / 2 });
    P.add(vd, mix(green, dark, 0.6));
    // Deep grout under the courtyard flagstones (a flat decal over the plinth top).
    P.add(place(flat(W - 0.5, D - 0.5, 0), { y: courtY + 0.002 }), groutCol);
    boxOcc(W, courtY, D, 0, 0, 0);
  }

  // ---- front wall: segments between each tower and the gatehouse
  let merlonIndex = 0;
  const knockP = [0, 0.22, 0.48, 0.78][stage];
  const fallen: { w: number; h: number; d: number; col: Color3; i: number }[] = [];
  const merlon = (
    x: number,
    y0: number,
    z: number,
    w: number,
    h: number,
    d: number,
    col: Color3,
    extraKnock = 0,
  ): void => {
    const i = merlonIndex++;
    const knocked = stage > 0 && hash(i, 3) < Math.min(1, knockP + extraKnock);
    if (!knocked) {
      box(P, w, h, d, x, y0, z, tint(col, i, 1, 0.08), 0.035);
      return;
    }
    // Broken stub with a stress-whitened top and a jagged shard.
    const sh = 0.05 + hash(i, 4) * 0.08;
    P.add(place(tile(w * 0.96, d * 0.96, sh, 0.02), { x, y: y0, z }), col);
    const shard = place(tile(w * 0.5, d * 0.75, 0.06, 0.015), {
      x: x + (hash(i, 5) - 0.5) * w * 0.4,
      y: y0 + sh - 0.01,
      z,
      rz: (hash(i, 6) - 0.5) * 0.9,
      rx: (hash(i, 7) - 0.5) * 0.4,
    });
    P.add(shard, stubCol);
    // Narrow whitened band along the jagged break edge (camera side).
    P.add(
      place(flat(w * 0.7, 0.045, 0.004), { x, y: y0 + sh, z: z - d * 0.38, rz: (hash(i, 6) - 0.5) * 0.5 }),
      whitened,
    );
    fallen.push({ w, h, d, col, i });
  };

  const segLen = 1.3;
  const bites = new Set<string>();
  if (stage >= 3) {
    bites.add('L1');
    bites.add('R0');
  }
  for (const side of [-1, 1]) {
    const a = tx * side,
      b = gw * side;
    const x0 = Math.min(a, b),
      x1 = Math.max(a, b);
    const n = Math.max(1, Math.round((x1 - x0) / segLen));
    const sl = (x1 - x0) / n;
    for (let s = 0; s < n; s++) {
      // Segment order from the gatehouse outward, so labels are symmetric.
      const k = side < 0 ? n - 1 - s : s;
      const label = `${side < 0 ? 'L' : 'R'}${k}`;
      const bitten = bites.has(label);
      const sx0 = x0 + s * sl,
        sx1 = sx0 + sl;
      const cx = (sx0 + sx1) / 2;
      const top = bitten ? 0.82 : wallTop - 0.06;
      box(P, sl + 0.01, top - courtY, T, cx, courtY, zWall, tint(green, s + side * 7, 2, 0.04), 0.04);
      if (bitten) {
        // Jagged rubble along the bitten top, whitened at the breaks.
        for (let r = 0; r < 4; r++) {
          const vd = place(chamferBox(0.22 + hash(r, s + 9) * 0.15, 0.12, T * 0.8, 0.02), {
            x: sx0 + (r + 0.5) * (sl / 4),
            y: top + 0.03,
            z: zWall,
            rz: (hash(r, s + 11) - 0.5) * 1.1,
            ry: (hash(r, s + 13) - 0.5) * 0.4,
          });
          P.add(vd, r % 2 ? stubCol : green);
        }
        for (let m = 0; m < 2; m++) fallen.push({ w: 0.36, h: 0.3, d: T, col: trim, i: 100 + m + s * 3 });
        continue;
      }
      // Coping lip and merlons.
      box(P, sl + 0.012, 0.09, T + 0.07, cx, wallTop - 0.09, zWall, trim, 0.03);
      const mw = 0.36;
      const nm = Math.max(1, Math.round(sl / 0.62));
      for (let m = 0; m < nm; m++) {
        const mx = sx0 + (m + 0.5) * (sl / nm);
        merlon(mx, wallTop, zWall, mw, 0.3, T + 0.02, trim);
      }
    }
    // Moulded stones: outer face 4 rows, inner parapet 2 rows (skipping bitten segments).
    const stones = (z: number, nz: number, rows: [number, number][], salt: number): void => {
      rows.forEach(([y0, y1], r) => {
        let x = x0 + 0.04 + (r % 2 ? 0.24 : 0);
        if (r % 2) {
          const first = 0.2;
          addStone(x0 + 0.04 + first / 2 - 0.02, (y0 + y1) / 2, z, nz, first - 0.04, y1 - y0, r * 31 + salt, side);
        }
        let i = 0;
        while (x < x1 - 0.12) {
          const len = Math.min(0.42 + hash(i + r * 17, salt) * 0.16, x1 - 0.04 - x);
          if (len > 0.1) addStone(x + len / 2, (y0 + y1) / 2, z, nz, len - 0.035, y1 - y0, i + r * 13 + salt, side);
          x += len;
          i++;
        }
      });
    };
    const addStone = (
      x: number,
      y: number,
      z: number,
      nz: number,
      w: number,
      h: number,
      i: number,
      sd: number,
    ): void => {
      if (stage >= 3) {
        // Bitten segments lose their upper stones.
        const segIdx = Math.min(n - 1, Math.max(0, Math.floor((x - x0) / sl)));
        const k = sd < 0 ? n - 1 - segIdx : segIdx;
        if (bites.has(`${sd < 0 ? 'L' : 'R'}${k}`) && y + h / 2 > 0.8) return;
      }
      const vd = orient(tile(w, h, 0.022, 0.014), [x, y, z], [1, 0, 0], [0, 0, nz], [0, nz, 0]);
      P.add(vd, tint(stone, i, 8, 0.1));
    };
    stones(
      zWallOut,
      1,
      [
        [0.2, 0.46],
        [0.485, 0.745],
        [0.77, 1.02],
      ],
      40 + side,
    );
    stones(
      zWallIn,
      -1,
      [
        [0.785, 0.9],
        [0.92, 1.025],
      ],
      60 + side,
    );

    // Wall-walk: slab, moulded planks, posts.
    const wx0 = side < 0 ? -tx + 0.55 : gw - 0.02,
      wx1 = side < 0 ? -gw + 0.02 : tx - 0.55;
    const wl = wx1 - wx0,
      wcx = (wx0 + wx1) / 2;
    box(P, wl, 0.07, walkD, wcx, walkTop - 0.085, zWallIn - walkD / 2, mix(green, dark, 0.3), 0.02);
    const rowsN = 4,
      pw = walkD / rowsN;
    for (let r = 0; r < rowsN; r++) {
      let x = wx0 + 0.01 - (r % 2 ? 0.35 : 0);
      let i = 0;
      while (x < wx1 - 0.05) {
        const len = 0.9 + hash(i, r + side * 5) * 0.4;
        const a = Math.max(x, wx0 + 0.01),
          b = Math.min(x + len, wx1 - 0.01);
        const missing = stage >= 3 && hash(i + r * 7, 70 + side) < 0.18;
        if (b - a > 0.08 && !missing) {
          const vd = orient(
            tile(b - a - 0.02, pw - 0.018, 0.018, 0.008),
            [(a + b) / 2, walkTop - 0.016, zWalkIn + (r + 0.5) * pw],
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1],
          );
          P.add(vd, tint(plank, i + r * 11, 9, 0.12));
        }
        x += len;
        i++;
      }
    }
    const posts = Math.max(2, Math.round(wl / 1.5) + 1);
    for (let k = 0; k < posts; k++) {
      const x = wx0 + 0.08 + (k * (wl - 0.16)) / (posts - 1);
      box(P, 0.1, walkTop - 0.085 - courtY, 0.1, x, courtY, zWalkIn + 0.07, mix(green, dark, 0.4), 0.02);
    }
    // Stairs down to the courtyard beside the tower.
    const sxc = side * (tx - tR - 0.32);
    const rise = (walkTop - courtY) / 4;
    for (let k = 1; k <= 3; k++) {
      const z1 = zWalkIn - (3 - k) * 0.21,
        z0 = z1 - 0.21;
      box(P, 0.5, k * rise, z1 - z0 + 0.002, sxc, courtY, (z0 + z1) / 2, tint(plank, k, 12, 0.08), 0.025);
    }
  }

  yield;
  // ---- gatehouse
  {
    const gcz = (zG0 + zG1) / 2,
      gd = zG1 - zG0;
    box(P, gw * 2, gTop - courtY, gd, 0, courtY, gcz, tint(green, 3, 2, 0.03), 0.05);
    box(P, gw * 2 + 0.08, 0.08, gd + 0.08, 0, gTop - 0.06, gcz, trim, 0.03);
    // Roof tiles and a trapdoor.
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 2; j++) {
        const x = -gw + 0.2 + (i + 0.5) * ((gw * 2 - 0.4) / 4),
          z = zG0 + 0.18 + (j + 0.5) * ((gd - 0.36) / 2);
        if (Math.abs(x) < 0.3 && j === 0) continue;
        const vd = orient(
          tile((gw * 2 - 0.4) / 4 - 0.04, (gd - 0.36) / 2 - 0.04, 0.02, 0.01),
          [x, gTop + 0.02, z],
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        );
        P.add(vd, tint(stone, i + j * 5, 14, 0.1));
      }
    }
    hatch(0.42, 0.36, 0, gTop + 0.02, zG0 + 0.18 + (gd - 0.36) / 4);
    // Merlons on all four edges (front 4, back 4, one per side).
    const mh = 0.26,
      my = gTop + 0.02;
    for (const x of [-1.0, -0.34, 0.34, 1.0]) {
      merlon(x, my, zG1 - 0.04, 0.34, mh, 0.16, trim, 0.1);
      merlon(x, my, zG0 + 0.04, 0.34, mh, 0.16, trim, 0.1);
    }
    for (const sd of [-1, 1]) merlon(sd * (gw - 0.04), my, gcz, 0.16, mh, 0.34, trim, 0.1);
    // Pilasters on the front corners and either side of the back door.
    for (const sd of [-1, 1]) {
      box(P, 0.2, gTop - courtY - 0.02, 0.06, sd * (gw - 0.12), courtY, zG1 + 0.03, trim, 0.02, false);
      box(P, 0.12, 1.05, 0.05, sd * 0.68, courtY, zG0 - 0.025, trim, 0.02, false);
    }

    // Arched double doors (front and back faces), wooden planks.
    const R = 0.45,
      spring = 0.5; // door: 0.9 wide, arch from y = spring (above the courtyard)
    const archY = (x: number): number => spring + Math.sqrt(Math.max(0, R * R - x * x));
    const leafPlanks = (sgn: number): [number, number][][] => {
      const out: [number, number][][] = [];
      const edges = sgn < 0 ? [-R, -0.3, -0.15, -0.008] : [0.008, 0.15, 0.3, R];
      for (let k = 0; k < 3; k++) {
        const a = edges[k] + (k === 0 && sgn < 0 ? 0 : 0.006),
          b = edges[k + 1] - (k === 2 && sgn > 0 ? 0 : 0.006);
        const pts: [number, number][] = [
          [a, 0],
          [b, 0],
        ];
        for (let q = 0; q <= 3; q++) {
          const x = b + ((a - b) * q) / 3;
          pts.push([x, archY(x)]);
        }
        out.push(pts);
      }
      return out;
    };
    const voussoirs = (zFace: number, nz: number): void => {
      const n = 7;
      for (let k = 0; k < n; k++) {
        const a = (Math.PI * (k + 0.5)) / n;
        const rr = R + 0.09;
        const cx = -Math.cos(a) * rr,
          cy = courtY + spring + Math.sin(a) * rr;
        const U: V3 = [Math.sin(a), Math.cos(a), 0];
        const V: V3 = [-Math.cos(a), Math.sin(a), 0];
        const vd = orient(chamferBox(0.2, 0.17, 0.08, 0.02, false), [cx, cy, zFace + nz * 0.04], U, V, [0, 0, 1]);
        P.add(vd, tint(k === (n - 1) / 2 ? trim : stone, k, 15, 0.1));
      }
      for (const sd of [-1, 1]) {
        box(
          P,
          0.17,
          spring,
          0.08,
          sd * (R + 0.09),
          courtY,
          zFace + nz * 0.04,
          tint(stone, sd + 3, 16, 0.08),
          0.02,
          false,
        );
      }
    };
    // A board lying on a door face (wood mesh): w along the angle, h across, t proud.
    const board = (
      w: number,
      h: number,
      t: number,
      x: number,
      y: number,
      z: number,
      nz: number,
      ang: number,
      col: Color3,
    ): void => {
      const ca = Math.cos(ang),
        sa = Math.sin(ang);
      const vd = orient(tile(w, h, t, Math.min(0.01, t * 0.4)), [x, y, z], [ca, sa, 0], [0, 0, nz], [-sa, ca, 0]);
      Wd.add(boxUV(vd, 1.2, true), col);
    };
    const doors = (zFace: number, nz: number, inside: boolean): void => {
      for (const sgn of [-1, 1]) {
        const hang = inside && stage >= 3 && sgn < 0 ? 0.12 : 0;
        for (const pts of leafPlanks(sgn)) {
          const vd = slab(pts, 0.05);
          if (hang) place(vd, { rz: hang, x: -0.06, y: -0.04 });
          orient(vd, [0, courtY, zFace + nz * 0.025], [1, 0, 0], [0, 1, 0], [0, 0, nz]);
          boxUV(vd, 1.2);
          Wd.add(vd, tint(woodCol, pts.length + Math.round(pts[0][0] * 100), 17, 0.14));
        }
        const leafX = (sgn * R) / 2;
        if (!inside) {
          // Iron strap hinges with brass rivets.
          for (const y of [0.18, 0.6]) {
            board(R - 0.06, 0.06, 0.02, leafX, courtY + y, zFace + nz * 0.05, nz, 0, ironCol);
            for (const k of [-1, 1]) {
              const rv = lathe(
                [
                  [0.022, 0],
                  [0.02, 0.01],
                  [0, 0.018],
                ],
                5,
              );
              orient(rv, [leafX + k * 0.13, courtY + y, zFace + nz * 0.07], [1, 0, 0], [0, 0, nz], [0, 1, 0]);
              B.add(rv, woodCol);
            }
          }
        } else {
          // Ledges and a Z brace on the inside.
          const off = hang ? 0.04 : 0;
          for (const y of [0.18, 0.62]) {
            board(
              R - 0.05,
              0.09,
              0.03,
              leafX + off * sgn,
              courtY + y - off,
              zFace + nz * 0.05,
              nz,
              hang * nz,
              mix(woodCol, ironCol, 0.2),
            );
          }
          board(
            0.5,
            0.08,
            0.028,
            leafX,
            courtY + 0.4 - off,
            zFace + nz * 0.05,
            nz,
            (sgn * 0.75 + hang) * nz,
            mix(woodCol, ironCol, 0.2),
          );
        }
        // Brass ring pull (inside only: the outside is never seen in the game).
        if (!inside) continue;
        const ring = CreateTorusVertexData({ diameter: 0.1, thickness: 0.018, tessellation: 6 });
        orient(ring, [sgn * 0.08, courtY + 0.38, zFace + nz * (inside ? 0.06 : 0.07)], [1, 0, 0], [0, 0, 1], [0, 1, 0]);
        B.add(ring, woodCol);
      }
      voussoirs(zFace, nz);
      // Threshold step.
      box(P, R * 2 + 0.3, 0.04, 0.16, 0, courtY, zFace + nz * 0.08, stone, 0.015, false);
    };
    doors(zG1, 1, false);
    doors(zG0, -1, true);
    // Stones around the gate on both faces.
    const gateStones = (zFace: number, nz: number, salt: number): void => {
      let i = 0;
      for (let r = 0; r < 5; r++) {
        const y0 = courtY + 0.06 + r * 0.205,
          y1 = y0 + 0.18;
        let x = -gw + 0.24 - (r % 2 ? 0.2 : 0);
        while (x < gw - 0.24) {
          const len = 0.36 + hash(i, salt) * 0.14;
          const a = Math.max(x, -gw + 0.24),
            b = Math.min(x + len, gw - 0.24);
          x += len;
          i++;
          const cx = (a + b) / 2,
            cy = (y0 + y1) / 2;
          // Skip stones over the door arch and pilasters.
          const ax = Math.max(Math.abs(a), Math.abs(b)) < R + 0.2 ? Math.min(Math.abs(a), Math.abs(b)) : 0;
          const doorH = courtY + spring + Math.sqrt(Math.max(0, (R + 0.2) ** 2 - ax * ax)) + 0.02;
          if ((Math.min(Math.abs(a), Math.abs(b)) < R + 0.2 || a * b < 0) && y0 < doorH) continue;
          if (zFace < hd && Math.abs(cx) > 0.55 && Math.abs(cx) < 0.82) continue; // back pilasters
          if (b - a < 0.1) continue;
          const vd = orient(
            tile(b - a - 0.035, y1 - y0, 0.02, 0.012),
            [cx, cy, zFace],
            [1, 0, 0],
            [0, 0, nz],
            [0, nz, 0],
          );
          P.add(vd, tint(stone, i, salt + 1, 0.1));
        }
      }
    };
    gateStones(zG1, 1, 80);
    gateStones(zG0, -1, 90);
    // Brass star emblem above the front arch.
    const star = slab(starPts(0.12, 0.45), 0.03);
    orient(star, [0, courtY + spring + R + 0.3, zG1 + 0.02], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
    B.add(star, woodCol);
  }

  yield;
  // ---- corner towers
  for (const side of [-1, 1]) {
    const cx = side * tx;
    const prof: [number, number][] = [
      [tR, 0],
      [tR - 0.03, 0.08],
      [tR - 0.06, 0.34],
      [tR - 0.06, 0.69],
      [tR - 0.09, 0.735],
      [tR - 0.06, 0.78],
      [tR - 0.06, 1.24],
      [tR + 0.03, 1.33],
      [tR + 0.04, 1.46],
      [tR + 0.01, 1.5],
      [tR - 0.13, 1.5],
      [tR - 0.14, 1.44],
      [0, 1.44],
    ];
    const body = place(lathe(prof, 18), { x: cx, z: tz });
    const nv = body.positions!.length / 3;
    const cols = new Float32Array(nv * 4);
    for (let v = 0; v < nv; v++) {
      const y = body.positions![v * 3 + 1];
      const c =
        y > 1.3 && y < 1.49 ? trim : y > 0.72 && y < 0.75 ? trim : y < 0.33 ? mix(towerCol, dark, 0.3) : towerCol;
      cols.set([c.r, c.g, c.b, 1], v * 4);
    }
    body.colors = cols;
    P.parts.push(body);
    occ.push({ kind: 'cyl', x: cx, z: tz, r: tR - 0.06, y0: 0, y1: 1.44 });
    // Rim merlons.
    const nm = 8;
    for (let k = 0; k < nm; k++) {
      const a = ((k + 0.5) / nm) * Math.PI * 2;
      const i = merlonIndex++;
      const knocked = stage >= 2 && hash(i, 3) < (stage === 2 ? 0.3 : 0.6);
      const N: V3 = [Math.sin(a), 0, Math.cos(a)],
        U: V3 = [Math.cos(a), 0, -Math.sin(a)];
      const r = tR - 0.04;
      const o: V3 = [cx + N[0] * r, 0, tz + N[2] * r];
      if (!knocked) {
        o[1] = 1.5 + 0.15;
        P.add(orient(topBlock(0.3, 0.3, 0.17, 0.04), o, U, [0, 1, 0], N), tint(trim, i, 1, 0.08));
      } else {
        o[1] = 1.5 + 0.03;
        P.add(orient(tile(0.28, 0.15, 0.06, 0.02), [o[0], o[1] - 0.03, o[2]], U, [0, 1, 0], N), stubCol);
        P.add(
          orient(flat(0.26, 0.05, 0.004), [o[0] - N[0] * 0.05, o[1] + 0.03, o[2] - N[2] * 0.05], U, [0, 1, 0], N),
          whitened,
        );
        fallen.push({ w: 0.3, h: 0.3, d: 0.17, col: trim, i });
      }
    }
    // Trapdoor hatch on the tower floor (wood), with brass hinge pins.
    hatch(0.36, 0.36, cx - side * 0.12, 1.44, tz - 0.12);
    // Arrow slits (framed) facing the courtyard, the outside and the lane.
    for (const a of [Math.PI, Math.PI - side * 0.9, (side * Math.PI) / 2]) {
      const N: V3 = [Math.sin(a), 0, Math.cos(a)],
        U: V3 = [Math.cos(a), 0, -Math.sin(a)];
      const r = tR - 0.065;
      P.add(orient(tile(0.17, 0.4, 0.03, 0.014), [cx + N[0] * r, 0.98, tz + N[2] * r], U, N, [0, 1, 0]), trim);
      P.add(
        orient(
          tile(0.055, 0.27, 0.012, 0.005),
          [cx + N[0] * (r + 0.03), 0.98, tz + N[2] * (r + 0.03)],
          U,
          N,
          [0, 1, 0],
        ),
        lin('#1d2a19'),
      );
    }
    // Moulded stone courses on the tower base: little tiles around the batter.
    for (let k = 0; k < 11; k++) {
      for (const [y, off] of [[0.5, 0]] as const) {
        const aa = ((k + off + (side > 0 ? 0.5 : 0)) / 11) * Math.PI * 2;
        const N2: V3 = [Math.sin(aa), 0, Math.cos(aa)],
          U2: V3 = [Math.cos(aa), 0, -Math.sin(aa)];
        const r = tR - 0.06;
        P.add(
          orient(tile(0.36, 0.12, 0.018, 0.01), [cx + N2[0] * r, y, tz + N2[2] * r], U2, N2, [0, 1, 0]),
          tint(stone, k, 19 + side, 0.1),
        );
      }
    }
  }

  // ---- side and rear walls with corner posts
  {
    const rh = 0.6,
      rt = 0.28;
    const zr = -hd + rt / 2;
    box(P, W - 0.6, rh - courtY, rt, 0, courtY, zr, tint(green, 1, 21, 0.04), 0.035);
    box(P, W - 0.58, 0.06, rt + 0.06, 0, rh, zr, trim, 0.02);
    for (const side of [-1, 1]) {
      const x = side * (hw - rt / 2);
      const z0 = -hd + 0.3,
        z1 = tz - tR + 0.15;
      box(P, rt, rh - courtY, z1 - z0, x, courtY, (z0 + z1) / 2, tint(green, side, 22, 0.04), 0.035);
      box(P, rt + 0.06, 0.06, z1 - z0, x, rh, (z0 + z1) / 2, trim, 0.02);
      box(P, 0.5, 0.86, 0.5, side * (hw - 0.25), 0, -hd + 0.25, towerCol, 0.05);
      for (let f = 0; f < 4; f++) {
        const a = (f * Math.PI) / 2;
        const N: V3 = [Math.sin(a), 0, Math.cos(a)],
          U: V3 = [Math.cos(a), 0, -Math.sin(a)];
        for (const [py, ph] of [[0.43, 0.62]] as const) {
          P.add(
            orient(
              tile(0.36, ph, 0.02, 0.012),
              [side * (hw - 0.25) + N[0] * 0.25, py, -hd + 0.25 + N[2] * 0.25],
              U,
              N,
              [0, 1, 0],
            ),
            tint(mix(towerCol, light, 0.1), f + py * 10, 27, 0.08),
          );
        }
      }
      box(P, 0.58, 0.08, 0.58, side * (hw - 0.25), 0.86, -hd + 0.25, trim, 0.03);
      const vd = lathe(
        [
          [0.16, 0],
          [0.16, 0.04],
          [0.12, 0.1],
          [0, 0.14],
        ],
        8,
      );
      P.add(place(vd, { x: side * (hw - 0.25), y: 0.94, z: -hd + 0.25 }), trim);
    }
  }

  yield;
  // ---- courtyard: flagstones, crates, barrels, cannonballs
  {
    const zMin = -hd + 0.32,
      zMax = zWalkIn - 0.02;
    const rows = Math.max(1, Math.round((zMax - zMin) / 0.5));
    const rh = (zMax - zMin) / rows;
    let i = 0;
    for (let r = 0; r < rows; r++) {
      let x = -hw + 0.32 - (r % 2 ? 0.25 : 0);
      while (x < hw - 0.32) {
        const len = 0.6 + hash(i, 23) * 0.35;
        const a = Math.max(x, -hw + 0.32),
          b = Math.min(x + len, hw - 0.32);
        x += len;
        i++;
        const cx = (a + b) / 2,
          cz = zMin + (r + 0.5) * rh;
        if (b - a < 0.15) continue;
        if (Math.hypot(Math.abs(cx) - tx, cz - tz) < tR + 0.15) continue;
        if (Math.abs(Math.abs(cx) - (tx - tR - 0.32)) < 0.4 && cz > zWalkIn - 0.7) continue;
        // Flags sit at slightly different heights and tints (worn, hand-laid stones);
        // the baked AO darkens the grout seams between them.
        const fh = 0.02 + hash(i, 29) * 0.022;
        const vd = orient(tile(b - a - 0.07, rh - 0.07, fh, 0.018), [cx, courtY, cz], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
        P.add(vd, tint(mix(mix(flagCol, dark, hash(i, 26) * 0.35), light, hash(i, 25) * 0.2), i, 24, 0.24));
      }
    }
    // Crates (wood) and barrels (wood staves, brass hoops) in the back corners.
    // Green plastic ammo boxes: moulded lid rim, carry handles and a cream stencil plate
    // with dark 'lettering' bars on the front.
    const crate = (x: number, y0: number, z: number, s: number, ry: number): void => {
      const body = mix(trim, dark, 0.35);
      const at = (vd: VertexData, lx: number, ly: number, lz: number): VertexData =>
        place(place(vd, { x: lx, y: ly, z: lz }), { x, y: y0, z, ry });
      P.add(at(chamferBox(s, s * 0.82, s * 0.7, 0.025, false), 0, s * 0.41, 0), body);
      P.add(at(chamferBox(s + 0.025, s * 0.14, s * 0.7 + 0.025, 0.012, false), 0, s * 0.86, 0), mix(body, light, 0.15));
      for (const sx of [-1, 1])
        P.add(at(chamferBox(0.03, 0.05, s * 0.3, 0.01, false), sx * (s / 2 + 0.015), s * 0.6, 0), mix(body, dark, 0.3));
      const face = s * 0.35 + 0.006;
      P.add(at(chamferBox(s * 0.62, s * 0.26, 0.012, 0.004, false), 0, s * 0.45, face), lin(HEX.paper));
      for (const [lx, lw] of [
        [-0.19, 0.1],
        [-0.05, 0.12],
        [0.1, 0.09],
        [0.21, 0.05],
      ] as const) {
        P.add(at(chamferBox(s * lw, s * 0.1, 0.008, 0.002, false), s * lx, s * 0.45, face + 0.008), lin('#26331f'));
      }
      boxOcc(s, s, s * 0.7, x, y0, z);
    };
    const PS = 1.15; // props a little larger than scale so they read at phone size
    const barrel = (x: number, z: number): void => {
      const prof: [number, number][] = [
        [0.14, 0],
        [0.155, 0.04],
        [0.17, 0.2],
        [0.155, 0.36],
        [0.135, 0.4],
        [0.11, 0.39],
        [0, 0.39],
      ];
      const vd = boxUV(
        place(
          lathe(
            prof.map(([r, y]) => [r * PS, y * PS] as [number, number]),
            12,
          ),
          { x, y: courtY, z },
        ),
        2.5,
      );
      Wd.add(vd, woodCol);
      for (const [y, r] of [
        [0.07, 0.158],
        [0.33, 0.16],
      ] as const) {
        const hoop = lathe(
          [
            [r * PS, 0],
            [r * PS + 0.013, 0.015],
            [r * PS, 0.03],
          ],
          12,
        );
        B.add(place(hoop, { x, y: courtY + y * PS, z }), woodCol);
      }
      occ.push({ kind: 'cyl', x, z, r: 0.16 * PS, y0: courtY, y1: courtY + 0.4 * PS });
    };
    const lx = -tx + 0.95,
      rx = tx - 0.95;
    crate(lx, courtY, -hd + 0.72, 0.38 * PS, 0.15);
    crate(lx + 0.02, courtY + 0.38 * PS, -hd + 0.72, 0.3 * PS, 0.45);
    barrel(rx, -hd + 0.7);
    barrel(rx - 0.45, -hd + 0.64);
    barrel(rx - 0.2, -hd + 1.1);
    // Cannonball pyramid (dark plastic).
    const ball = (x: number, y: number, z: number): void => {
      const prof: [number, number][] = [];
      const br = 0.09 * PS;
      for (let k = 0; k <= 5; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5;
        prof.push([Math.cos(a) * br, Math.sin(a) * br + br]);
      }
      P.add(place(lathe(prof, 10), { x, y, z }), lin('#3b4636')); // dark olive plastic, not a black hole
    };
    const bx = 1.8,
      bz = -hd + 0.75;
    const bo = 0.09 * PS;
    for (const [dx, dz] of [
      [-bo, -bo],
      [bo, -bo],
      [-bo, bo],
      [bo, bo],
    ] as const)
      ball(bx + dx, courtY, bz + dz);
    ball(bx, courtY + 0.13 * PS, bz);
  }

  // ---- fallen merlons: on the wall-walk and in the courtyard only (never on the lane in
  // front of the fort, which is the cannon / spawn zone).
  fallen
    .filter((f) => hash(f.i, 36) < 0.27)
    .forEach((f, k) => {
      const r = hash(f.i, 31);
      let x: number, y: number, z: number;
      const lie = 0.9 + hash(f.i, 32) * 0.7;
      const sz = Math.min(f.w, f.d);
      if (r < 0.5) {
        // Wall-walk, clear of the gatehouse.
        const sd = hash(f.i, 37) < 0.5 ? -1 : 1;
        x = sd * (gw + 0.4 + hash(f.i, 33) * (tx - gw - 1.2));
        y = walkTop;
        z = zWalkIn + 0.15 + hash(f.i, 34) * 0.25;
      } else {
        x = (hash(f.i, 33) - 0.5) * (W - 3);
        y = courtY + 0.02;
        z = -0.6 + hash(f.i, 34) * 0.9;
      }
      const vd = place(chamferBox(f.w, f.h, f.d, 0.03), {
        x,
        y: y + (sz / 2) * 0.9 + 0.01,
        z,
        rx: k % 2 ? 1.2 : 0.25,
        ry: hash(f.i, 35) * 3,
        rz: lie,
      });
      P.add(vd, f.col);
    });

  yield;
  // ---- cracks (dark, slightly proud of the surface). Most go where the lane camera looks:
  // the wall-walk side of the parapet, the coping and gatehouse roof tops, the towers.
  {
    const nCracks = [0, 5, 10, 12][stage];
    const add3 = (o: V3, A: V3, ka: number, Bv: V3, kb: number): V3 => [
      o[0] + A[0] * ka + Bv[0] * kb,
      o[1] + A[1] * ka + Bv[1] * kb,
      o[2] + A[2] * ka + Bv[2] * kb,
    ];
    const comb = (A: V3, ka: number, Bv: V3, kb: number): V3 => [
      A[0] * ka + Bv[0] * kb,
      A[1] * ka + Bv[1] * kb,
      A[2] * ka + Bv[2] * kb,
    ];
    for (let c = 0; c < nCracks; c++) {
      const kind = c % 5;
      const side = c % 2 ? 1 : -1;
      const r1 = hash(c, 41),
        r2 = hash(c, 42);
      let o: V3,
        U0: V3 = [1, 0, 0],
        V0: V3 = [0, 1, 0],
        N: V3 = [0, 0, -1];
      let scale = 1;
      if (kind === 0) {
        o = [side * (gw + 0.4 + r1 * (tx - gw - 1.4)), 0.84 + r2 * 0.12, zWallIn - 0.004];
      } else if (kind === 1) {
        // Across the coping top, running toward the lane.
        o = [side * (gw + 0.35 + r1 * (tx - gw - 1.3)), wallTop + 0.002, zWall - 0.12];
        V0 = [0, 0, 1];
        N = [0, 1, 0];
        scale = 0.8;
      } else if (kind === 2) {
        const a = Math.PI - side * (0.3 + r1 * 0.9);
        N = [Math.sin(a), 0, Math.cos(a)];
        U0 = [Math.cos(a), 0, -Math.sin(a)];
        o = [side * tx + N[0] * (tR - 0.055), 0.45 + r2 * 0.6, tz + N[2] * (tR - 0.055)];
      } else if (kind === 3) {
        // Gatehouse roof.
        o = [side * (0.35 + r1 * 0.6), gTop + 0.022, zG0 + 0.25 + r2 * 0.3];
        V0 = [0, 0, 1];
        N = [0, 1, 0];
      } else {
        o = [(r1 - 0.5) * 1.8, 0.95 + r2 * 0.2, zG0 - 0.004];
        if (Math.abs(o[0]) < 0.75) o[0] = side * 0.95;
      }
      if (c >= 10) {
        // Late cracks: the outer wall face (seen in close-ups).
        o = [side * (gw + 0.3 + r1 * (tx - gw - 1.2)), 0.35 + r2 * 0.5, zWallOut + 0.004];
        U0 = [1, 0, 0];
        V0 = [0, 1, 0];
        N = [0, 0, 1];
        scale = 1;
      }
      // Zig-zag polyline of 3-4 strips in the surface plane, plus a short branch.
      let px = 0,
        py = 0;
      let ang = -1.2 + hash(c, 43) * 0.6;
      const segs = 3 + (c % 2);
      for (let k = 0; k < segs; k++) {
        const len = (0.11 + hash(c * 7 + k, 44) * 0.1) * scale;
        const ca = Math.cos(ang),
          sa = Math.sin(ang);
        const dx = ca * len,
          dy = sa * len;
        const Ux = comb(U0, ca, V0, sa),
          Vy = comb(U0, -sa, V0, ca);
        // Wide at the root, tapering; a pale stress-whitened halo strip underneath.
        const cw = Math.max(0.03, 0.085 - k * 0.018) * (scale < 1 ? 0.85 : 1);
        const mid = add3(o, U0, px + dx / 2, V0, py + dy / 2);
        P.add(orient(flat(len + 0.05, cw + 0.055, 0.004), mid, Ux, N, Vy), halo);
        P.add(orient(flat(len + 0.02, cw, 0.009), mid, Ux, N, Vy), crackCol);
        if (k === 1) {
          const ba = ang + 0.9,
            bl = 0.12 * scale;
          const bca = Math.cos(ba),
            bsa = Math.sin(ba);
          const bm = add3(o, U0, px + dx + (bca * bl) / 2, V0, py + dy + (bsa * bl) / 2),
            BU = comb(U0, bca, V0, bsa),
            BV = comb(U0, -bsa, V0, bca);
          P.add(orient(flat(bl + 0.03, 0.075, 0.004), bm, BU, N, BV), halo);
          P.add(orient(flat(bl, 0.03, 0.009), bm, BU, N, BV), crackCol);
        }
        px += dx;
        py += dy;
        ang += (k % 2 ? 1 : -1) * (0.7 + hash(c + k, 45) * 0.5);
      }
    }
  }

  // ---- scorch marks on the surfaces the lane camera sees (wall-walk, coping, gatehouse
  // roof, courtyard): soft sooty discs, dark at the centre and fading to a dark green rim.
  {
    const nScorch = [0, 3, 6, 9][stage];
    const soot = lin('#1b1d14'),
      rim = mix(green, dark, 0.65).scale(0.75);
    for (let c = 0; c < nScorch; c++) {
      const side = c % 2 ? 1 : -1,
        r1 = hash(c, 51),
        r2 = hash(c, 52);
      const kind = c % 3;
      let o: V3;
      if (kind === 0) o = [side * (gw + 0.6 + r1 * (tx - gw - 1.6)), walkTop + 0.006, zWalkIn + 0.12 + r2 * 0.3];
      else if (kind === 1) o = [side * (0.25 + r1 * 0.75), gTop + 0.046, zG0 + 0.25 + r2 * 0.35];
      else o = [side * (0.9 + r1 * (hw - 2.4)), courtY + 0.031, -hd + 0.6 + r2 * 0.9];
      const rad = [0.14, 0.15, 0.2][kind] + hash(c, 53) * 0.06;
      const pts: V3[] = [];
      const n = 11;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const rr = rad * (0.65 + hash(c * 13 + k, 54) * 0.5);
        pts.push([o[0] + Math.cos(a) * rr, o[1], o[2] + Math.sin(a) * rr * 0.8]);
      }
      const sp = new Soup();
      sp.poly(pts, [o[0], o[1] - 1, o[2]]);
      const vd = sp.vd();
      const cols: number[] = [];
      for (let v = 0; v < n + 1; v++) {
        const cc = v === 0 ? soot : rim;
        cols.push(cc.r, cc.g, cc.b, 1);
      }
      vd.colors = cols;
      P.parts.push(vd);
    }
  }

  // ---- printed cream star in a ring on the courtyard (playset decal)
  {
    const o: V3 = [0, courtY + 0.024, -0.38];
    const star = slab(starPts(0.42, 0.42), 0.008);
    P.add(orient(star, o, [1, 0, 0], [0, 0, 1], [0, 1, 0]), lin(HEX.paper).scale(0.82));
    const ring = lathe(
      [
        [0.665, 0],
        [0.66, 0.008],
        [0.585, 0.008],
        [0.58, 0],
      ],
      24,
    );
    P.add(place(ring, { x: o[0], y: o[1] - 0.004, z: o[2] }), lin(HEX.paper).scale(0.82));
  }

  // ---- flag on the left tower (green with a cream star), tilting as damage grows
  {
    const tilt = [0, 0, 0.2, 0.55][stage];
    const baseX = -tx,
      baseZ = tz,
      baseY = 1.44;
    const poleH = 1.35;
    const tf = (vd: VertexData): VertexData => place(place(vd, { rz: -tilt }), { x: baseX, y: baseY, z: baseZ });
    P.add(
      tf(
        lathe(
          [
            [0.05, 0],
            [0.05, 0.05],
            [0.03, 0.07],
            [0.028, poleH],
            [0, poleH],
          ],
          8,
        ),
      ),
      dark,
    );
    const fin = lathe(
      [
        [0, 0],
        [0.04, 0.01],
        [0.055, 0.05],
        [0.04, 0.09],
        [0, 0.11],
      ],
      8,
    );
    B.add(tf(place(fin, { y: poleH - 0.01 })), woodCol);
    // Waving cloth: a 14 x 7 grid, z displacement grows away from the pole.
    const fw = 1.05,
      fh = 0.66,
      nx = 12,
      ny = 6,
      top = poleH - 0.06;
    // A stiff moulded pennant: the lower edge swept back toward -Z (the lane camera), so
    // the face tilts ~40 degrees upward and reads from the high camera.
    const lean = 0.85;
    const wave = (u: number): number => 0.09 * Math.pow(u, 1.1) * Math.sin(u * Math.PI * 2.2 + 0.6) + 0.03 * u;
    const pos: number[] = [],
      uv: number[] = [],
      ind: number[] = [],
      col: number[] = [];
    const g = lin(HEX.green),
      gd = lin(HEX.greenDark);
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const u = i / nx,
          v = j / ny;
        pos.push(0.03 + u * fw, top - fh + v * fh - u * 0.05 * (1 - v), wave(u) - lean * (1 - v) * fh);
        uv.push(u, v);
        const c = u < 0.08 ? gd : g;
        col.push(c.r, c.g, c.b, 1);
      }
    }
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i;
        ind.push(a, a + 1, a + nx + 2, a, a + nx + 2, a + nx + 1);
      }
    const flag = new VertexData();
    flag.positions = pos;
    flag.indices = ind;
    flag.uvs = uv;
    flag.colors = col;
    const nrm: number[] = [];
    VertexData.ComputeNormals(pos, ind, nrm);
    flag.normals = nrm;
    C.parts.push(tf(flag));
    // Stars on both faces, bent with the wave.
    for (const sd of [-1, 1]) {
      const st = slab(starPts(0.18, 0.45), 0.004);
      const p = st.positions!;
      const P2: number[] = [];
      for (let k = 0; k < p.length; k += 3) {
        const x = 0.03 + fw * 0.5 + p[k];
        const u = (x - 0.03) / fw;
        const yy = top - fh / 2 + p[k + 1] - u * 0.05 * 0.5;
        const v = (yy - (top - fh)) / fh;
        // Star sits on the tilted cloth: offset along the cloth normal (~(0, 0.65, -0.76)).
        const off = sd * 0.008 + p[k + 2];
        P2.push(x, yy - off * 0.65, wave(u) - lean * (1 - v) * fh + off * 0.76);
      }
      st.positions = P2;
      const cream = lin(HEX.paper);
      C.add(tf(st), cream);
      void sd;
    }
  }

  const plastic = mergeParts(P.parts);
  const wood = mergeParts(Wd.parts);
  yield;
  yield* bakeAO(plastic, occ, 0.6, 0.74, chunk);
  yield* bakeAO(wood, occ, 0.45, 0.55, chunk);
  const brass = mergeParts(B.parts);
  const cloth = mergeParts(C.parts);
  for (const vd of [plastic, wood, brass, cloth]) fixWinding(vd);
  return { plastic, wood, brass, cloth };
}

// ---------------------------------------------------------------- game API
export function createPlayerFort(scene: Scene, look: Look, opts: FortOptions): FortModel {
  const W = Math.max(6, Math.min(12.5, opts.width));
  const D = Math.max(2.4, opts.depth);
  const root = new TransformNode('playerFort', scene);
  const mPlastic = plasticMaterial(scene, null, {
    name: 'fortPlastic',
    clearcoat: 0.32,
    clearcoatRoughness: 0.16,
    roughness: 0.34,
  });
  const mWood = woodMaterial(scene, 'oakDark', { name: 'fortWood', textureScale: 1 });
  const mBrass = brassMaterial(scene, { name: 'fortBrass' });
  // Moulded soft-plastic pennant (a fabric weave aliases into stripes at game distance).
  const mCloth = plasticMaterial(scene, null, { name: 'fortFlag', backFaceCulling: false, roughness: 0.5 });
  mCloth.twoSidedLighting = true;
  const mats: PBRMaterial[] = [mPlastic, mWood, mBrass, mCloth];
  const flashable: PBRMaterial[] = [mPlastic, mWood, mCloth];
  const meshes: Mesh[] = [];
  const names = ['fortPlastic', 'fortWood', 'fortBrass', 'fortFlag'];
  names.forEach((n, i) => {
    const m = new Mesh(n, scene);
    m.material = mats[i];
    m.parent = root;
    m.isPickable = false;
    meshes.push(m);
  });
  const cache = new Map<number, StageData>();
  const run = (g: Generator<void, StageData, void>): StageData => {
    for (;;) {
      const r = g.next();
      if (r.done) return r.value;
    }
  };
  let current = -1;
  let disposed = false;
  // Background warm-up of stages 1-3: a little each frame (geometry, then AO in chunks),
  // starting a few frames after creation, so setDamage never builds on the hot path.
  let warmStage = 1;
  let warmGen: Generator<void, StageData, void> | null = null;
  let warmDelay = 3;
  const finishWarm = (): void => {
    if (warmObs) {
      scene.onBeforeRenderObservable.remove(warmObs);
      warmObs = null;
    }
    warmGen = null;
  };
  let warmObs: Observer<Scene> | null = scene.onBeforeRenderObservable.add(() => {
    if (warmDelay-- > 0) return;
    const t0 = performance.now();
    while (performance.now() - t0 < 4) {
      while (warmStage <= 3 && cache.has(warmStage)) warmStage++;
      if (warmStage > 3) {
        finishWarm();
        return;
      }
      if (!warmGen) warmGen = buildStage(W, D, warmStage, 400);
      const r = warmGen.next();
      if (r.done) {
        cache.set(warmStage, r.value);
        warmGen = null;
        warmStage++;
      }
    }
  });
  const get = (stage: number): StageData => {
    let data = cache.get(stage);
    if (!data) {
      if (warmGen && warmStage === stage) {
        data = run(warmGen);
        warmGen = null;
      } // finish the half-built one
      else data = run(buildStage(W, D, stage));
      cache.set(stage, data);
    }
    return data;
  };
  const apply = (stage: number): void => {
    if (stage === current || disposed) return;
    const data = get(stage);
    current = stage;
    [data.plastic, data.wood, data.brass, data.cloth].forEach((vd, i) => vd.applyToMesh(meshes[i], true));
  };
  apply(0);
  for (const m of meshes) look.addShadowCaster(m);
  look.receiveShadows(meshes[0]);
  look.receiveShadows(meshes[1]);
  const hot = lin('#fff1dc');
  return {
    root,
    hpBarAnchor: new Vector3(0, 1.9, D / 2 - 0.2),
    setFlash(k: number) {
      const v = Math.max(0, Math.min(1, k));
      for (const m of flashable) {
        m.emissiveColor.copyFrom(hot).scaleInPlace(v);
        m.emissiveIntensity = 1.4;
      }
    },
    setDamage(frac: number) {
      const f = Math.max(0, Math.min(1, frac));
      apply(f >= 0.75 ? 3 : f >= 0.5 ? 2 : f >= 0.25 ? 1 : 0);
    },
    prewarm() {
      for (let s = 1; s <= 3; s++) get(s);
      finishWarm();
    },
    dispose() {
      disposed = true;
      finishWarm();
      for (const m of meshes) m.dispose();
      // Never force-dispose textures: fortWood samples the look's SHARED procedural wood
      // textures (textureScale 1), which every other wood material uses too.
      for (const m of mats) m.dispose(false, false);
      root.dispose();
      cache.clear();
    },
  };
}

// ---------------------------------------------------------------- preview
export function preview(scene: Scene, look: Look, opts: PreviewOptions): PreviewResult {
  const root = new TransformNode('playerFortPreview', scene);
  const fort = createPlayerFort(scene, look, { width: 10.36, depth: 3 });
  fort.root.parent = root;
  if (opts.variant === 'damaged') fort.setDamage(0.6);
  if (opts.variant === 'ruined') fort.setDamage(0.9);
  return {
    root,
    update(time) {
      const ph = time % 2;
      fort.setFlash(ph < 0.25 ? 1 - ph / 0.25 : 0);
    },
    dispose() {
      fort.dispose();
      root.dispose();
    },
  };
}
