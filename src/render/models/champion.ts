// Champion: the big hero army man. A kneeling bazooka soldier (right knee up, left knee
// down) with the tube on his right shoulder aimed forward (+Z), M1 helmet with brim and
// chin strap, moulded nose and brow, webbing (belt, pouches, X-straps, grenades), a rocket
// bag with a flap, strap and two spare rocket tails on his back, and a sergeant's three
// gold chevrons on the outer face of both sleeves plus a gold star on the helmet. Fully
// procedural (no download). Same injection-moulded plastic as the mob soldier, ~2x his
// size on screen.
//
// GAME API (integration):
//   CHAMPION_HEIGHT = 2.6 (to the helmet top, kneeling; footprint radius ~1.0)
//   createChampionMeshes(scene, look): Promise<{ body, trim }>   never rejects
//   createChampionFallback(scene, look): { body, trim }          sync, <= 600 triangles
//
//   - body: team plastic, look.material('army-plastic', plasticMaterial(null,
//     {instanceColor:true})) - the SAME shared material key as the soldier. Give it a
//     thin-instance 'color' buffer of LINEAR teamColor(team) (x 1.12 for the lighter
//     champion moulding). AO and the greyscale paint (webbing, boots, tube) are in the
//     vertex colours (all <= 1, nothing brightened).
//   - trim: gold chevrons + helmet star, toy-yellow clear-coated plastic, NO 'color'
//     buffer (keep it gold). It must share the body's 'matrix' buffer (same instances,
//     same order). May be null (fallback).
//   - Both meshes: pivot at the base-plate centre on y = 0, front +Z, not pickable,
//     alwaysSelectAsActiveMesh, doNotSyncBoundingInfo, and registered as 'crowd' shadow
//     casters (dropped on the low tier: draw blob shadows there, footprint ~1.7 wide (x)
//     by 2.0 deep (z), i.e. blob scale x 1.7, z 2.0).
//   - Yaw: player champions 0, enemy champions PI (side 'team').
//   - Disposing the meshes is the caller's job; the materials belong to the look.
//
// LOAD COST: the vertex AO is baked offline into public/models/champion-ao.bin (~1.3 KB,
// fetched once). createChampionMeshes builds the geometry (a few ms), fetches that file
// and only bakes at runtime (~0.5-1 s blocking) if the file is missing or stale (geometry
// changed). The finished VertexData is cached per module, so later calls only clone it.
// Call it while the level loads anyway. createChampionFallback bakes ~600 triangles
// synchronously (~30 ms, cached too).
//   Regenerate champion-ao.bin after any geometry change: bakeChampionAOFile() returns
//   the bytes (run it from Node with the Babylon deep imports resolvable, or in the
//   preview page's console) and write them to public/models/champion-ao.bin.
//
//   node scripts/preview.mjs champion 5202 [--team=enemy] [--variant=fallback]
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Matrix } from '@babylonjs/core/Maths/math.vector';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Look } from '../look/index.ts';
import { armyPlasticMaterial, assetUrl, bakeVertexAO, buildMesh, fixWinding, lathe, mergeParts, paint, place, plasticMaterial, roundedBox, teamColor } from '../look/index.ts';
import type { ModelInfo, PreviewOptions, PreviewResult } from '../look/model.ts';
import type { TeamName } from '../look/palette.ts';

export const CHAMPION_HEIGHT = 2.6;

export const info: ModelInfo = {
  key: 'champion',
  title: 'Champion: kneeling bazooka soldier',
  instanced: true,
  teams: true,
  side: 'team',
  height: CHAMPION_HEIGHT,
  triangleBudget: 2000,
  gameZ: 15,
  variants: ['full', 'fallback'],
};

export interface ChampionMeshes {
  body: Mesh;
  trim: Mesh | null;
}

// ---------- small geometry helpers ----------
type V3 = readonly [number, number, number];
type Prof = [number, number][];
interface Lod {
  hi: boolean; // full detail (false = the sync fallback)
}

// Non-uniform scale with correct normals (n / s, renormalised).
function scale3(vd: VertexData, sx: number, sy: number, sz: number): VertexData {
  const p = vd.positions!;
  const n = vd.normals!;
  for (let i = 0; i < p.length; i += 3) {
    p[i] *= sx;
    p[i + 1] *= sy;
    p[i + 2] *= sz;
    const nx = n[i] / sx, ny = n[i + 1] / sy, nz = n[i + 2] / sz;
    const l = Math.hypot(nx, ny, nz) || 1;
    n[i] = nx / l;
    n[i + 1] = ny / l;
    n[i + 2] = nz / l;
  }
  return vd;
}

