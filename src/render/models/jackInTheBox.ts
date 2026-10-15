// The Jack-in-the-Box (World 3 boss, level 3-10): a big lithographed tin music box that
// IS the enemy base, with a spring-necked jester popping out of it. The box is printed
// royal blue with red frames, cream polka dots and a cream roundel with a red star on the
// front, brass corner posts and a red plinth; a brass crank with a red wooden knob turns
// on its right side and the printed lid hangs open on its back hinge. Out of the dark
// opening a coiled steel spring carries the jester: a harlequin smock (red and yellow
// halves with diamonds), a cream ruff, pompom buttons, white-gloved arms, a round cream
// face with a red nose, rosy cheeks and a wide grin, and a three-pointed red, yellow and
// teal cap with brass bells.
//
// Phases change the look (setStage): 0 fresh; 1 the lid is bent askew and the spring
// longer; 2 the paint is cracked to bare tin all over the box and the spring longer still.
//
// Draw calls (9, ~9k triangles): box, cracks (stage 2), lid, crank, spring, jester, two
// arms, blob. All but the blob share this model's own 'toy-mix'-style material, so the
// hit / phase flash only touches this toy; dispose() frees it.
//
// GAME API
//   createJackInTheBox(scene, look, { width, depth, boxHeight }): JackInTheBoxModel
//     width: level.enemyBase.width; depth: LAYOUT.enemyBaseDepth; boxHeight: box height
//     (~1.3). Pivot: the box's ground centre, front (the jester's face) +Z; side 'enemy'
//     (boss.ts turns root by PI so he faces the camera).
//   model.lid          TransformNode on the back top hinge: rotation.x 0 closed, LID_OPEN open.
//   model.crank        TransformNode on the right side: rotation.x turns the crank.
//   model.jester       TransformNode at the spring's top (the jester's hips): sway it.
//   model.armL / armR  shoulder nodes: rotation.z raises an arm (outward: armL negative, armR positive).
//   model.setSpring(h) spring length above the box top (h <= 0 tucks him into the box).
//   model.setStage(s)  0..2 phase look (lid bend, cracked paint); springRest(s) its spring.
//   model.setFlash(k)  0..1 warm flash on the whole toy.   model.setPop(s) jester scale.
//   model.hpBarAnchor  Vector3, root-local: the front top edge of the box.
//   model.boxHeight    the box's height.
//   model.dispose()
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Look } from '../look/index.ts';
import {
  MIX,
  bakeVertexAO,
  buildMesh,
  createBlobShadowMesh,
  fixWinding,
  lathe,
  lin,
  mergeParts,
  mixUv,
  mixedToyMaterial,
  paint,
  place,
  roundedBox,
} from '../look/index.ts';
import type { MixSlot } from '../look/index.ts';
import type { ModelInfo, PreviewOptions, PreviewResult } from '../look/model.ts';
import { mulberry32 } from '../fxLogic.ts';
import { sphereVD } from './champion.ts';
import { star } from './cannon.ts';
import { scaled, tube } from './soldier.ts';
import type { Ring, V3 } from './soldier.ts';

export const info: ModelInfo = {
  key: 'jackInTheBox',
  title: 'Boss: the Jack-in-the-Box',
  instanced: false,
  teams: false,
  side: 'enemy',
  height: 4.2,
  triangleBudget: 14000,
  gameZ: 57,
  variants: ['fresh', 'bent', 'cracked', 'ducked'],
};

export interface JackInTheBoxOptions {
  width: number;
  depth: number;
  boxHeight: number;
}

export interface JackInTheBoxModel {
  root: TransformNode;
  lid: TransformNode;
  crank: TransformNode;
  jester: TransformNode;
  armL: TransformNode;
  armR: TransformNode;
  hpBarAnchor: Vector3;
  boxHeight: number;
  setSpring(h: number): void;
  setStage(stage: number): void;
  setFlash(k: number): void;
  setPop(scale: number): void;
  dispose(): void;
}

export const LID_OPEN = -1.95; // rotation.x of the open lid (flopped back past upright)
export const ARM_REST = 0.35; // rotation.z magnitude of a hanging arm (a little out)
const SPRING_REST = [0.7, 0.95, 1.2] as const; // spring length per stage
export function springRest(stage: number): number {
  return SPRING_REST[Math.max(0, Math.min(2, Math.floor(stage)))];
}

