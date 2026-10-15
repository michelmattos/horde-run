// The Gear Gun (Milestone 6 cannon, loadout id 'gear-gun'): a clockwork toy gun on the
// popgun's green carriage and wooden wheels (models/cannon.ts). A squat green breech box
// on the trunnions carries a big brass gear on each side, turned by a red-knobbed crank
// on the right; the barrel is a brass-banded green tube ringed with three toothed brass
// gear collars ("the toothed barrel") and a crown of brass teeth at the muzzle, its shots
// ricochet off the lane walls. On every shot the side gears ratchet round one tooth
// (cannon.ts drives setSpin from crowdLogic.gearRatchet) and the barrel kicks back.
//
// GAME API (the popgun's CannonModel, so cannon.ts swaps it freely)
//   createGearGun(scene, look): GearGunModel
//     root (place/slide it), barrel (recoil node, axis +Z), muzzle (root-local muzzle tip
//     at rest), setRecoil(0..1), setWheelSpin(rad), dispose(), plus
//     setSpin(rad): the side gears' (and crank's) angle about the trunnion axis.
//     GEAR_TEETH: teeth on the side gears (one tooth per shot = 2 PI / GEAR_TEETH).
//   Pivot: axle centre on the floor, barrel along +Z, side 'player' (yaw 0). Size like
//   the popgun (~1.5 x 2.0 x 1.1). Draw calls: 4 meshes (carriage + breech in the cannon
//   plastic, barrel and side gears in the shared 'toy-mix' material, wood wheels) plus a
//   faint blob; static shadow casters. The new parts' AO is baked once per page (~40 ms).
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Look } from '../look/index.ts';
import {
  MIX,
  bakeVertexAO,
  buildMesh,
  createBlobShadowMesh,
  lathe,
  lin,
  mergeParts,
  mixUv,
  mixedToyMaterial,
  paint,
  place,
  plasticMaterial,
  roundedBox,
  woodMaterial,
} from '../look/index.ts';
import type { MixSlot } from '../look/index.ts';
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
} from './cannon.ts';
import { gearVD } from './championWindup.ts';
import { gearRatchet } from '../crowdLogic.ts';

export const info: ModelInfo = {
  key: 'gearGun',
  title: 'Cannon: the Gear Gun',
  instanced: false,
  teams: false,
  side: 'player',
  height: 1.1,
  triangleBudget: 6000,
  gameZ: 1.5,
};

export interface GearGunModel extends CannonModel {
  setSpin(rad: number): void;
}

export const GEAR_TEETH = 16;
const MUZZLE = 1.02;
const RECOIL = 0.18;
const GEAR_X = CHEEK_X + 0.085; // side gears just outside the cheeks
const GEAR_R = 0.3;

const BRASS = '#d2a33f';
const BRASS_DARK = '#a77d2a';
const STEEL = '#c9ced4';

function part(vd: VertexData, color: string | [number, number, number], slot: MixSlot): VertexData {
  vd.uvs = null;
  return mixUv(paint(vd, typeof color === 'string' ? lin(color) : color), slot);
}
const alongZ = (vd: VertexData, z = 0): VertexData => place(vd, { rx: Math.PI / 2, z });

interface Parts {
  breech: VertexData; // cannon plastic, barrel space at rest (does not recoil)
  barrel: VertexData; // toy-mix, barrel space
  gears: VertexData; // toy-mix, gear space (axis X through the origin)
}