// Rotation+translation that maps local +Y onto the direction a->b, origin onto a, and
// local +X as close as possible to `out` (used to aim sleeve chevrons outward).
function frame(a: V3, b: V3, out: V3 = [1, 0, 0]): Matrix {
  let dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const l = Math.hypot(dx, dy, dz) || 1;
  dx /= l; dy /= l; dz /= l;
  const k = out[0] * dx + out[1] * dy + out[2] * dz;
  let ux = out[0] - k * dx, uy = out[1] - k * dy, uz = out[2] - k * dz;
  let ul = Math.hypot(ux, uy, uz);
  if (ul < 1e-4) {
    ux = dy; uy = -dx; uz = 0;
    ul = Math.hypot(ux, uy, uz) || 1;
  }
  ux /= ul; uy /= ul; uz /= ul;
  // w = u x d (keeps determinant +1).
  const wx = uy * dz - uz * dy, wy = uz * dx - ux * dz, wz = ux * dy - uy * dx;
  return Matrix.FromValues(ux, uy, uz, 0, dx, dy, dz, 0, wx, wy, wz, 0, a[0], a[1], a[2], 1);
}

function dist(a: V3, b: V3): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

function lerp3(a: V3, b: V3, t: number): V3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// A tapered capsule from a (radius ra) to b (radius rb).
function limb(a: V3, b: V3, ra: number, rb: number, tess: number, lod: Lod): VertexData {
  const L = dist(a, b);
  // The ends are rounded cones: the joints are capped by knee/elbow/shoulder spheres,
  // the torso, boots and hands.
  // Repeated points crease the ends so the shaft keeps clean side normals (no banding).
  const prof: Prof = lod.hi
    ? [[0, -ra * 0.7], [ra, 0], [ra, 0], [rb, L], [rb, L], [0, L + rb * 0.7]]
    : [[0, -ra * 0.8], [ra, 0], [rb, L], [0, L + rb * 0.8]];
  const vd = lathe(prof, tess);
  vd.transform(frame(a, b));
  return vd;
}

function sphereVD(r: number, tess: number, rings: number): VertexData {
  const prof: Prof = [];
  for (let i = 0; i <= rings; i++) {
    const t = -Math.PI / 2 + (i / rings) * Math.PI;
    prof.push([Math.cos(t) * r, Math.sin(t) * r]);
  }
  prof[0][0] = 0;
  prof[rings][0] = 0;
  return lathe(prof, tess);
}

function sphere(c: V3, r: number, tess: number, rings: number, s: V3 = [1, 1, 1]): VertexData {
  const vd = scale3(sphereVD(r, tess, rings), s[0], s[1], s[2]);
  return place(vd, { x: c[0], y: c[1], z: c[2] });
}

function box(w: number, h: number, d: number, r: number, seg: number, t: Parameters<typeof place>[1]): VertexData {
  return place(roundedBox(w, h, d, r, seg), t);
}

// A soft "pillow" box (n-sided lathe, flat faces on the axes): w x h x d, centred,
// bevelled top and bottom, smooth corners. 4 sides = 32 triangles, 8 sides = 64.
function pillow(w: number, h: number, d: number, t: Parameters<typeof place>[1], bevel = 0.25, sides = 4): VertexData {
  const hh = h / 2;
  const b = Math.min(hh * 0.9, bevel * Math.min(w, d));
  const vd = lathe([[0, -hh], [0.76, -hh], [1, -hh + b], [1, hh - b], [0.76, hh], [0, hh]], sides);
  place(vd, { ry: Math.PI / sides });
  const k = 1 / Math.cos(Math.PI / sides);
  scale3(vd, (w / 2) * k, 1, (d / 2) * k);
  return place(vd, t);
}

// Greyscale paint multipliers (vertex colours; the instance colour supplies the hue).
const SHADE = {
  uniform: 0.93,
  helmet: 1.0,
  face: 1.0,
  base: 0.86,
  webbing: 0.74,
  flap: 0.86,
  boot: 0.78,
  tube: 0.84,
  bore: 0.42,
  boreDeep: 0.3,
  metal: 0.7,
  grenade: 0.82,
  rocket: 0.8,
} as const;

function grey(vd: VertexData, g: number): VertexData {
  return paint(vd, [g, g, g]);
}

// Paints a lathe by profile index (the lathe keeps every profile vertex per segment).
function greyByProfile(vd: VertexData, shades: readonly number[]): VertexData {
  const n = shades.length;
  const nv = vd.positions!.length / 3;
  const colors = new Float32Array(nv * 4);
  for (let v = 0; v < nv; v++) {
    const g = shades[v % n];
    colors.set([g, g, g, 1], v * 4);
  }
  vd.colors = colors;
  return vd;
}