const C = {
  blue: '#2e5aa8',
  blueDark: '#203f78',
  red: '#b5372f',
  redDark: '#84251f',
  cream: '#efe3c6',
  teal: '#2f7f86',
  brass: '#d2a33f',
  steel: '#c9ced4',
  inside: '#1a1716',
  yellow: '#f2b630',
  skin: '#f6e2cf',
  cheek: '#ef8f86',
  nose: '#d93a2f',
  ink: '#1d1d1f',
  glove: '#f7f3ea',
  crack: '#34302e',
  knob: '#c0392b',
};

function part(vd: VertexData, color: string, slot: MixSlot): VertexData {
  vd.uvs = null;
  paint(vd, lin(color));
  return mixUv(vd, slot);
}

function box(w: number, h: number, d: number, r: number, t: Parameters<typeof place>[1], seg = 1): VertexData {
  const vd = roundedBox(w, h, d, r, seg);
  vd.uvs = null;
  return place(vd, t);
}

function ball(c: V3, r: number, tess: number, rings: number, s: V3 = [1, 1, 1]): VertexData {
  const vd = scaled(sphereVD(r, tess, rings), s[0], s[1], s[2]);
  return place(vd, { x: c[0], y: c[1], z: c[2] });
}

// A flat disc (normal +Z) of radius r at the origin, thickness t.
function disc(r: number, t: number, tess = 16): VertexData {
  return place(
    lathe(
      [
        [0, 0],
        [r, 0],
        [r, t],
        [0, t],
      ],
      tess,
    ),
    { rx: Math.PI / 2 },
  );
}

