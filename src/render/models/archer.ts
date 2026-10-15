// Mob archer (Milestone 6, variant 6): a green plastic army man with a longbow, the
// ranged mob of World 3. He stands braced side-on to the target with the left foot
// forward, the bow arm straight out up the lane and the string drawn back to his right
// cheek, an arrow nocked; a quiver of arrows rides on his back with the fletchings
// poking up over the right shoulder, and he keeps the rifleman's M1 helmet so he reads
// as one of the army. The long vertical bow is the silhouette cue at 30-60 px on a phone
// (the rifleman's rifle is diagonal, the knight's sword a spike over the shoulder).
//
// Same build as the other mob figures (models/soldier.ts helpers): smooth tubes and
// surfaces of revolution, greyscale moulding shades (the team colour multiplies in), AO
// baked offline into AO_BAKED (a stale table bakes at runtime once), a darker contact
// tint at the feet, one mesh in the shared 'army-plastic' material.
//
// GAME API
//   createArcherMesh(scene, look): Mesh
//     Synchronous (geometry cached per session). Ready for thinInstanceSetBuffer('matrix')
//     and ('color', LINEAR teamColor(team)) like the rifleman: alwaysSelectAsActiveMesh,
//     not pickable, doNotSyncBoundingInfo, 'crowd' shadow caster and receiver. Pivot at
//     the base-plate centre on y = 0, front +Z, authored on the rifleman's scale (mob
//     radius 0.28: instance scale r / 0.28). Player yaw 0, enemy PI (crowd.ts adds its
//     three-quarter turn, which shows the drawn bow in profile).
//   ARCHER_HEIGHT: 1.42 to the bow's upper tip (helmet top 1.3, like the rifleman).
//   Triangles: ~780 (soldier variants class: <= 900).
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Look } from '../look/index.ts';
import {
  aoChecksum,
  armyPlasticMaterial,
  bakeAOFactors,
  bakedParts,
  buildMesh,
  cloneVD,
  encodeAO,
  mergeParts,
  place,
  roundedBox,
} from '../look/index.ts';
import type { ModelInfo, PreviewOptions, PreviewResult } from '../look/model.ts';
import { HOP_STYLE } from '../crowdLogic.ts';
import { footShade, lerp3, revolve, scaled, shade, tube } from './soldier.ts';
import type { Ring, V3 } from './soldier.ts';
import { crowdMesh, crowdPreview } from './snowman.ts';
import type { CrowdPreviewUnit } from './snowman.ts';

export const ARCHER_HEIGHT = 1.42;

export const info: ModelInfo = {
  key: 'archer',
  title: 'Mob archer (plastic army man with a longbow)',
  instanced: true,
  teams: true,
  side: 'team',
  height: ARCHER_HEIGHT,
  triangleBudget: 900,
  gameZ: 14,
  variants: ['crowd', 'row'],
};

// Greyscale moulding multipliers (team colour multiplies on top).
const S = {
  body: 1,
  belt: 0.92,
  face: 1.06,
  helmet: 0.87,
  helmetBase: 0.84,
  brim: 0.76,
  brimUnder: 0.66,
  boots: 0.88,
  bow: 0.78,
  grip: 0.66,
  string: 0.95,
  arrow: 0.9,
  fletch: 1.08,
  quiver: 0.8,
  strap: 0.74,
  base: 1,
};

// Key points of the pose (front +Z). The archer stands side-on: shoulders turned so the
// left one leads, the bow hand straight out ahead, the draw hand at the right cheek.
const P = {
  hipL: [-0.075, 0.6, 0.04] as V3,
  kneeL: [-0.1, 0.37, 0.15] as V3,
  ankleL: [-0.11, 0.13, 0.17] as V3,
  hipR: [0.085, 0.6, -0.04] as V3,
  kneeR: [0.12, 0.37, -0.1] as V3,
  ankleR: [0.14, 0.13, -0.17] as V3,
  shoulderL: [-0.13, 0.92, 0.08] as V3,
  shoulderR: [0.14, 0.915, -0.07] as V3,
  elbowL: [-0.1, 0.94, 0.3] as V3,
  handL: [-0.07, 0.955, 0.47] as V3, // bow grip
  elbowR: [0.24, 0.98, -0.08] as V3, // drawn elbow, high and back
  handR: [0.04, 1.0, 0.06] as V3, // draw hand at the cheek
  head: [0.0, 1.085, 0.03] as V3,
  helmet: [0.0, 1.116, 0.018] as V3,
};

