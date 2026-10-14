// Enemy fort: the tan army's moulded plastic toy fort at the far end of the lane. Same
// playset family as the green player fort, but a different shape so it never reads as a
// recoloured copy: square crenellated corner towers with corbelled tops and cross-shaped
// arrow loops, a projecting gatehouse with a big arched gate (oak doors behind a dark
// portcullis), a taller central keep carrying a high tan flag with a dark crossed-sabres
// shield, small pennants on the towers, and two rows of sandbags along the front.
// Built procedurally so its width follows level.enemyBase.width (clamped to 4..8).
//
// Layout (local units, pivot at the ground centre of the footprint, front = +Z):
//   - moulded plinth over the whole footprint (width x depth), tanDark
//   - square towers at the front corners (merlon tops 3.12), curtain walls between the
//     towers and the gatehouse (merlon tops ~2.1), low side and rear walls
//   - gatehouse (merlons 2.62) with the arched gate on the +Z face; keep behind it (merlons
//     3.32), flag pole on the keep to 4.15
//   - sandbag ridges along the front edge either side of the gate
// The front faces the camera in game (side 'enemy': integration turns the root by PI).
//
// Draw calls: 4 meshes: plastic (tan, vertex colours with baked AO), wood (gate doors,
// hatches, crates), flag cloth (flag, emblem, pennants; two-sided) and a faint contact
// blob (the shared blob material from look/blobShadow.ts).
//
// GAME API
//   const fort = createEnemyFort(scene, look, { width: level.enemyBase.width, depth: LAYOUT.enemyBaseDepth });
//   fort.root.position.set(enemyBaseX, 0, lane.length + depth / 2);
//   fort.root.rotation.y = Math.PI;                       // front (+Z) faces the camera
//   fort.hpBarAnchor  local point (0, 3.0, depth/2 + 0.15): in front of and above the gate
//                     (world: Vector3.TransformCoordinates(anchor, fort.root.getWorldMatrix())).
//   fort.setFlash(k)  0..1 warm white hit flash (emissive on the fort's own materials).
//   fort.setDamage(f) 0..1 damage taken; visual stages at 0.25 / 0.5 / 0.75: merlons
//                     knocked off and lying as rubble, cracks, sandbags spilled, the flag
//                     leaning, a tower top broken. Rebuilds geometry only when the stage
//                     changes; each stage is cached after its first use (~20-40 ms build).
//   fort.dispose()    disposes the meshes and the fort's own materials.
// Shadows: plastic, wood and flag cast (static); plastic and wood receive. The blob is a
// faint contact darkening under the footprint on every tier.
import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type { Look } from '../look/index.ts';
import {
  HEX,
  createBlobShadowMesh,
  fabricMaterial,
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
  key: 'enemyFort',
  title: 'Enemy fort (tan plastic)',
  instanced: false,
  teams: false,
  side: 'enemy',
  height: 4.1,
  triangleBudget: 8000,
  gameZ: 57,
  variants: ['intact', 'damaged'],
};

export interface EnemyFortOptions {
  width: number; // 4..8 (level.enemyBase.width, usually 6)
  depth: number; // 4 (LAYOUT.enemyBaseDepth)
}

export interface FortModel {
  root: TransformNode;
  hpBarAnchor: Vector3;
  setFlash(k: number): void;
  setDamage(frac: number): void;
  dispose(): void;
}

// ---------------------------------------------------------------- geometry kit
type V3 = [number, number, number];

function hash(i: number, salt: number): number {
  const s = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

// Flat-shaded polygon soup. Polygons are fanned from their first point (fine for convex
// shapes and for the arch spandrels, which are star-shaped from their corner).
class Soup {
  pos: number[] = [];
  nrm: number[] = [];
  ind: number[] = [];
  // Outward normal: from Newell's method, flipped to point away from `centre`.
  poly(pts: readonly V3[], centre: V3): void {
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
    this.polyN(pts, [nx, ny, nz]);
  }
  polyN(pts: readonly V3[], nrm: V3): void {
    const base = this.pos.length / 3;
    for (const p of pts) {
      this.pos.push(p[0], p[1], p[2]);
      this.nrm.push(nrm[0], nrm[1], nrm[2]);
    }
    for (let i = 1; i < pts.length - 1; i++) this.ind.push(base, base + i, base + i + 1);
  }
  vd(): VertexData {
    const vd = new VertexData();
    vd.positions = this.pos;
    vd.normals = this.nrm;
    vd.indices = this.ind;
    return fixWinding(vd);
  }
}

// Box centred on the origin with a hipped bevel on its top edges (18 triangles, no bottom):
// moulded merlons. c = 0 gives a plain 5-sided box (10 triangles) for tiny details.
function mbox(w: number, h: number, d: number, c: number): VertexData {
  const W = w / 2,
    H = h / 2,
    Dd = d / 2;
  const cc = Math.min(c, W * 0.8, Dd * 0.8, h * 0.8);
  const s = new Soup();
  const O: V3 = [0, 0, 0];
  const yb = -H,
    ys = H - cc,
    yt = H;
  const iw = W - cc,
    id = Dd - cc;
  s.poly(
    [
      [-iw, yt, -id],
      [iw, yt, -id],
      [iw, yt, id],
      [-iw, yt, id],
    ],
    O,
  );
  if (cc <= 1e-5) {
    const q: [number, number][] = [
      [-W, -Dd],
      [W, -Dd],
      [W, Dd],
      [-W, Dd],
    ];
    for (let i = 0; i < 4; i++) {
      const a = q[i],
        b = q[(i + 1) % 4];
      s.poly(
        [
          [a[0], yb, a[1]],
          [b[0], yb, b[1]],
          [b[0], yt, b[1]],
          [a[0], yt, a[1]],
        ],
        O,
      );
    }
    return s.vd();
  }
  // Straight sides up to the bevel, then a frustum (hipped bevel) to the top face.
  const out: [number, number][] = [
    [-W, -Dd],
    [W, -Dd],
    [W, Dd],
    [-W, Dd],
  ];
  const inn: [number, number][] = [
    [-iw, -id],
    [iw, -id],
    [iw, id],
    [-iw, id],
  ];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const a = out[i],
      b = out[j];
    s.poly(
      [
        [a[0], yb, a[1]],
        [b[0], yb, b[1]],
        [b[0], ys, b[1]],
        [a[0], ys, a[1]],
      ],
      O,
    );
    s.poly(
      [
        [a[0], ys, a[1]],
        [b[0], ys, b[1]],
        [inn[j][0], yt, inn[j][1]],
        [inn[i][0], yt, inn[i][1]],
      ],
      O,
    );
  }
  return s.vd();
}