// ---------- the figure ----------
// Key joint positions (x right, y up, z forward). The figure kneels on his left knee,
// right foot planted forward, and shoulders the tube on the right.
const J = {
  hipL: [-0.25, 0.98, -0.12] as V3,
  hipR: [0.25, 0.98, -0.06] as V3,
  kneeL: [-0.29, 0.29, -0.02] as V3, // on the ground
  ankleL: [-0.29, 0.26, -0.62] as V3, // shin lies back along the base
  kneeR: [0.31, 0.88, 0.5] as V3, // up
  ankleR: [0.31, 0.28, 0.56] as V3,
  shoulderL: [-0.42, 1.72, -0.04] as V3,
  shoulderR: [0.42, 1.74, -0.02] as V3,
  elbowR: [0.56, 1.36, 0.14] as V3,
  handR: [0.44, 1.71, 0.32] as V3, // rear pistol grip
  elbowL: [-0.26, 1.33, 0.38] as V3,
  handL: [0.33, 1.75, 0.74] as V3, // front grip
};
const TUBE = { x: 0.44, y: 2.0, z0: -0.94, z1: 1.06, r: 0.125 };
const HEAD: V3 = [-0.05, 2.08, 0.06];
// M1 helmet profile [radius, y] (relative to the helmet origin), z stretched by HELM_Z.
const HELM: Prof = [[0.33, -0.05], [0.4, -0.02], [0.4, 0.005], [0.345, 0.03], [0.32, 0.17], [0.24, 0.3], [0.12, 0.36], [0, 0.375]];
const HELM_Z = 1.1;
const HELM_AT = { x: HEAD[0], y: HEAD[1] + 0.06, z: HEAD[2] - 0.02, rx: 0.08 };
// The figure is laid out ~2.51 tall; scale it to CHAMPION_HEIGHT (footprint radius ~1).
const FIT = 1.035;

