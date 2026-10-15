// Cannon variants (Milestone 4 loadout): two more toy guns on the popgun's carriage and
// wheels (models/cannon.ts), same green plastic, brass and varnished wood.
//
//   repeater    - a toy gatling: a squat breech housing with a magazine hopper (brass cap)
//                 and a side crank with a red knob, and a cluster of six barrels between
//                 three plates that spins inside a fixed brass guide collar.
//   blunderbuss - a short fat barrel that flares into a wide trumpet mouth with a rolled
//                 brass lip, brass breech ring and bands, and a dark moulded bore.
//
// GAME API (the popgun's CannonModel, so cannon.ts swaps them freely)
//   createCannonVariant(scene, look, 'repeater' | 'blunderbuss'): CannonVariantModel
//     root (place/slide it), barrel (recoil node, axis +Z), muzzle (root-local muzzle tip
//     at rest), setRecoil(0..1), setWheelSpin(rad), dispose(), plus
//     setSpin(rad): the repeater's barrel cluster angle (a no-op on the blunderbuss).
//   Pivot: axle centre on the floor, barrel along +Z, side 'player' (yaw 0). Size like
//   the popgun (~1.5 x 2.0 x 1.1). Draw calls: 4 meshes (carriage + housing plastic, the
//   barrel or spinning cluster in plastic, brass, wood wheels) plus a faint blob. Every
//   mesh is a static shadow caster like the popgun's; materials are the popgun's shared
//   look.material entries. The new parts' AO is baked once per page (~50 ms).
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Look } from '../look/index.ts';
import {
  bakeVertexAO,
  brassMaterial,
  buildMesh,
  createBlobShadowMesh,
  lathe,
  mergeParts,
  paint,
  place,
  plasticMaterial,
  roundedBox,
  woodMaterial,
} from '../look/index.ts';
import type { ModelInfo, PreviewOptions, PreviewResult } from '../look/model.ts';
import type { CannonModel } from './cannon.ts';
import {
  AXLE_Y,
  BARREL_PITCH,
  BARREL_Y,
  BARREL_Z,
  CHEEK_X,
  RECOIL_TIP,
  TRAIL_END_Z,
  WHEEL_RADIUS,
  buildCannonGeometry,
  clone,
  colors,
  rodX,
  star,
} from './cannon.ts';

export type CannonVariant = 'repeater' | 'blunderbuss';

export const info: ModelInfo = {
  key: 'cannonVariants',
  title: 'Cannon variants: repeater, blunderbuss',
  instanced: false,
  teams: false,
  side: 'player',
  height: 1.1,
  triangleBudget: 6000,
  gameZ: 1.5,
  variants: ['repeater', 'blunderbuss'],
};

export interface CannonVariantModel extends CannonModel {
  setSpin(rad: number): void;
}

const SPEC: Record<CannonVariant, { muzzle: number; recoil: number }> = {
  repeater: { muzzle: 0.98, recoil: 0.06 }, // a gatling barely kicks: it buzzes
  blunderbuss: { muzzle: 1.05, recoil: 0.28 },
};

// Lathe around +Y turned onto +Z (barrel axis).
const alongZ = (vd: VertexData, z = 0): VertexData => place(vd, { rx: Math.PI / 2, z });

interface Parts {
  fixed: VertexData; // plastic, barrel space, does not spin (housing, hopper, crank)
  moving: VertexData; // plastic, cluster space (repeater) or the barrel (blunderbuss)
  brass: VertexData; // barrel space
}

