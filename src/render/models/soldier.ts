// Mob rifleman: the classic plastic army man that makes up the horde (up to ~1,500 on
// screen). One merged, thin-instanced mesh for both armies: the shared 'army-plastic'
// material has a white albedo, the team colour comes from the thin-instance 'color'
// buffer (LINEAR, teamColor(team)), and greyscale vertex colours multiply in (baked
// ambient occlusion, helmet and rifle moulded a shade darker, face a shade lighter).
//
// The figure is modelled procedurally (no asset to download): a WW2 rifleman striding
// forward, left foot leading and the trailing knee bent, rifle held at port across the
// chest (butt at the right hip, muzzle up past the left shoulder), M1 helmet with a wide
// brim and rolled lip that dips at the back (brim moulded darker than the dome so a dark
// line separates helmet and face), shoulders rounding into deltoids, shaped thighs and
// calves, one soft pack-and-bedroll mass on the back, chunky boots, all on a thin
// bevelled oval base plate. Toy proportions: head and helmet ~15% oversize so they read
// at ~30 px. Every part is a smooth tube or surface of revolution with broad, gently
// turning rings (no thin bevel bands, which caught the sun as hairlines on the backs).
//
// Spec: height exactly SOLDIER_HEIGHT (1.3) from the floor to the helmet top, pivot at
// the base-plate centre on y = 0, front facing +Z. Full model 688 triangles / 398
// vertices, fallback 292 triangles (both one mesh, one material, no textures).
//
// GAME API
//   SOLDIER_HEIGHT = 1.3
//   createSoldierMesh(scene, look): Promise<Mesh>
//     Full figure. Cheap: the ambient occlusion is baked offline into AO_BAKED (one byte
//     per vertex), and the geometry is built once per session and cached at module level
//     (first call ~5-10 ms, later calls only copy ~16 KB of arrays). Only if the AO table
//     is stale does the first call bake at runtime (~120 ms desktop), after one macrotask.
//     Never rejects: on any error it resolves with the fallback. Registers itself as a
//     'crowd' shadow caster (dropped on the 'low' tier; draw blob shadows there).
//   createSoldierFallback(scene, look): Mesh
//     Synchronous, simpler stand-in (<= 300 triangles, AO also pre-baked, ~1 ms) for the
//     frames before the full mesh resolves. Does NOT register a shadow caster (call
//     look.addShadowCaster(m, 'crowd') if it is drawn for long).
//   Both: ready for thinInstanceSetBuffer('matrix', ..16) and ('color', ..4, LINEAR
//   teamColor(team)), alwaysSelectAsActiveMesh = true, isPickable = false,
//   doNotSyncBoundingInfo = true, thinInstanceCount 0. Geometry is already 1.3 tall, so
//   the instance scale is radius / LAYOUT.mobRadius (not x MODEL_MOB_HEIGHT any more).
//   Facing: authored toward +Z; player yaw 0 (marching up the lane), enemy yaw PI. The old
//   army-men.glb faced -Z, so crowd.ts's PLAYER_YAW / ENEMY_YAW must drop their extra PI
//   (three-quarter turn: player ~ -0.7, enemy ~ PI + 0.55).
//   The pose is balanced around the pivot, so crowd.ts's hop lean (±0.16 rad) and
//   waddle (±0.1 rad) look natural. NOTE: crowd.ts leans with pitch = -hop * HOP_LEAN,
//   which tipped the old -Z-facing figure forward; for this +Z-facing mesh the sign must
//   flip (pitch = +hop * HOP_LEAN) or the soldiers lean back on every hop.
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Look } from '../look/index.ts';
import { armyPlasticMaterial, bakeVertexAO, buildMesh, fixWinding, mergeParts, paint, place, teamColor } from '../look/index.ts';
import type { ModelInfo, PreviewOptions, PreviewResult } from '../look/model.ts';
import type { TeamName } from '../look/palette.ts';

export const SOLDIER_HEIGHT = 1.3;

