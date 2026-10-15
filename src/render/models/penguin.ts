// Enemy wind-up penguin (World 2, variant 17): a little lithographed tin toy penguin, fast
// and weak, that waddles at the player in quick hops. A pressed-tin egg body painted
// navy-black with a cream belly and face, a soldered seam band round its middle, an
// orange beak and paddle feet, flippers held out for balance and a brass wind-up key on
// its back; it wears the tan army's kit: a tiny M1 helmet and a belt with a buckle.
// ~1.05 tall on a radius-0.24 footprint (smaller than a 1.3 rifleman).
//
// Two meshes drawn with the same matrices:
//   tin - the toy in the shared 'toy-mix' material (LINEAR vertex colours; brass slot for
//         the key and seam, plastic for the painted tin). Thin-instance 'color': white
//         normally, lerped toward ice blue while frozen.
//   kit - helmet and belt in 'army-plastic', thin-instance 'color' = LINEAR
//         teamColor('enemy') (frosted the same way).
//
// GAME API
//   createPenguinMeshes(scene, look): { tin: Mesh; kit: Mesh }
//     Synchronous, geometry cached; both thin-instance ready ('matrix' + 'color'), not
//     pickable, alwaysSelectAsActiveMesh, doNotSyncBoundingInfo, 'crowd' shadow casters
//     and receivers. Pivot on the floor between the feet, front +Z, authored for collision
//     radius PENGUIN_RADIUS (crowdLogic.ts): scale r / 0.24. Enemy unit: yaw PI.
//   Triangles: tin ~560 + kit ~130 (<= 700 in all).
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Look } from '../look/index.ts';
import {
  MIX,
  aoChecksum,
  armyPlasticMaterial,
  bakeAOFactors,
  bakedParts,
  buildMesh,
  cloneVD,
  encodeAO,
  lin,
  mergeParts,
  mixUv,
  mixedToyMaterial,
  place,
  roundedBox,
} from '../look/index.ts';
import type { ModelInfo, PreviewOptions, PreviewResult } from '../look/model.ts';
import { HOP_STYLE } from '../crowdLogic.ts';
import { revolve, scaled, shade, tube } from './soldier.ts';
import type { V3 } from './soldier.ts';
import { ball, crowdMesh, crowdPreview, mixPart } from './snowman.ts';
import type { CrowdPreviewUnit } from './snowman.ts';

export const info: ModelInfo = {
  key: 'penguin',
  title: 'Enemy wind-up tin penguin',
  instanced: true,
  teams: false,
  side: 'enemy',
  height: 1.05,
  triangleBudget: 700,
  gameZ: 40,
  variants: ['crowd', 'frozen'],
};

export interface PenguinMeshes {
  tin: Mesh;
  kit: Mesh;
}

const C = {
  back: '#253049', // navy-black lithographed tin
  belly: '#f1e7cf', // cream
  beak: '#ef8a2a',
  feet: '#e9792a',
  eye: '#f4efe4',
  pupil: '#202024',
  seam: '#c99a3e',
};

// Body: an egg of pressed tin around +Y (radius, y), oval in z.
const BODY: [number, number][] = [
  [0.07, 0.05],
  [0.19, 0.13],
  [0.222, 0.3],
  [0.205, 0.48],
  [0.15, 0.63],
  [0.134, 0.72],
  [0.134, 0.82],
  [0.09, 0.92],
  [0, 0.955],
];
const BODY_Z = 0.92;

// Paints the egg: navy back and head, cream belly and face (by the direction each vertex
// faces and its height), with a soft edge between them.
function paintBody(vd: VertexData): VertexData {
  const p = vd.positions as number[];
  const n = p.length / 3;
  const back = lin(C.back);
  const belly = lin(C.belly);
  const colors = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    const x = p[v * 3];
    const y = p[v * 3 + 1];
    const z = p[v * 3 + 2];
    const r = Math.hypot(x, z) || 1;
    const front = z / r; // 1 straight ahead
    // Belly up to the chin; the face patch round the eyes is narrower.
    const reach = y < 0.66 ? -0.2 : y < 0.9 ? 0.25 : 2;
    const edge = y < 0.1 ? 2 : reach;
    const t = Math.min(1, Math.max(0, (front - edge) / 0.25));
    colors[v * 4] = back.r + (belly.r - back.r) * t;
    colors[v * 4 + 1] = back.g + (belly.g - back.g) * t;
    colors[v * 4 + 2] = back.b + (belly.b - back.b) * t;
    colors[v * 4 + 3] = 1;
  }
  vd.colors = colors;
  return mixUv(vd, MIX.plastic);
}