// Chamfered box centred on the origin (44 triangles; 40 without the bottom).
function cbox(w: number, h: number, d: number, c: number, bottom = false): VertexData {
  if (c <= 0 && !bottom) return mbox(w, h, d, 0);
  const H = [w / 2, h / 2, d / 2];
  const cc = Math.min(c, H[0] * 0.8, H[1] * 0.8, H[2] * 0.8);
  const I = [H[0] - cc, H[1] - cc, H[2] - cc];
  const s = new Soup();
  const O: V3 = [0, 0, 0];
  const pt = (a: number, va: number, b: number, vb: number, k: number, vk: number): V3 => {
    const p: V3 = [0, 0, 0];
    p[a] = va;
    p[b] = vb;
    p[k] = vk;
    return p;
  };
  for (let f = 0; f < 3; f++) {
    const u = (f + 1) % 3,
      v = (f + 2) % 3;
    for (const sg of [-1, 1]) {
      if (!bottom && f === 1 && sg < 0) continue;
      s.poly(
        [
          pt(f, sg * H[f], u, -I[u], v, -I[v]),
          pt(f, sg * H[f], u, I[u], v, -I[v]),
          pt(f, sg * H[f], u, I[u], v, I[v]),
          pt(f, sg * H[f], u, -I[u], v, I[v]),
        ],
        O,
      );
    }
  }
  for (let a = 0; a < 3; a++) {
    for (let b = a + 1; b < 3; b++) {
      const k = 3 - a - b;
      for (const sa of [-1, 1])
        for (const sb of [-1, 1]) {
          if (!bottom && ((a === 1 && sa < 0) || (b === 1 && sb < 0))) continue;
          s.poly(
            [
              pt(a, sa * H[a], b, sb * I[b], k, -I[k]),
              pt(a, sa * H[a], b, sb * I[b], k, I[k]),
              pt(a, sa * I[a], b, sb * H[b], k, I[k]),
              pt(a, sa * I[a], b, sb * H[b], k, -I[k]),
            ],
            O,
          );
        }
    }
  }
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) {
        if (!bottom && sy < 0) continue;
        s.poly(
          [
            [sx * H[0], sy * I[1], sz * I[2]],
            [sx * I[0], sy * H[1], sz * I[2]],
            [sx * I[0], sy * I[1], sz * H[2]],
          ],
          O,
        );
      }
  return s.vd();
}

// A raised moulded tile in its own frame: x across, y up the face, z out of the face
// (base at z = 0, chamfered top at z = h). Open at the back and underneath. 8 triangles.
function tile(w: number, hgt: number, h: number, c: number): VertexData {
  const s = new Soup();
  const W = w / 2,
    Hh = hgt / 2,
    iw = Math.max(0.002, W - c),
    ih = Math.max(0.002, Hh - c);
  const top: V3[] = [
    [-iw, -ih, h],
    [iw, -ih, h],
    [iw, ih, h],
    [-iw, ih, h],
  ];
  const bot: V3[] = [
    [-W, -Hh, 0],
    [W, -Hh, 0],
    [W, Hh, 0],
    [-W, Hh, 0],
  ];
  const ctr: V3 = [0, 0, -0.5];
  s.poly(top, ctr);
  // The lower edge faces the floor; the camera is always above, so it is left out.
  for (let i = 1; i < 4; i++) {
    const j = (i + 1) % 4;
    s.poly([bot[i], bot[j], top[j], top[i]], ctr);
  }
  return s.vd();
}

// Extrudes a 2D outline (in XY, fanned from its first point) between z0 and z1.
function extrude(pts: readonly [number, number][], z0: number, z1: number, back = true): VertexData {
  const s = new Soup();
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i],
      b = pts[(i + 1) % pts.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  const ccw = area > 0;
  s.polyN(
    pts.map((p) => [p[0], p[1], z1] as V3),
    [0, 0, 1],
  );
  if (back)
    s.polyN(
      pts.map((p) => [p[0], p[1], z0] as V3),
      [0, 0, -1],
    );
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i],
      b = pts[(i + 1) % pts.length];
    const dx = b[0] - a[0],
      dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    const n: V3 = ccw ? [dy / l, -dx / l, 0] : [-dy / l, dx / l, 0];
    s.polyN(
      [
        [a[0], a[1], z0],
        [b[0], b[1], z0],
        [b[0], b[1], z1],
        [a[0], a[1], z1],
      ],
      n,
    );
  }
  return s.vd();
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
  return fixWinding(vd);
}

// Box-projected UVs for the wood mesh (grain along V = world y on vertical faces).
function boxUV(vd: VertexData, scale: number): VertexData {
  const p = vd.positions!,
    n = vd.normals!;
  const uv: number[] = [];
  for (let i = 0; i < p.length; i += 3) {
    const ax = Math.abs(n[i]),
      ay = Math.abs(n[i + 1]),
      az = Math.abs(n[i + 2]);
    if (ay >= ax && ay >= az) uv.push(p[i] * scale, p[i + 2] * scale);
    else if (ax >= az) uv.push(p[i + 2] * scale, p[i + 1] * scale);
    else uv.push(p[i] * scale, p[i + 1] * scale);
  }
  vd.uvs = uv;
  return vd;
}

// ---------------------------------------------------------------- vertex AO vs boxes
interface Box {
  min: V3;
  max: V3;
}

const AO_DIRS: number[] = (() => {
  const out: number[] = [];
  const n = 16;
  for (let k = 0; k < n; k++) {
    const u = (k + 0.5) / n;
    const r = Math.sqrt(u);
    const a = k * 2.399963;
    out.push(r * Math.cos(a), r * Math.sin(a), Math.sqrt(1 - u));
  }
  return out;
})();

function rayBox(b: Box, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): boolean {
  let t0 = 0,
    t1 = maxT;
  const org = [ox, oy, oz],
    dir = [dx, dy, dz];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(dir[a]) < 1e-9) {
      if (org[a] < b.min[a] || org[a] > b.max[a]) return false;
      continue;
    }
    let ta = (b.min[a] - org[a]) / dir[a],
      tb = (b.max[a] - org[a]) / dir[a];
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

function bakeAO(vd: VertexData, occ: readonly Box[], maxDist: number, strength: number): void {
  const p = vd.positions!,
    n = vd.normals!;
  const nv = p.length / 3;
  const col = vd.colors ? Float32Array.from(vd.colors) : new Float32Array(nv * 4).fill(1);
  const nd = AO_DIRS.length / 3;
  const near: Box[] = [];
  for (let v = 0; v < nv; v++) {
    const nx = n[v * 3],
      ny = n[v * 3 + 1],
      nz = n[v * 3 + 2];
    const ox = p[v * 3] + nx * 0.005,
      oy = p[v * 3 + 1] + ny * 0.005,
      oz = p[v * 3 + 2] + nz * 0.005;
    near.length = 0;
    for (const b of occ) {
      if (
        ox > b.min[0] - maxDist &&
        ox < b.max[0] + maxDist &&
        oy > b.min[1] - maxDist &&
        oy < b.max[1] + maxDist &&
        oz > b.min[2] - maxDist &&
        oz < b.max[2] + maxDist
      )
        near.push(b);
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
        if (rayBox(o, ox, oy, oz, dx, dy, dz, maxDist)) {
          hit++;
          break;
        }
    }
    const ao = 1 - strength * (hit / nd);
    col[v * 4] *= ao;
    col[v * 4 + 1] *= ao;
    col[v * 4 + 2] *= ao;
  }
  vd.colors = col;
}