// ---------- the box ----------
function boxParts(bw: number, bh: number, bd: number): VertexData[] {
  const p: VertexData[] = [];
  const wall = 0.08;
  // Four printed walls (so the top stays open), a dark inside floor just under the rim.
  p.push(part(box(bw, bh, wall, 0.03, { y: bh / 2, z: bd / 2 - wall / 2 }), C.blue, MIX.plastic));
  p.push(part(box(bw, bh, wall, 0.03, { y: bh / 2, z: -bd / 2 + wall / 2 }), C.blue, MIX.plastic));
  for (const s of [-1, 1])
    p.push(part(box(wall, bh, bd, 0.03, { x: s * (bw / 2 - wall / 2), y: bh / 2 }), C.blue, MIX.plastic));
  p.push(part(box(bw - wall * 1.5, 0.04, bd - wall * 1.5, 0.01, { y: bh - 0.12 }, 0), C.inside, MIX.rubber));
  // Red plinth, a brass rim round the top, brass corner posts with ball feet.
  p.push(part(box(bw + 0.12, 0.16, bd + 0.12, 0.05, { y: 0.08 }), C.red, MIX.plastic));
  for (const [w, d, z, x] of [
    [bw + 0.06, 0.07, bd / 2, 0],
    [bw + 0.06, 0.07, -bd / 2, 0],
    [0.07, bd + 0.06, 0, bw / 2],
    [0.07, bd + 0.06, 0, -bw / 2],
  ] as const)
    p.push(part(box(w, 0.07, d, 0.025, { x, y: bh, z }, 0), C.brass, MIX.brass));
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      p.push(
        part(
          box(0.12, bh - 0.1, 0.12, 0.04, { x: sx * bw * 0.5, y: bh / 2 + 0.04, z: sz * bd * 0.5 }),
          C.brass,
          MIX.brass,
        ),
      );
      p.push(part(ball([sx * bw * 0.5, 0.06, sz * bd * 0.5], 0.11, 10, 5), C.brass, MIX.brass));
    }
  // Printed panels: a red frame on every wall, cream polka dots, the front roundel.
  const frame = (w: number, h: number, t: Parameters<typeof place>[1]): void => {
    const f = 0.07;
    const pieces: VertexData[] = [
      box(w, f, 0.02, 0.01, { y: h / 2 - f / 2 }, 0),
      box(w, f, 0.02, 0.01, { y: -h / 2 + f / 2 }, 0),
      box(f, h, 0.02, 0.01, { x: w / 2 - f / 2 }, 0),
      box(f, h, 0.02, 0.01, { x: -w / 2 + f / 2 }, 0),
    ];
    for (const v of pieces) p.push(part(place(v, t), C.red, MIX.plastic));
  };
  const ph = bh - 0.42;
  const py = 0.2 + ph / 2 + 0.04;
  frame(bw - 0.36, ph, { y: py, z: bd / 2 + 0.005 });
  frame(bw - 0.36, ph, { y: py, z: -bd / 2 - 0.005, ry: Math.PI });
  frame(bd - 0.36, ph, { x: bw / 2 + 0.005, y: py, ry: Math.PI / 2 });
  frame(bd - 0.36, ph, { x: -bw / 2 - 0.005, y: py, ry: -Math.PI / 2 });
  // Front: a cream roundel with a red star and a teal ring.
  const rr = Math.min(ph * 0.42, bw * 0.2);
  p.push(part(place(disc(rr * 1.12, 0.02, 24), { y: py, z: bd / 2 + 0.005 }), C.teal, MIX.plastic));
  p.push(part(place(disc(rr, 0.03, 24), { y: py, z: bd / 2 + 0.01 }), C.cream, MIX.plastic));
  p.push(
    part(place(star(rr * 0.78, rr * 0.34, 0.02), { rx: Math.PI / 2, y: py, z: bd / 2 + 0.035 }), C.red, MIX.plastic),
  );
  // Polka dots on the side and back panels, and round the front roundel.
  const rand = mulberry32(0x7ac4);
  const dots = (
    w: number,
    t: (u: number, v: number) => Parameters<typeof place>[1],
    skip?: (u: number, v: number) => boolean,
  ): void => {
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 3; j++) {
        const u = (i - 1.5) * ((w - 0.6) / 3.2) + (rand() - 0.5) * 0.08;
        const v = (j - 1) * (ph * 0.28) + (i % 2 ? 0.08 : -0.08);
        if (skip?.(u, v)) continue;
        p.push(part(place(disc(0.07, 0.015, 10), t(u, v)), j % 2 ? C.yellow : C.cream, MIX.plastic));
      }
  };
  dots(bw, (u, v) => ({ x: u, y: py + v, z: -bd / 2 - 0.004, ry: Math.PI }));
  dots(bd, (u, v) => ({ x: bw / 2 + 0.004, y: py + v, z: u, ry: Math.PI / 2 }));
  dots(bd, (u, v) => ({ x: -bw / 2 - 0.004, y: py + v, z: u, ry: -Math.PI / 2 }));
  dots(
    bw,
    (u, v) => ({ x: u, y: py + v, z: bd / 2 + 0.004 }),
    (u, v) => Math.hypot(u, v) < rr * 1.35,
  );
  // The crank's bearing plate on the right wall.
  p.push(part(place(disc(0.2, 0.04, 16), { ry: Math.PI / 2, x: bw / 2 + 0.02, y: bh * 0.55 }), C.brass, MIX.brass));
  return p;
}

// Stage 2: cracked paint. Dark crack lines zig-zagging over the walls and flaked patches
// showing bare tin.
function crackParts(bw: number, bh: number, bd: number): VertexData[] {
  const p: VertexData[] = [];
  const rand = mulberry32(0xc4ac);
  const walls: { n: number; t: (u: number, v: number) => Parameters<typeof place>[1]; w: number }[] = [
    { n: 5, w: bw, t: (u, v) => ({ x: u, y: v, z: bd / 2 + 0.03 }) },
    { n: 3, w: bd, t: (u, v) => ({ x: bw / 2 + 0.03, y: v, z: -u, ry: Math.PI / 2 }) },
    { n: 3, w: bd, t: (u, v) => ({ x: -bw / 2 - 0.03, y: v, z: u, ry: -Math.PI / 2 }) },
    { n: 3, w: bw, t: (u, v) => ({ x: -u, y: v, z: -bd / 2 - 0.03, ry: Math.PI }) },
  ];
  for (const wall of walls)
    for (let k = 0; k < wall.n; k++) {
      // A crack: 4 short segments wandering down from near the rim.
      let u = (rand() - 0.5) * (wall.w - 0.5);
      let v = bh - 0.15 - rand() * 0.3;
      for (let s = 0; s < 4; s++) {
        const du = (rand() - 0.5) * 0.4;
        const dv = -(0.15 + rand() * 0.22);
        const len = Math.hypot(du, dv);
        const at = wall.t(u + du / 2, v + dv / 2);
        const seg = part(box(0.025, len, 0.012, 0, at, 0), C.crack, MIX.rubber);
        rotateAboutNormal(seg, at, Math.atan2(-du, dv));
        p.push(seg);
        u += du;
        v += dv;
        if (v < 0.35) break;
      }
      // A flake of bare tin beside it.
      const fl = place(disc(0.06 + rand() * 0.06, 0.012, 7), { sy: 0.7 });
      p.push(part(place(fl, wall.t(u + 0.12, v + 0.1)), C.steel, MIX.brass));
    }
  return p;
}