// Bow: the grip in the left fist, limbs sweeping up and down and curling back toward the
// archer at the tips (a drawn longbow), all in the plane x = BOW_X.
const BOW_X = P.handL[0];
const BOW_TOP: V3 = [BOW_X, 1.42, 0.33];
const BOW_BOT: V3 = [BOW_X, 0.5, 0.33];

function limb(a: V3, j: V3, b: V3, r0: number, r1: number, r2: number, sides: number, g: number): VertexData {
  const rings: Ring[] = [
    { p: a, a: r0 },
    { p: lerp3(a, j, 0.5), a: (r0 + r1) / 2 + 0.005 },
    { p: j, a: r1 },
    { p: lerp3(j, b, 0.5), a: (r1 + r2) / 2 + 0.004 },
    { p: b, a: r2 },
  ];
  return shade(tube(rings, sides, [1, 0, 0], 0.4, 0.5), g);
}

function boot(heel: V3, toe: V3, w: number): VertexData {
  return tube(
    [
      { p: heel, a: w, b: w * 1.08, s: S.boots },
      { p: toe, a: w * 0.95, b: w * 0.78, s: S.boots },
    ],
    6,
    [1, 0, 0],
    0.6,
    0.75,
  );
}

function bowLimb(dir: 1 | -1): VertexData {
  // From the grip outward: a thick riser, then a limb that tapers and recurves back.
  const g = P.handL;
  const tip = dir > 0 ? BOW_TOP : BOW_BOT;
  const rings: Ring[] = [
    { p: [BOW_X, g[1], g[2] + 0.005], a: 0.024, b: 0.03, s: S.grip },
    { p: [BOW_X, g[1] + dir * 0.07, g[2] + 0.0], a: 0.022, b: 0.028, s: S.grip },
    { p: [BOW_X, g[1] + dir * 0.17, g[2] - 0.02], a: 0.018, b: 0.024, s: S.bow },
    { p: [BOW_X, g[1] + dir * 0.3, g[2] - 0.065], a: 0.015, b: 0.02, s: S.bow },
    { p: [BOW_X, g[1] + dir * 0.4, tip[2] + 0.005], a: 0.012, b: 0.016, s: S.bow },
    { p: tip, a: 0.01, b: 0.012, s: S.bow },
  ];
  return tube(rings, 5, [1, 0, 0], 0, 0.6);
}

