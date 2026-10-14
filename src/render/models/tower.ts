// Tower defender: two big toy alphabet blocks stacked on the lane (the top one twisted
// ~0.3 rad), with a tan army man on top aiming a chunky toy dart blaster, an orange foam
// dart loaded. Enemy side: authored facing +Z, integration turns the tower root by PI so
// the lettered front faces the camera.
//
// Blocks: the WALL's toy-block recipe, imported from ./wall.ts (blockVertexData +
// toyBlockMaterial + BLOCK_FACES: rounded cube, edge radius 8% of the side, atlas faces
// with a raised frame and an embossed tan-dark glyph, plastic + clearcoat), so towers and
// walls are the same blocks. Tan HEX.tan and cream HEX.tanLight alternate per tower: one
// cream-faced source, tan blocks tinted through their instance colour.
// Figure: procedural tan army man (vertex-coloured, AO baked) with a toy-blue blaster.
//
// Draw calls: the kit holds three hidden source meshes (block on the shared wall material;
// figure + blaster and foam dart on one white vertex-coloured plastic); every tower is
// InstancedMesh copies (mesh.createInstance) with a per-instance 'instanceColor' buffer
// (block tint, hit flash), so ANY number of towers costs 3 draw calls (+3 in the shadow
// pass). Triangles per tower: 2 x 300 (blocks) + 1,373 (figure) + 72 (dart) = 2,045.
//
// GAME API
//   createTowerKit(scene, look): TowerKit             build once per scene (sync; ~30-80 ms AO bake + the wall's atlas)
//   TowerKit.create(width = 1.6): TowerModel           one tower; width = footprint (DEFENDER_DEFAULTS.towerWidth)
//   TowerKit.dispose()                                 disposes the sources and every tower
//   TowerModel.root: TransformNode                     position at (x, 0, z), rotation.y = PI (enemy side);
//                                                      do not set root.scaling (setHit owns it)
//   TowerModel.muzzle: Vector3                         dart spawn point in ROOT-LOCAL space (updated by
//                                                      setAim / setFiring); world point =
//                                                      Vector3.TransformCoordinates(muzzle, root.getWorldMatrix())
//                                                      (~2.6 above the floor for width 1.6, matches DART_FROM_Y)
//   TowerModel.muzzleHeight: number                    muzzle y for this width (constant)
//   TowerModel.setAim(yaw)                             turns the shooter: yaw in ROOT-LOCAL space, 0 = +Z (the
//                                                      tower's front). For a world target (tx, tz) and a root
//                                                      at (x, z) with rotation.y = r: yaw = atan2(tx - x, tz - z) - r
//   TowerModel.setHit(k)                               0..1 hit flash (instance colours toward white) and scale
//                                                      pop (+14% at k = 1); drive k from a decaying hit timer
//   TowerModel.setFiring(k)                            0..1 blaster recoil (figure kicks back and pitches up);
//                                                      the loaded dart is hidden while k > 0.35 (it is in flight,
//                                                      drawn by effects) and reappears as k falls ("reloaded")
//   TowerModel.dispose()
// Shadows: every instance is registered with look.addShadowCaster ('static'); the sources
// receive shadows. Nothing here moves a camera.
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import '@babylonjs/core/Meshes/instancedMesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { CreateBoxVertexData } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import type { Look } from '../look/index.ts';
import {
  HEX,
  bakeVertexAO,
  buildMesh,
  fixWinding,
  lathe,
  lin,
  mergeParts,
  paint,
  place,
  plasticMaterial,
  roundedBox,
} from '../look/index.ts';
import { BLOCK_FACES, blockVertexData, toyBlockMaterial } from './wall.ts';
import type { ModelInfo, PreviewOptions, PreviewResult } from '../look/model.ts';

export const info: ModelInfo = {
  key: 'tower',
  title: 'Tower defender: alphabet-block tower with a dart shooter',
  instanced: true,
  teams: false,
  side: 'enemy',
  height: 2.75,
  triangleBudget: 2500,
  gameZ: 40,
  variants: ['idle', 'states'], // 'states': frozen hit flash (left), recoil (middle), rest (right)
};