// Rotates a placed wall decal about its wall normal through the decal's centre.
function rotateAboutNormal(vd: VertexData, t: Parameters<typeof place>[1], a: number): void {
  const pos = vd.positions as number[];
  const nrm = vd.normals as number[];
  const ry = t.ry ?? 0;
  // Wall frame: tangent u (in XZ), up y, normal n.
  const ux = Math.cos(ry);
  const uz = -Math.sin(ry);
  const cx = t.x ?? 0;
  const cy = t.y ?? 0;
  const cz = t.z ?? 0;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const turn = (arr: number[], i: number, ox: number, oy: number, oz: number): void => {
    const lu = (arr[i] - ox) * ux + (arr[i + 2] - oz) * uz;
    const lv = arr[i + 1] - oy;
    const ln = (arr[i] - ox) * -uz + (arr[i + 2] - oz) * ux;
    const nu = lu * c - lv * s;
    const nv = lu * s + lv * c;
    arr[i] = ox + nu * ux + ln * -uz;
    arr[i + 1] = oy + nv;
    arr[i + 2] = oz + nu * uz + ln * ux;
  };
  for (let i = 0; i < pos.length; i += 3) {
    turn(pos, i, cx, cy, cz);
    turn(nrm, i, 0, 0, 0);
  }
}

// The lid in hinge space: hinge along X at the origin, the lid extends toward +Z.
function lidParts(bw: number, bd: number): VertexData[] {
  const p: VertexData[] = [];
  p.push(part(box(bw + 0.08, 0.07, bd + 0.06, 0.03, { y: 0.035, z: bd / 2 }), C.blue, MIX.plastic));
  p.push(part(box(bw - 0.3, 0.02, bd - 0.3, 0.01, { y: 0.075, z: bd / 2 }, 0), C.red, MIX.plastic));
  p.push(part(box(bw - 0.42, 0.02, bd - 0.42, 0.01, { y: 0.085, z: bd / 2 }, 0), C.blueDark, MIX.plastic));
  p.push(part(place(star(0.32, 0.14, 0.02), { y: 0.09, z: bd / 2 }), C.cream, MIX.plastic));
  // Inside of the lid (seen when open): printed cream with a red sunburst roundel.
  p.push(part(box(bw - 0.1, 0.01, bd - 0.1, 0.005, { y: -0.004, z: bd / 2 }, 0), C.cream, MIX.plastic));
  p.push(
    part(
      place(
        lathe(
          [
            [0, 0],
            [0.36, 0],
            [0.36, 0.01],
            [0, 0.01],
          ],
          20,
        ),
        { rx: Math.PI, y: -0.01, z: bd / 2 },
      ),
      C.red,
      MIX.plastic,
    ),
  );
  p.push(part(place(star(0.3, 0.13, 0.01), { rx: Math.PI, y: -0.02, z: bd / 2 }), C.yellow, MIX.plastic));
  // Hinge knuckles and the latch tab at the front edge.
  for (const x of [-bw * 0.3, bw * 0.3])
    p.push(
      part(
        place(
          lathe(
            [
              [0.05, -0.12],
              [0.05, 0.12],
            ],
            10,
          ),
          { rz: Math.PI / 2, x },
        ),
        C.brass,
        MIX.brass,
      ),
    );
  p.push(part(box(0.22, 0.12, 0.04, 0.015, { y: -0.03, z: bd + 0.04 }, 0), C.brass, MIX.brass));
  return p;
}

