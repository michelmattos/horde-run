// Mob variants (Milestone 4): three more plastic army men that march beside the rifleman,
// each with a silhouette that reads at ~30-60 px on a phone.
//
//   knight   - a green plastic knight: bucket great helm with a visor slit and a crest,
//              pauldrons, a flared tabard, a heater shield with a moulded cross on the left
//              arm and a sword raised over the right shoulder (the tall spike reads from
//              far away). Drawn ~2x the rifleman (knights are 'heavy' units, radius 0.55).
//   sprinter - a messenger at full tilt: torso pitched forward, a long stride with the
//              rear foot pushing off its toe, arms pumping, a soft side cap, a scarf
//              streaming back and only a satchel for kit (no pack, no rifle).
//   bomber   - a stocky sapper braced wide under a big box pack with three spare
//              firecrackers sticking out of it, goggles on his helmet, hugging a big red
//              paper firecracker with a lit fuse. The firecrackers are a second mesh (red
//              paper, cream bands) because a team-coloured body cannot be red.
//
// Same build as models/soldier.ts (whose tube / revolve helpers they share): smooth tubes
// and surfaces of revolution, greyscale vertex shading (team colour multiplies in), AO
// baked offline into AO_BAKED (with a checksum; a stale table bakes at runtime once),
// darker feet, one mesh and the shared 'army-plastic' material per variant.
//
// GAME API
//   createSoldierVariantMesh(scene, look, 'knight' | 'sprinter' | 'bomber'): Mesh
//     Synchronous (geometry cached per session). Ready for thinInstanceSetBuffer('matrix')
//     and ('color', LINEAR teamColor(team)), like the soldier: alwaysSelectAsActiveMesh,
//     not pickable, doNotSyncBoundingInfo, registered as a 'crowd' shadow caster and
//     shadow receiver. Pivot at the base-plate centre on y = 0, front +Z, authored on
//     the rifleman's scale (mob radius 0.28; knights get scale r / 0.28 x KNIGHT_SCALE).
//   createBomberAccentMesh(scene, look): Mesh
//     The bomber's firecrackers in the same local space: give it the bomber batch's
//     matrices (same order), NO colour buffer. 'crowd' shadow caster.
//   Heights: knight 1.53 (sword tip; helm 1.3), sprinter 1.15, bomber 1.28.
//   Triangles: knight ~1,060, sprinter ~670, bomber ~910 (+ accent ~370).
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Look } from '../look/index.ts';
import {
  armyPlasticMaterial,
  bakeVertexAO,
  buildMesh,
  lin,
  mergeParts,
  paint,
  place,
  plasticMaterial,
  roundedBox,
  teamColor,
} from '../look/index.ts';
import type { ModelInfo, PreviewOptions, PreviewResult } from '../look/model.ts';
import type { TeamName } from '../look/palette.ts';
import { footShade, lerp3, revolve, scaled, shade, tube } from './soldier.ts';
import type { Ring, V3 } from './soldier.ts';

export type MobVariant = 'knight' | 'sprinter' | 'bomber';
export const MOB_VARIANTS: readonly MobVariant[] = ['knight', 'sprinter', 'bomber'];

export const info: ModelInfo = {
  key: 'soldierVariants',
  title: 'Mob variants: knight, sprinter, bomber',
  instanced: true,
  teams: true,
  side: 'team',
  height: 1.5,
  triangleBudget: 900,
  gameZ: 14,
  variants: ['all', 'knight', 'sprinter', 'bomber'],
};

// Greyscale moulding multipliers (team colour multiplies on top).
const S = {
  body: 1,
  belt: 0.9,
  face: 1.06,
  armour: 0.95,
  armourDark: 0.84,
  helm: 0.92,
  slit: 0.4,
  crest: 0.8,
  shieldRim: 0.76,
  shieldFace: 1.05,
  cross: 0.8,
  steel: 1.04,
  hilt: 0.72,
  boots: 0.86,
  gear: 0.84,
  cap: 0.88,
  brim: 0.74,
  scarf: 0.8,
  goggles: 0.62,
  base: 1,
};

// Two-ring rounded tube from a to b (a limb segment, a rod).
function rod(
  a: V3,
  b: V3,
  ra: number,
  rb: number,
  sides: number,
  g: number,
  caps = 0.6,
  ref: V3 = [1, 0, 0],
): VertexData {
  return shade(
    tube(
      [
        { p: a, a: ra },
        { p: b, a: rb },
      ],
      sides,
      ref,
      caps,
      caps,
    ),
    g,
  );
}

// Limb through hip/shoulder -> joint -> end with a few rings.
function limb(a: V3, j: V3, b: V3, r0: number, r1: number, r2: number, sides: number, g: number): VertexData {
  const rings: Ring[] = [
    { p: a, a: r0 },
    { p: lerp3(a, j, 0.5), a: (r0 + r1) / 2 + 0.006 },
    { p: j, a: r1 },
    { p: lerp3(j, b, 0.45), a: (r1 + r2) / 2 + 0.004 },
    { p: b, a: r2 },
  ];
  return shade(tube(rings, sides, [1, 0, 0], 0.4, 0.4), g);
}

function boot(heel: V3, toe: V3, w: number, g = S.boots): VertexData {
  return tube(
    [
      { p: heel, a: w, b: w * 1.08, s: g },
      { p: toe, a: w * 0.95, b: w * 0.78, s: g },
    ],
    6,
    [1, 0, 0],
    0.6,
    0.75,
  );
}