function buildArcher(): VertexData {
  const p: VertexData[] = [];
  // Base plate.
  p.push(
    shade(
      scaled(
        revolve(
          [
            [0.5, 0],
            [0.5, 0.02],
            [0.468, 0.04],
            [0, 0.04],
          ],
          14,
        ),
        0.48,
        1,
        0.58,
      ),
      S.base,
    ),
  );
  // Legs braced apart, left foot forward and turned toward the target.
  p.push(limb(P.hipL, P.kneeL, P.ankleL, 0.086, 0.06, 0.05, 6, S.body));
  p.push(limb(P.hipR, P.kneeR, P.ankleR, 0.086, 0.06, 0.05, 6, S.body));
  p.push(boot([-0.11, 0.088, 0.115], [-0.115, 0.07, 0.26], 0.047));
  p.push(boot([0.15, 0.088, -0.215], [0.17, 0.07, -0.08], 0.047));
  // Torso turned a little (left shoulder leading) with a belt band.
  const torso = tube(
    [
      { p: [0, 0.53, -0.005], a: 0.134, b: 0.1, s: S.body },
      { p: [0, 0.615, 0.0], a: 0.128, b: 0.095, s: S.belt },
      { p: [0, 0.77, 0.012], a: 0.15, b: 0.112, s: S.body },
      { p: [0, 0.87, 0.012], a: 0.162, b: 0.108, s: S.body },
      { p: [0, 0.935, 0.008], a: 0.146, b: 0.092, s: S.body },
      { p: [0, 0.975, 0.006], a: 0.094, b: 0.066, s: S.body },
    ],
    8,
    [1, 0, 0],
    0,
    0.45,
    Math.PI / 8,
  );
  p.push(place(torso, { ry: -0.42 }));
  // Quiver across the back (tilted, mouth over the right shoulder) on a chest strap.
  const qa: V3 = [-0.08, 0.6, -0.15];
  const qb: V3 = [0.1, 1.05, -0.16];
  p.push(
    tube(
      [
        { p: qa, a: 0.05, b: 0.045, s: S.quiver },
        { p: lerp3(qa, qb, 0.15), a: 0.058, b: 0.05, s: S.quiver },
        { p: lerp3(qa, qb, 0.85), a: 0.062, b: 0.052, s: S.quiver },
        { p: qb, a: 0.066, b: 0.056, s: S.strap },
      ],
      6,
      [1, 0, 0],
      0.5,
      0,
    ),
  );
  // Fletchings poking out of the quiver: three arrow ends with flat vanes.
  for (const [dx, dz, up] of [
    [-0.02, 0.01, 0.1],
    [0.025, -0.015, 0.13],
    [0.0, 0.02, 0.08],
  ] as const) {
    const a: V3 = [qb[0] + dx, qb[1] - 0.04, qb[2] + dz];
    const b: V3 = [qb[0] + dx + up * 0.38, qb[1] + up + 0.02, qb[2] + dz - 0.01];
    p.push(
      tube(
        [
          { p: a, a: 0.009, s: S.arrow },
          { p: b, a: 0.009, s: S.arrow },
        ],
        3,
        [1, 0, 0],
        0,
        0.6,
      ),
    );
    p.push(
      tube(
        [
          { p: lerp3(a, b, 0.45), a: 0.004, b: 0.008, s: S.fletch },
          { p: lerp3(a, b, 0.75), a: 0.004, b: 0.03, s: S.fletch },
          { p: b, a: 0.003, b: 0.012, s: S.fletch },
        ],
        4,
        [1, 0, 0],
        0,
        0,
      ),
    );
  }
  p.push(
    shade(
      tube(
        [
          { p: [0.13, 0.95, -0.12], a: 0.022, b: 0.008 },
          { p: [0.03, 0.86, 0.1], a: 0.022, b: 0.008 },
          { p: [-0.11, 0.66, 0.06], a: 0.022, b: 0.008 },
        ],
        4,
        [0, 0, 1],
        0,
        0,
      ),
      S.strap,
    ),
  );
  // Arms: the bow arm straight out up the lane, the draw arm's elbow high and back.
  const arm = (a: V3, e: V3, h: V3): VertexData =>
    shade(
      tube(
        [
          { p: a, a: 0.068 },
          { p: e, a: 0.048 },
          { p: lerp3(e, h, 0.8), a: 0.038 },
          { p: h, a: 0.046 },
        ],
        6,
        [0, 1, 0],
        0.75,
        0.6,
        Math.PI / 6,
      ),
      S.body,
    );
  p.push(arm(P.shoulderL, P.elbowL, P.handL));
  p.push(arm(P.shoulderR, P.elbowR, P.handR));
  // The bow, its string drawn to the cheek and the nocked arrow.
  p.push(bowLimb(1), bowLimb(-1));
  const nock: V3 = [P.handR[0] - 0.03, P.handR[1] - 0.02, P.handR[2] - 0.01];
  for (const tip of [BOW_TOP, BOW_BOT])
    p.push(
      tube(
        [
          { p: tip, a: 0.006, s: S.string },
          { p: nock, a: 0.006, s: S.string },
        ],
        3,
        [1, 0, 0],
        0,
        0,
      ),
    );
  const head: V3 = [BOW_X + 0.012, P.handL[1] + 0.03, P.handL[2] + 0.13];
  p.push(
    tube(
      [
        { p: nock, a: 0.009, s: S.arrow },
        { p: head, a: 0.009, s: S.arrow },
      ],
      4,
      [1, 0, 0],
      0.3,
      0,
    ),
  );
  p.push(
    tube(
      [
        { p: head, a: 0.022, b: 0.01, s: S.grip },
        { p: [head[0], head[1] + 0.004, head[2] + 0.06], a: 0.002, s: S.grip },
      ],
      4,
      [1, 0, 0],
      0,
      0,
    ),
  );
  p.push(
    tube(
      [
        { p: lerp3(nock, head, 0.02), a: 0.004, b: 0.012, s: S.fletch },
        { p: lerp3(nock, head, 0.1), a: 0.004, b: 0.03, s: S.fletch },
        { p: lerp3(nock, head, 0.2), a: 0.003, b: 0.01, s: S.fletch },
      ],
      4,
      [1, 0, 0],
      0,
      0,
    ),
  );
  // Head turned toward the target (left), and the M1 helmet.
  const headVD = revolve(
    [
      [0.045, -0.13],
      [0.074, -0.06],
      [0.092, -0.005],
      [0.084, 0.05],
    ],
    6,
    undefined,
    Math.PI / 2,
  );
  p.push(shade(place(scaled(headVD, 1, 1, 1.06), { x: P.head[0], y: P.head[1], z: P.head[2], ry: -0.25 }), S.face));
  const helmet = revolve(
    [
      [0.108, 0.0],
      [0.186, -0.024],
      [0.19, -0.002],
      [0.13, 0.03],
      [0.128, 0.09],
      [0.088, 0.155],
      [0, 0.18],
    ],
    12,
    [S.brimUnder, S.brimUnder, S.brim, S.helmetBase, S.helmet, S.helmet, S.helmet],
  );
  p.push(place(scaled(helmet, 1, 1, 1.07), { x: P.helmet[0], y: P.helmet[1], z: P.helmet[2], ry: -0.25 }));
  // A small belt pouch on the left hip.
  const pouch = roundedBox(0.08, 0.09, 0.05, 0.02, 0);
  pouch.uvs = null;
  p.push(shade(place(pouch, { x: -0.13, y: 0.57, z: 0.06, ry: -0.6 }), S.quiver));
  return mergeParts(p);
}