export const TOWER_BLOCK = 0.66; // bottom block edge as a fraction of the footprint width
export const TOWER_TOP_BLOCK = 0.9; // top block edge relative to the bottom one
export const TOWER_TWIST = 0.3; // top block twist (rad)
export const TOWER_POP = 0.14; // scale pop at setHit(1)
const FLASH = [2.1, 2.5, 3.6] as const; // hit-flash instance colour at setHit(1)
export const FIGURE_SCALE = 2.2; // the shooter is scaled up so he reads on top of the stack at game distance

export interface TowerModel {
  root: TransformNode;
  muzzle: Vector3;
  muzzleHeight: number;
  setAim(yaw: number): void;
  setHit(k: number): void;
  setFiring(k: number): void;
  dispose(): void;
}

export interface TowerKit {
  create(width?: number): TowerModel;
  dispose(): void;
  readonly trianglesPerTower: number;
  readonly meshes: readonly Mesh[]; // the hidden instance sources (block, figure, dart)
}

// ---------- small geometry helpers ----------
type V3 = readonly [number, number, number];

// Matrix taking local +Y to the direction a->b, translated to a.
function alongMatrix(a: V3, b: V3): { m: Matrix; len: number } {
  const d = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = d.length();
  d.scaleInPlace(1 / len);
  const up = Vector3.Up();
  const axis = Vector3.Cross(up, d);
  const dot = Vector3.Dot(up, d);
  let q: Quaternion;
  if (axis.lengthSquared() < 1e-10)
    q = dot > 0 ? Quaternion.Identity() : Quaternion.RotationAxis(Vector3.Right(), Math.PI);
  else q = Quaternion.RotationAxis(axis.normalize(), Math.acos(Math.max(-1, Math.min(1, dot))));
  return { m: Matrix.Compose(Vector3.One(), q, new Vector3(a[0], a[1], a[2])), len };
}

// A rounded limb (capsule-ish lathe) from a to b.
function limb(a: V3, b: V3, r0: number, r1 = r0, tess = 7): VertexData {
  const { m, len } = alongMatrix(a, b);
  const e0 = Math.min(r0 * 0.8, len * 0.3);
  const e1 = Math.min(r1 * 0.8, len * 0.3);
  const vd = lathe(
    [
      [0, -e0 * 0.5],
      [r0, 0.0],
      [r1, len],
      [0, len + e1 * 0.5],
    ],
    tess,
  );
  vd.transform(m);
  return vd;
}

// ---------- the alphabet block ----------
// The wall's shared toy-block recipe (src/render/models/wall.ts): rounded cube with edge
// radius 8% of the side, atlas faces (raised frame, embossed tan-dark glyph) on the shared
// 'toy-block-atlas' plastic material. One source with the cream faces; tan blocks are the
// same instances tinted by their instance colour (lin(tan) / lin(tanLight)), so both
// colours cost one draw call. Faces (+X, -X, +Y, -Y, +Z, -Z): D, F, heart, 2, B, H.
function blockGeometry(): VertexData {
  const vd = blockVertexData(1, BLOCK_FACES.cream);
  place(vd, { y: 0.5 });
  return vd;
}

// ---------- the army man with his dart blaster ----------
// About 0.73 tall on a thin oval base, feet at y = 0, aiming along +Z. Vertex colours:
// tan plastic for the figure (a shade darker on helmet and boots), toy blue blaster with
// an orange muzzle ring. Returns geometry and the muzzle (the loaded dart's tip).
export const FIGURE = {
  blasterY: 0.53, // blaster bore height above the figure's feet
  blasterX: 0.045,
  dartBackZ: 0.3, // dart sits in the barrel from here ...
  dartTipZ: 0.47, // ... to its tip (the muzzle point)
  dartR: 0.032,
} as const;

