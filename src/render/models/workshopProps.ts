// Workshop props: the toymaker's odds and ends scattered on the maple workbench beside
// the World 3 cutting-mat lane. Six kinds, all thin-instanced, ten meshes in all (so the
// whole set is at most ten draw calls per pass however many props a level scatters):
//
//   gears        loose brass gears lying flat: one, a meshed pair, or a little stack
//   spring       coiled steel springs on their side (one, or two crossed)
//   jar          a glass jar of screws with a steel lid: upright, or tipped over with
//                screws spilled on the bench
//   screwdriver  screwdrivers with fluted plastic handles (instance colour) and steel shafts
//   key          brass wind-up keys lying flat (1-3)
//   toy          a half-built tin robot (lithographed tin, instance colour) with its head,
//                an arm and a few screws beside it, standing or lying on its back
//
// Colours are toy-bright but never army green or tan (handles and tin are red, blue,
// yellow, purple, orange, teal). Nothing moves: the kit is written once per level.
//
// The shared geometry helpers (tube, gearData) are exported for the workshop room, the
// turntable and the saw, which use the same moulding language.
//
// GAME API (scenery.ts):
//   const kit = createWorkshopPropKit(scene, look);  // when the workshop theme loads
//   kit.begin(); kit.add(kind, variant, x, z, yaw, scale, colorIndex); ... kit.commit();
//   kit.dispose();                                    // theme change (materials: 'workshop-props-*')
// Shadows: every mesh but the glass casts and receives.
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Look } from '../look/index.ts';
import {
  bakeVertexAO,
  brassMaterial,
  buildMesh,
  fixWinding,
  glassMaterial,
  lathe,
  lin,
  mergeParts,
  paint,
  paintedTinMaterial,
  place,
  plasticMaterial,
  roundedBox,
  tinMaterial,
} from '../look/index.ts';
import type { ModelInfo, PreviewOptions, PreviewResult } from '../look/model.ts';
import type { WorkshopPropKind } from '../fxLogic.ts';
import { WORKSHOP_KINDS, WORKSHOP_RADIUS, WORKSHOP_VARIANTS, writeTRS } from '../fxLogic.ts';

export const info: ModelInfo = {
  key: 'workshopProps',
  title: 'Workshop props (brass gears, springs, jar of screws, screwdrivers, wind-up keys, tin robot)',
  instanced: true,
  teams: false,
  side: 'neutral',
  height: 1.6,
  triangleBudget: 1800, // per kind-mesh
  gameZ: 20,
  variants: ['all', 'scatter', ...WORKSHOP_KINDS],
};

export const WORKSHOP_PROP_CAPACITY = 120;

export interface WorkshopPropKit {
  meshes: Mesh[];
  begin(): void;
  add(
    kind: WorkshopPropKind,
    variant: number,
    x: number,
    z: number,
    yaw: number,
    scale: number,
    colorIndex: number,
  ): void;
  commit(): void;
  dispose(): void;
}

// Handle and tin colours (sRGB): toy primaries, never green or tan.
const HANDLE = ['#d93a2f', '#2f6fd6', '#f2b630', '#8e4fc4', '#f07a24', '#1fa3b0'];
const TIN = ['#b5302a', '#2f5fae', '#d9862a', '#7a4bb0', '#1f8f9c', '#c23f6a'];

// ---------- shared geometry helpers ----------

type P3 = readonly [number, number, number];

// lathe() wants its profile bottom to top with the solid on its left, so the normals face
// out. This reverses a profile drawn the other way (by the sign of the area it closes with
// the axis); a flat profile (no area) is left as it is.
export function latheOut(profile: readonly (readonly [number, number])[], tessellation = 16): VertexData {
  const loop = [...profile, [0, profile[profile.length - 1][1]], [0, profile[0][1]]];
  let area = 0;
  for (let i = 0; i < loop.length; i++) {
    const [x0, y0] = loop[i];
    const [x1, y1] = loop[(i + 1) % loop.length];
    area += x0 * y1 - x1 * y0;
  }
  return lathe(area < 0 ? [...profile].reverse() : profile, tessellation);
}