function repeaterParts(): Parts {
  const c = colors();
  const fixed: VertexData[] = [];
  const box = (w: number, h: number, d: number, r: number, t: Parameters<typeof place>[1], col = c.green) => {
    const vd = roundedBox(w, h, d, r, 2);
    vd.uvs = null;
    fixed.push(paint(place(vd, t), col));
  };
  // Breech housing on the trunnions, the hopper on top, a crank on the right.
  box(0.44, 0.36, 0.5, 0.08, { z: -0.16 }, c.greenDark);
  box(0.24, 0.3, 0.26, 0.05, { y: 0.3, z: -0.12, rx: -0.12 });
  fixed.push(paint(rodX(-CHEEK_X, CHEEK_X, 0, 0, 0.055, 8), c.greenDark));
  fixed.push(paint(rodX(0.2, 0.34, 0, -0.26, 0.03, 8), c.greenDark));
  box(0.04, 0.24, 0.06, 0.018, { x: 0.35, y: -0.09, z: -0.26 }, c.greenDark);
  fixed.push(
    paint(
      place(
        lathe(
          [
            [0, 0],
            [0.026, 0.005],
            [0.032, 0.03],
            [0.026, 0.07],
            [0, 0.078],
          ],
          10,
        ),
        { rz: -Math.PI / 2, x: 0.37, y: -0.2, z: -0.26 },
      ),
      c.red,
    ),
  );
  // A cream star on the hopper's back (the camera sees it).
  fixed.push(paint(place(star(0.07, 0.03, 0.01), { rx: -Math.PI / 2 - 0.12, y: 0.3, z: -0.255 }), c.cream));
  // Barrel cluster: six barrels round an axle, held by three plates.
  const moving: VertexData[] = [];
  const RING = 0.125;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const tubeVD = lathe(
      [
        [0.05, 0.06],
        [0.05, 0.92],
        [0.06, 0.93],
        [0.06, 0.98],
        [0.032, 0.985],
        [0, 0.94],
      ],
      8,
    );
    const shades = [c.greenDark, c.greenDark, c.greenDark, c.greenDark, c.bore, c.bore];
    const col = new Float32Array(((tubeVD.positions as number[]).length / 3) * 4);
    for (let v = 0; v < col.length / 4; v++) {
      const s = shades[v % shades.length];
      const rgb = 'r' in s ? [s.r, s.g, s.b] : s;
      col.set([rgb[0], rgb[1], rgb[2], 1], v * 4);
    }
    tubeVD.colors = col;
    moving.push(place(alongZ(tubeVD), { x: Math.cos(a) * RING, y: Math.sin(a) * RING }));
  }
  for (const [z, r] of [
    [0.1, 0.205],
    [0.5, 0.19],
    [0.86, 0.19],
  ] as const) {
    moving.push(
      paint(
        alongZ(
          lathe(
            [
              [0, -0.03],
              [r - 0.015, -0.03],
              [r, 0],
              [r - 0.015, 0.03],
              [0, 0.03],
            ],
            14,
          ),
          z,
        ),
        c.green,
      ),
    );
  }
  moving.push(
    paint(
      alongZ(
        lathe(
          [
            [0.035, 0],
            [0.035, 0.96],
            [0, 0.97],
          ],
          8,
        ),
      ),
      c.greenDark,
    ),
  );
  // Brass: a breech ring where the cluster leaves the housing, a guide collar near the
  // muzzle, the hopper cap.
  const brass: VertexData[] = [
    alongZ(
      lathe(
        [
          [0.2, 0.08],
          [0.235, 0.085],
          [0.24, 0.11],
          [0.235, 0.135],
          [0.2, 0.14],
        ],
        18,
      ),
    ),
    alongZ(
      lathe(
        [
          [0.2, 0.74],
          [0.225, 0.745],
          [0.23, 0.775],
          [0.225, 0.8],
          [0.2, 0.805],
        ],
        18,
      ),
    ),
  ];
  const cap = roundedBox(0.27, 0.05, 0.29, 0.02, 1);
  cap.uvs = null;
  brass.push(place(cap, { y: 0.46, z: -0.14, rx: -0.12 }));
  return { fixed: mergeParts(fixed), moving: mergeParts(moving), brass: paint(mergeParts(brass), [1, 1, 1]) };
}