function figureGeometry(): VertexData {
  const tan = Color3.Lerp(lin(HEX.tan), lin(HEX.tanLight), 0.3); // small parts shade dark: start a touch lighter
  const tanD = lin(HEX.tanDark);
  const body: [number, number, number] = [tan.r, tan.g, tan.b];
  const shade: [number, number, number] = [tan.r * 0.93, tan.g * 0.92, tan.b * 0.9];
  const dark: [number, number, number] = [
    Color3.Lerp(tan, tanD, 0.3).r,
    Color3.Lerp(tan, tanD, 0.3).g,
    Color3.Lerp(tan, tanD, 0.3).b,
  ];
  // Gunmetal toy rifle-blaster (the bright blue blob read as a prop, not a soldier's gun).
  const gun = lin('#4b4540');
  const blaster: [number, number, number] = [gun.r, gun.g, gun.b];
  const helmet: [number, number, number] = [
    Color3.Lerp(tan, tanD, 0.55).r,
    Color3.Lerp(tan, tanD, 0.55).g,
    Color3.Lerp(tan, tanD, 0.55).b,
  ];
  const orange = lin(HEX.toyOrange);
  const accent: [number, number, number] = [orange.r, orange.g, orange.b];
  const grey: [number, number, number] = [0.05, 0.055, 0.06];
  const parts: VertexData[] = [];
  const add = (vd: VertexData, c: readonly [number, number, number]): void => {
    paint(vd, c);
    parts.push(vd);
  };
  // Base plate (oval, thin, bevelled).
  add(
    place(
      lathe(
        [
          [0, 0],
          [0.16, 0],
          [0.155, 0.03],
          [0, 0.03],
        ],
        10,
      ),
      { sx: 1, sz: 1.15 },
    ),
    shade,
  );
  // Stance: left foot forward, right foot back, knees slightly bent.
  const hipY = 0.32;
  add(limb([-0.055, hipY, 0.0], [-0.07, 0.17, 0.07], 0.045, 0.04), body); // left thigh
  add(limb([-0.07, 0.17, 0.07], [-0.07, 0.05, 0.06], 0.04, 0.038), body); // left shin
  add(limb([0.055, hipY, -0.01], [0.075, 0.17, -0.06], 0.045, 0.04), body); // right thigh
  add(limb([0.075, 0.17, -0.06], [0.08, 0.05, -0.09], 0.04, 0.038), body); // right shin
  add(place(roundedBox(0.085, 0.05, 0.13, 0.018, 1), { x: -0.07, y: 0.055, z: 0.085 }), dark); // left boot
  add(place(roundedBox(0.085, 0.05, 0.13, 0.018, 1), { x: 0.08, y: 0.055, z: -0.075, ry: 0.25 }), dark); // right boot
  // Hips, torso (leaning into the aim), pack.
  add(place(roundedBox(0.19, 0.07, 0.12, 0.025, 1), { y: hipY + 0.01, z: -0.005 }), dark); // belt
  add(place(roundedBox(0.2, 0.21, 0.13, 0.05, 2), { y: hipY + 0.13, z: 0.012, rx: 0.14 }), body); // torso
  add(place(roundedBox(0.14, 0.13, 0.065, 0.022, 1), { y: hipY + 0.15, z: -0.085, rx: 0.14 }), shade); // pack
  // Head, cheek down on the stock, helmet with a brim.
  const headY = 0.6;
  add(
    place(
      lathe(
        [
          [0, -0.06],
          [0.04, -0.052],
          [0.058, -0.02],
          [0.058, 0.02],
          [0.04, 0.05],
          [0, 0.06],
        ],
        7,
      ),
      { x: 0.02, y: headY, z: 0.04 },
    ),
    body,
  );
  // M1 helmet, oversized with a wide flat brim and moulded a shade darker, so the army
  // man silhouette reads at game distance.
  add(
    place(
      lathe(
        [
          [0.122, -0.012],
          [0.128, -0.004],
          [0.104, 0.012],
          [0.096, 0.06],
          [0.07, 0.108],
          [0, 0.124],
        ],
        12,
      ),
      {
        x: 0.02,
        y: headY + 0.0,
        z: 0.035,
        rx: 0.12,
      },
    ),
    helmet,
  );
  // Arms: right hand on the pistol grip, left hand forward on the foregrip.
  const by = FIGURE.blasterY;
  const bx = FIGURE.blasterX;
  add(limb([0.105, 0.53, 0.0], [0.13, 0.44, 0.07], 0.038, 0.034), body); // right upper arm
  add(limb([0.13, 0.44, 0.07], [bx + 0.01, by - 0.08, 0.12], 0.034, 0.03), body); // right forearm
  add(limb([-0.105, 0.53, 0.02], [-0.09, 0.47, 0.15], 0.038, 0.034), body); // left upper arm
  add(limb([-0.09, 0.47, 0.15], [bx - 0.01, by - 0.055, 0.25], 0.034, 0.03), body); // left forearm
  // The blaster: chunky body, top rail, barrel shroud with an orange ring, grip, stock.
  add(place(roundedBox(0.085, 0.1, 0.26, 0.028, 1), { x: bx, y: by + 0.005, z: 0.13 }), blaster);
  add(
    place(CreateBoxVertexData({ width: 0.04, height: 0.035, depth: 0.16 }), { x: bx, y: by + 0.07, z: 0.12 }),
    accent,
  ); // top rail
  add(
    place(
      lathe(
        [
          [0.0, 0],
          [0.047, 0],
          [0.047, 0.07],
          [0.052, 0.1],
          [0.0, 0.1],
        ],
        8,
      ),
      { x: bx, y: by, z: 0.24, rx: Math.PI / 2 },
    ),
    blaster,
  );
  add(
    place(
      lathe(
        [
          [0.052, 0],
          [0.057, 0.0],
          [0.057, 0.025],
          [0.052, 0.025],
        ],
        8,
      ),
      { x: bx, y: by, z: 0.325, rx: Math.PI / 2 },
    ),
    accent,
  ); // muzzle ring
  add(
    place(CreateBoxVertexData({ width: 0.05, height: 0.1, depth: 0.05 }), { x: bx, y: by - 0.08, z: 0.08, rx: 0.3 }),
    grey,
  ); // grip
  add(
    place(CreateBoxVertexData({ width: 0.055, height: 0.08, depth: 0.1 }), { x: bx, y: by - 0.01, z: -0.02 }),
    blaster,
  ); // stock
  // Tan-army crenellated cap he stands in (ring wall + merlons) and a tan pennant at the
  // back: the tower reads as an enemy outpost, not a stack of alphabet blocks.
  const capR = 0.27;
  add(
    lathe(
      [
        [capR - 0.035, 0],
        [capR + 0.03, 0],
        [capR + 0.03, 0.07],
        [capR - 0.035, 0.07],
      ],
      16,
    ),
    dark,
  );
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    add(
      place(roundedBox(0.075, 0.07, 0.06, 0.012, 1), { x: Math.sin(a) * capR, y: 0.1, z: Math.cos(a) * capR, ry: a }),
      shade,
    );
  }
  add(limb([-0.17, 0.02, -0.2], [-0.17, 0.95, -0.2], 0.012, 0.01), dark); // pennant pole
  add(place(roundedBox(0.008, 0.16, 0.26, 0.004, 1), { x: -0.17, y: 0.84, z: -0.33 }), dark); // pennant
  add(place(roundedBox(0.012, 0.07, 0.07, 0.004, 1), { x: -0.17, y: 0.84, z: -0.33, rx: Math.PI / 4 }), body); // emblem diamond
  const vd = mergeParts(parts);
  fixWinding(vd);
  return bakeVertexAO(vd, { samples: 14, maxDist: 0.12, strength: 0.35 });
}