function tin(): VertexData {
  const p: VertexData[] = [];
  p.push(paintBody(scaled(revolve(BODY, 12), 1, 1, BODY_Z)));
  // Soldered seam band round the middle (printed gold).
  p.push(
    mixPart(
      scaled(
        revolve(
          [
            [0.222, 0.335],
            [0.232, 0.35],
            [0.222, 0.365],
          ],
          12,
        ),
        1,
        1,
        BODY_Z,
      ),
      C.seam,
      MIX.brass,
    ),
  );
  // Beak and eyes.
  p.push(
    mixPart(
      tube(
        [
          { p: [0, 0.8, 0.095], a: 0.045, b: 0.03 },
          { p: [0, 0.79, 0.17], a: 0.028, b: 0.018 },
          { p: [0, 0.775, 0.225], a: 0.004 },
        ],
        6,
        [1, 0, 0],
        0,
        0.3,
      ),
      C.beak,
      MIX.plastic,
    ),
  );
  for (const s of [-1, 1]) {
    p.push(mixPart(ball([s * 0.058, 0.845, 0.098], 0.03, 5, 3), C.eye, MIX.plastic));
    p.push(mixPart(ball([s * 0.062, 0.848, 0.122], 0.016, 4, 2), C.pupil, MIX.rubber));
  }
  // Flippers held out and back for balance.
  for (const s of [-1, 1])
    p.push(
      mixPart(
        tube(
          [
            { p: [s * 0.19, 0.58, 0.0], a: 0.055, b: 0.022 },
            { p: [s * 0.25, 0.45, -0.02], a: 0.06, b: 0.02 },
            { p: [s * 0.3, 0.33, -0.05], a: 0.035, b: 0.014 },
          ],
          6,
          [0, 0, 1],
          0.4,
          0.6,
        ),
        C.back,
        MIX.plastic,
      ),
    );
  // Paddle feet poking out in front.
  for (const s of [-1, 1]) {
    const foot = scaled(ball([0, 0, 0], 0.07, 6, 3), 1, 0.35, 1.45);
    p.push(mixPart(place(foot, { x: s * 0.08, y: 0.022, z: 0.1, ry: s * 0.25 }), C.feet, MIX.plastic));
  }
  // Brass wind-up key on the back: shaft, a collar and a two-lobed bow.
  const keyZ = -0.205;
  p.push(
    mixPart(
      tube(
        [
          { p: [0, 0.46, keyZ + 0.02], a: 0.026 },
          { p: [0, 0.46, keyZ - 0.03], a: 0.026 },
          { p: [0, 0.46, keyZ - 0.035], a: 0.016 },
          { p: [0, 0.46, keyZ - 0.1], a: 0.016 },
        ],
        6,
        [1, 0, 0],
        0,
        0.4,
      ),
      C.seam,
      MIX.brass,
    ),
  );
  for (const s of [-1, 1]) p.push(mixPart(ball([s * 0.062, 0.46, keyZ - 0.11], 0.06, 6, 3, 0.85), C.seam, MIX.brass));
  // Flatten the bow lobes into plates (z).
  return mergeParts(p);
}

// The key's bow is flattened in z after the merge (its two lobes are the last parts).
function flattenBow(vd: VertexData): VertexData {
  const p = vd.positions as number[];
  const nrm = vd.normals as number[];
  const zc = -0.205 - 0.11;
  for (let i = 0; i < p.length; i += 3) {
    if (p[i + 2] < zc + 0.07 && p[i + 2] > zc - 0.07 && Math.abs(p[i + 1] - 0.46) < 0.07 && Math.abs(p[i]) > 0.012) {
      p[i + 2] = zc + (p[i + 2] - zc) * 0.3;
      nrm[i + 2] *= 3;
      const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1;
      nrm[i] /= l;
      nrm[i + 1] /= l;
      nrm[i + 2] /= l;
    }
  }
  return vd;
}

function kit(): VertexData {
  const p: VertexData[] = [];
  // A tiny M1 helmet (the rifleman's) sitting on the round head.
  const helmet = revolve(
    [
      [0.12, 0.0],
      [0.19, -0.02],
      [0.14, 0.03],
      [0.136, 0.09],
      [0.09, 0.15],
      [0, 0.17],
    ],
    10,
    [0.68, 0.72, 0.86, 0.9, 0.9, 0.9],
  );
  p.push(place(scaled(helmet, 0.88, 0.85, 0.92), { y: 0.895, z: -0.03, rx: -0.2 }));
  // Belt with a lighter buckle.
  p.push(
    shade(
      scaled(
        revolve(
          [
            [0.215, 0.205],
            [0.231, 0.235],
            [0.218, 0.265],
          ],
          12,
        ),
        1,
        1,
        BODY_Z,
      ),
      0.82,
    ),
  );
  const buckle = roundedBox(0.075, 0.06, 0.03, 0.01, 0);
  buckle.uvs = null;
  p.push(shade(place(buckle, { y: 0.235, z: 0.21 }), 1.05));
  return mergeParts(p);
}