function buildParts(): Parts {
  const c = colors();
  // Breech box on the trunnions with a gear-axle through it.
  const breech: VertexData[] = [];
  const bx = roundedBox(0.46, 0.38, 0.46, 0.08, 2);
  bx.uvs = null;
  breech.push(paint(place(bx, { z: -0.16 }), c.greenDark));
  const lid = roundedBox(0.36, 0.06, 0.34, 0.025, 1);
  lid.uvs = null;
  breech.push(paint(place(lid, { y: 0.21, z: -0.16 }), c.green));
  breech.push(paint(rodX(-GEAR_X, GEAR_X, 0, 0, 0.05, 10), c.greenDark));

  // Barrel: green tube, three toothed brass collars, brass breech ring, a muzzle crown.
  const barrel: VertexData[] = [];
  barrel.push(
    part(
      alongZ(
        lathe(
          [
            [0, -0.36],
            [0.12, -0.36],
            [0.16, -0.32],
            [0.16, 0.1],
            [0.142, 0.14],
            [0.142, MUZZLE - 0.04],
          ],
          16,
        ),
      ),
      [c.green.r, c.green.g, c.green.b],
      MIX.plastic,
    ),
  );
  for (const z of [0.22, 0.48, 0.74]) {
    const g = gearVD(0.205, 0.17, 12, 0.07);
    barrel.push(part(place(g, { rx: Math.PI / 2, z: z + 0.035 }), BRASS, MIX.brass));
  }
  barrel.push(
    part(
      alongZ(
        lathe(
          [
            [0.16, -0.06],
            [0.185, -0.05],
            [0.185, 0.04],
            [0.16, 0.05],
          ],
          16,
        ),
      ),
      BRASS_DARK,
      MIX.brass,
    ),
  );
  // Muzzle crown: a short gear ring whose teeth point forward, and the dark bore.
  barrel.push(part(place(gearVD(0.19, 0.155, 10, 0.1), { rx: Math.PI / 2, z: MUZZLE }), BRASS, MIX.brass));
  barrel.push(
    part(
      alongZ(
        lathe(
          [
            [0.15, MUZZLE - 0.001],
            [0.1, MUZZLE - 0.002],
            [0, MUZZLE - 0.12],
          ],
          12,
        ),
      ),
      [0.015, 0.016, 0.014],
      MIX.rubber,
    ),
  );
  // Side gears with hub bolts, spokes cut as darker plates, and the crank on the right.
  const gears: VertexData[] = [];
  for (const s of [-1, 1]) {
    const g = gearVD(GEAR_R, GEAR_R - 0.05, GEAR_TEETH, 0.05);
    gears.push(part(place(g, { rz: -s * (Math.PI / 2), x: s * GEAR_X - (s * 0.05) / 2 }), BRASS, MIX.brass));
    for (let k = 0; k < 3; k++) {
      const spoke = roundedBox(0.012, GEAR_R * 1.4, 0.05, 0.005, 0);
      spoke.uvs = null;
      gears.push(part(place(spoke, { rx: (k * Math.PI) / 3, x: s * (GEAR_X + 0.005) }), BRASS_DARK, MIX.brass));
    }
    gears.push(
      part(
        place(
          lathe(
            [
              [0.07, 0],
              [0.07, 0.03],
              [0.045, 0.06],
              [0, 0.065],
            ],
            10,
          ),
          { rz: -s * (Math.PI / 2), x: s * (GEAR_X + 0.02) },
        ),
        STEEL,
        MIX.brass,
      ),
    );
  }
  // Crank: an arm off the right gear's hub out to a red knob.
  const arm = roundedBox(0.035, 0.26, 0.05, 0.015, 0);
  arm.uvs = null;
  gears.push(part(place(arm, { x: GEAR_X + 0.09, y: -0.13 }), STEEL, MIX.brass));
  gears.push(
    part(
      place(
        lathe(
          [
            [0, 0],
            [0.03, 0.005],
            [0.04, 0.04],
            [0.03, 0.1],
            [0, 0.11],
          ],
          10,
        ),
        { rz: -Math.PI / 2, x: GEAR_X + 0.11, y: -0.24 },
      ),
      [c.red.r, c.red.g, c.red.b],
      MIX.plastic,
    ),
  );
  return { breech: mergeParts(breech), barrel: mergeParts(barrel), gears: mergeParts(gears) };
}

let cached: Parts | null = null;

// The parts with AO baked over them together, at rest (cached per page).
function parts(): Parts {
  if (!cached) {
    const p = buildParts();
    const all = mergeParts([clone(p.breech), clone(p.barrel), clone(p.gears)]);
    bakeVertexAO(all, { samples: 12, maxDist: 0.3, strength: 0.6, ground: false, maxTriangles: 9000 });
    let off = 0;
    for (const vd of [p.breech, p.barrel, p.gears]) {
      const n = (vd.positions as ArrayLike<number>).length;
      vd.colors = Float32Array.from(all.colors as Float32Array).slice((off / 3) * 4, ((off + n) / 3) * 4);
      off += n;
    }
    cached = p;
  }
  return cached;
}

