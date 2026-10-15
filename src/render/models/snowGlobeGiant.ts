// The Snow Globe Giant (World 2 boss, level 2-10): a big toy snow globe on a wind-up music
// box that IS the enemy base. The base is a lacquered teal music-box drum, oval to fill
// the base footprint, with brass bands, a ring of cream studs, a brass name plaque at the
// front and a brass wind-up key at the back. On it a brass collar holds a glass dome; under
// the glass, on a snowy mound with three little pines, stands the Giant himself: a three-
// ball snowman general in a red tin bucket helmet with a gold rim, a knitted red scarf,
// coal eyes, smile and buttons, a big carrot nose, a twig arm on his hip and a throwing
// arm with a red mitten. Snow swirls round him inside the glass.
//
// Draw calls (6, ~11k triangles):
//   base      1  music box + collar      own 'toy-mix' material (vertex colours)
//   interior  1  mound, pines, snowman   same material; turns on the music-box turntable
//   arm       1  the throwing arm        same material; rotation.x on a shoulder pivot
//   snow      1  thin-instanced flakes   same material; the snowball in his hand is one
//   glass     1  the dome                 own alpha-blended glass (frost: setFrost)
//   blob      1  contact shadow
// The materials are this model's own (not the look's shared ones), so the hit / phase
// flash and the frost only touch this toy; dispose() frees them.
//
// GAME API
//   createSnowGlobeGiant(scene, look, { width, depth, baseHeight }): SnowGlobeGiantModel
//     width: level.enemyBase.width; depth: LAYOUT.enemyBaseDepth; baseHeight: music-box
//     height (~1.05). Pivot: the base's ground centre, front (the Giant's face) +Z; side
//     'enemy' (integration / boss.ts turns root by PI so he faces the camera).
//   model.globe        TransformNode at the base top: rock it (rotation.x / .z) to shake
//                      the globe on its base (never the camera).
//   model.interior     TransformNode: turntable (rotation.y) and pop (setPop).
//   model.arm          TransformNode: the throwing arm's shoulder; ARM_REST is its rest
//                      rotation.x (negative swings the hand forward).
//   model.hpBarAnchor  Vector3, root-local: the front top edge of the music box.
//   model.setFlash(k)  0..1 warm flash on the whole toy.   model.setPop(s) interior scale.
//   model.setFrost(k)  0..1 frosts the glass bright (phase 2).
//   model.setSnow(dt, swirl, ball)  advances the swirling snow (swirl 0 calm .. 1 shaken)
//                      and shows the snowball in his mitten when `ball` is true.
//   model.dispose()
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Look } from '../look/index.ts';
import {
  MIX,
  buildMesh,
  createBlobShadowMesh,
  glassMaterial,
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
import { mulberry32, writeTRS } from '../fxLogic.ts';
import { sphereVD } from './champion.ts';
import { scaled, tube } from './soldier.ts';
import type { V3 } from './soldier.ts';

export const info: ModelInfo = {
  key: 'snowGlobeGiant',
  title: 'Boss: the Snow Globe Giant',
  instanced: false,
  teams: false,
  side: 'enemy',
  height: 4.2,
  triangleBudget: 14000,
  gameZ: 57,
  variants: ['calm', 'frost', 'shake'],
};

export interface SnowGlobeOptions {
  width: number;
  depth: number;
  baseHeight: number;
}

export interface SnowGlobeGiantModel {
  root: TransformNode;
  globe: TransformNode;
  interior: TransformNode;
  arm: TransformNode;
  hpBarAnchor: Vector3;
  setFlash(k: number): void;
  setPop(scale: number): void;
  setFrost(k: number): void;
  setSnow(dt: number, swirl: number, ball: boolean): void;
  dispose(): void;
}

export const ARM_REST = -0.45;

const C = {
  lacquer: '#1d7c84', // teal music-box lacquer (never the rug's indigo)
  lacquerDark: '#135a61',
  cream: '#f1e4c4',
  snow: '#edf1f3',
  snowShade: '#d3dfe9',
  coal: '#252528',
  carrot: '#ea7426',
  red: '#c7362c',
  redDark: '#8f241d',
  gold: '#e0b04a',
  twig: '#6e4a2c',
  pine: '#1f5f63', // dark blue-green spruce, clear of the army green
  pineLight: '#2c7a74',
};

const part = (vd: VertexData, color: string, slot: MixSlot): VertexData => {
  vd.uvs = null;
  paint(vd, lin(color));
  return mixUv(vd, slot);
};

function ballAt(c: V3, r: number, tess: number, rings: number, sy = 1): VertexData {
  return place(scaled(sphereVD(r, tess, rings), 1, sy, 1), { x: c[0], y: c[1], z: c[2] });
}

// ---------- music box ----------
function baseParts(rb: number, sx: number, h: number, rc: number): VertexData[] {
  const p: VertexData[] = [];
  const oval = (vd: VertexData): VertexData => scaled(vd, sx, 1, 1);
  // Plinth, drum and top cap.
  p.push(
    part(
      oval(
        lathe(
          [
            [0, 0],
            [rb, 0],
            [rb * 1.03, 0.04],
            [rb * 1.03, 0.15],
            [rb, 0.19],
            [rb * 0.95, 0.19],
          ],
          40,
        ),
      ),
      C.lacquerDark,
      MIX.plastic,
    ),
  );
  p.push(
    part(
      oval(
        lathe(
          [
            [rb * 0.95, 0.19],
            [rb * 0.94, 0.3],
            [rb * 0.94, h - 0.3],
            [rb * 0.95, h - 0.2],
          ],
          40,
        ),
      ),
      C.lacquer,
      MIX.plastic,
    ),
  );
  p.push(
    part(
      oval(
        lathe(
          [
            [rb * 0.99, h - 0.2],
            [rb * 1.0, h - 0.12],
            [rb * 0.96, h - 0.03],
            [rb * 0.88, h],
            [0, h],
          ],
          40,
        ),
      ),
      C.cream,
      MIX.plastic,
    ),
  );
  // Brass bands top and bottom of the drum.
  for (const y of [0.27, h - 0.27])
    p.push(
      part(
        oval(
          lathe(
            [
              [rb * 0.94, y - 0.04],
              [rb * 0.965, y - 0.025],
              [rb * 0.965, y + 0.025],
              [rb * 0.94, y + 0.04],
            ],
            40,
          ),
        ),
        C.gold,
        MIX.brass,
      ),
    );
  // A ring of cream studs round the drum.
  const studs = 18;
  for (let k = 0; k < studs; k++) {
    const a = (k / studs) * Math.PI * 2;
    const x = Math.cos(a) * rb * 0.945 * sx;
    const z = Math.sin(a) * rb * 0.945;
    const nx = Math.cos(a) * sx;
    const nz = Math.sin(a);
    p.push(
      part(
        place(
          lathe(
            [
              [0, 0],
              [0.07, 0],
              [0.065, 0.035],
              [0, 0.05],
            ],
            8,
          ),
          { x, y: h * 0.5, z, rx: Math.PI / 2, ry: Math.atan2(nx, nz) },
        ),
        C.cream,
        MIX.plastic,
      ),
    );
  }
  // Brass name plaque at the front.
  const plaque = roundedBox(1.0, 0.32, 0.06, 0.04, 2);
  p.push(part(place(plaque, { y: h * 0.5, z: rb * 0.95 + 0.02 }), C.gold, MIX.brass));
  // Brass wind-up key at the back: shaft and a two-lobed bow.
  p.push(
    part(
      place(
        lathe(
          [
            [0.07, 0],
            [0.07, 0.3],
            [0.11, 0.33],
            [0.11, 0.38],
            [0.06, 0.4],
          ],
          10,
        ),
        { rx: -Math.PI / 2, y: h * 0.5, z: -rb * 0.94 },
      ),
      C.gold,
      MIX.brass,
    ),
  );
  for (const s of [-1, 1])
    p.push(part(ballAt([s * 0.2, h * 0.5, -rb * 0.94 - 0.47], 0.2, 12, 6, 1), C.gold, MIX.brass));
  // Brass collar holding the glass.
  p.push(
    part(
      lathe(
        [
          [rc + 0.18, h],
          [rc + 0.16, h + 0.12],
          [rc + 0.08, h + 0.22],
          [rc + 0.02, h + 0.24],
          [rc - 0.02, h + 0.24],
          [rc - 0.05, h],
        ],
        40,
      ),
      C.gold,
      MIX.brass,
    ),
  );
  return p;
}

// Flattens the key's bow lobes (the two balls behind the shaft) into plates.
function flattenBow(vd: VertexData, zc: number, y: number): VertexData {
  const p = vd.positions as number[];
  for (let i = 0; i < p.length; i += 3)
    if (Math.abs(p[i + 2] - zc) < 0.21 && Math.abs(p[i + 1] - y) < 0.21 && Math.abs(p[i]) > 0.04)
      p[i + 2] = zc + (p[i + 2] - zc) * 0.3;
  return vd;
}

// ---------- inside the glass (globe space: origin at the base top centre) ----------
const SM = {
  b0: [0, 0.95, 0.1] as V3,
  r0: 0.62,
  b1: [0, 1.78, 0.12] as V3,
  r1: 0.46,
  head: [0, 2.42, 0.16] as V3,
  rh: 0.34,
};
const SHOULDER: V3 = [0.4, 1.95, 0.14];
const ARM_LEN = 0.78;

function interiorParts(rg: number, cy: number): VertexData[] {
  const p: VertexData[] = [];
  // Snowy mound filling the floor of the globe.
  const floorY = 0.3;
  const fr = Math.sqrt(Math.max(0.1, rg * rg - (cy - floorY) ** 2)) * 0.97;
  p.push(
    part(
      lathe(
        [
          [fr, floorY - 0.05],
          [fr * 0.96, floorY + 0.06],
          [fr * 0.7, floorY + 0.2],
          [fr * 0.35, floorY + 0.27],
          [0, floorY + 0.28],
        ],
        32,
      ),
      C.snow,
      MIX.plastic,
    ),
  );
  // Three little snowy pines round the back.
  for (const [a, s] of [
    [2.2, 1],
    [3.3, 0.8],
    [4.2, 0.9],
  ] as [number, number][]) {
    const x = Math.cos(a) * fr * 0.62;
    const z = Math.sin(a) * fr * 0.62;
    const y0 = floorY + 0.12;
    const trunk = lathe(
      [
        [0.06 * s, 0],
        [0.06 * s, 0.2 * s],
        [0, 0.2 * s],
      ],
      6,
    );
    p.push(part(place(trunk, { x, y: y0, z }), C.twig, MIX.paper));
    for (let k = 0; k < 3; k++) {
      const yb = y0 + (0.15 + k * 0.25) * s;
      const r = (0.38 - k * 0.1) * s;
      const tier = lathe(
        [
          [0, 0],
          [r, 0.02],
          [r * 0.9, 0.06],
          [0, 0.42 * s],
        ],
        8,
      );
      p.push(part(place(tier, { x, y: yb, z }), k === 2 ? C.pineLight : C.pine, MIX.plastic));
      const cap = lathe(
        [
          [r * 0.75, 0.05],
          [r * 0.55, 0.16 * s],
          [0, 0.24 * s],
        ],
        8,
      );
      p.push(part(place(cap, { x, y: yb + 0.08 * s, z }), C.snow, MIX.plastic));
    }
  }
  // The Giant: three balls of snow.
  p.push(part(ballAt(SM.b0, SM.r0, 20, 12, 0.92), C.snow, MIX.plastic));
  p.push(part(ballAt(SM.b1, SM.r1, 18, 10, 0.95), C.snow, MIX.plastic));
  p.push(part(ballAt(SM.head, SM.rh, 16, 10), C.snow, MIX.plastic));
  const onBall = (c: V3, r: number, el: number, az: number): V3 => [
    c[0] + r * Math.cos(el) * Math.sin(az),
    c[1] + r * Math.sin(el),
    c[2] + r * Math.cos(el) * Math.cos(az),
  ];
  // Coal eyes, smile and buttons; carrot nose.
  for (const s of [-1, 1])
    p.push(part(ballAt(onBall(SM.head, SM.rh * 0.95, 0.28, s * 0.36), 0.05, 8, 4), C.coal, MIX.rubber));
  for (let k = -2; k <= 2; k++)
    p.push(
      part(ballAt(onBall(SM.head, SM.rh * 0.96, -0.32 + Math.abs(k) * 0.07, k * 0.2), 0.03, 6, 3), C.coal, MIX.rubber),
    );
  for (const el of [0.5, 0.15, -0.2])
    p.push(part(ballAt(onBall(SM.b1, SM.r1 * 0.97, el, 0), 0.055, 8, 4), C.coal, MIX.rubber));
  p.push(
    part(
      tube(
        [
          { p: [SM.head[0], SM.head[1] - 0.01, SM.head[2] + SM.rh * 0.85], a: 0.08 },
          { p: [0.02, SM.head[1] - 0.04, SM.head[2] + SM.rh + 0.18], a: 0.05 },
          { p: [0.05, SM.head[1] - 0.07, SM.head[2] + SM.rh + 0.38], a: 0.008 },
        ],
        8,
        [1, 0, 0],
        0,
        0.3,
      ),
      C.carrot,
      MIX.plastic,
    ),
  );
  // Red tin bucket helmet with a gold rim and band, worn at an angle.
  const helm = { x: SM.head[0], y: SM.head[1] + 0.2, z: SM.head[2] - 0.03, rx: -0.15, rz: -0.12 };
  p.push(
    part(
      place(
        lathe(
          [
            [0.3, 0.0],
            [0.36, 0.02],
            [0.36, 0.06],
            [0.33, 0.07],
          ],
          24,
        ),
        helm,
      ),
      C.gold,
      MIX.brass,
    ),
  );
  p.push(
    part(
      place(
        lathe(
          [
            [0.33, 0.07],
            [0.3, 0.3],
            [0.27, 0.4],
            [0, 0.4],
          ],
          24,
        ),
        helm,
      ),
      C.red,
      MIX.plastic,
    ),
  );
  p.push(
    part(
      place(
        lathe(
          [
            [0.315, 0.19],
            [0.325, 0.2],
            [0.32, 0.25],
            [0.305, 0.26],
          ],
          24,
        ),
        helm,
      ),
      C.gold,
      MIX.brass,
    ),
  );
  // Knitted scarf and its tail.
  p.push(
    part(
      place(
        lathe(
          [
            [0.28, -0.07],
            [0.36, -0.04],
            [0.37, 0.03],
            [0.3, 0.08],
          ],
          20,
        ),
        { x: 0, y: 2.13, z: 0.14 },
      ),
      C.red,
      MIX.plastic,
    ),
  );
  p.push(
    part(
      tube(
        [
          { p: [-0.2, 2.12, 0.42], a: 0.1, b: 0.035 },
          { p: [-0.26, 1.92, 0.55], a: 0.1, b: 0.035 },
          { p: [-0.28, 1.68, 0.56], a: 0.11, b: 0.035 },
        ],
        6,
        [1, 0, 0],
        0.3,
        0.4,
      ),
      C.redDark,
      MIX.plastic,
    ),
  );
  // Left twig arm akimbo, hand on the hip.
  p.push(
    part(
      tube(
        [
          { p: [-0.4, 1.95, 0.12], a: 0.06 },
          { p: [-0.78, 1.62, 0.2], a: 0.05 },
          { p: [-0.52, 1.3, 0.34], a: 0.045 },
        ],
        6,
        [0, 0, 1],
        0.3,
        0.5,
      ),
      C.twig,
      MIX.paper,
    ),
  );
  return p;
}

// The throwing arm in shoulder space: hanging along -Y, a red mitten at the end.
function armParts(): VertexData[] {
  return [
    part(
      tube(
        [
          { p: [-0.03, 0.04, 0], a: 0.065 },
          { p: [0.05, -0.4, 0.02], a: 0.055 },
          { p: [0, -ARM_LEN + 0.08, 0], a: 0.05 },
        ],
        6,
        [0, 0, 1],
        0.4,
        0,
      ),
      C.twig,
      MIX.paper,
    ),
    part(ballAt([0, -ARM_LEN, 0.02], 0.12, 10, 6, 1.15), C.red, MIX.plastic),
    part(ballAt([0.1, -ARM_LEN + 0.06, 0.06], 0.055, 6, 4), C.red, MIX.plastic),
  ];
}

// ---------- the model ----------
const FLAKES = 80;
const FLAKE_R = 0.034;
const HAND_BALL_R = 0.2;

export function createSnowGlobeGiant(scene: Scene, look: Look, o: SnowGlobeOptions): SnowGlobeGiantModel {
  const rb = Math.min(2.2, o.depth * 0.5);
  const sx = Math.max(1, Math.min(1.35, (o.width * 0.45) / rb));
  const h = o.baseHeight;
  const rg = Math.min(1.95, rb * 0.95); // glass radius
  const cy = rg * 0.72; // glass centre above the base top
  const rc = Math.sqrt(rg * rg - cy * cy); // where the glass meets the collar

  const mix = mixedToyMaterial(scene, 'snowGlobeMix');
  const glass = glassMaterial(scene, '#e4f3fb', { name: 'snowGlobeGlass', alpha: 0.2, envIntensity: 1.4 });
  glass.backFaceCulling = true;

  const root = new TransformNode('snowGlobeGiant', scene);
  const baseParts0 = baseParts(rb, sx, h, rc);
  const baseVD = flattenBow(mergeParts(baseParts0), -rb * 0.94 - 0.47, h * 0.5);
  const base = buildMesh(scene, 'snowGlobeBase', baseVD, mix);
  base.parent = root;

  const globe = new TransformNode('snowGlobeGlobe', scene);
  globe.parent = root;
  globe.position.y = h;
  const interior = new TransformNode('snowGlobeInterior', scene);
  interior.parent = globe;
  const inside = buildMesh(scene, 'snowGlobeInside', mergeParts(interiorParts(rg, cy)), mix);
  inside.parent = interior;
  const arm = new TransformNode('snowGlobeArm', scene);
  arm.parent = interior;
  arm.position.set(SHOULDER[0], SHOULDER[1], SHOULDER[2]);
  arm.rotation.x = ARM_REST;
  const armMesh = buildMesh(scene, 'snowGlobeArmMesh', mergeParts(armParts()), mix);
  armMesh.parent = arm;

  const dome = sphereVD(rg, 36, 20);
  dome.uvs = null;
  const glassMesh = buildMesh(scene, 'snowGlobeGlass', place(dome, { y: cy }), glass);
  glassMesh.parent = globe;
  glassMesh.isPickable = false;

  // Snow: flakes swirling inside the glass, plus (instance 0) the snowball in his mitten.
  const flakeVD = part(sphereVD(1, 6, 4), C.snow, MIX.plastic);
  const snow = buildMesh(scene, 'snowGlobeSnow', flakeVD, mix);
  snow.parent = globe;
  snow.alwaysSelectAsActiveMesh = true;
  snow.doNotSyncBoundingInfo = true;
  const rand = mulberry32(0x5170b);
  const fA = new Float32Array(FLAKES); // angle round the axis
  const fR = new Float32Array(FLAKES); // share of the radius available at that height
  const fY = new Float32Array(FLAKES); // height (globe space)
  const fS = new Float32Array(FLAKES); // speed seed
  const yLo = 0.55;
  const yHi = cy + rg * 0.86;
  for (let i = 0; i < FLAKES; i++) {
    fA[i] = rand() * Math.PI * 2;
    fR[i] = 0.25 + rand() * 0.7;
    fY[i] = yLo + rand() * (yHi - yLo);
    fS[i] = 0.6 + rand() * 0.8;
  }
  const matrices = new Float32Array((FLAKES + 1) * 16);
  snow.thinInstanceSetBuffer('matrix', matrices, 16, false);
  snow.thinInstanceCount = FLAKES + 1;

  const blob = createBlobShadowMesh(scene, 'snowGlobeBlob', 0.45);
  blob.parent = root;
  blob.scaling.set(rb * sx * 2.3, 1, rb * 2.3);

  const casters: Mesh[] = [base, inside, armMesh];
  for (const m of casters) look.addShadowCaster(m, 'static');
  look.receiveShadows(base);
  look.receiveShadows(inside);

  const flashCol = new Color3(1, 0.94, 0.82);
  const glassBase = { albedo: lin('#e4f3fb'), frost: lin('#f3f8fb') };
  let frostK = 0;
  let flashK = 0;
  const applyGlass = (): void => {
    const g = glass as PBRMaterial;
    Color3.LerpToRef(glassBase.albedo, glassBase.frost, frostK, g.albedoColor);
    g.alpha = 0.2 + 0.45 * frostK;
    g.roughness = 0.04 + 0.3 * frostK;
    g.emissiveColor.set(0.16 * frostK, 0.2 * frostK, 0.24 * frostK).addInPlace(flashCol.scale(flashK * 0.3));
  };
  applyGlass();

  let time = 0;
  return {
    root,
    globe,
    interior,
    arm,
    hpBarAnchor: new Vector3(0, h + 0.15, rb + 0.1),
    setFlash(k: number): void {
      flashK = Math.max(0, Math.min(1, k));
      mix.emissiveColor.copyFrom(flashCol).scaleInPlace(flashK * 0.9);
      applyGlass();
    },
    setPop(s: number): void {
      interior.scaling.setAll(s);
    },
    setFrost(k: number): void {
      frostK = Math.max(0, Math.min(1, k));
      applyGlass();
    },
    setSnow(dt: number, swirl: number, ball: boolean): void {
      time += dt;
      const sw = Math.max(0, Math.min(1, swirl));
      const spin = 0.35 + 2.6 * sw;
      const fall = 0.22 * (1 - sw) - 0.5 * sw; // shaken snow lifts
      for (let i = 0; i < FLAKES; i++) {
        fA[i] += spin * fS[i] * dt;
        fY[i] -= fall * fS[i] * dt;
        if (fY[i] < yLo) fY[i] += yHi - yLo;
        else if (fY[i] > yHi) fY[i] -= yHi - yLo;
        const dy = fY[i] - cy;
        const room = Math.sqrt(Math.max(0, rg * rg * 0.8 - dy * dy));
        const r = room * fR[i] + Math.sin(time * 1.3 + i) * 0.05;
        const s = FLAKE_R * (0.7 + 0.6 * fS[i]);
        writeTRS(matrices, (i + 1) * 16, Math.cos(fA[i]) * r, fY[i], Math.sin(fA[i]) * r, s, s, s, 0, 0, 0);
      }
      // The snowball in his mitten: shoulder + the arm's swing, then the turntable and pop.
      const a = arm.rotation.x;
      const L = ARM_LEN + 0.06;
      const ps = interior.scaling.x;
      const lx = SHOULDER[0];
      const ly = SHOULDER[1] - L * Math.cos(a);
      const lz = SHOULDER[2] - L * Math.sin(a);
      const yaw = interior.rotation.y;
      const c = Math.cos(yaw);
      const sn = Math.sin(yaw);
      const bs = ball ? HAND_BALL_R * ps : 0;
      writeTRS(matrices, 0, (lx * c + lz * sn) * ps, ly * ps, (-lx * sn + lz * c) * ps, bs, bs, bs, 0, 0, 0);
      snow.thinInstanceBufferUpdated('matrix');
    },
    dispose(): void {
      for (const m of casters) look.removeShadowCaster(m);
      root.dispose(false, false);
      mix.dispose(true, true);
      glass.dispose(true, true);
    },
  };
}

// ---------- preview ----------
// The boss as it stands on 2-10 (width 6, depth 4): 'calm' lobs a snowball every 2 s,
// 'frost' shows the frosted glass, 'shake' rocks the globe on its base.
export function preview(scene: Scene, look: Look, opts: PreviewOptions): PreviewResult {
  const m = createSnowGlobeGiant(scene, look, { width: 6, depth: 4, baseHeight: 1.05 });
  const holder = new TransformNode('snowGlobePreviewRoot', scene);
  m.root.parent = holder;
  const v = opts.variant ?? 'calm';
  m.setFrost(v === 'frost' ? 1 : 0);
  let last = 0;
  return {
    root: holder,
    update(time: number): void {
      const dt = Math.min(0.1, Math.max(0, time - last));
      last = time;
      const t = time % 2;
      // Over-arm lob: wind back, throw over the top, ease back to rest.
      const rx =
        t < 0.15
          ? ARM_REST + (2.4 - ARM_REST) * (t / 0.15)
          : t < 0.35
            ? 2.4 - 4 * ((t - 0.15) / 0.2)
            : t < 0.9
              ? -1.6 + (ARM_REST + 1.6) * ((t - 0.35) / 0.55)
              : ARM_REST;
      m.arm.rotation.x = rx;
      m.interior.rotation.y = Math.sin(time * 0.6) * 0.25;
      const shake = v === 'shake' ? 1 : 0;
      m.globe.rotation.z = shake * Math.sin(time * 9) * 0.07;
      m.globe.rotation.x = shake * Math.sin(time * 7.3) * 0.04;
      m.setSnow(dt, shake, t < 0.3 || t > 0.9);
    },
    dispose(): void {
      m.dispose();
      holder.dispose();
    },
  };
}