// The crank in its own space: axle along +X from the origin, an arm and a red knob.
function crankParts(): VertexData[] {
  const p: VertexData[] = [];
  p.push(
    part(
      place(
        lathe(
          [
            [0.06, 0],
            [0.06, 0.2],
            [0.09, 0.21],
            [0.09, 0.27],
            [0, 0.28],
          ],
          12,
        ),
        { rz: -Math.PI / 2 },
      ),
      C.brass,
      MIX.brass,
    ),
  );
  p.push(part(box(0.06, 0.5, 0.1, 0.03, { x: 0.25, y: -0.22 }), C.brass, MIX.brass));
  p.push(
    part(
      place(
        lathe(
          [
            [0.025, 0],
            [0.025, 0.12],
          ],
          8,
        ),
        { rz: -Math.PI / 2, x: 0.25, y: -0.42 },
      ),
      C.brass,
      MIX.brass,
    ),
  );
  p.push(
    part(
      place(
        lathe(
          [
            [0, 0],
            [0.07, 0.01],
            [0.09, 0.08],
            [0.075, 0.2],
            [0.05, 0.25],
            [0, 0.26],
          ],
          12,
        ),
        {
          rz: -Math.PI / 2,
          x: 0.36,
          y: -0.42,
        },
      ),
      C.knob,
      MIX.plastic,
    ),
  );
  return p;
}

// A unit-length helical spring along +Y (coils of wire radius `wire`), scaled in y.
function spring(radius: number, wire: number, coils: number): VertexData {
  const rings: Ring[] = [];
  const n = coils * 12;
  for (let i = 0; i <= n; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r = radius * (i < 6 || i > n - 6 ? 0.85 : 1);
    rings.push({ p: [Math.cos(a) * r, i / n, Math.sin(a) * r], a: wire });
  }
  return part(tube(rings, 6, [0, 1, 0], 0.5, 0.5), C.steel, MIX.brass);
}

// The jester in hip space (origin on the spring's top): smock, ruff, head and cap.
const TORSO_H = 0.82;
const HEAD_R = 0.36;
const HEAD_Y = TORSO_H + 0.16 + HEAD_R * 0.9;
const SHOULDER: V3 = [0.36, TORSO_H - 0.12, 0];

function harlequin(vd: VertexData): VertexData {
  // Left half red, right half yellow (the jester's motley).
  const pos = vd.positions as number[];
  const red = lin(C.red);
  const yel = lin(C.yellow);
  const n = pos.length / 3;
  const col = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    const c = pos[v * 3] < 0 ? red : yel;
    col.set([c.r, c.g, c.b, 1], v * 4);
  }
  vd.colors = col;
  vd.uvs = null;
  return mixUv(vd, MIX.plastic);
}