// A round tube along a polyline (parallel-transported frame, smooth normals), radius per
// point (number or function of the point index), `sides` around, optional flat caps.
// UV: u around, v along the length (0..1).
export function tube(
  points: readonly P3[],
  radius: number | ((i: number) => number),
  sides = 8,
  caps = true,
): VertexData {
  const n = points.length;
  const rad = (i: number): number => (typeof radius === 'number' ? radius : radius(i));
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  // Tangents.
  const tan: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0],
      ty = b[1] - a[1],
      tz = b[2] - a[2];
    const l = Math.hypot(tx, ty, tz) || 1;
    tx /= l;
    ty /= l;
    tz /= l;
    tan.push([tx, ty, tz]);
  }
  // Initial normal: any vector perpendicular to the first tangent.
  const t0 = tan[0];
  let ux = Math.abs(t0[1]) < 0.9 ? 0 : 1,
    uy = Math.abs(t0[1]) < 0.9 ? 1 : 0,
    uz = 0;
  let d = ux * t0[0] + uy * t0[1] + uz * t0[2];
  ux -= t0[0] * d;
  uy -= t0[1] * d;
  uz -= t0[2] * d;
  let ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul;
  uy /= ul;
  uz /= ul;
  let len = 0;
  const along: number[] = [0];
  for (let i = 1; i < n; i++) {
    len += Math.hypot(
      points[i][0] - points[i - 1][0],
      points[i][1] - points[i - 1][1],
      points[i][2] - points[i - 1][2],
    );
    along.push(len);
  }
  for (let i = 0; i < n; i++) {
    const [tx, ty, tz] = tan[i];
    // Transport u: remove its tangent component.
    d = ux * tx + uy * ty + uz * tz;
    ux -= tx * d;
    uy -= ty * d;
    uz -= tz * d;
    ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul;
    uy /= ul;
    uz /= ul;
    const vx = ty * uz - tz * uy,
      vy = tz * ux - tx * uz,
      vz = tx * uy - ty * ux;
    const r = rad(i);
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const c = Math.cos(a),
        sn = Math.sin(a);
      const nx = ux * c + vx * sn,
        ny = uy * c + vy * sn,
        nz = uz * c + vz * sn;
      pos.push(points[i][0] + nx * r, points[i][1] + ny * r, points[i][2] + nz * r);
      nrm.push(nx, ny, nz);
      uv.push(s / sides, len > 0 ? along[i] / len : 0);
    }
  }
  const ring = sides + 1;
  for (let i = 0; i < n - 1; i++)
    for (let s = 0; s < sides; s++) {
      const a = i * ring + s;
      const b = a + ring;
      idx.push(a, b, b + 1, a, b + 1, a + 1);
    }
  if (caps) {
    for (const end of [0, n - 1]) {
      const [tx, ty, tz] = tan[end];
      const sgn = end === 0 ? -1 : 1;
      const c = pos.length / 3;
      pos.push(points[end][0], points[end][1], points[end][2]);
      nrm.push(tx * sgn, ty * sgn, tz * sgn);
      uv.push(0.5, end === 0 ? 0 : 1);
      for (let s = 0; s <= sides; s++) {
        const k = (end * ring + s) * 3;
        pos.push(pos[k], pos[k + 1], pos[k + 2]);
        nrm.push(tx * sgn, ty * sgn, tz * sgn);
        uv.push(s / sides, end === 0 ? 0 : 1);
      }
      for (let s = 0; s < sides; s++) idx.push(c, c + 1 + s, c + 2 + s);
    }
  }
  const vd = new VertexData();
  vd.positions = pos;
  vd.normals = nrm;
  vd.uvs = uv;
  vd.indices = idx;
  return fixWinding(vd);
}

