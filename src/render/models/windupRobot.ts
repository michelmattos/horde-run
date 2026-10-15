// Enemy wind-up tin robot (World 3, variant 18): the Clockwork Workshop's foot soldier, a
// lithographed tin toy that clanks at the player in stop-and-go bursts. A boxy body
// printed pillar-box red with a tan chest plate and tan shoulder pads (the enemy army's
// colour, so it reads as 'theirs' at arm's length), a printed dial and brass rivets; a
// bare-tin box head with big round cream eyes, a grille mouth, ear bolts and an antenna
// with a red bead; tin arms reaching forward with pincer hands, short tin legs on
// navy-painted feet. A brass wind-up key sticks out of its back and turns (a separate
// mesh the crowd spins per instance). ~1.25 tall on a radius-0.36 footprint.
//
// Two meshes, both in the shared 'toy-mix' material (LINEAR vertex colours; the brass
// slot for bare tin and brass, plastic for the printed paint):
//   tin - the robot. Thin-instance 'color': white normally (x per-unit shade), lerped
//         toward ice blue while a Blizzard holds the enemy.
//   key - the wind-up key, authored at the ORIGIN with its shaft along -Z: draw it at the
//         robot's matrix offset by ROBOT_KEY (root-local, rotate with rotateLocal) and
//         rolled by the key angle (crowdLogic.GaitTracker). Thin-instance 'color' as tin.
//
// GAME API
//   createWindupRobotMeshes(scene, look): { tin: Mesh; key: Mesh }
//     Synchronous, geometry cached; thin-instance ready ('matrix' + 'color'), not
//     pickable, alwaysSelectAsActiveMesh, doNotSyncBoundingInfo, 'crowd' shadow casters
//     and receivers. Pivot on the floor between the feet, front +Z, authored for collision
//     radius ROBOT_RADIUS (crowdLogic.ts, 0.36): scale r / 0.36. Enemy unit: yaw PI.
//   ROBOT_KEY: { x, y, z } where the key's origin sits on the robot (unscaled).
//   Triangles: tin ~650 + key ~110.
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Look } from '../look/index.ts';
import {
  MIX,
  aoChecksum,
  bakeAOFactors,
  bakedParts,
  buildMesh,
  cloneVD,
  encodeAO,
  mergeParts,
  mixedToyMaterial,
  place,
  roundedBox,
  teamColor,
} from '../look/index.ts';
import type { TeamName } from '../look/palette.ts';
import type { ModelInfo, PreviewOptions, PreviewResult } from '../look/model.ts';
import { HOP_STYLE, ROBOT_RADIUS, frostColor, rotateLocal, tinRock } from '../crowdLogic.ts';
import type { HopStyle } from '../crowdLogic.ts';
import { writeTRS } from '../fxLogic.ts';
import { tube } from './soldier.ts';
import type { V3 } from './soldier.ts';
import { ball, crowdMesh, mixPart } from './snowman.ts';

export const info: ModelInfo = {
  key: 'windupRobot',
  title: 'Enemy wind-up tin robot',
  instanced: true,
  teams: false,
  side: 'enemy',
  height: 1.25,
  triangleBudget: 1300,
  gameZ: 40,
  variants: ['crowd', 'frozen'],
};

export interface WindupRobotMeshes {
  tin: Mesh;
  key: Mesh;
}

export const ROBOT_KEY = { x: 0, y: 0.6, z: -0.165 } as const;

const C = {
  red: '#b5372f', // lithographed tin (workshop palette)
  redDark: '#8a2722',
  tan: '#c8a46a', // HEX.tan: the enemy army's colour as the team cue
  tanDark: '#8f6f3e',
  tin: '#c9ced4',
  tinDark: '#8d959d',
  navy: '#22355e',
  cream: '#efe3c6',
  pupil: '#1d1d1f',
  brass: '#d2a33f',
  grille: '#2b2f36',
  bead: '#d93a2f',
};

function boxPart(
  w: number,
  h: number,
  d: number,
  r: number,
  t: Parameters<typeof place>[1],
  color: string,
  slot: (typeof MIX)[keyof typeof MIX],
  seg = 1,
): VertexData {
  const vd = roundedBox(w, h, d, r, seg);
  vd.uvs = null;
  return mixPart(place(vd, t), color, slot);
}