function jesterParts(): VertexData[] {
  const p: VertexData[] = [];
  // Smock: a bell, wide at the hem, narrowing to the shoulders.
  p.push(
    harlequin(
      scaled(
        lathe(
          [
            [0.12, 0],
            [0.42, 0.03],
            [0.44, 0.1],
            [0.36, 0.32],
            [0.32, 0.55],
            [0.34, TORSO_H - 0.1],
            [0.24, TORSO_H],
            [0, TORSO_H + 0.02],
          ],
          24,
        ),
        1,
        1,
        0.85,
      ),
    ),
  );
  // Pompom buttons down the front.
  for (let k = 0; k < 3; k++)
    p.push(part(ball([0, 0.22 + k * 0.17, 0.32 - k * 0.012], 0.055, 8, 4), k % 2 ? C.teal : C.ink, MIX.plastic));
  // Ruff: a zig-zag cream collar.
  {
    const rings = 24;
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i < rings; i++) {
      const a = (i / rings) * Math.PI * 2;
      const out = i % 2 ? 0.48 : 0.36;
      const up = i % 2 ? -0.06 : 0.04;
      const cx = Math.cos(a);
      const sz = Math.sin(a);
      positions.push(cx * 0.16, TORSO_H + 0.08, sz * 0.16, cx * out, TORSO_H + up, sz * out * 0.9);
      normals.push(cx * 0.2, 1, sz * 0.2, cx * 0.4, 1, sz * 0.4);
    }
    for (let i = 0; i < rings; i++) {
      const a0 = i * 2;
      const a1 = ((i + 1) % rings) * 2;
      indices.push(a0, a1, a1 + 1, a0, a1 + 1, a0 + 1);
      indices.push(a0, a1 + 1, a1, a0, a0 + 1, a1 + 1);
    }
    const vd = new VertexData();
    vd.positions = positions;
    vd.normals = normals;
    vd.indices = indices;
    p.push(part(fixWinding(vd), C.cream, MIX.paper));
  }
  // Head: round cream face, red nose, rosy cheeks, eyes and a wide red grin.
  const hy = HEAD_Y;
  p.push(part(ball([0, hy, 0], HEAD_R, 18, 10, [1, 0.95, 0.95]), C.skin, MIX.plastic));
  p.push(part(ball([0, hy - 0.02, HEAD_R * 0.95], 0.085, 10, 6), C.nose, MIX.plastic));
  for (const s of [-1, 1]) {
    p.push(part(ball([s * 0.19, hy - 0.08, HEAD_R * 0.76], 0.075, 8, 4, [1, 0.7, 0.4]), C.cheek, MIX.plastic));
    p.push(part(ball([s * 0.12, hy + 0.1, HEAD_R * 0.85], 0.06, 10, 5, [0.8, 1.15, 0.5]), C.glove, MIX.plastic));
    p.push(part(ball([s * 0.115, hy + 0.09, HEAD_R * 0.9], 0.035, 8, 4, [1, 1, 0.5]), C.ink, MIX.rubber));
    // Arched brows.
    p.push(
      part(
        tube(
          [
            { p: [s * 0.05, hy + 0.2, HEAD_R * 0.88], a: 0.012 },
            { p: [s * 0.12, hy + 0.235, HEAD_R * 0.86], a: 0.014 },
            { p: [s * 0.19, hy + 0.21, HEAD_R * 0.8], a: 0.01 },
          ],
          5,
          [0, 0, 1],
          0.5,
          0.5,
        ),
        C.ink,
        MIX.rubber,
      ),
    );
  }
  {
    const rings: Ring[] = [];
    for (let i = 0; i <= 10; i++) {
      const a = -0.95 + (i / 10) * 1.9;
      rings.push({
        p: [Math.sin(a) * 0.2, hy - 0.11 - Math.cos(a) * 0.06, HEAD_R * 0.88 * Math.cos(a * 0.6)],
        a: 0.022,
      });
    }
    p.push(part(tube(rings, 6, [0, 0, 1], 0.6, 0.6), C.red, MIX.plastic));
  }
  // Cap: a band and three floppy points (red, yellow, teal) with brass bells.
  p.push(
    part(
      place(
        lathe(
          [
            [HEAD_R * 0.98, 0],
            [HEAD_R * 1.02, 0.03],
            [HEAD_R * 1.0, 0.09],
            [HEAD_R * 0.9, 0.1],
          ],
          18,
        ),
        { y: hy + HEAD_R * 0.45 },
      ),
      C.cream,
      MIX.plastic,
    ),
  );
  const capBase = hy + HEAD_R * 0.5;
  const points: [number, string][] = [
    [-1, C.red],
    [0, C.yellow],
    [1, C.teal],
  ];
  for (const [s, col] of points) {
    const tip: V3 = [s * 0.55, capBase + (s === 0 ? 0.62 : 0.3), s === 0 ? -0.15 : -0.05];
    const rings: Ring[] = [
      { p: [s * 0.12, capBase, 0], a: s === 0 ? 0.24 : 0.2 },
      { p: [s * 0.3, capBase + 0.22, -0.02], a: 0.15 },
      { p: [s * 0.46, capBase + (s === 0 ? 0.5 : 0.36), -0.05], a: 0.08 },
      { p: tip, a: 0.03 },
    ];
    if (s === 0) {
      rings[1].p = [0, capBase + 0.3, -0.06];
      rings[2].p = [0, capBase + 0.52, -0.15];
      rings[3].p = [0, capBase + 0.6, -0.3];
    }
    const end = rings[3].p;
    // The side points droop: their tips bend down.
    if (s !== 0) rings[3].p = [s * 0.62, capBase + 0.22, -0.06];
    p.push(part(tube(rings, 10, [0, 0, 1], 0.2, 0.5), col, MIX.plastic));
    const bell = s === 0 ? end : rings[3].p;
    p.push(part(ball([bell[0], bell[1] - 0.06, bell[2]], 0.07, 10, 5), C.brass, MIX.brass));
  }
  return p;
}