function buildBody(lod: Lod): VertexData {
  const hi = lod.hi;
  const T = hi ? 6 : 5; // limb tessellation
  const parts: VertexData[] = [];
  const add = (vd: VertexData, g: number | null): void => {
    parts.push(g === null ? vd : grey(vd, g));
  };

  // Base plate: oval with a bevelled rim, 1.6 wide x 1.9 deep (footprint radius ~1).
  const baseProf: Prof = hi
    ? [[0.95, 0], [0.975, 0.05], [0.9, 0.112], [0, 0.115]]
    : [[0.96, 0], [0.96, 0.09], [0.88, 0.115], [0, 0.115]];
  add(place(scale3(lathe(baseProf, hi ? 22 : 10), 0.84, 1, 1), { z: 0.02 }), SHADE.base);

  // Legs. Left: thigh down to the knee on the ground, shin back along the base.
  add(limb(J.hipL, J.kneeL, 0.2, 0.16, T, lod), SHADE.uniform);
  add(limb(J.kneeL, J.ankleL, 0.155, 0.13, T, lod), SHADE.uniform);
  // Left boot: toes tucked under, heel up.
  add(pillow(0.24, 0.3, 0.32, { x: -0.29, y: 0.24, z: -0.76, rx: -0.55 }), SHADE.boot);
  // Right: thigh forward to the raised knee, shin straight down to the planted boot.
  add(limb(J.hipR, J.kneeR, 0.21, 0.17, T, lod), SHADE.uniform);
  add(limb(J.kneeR, J.ankleR, 0.16, 0.14, T, lod), SHADE.uniform);
  add(pillow(0.28, 0.2, 0.48, { x: 0.31, y: 0.21, z: 0.64 }, hi ? 0.3 : 0.25), SHADE.boot);
  if (hi) {
    // Knee caps hide the capsule creases.
    add(sphere(J.kneeL, 0.165, 5, 3), SHADE.uniform);
    add(sphere(J.kneeR, 0.175, 5, 3), SHADE.uniform);
  }

  // Torso: an elliptical lathe, broad shoulders, flaring into full hips at the bottom so
  // the seat flows into it with no ledge at the belt line, leaning forward a little.
  const torsoProf: Prof = hi
    ? [[0, -0.2], [0.24, -0.19], [0.33, -0.1], [0.33, 0.12], [0.36, 0.38], [0.39, 0.6], [0.35, 0.76], [0.2, 0.86], [0, 0.88]]
    : [[0, -0.2], [0.33, -0.12], [0.33, 0.1], [0.38, 0.6], [0.22, 0.84], [0, 0.88]];
  add(place(scale3(lathe(torsoProf, hi ? 11 : 6), 1.24, 1, 0.7), { y: 1.0, z: -0.06, rx: 0.12 }), SHADE.uniform);
  // Rounded deltoid caps where the arms join.
  if (hi) {
    add(sphere(J.shoulderL, 0.165, 6, 4, [1, 0.9, 1]), SHADE.uniform);
    add(sphere(J.shoulderR, 0.175, 6, 4, [1, 0.9, 1]), SHADE.uniform);
  }
  // Neck and head (under the helmet; the face shows below the brim).
  add(sphere(HEAD, 0.22, hi ? 8 : 6, hi ? 4 : 3, [0.92, 1.0, 1.0]), SHADE.face);
  if (hi) {
    // Moulded face: brow ridge under the brim and a wedge nose.
    add(pillow(0.28, 0.055, 0.09, { x: HEAD[0], y: HEAD[1] - 0.0, z: HEAD[2] + 0.19, rx: -0.15 }, 0.4), SHADE.face);
    const nose = lathe([[0, 0], [0.055, 0], [0, 0.1]], 4);
    place(nose, { ry: Math.PI / 4 });
    scale3(nose, 0.75, 1, 1.25);
    // Point it forward and a touch down (+Y -> +Z), base buried in the face.
    place(nose, { rx: Math.PI / 2 + 0.3, x: HEAD[0], y: HEAD[1] - 0.05, z: HEAD[2] + 0.18 });
    add(nose, SHADE.face);
    // Chin strap: a thin ring from under the brim at the temples to under the chin; its
    // back half disappears up inside the helmet.
    const strap = lathe([[0.235, -0.014], [0.247, 0], [0.235, 0.014]], 8);
    place(strap, { rx: Math.PI / 2 - 0.5, x: HEAD[0], y: HEAD[1] + 0.02, z: HEAD[2] });
    add(strap, SHADE.webbing);
  }
  // M1 helmet: dome with a flared brim, a touch longer front to back, tipped down to aim.
  const helmProf: Prof = hi ? HELM : [[0.33, -0.04], [0.4, 0.0], [0.32, 0.12], [0.2, 0.32], [0, 0.37]];
  add(place(scale3(lathe(helmProf, hi ? 14 : 8), 1, 1, HELM_Z), HELM_AT), SHADE.helmet);

  // Arms: right hand on the rear pistol grip, left hand reaching to the front grip.
  add(limb(J.shoulderR, J.elbowR, 0.155, 0.13, T, lod), SHADE.uniform);
  add(limb(J.elbowR, J.handR, 0.13, 0.105, T, lod), SHADE.uniform);
  add(limb(J.shoulderL, J.elbowL, 0.155, 0.13, T, lod), SHADE.uniform);
  add(limb(J.elbowL, J.handL, 0.13, 0.105, T, lod), SHADE.uniform);
  if (hi) {
    add(sphere(J.elbowR, 0.138, 5, 3), SHADE.uniform);
    add(sphere(J.elbowL, 0.138, 5, 3), SHADE.uniform);
  }
  // Mitten hands, flattened and aimed along the forearm, closed around the grips.
  for (const [el, h] of [[J.elbowR, J.handR], [J.elbowL, J.handL]] as const) {
    const m = scale3(sphereVD(0.12, hi ? 6 : 5, hi ? 3 : 2), 0.95, 1.3, 0.78);
    place(m, { y: 0.03 });
    m.transform(frame(h, lerp3(el, h, 2), [1, 0, 0]));
    add(m, SHADE.face);
  }

  // Bazooka. Rear: a 16-sided flared bell with a rolled lip and a moulded bore (graded
  // shading into the tube, not a black disc). Body: a 10-sided tube with a mid band and a
  // front rim with a recessed muzzle.
  const r = TUBE.r;
  const tubeLen = TUBE.z1 - TUBE.z0;
  const along = { x: TUBE.x, y: TUBE.y, z: TUBE.z0, rx: Math.PI / 2 }; // lathe +Y -> +Z
  if (hi) {
    const bell: Prof = [[0, 0.17], [0.13, 0.15], [0.18, 0.035], [0.204, -0.008], [0.232, 0.014], [0.222, 0.085], [r + 0.005, 0.42]];
    add(place(greyByProfile(lathe(bell, 16), [SHADE.boreDeep, SHADE.boreDeep, SHADE.bore, 0.62, SHADE.tube, SHADE.tube, SHADE.tube]), along), null);
    const body: Prof = [[r + 0.005, 0.42], [r, 0.86], [r + 0.026, 0.885], [r + 0.026, 0.975], [r, 1.0],
      [r, tubeLen - 0.1], [r + 0.03, tubeLen - 0.078], [r + 0.03, tubeLen], [r - 0.03, tubeLen], [0, tubeLen - 0.07]];
    add(place(greyByProfile(lathe(body, 10), [0.84, 0.84, 0.84, 0.84, 0.84, 0.84, 0.84, 0.84, 0.6, SHADE.boreDeep]), along), null);
  } else {
    const tubeProf: Prof = [[0.21, 0], [r, 0.38], [r, tubeLen - 0.06], [r + 0.02, tubeLen], [r - 0.03, tubeLen], [0, tubeLen - 0.05]];
    add(place(greyByProfile(lathe(tubeProf, 6), [0.6, 0.84, 0.84, 0.84, 0.6, 0.35]), along), null);
    add(place(lathe([[0, 0], [0.2, 0]], 6), { x: TUBE.x, y: TUBE.y, z: TUBE.z0 + 0.03, rx: Math.PI / 2 }), SHADE.bore);
  }
  // Shoulder rest under the tube, two pistol grips, the sight box on the left side and a
  // front sight post.
  add(pillow(0.18, 0.13, 0.36, { x: TUBE.x, y: TUBE.y - 0.16, z: -0.06 }), SHADE.tube);
  add(box(0.09, 0.26, 0.13, 0.035, 0, { x: TUBE.x, y: TUBE.y - 0.21, z: 0.32, rx: -0.25 }), SHADE.metal);
  add(box(0.09, 0.24, 0.12, 0.035, 0, { x: TUBE.x, y: TUBE.y - 0.2, z: 0.74, rx: -0.15 }), SHADE.metal);
  if (hi) {
    // Sight: a box on a short arm, sticking out up-left of the tube (a notch in the
    // silhouette from behind and from the side), plus a tall front sight post.
    add(pillow(0.12, 0.2, 0.3, { x: TUBE.x - 0.2, y: TUBE.y + 0.12, z: 0.14 }, 0.3), SHADE.metal);
    add(box(0.12, 0.06, 0.08, 0.02, 0, { x: TUBE.x - 0.11, y: TUBE.y + 0.07, z: 0.14, rz: 0.5 }), SHADE.metal);
    add(box(0.05, 0.17, 0.07, 0.015, 0, { x: TUBE.x, y: TUBE.y + 0.2, z: TUBE.z1 - 0.2 }), SHADE.metal);
  }

  // Webbing: pistol belt with pouches and buckle.
  if (hi) {
    const beltProf: Prof = [[0.335, -0.065], [0.355, -0.04], [0.355, 0.04], [0.335, 0.065]];
    add(place(scale3(place(lathe(beltProf, 8), { ry: Math.PI / 8 }), 1.22, 1, 0.72), { y: 1.14, z: -0.07, rx: 0.06 }), SHADE.webbing);
    add(box(0.14, 0.09, 0.06, 0.02, 0, { y: 1.14, z: 0.19 }), SHADE.metal); // buckle
    for (const x of [-0.27, 0.27]) add(box(0.15, 0.17, 0.1, 0.04, 0, { x, y: 1.09, z: 0.15, ry: x > 0 ? -0.5 : 0.5 }), SHADE.webbing);
  }
  // Suspender straps: front pair down the chest, crossing X on the back.
  const strap = (a: V3, b: V3): void => {
    const L = dist(a, b);
    const vd = roundedBox(0.1, L, 0.045, 0.015, 0);
    place(vd, { y: L / 2 });
    vd.transform(frame(a, b, [0, 0, a[2] > -0.1 ? 1 : -1]));
    add(vd, SHADE.webbing);
  };
  if (hi) {
    strap([-0.21, 1.18, 0.17], [-0.21, 1.8, 0.08]);
    strap([0.21, 1.18, 0.19], [0.21, 1.8, 0.1]);
    strap([-0.27, 1.2, -0.34], [0.25, 1.76, -0.27]);
    strap([0.27, 1.2, -0.34], [-0.25, 1.76, -0.27]);
    // Grenades clipped to the front straps.
    for (const [x, z] of [[-0.22, 0.2], [0.22, 0.21]] as const) {
      add(sphere([x, 1.48, z], 0.085, 5, 3, [1, 1.3, 1]), SHADE.grenade);
    }
  }
  // Rocket bag on the back: a rounded 8-sided pillow, a flap overhanging its top, a strap
  // with a buckle down the middle and two spare rocket tails poking out of the top.
  const bagAt = { x: -0.02, y: 1.4, z: -0.47, rx: 0.12 };
  const bag: VertexData[] = [];
  const bagAdd = (vd: VertexData, g: number): void => {
    bag.push(grey(vd, g));
  };
  bagAdd(pillow(0.5, 0.46, 0.24, {}, hi ? 0.4 : 0.25, hi ? 8 : 4), SHADE.webbing);
  if (hi) {
    bagAdd(pillow(0.46, 0.17, 0.06, { y: 0.15, z: -0.12, rx: -0.12 }, 0.35), SHADE.flap); // flap overhanging the back
    bagAdd(box(0.075, 0.3, 0.03, 0.012, 0, { y: -0.05, z: -0.128 }), SHADE.webbing); // strap
    bagAdd(box(0.11, 0.07, 0.04, 0.015, 0, { y: 0.06, z: -0.142 }), SHADE.metal); // buckle
    for (const x of [-0.13, 0.12]) {
      const tail = lathe([[0.058, 0], [0.058, 0.07], [0.03, 0.12], [0.03, 0.22], [0, 0.225]], 5);
      bagAdd(place(tail, { x, y: 0.2, z: 0.02, rx: -0.25 }), SHADE.rocket);
      const fin = box(0.13, 0.08, 0.016, 0.006, 0, { y: 0.175 }); // tail fins, seen edge-on from the side
      bagAdd(place(fin, { x, y: 0.2, z: 0.02, rx: -0.25 }), SHADE.rocket);
    }
  }
  for (const vd of bag) add(place(vd, bagAt), null);

  const vd = place(mergeParts(parts), { s: FIT });
  fixWinding(vd);
  return vd;
}