function blunderbussParts(): Parts {
  const c = colors();
  const fixed: VertexData[] = [paint(rodX(-CHEEK_X, CHEEK_X, 0, 0, 0.06, 8), c.greenDark)];
  const outer: [number, number][] = [
    [0, -0.36],
    [0.12, -0.36],
    [0.2, -0.33],
    [0.235, -0.28],
    [0.24, -0.1],
    [0.22, 0.2],
    [0.19, 0.45],
    [0.2, 0.62],
    [0.25, 0.8],
    [0.33, 0.93],
    [0.4, 1.0],
  ];
  const bore: [number, number][] = [
    [0.4, 1.0],
    [0.36, 1.0],
    [0.3, 0.95],
    [0.2, 0.84],
    [0.12, 0.72],
    [0, 0.62],
  ];
  const body = paint(alongZ(lathe(outer, 20)), c.greenDark);
  const inside = paint(alongZ(lathe(bore, 20)), [0.03, 0.035, 0.028]);
  // A raised cream star on the barrel's top, where the camera looks.
  const st = place(star(0.075, 0.032, 0.012), { y: 0.218, z: 0.05, rx: -0.07 });
  const moving = mergeParts([body, inside, paint(st, c.cream)]);
  const brass = mergeParts([
    alongZ(
      lathe(
        [
          [0.39, 0.97],
          [0.43, 0.985],
          [0.445, 1.02],
          [0.425, 1.05],
          [0.385, 1.045],
        ],
        20,
      ),
    ),
    alongZ(
      lathe(
        [
          [0.235, -0.3],
          [0.258, -0.29],
          [0.262, -0.25],
          [0.258, -0.21],
          [0.235, -0.2],
        ],
        18,
      ),
    ),
    alongZ(
      lathe(
        [
          [0.2, 0.4],
          [0.215, 0.41],
          [0.218, 0.45],
          [0.215, 0.49],
          [0.2, 0.5],
        ],
        18,
      ),
    ),
    alongZ(
      lathe(
        [
          [0.06, -0.36],
          [0.08, -0.39],
          [0.085, -0.44],
          [0.06, -0.48],
          [0, -0.49],
        ],
        12,
      ),
    ),
  ]);
  return { fixed: mergeParts(fixed), moving, brass: paint(brass, [1, 1, 1]) };
}

const cache: Partial<Record<CannonVariant, Parts>> = {};

// The variant's parts with AO baked over them together (cached per page).
function parts(id: CannonVariant): Parts {
  let p = cache[id];
  if (!p) {
    p = id === 'repeater' ? repeaterParts() : blunderbussParts();
    const all = mergeParts([clone(p.fixed), clone(p.moving), clone(p.brass)]);
    bakeVertexAO(all, { samples: 12, maxDist: 0.3, strength: 0.6, ground: false, maxTriangles: 9000 });
    let off = 0;
    for (const vd of [p.fixed, p.moving, p.brass]) {
      const n = (vd.positions as ArrayLike<number>).length;
      vd.colors = Float32Array.from(all.colors as Float32Array).slice((off / 3) * 4, ((off + n) / 3) * 4);
      off += n;
    }
    // Brass is metal: keep its occlusion gentle.
    const bc = p.brass.colors as Float32Array;
    for (let i = 0; i < bc.length; i++) if (i % 4 !== 3) bc[i] = 1 - (1 - bc[i]) * 0.45;
    cache[id] = p;
  }
  return p;
}