// A flat ring lying on the floor (y from 0 to `thick`) whose outer edge follows `outline`
// ([radius, angle] points, counter-clockwise from above) around a round hole of radius
// rHole: top and bottom faces, crisp outer walls (flat normals per edge), the hole's wall.
// Used for gears, saw blades and the turntable's toothed rim.
export function ringData(outline: readonly (readonly [number, number])[], thick: number, rHole: number): VertexData {
  const m = outline.length;
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  const v = (x: number, y: number, z: number, nx: number, ny: number, nz: number): number => {
    pos.push(x, y, z);
    nrm.push(nx, ny, nz);
    return pos.length / 3 - 1;
  };
  for (const [y, ny] of [
    [thick, 1],
    [0, -1],
  ] as const) {
    for (let k = 0; k < m; k++) {
      const [r0, a0] = outline[k];
      const [r1, a1] = outline[(k + 1) % m];
      const o0 = v(Math.cos(a0) * r0, y, Math.sin(a0) * r0, 0, ny, 0);
      const o1 = v(Math.cos(a1) * r1, y, Math.sin(a1) * r1, 0, ny, 0);
      const h1 = v(Math.cos(a1) * rHole, y, Math.sin(a1) * rHole, 0, ny, 0);
      const h0 = v(Math.cos(a0) * rHole, y, Math.sin(a0) * rHole, 0, ny, 0);
      idx.push(o0, o1, h1, o0, h1, h0);
    }
  }
  // Outer wall: one flat quad per outline edge.
  for (let k = 0; k < m; k++) {
    const [r0, a0] = outline[k];
    const [r1, a1] = outline[(k + 1) % m];
    const x0 = Math.cos(a0) * r0,
      z0 = Math.sin(a0) * r0,
      x1 = Math.cos(a1) * r1,
      z1 = Math.sin(a1) * r1;
    let nx = z1 - z0,
      nz = -(x1 - x0);
    const l = Math.hypot(nx, nz) || 1;
    nx /= l;
    nz /= l;
    // Point the normal away from the centre.
    if (nx * (x0 + x1) + nz * (z0 + z1) < 0) {
      nx = -nx;
      nz = -nz;
    }
    const a = v(x0, 0, z0, nx, 0, nz);
    const b = v(x1, 0, z1, nx, 0, nz);
    const c = v(x1, thick, z1, nx, 0, nz);
    const d = v(x0, thick, z0, nx, 0, nz);
    idx.push(a, b, c, a, c, d);
  }
  // Axle hole wall (normals inward).
  const hs = 16;
  for (let k = 0; k < hs; k++) {
    const a0 = (k / hs) * Math.PI * 2;
    const a1 = ((k + 1) / hs) * Math.PI * 2;
    const a = v(Math.cos(a0) * rHole, 0, Math.sin(a0) * rHole, -Math.cos(a0), 0, -Math.sin(a0));
    const b = v(Math.cos(a1) * rHole, 0, Math.sin(a1) * rHole, -Math.cos(a1), 0, -Math.sin(a1));
    const c = v(Math.cos(a1) * rHole, thick, Math.sin(a1) * rHole, -Math.cos(a1), 0, -Math.sin(a1));
    const d = v(Math.cos(a0) * rHole, thick, Math.sin(a0) * rHole, -Math.cos(a0), 0, -Math.sin(a0));
    idx.push(a, b, c, a, c, d);
  }
  const body = new VertexData();
  body.positions = pos;
  body.normals = nrm;
  body.indices = idx;
  fixWinding(body);
  return body;
}

// A flat spur gear lying on the floor (y from 0 to `thick`), `teeth` teeth between root
// radius rRoot and tip radius rTip, a round axle hole of radius rHole and a raised hub
// ring. Crisp machined edges (flat side normals per edge).
export function gearData(rTip: number, rRoot: number, teeth: number, thick: number, rHole: number): VertexData {
  const outline: [number, number][] = [];
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    outline.push([rRoot, a]);
    outline.push([rTip, a + step * 0.14]);
    outline.push([rTip, a + step * 0.36]);
    outline.push([rRoot, a + step * 0.5]);
    outline.push([rRoot, a + step * 0.75]);
  }
  const body = ringData(outline, thick, rHole);

  // Raised hub ring and a lighter turned groove ring between hub and teeth.
  const hub = latheOut(
    [
      [rHole, thick],
      [rHole, thick + thick * 0.45],
      [rHole + 0.02, thick + thick * 0.5],
      [rHole * 1.9 - 0.02, thick + thick * 0.5],
      [rHole * 1.9, thick + thick * 0.4],
      [rHole * 1.9, thick],
    ],
    20,
  );
  const groove = latheOut(
    [
      [rRoot * 0.72, thick],
      [rRoot * 0.72, thick + 0.012],
      [rRoot * 0.8, thick + 0.012],
      [rRoot * 0.8, thick],
    ],
    28,
  );
  return mergeParts([body, hub, groove]);
}

// Multiplies vertex colours by fn(position, normal) (creates white colours first).
function shadeBy(
  vd: VertexData,
  fn: (x: number, y: number, z: number, nx: number, ny: number, nz: number) => number,
): VertexData {
  const p = vd.positions!;
  const n = vd.normals!;
  const c = vd.colors ? Float32Array.from(vd.colors) : new Float32Array((p.length / 3) * 4).fill(1);
  for (let i = 0; i < p.length / 3; i++) {
    const k = fn(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], n[i * 3], n[i * 3 + 1], n[i * 3 + 2]);
    c[i * 4] *= k;
    c[i * 4 + 1] *= k;
    c[i * 4 + 2] *= k;
  }
  vd.colors = c;
  return vd;
}

// ---------- prop geometry (scale 1) ----------

const GEAR_R = 0.85;
function gearGeometry(): VertexData {
  return shadeBy(gearData(GEAR_R, GEAR_R * 0.84, 18, 0.12, 0.13), (_x, y) => (y < 0.02 ? 0.7 : 1));
}

