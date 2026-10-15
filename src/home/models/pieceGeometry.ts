// Turns village pieces (src/home/villagePieces.ts) into bevelled toy geometry: rounded
// blocks, lathed logs, dowels, felt cones and balls, gable prisms, waving flags and stars,
// each painted in its colour (linear vertex colours, a little batch variation) and
// placed in its building's space. A whole building tier is baked together so the pieces
// darken each other where they meet (box AO from villageMath.ts), then grouped by material
// so the village draws as one merged mesh per material.
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { fixWinding, lathe, lin, mergeParts, place, roundedBox } from '../../render/look/index.ts';
import { boxAO, pieceAabb } from '../villageMath.ts';
import type { Piece, PieceMat } from '../villagePieces.ts';

// Shape at the anchor (bottom centre), before rotation and placement.
function shapeData(q: Piece): VertexData {
  const { w, h, d } = q;
  switch (q.shape) {
    case 'box': {
      const m = Math.min(w, h, d);
      const seg = m >= 0.1 && Math.max(w, h, d) >= 1.0 ? 2 : 1; // smoother bevels on big slabs only
      return place(roundedBox(w, h, d, Math.max(0.008, m * 0.12), seg), { y: h / 2 });
    }
    case 'plate':
      return place(roundedBox(w, h, d, 0, 1), { y: h / 2 });
    case 'log': {
      const r = h / 2;
      const prof: [number, number][] = [
        [0, 0],
        [r * 0.78, 0],
        [r, r * 0.3],
        [r, w - r * 0.3],
        [r * 0.78, w],
        [0, w],
      ];
      return place(place(lathe(prof, 10), { y: -w / 2 }), { rz: Math.PI / 2, y: r });
    }
    case 'cyl': {
      const r = w / 2;
      const b = Math.min(r * 0.25, h * 0.08);
      return lathe(
        [
          [0, 0],
          [r - b, 0],
          [r, b],
          [r, h - b],
          [r - b, h],
          [0, h],
        ],
        r > 0.2 ? 16 : r > 0.06 ? 12 : 8,
      );
    }
    case 'cone': {
      const r = w / 2;
      return lathe(
        [
          [0, 0],
          [r * 0.94, 0],
          [r, h * 0.05],
          [r * 0.16, h * 0.93],
          [0, h],
        ],
        14,
      );
    }
    case 'ball': {
      const prof: [number, number][] = [];
      const big = Math.max(w, h, d) >= 0.3;
      const rings = big ? 7 : 4;
      for (let i = 0; i <= rings; i++) {
        const a = -Math.PI / 2 + (i / rings) * Math.PI;
        prof.push([Math.cos(a) * 0.5, (Math.sin(a) + 1) * 0.5]);
      }
      prof[0][0] = 0;
      prof[rings][0] = 0;
      return place(lathe(prof, big ? 12 : 8), { sx: w, sy: h, sz: d });
    }
    case 'gable':
      return gable(w, h, d);
    case 'flag':
      return flag(w, h, d);
    case 'star':
      return star(w, d);
  }
}

// Triangular prism: base d along z, apex h, thickness w along x, flat-shaded.
function gable(w: number, h: number, d: number): VertexData {
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  const quad = (pts: number[][], n: number[]): void => {
    const b = pos.length / 3;
    for (const p of pts) {
      pos.push(p[0], p[1], p[2]);
      nrm.push(n[0], n[1], n[2]);
    }
    if (pts.length === 3) idx.push(b, b + 1, b + 2);
    else idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  const x = w / 2;
  const z = d / 2;
  quad(
    [
      [x, 0, -z],
      [x, 0, z],
      [x, h, 0],
    ],
    [1, 0, 0],
  );
  quad(
    [
      [-x, 0, -z],
      [-x, h, 0],
      [-x, 0, z],
    ],
    [-1, 0, 0],
  );
  const l = Math.hypot(h, z);
  quad(
    [
      [-x, 0, -z],
      [x, 0, -z],
      [x, h, 0],
      [-x, h, 0],
    ],
    [0, z / l, -h / l],
  );
  quad(
    [
      [-x, 0, z],
      [-x, h, 0],
      [x, h, 0],
      [x, 0, z],
    ],
    [0, z / l, h / l],
  );
  quad(
    [
      [-x, 0, -z],
      [-x, 0, z],
      [x, 0, z],
      [x, 0, -z],
    ],
    [0, -1, 0],
  );
  const vd = new VertexData();
  vd.positions = pos;
  vd.normals = nrm;
  vd.indices = idx;
  vd.uvs = new Float32Array((pos.length / 3) * 2);
  return fixWinding(vd);
}

// A cloth flag rippling out along +x from the pole: front and back sheets.
function flag(w: number, h: number, t: number): VertexData {
  const nx = 10;
  const ny = 3;
  const sheet = (side: 1 | -1): VertexData => {
    const pos: number[] = [];
    const uvs: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const u = i / nx;
        const v = j / ny;
        const wave = Math.sin(u * Math.PI * 1.7 + v * 0.6) * 0.09 * w * u;
        pos.push(u * w, v * h - u * 0.05 * h, wave + (side * t) / 2);
        uvs.push(u, v);
      }
    }
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i;
        const b = a + nx + 1;
        if (side > 0) idx.push(a, b, b + 1, a, b + 1, a + 1);
        else idx.push(a, b + 1, b, a, a + 1, b + 1);
      }
    }
    const vd = new VertexData();
    vd.positions = pos;
    vd.indices = idx;
    vd.uvs = uvs;
    const n: number[] = [];
    VertexData.ComputeNormals(pos, idx, n);
    vd.normals = n;
    return vd;
  };
  const front = sheet(-1);
  const back = sheet(1);
  // Make both sheets face outward whatever the builder's winding.
  for (const [vd, s] of [
    [front, -1],
    [back, 1],
  ] as const) {
    const n = vd.normals as number[];
    let sum = 0;
    for (let i = 2; i < n.length; i += 3) sum += n[i];
    if (Math.sign(sum) !== s) {
      for (let i = 0; i < n.length; i++) n[i] = -n[i];
    }
    fixWinding(vd);
  }
  return mergeParts([front, back]);
}