// ---------- gold trim ----------
// One chevron: a flat V strip (points toward the shoulder) wrapped onto the sleeve
// cylinder. Built in the upper arm's frame (+Y down the arm, +X outward): u runs around
// the sleeve, v down it. 16 triangles (front face + side walls; the back sits on the arm).
function chevron(m: Matrix, vTop: number, radiusAt: (v: number) => number): VertexData {
  const W = 0.11; // half width of the V
  const RISE = 0.075; // how far the arms' ends drop below the apex
  const S = 0.05; // stripe width (measured along the arm)
  const LIFT = 0.016; // proud of the sleeve
  const TH = 0.03; // moulded thickness
  // Outline: top edge (end, apex, end) then bottom edge (end, apex, end).
  const uv: [number, number][] = [[-W, vTop + RISE], [0, vTop], [W, vTop + RISE], [-W, vTop + RISE + S], [0, vTop + S * 1.25], [W, vTop + RISE + S]];
  const at = (u: number, v: number, h: number): [number, number, number, number, number, number] => {
    const R = radiusAt(v) + h;
    const a = u / radiusAt(v);
    return [Math.cos(a) * R, v, Math.sin(a) * R, Math.cos(a), 0, Math.sin(a)];
  };
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  const vert = (q: [number, number, number, number, number, number], n?: V3): number => {
    pos.push(q[0], q[1], q[2]);
    nrm.push(...(n ?? [q[3], q[4], q[5]]));
    return pos.length / 3 - 1;
  };
  // Front face.
  const f = uv.map(([u, v]) => vert(at(u, v, LIFT + TH - 0.02)));
  idx.push(f[0], f[1], f[4], f[0], f[4], f[3], f[1], f[2], f[5], f[1], f[5], f[4]);
  // Side walls around the outline (6 edges, 2 triangles each), normals along the edge's
  // outward side (approximated in the surface plane).
  const loop = [0, 1, 2, 5, 4, 3];
  for (let k = 0; k < 6; k++) {
    const [u0, v0] = uv[loop[k]];
    const [u1, v1] = uv[loop[(k + 1) % 6]];
    const du = u1 - u0, dv = v1 - v0;
    const l = Math.hypot(du, dv) || 1;
    // Outward in uv space: the loop runs so that (dv, -du) points out of the strip.
    const nu = dv / l, nv = -du / l;
    const cv = (v0 + v1) / 2;
    const um = (u0 + u1) / 2;
    const a = um / radiusAt(cv);
    const n: V3 = [-Math.sin(a) * nu, nv, Math.cos(a) * nu];
    const p0 = vert(at(u0, v0, -0.01), n), p1 = vert(at(u1, v1, -0.01), n);
    const q0 = vert(at(u0, v0, LIFT + TH - 0.02), n), q1 = vert(at(u1, v1, LIFT + TH - 0.02), n);
    idx.push(p0, p1, q1, p0, q1, q0);
  }
  const vd = new VertexData();
  vd.positions = pos;
  vd.normals = nrm;
  vd.indices = idx;
  fixWinding(vd);
  vd.transform(m);
  return vd;
}