// A coil spring on its side: axis along x, resting on the floor.
const SPRING_R = 0.24;
function springGeometry(): VertexData {
  const coils = 9;
  const len = 1.5;
  const pts: P3[] = [];
  const steps = coils * 14;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const a = u * coils * Math.PI * 2;
    pts.push([-len / 2 + u * len, SPRING_R + 0.035 + Math.cos(a) * SPRING_R, Math.sin(a) * SPRING_R]);
  }
  return shadeBy(paint(tube(pts, 0.035, 6, true), lin('#c4cad0')), (_x, y) => (y < 0.1 ? 0.72 : 1));
}

const JAR_H = 1.05;
const JAR_R = 0.42;
// Glass jar body (open top) and its contents (screw heap, steel lid with knurled band).
function jarGeometry(): [VertexData, VertexData] {
  const glass = latheOut(
    [
      [0, 0.0],
      [JAR_R - 0.06, 0],
      [JAR_R, 0.05],
      [JAR_R, JAR_H - 0.18],
      [JAR_R - 0.06, JAR_H - 0.1],
      [JAR_R - 0.07, JAR_H - 0.02],
    ],
    22,
  );
  paint(glass, lin('#dfe9ee'));
  const steel = lin('#b8bec4');
  const lid = paint(
    latheOut(
      [
        [0, JAR_H + 0.05],
        [JAR_R - 0.08, JAR_H + 0.05],
        [JAR_R - 0.03, JAR_H + 0.03],
        [JAR_R - 0.03, JAR_H - 0.09],
        [JAR_R - 0.06, JAR_H - 0.1],
      ],
      22,
    ),
    steel,
  );
  // A heap of screws: a lumpy mound inside, mottled steel and brass.
  const heap = latheOut(
    [
      [0, 0.62],
      [0.2, 0.58],
      [JAR_R - 0.07, 0.42],
      [JAR_R - 0.07, 0.04],
      [0, 0.04],
    ],
    18,
  );
  const hp = heap.positions as number[];
  for (let i = 0; i < hp.length; i += 3) {
    if (hp[i + 1] > 0.3) hp[i + 1] += Math.sin(hp[i] * 31) * Math.cos(hp[i + 2] * 27) * 0.04;
  }
  heap.positions = hp;
  const hn: number[] = [];
  VertexData.ComputeNormals(hp, heap.indices!, hn);
  heap.normals = hn;
  const hc = new Float32Array((hp.length / 3) * 4);
  for (let i = 0; i < hp.length / 3; i++) {
    const brassy = Math.sin(hp[i * 3] * 41 + hp[i * 3 + 2] * 37) > 0.55;
    const c = brassy ? lin('#c99a3a') : steel.scale(0.75 + 0.25 * Math.abs(Math.sin(hp[i * 3 + 2] * 53)));
    hc.set([c.r, c.g, c.b, 1], i * 4);
  }
  heap.colors = hc;
  return [glass, mergeParts([lid, heap])];
}

// A wood screw: pan head with a slot, threaded shank (lying on its side, axis x).
function screwGeometry(): VertexData {
  const steel = lin('#bcc2c8');
  const head = paint(
    place(
      latheOut(
        [
          [0, 0],
          [0.075, 0],
          [0.07, 0.035],
          [0, 0.05],
        ],
        10,
      ),
      { rz: -Math.PI / 2, x: -0.12, y: 0.075 },
    ),
    steel,
  );
  const pts: P3[] = [];
  for (let i = 0; i <= 10; i++) pts.push([-0.12 + i * 0.026, 0.075, 0]);
  const shank = paint(
    tube(pts, (i) => (i >= 9 ? 0.012 : 0.03), 6, true),
    steel.scale(0.85),
  );
  return mergeParts([head, shank]);
}

const SD_LEN = 2.1;
// Screwdriver lying along x: a fluted handle (its own mesh, instance colour) and the shaft.
function screwdriverGeometry(): [VertexData, VertexData] {
  const handle = latheOut(
    [
      [0, 0],
      [0.13, 0],
      [0.16, 0.06],
      [0.17, 0.5],
      [0.15, 0.68],
      [0.1, 0.74],
      [0.08, 0.8],
      [0, 0.8],
    ],
    12,
  );
  // Flutes: push the surface in at six grooves around.
  const p = handle.positions as number[];
  for (let i = 0; i < p.length; i += 3) {
    const a = Math.atan2(p[i + 2], p[i]);
    const r = Math.hypot(p[i], p[i + 2]);
    if (r < 0.05 || p[i + 1] < 0.05 || p[i + 1] > 0.7) continue;
    const k = 1 - 0.13 * Math.pow(Math.max(0, Math.cos(a * 6)), 4);
    p[i] *= k;
    p[i + 2] *= k;
  }
  handle.positions = p;
  const hn: number[] = [];
  VertexData.ComputeNormals(p, handle.indices!, hn);
  handle.normals = hn;
  shadeBy(handle, (_x, y) => (y < 0.06 ? 0.75 : y > 0.7 ? 0.85 : 1));
  // Lie it down: lathe axis +Y -> -X, raised so it rests on the floor.
  place(handle, { rz: Math.PI / 2, x: -SD_LEN / 2 + 0.8, y: 0.17 });
  const pts: P3[] = [
    [-SD_LEN / 2 + 0.78, 0.17, 0],
    [SD_LEN / 2 - 0.1, 0.17, 0],
    [SD_LEN / 2, 0.17, 0],
  ];
  const shaft = paint(
    tube(pts, (i) => (i === 2 ? 0.02 : 0.045), 8, true),
    lin('#c6ccd2'),
  );
  return [handle, shaft];
}