// Five-point star prism standing in the x-y plane (front -z), outer diameter w.
function star(w: number, t: number): VertexData {
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  const ro = w / 2;
  const ri = ro * 0.45;
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? ro : ri;
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    pts.push([Math.cos(a) * r, Math.sin(a) * r + ro]);
  }
  for (const s of [-1, 1]) {
    const b = pos.length / 3;
    pos.push(0, ro, (s * t) / 2);
    nrm.push(0, 0, s);
    for (const [x, y] of pts) {
      pos.push(x, y, (s * t) / 2);
      nrm.push(0, 0, s);
    }
    for (let i = 0; i < 10; i++) idx.push(b, b + 1 + i, b + 1 + ((i + 1) % 10));
  }
  for (let i = 0; i < 10; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % 10];
    const l = Math.hypot(y1 - y0, x0 - x1) || 1;
    const n = [(y1 - y0) / l, (x0 - x1) / l, 0];
    const b = pos.length / 3;
    pos.push(x0, y0, -t / 2, x1, y1, -t / 2, x1, y1, t / 2, x0, y0, t / 2);
    for (let k = 0; k < 4; k++) nrm.push(n[0], n[1], n[2]);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const vd = new VertexData();
  vd.positions = pos;
  vd.normals = nrm;
  vd.indices = idx;
  vd.uvs = new Float32Array((pos.length / 3) * 2);
  return fixWinding(vd);
}

// Deterministic ±4% brightness per piece (moulding batches vary).
function shadeOf(i: number, seed: number): number {
  let h = Math.imul(i + 1, 2654435761) ^ Math.imul(seed + 7, 40503);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  return 0.96 + (((h ^ (h >>> 13)) >>> 0) / 4294967295) * 0.08;
}

// One piece placed in building space, painted (before AO).
export function pieceData(q: Piece, index = 0, seed = 0): VertexData {
  const vd = place(shapeData(q), { x: q.x, y: q.y, z: q.z, rx: q.rx, ry: q.ry, rz: q.rz });
  const c = lin(q.color).scale(shadeOf(index, seed));
  const n = (vd.positions?.length ?? 0) / 3;
  const col = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    col[i * 4] = c.r;
    col[i * 4 + 1] = c.g;
    col[i * 4 + 2] = c.b;
    col[i * 4 + 3] = 1;
  }
  vd.colors = col;
  if (!vd.uvs) vd.uvs = new Float32Array(n * 2);
  // Shapes map 0..1 per face: repeat the grain and weave so their scale stays the same on
  // a long slab as on a small block.
  const k = Math.max(1, Math.max(q.w, q.h, q.d) / 0.8);
  if (k > 1) {
    const uv = vd.uvs;
    for (let i = 0; i < uv.length; i++) uv[i] *= k;
  }
  return vd;
}

// Bakes AO over a whole set of pieces (they shade each other), returning one painted
// VertexData per piece, same order.
export function bakePieces(pieces: readonly Piece[], seed = 0): VertexData[] {
  const parts = pieces.map((q, i) => pieceData(q, i, seed));
  const boxes = pieces.map(pieceAabb);
  for (let i = 0; i < parts.length; i++) {
    const vd = parts[i];
    const pos = vd.positions as ArrayLike<number>;
    const nrm = vd.normals as ArrayLike<number>;
    const owner = new Uint16Array(pos.length / 3).fill(i);
    const ao = boxAO(pos, nrm, owner, boxes, { samples: 10, maxDist: 0.5, strength: 0.62 });
    const col = vd.colors as Float32Array;
    for (let v = 0; v < ao.length; v++) {
      col[v * 4] *= ao[v];
      col[v * 4 + 1] *= ao[v];
      col[v * 4 + 2] *= ao[v];
    }
  }
  return parts;
}

// Clones a baked piece (merging mutates its inputs' attribute arrays).
export function cloneData(vd: VertexData): VertexData {
  const c = new VertexData();
  c.positions = Array.from(vd.positions ?? []);
  c.normals = Array.from(vd.normals ?? []);
  c.indices = Array.from(vd.indices ?? []);
  if (vd.uvs) c.uvs = Array.from(vd.uvs);
  if (vd.colors) c.colors = Array.from(vd.colors);
  return c;
}

// Groups baked pieces by material and merges each group (pieces moved by dx, dz).
export function mergeByMaterial(
  items: readonly { piece: Piece; data: VertexData; dx: number; dz: number }[],
): Map<PieceMat, VertexData> {
  const groups = new Map<PieceMat, VertexData[]>();
  for (const it of items) {
    const vd = place(cloneData(it.data), { x: it.dx, z: it.dz });
    const list = groups.get(it.piece.mat) ?? [];
    list.push(vd);
    groups.set(it.piece.mat, list);
  }
  const out = new Map<PieceMat, VertexData>();
  for (const [mat, list] of groups) out.set(mat, mergeParts(list));
  return out;
}