function basePlate(sx: number, sz: number): VertexData {
  return shade(
    scaled(
      revolve(
        [
          [0.5, 0],
          [0.5, 0.02],
          [0.468, 0.04],
          [0, 0.04],
        ],
        16,
      ),
      sx,
      1,
      sz,
    ),
    S.base,
  );
}

// The rifleman's head (neck to crown), placed at c.
function head(c: V3): VertexData {
  const vd = revolve(
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
  return shade(place(scaled(vd, 1, 1, 1.06), { x: c[0], y: c[1], z: c[2] }), S.face);
}

// A small dome (pauldron, lens, knee cop) of radius r facing +Y, then placed.
function dome(r: number, sides: number, g: number, t: Parameters<typeof place>[1]): VertexData {
  const vd = revolve(
    [
      [r, -0.02 * r],
      [r * 0.96, r * 0.32],
      [r * 0.66, r * 0.72],
      [0, r * 0.86],
    ],
    sides,
  );
  return shade(place(vd, t), g);
}

// Rounded box; seg 0 is a plain 12-triangle box (small straps and pouches).
function box(
  w: number,
  h: number,
  d: number,
  r: number,
  g: number,
  t: Parameters<typeof place>[1],
  seg = 0,
): VertexData {
  const vd = roundedBox(w, h, d, r, seg);
  vd.uvs = null;
  return shade(place(vd, t), g);
}

// ---------------------------------------------------------------- knight
function buildKnight(): VertexData {
  const p: VertexData[] = [];
  p.push(basePlate(0.5, 0.58));
  // Legs in armour (greaves), knee cops, sabatons. Stance: left foot a little ahead.
  const hipL: V3 = [-0.09, 0.6, 0.03],
    kneeL: V3 = [-0.102, 0.37, 0.1],
    ankleL: V3 = [-0.106, 0.13, 0.08];
  const hipR: V3 = [0.09, 0.6, -0.02],
    kneeR: V3 = [0.106, 0.37, -0.05],
    ankleR: V3 = [0.11, 0.13, -0.09];
  p.push(limb(hipL, kneeL, ankleL, 0.09, 0.066, 0.056, 6, S.armour));
  p.push(limb(hipR, kneeR, ankleR, 0.09, 0.066, 0.056, 6, S.armour));
  p.push(boot([-0.106, 0.085, 0.03], [-0.108, 0.07, 0.19], 0.05));
  p.push(boot([0.11, 0.085, -0.14], [0.112, 0.07, 0.0], 0.05));
  // Tabard skirt flaring over the hips (the A-line reads as 'knight' in silhouette).
  p.push(
    shade(
      scaled(
        revolve(
          [
            [0.205, 0.385],
            [0.195, 0.43],
            [0.165, 0.54],
            [0.138, 0.64],
          ],
          12,
        ),
        1,
        1,
        0.82,
      ),
      S.body,
    ),
  );
  // Torso (breastplate) with a belt band.
  p.push(
    tube(
      [
        { p: [0, 0.6, 0.0], a: 0.138, b: 0.104, s: S.belt },
        { p: [0, 0.65, 0.005], a: 0.138, b: 0.106, s: S.armour },
        { p: [0, 0.77, 0.018], a: 0.158, b: 0.122, s: S.armour },
        { p: [0, 0.87, 0.022], a: 0.172, b: 0.116, s: S.armour },
        { p: [0, 0.94, 0.014], a: 0.15, b: 0.096, s: S.armour },
        { p: [0, 0.98, 0.008], a: 0.09, b: 0.066, s: S.armour },
      ],
      8,
      [1, 0, 0],
      0,
      0.45,
      Math.PI / 8,
    ),
  );
  // Pauldrons.
  p.push(dome(0.1, 6, S.armourDark, { x: -0.165, y: 0.895, z: 0.0, rz: 0.55 }));
  p.push(dome(0.1, 6, S.armourDark, { x: 0.165, y: 0.895, z: 0.0, rz: -0.55 }));
  // Sword arm raised; shield arm forward.
  const handR: V3 = [0.235, 1.12, 0.095];
  p.push(limb([0.17, 0.9, 0.0], [0.255, 0.97, 0.055], handR, 0.066, 0.05, 0.046, 6, S.body));
  const handL: V3 = [-0.2, 0.8, 0.2];
  p.push(limb([-0.17, 0.9, 0.0], [-0.245, 0.77, 0.09], handL, 0.066, 0.05, 0.046, 6, S.body));
  // Head (mostly hidden) and the great helm: a bucket with a dark visor slit at the
  // front and a crest along the top.
  p.push(head([0, 1.05, 0.02]));
  const helmProf: [number, number][] = [
    [0.112, -0.115],
    [0.126, -0.04],
    [0.127, -0.004],
    [0.127, 0.012],
    [0.127, 0.028],
    [0.118, 0.105],
    [0.086, 0.136],
    [0, 0.146],
  ];
  const helm = revolve(helmProf, 10, [0.8, S.helm, S.helm, S.slit, S.helm, S.helm, S.helm, S.helm]);
  {
    // The slit only at the front: restore the back half of the slit ring.
    const pos = helm.positions as number[];
    const col = helm.colors as number[];
    for (let v = 0; v < pos.length / 3; v++) {
      const y = pos[v * 3 + 1];
      if (Math.abs(y - 0.012) < 1e-4 && pos[v * 3 + 2] < 0.05) col[v * 4] = col[v * 4 + 1] = col[v * 4 + 2] = S.helm;
    }
  }
  p.push(place(scaled(helm, 1, 1, 1.05), { x: 0, y: 1.085, z: 0.02 }));
  p.push(
    shade(
      tube(
        [
          { p: [0, 1.2, -0.115], a: 0.014, b: 0.02 },
          { p: [0, 1.255, -0.035], a: 0.02, b: 0.048 },
          { p: [0, 1.255, 0.055], a: 0.02, b: 0.044 },
          { p: [0, 1.205, 0.12], a: 0.012, b: 0.018 },
        ],
        6,
        [1, 0, 0],
        0.6,
        0.6,
      ),
      S.crest,
    ),
  );
  // Heater shield on the left arm, facing forward and a little outward: a darker rim
  // plate, a lighter face and a moulded cross.
  const shield: VertexData[] = [];
  const shieldRings = (k: number, b: number): Ring[] => [
    { p: [0, 0.17 * k, 0], a: 0.15 * k, b },
    { p: [0, 0.08 * k, 0], a: 0.156 * k, b },
    { p: [0, -0.05 * k, 0], a: 0.132 * k, b },
    { p: [0, -0.15 * k, 0], a: 0.072 * k, b },
    { p: [0, -0.21 * k, 0], a: 0.012, b: b * 0.8 },
  ];
  shield.push(shade(tube(shieldRings(1, 0.026), 8, [1, 0, 0], 0.25, 0.4), S.shieldRim));
  shield.push(
    shade(place(tube(shieldRings(0.84, 0.02), 8, [1, 0, 0], 0.25, 0.4), { z: 0.016, y: 0.008 }), S.shieldFace),
  );
  shield.push(box(0.034, 0.27, 0.022, 0.01, S.cross, { y: 0.0, z: 0.038 }));
  shield.push(box(0.2, 0.034, 0.022, 0.01, S.cross, { y: 0.06, z: 0.038 }));
  for (const vd of shield) p.push(place(vd, { x: -0.245, y: 0.8, z: 0.2, ry: -0.42, rx: -0.12 }));
  // Sword: pommel, grip, crossguard and a flat blade raised over the right shoulder.
  const dir: V3 = [0.08, 0.96, -0.26];
  const dl = Math.hypot(dir[0], dir[1], dir[2]);
  const d: V3 = [dir[0] / dl, dir[1] / dl, dir[2] / dl];
  const at = (t: number): V3 => [handR[0] + d[0] * t, handR[1] + d[1] * t, handR[2] + d[2] * t];
  p.push(rod(at(-0.075), at(-0.05), 0.026, 0.02, 6, S.hilt, 0.8));
  p.push(rod(at(-0.05), at(0.045), 0.02, 0.02, 5, S.hilt, 0));
  p.push(
    rod(
      [at(0.055)[0] - 0.085, at(0.055)[1], at(0.055)[2]],
      [at(0.055)[0] + 0.085, at(0.055)[1], at(0.055)[2]],
      0.019,
      0.019,
      5,
      S.hilt,
      0.7,
    ),
  );
  p.push(
    shade(
      tube(
        [
          { p: at(0.06), a: 0.03, b: 0.01 },
          { p: at(0.3), a: 0.026, b: 0.009 },
          { p: at(0.42), a: 0.003, b: 0.004 },
        ],
        4,
        [1, 0, 0],
        0,
        0.2,
        0,
      ),
      S.steel,
    ),
  );
  return mergeParts(p);
}

// ---------------------------------------------------------------- sprinter
function buildSprinter(): VertexData {
  const p: VertexData[] = [];
  p.push(basePlate(0.46, 0.68));
  // Front leg planted ahead, rear leg pushing off its toe far behind.
  const hipF: V3 = [-0.08, 0.56, 0.05],
    kneeF: V3 = [-0.09, 0.42, 0.27],
    ankleF: V3 = [-0.1, 0.13, 0.29];
  const hipB: V3 = [0.08, 0.55, -0.04],
    kneeB: V3 = [0.09, 0.34, -0.18],
    ankleB: V3 = [0.1, 0.19, -0.35];
  p.push(limb(hipF, kneeF, ankleF, 0.082, 0.058, 0.048, 6, S.body));
  p.push(limb(hipB, kneeB, ankleB, 0.082, 0.058, 0.048, 6, S.body));
  p.push(boot([-0.1, 0.085, 0.24], [-0.1, 0.068, 0.385], 0.044));
  p.push(boot([0.1, 0.2, -0.42], [0.1, 0.064, -0.29], 0.042));
  // Torso pitched well forward, shoulders over the front knee.
  p.push(
    tube(
      [
        { p: [0, 0.5, 0.0], a: 0.13, b: 0.096, s: S.body },
        { p: [0, 0.585, 0.025], a: 0.126, b: 0.092, s: S.belt },
        { p: [0, 0.72, 0.085], a: 0.146, b: 0.106, s: S.body },
        { p: [0, 0.815, 0.135], a: 0.156, b: 0.102, s: S.body },
        { p: [0, 0.875, 0.165], a: 0.138, b: 0.086, s: S.body },
        { p: [0, 0.91, 0.185], a: 0.086, b: 0.062, s: S.body },
      ],
      8,
      [1, 0, 0],
      0,
      0.45,
      Math.PI / 8,
    ),
  );
  // Satchel on the right hip and its strap across the chest.
  p.push(box(0.1, 0.12, 0.07, 0.025, S.gear, { x: 0.15, y: 0.56, z: -0.03, ry: 0.3 }));
  p.push(
    shade(
      tube(
        [
          { p: [-0.13, 0.86, 0.17], a: 0.022, b: 0.008 },
          { p: [0.0, 0.73, 0.2], a: 0.022, b: 0.008 },
          { p: [0.14, 0.6, 0.05], a: 0.022, b: 0.008 },
        ],
        4,
        [0, 0, 1],
        0,
        0,
      ),
      S.gear,
    ),
  );
  // Arms pumping: left fist forward at chin height, right elbow driven back.
  p.push(limb([-0.15, 0.86, 0.15], [-0.205, 0.71, 0.29], [-0.125, 0.86, 0.41], 0.062, 0.048, 0.044, 6, S.body));
  p.push(limb([0.15, 0.86, 0.13], [0.215, 0.73, -0.03], [0.205, 0.86, -0.15], 0.062, 0.048, 0.044, 6, S.body));
  // Head forward, a soft side cap with a short bill.
  const hc: V3 = [0, 0.99, 0.245];
  p.push(head(hc));
  p.push(
    place(
      scaled(
        revolve(
          [
            [0.098, -0.01],
            [0.104, 0.025],
            [0.092, 0.06],
            [0.056, 0.085],
            [0, 0.092],
          ],
          10,
          [S.brim, S.cap, S.cap, S.cap, S.cap],
        ),
        1,
        1,
        1.08,
      ),
      { x: hc[0], y: hc[1] + 0.035, z: hc[2] - 0.008, rx: 0.12 },
    ),
  );
  p.push(
    shade(
      place(
        scaled(
          revolve(
            [
              [0.075, 0],
              [0.072, 0.012],
              [0, 0.016],
            ],
            8,
          ),
          1,
          1,
          0.62,
        ),
        { x: hc[0], y: hc[1] + 0.03, z: hc[2] + 0.085, rx: -0.08 },
      ),
      S.brim,
    ),
  );
  // Scarf: round the neck, the tail streaming back over the shoulder.
  p.push(
    shade(
      tube(
        [
          { p: [0, 0.915, 0.21], a: 0.07, b: 0.022 },
          { p: [0.03, 0.95, 0.09], a: 0.055, b: 0.016 },
          { p: [0.06, 0.985, -0.05], a: 0.048, b: 0.013 },
          { p: [0.085, 0.995, -0.17], a: 0.04, b: 0.01 },
          { p: [0.1, 0.975, -0.26], a: 0.03, b: 0.008 },
        ],
        6,
        [1, 0, 0],
        0.3,
        0.5,
      ),
      S.scarf,
    ),
  );
  return mergeParts(p);
}

// ---------------------------------------------------------------- bomber
// Firecracker axis carried across the chest.
const FC_A: V3 = [-0.125, 0.72, 0.21];
const FC_B: V3 = [0.115, 0.98, 0.31];

function buildBomber(): VertexData {
  const p: VertexData[] = [];
  p.push(basePlate(0.52, 0.6));
  const hipL: V3 = [-0.1, 0.56, 0.02],
    kneeL: V3 = [-0.14, 0.34, 0.08],
    ankleL: V3 = [-0.15, 0.13, 0.06];
  const hipR: V3 = [0.1, 0.56, -0.02],
    kneeR: V3 = [0.14, 0.34, -0.06],
    ankleR: V3 = [0.15, 0.13, -0.1];
  p.push(limb(hipL, kneeL, ankleL, 0.096, 0.068, 0.058, 6, S.body));
  p.push(limb(hipR, kneeR, ankleR, 0.096, 0.068, 0.058, 6, S.body));
  p.push(boot([-0.15, 0.09, 0.0], [-0.152, 0.074, 0.17], 0.056));
  p.push(boot([0.15, 0.09, -0.16], [0.152, 0.074, 0.01], 0.056));
  p.push(
    tube(
      [
        { p: [0, 0.5, -0.01], a: 0.152, b: 0.112, s: S.body },
        { p: [0, 0.585, 0.0], a: 0.148, b: 0.108, s: S.belt },
        { p: [0, 0.74, 0.02], a: 0.172, b: 0.126, s: S.body },
        { p: [0, 0.84, 0.02], a: 0.182, b: 0.12, s: S.body },
        { p: [0, 0.905, 0.012], a: 0.162, b: 0.1, s: S.body },
        { p: [0, 0.945, 0.008], a: 0.1, b: 0.07, s: S.body },
      ],
      8,
      [1, 0, 0],
      0,
      0.45,
      Math.PI / 8,
    ),
  );
  // Big box pack with a top flap and side pouches.
  p.push(box(0.38, 0.4, 0.22, 0.055, S.gear, { y: 0.79, z: -0.215 }, 1));
  p.push(box(0.39, 0.075, 0.235, 0.03, 0.76, { y: 0.98, z: -0.215, rx: 0.06 }));
  p.push(box(0.1, 0.15, 0.1, 0.03, 0.78, { x: -0.22, y: 0.7, z: -0.2 }));
  p.push(box(0.1, 0.15, 0.1, 0.03, 0.78, { x: 0.22, y: 0.7, z: -0.2 }));
  // Shoulder straps over the front.
  for (const s of [-1, 1])
    p.push(
      shade(
        tube(
          [
            { p: [s * 0.1, 0.94, -0.1], a: 0.024, b: 0.01 },
            { p: [s * 0.11, 0.92, 0.06], a: 0.024, b: 0.01 },
            { p: [s * 0.1, 0.78, 0.13], a: 0.024, b: 0.01 },
          ],
          4,
          [1, 0, 0],
          0,
          0,
        ),
        S.gear,
      ),
    );
  // Arms hugging the firecracker.
  p.push(limb([0.175, 0.9, 0.0], [0.245, 0.74, 0.1], [0.05, 0.775, 0.27], 0.07, 0.054, 0.05, 6, S.body));
  p.push(limb([-0.175, 0.9, 0.0], [-0.245, 0.83, 0.13], [-0.04, 0.915, 0.33], 0.07, 0.054, 0.05, 6, S.body));
  // Head and helmet (the rifleman's M1) with goggles.
  const hc: V3 = [0, 1.045, 0.03];
  p.push(head(hc));
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
    [0.66, 0.66, 0.76, 0.84, 0.87, 0.87, 0.87],
  );
  p.push(place(scaled(helmet, 1, 1, 1.07), { x: hc[0], y: hc[1] + 0.03, z: hc[2] - 0.013 }));
  p.push(
    shade(
      place(
        scaled(
          revolve(
            [
              [0.133, 0.04],
              [0.138, 0.055],
              [0.133, 0.07],
            ],
            12,
          ),
          1,
          1,
          1.07,
        ),
        { x: hc[0], y: hc[1] + 0.03, z: hc[2] - 0.013 },
      ),
      S.goggles,
    ),
  );
  for (const s of [-1, 1])
    p.push(dome(0.036, 6, S.goggles, { x: s * 0.048, y: hc[1] + 0.085, z: hc[2] + 0.125, rx: Math.PI / 2 - 0.25 }));
  return mergeParts(p);
}