function rod(a: V3, b: V3, r: number, color: string, slot: (typeof MIX)[keyof typeof MIX], sides = 6): VertexData {
  return mixPart(
    tube(
      [
        { p: a, a: r },
        { p: b, a: r },
      ],
      sides,
      [1, 0, 0],
      0.5,
      0.5,
    ),
    color,
    slot,
  );
}

function tin(): VertexData {
  const p: VertexData[] = [];
  // Feet, legs and the hip skirt.
  for (const s of [-1, 1]) {
    p.push(boxPart(0.15, 0.07, 0.25, 0.03, { x: s * 0.1, y: 0.035, z: 0.03 }, C.navy, MIX.plastic, 0));
    p.push(boxPart(0.1, 0.22, 0.11, 0.03, { x: s * 0.1, y: 0.18, z: 0 }, C.tin, MIX.brass, 0));
    // Knee bolt.
    p.push(mixPart(ball([s * 0.1, 0.19, 0.058], 0.022, 5, 2), C.brass, MIX.brass));
  }
  p.push(boxPart(0.4, 0.09, 0.28, 0.035, { y: 0.32 }, C.navy, MIX.plastic, 0));
  // Body: printed red tin box with a soldered tin seam band and a tan chest plate.
  p.push(boxPart(0.46, 0.42, 0.32, 0.06, { y: 0.575 }, C.red, MIX.plastic));
  p.push(boxPart(0.47, 0.035, 0.33, 0.015, { y: 0.39 }, C.tinDark, MIX.brass, 0));
  p.push(boxPart(0.3, 0.24, 0.03, 0.02, { y: 0.6, z: 0.16 }, C.tan, MIX.plastic));
  // A printed dial on the plate: cream face, navy rim, red needle.
  p.push(mixPart(place(ball([0, 0, 0], 0.055, 8, 2), { y: 0.64, z: 0.175, sz: 0.25 }), C.navy, MIX.plastic));
  p.push(mixPart(place(ball([0, 0, 0], 0.044, 8, 2), { y: 0.64, z: 0.18, sz: 0.25 }), C.cream, MIX.plastic));
  p.push(boxPart(0.008, 0.04, 0.01, 0, { x: 0.01, y: 0.655, z: 0.19, rz: -0.6 }, C.redDark, MIX.plastic, 0));
  // Two printed buttons under the dial.
  for (const s of [-1, 1]) p.push(mixPart(ball([s * 0.06, 0.53, 0.178], 0.018, 5, 2), C.redDark, MIX.plastic));
  // Brass rivets on the front corners.
  for (const sx of [-1, 1])
    for (const y of [0.42, 0.74]) p.push(mixPart(ball([sx * 0.2, y, 0.16], 0.016, 4, 2), C.brass, MIX.brass));
  // Tan shoulder pads (team cue) and the arms reaching forward to pincer hands.
  for (const s of [-1, 1]) {
    p.push(mixPart(place(ball([0, 0, 0], 0.085, 8, 3), { x: s * 0.255, y: 0.73, sy: 0.7 }), C.tan, MIX.plastic));
    const sh: V3 = [s * 0.27, 0.69, 0];
    const el: V3 = [s * 0.3, 0.55, 0.12];
    const wr: V3 = [s * 0.28, 0.52, 0.3];
    p.push(rod(sh, el, 0.042, C.tin, MIX.brass));
    p.push(rod(el, wr, 0.038, C.tin, MIX.brass));
    p.push(mixPart(ball(el, 0.048, 6, 3), C.brass, MIX.brass));
    for (const dy of [-1, 1])
      p.push(
        boxPart(
          0.03,
          0.025,
          0.09,
          0.01,
          { x: wr[0], y: wr[1] + dy * 0.028, z: wr[2] + 0.045, rx: dy * 0.25 },
          C.tinDark,
          MIX.brass,
          0,
        ),
      );
  }
  // Neck and head: a bare-tin box with round eyes, a grille mouth and ear bolts.
  p.push(rod([0, 0.78, 0], [0, 0.84, 0], 0.07, C.tinDark, MIX.brass, 8));
  p.push(boxPart(0.34, 0.27, 0.28, 0.05, { y: 0.96 }, C.tin, MIX.brass));
  p.push(boxPart(0.35, 0.03, 0.29, 0.012, { y: 1.08 }, C.red, MIX.plastic, 0));
  for (const s of [-1, 1]) {
    p.push(
      mixPart(
        place(ball([0, 0, 0], 0.062, 12, 3), { x: s * 0.075, y: 0.99, z: 0.135, sz: 0.55 }),
        C.cream,
        MIX.plastic,
      ),
    );
    p.push(
      mixPart(place(ball([0, 0, 0], 0.03, 8, 2), { x: s * 0.075, y: 0.99, z: 0.165, sz: 0.5 }), C.pupil, MIX.rubber),
    );
    p.push(rod([s * 0.17, 0.96, 0], [s * 0.21, 0.96, 0], 0.04, C.brass, MIX.brass, 8));
  }
  p.push(boxPart(0.16, 0.05, 0.02, 0.01, { y: 0.89, z: 0.14 }, C.grille, MIX.rubber, 0));
  for (const x of [-0.05, 0, 0.05])
    p.push(boxPart(0.012, 0.05, 0.01, 0, { x, y: 0.89, z: 0.152 }, C.brass, MIX.brass, 0));
  // Antenna with a red bead.
  p.push(rod([0, 1.09, -0.02], [0, 1.2, -0.02], 0.012, C.tinDark, MIX.brass, 4));
  p.push(mixPart(ball([0, 1.215, -0.02], 0.035, 6, 3), C.bead, MIX.plastic));
  // The key's collar on the back (the turning bow is the separate key mesh).
  p.push(rod([0, ROBOT_KEY.y, ROBOT_KEY.z + 0.02], [0, ROBOT_KEY.y, ROBOT_KEY.z - 0.01], 0.04, C.brass, MIX.brass, 8));
  return mergeParts(p);
}