// A slightly domed 5-point star stuck to the front of the helmet, with a moulded edge.
function helmetStar(): VertexData {
  const R1 = 0.13, R0 = 0.055, LIFT = 0.014, TH = 0.022;
  const cy = 0.16; // helmet-local height of the star centre
  const helmR = (y: number): number => {
    for (let i = 1; i < HELM.length; i++) {
      const [r0, y0] = HELM[i - 1], [r1, y1] = HELM[i];
      if (y >= y0 && y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0 || 1);
    }
    return HELM[HELM.length - 1][0];
  };
  // Point on the helmet surface in front, at helmet-local (x, y), lifted by h.
  const at = (x: number, y: number, h: number): [number, number, number] => {
    const r = helmR(y);
    const z = HELM_Z * Math.sqrt(Math.max(0, r * r - x * x));
    const nx = x / r, nz = z / (HELM_Z * HELM_Z * r);
    const l = Math.hypot(nx, 0.25, nz);
    return [x + (nx / l) * h, y + (0.25 / l) * h, z + (nz / l) * h];
  };
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  const vert = (p: [number, number, number], n: V3): number => {
    pos.push(...p);
    nrm.push(...n);
    return pos.length / 3 - 1;
  };
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 ? R0 : R1;
    pts.push([Math.cos(a) * rad, cy + Math.sin(a) * rad]);
  }
  const top = LIFT + TH;
  const c = vert(at(0, cy, top + 0.006), [0, 0.25, 1]);
  const ring = pts.map(([x, y]) => vert(at(x, y, top), [x * 2, 0.25 + (y - cy) * 2, 1]));
  for (let i = 0; i < 10; i++) idx.push(c, ring[i], ring[(i + 1) % 10]);
  for (let i = 0; i < 10; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % 10];
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2 - cy;
    const l = Math.hypot(mx, my) || 1;
    const n: V3 = [mx / l, my / l, 0.2];
    const a = vert(at(x0, y0, 0), n), b = vert(at(x1, y1, 0), n);
    const a2 = vert(at(x0, y0, top), n), b2 = vert(at(x1, y1, top), n);
    idx.push(a, b, b2, a, b2, a2);
  }
  const vd = new VertexData();
  vd.positions = pos;
  vd.normals = nrm.map((v, i, arr) => {
    const b = i - (i % 3);
    return v / (Math.hypot(arr[b], arr[b + 1], arr[b + 2]) || 1);
  });
  vd.indices = idx;
  fixWinding(vd);
  return place(vd, HELM_AT);
}