// ---------- AO, cache, mesh ----------
const AO_OPTS = { samples: 20, strength: 0.6, maxDist: 0.45, maxTriangles: 4000 };
const AO_BAKED =
  'jIx/f39/jIyMf39/f4y/srLMspm/v7+yv7KysuXy2fLMQL/l5eX/5Q1/zA2yzPIAJrLl5f/lmdn/8vLZsrLM2dm/pn9/jH8AAAAA8uUADYzl8v+/svL//+Wmv/L/2bKMpuXyf1lAZpmyAAB/suWyGhqM5eWZGiamjL/yWZkmTJnMzH8AAL9zAADZ8v8A2f/ZAJmy5QDl///yDfL/2czy8plZ8v8AzPK/Gmby5QCy8gBAWcymWQAAAJn///+ZGsz//+VZGsz//7IaJuX//3MzTNkaDQC/8pnZANlmJgDyjFkA5QCMGhoN///M/wD/f38A/7KmAP8AphomALKMjNkAfxpAANkNAACmAH9AGkBMAAANALLMQCa//8wNDSbl//LZv7/M/9nM5Yy//8zZ/7JmTA1mv9mZGtlMANn//wAzDQ3lZgAAAA3MACYAAAAA/+Xyptn/5f+y2f///7/l///yv+X////y/////wDy/wAA////2bL////Zpv///9m/8v//2aby///MmdkAAPIAAAAAmQAAAAAAAAAATPK/8gD/8v/y//L//wAAAAAAJgBZAGYAjAANAAAAAIyyslkmjH9/mVlzpgANGhoAAGZmTDNMM0xmZmZAWbKysn+MmaaZpnNMf///5fL///////K///Ly5czl5fLy5dnl5f//8tny//////Ly//////////////////8AAAAA2bLy8rIA8gDZAPIA8gDyANkAsgA=';
const AO_CHECK = 2296621;

let cached: VertexData | null = null;

function geometry(): VertexData {
  if (!cached) {
    const [g] = bakedParts('archer', [buildArcher()], [{ b64: AO_BAKED, check: AO_CHECK }], AO_OPTS);
    footShade(g);
    g.uvs = null;
    cached = cloneVD(g);
  }
  return cached;
}

// Tool: recomputes AO_BAKED / AO_CHECK (run through vite's ssrLoadModule).
export function archerAOTable(): { baked: string; check: number } {
  const raw = buildArcher();
  const [f] = bakeAOFactors([raw], AO_OPTS);
  return { baked: encodeAO(f), check: aoChecksum(raw.positions as number[]) };
}

export function archerTriangles(): number {
  return (geometry().indices as ArrayLike<number>).length / 3;
}

export function createArcherMesh(scene: Scene, look: Look): Mesh {
  const mat = look.material('army-plastic', () => armyPlasticMaterial(scene));
  return crowdMesh(buildMesh(scene, 'soldier-archer', cloneVD(geometry()), mat), look);
}

// ---------- preview ----------
// 'crowd': a block of archers of opts.team hopping along at the crowd's three-quarter
// turn; 'row': a row of them square to the lane (the bow in profile from the side view).
export function preview(scene: Scene, look: Look, opts: PreviewOptions): PreviewResult {
  const mesh = createArcherMesh(scene, look);
  const units: CrowdPreviewUnit[] = [];
  const yaw = opts.team === 'player' ? -0.7 : Math.PI + 0.55;
  if (opts.variant === 'row') {
    for (let c = 0; c < 4; c++) units.push({ x: (c - 1.5) * 0.7, z: 0, yaw: 0, s: 1, frost: 0 });
  } else {
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 4; c++)
        units.push({ x: (c - 1.5) * 0.7 + (r % 2) * 0.2, z: (r - 1) * 0.75, yaw, s: 1, frost: 0 });
  }
  return crowdPreview(scene, 'archerRoot', [{ mesh, team: true }], units, HOP_STYLE.archer, 0.11, opts.team);
}