// The key at the origin, shaft along -Z: a stem, a hub and a two-lobed flat bow.
function key(): VertexData {
  const p: VertexData[] = [];
  p.push(rod([0, 0, 0], [0, 0, -0.07], 0.016, C.brass, MIX.brass, 6));
  p.push(mixPart(ball([0, 0, -0.08], 0.03, 6, 3), C.brass, MIX.brass));
  for (const s of [-1, 1])
    p.push(mixPart(place(ball([0, 0, 0], 0.085, 8, 3), { x: s * 0.095, z: -0.09, sz: 0.3 }), C.brass, MIX.brass));
  return mergeParts(p);
}

// ---------- AO, cache, meshes ----------
const AO_OPTS = { samples: 20, maxDist: 0.35, strength: 0.6, maxTriangles: 4000 };
const AO_BAKED =
  'QJkmskDMJuXMmeWyQEAmJiYm5bJAQMyZQDMzQFlMTFlMM1lAWUBMM0wzWUBZQEwzM2ZAWbKMWb+ZJjMzDQAAM2ZATLIzzECmJtmmstnMQEwmMyYz2cxATKayTFlMTFlATFlAWVlMWUxMTExMWUxZTEBZWaZmZr+mQKZ/DRoNDQAaWaZmzIzMmb+Zv5mZjJmZv8y/zL/MmZm/zJmMAPL/8gD/2dkA8rLlAMzy/wDy//IA/8zlANm/5QDM8v/y8uXy5aaZ2eWMsuX/2fL/AAAAAAAaQAAAJkAAAAAAAAAAAADM8uXM8v//8v/Z8v8AAAAA8v//8v/////y8uXy//Ly2f/y/7/y8r/Z////8v/yv9n///LyAA0NAHNmc39zZnN/v8zZ2QAaGgBzZnNzc2Zzc8zZ5fIAGgAAc39/f3N/f3/y8vLZABoNAHN/f3Nzf39zzNnMv8zZzL/Z8uXM5fLy2fLy8tkAGg0AGkBMDRpAJg0AGgAAc3N/f7KMmQCMZrKZc3N/AAAAAAAAAAAAc3N/fwB/jLKZmQCyf7+mcwCMcwB/fwBzcwBzfwB/AHN/fwCZspmZjJmZAAB/f/////8AAAAAjHNmzPK/psyZTABMMwAmjHNmf3NzzPLMpsymTABMMwAmf3Nzf3Nz2fLMpsyZJjMzf3Nzc3OMzP//meXlMw1zc3OMptmZ2f+/f39mJjNMptmZv9nyzP/yc3+mQBp/v9nyAGYzmQAzGpkAmcyyAOX/2QD///IA///lALLZpgBAGowAZjOZAAAAAPJmfwAA/wAAAAAAAAAAAADM5eX/8vIApplZWQC/AAAAzADyAPL//wDM8gAAsnMAAJlZWQDMTP/y8kz/8kxM8vLyzP/////y8vLMTEwAsvL/AOXy/+Wy//8AAPLy8vL//wAA5bIA///lANn/8gCm5cwAQBqyAFkmjAAzDZkAv+W/AP//2QD//+UAAAAAWeX/AAB/AAAAAAAAAAAAAP/l5dnl/wCy5f//AOUA8gC/AAAApllZAKZzAADZ5QAA5f//APJM///MTP/yTEzy/8zy//////L/zPJMTADl8v8AsuX/suX//wAA5fLl8v//AACy5RoaDRoaJhoaAAAAAAAAAABMAOX//wCZ8v8AjMzyANn/8gDM//8AmdnyAH/y/wDM//IAAAAAAAD/8gAA8v8AAAAAAMzMzOWZJjOZfzMzjMy/v9nMv7/Z//L///Ly8vIAAAAAzMzM5f//////////AAAAAOX/8v/y//L///////Ll8vLy8v//8uX//wAAAAAAjJkAALLMAADM8gAAzOUAAMzZAAAAAAAAAAAAAAAAAA0mGgANDQAAAAAAAAAAAAB/jLKMv7+//8zM8tmZzL9mAIxmAHNZAIx/jLINDQ0NDQ0NDdnl5cymv/LlAP8AAAAAANnZAADZ5QAAzPIAAKbZAACZpgAAAAAAAAAAAA0NDQANJgAAAAAAAAAAAAAAAAAApsy/svK/v//Mptm/jIymZgB/TAB/ZgCZpsy/AAAAAAAAAADl5eW/srLl5QD/AAC/sgAAv7IAALKyAAC/v7+/srIAAAAAZlmMc39zmYxmZn+Mf3N/f/////8AAAAAZmaMf3NZf4xzc4yMf39/f/////8AAAAAf3+MjHNmjIxmZn9zf39/f/////8ADQAAAAAAAAAAAAAAAACm8v8Amf//AJn//wCM//8Av///AL///wCm8v8ADQAAAAANAMy/zL/MssyyAP8=';