export function createGearGun(scene: Scene, look: Look): GearGunModel {
  const geo = buildCannonGeometry();
  const gp = parts();
  const plastic = look.material('cannon-plastic', () =>
    plasticMaterial(scene, null, { name: 'cannonPlastic', clearcoat: 0.3, clearcoatRoughness: 0.18, roughness: 0.4 }),
  );
  const mix = look.material('toy-mix', () => mixedToyMaterial(scene));
  const wood = look.material('cannon-wood', () =>
    woodMaterial(scene, null, { name: 'cannonWood', textureScale: 1, normalStrength: 0.3 }),
  );

  const root = new TransformNode('cannon-gear-gun', scene);
  const tip = new TransformNode('cannon-gear-gun-tip', scene);
  tip.parent = root;
  tip.position.set(0, 0, TRAIL_END_Z);
  const body = new TransformNode('cannon-gear-gun-body', scene);
  body.parent = tip;
  body.position.set(0, 0, -TRAIL_END_Z);

  const toBody = { y: BARREL_Y, z: BARREL_Z, rx: BARREL_PITCH };
  const carriage = buildMesh(
    scene,
    'cannon-gear-gun-carriage',
    mergeParts([clone(geo.carriage), place(clone(gp.breech), toBody)]),
    plastic,
  );
  carriage.parent = body;

  const barrel = new TransformNode('cannon-gear-gun-barrel', scene);
  barrel.parent = body;
  barrel.position.set(0, BARREL_Y, BARREL_Z);
  barrel.rotation.x = BARREL_PITCH;
  const barrelMesh = buildMesh(scene, 'cannon-gear-gun-tube', clone(gp.barrel), mix);
  barrelMesh.parent = barrel;

  const gearNode = new TransformNode('cannon-gear-gun-gears', scene);
  gearNode.parent = body;
  gearNode.position.set(0, BARREL_Y, BARREL_Z);
  const gearMesh = buildMesh(scene, 'cannon-gear-gun-gearset', clone(gp.gears), mix);
  gearMesh.parent = gearNode;

  const wheels = buildMesh(scene, 'cannon-gear-gun-wheels', clone(geo.wheels), wood);
  wheels.parent = body;
  wheels.position.set(0, AXLE_Y, 0);

  const blob = createBlobShadowMesh(scene, 'cannon-gear-gun-blob', 0.38);
  blob.parent = root;
  blob.scaling.set(1.9, 1, 2.3);
  blob.position.z = -0.12;

  const meshes: Mesh[] = [carriage, barrelMesh, gearMesh, wheels];
  for (const m of meshes) {
    look.addShadowCaster(m, 'static');
    look.receiveShadows(m);
  }

  const muzzle = new Vector3(0, BARREL_Y - Math.sin(BARREL_PITCH) * MUZZLE, BARREL_Z + Math.cos(BARREL_PITCH) * MUZZLE);

  return {
    root,
    barrel,
    muzzle,
    setRecoil(k: number): void {
      const r = Math.max(0, Math.min(1, k));
      barrel.position.z = BARREL_Z - RECOIL * r;
      tip.rotation.x = -RECOIL_TIP * r * (RECOIL / 0.2);
    },
    setWheelSpin(rad: number): void {
      wheels.rotation.x = rad;
    },
    setSpin(rad: number): void {
      gearNode.rotation.x = rad;
    },
    dispose(): void {
      for (const m of meshes) look.removeShadowCaster(m);
      root.dispose(false, false);
    },
  };
}

// ---------- preview ----------
// Firing at 3 shots/s: the barrel kicks and the side gears ratchet a tooth per shot while
// the gun slides across the lane.
export function preview(scene: Scene, look: Look, _opts: PreviewOptions): PreviewResult {
  const gun = createGearGun(scene, look);
  const holder = new TransformNode('gearGunPreviewRoot', scene);
  gun.root.parent = holder;
  let x = 0;
  let spin = 0;
  return {
    root: holder,
    update(time: number): void {
      const shots = time * 3;
      const phase = shots % 1;
      gun.setRecoil((1 - phase) * (1 - phase));
      gun.setSpin(gearRatchet(shots, GEAR_TEETH));
      const nx = Math.sin(time * 0.8) * 1.5;
      spin += (nx - x) / WHEEL_RADIUS;
      gun.setWheelSpin(spin);
      x = nx;
      gun.root.position.x = x;
    },
    dispose(): void {
      gun.dispose();
      holder.dispose();
    },
  };
}