// An arm in shoulder space, hanging down (-Y) and a little forward, a white glove.
function armParts(side: 1 | -1): VertexData[] {
  const p: VertexData[] = [];
  const sleeve: Ring[] = [
    { p: [0, 0, 0], a: 0.11 },
    { p: [side * 0.04, -0.22, 0.04], a: 0.09 },
    { p: [side * 0.05, -0.42, 0.1], a: 0.1 },
  ];
  const v = tube(sleeve, 10, [0, 0, 1], 0.6, 0);
  v.uvs = null;
  p.push(part(v, side > 0 ? C.yellow : C.red, MIX.plastic));
  p.push(part(ball([side * 0.05, -0.45, 0.1], 0.09, 10, 5, [1, 0.7, 1]), C.cream, MIX.paper));
  p.push(part(ball([side * 0.05, -0.56, 0.12], 0.1, 10, 6, [0.9, 1.05, 0.8]), C.glove, MIX.plastic));
  p.push(part(ball([side * 0.12, -0.53, 0.14], 0.04, 6, 3), C.glove, MIX.plastic));
  return p;
}

// ---------- the model ----------
const geoCache = new Map<
  string,
  {
    box: VertexData;
    cracks: VertexData;
    lid: VertexData;
    crank: VertexData;
    spring: VertexData;
    jester: VertexData;
    armL: VertexData;
    armR: VertexData;
  }
>();

function copy(vd: VertexData): VertexData {
  const out = new VertexData();
  out.positions = Float32Array.from(vd.positions as ArrayLike<number>);
  out.normals = Float32Array.from(vd.normals as ArrayLike<number>);
  out.indices = Uint32Array.from(vd.indices as ArrayLike<number>);
  out.colors = Float32Array.from(vd.colors as ArrayLike<number>);
  out.uvs = Float32Array.from(vd.uvs as ArrayLike<number>);
  return out;
}

function geometry(bw: number, bh: number, bd: number) {
  const k = `${bw.toFixed(3)}:${bh.toFixed(3)}:${bd.toFixed(3)}`;
  let g = geoCache.get(k);
  if (!g) {
    const boxVD = mergeParts(boxParts(bw, bh, bd));
    bakeVertexAO(boxVD, { samples: 12, maxDist: 0.5, strength: 0.55, maxTriangles: 9000 });
    const jester = mergeParts(jesterParts());
    bakeVertexAO(jester, { samples: 12, maxDist: 0.3, strength: 0.5, ground: false, maxTriangles: 9000 });
    g = {
      box: boxVD,
      cracks: mergeParts(crackParts(bw, bh, bd)),
      lid: mergeParts(lidParts(bw, bd)),
      crank: mergeParts(crankParts()),
      spring: spring(0.2, 0.035, 7),
      jester,
      armL: mergeParts(armParts(-1)),
      armR: mergeParts(armParts(1)),
    };
    geoCache.set(k, g);
  }
  return g;
}