// A wind-up key lying flat: a butterfly bow of two loops, a collar and a square shaft.
function keyGeometry(): VertexData {
  const parts: VertexData[] = [];
  const y = 0.05;
  for (const s of [-1, 1]) {
    const pts: P3[] = [];
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      pts.push([s * (0.3 + Math.cos(a) * 0.24), y, Math.sin(a) * 0.17 - 0.32]);
    }
    parts.push(tube(pts, 0.05, 6, false));
  }
  parts.push(place(roundedBox(0.2, 0.1, 0.16, 0.04, 1), { y, z: -0.32 }));
  parts.push(
    place(
      latheOut(
        [
          [0, 0],
          [0.07, 0],
          [0.07, 0.12],
          [0.05, 0.14],
          [0, 0.14],
        ],
        10,
      ),
      { rx: Math.PI / 2, y, z: -0.24 },
    ),
  );
  parts.push(place(roundedBox(0.07, 0.07, 0.5, 0.015, 1), { y, z: 0.12 }));
  return shadeBy(mergeParts(parts), (_x, yy) => (yy < 0.02 ? 0.72 : 1));
}

// Half-built tin robot: body (instance colour lithographed tin) and its loose bits.
function toyGeometry(): [VertexData, VertexData] {
  const white = lin('#ffffff');
  const body: VertexData[] = [];
  body.push(paint(place(roundedBox(0.95, 0.85, 0.6, 0.12, 2), { y: 0.82 }), white));
  // Lithographed panel: lighter chest plate and darker belly band (multipliers).
  body.push(paint(place(roundedBox(0.6, 0.38, 0.05, 0.04, 1), { y: 0.92, z: 0.31 }), lin('#f2efe8')));
  body.push(paint(place(roundedBox(0.98, 0.1, 0.63, 0.04, 1), { y: 0.5 }), white.scale(0.55)));
  for (const s of [-1, 1]) {
    body.push(paint(place(roundedBox(0.26, 0.42, 0.32, 0.08, 1), { x: s * 0.24, y: 0.27 }), white.scale(0.8)));
    body.push(paint(place(roundedBox(0.32, 0.1, 0.42, 0.05, 1), { x: s * 0.24, y: 0.05, z: 0.04 }), white.scale(0.45)));
  }
  const b = shadeBy(mergeParts(body), (_x, y) => (y < 0.12 ? 0.75 : 1));
  // Loose bits: dome head with two round eyes, a brass key stub, an arm, a neck bolt.
  const tin = lin('#b9c0c6');
  const brass = lin('#d2a33f');
  const ink = lin('#2b2622');
  const bits: VertexData[] = [];
  const head = mergeParts([
    paint(roundedBox(0.55, 0.45, 0.48, 0.14, 2), tin),
    paint(
      place(
        latheOut(
          [
            [0, 0],
            [0.09, 0],
            [0.09, 0.04],
            [0, 0.05],
          ],
          10,
        ),
        { rx: Math.PI / 2, x: -0.12, y: 0.05, z: 0.23 },
      ),
      lin('#ffd36a'),
    ),
    paint(
      place(
        latheOut(
          [
            [0, 0],
            [0.09, 0],
            [0.09, 0.04],
            [0, 0.05],
          ],
          10,
        ),
        { rx: Math.PI / 2, x: 0.12, y: 0.05, z: 0.23 },
      ),
      lin('#ffd36a'),
    ),
    paint(place(roundedBox(0.26, 0.05, 0.03, 0.02, 1), { y: -0.1, z: 0.24 }), ink),
    paint(
      place(
        latheOut(
          [
            [0, 0],
            [0.03, 0],
            [0.03, 0.22],
            [0.06, 0.24],
            [0, 0.3],
          ],
          8,
        ),
        { y: 0.22 },
      ),
      tin,
    ),
  ]);
  bits.push(place(head, { rz: Math.PI / 2 - 0.15, x: 0.85, y: 0.27, z: 0.35, ry: 0.5 }));
  bits.push(
    paint(
      place(
        latheOut(
          [
            [0, 0],
            [0.06, 0],
            [0.06, 0.2],
            [0, 0.2],
          ],
          8,
        ),
        { rx: -Math.PI / 2, y: 0.82, z: -0.3 },
      ),
      brass,
    ),
  );
  for (const s of [-1, 1])
    bits.push(paint(place(roundedBox(0.36, 0.12, 0.05, 0.04, 1), { x: s * 0.1, y: 0.82, z: -0.52 }), brass));
  const arm: P3[] = [
    [-0.95, 0.09, 0.15],
    [-0.65, 0.09, 0.3],
    [-0.45, 0.09, 0.32],
  ];
  bits.push(paint(tube(arm, 0.08, 8, true), tin.scale(0.92)));
  bits.push(paint(place(roundedBox(0.18, 0.18, 0.18, 0.06, 1), { x: -1.0, y: 0.09, z: 0.14 }), ink.scale(1.3)));
  // Neck: an empty collar where the head belongs.
  bits.push(
    paint(
      place(
        latheOut(
          [
            [0.1, 0],
            [0.16, 0],
            [0.16, 0.08],
            [0.1, 0.08],
          ],
          12,
        ),
        { y: 1.24 },
      ),
      tin.scale(0.8),
    ),
  );
  return [b, mergeParts(bits)];
}