const AO_CHECK = 5012392;

let cached: { tin: VertexData; key: VertexData } | null = null;

function geometry(): { tin: VertexData; key: VertexData } {
  if (!cached) {
    const [t] = bakedParts('windupRobot', [tin()], [{ b64: AO_BAKED, check: AO_CHECK }], AO_OPTS);
    // Metal: occlusion mostly darkens reflections; keep the bake a little gentler.
    const c = t.colors as Float32Array | number[];
    const raw = tin().colors as ArrayLike<number>;
    for (let i = 0; i < c.length; i++) if (i % 4 !== 3) c[i] = raw[i] - (raw[i] - c[i]) * 0.8;
    cached = { tin: cloneVD(t), key: cloneVD(key()) };
  }
  return cached;
}

// Tool: recomputes AO_BAKED / AO_CHECK (run through vite's ssrLoadModule).
export function windupRobotAOTable(): { baked: string; check: number } {
  const raw = tin();
  const [f] = bakeAOFactors([raw], AO_OPTS);
  return { baked: encodeAO(f), check: aoChecksum(raw.positions as number[]) };
}

export function windupRobotTriangles(): { tin: number; key: number } {
  const g = geometry();
  return {
    tin: (g.tin.indices as ArrayLike<number>).length / 3,
    key: (g.key.indices as ArrayLike<number>).length / 3,
  };
}