// ---------------------------------------------------------------- the fort
export interface StageData {
  plastic: VertexData;
  wood: VertexData;
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

// Palette (linear). Only HEX tans plus the ink / oak keys for the dark parts.
function colours() {
  const tan = lin(HEX.tan),
    dark = lin(HEX.tanDark),
    light = lin(HEX.tanLight),
    ink = lin(HEX.ink);
  return {
    tan,
    dark,
    light,
    body: mix(tan, dark, 0.24), // mortar lines between the moulded stones
    trim: mix(dark, ink, 0.22), // darker base course: the fort separates from the oak floor
    slit: mix(ink, dark, 0.18),
    iron: mix(ink, dark, 0.3),
    emblem: mix(ink, dark, 0.25),
    stone: (seed: number) => mix(tan, light, 0.18 + 0.36 * hash(seed, 3)), // lighter faces over the dark base
    sand: (seed: number) => mix(light, tan, 0.25 + 0.35 * hash(seed, 5)),
    oak: lin(HEX.oakDark),
    oakLight: lin(HEX.oak),
    // Saturated tan-army flag (a deeper, warmer tan than the walls) with a dark hem.
    cloth: lin('#d89a3e'),
    clothDark: mix(lin('#d89a3e'), dark, 0.55),
  };
}

const SHIELD: [number, number][] = [
  [0, -0.5],
  [0.42, -0.2],
  [0.46, 0.38],
  [0, 0.5],
  [-0.46, 0.38],
  [-0.42, -0.2],
];

function buildStage(W: number, D: number, stage: number): StageData {
  const K = colours();
  const P = new Acc(),
    Wd = new Acc(),
    Cl = new Acc();
  const occ: Box[] = [];
  const hw = W / 2,
    hd = D / 2;
  const y0 = 0.16; // plinth top
  const solid = (min: V3, max: V3, c: Color3, cham = 0.03, occlude = true): void => {
    const w = max[0] - min[0],
      h = max[1] - min[1],
      d = max[2] - min[2];
    P.add(
      place(cbox(w, h, d, cham), { x: (min[0] + max[0]) / 2, y: (min[1] + max[1]) / 2, z: (min[2] + max[2]) / 2 }),
      c,
    );
    if (occlude) occ.push({ min, max });
  };

  // Damage bookkeeping: merlons knocked off become rubble; a broken tower loses its top.
  const pMerlon = [0, 0.22, 0.42, 0.62][stage];
  let merlonId = 0;
  const rubble: { x: number; z: number; s: number }[] = [];
  const merlon = (x: number, y: number, z: number, w: number, h: number, d: number, ry = 0): void => {
    const id = merlonId++;
    if (stage > 0 && hash(id, 11) < pMerlon) {
      // Falls forward off the wall onto the plinth / the rug in front.
      rubble.push({
        x: x + (hash(id, 2) - 0.5) * 0.5,
        z: Math.min(hd + 0.45, Math.max(z, 0) + 0.5 + hash(id, 4) * 0.6),
        s: Math.max(w, d),
      });
      return;
    }
    P.add(place(mbox(w, h, d, 0.04), { x, y: y + h / 2, z, ry }), K.tan);
  };

  // Moulded stones on a face: origin o (bottom-left), U across (length uLen), V up (vLen),
  // N out of the face. skip(u, v) leaves openings free.
  let stoneSeed = 0;
  const stones = (
    o: V3,
    U: V3,
    V: V3,
    N: V3,
    uLen: number,
    vLen: number,
    skip?: (u0: number, u1: number, v0: number, v1: number) => boolean,
    rowH = 0.27,
    sw = 0.48,
  ): void => {
    const gap = 0.035;
    const rows = Math.max(1, Math.round(vLen / rowH));
    const rh = vLen / rows;
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? sw / 2 : 0;
      let u = -off;
      while (u < uLen - 0.02) {
        const u0 = Math.max(0, u),
          u1 = Math.min(uLen, u + sw);
        u += sw;
        if (u1 - u0 < 0.1) continue;
        const v0 = r * rh,
          v1 = (r + 1) * rh;
        if (skip && skip(u0, u1, v0, v1)) continue;
        const seed = stoneSeed++;
        const t = tile(u1 - u0 - gap, rh - gap, 0.022 + 0.01 * hash(seed, 9), 0.014);
        const cu = (u0 + u1) / 2,
          cv = (v0 + v1) / 2;
        P.add(
          orient(
            t,
            [o[0] + U[0] * cu + V[0] * cv, o[1] + U[1] * cu + V[1] * cv, o[2] + U[2] * cu + V[2] * cv],
            U,
            V,
            N,
          ),
          K.stone(seed),
        );
      }
    }
  };
  const X: V3 = [1, 0, 0],
    Y: V3 = [0, 1, 0],
    Z: V3 = [0, 0, 1];

  // Cross-shaped arrow loop on a +Z face (centre x, y, face z).
  const loop = (x: number, y: number, z: number, s = 1): void => {
    P.add(place(cbox(0.075 * s, 0.4 * s, 0.03, 0), { x, y, z }), K.slit);
    P.add(place(cbox(0.22 * s, 0.07 * s, 0.03, 0), { x, y: y + 0.05 * s, z }), K.slit);
    // Light moulded surround.
    P.add(place(cbox(0.17 * s, 0.52 * s, 0.03, 0), { x, y, z: z - 0.008 }), K.light);
  };
  // Long crack on a +Z face (dark zigzag strip).
  const crack = (x: number, y: number, z: number, len: number, seed: number): void => {
    let cx = x,
      cy = y;
    const n = 4;
    for (let i = 0; i < n; i++) {
      const a = -1.2 + (hash(seed + i, 21) - 0.5) * 1.4;
      const l = len / n;
      const nx = cx + Math.cos(a) * l,
        ny = cy + Math.sin(a) * l;
      P.add(place(cbox(l + 0.03, 0.035, 0.02, 0), { x: (cx + nx) / 2, y: (cy + ny) / 2, z, rz: a }), K.slit);
      cx = nx;
      cy = ny;
    }
  };

  // ---- plinth
  solid([-hw, 0, -hd], [hw, y0, hd], K.trim, 0.05);
  P.add(place(mbox(W - 0.14, 0.03, D - 0.14, 0.012), { y: y0 + 0.004 }), mix(K.tan, K.dark, 0.6));

  // ---- dimensions
  const T = Math.min(1.25, W * 0.21); // tower size
  const tx = hw - T / 2 - 0.06;
  const tz = hd - 0.42 - T / 2; // tower centre z (front at hd - 0.42)
  const towerFront = tz + T / 2;
  const gw = Math.min(0.98, tx - T / 2 - 0.08); // gatehouse half width
  const gFront = hd - 0.38; // gatehouse front face
  const gBack = 0.05;
  const gH = 2.3; // gatehouse wall top
  const cFront = towerFront - 0.22; // curtain wall front face
  const cBack = cFront - 0.42;
  const cH = 1.75; // curtain wall top
  const kHalf = Math.min(1.12, tx - T / 2 + 0.05);
  const kFront = gBack + 0.02,
    kBack = -hd + 0.55;
  const kH = 2.95; // keep wall top
  const sideH = 1.45;
  const ga = 0.5; // gate half width (arch radius)
  const gSpring = y0 + 0.86; // arch springing line
  const gTop = gSpring + ga;