// The bomber's firecrackers: red paper tubes with cream bands, a dark fuse and a spark.
function buildBomberAccent(): VertexData {
  const red = lin('#d4372b');
  const redDark = lin('#a8261e');
  const cream = lin('#f4eddc');
  const fuse = lin('#3a2c22');
  const spark = lin('#ffd25a');
  const parts: VertexData[] = [];
  const cracker = (a: V3, b: V3, r: number, big: boolean): void => {
    // Big: cream bands near both ends; small spares: one band.
    const rings: Ring[] = big
      ? [
          { p: a, a: r * 0.9 },
          { p: lerp3(a, b, 0.04), a: r },
          { p: lerp3(a, b, 0.14), a: r * 1.02 },
          { p: lerp3(a, b, 0.2), a: r },
          { p: lerp3(a, b, 0.8), a: r },
          { p: lerp3(a, b, 0.86), a: r * 1.02 },
          { p: lerp3(a, b, 0.96), a: r },
          { p: b, a: r * 0.9 },
        ]
      : [
          { p: a, a: r },
          { p: lerp3(a, b, 0.7), a: r },
          { p: b, a: r },
        ];
    const ringCol = big ? [redDark, red, cream, red, red, cream, red, redDark] : [red, cream, redDark];
    const sides = big ? 10 : 6;
    const vd = tube(rings, sides, [1, 0, 0], big ? 0.35 : 0, 0.35);
    // Colour by ring (tube vertices: rings x sides, then the cap apexes).
    const nRing = rings.length * sides;
    const c = new Float32Array(((vd.positions as number[]).length / 3) * 4);
    for (let i = 0; i < c.length / 4; i++) {
      const ring = i < nRing ? Math.floor(i / sides) : big && i === nRing ? 0 : rings.length - 1;
      const col = ringCol[ring];
      c.set([col.r, col.g, col.b, 1], i * 4);
    }
    vd.colors = c;
    parts.push(vd);
    // Fuse: out of the top end, curling up, with a spark at the tip.
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      dz = b[2] - a[2];
    const l = Math.hypot(dx, dy, dz);
    const d: V3 = [dx / l, dy / l, dz / l];
    const f0: V3 = [b[0] + d[0] * 0.01, b[1] + d[1] * 0.01, b[2] + d[2] * 0.01];
    const f1: V3 = [b[0] + d[0] * 0.06 + 0.015, b[1] + d[1] * 0.06 + 0.02, b[2] + d[2] * 0.06];
    const f2: V3 = [b[0] + d[0] * 0.09 + 0.04, b[1] + d[1] * 0.09 + 0.05, b[2] + d[2] * 0.09 - 0.01];
    const fr = big ? 0.011 : 0.008;
    parts.push(
      paint(
        tube(
          [
            { p: f0, a: fr },
            { p: f1, a: fr },
            { p: f2, a: fr * 0.8 },
          ],
          4,
          [1, 0, 0],
          0,
          0.5,
        ),
        fuse,
      ),
    );
    if (big) {
      const sp = revolve(
        [
          [0, -0.03],
          [0.026, -0.016],
          [0.03, 0.006],
          [0.018, 0.026],
          [0, 0.034],
        ],
        6,
      );
      parts.push(paint(place(sp, { x: f2[0], y: f2[1], z: f2[2] }), spark));
    }
  };
  cracker(FC_A, FC_B, 0.068, true);
  // Three spares in the pack, poking out under the flap.
  cracker([-0.11, 0.9, -0.24], [-0.13, 1.1, -0.27], 0.03, false);
  cracker([0.0, 0.9, -0.23], [0.0, 1.13, -0.25], 0.03, false);
  cracker([0.11, 0.9, -0.24], [0.135, 1.09, -0.27], 0.03, false);
  return mergeParts(parts);
}