// ---------- the kit ----------

class Batch {
  readonly mesh: Mesh;
  readonly m: Float32Array;
  readonly c: Float32Array | null;
  count = 0;
  private readonly cap: number;

  constructor(mesh: Mesh, cap: number, colored: boolean) {
    this.mesh = mesh;
    this.cap = cap;
    this.m = new Float32Array(cap * 16);
    for (let i = 0; i < cap; i++) this.m[i * 16] = this.m[i * 16 + 5] = this.m[i * 16 + 10] = this.m[i * 16 + 15] = 1;
    this.c = colored ? new Float32Array(cap * 4).fill(1) : null;
    mesh.thinInstanceSetBuffer('matrix', this.m, 16, false);
    if (this.c) mesh.thinInstanceSetBuffer('color', this.c, 4, false);
    mesh.thinInstanceCount = 0;
    mesh.isVisible = false;
    mesh.doNotSyncBoundingInfo = true;
  }

  push(x: number, y: number, z: number, s: number, yaw: number, pitch: number, roll: number, c: Color3 | null): void {
    if (this.count >= this.cap) return;
    const i = this.count++;
    writeTRS(this.m, i * 16, x, y, z, s, s, s, yaw, pitch, roll);
    if (this.c && c) {
      this.c[i * 4] = c.r;
      this.c[i * 4 + 1] = c.g;
      this.c[i * 4 + 2] = c.b;
      this.c[i * 4 + 3] = 1;
    }
  }

  commit(): void {
    const m = this.mesh;
    m.thinInstanceCount = this.count;
    m.thinInstanceBufferUpdated('matrix');
    if (this.c) m.thinInstanceBufferUpdated('color');
    m.isVisible = this.count > 0;
    if (this.count > 0) m.thinInstanceRefreshBoundingInfo(false);
  }
}

interface Geometry {
  gear: VertexData;
  spring: VertexData;
  jar: [VertexData, VertexData];
  screw: VertexData;
  screwdriver: [VertexData, VertexData];
  key: VertexData;
  toy: [VertexData, VertexData];
}
let geometryCache: Geometry | null = null;
function geometry(): Geometry {
  geometryCache ??= {
    gear: gearGeometry(),
    spring: springGeometry(),
    jar: jarGeometry(),
    screw: screwGeometry(),
    screwdriver: screwdriverGeometry(),
    key: keyGeometry(),
    toy: (() => {
      const [b, bits] = toyGeometry();
      return [bakeVertexAO(b, { samples: 10, strength: 0.45, maxDist: 0.4 }), bits] as [VertexData, VertexData];
    })(),
  };
  return geometryCache;
}