  // ---- towers (square, corbelled crenellated tops)
  const towerTop = (y: number, x: number, z: number, size: number): void => {
    const s2 = size + 0.18;
    P.add(place(cbox(s2, 0.16, s2, 0.03), { x, y: y + 0.08, z }), K.trim);
    for (let i = -1; i <= 1; i++)
      P.add(place(cbox(0.14, 0.16, 0.1, 0), { x: x + i * size * 0.33, y: y - 0.08, z: z + size / 2 + 0.04 }), K.trim);
    const mw = 0.3,
      mh = 0.34,
      md = 0.16;
    const e = s2 / 2 - md / 2;
    const pos: [number, number, number][] = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) pos.push([x + sx * (s2 / 2 - mw / 2), z + sz * e, 0]);
    for (const sz of [-1, 1]) pos.push([x, z + sz * e, 0]);
    for (const sx of [-1, 1]) pos.push([x + sx * e, z, Math.PI / 2]);
    for (const [mx, mz, ry] of pos) merlon(mx, y + 0.16, mz, mw, mh, md, ry);
    // Low parapet between the merlons.
    for (const sz of [-1, 1])
      P.add(place(cbox(s2 - 0.04, 0.1, md - 0.02, 0), { x, y: y + 0.21, z: z + sz * e }), K.tan);
    for (const sx of [-1, 1])
      P.add(place(cbox(md - 0.02, 0.1, s2 - 0.04, 0), { x: x + sx * e, y: y + 0.21, z }), K.tan);
  };
  [-1, 1].forEach((side, ti) => {
    const x = side * tx;
    const broken = stage >= 3 && ti === 1; // the right tower loses its top
    const hb = broken ? 1.95 : 2.42;
    solid([x - T / 2, y0, tz - T / 2], [x + T / 2, y0 + hb, tz + T / 2], K.body, 0.04);
    // Stones on the front and the two side faces.
    const skipLoops = (u0: number, u1: number, v0: number, v1: number): boolean => {
      const c = T / 2;
      return u1 > c - 0.14 && u0 < c + 0.14 && ((v1 > 0.62 && v0 < 1.22) || (v1 > 1.5 && v0 < 2.1));
    };
    stones([x - T / 2, y0, towerFront], X, Y, Z, T, hb, skipLoops);
    stones([x + (side * T) / 2, y0, tz + (T / 2) * side], [0, 0, -side], Y, [side, 0, 0], T, hb);
    stones([x - (side * T) / 2, cH, tz - (T / 2) * side], [0, 0, side], Y, [-side, 0, 0], T, hb + y0 - cH);
    // Base batter (sloped skirt) and a mid string course.
    P.add(place(mbox(T + 0.12, 0.2, T + 0.12, 0.05), { x, y: y0 + 0.1, z: tz }), K.trim);
    P.add(place(mbox(T + 0.06, 0.07, T + 0.06, 0.02), { x, y: y0 + 1.36, z: tz }), K.trim);
    loop(x, y0 + 0.92, towerFront + 0.02);
    if (!broken) loop(x, y0 + 1.8, towerFront + 0.02);
    if (!broken) towerTop(y0 + hb, x, tz, T);
    else {
      // Jagged broken top: uneven stumps.
      for (let i = 0; i < 6; i++) {
        const hx = (hash(i, 31) - 0.5) * (T - 0.3),
          hz = (hash(i, 37) - 0.5) * (T - 0.3);
        const h = 0.12 + hash(i, 41) * 0.34;
        P.add(
          place(cbox(0.3 + hash(i, 43) * 0.2, h, 0.3, 0.04), {
            x: x + hx,
            y: y0 + hb + h / 2 - 0.04,
            z: tz + hz,
            ry: hash(i, 47),
          }),
          K.stone(i + 400),
        );
      }
      for (let i = 0; i < 5; i++)
        rubble.push({ x: x + (hash(i, 51) - 0.5) * 1.4, z: hd + 0.1 + hash(i, 53) * 0.4, s: 0.32 });
    }
    // Hatch on the tower top (wood) and a pennant pole.
    if (!broken) {
      Wd.add(place(mbox(0.36, 0.04, 0.36, 0.01), { x: x - side * 0.18, y: y0 + hb + 0.18, z: tz - 0.15 }), K.oak);
      P.add(
        place(
          lathe(
            [
              [0, 0],
              [0.07, 0],
              [0.07, 0.06],
              [0.03, 0.08],
              [0.025, 0.08],
              [0.025, 0.86],
              [0.05, 0.9],
              [0.0, 0.96],
            ],
            8,
          ),
          { x: x + side * 0.12, y: y0 + hb + 0.16, z: tz + 0.12 },
        ),
        K.trim,
      );
    }
  });

  // ---- curtain walls between the towers and the gatehouse
  for (const side of [-1, 1]) {
    const x0 = side < 0 ? -tx + T / 2 - 0.02 : gw - 0.02;
    const x1 = side < 0 ? -gw + 0.02 : tx - T / 2 + 0.02;
    if (x1 - x0 < 0.05) continue;
    solid([x0, y0, cBack], [x1, cH, cFront], K.body, 0.02);
    stones([x0, y0, cFront], X, Y, Z, x1 - x0, cH - y0);
    P.add(
      place(mbox(x1 - x0, 0.07, cFront - cBack + 0.08, 0.02), {
        x: (x0 + x1) / 2,
        y: cH + 0.035,
        z: (cFront + cBack) / 2,
      }),
      K.trim,
    );
    const len = x1 - x0;
    const n = Math.max(1, Math.round(len / 0.5));
    for (let i = 0; i < n; i++) merlon(x0 + (i + 0.5) * (len / n), cH + 0.07, cFront - 0.08, 0.28, 0.3, 0.17);
    // Wall walk planks behind the parapet.
    Wd.add(place(mbox(len, 0.04, 0.24, 0.01), { x: (x0 + x1) / 2, y: cH + 0.09, z: cBack + 0.14 }), K.oakLight);
  }

  // ---- side and rear walls
  const rearZ = -hd + 0.12;
  for (const side of [-1, 1]) {
    const x = side * (hw - 0.2);
    const z0 = rearZ,
      z1 = tz - T / 2 + 0.02;
    solid([x - 0.14, y0, z0], [x + 0.14, sideH, z1], K.body, 0.02);
    stones(
      [x + side * 0.14, y0, side > 0 ? z1 : z0],
      [0, 0, -side],
      Y,
      [side, 0, 0],
      z1 - z0,
      sideH - y0,
      undefined,
      0.3,
      0.6,
    );
    P.add(place(mbox(0.36, 0.07, z1 - z0, 0.02), { x, y: sideH + 0.035, z: (z0 + z1) / 2 }), K.trim);
    const n = Math.max(1, Math.round((z1 - z0) / 0.55));
    for (let i = 0; i < n; i++)
      merlon(x + side * 0.06, sideH + 0.07, z0 + (i + 0.5) * ((z1 - z0) / n), 0.27, 0.26, 0.15, Math.PI / 2);
  }
  {
    const x0 = -hw + 0.06,
      x1 = hw - 0.06;
    solid([x0, y0, rearZ - 0.16], [x1, sideH, rearZ + 0.14], K.body, 0.02);
    P.add(place(mbox(x1 - x0, 0.07, 0.38, 0.02), { y: sideH + 0.035, z: rearZ }), K.trim);
    const n = Math.max(2, Math.round((x1 - x0) / 0.7));
    for (let i = 0; i < n; i++) merlon(x0 + (i + 0.5) * ((x1 - x0) / n), sideH + 0.07, rearZ - 0.08, 0.27, 0.26, 0.15);
    // Square corner posts at the rear.
    for (const sx of [-1, 1]) {
      const xa = sx < 0 ? -hw : hw - 0.5;
      solid([xa, y0, rearZ - 0.2], [xa + 0.5, sideH + 0.3, rearZ + 0.3], K.tan, 0.04);
    }
  }

  // ---- keep (behind the gatehouse, taller)
  solid([-kHalf, y0, kBack], [kHalf, kH, kFront], K.body, 0.04);
  stones([-kHalf, gH + 0.05, kFront], X, Y, Z, 2 * kHalf, kH - gH - 0.05, (u0, u1, v0, v1) => {
    const ux = (u0 + u1) / 2 - kHalf;
    return Math.abs(Math.abs(ux) - 0.55) < 0.16 && v1 > 0.1 && v0 < 0.55;
  });
  for (const sx of [-1, 1])
    stones([sx * kHalf, sideH, sx > 0 ? kFront : kBack], [0, 0, -sx], Y, [sx, 0, 0], kFront - kBack, kH - sideH);
  for (const sx of [-1, 1]) {
    // Arched windows on the keep face above the gatehouse.
    const wx = sx * 0.55;
    const wy = gH + 0.12;
    P.add(
      orient(
        extrude(
          [
            [-0.08, 0],
            [0.08, 0],
            [0.08, 0.22],
            [0.056, 0.276],
            [0, 0.3],
            [-0.056, 0.276],
            [-0.08, 0.22],
          ],
          0,
          0.02,
          false,
        ),
        [wx, wy, kFront + 0.004],
        X,
        Y,
        Z,
      ),
      K.slit,
    );
    P.add(place(cbox(0.24, 0.05, 0.08, 0), { x: wx, y: wy - 0.02, z: kFront + 0.03 }), K.light);
  }
  {
    const s2x = 2 * kHalf + 0.2,
      s2z = kFront - kBack + 0.2,
      kz = (kFront + kBack) / 2;
    P.add(place(cbox(s2x, 0.16, s2z, 0.03), { y: kH + 0.08, z: kz }), K.trim);
    for (let i = 0; i < 5; i++)
      P.add(place(cbox(0.13, 0.15, 0.09, 0), { x: (i - 2) * (kHalf * 0.45), y: kH - 0.075, z: kFront + 0.04 }), K.trim);
    const mw = 0.3,
      mh = 0.36,
      md = 0.16;
    const nx = Math.max(3, Math.round(s2x / 0.48)),
      nz = Math.max(3, Math.round(s2z / 0.48));
    for (const sz of [-1, 1])
      for (let i = 0; i < nx; i++) {
        const x = -s2x / 2 + mw / 2 + i * ((s2x - mw) / (nx - 1));
        merlon(x, kH + 0.16, kz + sz * (s2z / 2 - md / 2), mw, mh, md);
      }
    for (const sx of [-1, 1])
      for (let i = 1; i < nz - 1; i++) {
        const z = kz - s2z / 2 + mw / 2 + i * ((s2z - mw) / (nz - 1));
        merlon(sx * (s2x / 2 - md / 2), kH + 0.16, z, mw, mh, md, Math.PI / 2);
      }
    for (const sz of [-1, 1])
      P.add(place(cbox(s2x - 0.04, 0.1, md - 0.02, 0), { y: kH + 0.21, z: kz + sz * (s2z / 2 - md / 2) }), K.tan);
    for (const sx of [-1, 1])
      P.add(place(cbox(md - 0.02, 0.1, s2z - 0.04, 0), { x: sx * (s2x / 2 - md / 2), y: kH + 0.21, z: kz }), K.tan);
    Wd.add(place(mbox(0.42, 0.04, 0.42, 0.01), { x: 0.45, y: kH + 0.18, z: kz + 0.2 }), K.oak);
  }

  // ---- gatehouse with the arched gate
  {
    const zf = gFront;
    // Piers and the block above the arch.
    solid([-gw, y0, gBack], [-ga, gH, zf], K.body, 0.03);
    solid([ga, y0, gBack], [gw, gH, zf], K.body, 0.03);
    solid([-ga - 0.02, gTop, gBack], [ga + 0.02, gH, zf], K.body, 0.0, true);
    // Spandrels between the arch and the opening's corners (front face to the doors).
    const doorZ = zf - 0.34;
    const arc = (from: number, to: number, r: number, n: number): [number, number][] => {
      const out: [number, number][] = [];
      for (let i = 0; i <= n; i++) {
        const a = from + ((to - from) * i) / n;
        out.push([Math.cos(a) * r, gSpring + Math.sin(a) * r]);
      }
      return out;
    };
    for (const sx of [-1, 1]) {
      const pts: [number, number][] = [[sx * ga, gTop + 0.001]];
      const a = arc(sx > 0 ? 0 : Math.PI, Math.PI / 2, ga, 6);
      pts.push(...a);
      P.add(place(extrude(pts, doorZ - 0.02, zf, false), {}), K.body);
    }
    // Arch ring of voussoirs with a keystone, jamb strips.
    const nv = 7;
    for (let i = 0; i < nv; i++) {
      const a0 = (i / nv) * Math.PI + 0.02,
        a1 = ((i + 1) / nv) * Math.PI - 0.02;
      const r0 = ga + 0.005,
        r1 = ga + (i === 3 ? 0.21 : 0.15);
      const q: [number, number][] = [
        [Math.cos(a0) * r0, gSpring + Math.sin(a0) * r0],
        [Math.cos(a0) * r1, gSpring + Math.sin(a0) * r1],
        [Math.cos(a1) * r1, gSpring + Math.sin(a1) * r1],
        [Math.cos(a1) * r0, gSpring + Math.sin(a1) * r0],
      ];
      P.add(extrude(q, zf - 0.01, zf + (i === 3 ? 0.07 : 0.045)), i === 3 ? K.light : K.stone(900 + i));
    }
    for (const sx of [-1, 1]) {
      for (let j = 0; j < 4; j++) {
        const h = (gSpring - y0) / 4;
        P.add(
          place(cbox(0.15, h - 0.03, 0.05, 0), { x: sx * (ga + 0.075), y: y0 + h * (j + 0.5), z: zf + 0.02 }),
          K.stone(950 + j + (sx > 0 ? 4 : 0)),
        );
      }
      // Tunnel jamb faces darker (shadowed passage).
      P.add(
        place(cbox(0.02, gSpring - y0, 0.34, 0), { x: sx * (ga - 0.01), y: (y0 + gSpring) / 2, z: zf - 0.17 }),
        mix(K.body, K.slit, 0.35),
      );
    }
    // Stones on the gatehouse front (piers and above the arch), sides.
    stones([-gw, y0, zf], X, Y, Z, gw * 2, gH - y0, (u0, u1, v0, v1) => {
      const x0 = u0 - gw,
        x1 = u1 - gw;
      const yb = v0 + y0;
      const yt = v1 + y0;
      if (x1 > -ga - 0.2 && x0 < ga + 0.2 && yb < gTop + 0.2) return true; // opening + arch ring
      return Math.abs((x0 + x1) / 2) < 0.4 && yt > gTop + 0.18 && yb < gTop + 0.72; // plaque
    });
    for (const sx of [-1, 1])
      stones([sx * gw, cH, sx > 0 ? zf : gBack], [0, 0, -sx], Y, [sx, 0, 0], zf - gBack, gH - cH);
    // Battered base, cap, merlons.
    for (const sx of [-1, 1])
      P.add(
        place(mbox(gw - ga + 0.08, 0.18, zf - gBack + 0.1, 0.05), {
          x: (sx * (gw + ga)) / 2 + sx * 0.04,
          y: y0 + 0.09,
          z: (zf + gBack) / 2,
        }),
        K.trim,
      );
    P.add(place(cbox(2 * gw + 0.16, 0.12, zf - gBack + 0.16, 0.03), { y: gH + 0.06, z: (zf + gBack) / 2 }), K.trim);
    for (let i = 0; i < 7; i++)
      P.add(place(cbox(0.12, 0.14, 0.09, 0), { x: (i - 3) * (gw / 3.3), y: gH - 0.07, z: zf + 0.04 }), K.trim);
    const nm = 5;
    for (let i = 0; i < nm; i++)
      merlon(-gw + 0.08 + 0.15 + i * ((2 * gw - 0.46) / (nm - 1)), gH + 0.12, zf + 0.0, 0.3, 0.34, 0.17);
    for (const sx of [-1, 1]) merlon(sx * (gw - 0.0), gH + 0.12, (zf + gBack) / 2 + 0.1, 0.3, 0.34, 0.17, Math.PI / 2);
    // Roof hatch and a little pyramid of cannonballs on the gatehouse roof.
    Wd.add(place(mbox(0.34, 0.04, 0.34, 0), { x: -0.45, y: gH + 0.14, z: (zf + gBack) / 2 - 0.05 }), K.oak);
    const ball = (bx: number, by: number, bz: number): void => {
      P.add(
        place(
          lathe(
            [
              [0, -1],
              [0.71, -0.71],
              [1, 0],
              [0.71, 0.71],
              [0, 1],
            ],
            6,
          ),
          { x: bx, y: by, z: bz, s: 0.075 },
        ),
        K.iron,
      );
    };
    const bz0 = (zf + gBack) / 2 + 0.05;
    for (const [bx, bz] of [
      [0.36, 0],
      [0.51, 0],
      [0.435, 0.13],
    ] as const)
      ball(bx, gH + 0.195, bz0 + bz);
    ball(0.435, gH + 0.31, bz0 + 0.045);
    // Emblem plaque above the gate: dark shield with light crossed sabres.
    const py = gTop + 0.45;
    P.add(
      orient(
        extrude(
          SHIELD.map(([x, y]) => [x * 0.62, y * 0.56] as [number, number]),
          0,
          0.04,
          false,
        ),
        [0, py, zf],
        X,
        Y,
        Z,
      ),
      K.emblem,
    );
    P.add(
      orient(
        extrude(
          SHIELD.map(([x, y]) => [x * 0.74, y * 0.68] as [number, number]),
          0,
          0.025,
          false,
        ),
        [0, py, zf],
        X,
        Y,
        Z,
      ),
      K.light,
    );
    for (const sx of [-1, 1])
      P.add(place(cbox(0.05, 0.4, 0.02, 0), { x: 0, y: py, z: zf + 0.05, rz: sx * 0.72 }), K.light);
    // Portcullis: dark iron-coloured grid, lowered two thirds; spiked bottom.
    const pz = zf - 0.12;
    const bottom = y0 + 0.36 + (stage >= 2 ? 0.12 : 0);
    const nb = 7;
    for (let i = 0; i < nb; i++) {
      const x = -ga + 0.07 + (i * (2 * ga - 0.14)) / (nb - 1);
      const top = gSpring + Math.sqrt(Math.max(0, ga * ga - x * x)) - 0.02;
      P.add(place(cbox(0.045, top - bottom, 0.045, 0), { x, y: (top + bottom) / 2, z: pz }), K.iron);
      P.add(
        place(
          lathe(
            [
              [0, 0],
              [0.032, 0.0],
              [0, -0.09],
            ],
            4,
          ),
          { x, y: bottom, z: pz },
        ),
        K.iron,
      );
    }
    for (let j = 0; j < 4; j++) {
      const y = bottom + 0.12 + j * 0.27;
      const half = y > gSpring ? Math.sqrt(Math.max(0, ga * ga - (y - gSpring) ** 2)) - 0.02 : ga - 0.02;
      if (half < 0.06) continue;
      P.add(place(cbox(half * 2, 0.04, 0.035, 0), { y, z: pz + 0.02 }), K.iron);
    }
    // Dark passage back wall, then the oak doors (planks with iron straps).
    P.add(
      place(
        extrude([[-ga, y0], [ga, y0], ...arc(0, Math.PI, ga, 10).slice(0, 11)], doorZ - 0.06, doorZ - 0.04, false),
        {},
      ),
      K.slit,
    );
    const np = 6;
    for (let i = 0; i < np; i++) {
      const x0 = -ga + (i * 2 * ga) / np,
        x1 = x0 + (2 * ga) / np;
      const xm = Math.max(Math.abs(x0), Math.abs(x1));
      const top = gSpring + Math.sqrt(Math.max(0, ga * ga - xm * xm)) - 0.01;
      const vd = place(mbox(x1 - x0 - 0.018, top - y0, 0.06, 0.012), { x: (x0 + x1) / 2, y: (top + y0) / 2, z: doorZ });
      Wd.add(vd, mix(K.oak, K.oakLight, hash(i, 61) * 0.5));
    }
    for (const y of [y0 + 0.2, y0 + 0.62])
      Wd.add(place(cbox(2 * ga - 0.06, 0.06, 0.02, 0), { y, z: doorZ + 0.035 }), K.iron);
    Wd.add(place(cbox(0.02, gSpring + 0.3 - y0, 0.02, 0), { y: (gSpring + 0.3 + y0) / 2, z: doorZ + 0.04 }), K.iron);
  }

  // ---- sandbag ridges along the front
  {
    const zs = hd - 0.2;
    let seed = 0;
    const bag = (x: number, y: number, z: number, ry: number, light = 0): void => {
      const s = seed++;
      // A plump pillow: a heavily chamfered box, slightly squashed and turned.
      const vd = cbox(0.4, 0.15, 0.25, 0.055);
      P.add(
        place(vd, { x, y, z, ry: ry + (hash(s, 71) - 0.5) * 0.2, rz: (hash(s, 73) - 0.5) * 0.12 }),
        mix(K.sand(s), K.light, light),
      );
    };
    const spill = stage >= 2;
    for (const side of [-1, 1]) {
      const x0 = ga + 0.32,
        x1 = hw - 0.12;
      const n0 = Math.max(1, Math.floor((x1 - x0) / 0.4));
      const step = (x1 - x0) / n0;
      for (let i = 0; i < n0; i++) {
        const x = side * (x0 + (i + 0.5) * step);
        bag(x, y0 + 0.075, zs, 0);
        bag(x + side * 0.04, y0 + 0.075, zs - 0.27, 0);
      }
      for (let i = 0; i < n0 - 1; i++) {
        if (spill && side > 0 && i === 1) continue;
        bag(side * (x0 + (i + 1) * step), y0 + 0.215, zs - 0.12, 0, 0.12);
      }
      occ.push({
        min: [Math.min(side * x0, side * x1), y0, zs - 0.4],
        max: [Math.max(side * x0, side * x1), y0 + 0.28, zs + 0.13],
      });
    }
    if (spill) {
      bag(ga + 1.0, 0.07, hd + 0.3, 0.9);
      bag(-ga - 1.6, 0.07, hd + 0.25, -0.5);
    }
  }

  // ---- courtyard clutter (seen from the top): crates and a barrel either side of the keep
  for (const side of [-1, 1]) {
    const cx = side * (kHalf + 0.42);
    if (Math.abs(cx) + 0.3 > hw - 0.34) continue;
    const cz = -0.6;
    Wd.add(
      place(mbox(0.36, 0.3, 0.36, 0.025), { x: cx, y: y0 + 0.15, z: cz, ry: side * 0.3 }),
      mix(K.oakLight, K.oak, 0.3),
    );
    Wd.add(
      place(mbox(0.28, 0.24, 0.28, 0.02), { x: cx + side * 0.06, y: y0 + 0.42, z: cz + 0.02, ry: side * 0.7 }),
      K.oakLight,
    );
    P.add(
      place(
        lathe(
          [
            [0, 0],
            [0.13, 0],
            [0.155, 0.12],
            [0.13, 0.26],
            [0, 0.26],
          ],
          8,
        ),
        { x: cx - side * 0.05, y: y0, z: cz - 0.5 },
      ),
      K.stone(990),
    );
  }

  // ---- damage dressing: rubble, cracks, more cracks
  rubble.forEach((r, i) => {
    const s = r.s * (0.55 + hash(i, 81) * 0.3);
    const onPlinth = r.z < hd - 0.05 && Math.abs(r.x) < hw - 0.05;
    const y = (onPlinth ? y0 : 0) + s * 0.3;
    P.add(
      place(mbox(s, s * 0.62, s * 0.8, 0.04), {
        x: r.x,
        y,
        z: r.z,
        ry: hash(i, 83) * 3,
        rz: (hash(i, 87) - 0.5) * 0.6,
        rx: (hash(i, 89) - 0.5) * 0.5,
      }),
      K.stone(600 + i),
    );
  });
  if (stage >= 1) {
    crack(-gw + 0.25, gTop + 0.35, gFront + 0.03, 0.5, 1);
    crack(-tx + 0.1, y0 + 1.5, towerFront + 0.035, 0.45, 5);
  }
  if (stage >= 2) {
    crack(gw - 0.2, y0 + 0.5, gFront + 0.035, 0.6, 9);
    crack(tx - 0.2, y0 + 0.6, towerFront + 0.035, 0.7, 13);
    crack(0.6, kH - 0.35, kFront + 0.035, 0.4, 17);
  }
  if (stage >= 3) {
    crack(-tx - 0.3, y0 + 0.4, towerFront + 0.035, 0.6, 21);
    crack(-0.2, gTop + 0.7, gFront + 0.035, 0.5, 25);
  }

  // ---- flag on the keep (pole in plastic, cloth in the flag mesh)
  const lean = [0, 0.05, 0.22, 0.48][stage];
  const poleBase: V3 = [-0.25, kH + 0.16, (kFront + kBack) / 2 - 0.15];
  const poleLen = 1.4;
  const poleMat = (p: V3): V3 => {
    // Leans toward +x (rz negative tips +y toward +x) by `lean`.
    const c = Math.cos(lean),
      s = Math.sin(lean);
    return [poleBase[0] + p[0] * c + p[1] * s, poleBase[1] - p[0] * s + p[1] * c, poleBase[2] + p[2]];
  };
  {
    const vd = lathe(
      [
        [0, 0],
        [0.11, 0],
        [0.11, 0.07],
        [0.06, 0.1],
        [0.04, 0.12],
        [0.035, 0.14],
        [0.035, poleLen],
        [0.06, poleLen + 0.02],
        [0.065, poleLen + 0.07],
        [0.04, poleLen + 0.115],
        [0, poleLen + 0.125],
      ],
      8,
    );
    const p = vd.positions!;
    const n = vd.normals!;
    const c = Math.cos(lean),
      s = Math.sin(lean);
    for (let i = 0; i < p.length; i += 3) {
      const q = poleMat([p[i], p[i + 1], p[i + 2]]);
      p[i] = q[0];
      p[i + 1] = q[1];
      p[i + 2] = q[2];
      const nx = n[i],
        ny = n[i + 1];
      n[i] = nx * c + ny * s;
      n[i + 1] = -nx * s + ny * c;
    }
    P.add(vd, K.dark);
    // Top ball finial lighter.
  }
  const flagL = stage >= 3 ? 0.95 : 1.22,
    flagH = 0.76;
  const wave = (u: number, v: number): number =>
    0.09 * Math.sin(u * 5.2 - 0.6 + v * 0.8) * Math.min(1, u / 0.35) + 0.02 * Math.sin(u * 11 + v * 3);
  const flagPoint = (u: number, v: number, off: number): V3 => {
    // u along the flag (from the pole), v down from the top edge.
    const z = wave(u, v);
    const droop = -0.06 * u * u;
    return poleMat([0.04 + u, poleLen - 0.04 - v + droop, z + off]);
  };
  const clothGrid = (
    L: number,
    H: number,
    nu: number,
    nv: number,
    at: (u: number, v: number, off: number) => V3,
    taper: boolean,
    colour: (u: number, v: number) => Color3,
  ): void => {
    const pos: number[] = [],
      ind: number[] = [],
      cols: number[] = [];
    for (let j = 0; j <= nv; j++)
      for (let i = 0; i <= nu; i++) {
        const u = (i / nu) * L;
        const vv = j / nv;
        const v = taper ? (vv - 0.5) * H * (1 - (u / L) * 0.94) + H / 2 : vv * H;
        const q = at(u, v, 0);
        pos.push(q[0], q[1], q[2]);
        const c = colour(u, v);
        cols.push(c.r, c.g, c.b, 1);
      }
    for (let j = 0; j < nv; j++)
      for (let i = 0; i < nu; i++) {
        const a = j * (nu + 1) + i;
        ind.push(a, a + 1, a + nu + 2, a, a + nu + 2, a + nu + 1);
      }
    const vd = new VertexData();
    vd.positions = pos;
    vd.indices = ind;
    vd.colors = cols;
    const nrm: number[] = [];
    VertexData.ComputeNormals(pos, ind, nrm);
    vd.normals = nrm;
    Cl.parts.push(vd);
  };
  // Main flag: tan with a darker hem band at the fly end and the hoist.
  clothGrid(flagL, flagH, 10, 4, flagPoint, false, (u, v) => {
    const hem = u > flagL - 0.07 || v < 0.035 || v > flagH - 0.035 || u < 0.05;
    return hem ? K.clothDark : mix(K.cloth, K.light, 0.15 * Math.sin(u * 6) ** 2);
  });
  // Emblem on both faces: dark shield with light crossed sabres, following the wave.
  const emblem = (side: number): void => {
    const cu = flagL * 0.48,
      cv = flagH * 0.5;
    const patch = (pts: [number, number][], off: number, c: Color3): void => {
      const pos: number[] = [],
        ind: number[] = [],
        cols: number[] = [];
      // Centre fan (shield outline is convex).
      const all: [number, number][] = [
        [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length],
        ...pts,
      ];
      for (const [x, y] of all) {
        const q = flagPoint(cu + x, cv - y, off * side);
        pos.push(q[0], q[1], q[2]);
        cols.push(c.r, c.g, c.b, 1);
      }
      for (let i = 1; i <= pts.length; i++) ind.push(0, i, (i % pts.length) + 1);
      const vd = new VertexData();
      vd.positions = pos;
      vd.indices = ind;
      vd.colors = cols;
      const nrm: number[] = [];
      VertexData.ComputeNormals(pos, ind, nrm);
      vd.normals = nrm;
      Cl.parts.push(vd);
    };
    const sh: [number, number][] = [];
    // Densify the shield outline so it bends with the cloth.
    for (let i = 0; i < SHIELD.length; i++) {
      const a = SHIELD[i],
        b = SHIELD[(i + 1) % SHIELD.length];
      for (let k = 0; k < 3; k++)
        sh.push([(a[0] + (b[0] - a[0]) * (k / 3)) * 0.42, (a[1] + (b[1] - a[1]) * (k / 3)) * 0.46]);
    }
    patch(sh, 0.012, K.emblem);
    for (const sx of [-1, 1]) {
      const a = sx * 0.72;
      const c = Math.cos(a),
        s = Math.sin(a);
      const rect: [number, number][] = [
        [-0.022, -0.17],
        [0.022, -0.17],
        [0.022, 0.17],
        [-0.022, 0.17],
      ].map(([x, y]) => [x * c - y * s, x * s + y * c] as [number, number]);
      patch(rect, 0.022 + (sx > 0 ? 0.004 : 0), K.light);
    }
  };
  emblem(1);
  emblem(-1);
  // Pennants on the towers.
  [-1, 1].forEach((side, ti) => {
    if (stage >= 3 && ti === 1) return;
    const base: V3 = [side * tx + side * 0.12, y0 + 2.42 + 0.16 + 0.82, tz + 0.12];
    clothGrid(
      0.46,
      0.24,
      6,
      2,
      (u, v) => [
        base[0] + 0.03 + u,
        base[1] - v + 0.02,
        base[2] + 0.06 * Math.sin(u * 7 - 0.4 + side) * Math.min(1, u / 0.15),
      ],
      true,
      (u) => (u < 0.06 ? K.clothDark : K.cloth),
    );
  });

  // ---- merge, bake AO
  const plastic = mergeParts(P.parts);
  bakeAO(plastic, occ, 0.5, 0.6);
  const wood = boxUV(mergeParts(Wd.parts), 2.2);
  bakeAO(wood, occ, 0.45, 0.5);
  const cloth = mergeParts(Cl.parts);
  for (const vd of [plastic, wood]) fixWinding(vd);
  return { plastic, wood, cloth };
}