// ---------------------------------------------------------------- AO, caching, meshes
type Part = MobVariant | 'bomberAccent';

function rawGeometry(kind: MobVariant): { body: VertexData; accent: VertexData | null } {
  if (kind === 'knight') return { body: buildKnight(), accent: null };
  if (kind === 'sprinter') return { body: buildSprinter(), accent: null };
  return { body: buildBomber(), accent: buildBomberAccent() };
}

const AO = { samples: 20, strength: 0.6, maxDist: 0.45 } as const;

// Baked AO (one byte per vertex, ao = 0.4 + 0.6 * byte / 255, base64) and a position
// checksum of the unbaked geometry. Regenerate with soldierVariantsAOTable() (e.g. through
// vite's ssrLoadModule) after any geometry change; a stale entry bakes at runtime instead.
const AO_BAKED: Record<Part, string> = {
  knight:
    'jIx/f39/f4yMjH9/f39/jL+/srLMsqa/v8yysr+/v7LZ5eXl2dm/2dm/5fLZ8tnMmQAAmb8ADTPlzOUaM3Py8uWZWZnMzNm/f1lzWX+MWQAA8vIAAA3/8homTA3/sqZzc3Oy2bJ/mczyf1lAWZmZAABzAGaZAACZzOWZAACZjKayjJkAAJnMpkwAALJz/////wD/8v//8v//8v///wAA5f//////5fL//wAA5f////8A5fL/5bJzsvL////yAAAAAAAAAADy///yjNn//+X//+VZsv//Zv//AACm/5ka8v8aAKbZAA1AWQ0AAAAAAAB/ANn/5QCyZtn/8rLZv+X/2eX//7IA8v//8swA5f8AAKaZ5f8AjA0AAAC/AP+mANny//+yZtn/8v+yWeX/2dmmf/L/AAANAAAAWaYAf3/y/4xzAGbl5YxZWXMzZpmMZgAAAH8NAAAAAAAAADMNGlkmGgAAAAAAAAAAAAAAADPM5cx/TLL//6aMzOXlv8zl///Zsszy5b/l////5bLM8uXl2f////K/2fLy8vL////y2fL///L///Ly5f/l5eXy8vK/zOUA5f//5Yx/zP//2QAAzPL/vwAAAP/yAAAA8gDM/////8x/ZvIAAAD/v0xZ8gAA8v+ZTGbM/wD/8r+MZsz////y8qay8vLM////vwAAAMyyAKbMAAAAzP8A/8wAAAAA/wD/AAAAAADl//IAAAAAAAAAAP/lAAD/8gAA8uUAAP/////y5QAAAABmZv/yZln/8llm8vJmZv/////y8mZmWWYAAACZ2f8AAAAAAACmAAAAAADlANkAAPLl5YxZsvL/8vL/Wf8AAAAA///l////////',
  sprinter:
    'jIx/f39mf4yMjH9/f3NzjL+ysrK/QJmyv7+yzL+MprLl5f/y2Q2/5dn/8tnMQMzZzA0Af//Mf+W/2f/Zv/Ly8vLZzMzZ5dnMv39/jH9ZZg0AAL9MDeXy8tmm8v//8r+Z2f//2XOM2f//pkwzjLLMAACZptmmMxqZ5eWZGia/jOXl5eWZpnOymX8NGv8zAADy/wAA5fIAv///AADl5UzM5f/ZzPLyAMzl5QDM/+WMjPLyAL/y8uUAAOW/GjPyAOXl/9kApgAmpuUm2QDlAP8A/ybZAOWm5QAAAAD/jAAA/1lApgB/5f/yAJmm8v/lZrJA2f/ysrJmzP//8tmy8v///7/y//IAAH/y//9mWb/l//KZpnPZ///Zpn/l///yv7LypuXysgAaDf/lv6YAsv/l5fKm2f8AAA0NAADy//LZ8uXl2czZ8v+MjP////LM5f//////////8v////////////////L/////AAAAzOXy8swAAAAA8gANvwAA2WZz5b/M5aam8vL/8rK/8v///9nl////Df8=',
  bomber:
    'jIx/f39/f4yMjH9/f39/jLK/srLMsqa/ssyyssy/v7LM5eXy5fKysszM5fLl5b+ypgCZzMy/M6by8vLljLLl//Llpqa/zNnZmVlmWX8AAAAAzNkAAFmZ8vKyjL/l8uWyptnZ2b+Zmdnyf1lAWQCMAABmmeWmAACZ5eWZAACyjKbZzIwAAJnlv2YAALKMAKbM2QAA8gCZWWbMAADy2b8NDbK/WXNAAA0NmQBAcwBmDQ2ZAH+MAHMAGnOMWX+ZAP///wD/zP8A8oz/AMy/vwD///8A/9n/AOWM/wDMzKYAAAAAAAAAAAAAAAAAAAAAAP//8v//5eX/5b+/8sx/ZszMf2bMzEBZv6ZAQL8AAAAA///y////////////AAAAAPL/mdny/6bZ///Z2fLyppmmmdnZ8vL//wAAAAD/8uXZ8gDZAP8A5QDlANkA/wDyAP/y8tkAAAAAAPIA2QD/APIA8gDZAP8A8hozfyYAcyYADSaMJn8zGjOMfwAAJkANGv/MZgANv///fwBMzP/yZg1z//+yTCaZ8vJmABqy/0ymADO/8qYAGn/l/8xZGiby//KZDVny/+UaAH/l//+mM8wADQANAA1/c0Aac39zf1kmTGYAAA0AAA0mMyYzMyYzGjMzMzNmWVlMWXNzTBoNGln/8v/////y8uWy5f/lsn+mZtnM2bLM5b///9nl8v//5eXy8v/////////////y////sqZZjGaysoyMf5my5dlAskDZ5eXMmczy//9/5XP//+XM2fL/DUBM5eV/f3OM///Z5czM///y8uVMGg1/5fJ/c6bl//K/zOX/8v8=',
  bomberAccent:
    'mTMzTH/Z////5YwzDSYzsvL///KMQBomGozy//Lyf0AaJgBm8v/y8r9/Zmam2eX//+W/mX9zpvL////yzKZ/jNny////8vLZsqbM8v/////lAAAAAADZpszyAAAAAADM2b+mmb/y8uVMc7/////ZpuX////y2f//AAAAAAAAf7+/2Zlzv/L//+WmAHPM5X+m//+y2f//2f8AAAAAAAB/v9mmTFnZ///lsrIAjL/Mf7/l5bLy///y/wAAAAAAANmmpoxZpv//8qam5QCy2bKM8vLZv///8vL/',
};
const AO_CHECK: Record<Part, number> = { knight: 2617588, sprinter: 1492602, bomber: 2495370, bomberAccent: 1192212 };