export function createCannonVariant(scene: Scene, look: Look, id: CannonVariant): CannonVariantModel {
  const geo = buildCannonGeometry();
  const vp = parts(id);
  const spec = SPEC[id];
  const plastic = look.material('cannon-plastic', () =>
    plasticMaterial(scene, null, { name: 'cannonPlastic', clearcoat: 0.3, clearcoatRoughness: 0.18, roughness: 0.4 }),
  );
  const brass = look.material('cannon-brass', () => brassMaterial(scene, { name: 'cannonBrass', roughness: 0.3 }));
  const wood = look.material('cannon-wood', () =>
    woodMaterial(scene, null, { name: 'cannonWood', textureScale: 1, normalStrength: 0.3 }),
  );

  const root = new TransformNode(`cannon-${id}`, scene);
  const tip = new TransformNode(`cannon-${id}-tip`, scene);
  tip.parent = root;
  tip.position.set(0, 0, TRAIL_END_Z);
  const body = new TransformNode(`cannon-${id}-body`, scene);
  body.parent = tip;
  body.position.set(0, 0, -TRAIL_END_Z);

  // The fixed barrel-space plastic is merged into the carriage (placed on the trunnions).
  const toBody = { y: BARREL_Y, z: BARREL_Z, rx: BARREL_PITCH };
  const carriage = buildMesh(
    scene,
    `cannon-${id}-carriage`,
    mergeParts([clone(geo.carriage), place(clone(vp.fixed), toBody)]),
    plastic,
  );
  carriage.parent = body;

  const barrel = new TransformNode(`cannon-${id}-barrel`, scene);
  barrel.parent = body;
  barrel.position.set(0, BARREL_Y, BARREL_Z);
  barrel.rotation.x = BARREL_PITCH;
  const spinner = new TransformNode(`cannon-${id}-spin`, scene);
  spinner.parent = barrel;
  const moving = buildMesh(scene, `cannon-${id}-gun`, clone(vp.moving), plastic);
  moving.parent = spinner;
  const brassMesh = buildMesh(scene, `cannon-${id}-brass`, clone(vp.brass), brass);
  brassMesh.parent = id === 'repeater' ? body : barrel;
  if (id === 'repeater') {
    brassMesh.position.set(0, BARREL_Y, BARREL_Z);
    brassMesh.rotation.x = BARREL_PITCH;
  }

  const wheels = buildMesh(scene, `cannon-${id}-wheels`, clone(geo.wheels), wood);
  wheels.parent = body;
  wheels.position.set(0, AXLE_Y, 0);

  const blob = createBlobShadowMesh(scene, `cannon-${id}-blob`, 0.38);
  blob.parent = root;
  blob.scaling.set(1.9, 1, 2.3);
  blob.position.z = -0.12;

  const meshes: Mesh[] = [carriage, moving, brassMesh, wheels];
  for (const m of meshes) look.addShadowCaster(m, 'static');
  look.receiveShadows(carriage);
  look.receiveShadows(wheels);
  look.receiveShadows(moving);

  const muzzle = new Vector3(
    0,
    BARREL_Y - Math.sin(BARREL_PITCH) * spec.muzzle,
    BARREL_Z + Math.cos(BARREL_PITCH) * spec.muzzle,
  );

  return {
    root,
    barrel,
    muzzle,
    setRecoil(k: number): void {
      const r = Math.max(0, Math.min(1, k));
      barrel.position.z = BARREL_Z - spec.recoil * r;
      tip.rotation.x = -RECOIL_TIP * r * (spec.recoil / 0.2);
    },
    setWheelSpin(rad: number): void {
      wheels.rotation.x = rad;
    },
    setSpin(rad: number): void {
      if (id === 'repeater') spinner.rotation.z = rad;
    },
    dispose(): void {
      for (const m of meshes) look.removeShadowCaster(m);
      root.dispose(false, false);
    },
  };
}

// ---------- preview ----------
export function preview(scene: Scene, look: Look, opts: PreviewOptions): PreviewResult {
  const id: CannonVariant = opts.variant === 'blunderbuss' ? 'blunderbuss' : 'repeater';
  const cannon = createCannonVariant(scene, look, id);
  const holder = new TransformNode('cannonVariantPreviewRoot', scene);
  cannon.root.parent = holder;
  let x = 0;
  let spin = 0;
  return {
    root: holder,
    update(time: number): void {
      const rate = id === 'repeater' ? 10 : 2.5;
      const phase = (time * rate) % 1;
      cannon.setRecoil((1 - phase) * (1 - phase));
      cannon.setSpin(time * 9);
      const nx = Math.sin(time * 0.8) * 1.5;
      spin += (nx - x) / WHEEL_RADIUS;
      cannon.setWheelSpin(spin);
      x = nx;
      cannon.root.position.x = x;
    },
    dispose(): void {
      cannon.dispose();
      holder.dispose();
    },
  };
}