// Gold rank: three chevrons on the outer face of each upper sleeve and a helmet star.
function buildTrim(): VertexData {
  const parts: VertexData[] = [];
  for (const side of [-1, 1] as const) {
    const sh = side < 0 ? J.shoulderL : J.shoulderR;
    const el = side < 0 ? J.elbowL : J.elbowR;
    const L = dist(sh, el);
    // Outward and a little backward, so the camera behind the player's champions sees
    // them in its three-quarter view.
    const m = frame(sh, el, [side, 0.0, -0.35]);
    const radiusAt = (v: number): number => 0.155 + ((0.13 - 0.155) * v) / L;
    for (let k = 0; k < 3; k++) parts.push(chevron(m, 0.12 + k * 0.085, radiusAt));
  }
  parts.push(helmetStar());
  return place(mergeParts(parts), { s: FIT });
}

// ---------- materials, caching, AO ----------
function setupInstanced(look: Look, mesh: Mesh): Mesh {
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.doNotSyncBoundingInfo = true;
  look.addShadowCaster(mesh, 'crowd');
  look.receiveShadows(mesh);
  return mesh;
}

function bodyMaterial(scene: Scene, look: Look) {
  return look.material('army-plastic', () => armyPlasticMaterial(scene));
}

function trimMaterial(scene: Scene, look: Look) {
  return look.material('champion-gold', () => plasticMaterial(scene, 'toyYellow', { clearcoat: 0.4, roughness: 0.34 }));
}

const AO_OPTS = { samples: 16, maxDist: 0.5, strength: 0.7 } as const;
const AO_MAGIC = 0x43484131; // 'CHA1'
export const CHAMPION_AO_URL = 'models/champion-ao.bin';

function clone(vd: VertexData): VertexData {
  const out = new VertexData();
  out.positions = Float32Array.from(vd.positions!);
  out.normals = Float32Array.from(vd.normals!);
  out.indices = Uint32Array.from(vd.indices!);
  if (vd.colors) out.colors = Float32Array.from(vd.colors);
  if (vd.uvs) out.uvs = Float32Array.from(vd.uvs);
  return out;
}

// A cheap fingerprint of the geometry, so a stale AO file is never applied.
function checksum(vd: VertexData): number {
  let h = 0x811c9dc5;
  const p = vd.positions!;
  for (let i = 0; i < p.length; i++) {
    h ^= Math.round(p[i] * 1000) & 0xffff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h ^ vd.indices!.length) >>> 0;
}

// The bytes of public/models/champion-ao.bin for the current geometry: a 16-byte header
// (magic, vertex count, index count, checksum) then one AO byte per vertex.
export function bakeChampionAOFile(): Uint8Array {
  const vd = buildBody({ hi: true });
  const white = clone(vd);
  white.colors = new Float32Array((vd.positions!.length / 3) * 4).fill(1);
  bakeVertexAO(white, AO_OPTS);
  const nv = vd.positions!.length / 3;
  const out = new Uint8Array(16 + nv);
  new Uint32Array(out.buffer, 0, 4).set([AO_MAGIC, nv, vd.indices!.length, checksum(vd)]);
  for (let v = 0; v < nv; v++) out[16 + v] = Math.round(Math.min(1, white.colors[v * 4]) * 255);
  return out;
}