function checksum(p: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) s += Math.abs(p[i]) * ((i % 7) + 1);
  return Math.round(s * 1000);
}

// Bakes AO for a body (and its accent, which occludes it) into factors per vertex.
function bakeFactors(body: VertexData, accent: VertexData | null): { body: Float32Array; accent: Float32Array | null } {
  const white = (vd: VertexData): VertexData => {
    const w = new VertexData();
    w.positions = Float32Array.from(vd.positions as number[]);
    w.normals = Float32Array.from(vd.normals as number[]);
    w.indices = Uint32Array.from(vd.indices as number[]);
    w.colors = new Float32Array((w.positions.length / 3) * 4).fill(1);
    return w;
  };
  const merged = mergeParts(accent ? [white(body), white(accent)] : [white(body)]);
  bakeVertexAO(merged, { ...AO, maxTriangles: 4000 });
  const c = merged.colors as ArrayLike<number>;
  const nb = (body.positions as number[]).length / 3;
  const na = accent ? (accent.positions as number[]).length / 3 : 0;
  const fb = new Float32Array(nb);
  for (let v = 0; v < nb; v++) fb[v] = c[v * 4];
  let fa: Float32Array | null = null;
  if (accent) {
    fa = new Float32Array(na);
    for (let v = 0; v < na; v++) fa[v] = c[(nb + v) * 4];
  }
  return { body: fb, accent: fa };
}