export function createWindupRobotMeshes(scene: Scene, look: Look): WindupRobotMeshes {
  const g = geometry();
  const mix = look.material('toy-mix', () => mixedToyMaterial(scene));
  return {
    tin: crowdMesh(buildMesh(scene, 'robotTin', cloneVD(g.tin), mix), look),
    key: crowdMesh(buildMesh(scene, 'robotKey', cloneVD(g.key), mix), look),
  };
}

// ---------- preview (shared with the Wind-up Robot champion) ----------
// A thin-instanced group of wind-up figures: `body` meshes share each unit's matrix, `key`
// meshes are hung at keyAt and spun; `team` meshes take the team colour (x tint).
export interface KeyedPreviewMesh {
  mesh: Mesh;
  team: boolean;
  key: boolean;
}
export interface KeyedPreviewUnit {
  x: number;
  z: number;
  yaw: number;
  s: number;
  frost: number;
}

export function keyedPreview(
  scene: Scene,
  name: string,
  meshes: KeyedPreviewMesh[],
  units: KeyedPreviewUnit[],
  style: HopStyle,
  keyAt: { x: number; y: number; z: number },
  army: TeamName,
  tint = 1,
): PreviewResult {
  const root = new TransformNode(name, scene);
  const body = new Float32Array(units.length * 16);
  const keys = new Float32Array(units.length * 16);
  const team = teamColor(army);
  const tmp = [0, 0, 0];
  const off = { x: 0, y: 0, z: 0 };
  for (const m of meshes) {
    m.mesh.parent = root;
    const colors = new Float32Array(units.length * 4);
    units.forEach((u, i) => {
      const [r, g, b] = m.team ? [team.r * tint, team.g * tint, team.b * tint] : [1, 1, 1];
      frostColor(r, g, b, u.frost, tmp);
      colors.set([tmp[0], tmp[1], tmp[2], 1], i * 4);
    });
    m.mesh.thinInstanceSetBuffer('matrix', m.key ? keys : body, 16, false);
    m.mesh.thinInstanceSetBuffer('color', colors, 4, true);
  }
  const write = (time: number): void => {
    units.forEach((u, i) => {
      const live = 1 - u.frost;
      const ph = time * 10 * style.speed + u.x * 3.7 + u.z * 1.9;
      const rock = tinRock(ph) * live;
      const y = Math.abs(Math.sin(ph)) * 0.11 * style.height * u.s * live;
      const pitch = Math.abs(rock) * 0.16 * style.lean;
      const roll = rock * 0.1 * style.waddle;
      writeTRS(body, i * 16, u.x, y, u.z, u.s, u.s, u.s, u.yaw, pitch, roll);
      rotateLocal(keyAt.x * u.s, keyAt.y * u.s, keyAt.z * u.s, u.yaw, pitch, roll, off);
      const spin = time * 6 * live + i;
      writeTRS(keys, i * 16, u.x + off.x, y + off.y, u.z + off.z, u.s, u.s, u.s, u.yaw, pitch, roll + spin);
    });
  };
  write(0.37);
  return {
    root,
    update(time) {
      write(time);
      for (const m of meshes) m.mesh.thinInstanceBufferUpdated('matrix');
    },
    dispose() {
      root.dispose();
    },
  };
}

// A squad clanking at the camera ('frozen': half of them frosted by a Blizzard).
export function preview(scene: Scene, look: Look, opts: PreviewOptions): PreviewResult {
  const m = createWindupRobotMeshes(scene, look);
  const frozen = opts.variant === 'frozen';
  const units: KeyedPreviewUnit[] = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 4; c++)
      units.push({
        x: (c - 1.5) * 0.85 + (r % 2) * 0.25,
        z: (r - 1) * 0.85,
        yaw: 0.55,
        s: 0.36 / ROBOT_RADIUS,
        frost: frozen && c >= 2 ? 1 : 0,
      });
  units.push({ x: 0.3, z: 2, yaw: Math.PI, s: 1, frost: 0 }); // back view: the key
  return keyedPreview(
    scene,
    'windupRobotRoot',
    [
      { mesh: m.tin, team: false, key: false },
      { mesh: m.key, team: false, key: true },
    ],
    units,
    HOP_STYLE.robot,
    ROBOT_KEY,
    'enemy',
  );
}