// ---------------------------------------------------------------- game API
export function createEnemyFort(scene: Scene, look: Look, opts: EnemyFortOptions): FortModel {
  const W = Math.max(4, Math.min(8, opts.width));
  const D = Math.max(3, Math.min(5, opts.depth));
  const root = new TransformNode('enemyFort', scene);
  const mPlastic = plasticMaterial(scene, null, {
    name: 'enemyFortPlastic',
    clearcoat: 0.3,
    clearcoatRoughness: 0.2,
    roughness: 0.42,
  });
  const mWood = woodMaterial(scene, null, { name: 'enemyFortWood', textureScale: 1 });
  const mCloth = fabricMaterial(scene, null, { name: 'enemyFortFlag', backFaceCulling: false });
  mCloth.twoSidedLighting = true;
  mCloth.sheen.color = lin(HEX.tanLight);
  const mats: PBRMaterial[] = [mPlastic, mWood, mCloth];
  const meshes: Mesh[] = [];
  ['enemyFortPlastic', 'enemyFortWood', 'enemyFortFlag'].forEach((n, i) => {
    const m = new Mesh(n, scene);
    m.material = mats[i];
    m.parent = root;
    m.isPickable = false;
    meshes.push(m);
  });
  const blob = createBlobShadowMesh(scene, 'enemyFortBlob');
  blob.parent = root;
  blob.scaling.set(W * 1.45, 1, D * 1.5);
  blob.visibility = 1; // strong contact shadow: the goal pops off the floor
  const cache = new Map<number, StageData>();
  let current = -1;
  const apply = (stage: number): void => {
    if (stage === current) return;
    let data = cache.get(stage);
    if (!data) {
      data = buildStage(W, D, stage);
      cache.set(stage, data);
    }
    current = stage;
    [data.plastic, data.wood, data.cloth].forEach((vd, i) => vd.applyToMesh(meshes[i], true));
  };
  apply(0);
  for (const m of meshes) look.addShadowCaster(m);
  look.receiveShadows(meshes[0]);
  look.receiveShadows(meshes[1]);
  const hot = lin('#fff1dc');
  return {
    root,
    hpBarAnchor: new Vector3(0, 3.0, D / 2 + 0.15),
    setFlash(k: number) {
      const v = Math.max(0, Math.min(1, k));
      for (const m of mats) {
        m.emissiveColor.copyFrom(hot).scaleInPlace(v);
        m.emissiveIntensity = 1.4;
      }
    },
    setDamage(frac: number) {
      const f = Math.max(0, Math.min(1, frac));
      apply(f >= 0.75 ? 3 : f >= 0.5 ? 2 : f >= 0.25 ? 1 : 0);
    },
    dispose() {
      for (const m of meshes) m.dispose();
      blob.dispose(false, false); // the blob material is shared by the look's blob helper
      for (const m of mats) m.dispose(false, false); // never the look's shared procedural textures
      root.dispose();
      cache.clear();
    },
  };
}

// ---------------------------------------------------------------- preview
export function preview(scene: Scene, look: Look, opts: PreviewOptions): PreviewResult {
  const root = new TransformNode('enemyFortPreview', scene);
  const fort = createEnemyFort(scene, look, { width: 6, depth: 4 });
  fort.root.parent = root;
  if (opts.variant === 'damaged') fort.setDamage(0.6);
  if (opts.variant === 'ruined') fort.setDamage(0.9);
  if (opts.variant === 'light') fort.setDamage(0.3);
  return {
    root,
    dispose() {
      fort.dispose();
      root.dispose();
    },
  };
}

// Raw geometry of one damage stage (0..3), for tests and tools.
export function enemyFortGeometry(width: number, depth: number, stage: number): StageData {
  return buildStage(
    Math.max(4, Math.min(8, width)),
    Math.max(3, Math.min(5, depth)),
    Math.max(0, Math.min(3, Math.round(stage))),
  );
}