function decode(part: Part, positions: ArrayLike<number>): Float32Array | null {
  const nv = positions.length / 3;
  const b64 = AO_BAKED[part];
  if (!b64 || typeof atob !== 'function') return null;
  if (Math.abs(checksum(positions) - AO_CHECK[part]) > 2) return null;
  const bin = atob(b64);
  if (bin.length !== nv) return null;
  const out = new Float32Array(nv);
  for (let i = 0; i < nv; i++) out[i] = 0.4 + (0.6 * bin.charCodeAt(i)) / 255;
  return out;
}

// Tool: recomputes AO_BAKED / AO_CHECK for the current geometry (slow, ~1 s).
export function soldierVariantsAOTable(): { baked: Record<Part, string>; check: Record<Part, number> } {
  const baked = { knight: '', sprinter: '', bomber: '', bomberAccent: '' };
  const check = { knight: 0, sprinter: 0, bomber: 0, bomberAccent: 0 };
  const enc = (f: Float32Array): string => {
    let bin = '';
    for (let v = 0; v < f.length; v++)
      bin += String.fromCharCode(Math.max(0, Math.min(255, Math.round(((f[v] - 0.4) / 0.6) * 255))));
    return btoa(bin);
  };
  for (const kind of MOB_VARIANTS) {
    const g = rawGeometry(kind);
    const f = bakeFactors(g.body, g.accent);
    check[kind] = checksum(g.body.positions as number[]);
    baked[kind] = enc(f.body);
    if (g.accent && f.accent) {
      check.bomberAccent = checksum(g.accent.positions as number[]);
      baked.bomberAccent = enc(f.accent);
    }
  }
  return { baked, check };
}