// The orange foam dart, loaded in the barrel (separate so it can vanish when fired).
function dartGeometry(): VertexData {
  const r = FIGURE.dartR;
  const L = FIGURE.dartTipZ - FIGURE.dartBackZ;
  const vd = lathe(
    [
      [0, 0],
      [r * 0.9, 0],
      [r, 0.01],
      [r, L - 0.035],
      [r * 1.12, L - 0.03],
      [r * 1.12, L - 0.012],
      [r * 0.7, L],
      [0, L + 0.004],
    ],
    6,
  );
  // Foam body orange, rounded tip a deeper orange-red.
  const c = new Float32Array((vd.positions!.length / 3) * 4);
  const o = lin(HEX.toyOrange);
  const t = lin(HEX.toyRed);
  for (let i = 0; i < c.length / 4; i++) {
    const y = vd.positions![i * 3 + 1];
    const k = y > L - 0.032 ? 1 : 0;
    c[i * 4] = o.r + (t.r - o.r) * k;
    c[i * 4 + 1] = o.g + (t.g - o.g) * k;
    c[i * 4 + 2] = o.b + (t.b - o.b) * k;
    c[i * 4 + 3] = 1;
  }
  vd.colors = c;
  place(vd, { x: FIGURE.blasterX, y: FIGURE.blasterY, z: FIGURE.dartBackZ, rx: Math.PI / 2 });
  return vd;
}