function hash(x: number, z: number, k: number): number {
  const s = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

export function createWorkshopPropKit(scene: Scene, look: Look): WorkshopPropKit {
  const root = new TransformNode('workshopPropKit', scene);
  const mat = <T extends PBRMaterial>(key: string, make: () => T): T => look.material(`workshop-props-${key}`, make);
  const brass = mat('brass', () => brassMaterial(scene, { roughness: 0.32 }));
  const steel = mat('steel', () => tinMaterial(scene, null, { roughness: 0.3, metallic: 0.9 }));
  const glass = mat('glass', () => {
    const m = glassMaterial(scene, null, { alpha: 0.32, envIntensity: 1.6, roughness: 0.05 });
    m.useRadianceOverAlpha = true;
    m.useSpecularOverAlpha = true;
    return m;
  });
  const handle = mat('handle', () =>
    plasticMaterial(scene, null, { instanceColor: true, roughness: 0.28, clearcoat: 0.6, clearcoatRoughness: 0.1 }),
  );
  const tin = mat('tin', () => paintedTinMaterial(scene, null, { instanceColor: true }));

  const g = geometry();
  const C = WORKSHOP_PROP_CAPACITY;
  const mk = (name: string, vd: VertexData, m: PBRMaterial, per: number, colored: boolean, cast: boolean): Batch => {
    const mesh = buildMesh(scene, `workshopProp-${name}`, vd, m);
    mesh.parent = root;
    if (cast) look.addShadowCaster(mesh);
    look.receiveShadows(mesh);
    return new Batch(mesh, C * per, colored);
  };
  const b = {
    gear: mk('gear', g.gear, brass, 4, false, true),
    spring: mk('spring', g.spring, steel, 2, false, true),
    jar: mk('jar', g.jar[0], glass, 1, false, false),
    jarFill: mk('jarFill', g.jar[1], steel, 1, false, true),
    screw: mk('screw', g.screw, steel, 6, false, true),
    handle: mk('handle', g.screwdriver[0], handle, 2, true, true),
    shaft: mk('shaft', g.screwdriver[1], steel, 2, false, true),
    key: mk('key', g.key, brass, 3, false, true),
    toy: mk('toy', g.toy[0], tin, 1, true, true),
    toyBits: mk('toyBits', g.toy[1], steel, 1, false, true),
  };
  b.jar.mesh.alphaIndex = 1;
  const batches = Object.values(b);
  const col = new Color3();
  const pick = (list: readonly string[], i: number): Color3 =>
    col.copyFrom(lin(list[((i % list.length) + list.length) % list.length]));

  // Writes an instance at a local offset (ox, oz) from the prop's pivot, turned by yaw.
  let px = 0,
    pz = 0,
    pyaw = 0,
    ps = 1;
  const put = (
    batch: Batch,
    ox: number,
    oy: number,
    oz: number,
    s: number,
    yaw: number,
    pitch: number,
    roll: number,
    c: Color3 | null,
  ): void => {
    const cy = Math.cos(pyaw);
    const sy = Math.sin(pyaw);
    batch.push(
      px + (ox * cy + oz * sy) * ps,
      oy * ps,
      pz + (-ox * sy + oz * cy) * ps,
      s * ps,
      pyaw + yaw,
      pitch,
      roll,
      c,
    );
  };

  const kit: WorkshopPropKit = {
    meshes: batches.map((x) => x.mesh),
    begin() {
      for (const x of batches) x.count = 0;
    },
    add(kind, variant, x, z, yaw, scale, colorIndex) {
      px = x;
      pz = z;
      pyaw = yaw;
      ps = scale;
      const v = Math.abs(Math.floor(variant)) % WORKSHOP_VARIANTS[kind];
      const ci = Math.floor(colorIndex);
      const h = (k: number): number => hash(x, z, k);
      switch (kind) {
        case 'gears':
          if (v === 0) put(b.gear, 0, 0, 0, 1, h(1), 0, 0, null);
          else if (v === 1) {
            put(b.gear, -0.35, 0, 0, 1, h(1), 0, 0, null);
            put(b.gear, 0.82, 0, 0.25, 0.6, h(2), 0, 0, null);
          } else {
            put(b.gear, 0, 0, 0, 1.05, h(1), 0, 0, null);
            put(b.gear, 0.08, 0.15, 0.05, 0.68, h(2), 0, 0, null);
            put(b.gear, 0.02, 0.27, -0.02, 0.42, h(3), 0, 0, null);
          }
          break;
        case 'spring':
          put(b.spring, 0, 0, 0, 1, 0, 0, 0, null);
          if (v === 1) put(b.spring, 0.1, 0.48, 0.05, 0.85, 1.1, 0, 0, null);
          break;
        case 'jar':
          if (v === 0) {
            put(b.jar, 0, 0, 0, 1, 0, 0, 0, null);
            put(b.jarFill, 0, 0, 0, 1, 0, 0, 0, null);
            put(b.screw, 0.75, 0, 0.2, 1.2, h(4) * 6, 0, 0, null);
          } else {
            // Tipped over: lying on its side, screws spilled out of the open mouth.
            put(b.jar, 0, JAR_R, 0, 1, 0, Math.PI / 2, 0, null);
            put(b.jarFill, 0, JAR_R, 0, 1, 0, Math.PI / 2, 0, null);
            for (let i = 0; i < 5; i++)
              put(b.screw, (h(i) - 0.5) * 0.9, 0, JAR_H + 0.2 + h(i + 7) * 0.7, 1.2, h(i + 3) * 6, 0, 0, null);
          }
          break;
        case 'screwdriver': {
          const n = v + 1;
          for (let i = 0; i < n; i++) {
            const ry = i === 0 ? 0 : 0.5 + h(5) * 0.4;
            const oz = i === 0 ? 0 : 0.35;
            put(b.handle, 0, i * 0.02, oz, 1, ry, 0, 0, pick(HANDLE, ci + i * 2));
            put(b.shaft, 0, i * 0.02, oz, 1, ry, 0, 0, null);
          }
          break;
        }
        case 'key': {
          const n = v + 1;
          for (let i = 0; i < n; i++)
            put(
              b.key,
              (i - (n - 1) / 2) * 0.62,
              i === 2 ? 0.06 : 0,
              (h(i) - 0.5) * 0.4,
              1,
              h(i + 2) * 2 - 1,
              0,
              0,
              null,
            );
          break;
        }
        case 'toy': {
          const c = pick(TIN, ci);
          if (v === 0) {
            put(b.toy, 0, 0, 0, 1, 0, 0, 0, c);
            put(b.toyBits, 0, 0, 0, 1, 0, 0, 0, null);
          } else {
            // Lying on its back with its bits beside it.
            put(b.toy, 0, 0.32, 0.6, 1, 0.3, -Math.PI / 2, 0, c);
            put(b.toyBits, 0.4, 0, -0.6, 1, 0.6, 0, 0, null);
          }
          put(b.gear, -0.9, 0, -0.7, 0.38, h(1), 0, 0, null);
          put(b.screw, 0.6, 0, -0.75, 1.2, h(2) * 6, 0, 0, null);
          put(b.screw, -0.3, 0, 0.85, 1.2, h(3) * 6, 0, 0, null);
          break;
        }
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
  (kit as WorkshopPropKit & { root: TransformNode }).root = root;
  return kit;
}

// ---------- preview ----------

export function preview(scene: Scene, look: Look, opts: PreviewOptions): PreviewResult {
  const kit = createWorkshopPropKit(scene, look) as WorkshopPropKit & { root: TransformNode };
  const oldTheme = look.theme;
  look.setTheme('workshop');
  kit.begin();
  if (opts.variant && (WORKSHOP_KINDS as readonly string[]).includes(opts.variant)) {
    const kind = opts.variant as WorkshopPropKind;
    const n = WORKSHOP_VARIANTS[kind];
    const step = WORKSHOP_RADIUS[kind] * 2.3;
    for (let i = 0; i < n; i++) kit.add(kind, i, (i - (n - 1) / 2) * step, 0, 0.35, 1, i);
  } else if (opts.variant === 'scatter') {
    let s = 4242;
    const rand = (): number => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < 60; i++) {
      const kind = WORKSHOP_KINDS[Math.floor(rand() * WORKSHOP_KINDS.length)];
      const side = i % 2 === 0 ? -1 : 1;
      kit.add(
        kind,
        Math.floor(rand() * 3),
        side * (7 + rand() * 12),
        -30 + rand() * 60,
        rand() * 6.28,
        0.9 + rand() * 0.2,
        i,
      );
    }
  } else {
    kit.add('toy', 0, 0, -0.5, 0.3, 1, 0);
    kit.add('gears', 2, -3.6, -2.4, 0.2, 1, 0);
    kit.add('gears', 1, 3.4, -2.6, 0.9, 1, 0);
    kit.add('jar', 0, -4.6, 1.2, 0, 1, 0);
    kit.add('jar', 1, 4.2, 1.4, 2.2, 1, 0);
    kit.add('screwdriver', 1, -1.2, 3.0, 0.3, 1, 1);
    kit.add('spring', 1, 2.0, 3.6, 1.2, 1, 0);
    kit.add('key', 2, -3.4, 4.6, 0.6, 1, 0);
    kit.add('key', 0, 1.2, -3.6, 1.6, 1, 0);
    kit.add('toy', 1, 5.4, -1.5, -0.4, 1, 3);
    kit.add('screwdriver', 0, -5.6, -4.4, 2.4, 1, 4);
    kit.add('spring', 0, 3.9, -5.0, 0.4, 1, 0);
  }
  kit.commit();
  return {
    root: kit.root,
    dispose() {
      kit.dispose();
      look.setTheme(oldTheme);
    },
  };
}