function applyFactors(vd: VertexData, f: Float32Array): void {
  const c = vd.colors as number[] | Float32Array;
  for (let v = 0; v < f.length; v++) {
    c[v * 4] *= f[v];
    c[v * 4 + 1] *= f[v];
    c[v * 4 + 2] *= f[v];
  }
}

function freeze(vd: VertexData): VertexData {
  vd.positions = Float32Array.from(vd.positions as number[]);
  vd.normals = Float32Array.from(vd.normals as number[]);
  vd.colors = Float32Array.from(vd.colors as number[]);
  vd.indices = Uint32Array.from(vd.indices as number[]);
  vd.uvs = null;
  return vd;
}

const cache: Partial<Record<Part, VertexData>> = {};

function baked(part: Part): VertexData {
  let vd = cache[part];
  if (!vd) {
    const kind: MobVariant = part === 'bomberAccent' ? 'bomber' : part;
    const g = rawGeometry(kind);
    const fb = decode(kind, g.body.positions as number[]);
    const fa = g.accent ? decode('bomberAccent', g.accent.positions as number[]) : null;
    let factors = { body: fb, accent: fa };
    if (!fb || (g.accent && !fa)) {
      console.warn(`soldierVariants: ${kind} AO table is stale; baking at runtime`);
      factors = bakeFactors(g.body, g.accent);
    }
    applyFactors(g.body, factors.body!);
    footShade(g.body);
    cache[kind] = freeze(g.body);
    if (g.accent && factors.accent) {
      applyFactors(g.accent, factors.accent);
      cache.bomberAccent = freeze(g.accent);
    }
    vd = cache[part]!;
  }
  const out = new VertexData();
  out.positions = (vd.positions as Float32Array).slice();
  out.normals = (vd.normals as Float32Array).slice();
  out.colors = (vd.colors as Float32Array).slice();
  out.indices = (vd.indices as Uint32Array).slice();
  return out;
}