// ---------- the kit ----------
function triCount(m: Mesh): number {
  return (m.getTotalIndices() || 0) / 3;
}

const SCRATCH = { q: new Quaternion(), a: new Matrix(), b: new Matrix(), m: new Matrix(), one: new Vector3(1, 1, 1) };

export function createTowerKit(scene: Scene, look: Look): TowerKit {
  // One white plastic material; colours come from vertex colours x instance colours.
  const mat = look.material('tower-plastic', () =>
    plasticMaterial(scene, null, { instanceColor: true, roughness: 0.4, clearcoat: 0.3, name: 'towerPlastic' }),
  );
  const sources: Mesh[] = [
    buildMesh(scene, 'towerBlock', blockGeometry(), toyBlockMaterial(scene, look)),
    buildMesh(scene, 'towerFigure', figureGeometry(), mat),
    buildMesh(scene, 'towerDart', dartGeometry(), mat),
  ];
  for (const m of sources) {
    m.registerInstancedBuffer(VertexBuffer.ColorInstanceKind, 4);
    m.instancedBuffers[VertexBuffer.ColorInstanceKind] = new Color4(1, 1, 1, 1);
    m.isVisible = false; // only instances draw
    look.receiveShadows(m);
  }
  const [blockSrc, figureSrc, dartSrc] = sources;
  const trianglesPerTower = triCount(blockSrc) * 2 + triCount(figureSrc) + triCount(dartSrc);
  const towers = new Set<TowerModel>();
  const lt = lin(HEX.tanLight);
  const lt2 = lin(HEX.tan);
  const tan = new Color3(lt2.r / lt.r, lt2.g / lt.g, lt2.b / lt.b); // tint: cream atlas -> tan body
  const cream = new Color3(1, 1, 1);
  let serial = 0;

  function create(width = 1.6): TowerModel {
    const id = serial++;
    const root = new TransformNode(`tower${id}`, scene);
    const b0 = Math.max(0.5, width * TOWER_BLOCK);
    const b1 = b0 * TOWER_TOP_BLOCK;
    const top = b0 + b1;
    const figScale = FIGURE_SCALE * Math.min(1.12, Math.max(0.92, width / 1.6));
    // Vary which letters face the front, and which block is tan.
    const quarter = Math.PI / 2;
    const yaw0 = (id % 4) * quarter + (id % 2 ? 0.06 : -0.05);
    const yaw1 = ((id + 1) % 4) * quarter + (id % 2 ? -TOWER_TWIST : TOWER_TWIST);
    const colors: Color3[] = id % 2 ? [cream, tan] : [tan, cream];
    const inst: InstancedMesh[] = [];
    const baseColors: Color3[] = [];
    const mk = (src: Mesh, name: string, parent: TransformNode, c: Color3): InstancedMesh => {
      const m = src.createInstance(`${name}${id}`);
      m.parent = parent;
      m.isPickable = false;
      m.instancedBuffers[VertexBuffer.ColorInstanceKind] = new Color4(c.r, c.g, c.b, 1);
      look.addShadowCaster(m);
      inst.push(m);
      baseColors.push(c);
      return m;
    };
    const white = new Color3(1, 1, 1);
    const blk0 = mk(blockSrc, 'towerBlockA', root, colors[0]);
    blk0.scaling.setAll(b0);
    blk0.rotation.y = yaw0;
    const blk1 = mk(blockSrc, 'towerBlockB', root, colors[1]);
    blk1.scaling.setAll(b1);
    blk1.position.y = b0;
    blk1.rotation.y = yaw1;
    const shooter = new TransformNode(`towerShooter${id}`, scene);
    shooter.parent = root;
    shooter.position.y = top;
    const recoil = new TransformNode(`towerRecoil${id}`, scene);
    recoil.parent = shooter;
    recoil.scaling.setAll(figScale);
    mk(figureSrc, 'towerFigure', recoil, white);
    const dart = mk(dartSrc, 'towerDart', recoil, white);

    let aim = 0;
    const muzzle = new Vector3();
    const muzzleHeight = top + FIGURE.blasterY * figScale;
    const tip = new Vector3(FIGURE.blasterX, FIGURE.blasterY, FIGURE.dartTipZ);
    const figScaleV = new Vector3(figScale, figScale, figScale);
    const updateMuzzle = (): void => {
      // Figure space -> root space through the recoil and shooter transforms (scratch
      // objects only: setAim / setFiring run every frame).
      Quaternion.RotationYawPitchRollToRef(0, recoil.rotation.x, 0, SCRATCH.q);
      Matrix.ComposeToRef(figScaleV, SCRATCH.q, recoil.position, SCRATCH.a);
      Quaternion.RotationYawPitchRollToRef(aim, 0, 0, SCRATCH.q);
      Matrix.ComposeToRef(SCRATCH.one, SCRATCH.q, shooter.position, SCRATCH.b);
      SCRATCH.a.multiplyToRef(SCRATCH.b, SCRATCH.m);
      Vector3.TransformCoordinatesToRef(tip, SCRATCH.m, muzzle);
    };
    updateMuzzle();

    const model: TowerModel = {
      root,
      muzzle,
      muzzleHeight,
      setAim(yaw: number) {
        aim = yaw;
        shooter.rotation.y = yaw;
        updateMuzzle();
      },
      setHit(k: number) {
        const h = Math.max(0, Math.min(1, k));
        root.scaling.setAll(1 + TOWER_POP * h);
        // Instance colours multiply a tan albedo, so overshoot (more in blue) to wash it
        // toward a bright, near-white flash.
        const f = h * 0.8;
        for (let i = 0; i < inst.length; i++) {
          const c = baseColors[i];
          const col = inst[i].instancedBuffers[VertexBuffer.ColorInstanceKind] as Color4;
          col.r = c.r + (FLASH[0] - c.r) * f;
          col.g = c.g + (FLASH[1] - c.g) * f;
          col.b = c.b + (FLASH[2] - c.b) * f;
        }
      },
      setFiring(k: number) {
        const fire = Math.max(0, Math.min(1, k));
        // Figure-space pivot at the feet: kick back along -Z and tip the muzzle up.
        recoil.position.z = -fire * 0.07 * figScale;
        recoil.rotation.x = -fire * 0.12;
        dart.isVisible = fire < 0.35;
        updateMuzzle();
      },
      dispose() {
        towers.delete(model);
        root.dispose();
      },
    };
    towers.add(model);
    return model;
  }

  return {
    create,
    trianglesPerTower,
    meshes: sources,
    dispose() {
      for (const t of Array.from(towers)) t.dispose();
      for (const m of sources) m.dispose();
    },
  };
}