export function createJackInTheBox(scene: Scene, look: Look, o: JackInTheBoxOptions): JackInTheBoxModel {
  const bw = Math.max(2, Math.min(3.2, o.width * 0.55));
  const bd = Math.max(1.8, Math.min(2.8, o.depth * 0.7));
  const bh = o.boxHeight;
  const g = geometry(bw, bh, bd);
  const mix = mixedToyMaterial(scene, 'jackMix');

  const root = new TransformNode('jackInTheBox', scene);
  const meshes: Mesh[] = [];
  const mesh = (name: string, vd: VertexData, parent: TransformNode): Mesh => {
    const m = buildMesh(scene, name, copy(vd), mix);
    m.parent = parent;
    m.isPickable = false;
    meshes.push(m);
    return m;
  };
  const boxMesh = mesh('jackBox', g.box, root);
  const cracks = mesh('jackCracks', g.cracks, root);
  cracks.setEnabled(false);

  const lid = new TransformNode('jackLid', scene);
  lid.parent = root;
  lid.position.set(0, bh + 0.02, -bd / 2 - 0.03);
  lid.rotation.x = LID_OPEN;
  mesh('jackLidMesh', g.lid, lid);

  const crank = new TransformNode('jackCrank', scene);
  crank.parent = root;
  crank.position.set(bw / 2 + 0.04, bh * 0.55, 0);
  mesh('jackCrankMesh', g.crank, crank);

  const springNode = new TransformNode('jackSpring', scene);
  springNode.parent = root;
  springNode.position.y = bh - 0.12;
  mesh('jackSpringMesh', g.spring, springNode);

  const jester = new TransformNode('jackJester', scene);
  jester.parent = root;
  mesh('jackJesterMesh', g.jester, jester);
  const armL = new TransformNode('jackArmL', scene);
  armL.parent = jester;
  armL.position.set(-SHOULDER[0], SHOULDER[1], SHOULDER[2]);
  armL.rotation.z = -ARM_REST;
  mesh('jackArmLMesh', g.armL, armL);
  const armR = new TransformNode('jackArmR', scene);
  armR.parent = jester;
  armR.position.set(SHOULDER[0], SHOULDER[1], SHOULDER[2]);
  armR.rotation.z = ARM_REST;
  mesh('jackArmRMesh', g.armR, armR);

  const blob = createBlobShadowMesh(scene, 'jackBlob', 0.45);
  blob.parent = root;
  blob.scaling.set(bw * 1.25, 1, bd * 1.25);

  for (const m of meshes) look.addShadowCaster(m, 'static');
  look.receiveShadows(boxMesh);

  const flashCol = new Color3(1, 0.94, 0.82);
  const setSpring = (h: number): void => {
    // Coils from the inside floor up to the hips; tucked in, the jester sinks into the box.
    springNode.scaling.y = Math.max(0.06, h + 0.12);
    jester.position.y = bh + h;
  };
  setSpring(springRest(0));

  return {
    root,
    lid,
    crank,
    jester,
    armL,
    armR,
    hpBarAnchor: new Vector3(0, bh + 0.1, bd / 2 + 0.1),
    boxHeight: bh,
    setSpring,
    setStage(stage: number): void {
      const s = Math.max(0, Math.min(2, Math.floor(stage)));
      lid.rotation.z = s >= 1 ? 0.22 : 0;
      lid.rotation.y = s >= 1 ? -0.12 : 0;
      cracks.setEnabled(s >= 2);
    },
    setFlash(k: number): void {
      const f = Math.max(0, Math.min(1, k));
      mix.emissiveColor.copyFrom(flashCol).scaleInPlace(f * 0.9);
    },
    setPop(s: number): void {
      jester.scaling.setAll(s);
    },
    dispose(): void {
      for (const m of meshes) look.removeShadowCaster(m);
      root.dispose(false, false);
      mix.dispose(true, true);
    },
  };
}

// ---------- preview ----------
// The boss as it stands on 3-10 (width 6, depth 4): 'fresh' bobs on its spring and waves,
// 'bent' and 'cracked' show the later phases, 'ducked' cranks with the jester tucked in.
export function preview(scene: Scene, look: Look, opts: PreviewOptions): PreviewResult {
  const m = createJackInTheBox(scene, look, { width: 6, depth: 4, boxHeight: 1.3 });
  const holder = new TransformNode('jackPreviewRoot', scene);
  m.root.parent = holder;
  const v = opts.variant ?? 'fresh';
  const stage = v === 'cracked' ? 2 : v === 'bent' ? 1 : 0;
  m.setStage(stage);
  return {
    root: holder,
    update(time: number): void {
      m.crank.rotation.x = time * (v === 'ducked' ? 8 : 1.5);
      if (v === 'ducked') {
        // As boss.ts poses him while he hides: sunk, squashed, the lid half shut above.
        m.setSpring(-1.0);
        m.jester.scaling.set(1.12, 0.75, 1.12);
        m.lid.rotation.x = -1.15;
        return;
      }
      m.setSpring(springRest(stage) + Math.sin(time * 3) * 0.05);
      m.jester.rotation.z = Math.sin(time * 1.7) * 0.06;
      m.armR.rotation.z = ARM_REST + 1.6 + Math.sin(time * 6) * 0.5;
      m.armL.rotation.z = -ARM_REST - 0.3 * Math.sin(time * 2);
    },
    dispose(): void {
      m.dispose();
      holder.dispose();
    },
  };
}