// Geometry with AO (tests, tools).
export function soldierVariantGeometry(part: Part): VertexData {
  return baked(part);
}

function setup(mesh: Mesh, look: Look): Mesh {
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.doNotSyncBoundingInfo = true;
  look.addShadowCaster(mesh, 'crowd');
  look.receiveShadows(mesh);
  return mesh;
}

export function createSoldierVariantMesh(scene: Scene, look: Look, kind: MobVariant): Mesh {
  const mat = look.material('army-plastic', () => armyPlasticMaterial(scene));
  return setup(buildMesh(scene, `soldier-${kind}`, baked(kind), mat), look);
}

export function createBomberAccentMesh(scene: Scene, look: Look): Mesh {
  const mat = look.material('variant-accent', () =>
    plasticMaterial(scene, null, { name: 'variantAccent', roughness: 0.62, clearcoat: 0.15 }),
  );
  return setup(buildMesh(scene, 'soldier-bomber-accent', baked('bomberAccent'), mat), look);
}

// ---------- preview ----------
// 'all': a row of each variant (opts.team) behind a rifleman-sized gap, hopping like
// crowd.ts; a named variant shows a 4x3 block of it plus two of the other team.
export function preview(scene: Scene, look: Look, opts: PreviewOptions): PreviewResult {
  const root = new TransformNode('soldierVariantsRoot', scene);
  const kinds: MobVariant[] =
    opts.variant && opts.variant !== 'all' ? [opts.variant as MobVariant] : ['knight', 'sprinter', 'bomber'];
  const other: TeamName = opts.team === 'player' ? 'enemy' : 'player';
  const groups = kinds.map((kind, gi) => {
    const mesh = createSoldierVariantMesh(scene, look, kind);
    mesh.parent = root;
    const accent = kind === 'bomber' ? createBomberAccentMesh(scene, look) : null;
    if (accent) accent.parent = root;
    const units: { x: number; z: number; yaw: number; team: TeamName; s: number }[] = [];
    const s = kind === 'knight' ? 1.65 : 1;
    if (kinds.length === 1) {
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 4; c++)
          units.push({ x: (c - 1.5) * 0.7 * s, z: (r - 1) * 0.75 * s, yaw: 0, team: opts.team, s });
      units.push({ x: 2.4 * s, z: 0, yaw: Math.PI, team: other, s });
      units.push({ x: 2.4 * s, z: 0.9 * s, yaw: Math.PI, team: other, s });
    } else {
      const x0 = (gi - 1) * 2.4;
      for (let c = 0; c < 3; c++) units.push({ x: x0 + (c - 1) * 0.6 * s, z: 0, yaw: 0, team: opts.team, s });
      units.push({ x: x0, z: 1.3, yaw: Math.PI, team: other, s });
    }
    const matrices = new Float32Array(units.length * 16);
    const colors = new Float32Array(units.length * 4);
    units.forEach((u, i) => {
      const c = teamColor(u.team);
      colors.set([c.r, c.g, c.b, 1], i * 4);
    });
    return { kind, mesh, accent, units, matrices, colors };
  });
  const write = (time: number): void => {
    for (const g of groups) {
      g.units.forEach((u, i) => {
        const sn = Math.sin(time * 10 + u.x * 3.7 + u.z * 1.9);
        const hop = Math.abs(sn);
        const pitch = hop * 0.16,
          roll = sn * 0.1;
        const cp = Math.cos(pitch),
          spn = Math.sin(pitch),
          cr = Math.cos(roll),
          sr = Math.sin(roll),
          cy = Math.cos(u.yaw),
          sy = Math.sin(u.yaw);
        const m = g.matrices;
        const o = i * 16;
        const k = u.s;
        m[o] = cr * cy * k;
        m[o + 1] = sr * k;
        m[o + 2] = -cr * sy * k;
        m[o + 3] = 0;
        m[o + 4] = (-cp * sr * cy + spn * sy) * k;
        m[o + 5] = cp * cr * k;
        m[o + 6] = (cp * sr * sy + spn * cy) * k;
        m[o + 7] = 0;
        m[o + 8] = (spn * sr * cy + cp * sy) * k;
        m[o + 9] = -spn * cr * k;
        m[o + 10] = (-spn * sr * sy + cp * cy) * k;
        m[o + 11] = 0;
        m[o + 12] = u.x;
        m[o + 13] = hop * 0.1 * k;
        m[o + 14] = u.z;
        m[o + 15] = 1;
      });
    }
  };
  write(0.37);
  for (const g of groups) {
    g.mesh.thinInstanceSetBuffer('matrix', g.matrices, 16, false);
    g.mesh.thinInstanceSetBuffer('color', g.colors, 4, true);
    g.accent?.thinInstanceSetBuffer('matrix', g.matrices, 16, false);
  }
  return {
    root,
    update(time) {
      write(time);
      for (const g of groups) {
        g.mesh.thinInstanceBufferUpdated('matrix');
        g.accent?.thinInstanceBufferUpdated('matrix');
      }
    },
    dispose() {
      root.dispose();
    },
  };
}