// ---------- preview ----------
export function preview(scene: Scene, look: Look, opts: PreviewOptions): PreviewResult {
  const root = new TransformNode('towerPreview', scene);
  const kit = createTowerKit(scene, look);
  // The hidden sources hang under the root too (the harness counts their triangles once).
  for (const m of kit.meshes) m.parent = root;
  const widths = [1.4, 1.6, 2.0];
  const xs = [-2.9, 0, 3.0];
  const zs = [0.6, -0.4, 0.5];
  const aims = [0.55, 0, -0.5];
  const towers = widths.map((w, i) => {
    const t = kit.create(w);
    t.root.parent = root;
    t.root.position.set(xs[i], 0, zs[i]);
    t.setAim(aims[i]);
    return t;
  });
  if (opts.variant === 'states') {
    towers[0].setHit(1); // +X side (left on screen in front/game views)
    towers[1].setFiring(1);
    return {
      root,
      dispose() {
        kit.dispose();
        root.dispose();
      },
    };
  }
  return {
    root,
    update(time: number) {
      towers.forEach((t, i) => {
        // Fire every 1.1 s, staggered: a sharp kick then an eased return.
        const ph = (time * 0.9 + i * 0.33) % 1;
        t.setFiring(ph < 0.08 ? ph / 0.08 : Math.max(0, 1 - (ph - 0.08) / 0.3));
        t.setAim(aims[i] + Math.sin(time * 0.7 + i) * 0.25);
        // An occasional hit on one tower.
        const hp = (time * 0.5 + i * 0.4) % 2.4;
        t.setHit(hp < 0.25 ? 1 - hp / 0.25 : 0);
      });
    },
    dispose() {
      kit.dispose();
      root.dispose();
    },
  };
}