// Applies the shipped AO; false when the file does not match the geometry.
function applyAOFile(vd: VertexData, buf: ArrayBuffer): boolean {
  if (buf.byteLength < 16) return false;
  const h = new Uint32Array(buf, 0, 4);
  const nv = vd.positions!.length / 3;
  if (h[0] !== AO_MAGIC || h[1] !== nv || h[2] !== vd.indices!.length || h[3] !== checksum(vd)) return false;
  if (buf.byteLength !== 16 + nv) return false;
  const ao = new Uint8Array(buf, 16, nv);
  const c = vd.colors!;
  for (let v = 0; v < nv; v++) {
    const k = ao[v] / 255;
    c[v * 4] *= k;
    c[v * 4 + 1] *= k;
    c[v * 4 + 2] *= k;
  }
  return true;
}

async function loadBody(): Promise<VertexData> {
  const vd = buildBody({ hi: true });
  try {
    const res = await fetch(assetUrl(CHAMPION_AO_URL));
    if (res.ok && applyAOFile(vd, await res.arrayBuffer())) return vd;
  } catch {
    // fall through to the runtime bake
  }
  console.warn('champion: champion-ao.bin missing or stale; baking AO at runtime');
  await new Promise((r) => setTimeout(r, 0)); // let a loading frame paint first
  return bakeVertexAO(vd, AO_OPTS);
}

let bodyCache: Promise<VertexData> | null = null;
let trimCache: VertexData | null = null;
let lowCache: VertexData | null = null;

// Full-detail champion (see LOAD COST above). Never rejects: on any error it resolves
// with the fallback.
export async function createChampionMeshes(scene: Scene, look: Look): Promise<ChampionMeshes> {
  try {
    bodyCache ??= loadBody();
    let baked: VertexData;
    try {
      baked = await bodyCache;
    } catch (e) {
      bodyCache = null;
      throw e;
    }
    trimCache ??= buildTrim();
    const body = setupInstanced(look, buildMesh(scene, 'championBody', clone(baked), bodyMaterial(scene, look)));
    const trim = setupInstanced(look, buildMesh(scene, 'championTrim', clone(trimCache), trimMaterial(scene, look)));
    return { body, trim };
  } catch (e) {
    console.warn('champion: full model failed, using the fallback', e);
    return createChampionFallback(scene, look);
  }
}

// Low-detail champion (<= 600 triangles), synchronous; same pose, pivot and materials.
export function createChampionFallback(scene: Scene, look: Look): ChampionMeshes {
  lowCache ??= bakeVertexAO(buildBody({ hi: false }), { samples: 10, maxDist: 0.5, strength: 0.6 });
  const body = setupInstanced(look, buildMesh(scene, 'championBodyLow', clone(lowCache), bodyMaterial(scene, look)));
  return { body, trim: null };
}

// ---------- preview ----------
export async function preview(scene: Scene, look: Look, opts: PreviewOptions): Promise<PreviewResult> {
  const root = new TransformNode('championRoot', scene);
  const low = opts.variant === 'fallback';
  const { body, trim } = low ? createChampionFallback(scene, look) : await createChampionMeshes(scene, look);
  body.parent = root;
  if (trim) trim.parent = root;
  const team: TeamName = opts.team;
  const other: TeamName = team === 'player' ? 'enemy' : 'player';
  // Three of opts.team in a row, one of the other team facing them further up the lane.
  const units: { x: number; z: number; yaw: number; team: TeamName }[] = [
    { x: -2.3, z: 0, yaw: 0, team },
    { x: 0, z: 0.4, yaw: 0, team },
    { x: 2.3, z: 0, yaw: 0, team },
    { x: 0.6, z: 4.2, yaw: Math.PI, team: other },
  ];
  const n = units.length;
  const matrices = new Float32Array(n * 16);
  const colors = new Float32Array(n * 4);
  const tmp = new Matrix();
  const write = (time: number): void => {
    units.forEach((u, i) => {
      const bob = Math.max(0, Math.sin(time * 1.6 + i * 1.3)) * 0.06;
      Matrix.RotationYToRef(u.yaw, tmp);
      tmp.setTranslationFromFloats(u.x, bob, u.z);
      tmp.copyToArray(matrices, i * 16);
    });
  };
  write(0);
  units.forEach((u, i) => {
    const c = teamColor(u.team).scale(1.12);
    colors.set([c.r, c.g, c.b, 1], i * 4);
  });
  body.thinInstanceSetBuffer('matrix', matrices, 16, false);
  body.thinInstanceSetBuffer('color', colors, 4, true);
  trim?.thinInstanceSetBuffer('matrix', matrices, 16, false);
  return {
    root,
    update(time) {
      write(time);
      body.thinInstanceBufferUpdated('matrix');
      trim?.thinInstanceBufferUpdated('matrix');
    },
    dispose() {
      root.dispose();
    },
  };
}

// Triangle counts (for tooling/tests): { body, trim, low }.
export function championTriangleCounts(): { body: number; trim: number; low: number } {
  return {
    body: buildBody({ hi: true }).indices!.length / 3,
    trim: buildTrim().indices!.length / 3,
    low: buildBody({ hi: false }).indices!.length / 3,
  };
}