export const info: ModelInfo = {
  key: 'soldier',
  title: 'Mob rifleman (plastic army man)',
  instanced: true,
  teams: true,
  side: 'team',
  height: SOLDIER_HEIGHT,
  triangleBudget: 700,
  gameZ: 14,
  variants: ['full', 'lite'], // 'lite' previews the synchronous fallback
};

// Greyscale moulding multipliers (vertex colours; team colour multiplies on top).
const SHADE = {
  body: 1,
  belt: 0.96, // a faint painted band at the waist (no geometry, so no hairline highlights)
  face: 1.06,
  helmet: 0.87, // dome
  helmetBase: 0.84,
  brim: 0.76, // brim ring and rolled lip
  brimUnder: 0.66,
  rifle: 0.88,
  gear: 0.88, // pack and bedroll: one slightly darker mass
  boots: 0.9,
  base: 1,
}

type V3 = [number, number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const lerp3 = (a: V3, b: V3, t: number): V3 => add(a, mul(sub(b, a), t));

// One ring of a tube: centre, half-size along the side axis (a) and the other axis (b).
interface Ring {
  p: V3;
  a: number;
  b?: number; // defaults to a (round)
  s?: number; // greyscale moulding shade of this ring (any ring with one gives the tube colours)
}

// A smooth tube through rings with `sides` sides and rounded end caps (an apex pushed out
// by capStart / capEnd x the end radius; 0 leaves that end open). `ref` picks the side
// axis (the 'a' half-size), projected square to the tube. `twist` rotates the polygon
// (e.g. PI/sides for a flat underside).
function tube(rings: Ring[], sides: number, ref: V3, capStart = 0.6, capEnd = 0.6, twist = 0): VertexData {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const n = rings.length;
  const tangents: V3[] = rings.map((_, i) => norm(sub(rings[Math.min(n - 1, i + 1)].p, rings[Math.max(0, i - 1)].p)));
  const frames = tangents.map((t) => {
    let s = sub(ref, mul(t, dot(ref, t)));
    if (Math.hypot(s[0], s[1], s[2]) < 1e-4) s = Math.abs(t[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    s = norm(s);
    return { s, u: cross(t, s) };
  });
  for (let i = 0; i < n; i++) {
    const { p, a } = rings[i];
    const b = rings[i].b ?? a;
    const { s, u } = frames[i];
    for (let k = 0; k < sides; k++) {
      const th = twist + (k / sides) * Math.PI * 2;
      const c = Math.cos(th);
      const sn = Math.sin(th);
      positions.push(...add(p, add(mul(s, c * a), mul(u, sn * b))));
      normals.push(...norm(add(mul(s, c / a), mul(u, sn / b))));
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < sides; k++) {
      const a0 = i * sides + k;
      const a1 = i * sides + ((k + 1) % sides);
      indices.push(a0, a1, a1 + sides, a0, a1 + sides, a0 + sides);
    }
  }
  const apexRing: number[] = [];
  const cap = (ring: number, dir: number, len: number): void => {
    if (len <= 0) return;
    const r = rings[ring];
    const t = mul(tangents[ring], dir);
    const apex = add(r.p, mul(t, len * Math.min(r.a, r.b ?? r.a)));
    const ai = positions.length / 3;
    positions.push(...apex);
    normals.push(...t);
    for (let k = 0; k < sides; k++) indices.push(ring * sides + k, ring * sides + ((k + 1) % sides), ai);
    apexRing.push(ring);
    // Lean the cap ring's normals a little toward the apex so the end looks rounded.
    for (let k = 0; k < sides; k++) {
      const o = (ring * sides + k) * 3;
      const nn = norm(add([normals[o], normals[o + 1], normals[o + 2]], mul(t, 0.45)));
      normals[o] = nn[0];
      normals[o + 1] = nn[1];
      normals[o + 2] = nn[2];
    }
  };
  cap(0, -1, capStart);
  cap(n - 1, 1, capEnd);
  const vd = new VertexData();
  vd.positions = positions;
  vd.normals = normals;
  vd.indices = indices;
  if (rings.some((r) => r.s !== undefined)) {
    const ringShade = rings.map((r) => r.s ?? 1);
    const colors = new Float32Array((positions.length / 3) * 4);
    const set = (v: number, g: number): void => {
      colors[v * 4] = g;
      colors[v * 4 + 1] = g;
      colors[v * 4 + 2] = g;
      colors[v * 4 + 3] = 1;
    };
    for (let i = 0; i < n; i++) for (let k = 0; k < sides; k++) set(i * sides + k, ringShade[i]);
    apexRing.forEach((ring, j) => set(n * sides + j, ringShade[ring]));
    vd.colors = colors;
  }
  return fixWinding(vd);
}

// Non-uniform scale with correct normals (place() would skew them), then place.
function scaled(vd: VertexData, sx: number, sy: number, sz: number): VertexData {
  const p = vd.positions as number[] | Float32Array;
  const nr = vd.normals as number[] | Float32Array;
  for (let i = 0; i < p.length; i += 3) {
    p[i] *= sx;
    p[i + 1] *= sy;
    p[i + 2] *= sz;
    const nx = nr[i] / sx, ny = nr[i + 1] / sy, nz = nr[i + 2] / sz;
    const l = Math.hypot(nx, ny, nz) || 1;
    nr[i] = nx / l;
    nr[i + 1] = ny / l;
    nr[i + 2] = nz / l;
  }
  return vd;
}

// A surface of revolution around +Y with no UV seam and no degenerate axis triangles:
// each profile point [radius, y] becomes a ring of `sides` vertices, and a last point at
// radius 0 becomes one apex vertex (a triangle fan). Normals come from the profile, so a
// profile with gently turning points gives broad, soft highlights. `shades` is an
// optional greyscale per profile point.
function revolve(profile: [number, number][], sides: number, shades?: number[], twist = 0): VertexData {
  const n = profile.length;
  const apex = profile[n - 1][0] === 0;
  const ringCount = apex ? n - 1 : n;
  const nrm2: [number, number][] = profile.map((_, i) => {
    const a = profile[Math.max(0, i - 1)];
    const b = profile[Math.min(n - 1, i + 1)];
    const dr = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dr, dy) || 1;
    return [dy / l, -dr / l];
  });
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];
  for (let i = 0; i < ringCount; i++) {
    const [r, y] = profile[i];
    for (let k = 0; k < sides; k++) {
      const th = twist + (k / sides) * Math.PI * 2;
      const c = Math.cos(th);
      const s = Math.sin(th);
      positions.push(r * c, y, r * s);
      normals.push(nrm2[i][0] * c, nrm2[i][1], nrm2[i][0] * s);
      const g = shades ? shades[i] : 1;
      colors.push(g, g, g, 1);
    }
  }
  for (let i = 0; i < ringCount - 1; i++) {
    for (let k = 0; k < sides; k++) {
      const a0 = i * sides + k;
      const a1 = i * sides + ((k + 1) % sides);
      indices.push(a0, a1, a1 + sides, a0, a1 + sides, a0 + sides);
    }
  }
  if (apex) {
    const ai = positions.length / 3;
    positions.push(0, profile[n - 1][1], 0);
    normals.push(0, Math.sign(nrm2[n - 1][1]) || 1, 0);
    const g = shades ? shades[n - 1] : 1;
    colors.push(g, g, g, 1);
    const r0 = (ringCount - 1) * sides;
    for (let k = 0; k < sides; k++) indices.push(r0 + k, r0 + ((k + 1) % sides), ai);
  }
  const vd = new VertexData();
  vd.positions = positions;
  vd.normals = normals;
  vd.indices = indices;
  vd.colors = colors;
  return fixWinding(vd);
}

function shade(vd: VertexData, v: number): VertexData {
  return paint(vd, [v, v, v]);
}

type Detail = 'full' | 'lite';

// Key points of the pose (shared by both detail levels). Left foot leads; the trailing
// right knee is bent forward of the hip-ankle line so the stride shows in silhouette.
const POSE = {
  hipL: [-0.085, 0.6, 0.0] as V3,
  kneeL: [-0.096, 0.37, 0.13] as V3,
  ankleL: [-0.1, 0.13, 0.15] as V3,
  hipR: [0.085, 0.6, -0.025] as V3,
  kneeR: [0.096, 0.375, -0.05] as V3,
  ankleR: [0.1, 0.145, -0.19] as V3,
  shoulderL: [-0.158, 0.918, 0.0] as V3,
  shoulderR: [0.158, 0.918, -0.005] as V3,
  elbowL: [-0.228, 0.8, 0.15] as V3,
  elbowR: [0.218, 0.755, 0.06] as V3,
  butt: [0.15, 0.57, 0.16] as V3,
  muzzle: [-0.205, 1.24, 0.385] as V3,
  gripR: 0.3, // where the hands hold the rifle (fraction butt -> muzzle)
  gripL: 0.56,
  head: [0, 1.085, 0.025] as V3,
  helmet: [0, 1.116, 0.012] as V3,
};

function buildSoldier(detail: Detail): VertexData {
  const full = detail === 'full';
  const parts: VertexData[] = [];
  const P = POSE;
  const S = SHADE;

  // ---- base plate: thin bevelled oval, 0.45 x 0.55, 0.04 thick (bottom never seen) ----
  const base = revolve(full ? [[0.5, 0], [0.5, 0.02], [0.468, 0.04], [0, 0.04]] : [[0.5, 0], [0.48, 0.04], [0, 0.04]], full ? 16 : 10);
  parts.push(shade(scaled(base, 0.45, 1, 0.55), S.base));

  // ---- boots: chunky, the trailing one pushing off its toe ----
  const boot = (ankle: V3, heelUp: number): VertexData => {
    const x = ankle[0], z = ankle[2];
    return tube([
      { p: [x, 0.088 + heelUp, z - 0.055], a: 0.046, b: 0.05, s: S.boots },
      { p: [x, 0.07, z + 0.09], a: 0.044, b: 0.036, s: S.boots },
    ], full ? 6 : 4, [1, 0, 0], 0.6, 0.75, full ? 0 : Math.PI / 4);
  };
  parts.push(boot(P.ankleL, 0), boot(P.ankleR, full ? 0.02 : 0));

  // ---- legs: thigh, knee, calf, bloused into the boot ----
  const leg = (hip: V3, knee: V3, ankle: V3): VertexData => {
    const rings: Ring[] = full
      ? [
        { p: hip, a: 0.088, b: 0.086 },
        { p: lerp3(hip, knee, 0.45), a: 0.083, b: 0.08 },
        { p: knee, a: 0.06, b: 0.062 },
        { p: lerp3(knee, ankle, 0.4), a: 0.064, b: 0.068 },
        { p: ankle, a: 0.052 },
      ]
      : [{ p: hip, a: 0.078 }, { p: knee, a: 0.06 }, { p: ankle, a: 0.05 }];
    return shade(tube(rings, full ? 6 : 4, [1, 0, 0], 0, 0), S.body);
  };
  parts.push(leg(P.hipL, P.kneeL, P.ankleL), leg(P.hipR, P.kneeR, P.ankleR));

  // ---- torso: hips, belted waist, chest, shoulders rounding into the neck ----
  const torsoRings: Ring[] = full
    ? [
      { p: [0, 0.53, -0.01], a: 0.136, b: 0.1, s: S.body },
      { p: [0, 0.615, -0.004], a: 0.13, b: 0.095, s: S.belt },
      { p: [0, 0.77, 0.018], a: 0.152, b: 0.114, s: S.body },
      { p: [0, 0.87, 0.022], a: 0.166, b: 0.11, s: S.body },
      { p: [0, 0.935, 0.016], a: 0.15, b: 0.094, s: S.body },
      { p: [0, 0.975, 0.01], a: 0.095, b: 0.066, s: S.body },
    ]
    : [
      { p: [0, 0.54, -0.01], a: 0.135, b: 0.1, s: S.body },
      { p: [0, 0.8, 0.018], a: 0.16, b: 0.105, s: S.body },
      { p: [0, 0.96, 0.015], a: 0.14, b: 0.082, s: S.body },
    ];
  parts.push(tube(torsoRings, full ? 8 : 6, [1, 0, 0], 0, 0.45, full ? Math.PI / 8 : 0));

  // ---- rifle (port arms) ----
  const d = sub(P.muzzle, P.butt);
  const at = (t: number): V3 => add(P.butt, mul(d, t));
  const rifleRings: Ring[] = full
    ? [
      { p: at(0), a: 0.027, b: 0.056 },
      { p: at(0.3), a: 0.024, b: 0.032 },
      { p: at(0.46), a: 0.028, b: 0.042 },
      { p: at(0.78), a: 0.022, b: 0.026 },
      { p: at(1), a: 0.015, b: 0.015 },
    ]
    : [{ p: at(0), a: 0.025, b: 0.046 }, { p: at(1), a: 0.016, b: 0.018 }];
  parts.push(shade(tube(rifleRings, 4, [0, 0, 1], 0.2, 0.3, Math.PI / 4), S.rifle));

  // ---- arms: a deltoid that starts inside the torso, tapering to the fists ----
  const arm = (shoulder: V3, elbow: V3, grip: V3): VertexData => {
    const wrist = lerp3(elbow, grip, 0.8);
    const rings: Ring[] = full
      ? [
        { p: shoulder, a: 0.07 },
        { p: elbow, a: 0.049 },
        { p: wrist, a: 0.038 },
        { p: grip, a: 0.046 },
      ]
      : [{ p: shoulder, a: 0.058 }, { p: elbow, a: 0.045 }, { p: grip, a: 0.04 }];
    return shade(tube(rings, full ? 6 : 4, [0, 1, 0], 0.75, 0.6, full ? Math.PI / 6 : 0), S.body); // a vertex, not a flat, faces out
  };
  parts.push(arm(P.shoulderR, P.elbowR, at(P.gripR)), arm(P.shoulderL, P.elbowL, at(P.gripL)));

  // ---- pack with its bedroll: ONE soft moulded mass on the back, slightly darker. A
  // single tube whose rings swell gently into the roll at the top, so its normals turn
  // smoothly over the whole surface (separate stacked parts caught the sun as hairlines
  // across the back, which is the view the player sees most). ----
  if (full) {
    parts.push(shade(tube([
      { p: [0, 0.655, -0.095], a: 0.07, b: 0.03 },
      { p: [0, 0.7, -0.127], a: 0.106, b: 0.056 },
      { p: [0, 0.8, -0.138], a: 0.114, b: 0.064 },
      { p: [0, 0.878, -0.134], a: 0.13, b: 0.066 },
      { p: [0, 0.928, -0.116], a: 0.118, b: 0.048 },
    ], 8, [1, 0, 0], 0, 0.4, Math.PI / 8), S.gear));
  } else {
    parts.push(shade(tube([
      { p: [0, 0.68, -0.12], a: 0.09, b: 0.045 },
      { p: [0, 0.88, -0.13], a: 0.11, b: 0.06 },
    ], 6, [1, 0, 0], 0.5, 0.6), S.gear));
  }

  // ---- head (with neck), a shade lighter; the top is hidden by the helmet ----
  const head = revolve(full
    ? [[0.045, -0.13], [0.074, -0.06], [0.092, -0.005], [0.084, 0.05]]
    : [[0.06, -0.1], [0.088, -0.02], [0.074, 0.05]], 6, undefined, Math.PI / 2);
  parts.push(shade(place(scaled(head, 1, 1, 1.06), { x: P.head[0], y: P.head[1], z: P.head[2] }), S.face));

  // ---- M1 helmet: dome plus a wide brim with a rolled lip, dipping at the back. The
  // brim and its underside are moulded darker than the dome, so a dark line always
  // separates helmet from face, even from the high lane camera. ----
  const helmet = revolve(full
    ? [[0.108, 0.0], [0.186, -0.024], [0.19, -0.002], [0.13, 0.03], [0.128, 0.09], [0.088, 0.155], [0, 0.18]]
    : [[0.108, 0.0], [0.182, -0.012], [0.124, 0.03], [0.11, 0.125], [0, 0.18]],
  full ? 12 : 8,
  full ? [S.brimUnder, S.brimUnder, S.brim, S.helmetBase, S.helmet, S.helmet, S.helmet] : [S.brimUnder, S.brim, S.helmetBase, S.helmet, S.helmet]);
  {
    const hp = helmet.positions as number[];
    for (let i = 0; i < hp.length; i += 3) {
      const r = Math.hypot(hp[i], hp[i + 2]);
      if (hp[i + 1] < 0.03 && r > 0.1) hp[i + 1] -= 0.024 * (1 - hp[i + 2] / r) * 0.5 + 0.004; // dips toward the back
    }
  }
  parts.push(place(scaled(helmet, 1, 1, 1.07), { x: P.helmet[0], y: P.helmet[1], z: P.helmet[2] }));

  const vd = mergeParts(parts);
  // Exact height: scale uniformly about the pivot so the helmet top sits at SOLDIER_HEIGHT.
  const pos = vd.positions as number[];
  let maxY = 0;
  for (let i = 1; i < pos.length; i += 3) maxY = Math.max(maxY, pos[i]);
  const k = SOLDIER_HEIGHT / maxY;
  for (let i = 0; i < pos.length; i++) pos[i] *= k;
  return vd;
}

const AO_OPTIONS = {
  full: { samples: 24, strength: 0.6, maxDist: 0.45 },
  lite: { samples: 12, strength: 0.55, maxDist: 0.45 },
} as const;

// Ambient occlusion baked offline (regenerate with soldierAOTable() below, e.g. from a
// vite-node / ssrLoadModule script, and paste the result: each vertex's AO factor from
// bakeVertexAO(AO_OPTIONS) as one byte, ao = 0.4 + 0.6 * byte / 255, base64). AO_CHECK is a weighted position checksum of the unbaked geometry: if the
// geometry changes and the table goes stale (vertex count or checksum differs), the AO is
// baked at runtime instead (once per session, ~120 ms on desktop) until it is regenerated.
const AO_BAKED: Record<Detail, string> = {
  full: 'iop/f39/f4qKin9/f39/irW/tcq/n6q1tbWfv7+1qrXf6t/f3wCf1Orf1Orff5W/yoqVyp8qIJX035UVAIqKtd/ftUBKitWVdQAAv2AVANT//0CKyur//5XU9P/01Iqq3+rf1H+Vv7+qn2r/1AsV1P//9Ip16v/01J+19P/fqoq/9PS1amCf3+oLAPTfAADUAKrK1PQ11LW/1AAA9KrKVSoAICoAAJ/KvwBgYAAAlcrKn5WVn5+KlaoA/7Vg9AAAAP//dUD//8rV///0///f/6oAAJ//9GAqqvT/9GBAYAD/1Gp1v/T/1GoA3//UCwtg6v/0n0pq6v//SkqKAP//AIqqfwDf6vT/dQAAYP////+qAACf/////6oAAJX/////qgALld/f3+p/CwB/VQAACwsLALWqipWqv4qKamB1gAAAABUAAFVgSmBKVUpganVqgIqVlXWKn6qfqqqqn/T////q////////9PT09Mrq6ur/9PT06v////T09P////////////////////////8=',
  lite: 'sbGensWxxcWentj/7MXF7OzsxcXFsexQKdjYPFCxd+z/UFDFnjxQxWMpFew8xf/ssZ7FsZ7/FSns/9jF/7Fjsewp7P/YFew8infYsXfFxeyx2MUV/9h37P/s///s/+wVnv/YPOz/FYoV/3cVnv+KFdj/2FCx/9iKnhXs///sKRXs///sPFCensWKsdiexbGxnneK2BUVFSkVFXd3ineKioqe/+zF/+z////s///s/////////////////w==',
};

const AO_CHECK: Record<Detail, number> = { full: 1433121, lite: 670299 };

function checksum(p: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) s += Math.abs(p[i]) * ((i % 7) + 1);
  return Math.round(s * 1000);
}