// ---------- AO, cache, meshes ----------
const AO_OPTS = { samples: 20, maxDist: 0.35, strength: 0.6, maxTriangles: 4000 };
const AO_BAKED = {
  tin: 'MyYmGiYmGiYmJjMmf3+Mf3N/c3OZjH9/zP//////zOXl5fLlGvL/////DeXlAPLl2f//8v//5f//8v/y8v//8v//8v//8v//5fLlzMzy5b+mmbLZAAAAAAAAAAAAAAAAAL/y5eXy8szM5fLl5Zn//////6bl8uX//3Py//L/8mbl8sz/zAAAAABMQNnZzPKMpvL////Z2f8zDQBAJrLMZjPy8mYzDXMzMzMADTMNAEBAZnO/8tmm5bIzAEBAZnMmzL9mJvLyc0BmmVkzJgANQBoAGibMv2Zm5bLM8uVmZmYAAEBm5bLM5eW/DRrl///lMzPZ///ljHN/2eUaGr/y/+UzM9n//9lmmfL//3/MAA1zTAAapmYAAL9ZABqmWQANTEwADXNMAA1zTA0asmYADbJmAA2yTAAATEwADYxMABpmWQ0asmamMzOmsrLZspnMzMy/sqayzL8AmYwAspnlv7+/5X9Ac6Z/jIym2fL/8v//////8vL/v7+/5eX/8vKZjH+mc2ZmjNm/v+X//////////+X/8vI=',
  kit: 'TEAzMzNMWWZzWfLy//Ly5fLy5fLy//////L////y////////////////////////////pqayf7K/pqampr+mzOXZAOXlzMzl5eXZ2fLyv/Ly2eX/8vLZM0ym8iZMpvJMTPLyJjOmpqam8vImM0xM',
};
const AO_CHECK = { tin: 1166885, kit: 340021 };

function rawTin(): VertexData {
  return flattenBow(tin());
}

let cached: { tin: VertexData; kit: VertexData } | null = null;

function geometry(): { tin: VertexData; kit: VertexData } {
  if (!cached) {
    const [t, k] = bakedParts(
      'penguin',
      [rawTin(), kit()],
      [
        { b64: AO_BAKED.tin, check: AO_CHECK.tin },
        { b64: AO_BAKED.kit, check: AO_CHECK.kit },
      ],
      AO_OPTS,
    );
    cached = { tin: cloneVD(t), kit: cloneVD(k) };
  }
  return cached;
}

// Tool: recomputes AO_BAKED / AO_CHECK (run through vite's ssrLoadModule).
export function penguinAOTable(): { baked: Record<'tin' | 'kit', string>; check: Record<'tin' | 'kit', number> } {
  const parts = [rawTin(), kit()];
  const f = bakeAOFactors(parts, AO_OPTS);
  return {
    baked: { tin: encodeAO(f[0]), kit: encodeAO(f[1]) },
    check: { tin: aoChecksum(parts[0].positions as number[]), kit: aoChecksum(parts[1].positions as number[]) },
  };
}

export function penguinTriangles(): { tin: number; kit: number } {
  const g = geometry();
  return {
    tin: (g.tin.indices as ArrayLike<number>).length / 3,
    kit: (g.kit.indices as ArrayLike<number>).length / 3,
  };
}

export function createPenguinMeshes(scene: Scene, look: Look): PenguinMeshes {
  const g = geometry();
  const mix = look.material('toy-mix', () => mixedToyMaterial(scene));
  const plastic = look.material('army-plastic', () => armyPlasticMaterial(scene));
  return {
    tin: crowdMesh(buildMesh(scene, 'penguinTin', cloneVD(g.tin), mix), look),
    kit: crowdMesh(buildMesh(scene, 'penguinKit', cloneVD(g.kit), plastic), look),
  };
}

// ---------- preview ----------
// A waddling flock coming at the camera ('frozen': half of them frosted).
export function preview(scene: Scene, look: Look, opts: PreviewOptions): PreviewResult {
  const m = createPenguinMeshes(scene, look);
  const frozen = opts.variant === 'frozen';
  const units: CrowdPreviewUnit[] = [];
  const at: V3[] = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 4; c++) at.push([(c - 1.5) * 0.62 + (r % 2) * 0.2, 0, (r - 1) * 0.65]);
  at.forEach(([x, , z], i) => units.push({ x, z, yaw: 0.55, s: 1, frost: frozen && i % 4 >= 2 ? 1 : 0 }));
  units.push({ x: 0.2, z: 1.6, yaw: 0, s: 1, frost: 0 });
  return crowdPreview(
    scene,
    'penguinRoot',
    [
      { mesh: m.tin, team: false },
      { mesh: m.kit, team: true },
    ],
    units,
    HOP_STYLE.penguin,
  );
}