function decodeAO(detail: Detail, positions: ArrayLike<number>): Uint8Array | null {
  const nv = positions.length / 3;
  const b64 = AO_BAKED[detail];
  if (!b64 || typeof atob !== 'function') return null;
  if (Math.abs(checksum(positions) - AO_CHECK[detail]) > 2) return null;
  const bin = atob(b64);
  if (bin.length !== nv) return null;
  const out = new Uint8Array(nv);
  for (let i = 0; i < nv; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Tool: recomputes AO_BAKED / AO_CHECK for the current geometry (slow, ~150 ms).
export function soldierAOTable(): { baked: Record<Detail, string>; check: Record<Detail, number> } {
  const baked = { full: '', lite: '' };
  const check = { full: 0, lite: 0 };
  for (const d of ['full', 'lite'] as const) {
    const vd = buildSoldier(d);
    const before = Float32Array.from(vd.colors as number[]);
    check[d] = checksum(vd.positions as number[]);
    bakeVertexAO(vd, AO_OPTIONS[d]);
    const c = vd.colors as Float32Array;
    let bin = '';
    for (let v = 0; v < before.length / 4; v++) {
      const f = c[v * 4] / before[v * 4];
      bin += String.fromCharCode(Math.max(0, Math.min(255, Math.round(((f - 0.4) / 0.6) * 255))));
    }
    baked[d] = btoa(bin);
  }
  return { baked, check };
}

// Unbaked geometry (moulding shades only), for tools.
export function soldierGeometryRaw(detail: Detail = 'full'): VertexData {
  return buildSoldier(detail);
}

// A darker contact tint at the feet (base plate and boots): ~30% darker at the floor,
// fading out by FOOT_SHADE_TOP, so neighbouring figures in a packed crowd separate at
// the ground instead of merging into one green band.
const FOOT_SHADE_TOP = 0.32;
const FOOT_SHADE_MIN = 0.7;
function footShade(vd: VertexData): void {
  const p = vd.positions as ArrayLike<number>;
  const c = vd.colors as number[] | Float32Array;
  const nv = p.length / 3;
  for (let v = 0; v < nv; v++) {
    const t = Math.min(1, Math.max(0, p[v * 3 + 1] / FOOT_SHADE_TOP));
    const f = FOOT_SHADE_MIN + (1 - FOOT_SHADE_MIN) * t * t * (3 - 2 * t);
    c[v * 4] *= f;
    c[v * 4 + 1] *= f;
    c[v * 4 + 2] *= f;
  }
}

// Baked geometry, built once per session per detail level and cached (the geometry is
// deterministic). Callers get a copy.
const cache: Partial<Record<Detail, VertexData>> = {};

function bakedGeometry(detail: Detail): VertexData {
  let vd = cache[detail];
  if (!vd) {
    vd = buildSoldier(detail);
    const nv = (vd.positions as number[]).length / 3;
    const ao = decodeAO(detail, vd.positions as number[]);
    if (ao) {
      const c = vd.colors as number[] | Float32Array;
      for (let v = 0; v < nv; v++) {
        const f = 0.4 + (0.6 * ao[v]) / 255;
        c[v * 4] *= f;
        c[v * 4 + 1] *= f;
        c[v * 4 + 2] *= f;
      }
    } else {
      bakeVertexAO(vd, AO_OPTIONS[detail]);
    }
    footShade(vd);
    vd.positions = Float32Array.from(vd.positions as number[]);
    vd.normals = Float32Array.from(vd.normals as number[]);
    vd.colors = Float32Array.from(vd.colors as number[]);
    vd.indices = Uint32Array.from(vd.indices as number[]);
    vd.uvs = null;
    cache[detail] = vd;
  }
  const out = new VertexData();
  out.positions = (vd.positions as Float32Array).slice();
  out.normals = (vd.normals as Float32Array).slice();
  out.colors = (vd.colors as Float32Array).slice();
  out.indices = (vd.indices as Uint32Array).slice();
  return out;
}

// Raw geometry with AO, for tests and tools.
export function soldierGeometry(detail: Detail = 'full'): VertexData {
  return bakedGeometry(detail);
}

function finish(scene: Scene, look: Look, name: string, vd: VertexData): Mesh {
  const mat = look.material('army-plastic', () => armyPlasticMaterial(scene));
  const mesh = buildMesh(scene, name, vd, mat);
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.doNotSyncBoundingInfo = true;
  return mesh;
}

export function createSoldierFallback(scene: Scene, look: Look): Mesh {
  return finish(scene, look, 'soldierLite', bakedGeometry('lite'));
}

export async function createSoldierMesh(scene: Scene, look: Look): Promise<Mesh> {
  let mesh: Mesh;
  try {
    // Let the current frame finish first (matters only if the AO table is stale).
    if (!cache.full) await new Promise<void>((r) => setTimeout(r, 0));
    mesh = finish(scene, look, 'soldier', bakedGeometry('full'));
  } catch (e) {
    console.warn('soldier: full model failed, using the fallback', e);
    mesh = createSoldierFallback(scene, look);
  }
  look.addShadowCaster(mesh, 'crowd');
  return mesh;
}

// ---------- preview ----------
// A 6x4 block of opts.team plus three of the other army off to one side, hopping like
// crowd.ts (|sin| bounce 0.11, forward lean 0.16 rad, waddle 0.1 rad, phase per unit).
interface Unit {
  x: number;
  z: number;
  yaw: number;
  team: TeamName;
  phase: number;
}

export async function preview(scene: Scene, look: Look, opts: PreviewOptions): Promise<PreviewResult> {
  const root = new TransformNode('soldierRoot', scene);
  const mesh = opts.variant === 'lite' ? createSoldierFallback(scene, look) : await createSoldierMesh(scene, look);
  if (opts.variant === 'lite') look.addShadowCaster(mesh, 'crowd');
  mesh.parent = root;
  look.receiveShadows(mesh);
  const other: TeamName = opts.team === 'player' ? 'enemy' : 'player';
  const units: Unit[] = [];
  const sp = 0.62;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 6; c++) {
      const x = (c - 2.5) * sp + (r % 2 ? 0.1 : -0.1);
      const z = (r - 1.5) * sp;
      units.push({ x, z, yaw: 0, team: opts.team, phase: z * 1.9 + x * 3.7 });
    }
  }
  for (let i = 0; i < 3; i++) {
    const x = 2.7 + (i % 2) * 0.5;
    const z = (i - 1) * 0.7;
    units.push({ x, z, yaw: Math.PI, team: other, phase: z * 1.9 + x * 3.7 });
  }
  const matrices = new Float32Array(units.length * 16);
  const colors = new Float32Array(units.length * 4);
  const write = (time: number): void => {
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      const sn = Math.sin(time * 10 + u.phase);
      const hop = Math.abs(sn);
      const pitch = hop * 0.16; // +pitch tips a +Z-facing figure forward
      const roll = sn * 0.1;
      const cp = Math.cos(pitch), spn = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll), cy = Math.cos(u.yaw), sy = Math.sin(u.yaw);
      const o = i * 16;
      const m = matrices;
      // Same row-vector rotation as crowd.ts: Rx(pitch) * Rz(roll) * Ry(yaw).
      m[o] = cr * cy; m[o + 1] = sr; m[o + 2] = -cr * sy; m[o + 3] = 0;
      m[o + 4] = -cp * sr * cy + spn * sy; m[o + 5] = cp * cr; m[o + 6] = cp * sr * sy + spn * cy; m[o + 7] = 0;
      m[o + 8] = spn * sr * cy + cp * sy; m[o + 9] = -spn * cr; m[o + 10] = -spn * sr * sy + cp * cy; m[o + 11] = 0;
      m[o + 12] = u.x; m[o + 13] = hop * 0.11; m[o + 14] = u.z; m[o + 15] = 1;
    }
  };
  units.forEach((u, i) => {
    const c = teamColor(u.team);
    colors.set([c.r, c.g, c.b, 1], i * 4);
  });
  write(0.37);
  mesh.thinInstanceSetBuffer('matrix', matrices, 16, false);
  mesh.thinInstanceSetBuffer('color', colors, 4, true);
  return {
    root,
    update(time) {
      write(time);
      mesh.thinInstanceBufferUpdated('matrix');
    },
    dispose() {
      root.dispose();
    },
  };
}
