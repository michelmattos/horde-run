// The Snowball Launcher (World 2 cannon item, 'snowball-launcher'): a toy ice-cream-scoop
// catapult on the popgun's green plastic carriage and wooden wheels (models/cannon.ts).
// A chunky plastic throwing arm pivots between the cheeks on a twisted cream cord spring;
// at its front end a brass ice-cream scoop holds a packed snowball. Behind it, over the
// trail, a striped snow-cone hopper is heaped with snowballs (the camera, behind and above
// the cannon, looks straight into it). Each shot flicks the arm up and over, then it eases
// back down to scoop the next ball.
//
// GAME API (the popgun's CannonModel, so cannon.ts swaps it freely)
//   createSnowballLauncher(scene, look): CannonModel
//     root (place/slide it), barrel (the throwing arm's pivot node), muzzle (root-local
//     snowball position in the scoop at rest), setRecoil(0..1) (0 = loaded, 1 = arm flung
//     up ~65 degrees, carriage tips like the popgun), setWheelSpin(rad), dispose().
//   Pivot: axle centre on the floor, arm along +Z, side 'player' (yaw 0). Size like the
//   popgun (~1.5 wide x 2.0 deep x 1.35 tall at the hopper rim).
//   Draw calls: 4 meshes (carriage + hopper, arm, brass scoop and fittings, wood wheels)
//   plus a faint blob; the popgun's shared materials; AO of the new parts baked once per
//   page (~40 ms). Every mesh is a static shadow caster.
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
  lin,
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
import { sphereVD } from './champion.ts';

export const info: ModelInfo = {
  key: 'snowballLauncher',
  title: 'Cannon: Snowball Launcher (scoop catapult)',
  instanced: false,
  teams: false,
  side: 'player',
  height: 1.35,
  triangleBudget: 6000,
  gameZ: 1.5,
};

const ARM_REST = 0.32; // radians: the arm lies forward and down, scoop near the ground
const ARM_FLING = 1.15; // radians the arm swings up at full recoil
const SCOOP_Z = 0.86; // scoop centre along the arm
const SCOOP_Y = 0.07;
const BALL_R = 0.15;
const HOPPER_Z = -0.5;
const HOPPER_Y = 0.62;

const SNOW = '#eceff1';
const SNOW_SHADE = '#cfdae4';

function snowball(r: number, x: number, y: number, z: number, tess = 10): VertexData {
  const vd = sphereVD(r, tess, 6);
  // Cool hollows underneath: shade by height.
  const p = vd.positions as number[];
  const top = lin(SNOW);
  const low = lin(SNOW_SHADE);
  const c = new Float32Array((p.length / 3) * 4);
  for (let i = 0; i < p.length / 3; i++) {
    const t = Math.min(1, Math.max(0, 0.5 - p[i * 3 + 1] / r / 2));
    c.set([top.r + (low.r - top.r) * t, top.g + (low.g - top.g) * t, top.b + (low.b - top.b) * t, 1], i * 4);
  }
  vd.colors = c;
  return place(vd, { x, y, z });
}

interface Parts {
  fixed: VertexData; // plastic, body space: the hopper with its snowballs and its posts
  arm: VertexData; // plastic, arm space (pivot at the origin, along +Z): beam, hub, cord, ball
  brass: VertexData; // brass, arm space: the scoop, hub caps
}

function buildParts(): Parts {
  const c = colors();
  const fixed: VertexData[] = [];
  const box = (w: number, h: number, d: number, r: number, t: Parameters<typeof place>[1], col = c.green) => {
    const vd = roundedBox(w, h, d, r, 2);
    vd.uvs = null;
    return paint(place(vd, t), col);
  };
  // Snow-cone hopper: a striped funnel (green and cream bands) with a rolled cream rim.
  const funnel = lathe(
    [
      [0.09, 0.0],
      [0.14, 0.08],
      [0.27, 0.36],
      [0.33, 0.48],
      [0.355, 0.5],
      [0.355, 0.54],
      [0.33, 0.55],
      [0.3, 0.52],
      [0.14, 0.2],
      [0, 0.18],
    ],
    20,
  );
  {
    const p = funnel.positions as number[];
    const col = new Float32Array((p.length / 3) * 4);
    for (let i = 0; i < p.length / 3; i++) {
      const y = p[i * 3 + 1];
      const r = Math.hypot(p[i * 3], p[i * 3 + 2]);
      const rim = y > 0.49 && r > 0.31;
      const band = Math.floor(y / 0.12) % 2 === 0;
      const k = rim || !band ? c.cream : c.green;
      col.set([k.r, k.g, k.b, 1], i * 4);
    }
    funnel.colors = col;
  }
  fixed.push(place(funnel, { y: HOPPER_Y, z: HOPPER_Z }));
  // A heap of snowballs in it.
  const heap: [number, number, number, number][] = [
    [0, 0.5, 0, 0.13],
    [-0.15, 0.47, 0.08, 0.11],
    [0.15, 0.47, 0.06, 0.11],
    [0.05, 0.46, -0.15, 0.11],
    [-0.1, 0.45, -0.12, 0.1],
    [0.02, 0.62, 0.03, 0.1],
  ];
  for (const [x, y, z, r] of heap) fixed.push(snowball(r, x, HOPPER_Y + y, HOPPER_Z + z, 8));
  // Posts from the trail up to the hopper and a cross brace.
  for (const s of [-1, 1])
    fixed.push(box(0.07, 0.42, 0.07, 0.025, { x: s * 0.13, y: 0.42, z: HOPPER_Z - 0.02, rz: s * 0.2 }));
  fixed.push(box(0.36, 0.06, 0.12, 0.025, { y: 0.27, z: HOPPER_Z }, c.greenDark));

  // The throwing arm (arm space: pivot at the origin, along +Z, scoop end down-forward).
  const arm: VertexData[] = [];
  arm.push(box(0.15, 0.11, 0.86, 0.045, { y: 0.0, z: 0.4 }));
  arm.push(box(0.1, 0.07, 0.3, 0.03, { y: 0.075, z: 0.25 }, c.greenLight)); // moulded top rib
  arm.push(paint(rodX(-CHEEK_X + 0.05, CHEEK_X - 0.05, 0, 0, 0.075, 12), c.greenDark)); // hub
  // Twisted cord spring wound round the hub either side of the arm.
  for (const s of [-1, 1])
    for (let k = 0; k < 3; k++)
      arm.push(
        paint(
          place(
            lathe(
              [
                [0.08, -0.018],
                [0.105, -0.012],
                [0.11, 0.0],
                [0.105, 0.012],
                [0.08, 0.018],
              ],
              12,
            ),
            { rz: Math.PI / 2, x: s * (0.11 + k * 0.045) },
          ),
          c.cream,
        ),
      );
  arm.push(snowball(BALL_R, 0, SCOOP_Y + 0.11, SCOOP_Z, 12));

  // Brass: the ice-cream scoop bowl (open to +Y) and its neck, and two hub caps.
  const brass: VertexData[] = [];
  brass.push(
    place(
      lathe(
        [
          [0, -0.05],
          [0.09, -0.035],
          [0.15, 0.0],
          [0.185, 0.06],
          [0.19, 0.085],
          [0.172, 0.085],
          [0.165, 0.065],
          [0.13, 0.015],
          [0.07, -0.01],
          [0, -0.02],
        ],
        18,
      ),
      { y: SCOOP_Y, z: SCOOP_Z },
    ),
  );
  for (const s of [-1, 1])
    brass.push(
      place(
        lathe(
          [
            [0, 0],
            [0.085, 0],
            [0.085, 0.02],
            [0.06, 0.04],
            [0, 0.045],
          ],
          12,
        ),
        { rz: -s * (Math.PI / 2), x: s * (CHEEK_X - 0.045) },
      ),
    );
  return { fixed: mergeParts(fixed), arm: mergeParts(arm), brass: paint(mergeParts(brass), [1, 1, 1]) };
}

let cached: Parts | null = null;

// The new parts with AO baked over them together, at rest (cached per page).
function parts(): Parts {
  if (cached) return cached;
  const p = buildParts();
  const toBody = { y: BARREL_Y, z: BARREL_Z, rx: ARM_REST };
  const groups = [clone(p.fixed), place(clone(p.arm), toBody), place(clone(p.brass), toBody)];
  const all = mergeParts(groups);
  bakeVertexAO(all, { samples: 12, maxDist: 0.3, strength: 0.6, maxTriangles: 9000 });
  let off = 0;
  for (const vd of [p.fixed, p.arm, p.brass]) {
    const n = (vd.positions as ArrayLike<number>).length / 3;
    vd.colors = Float32Array.from(all.colors as Float32Array).slice(off * 4, (off + n) * 4);
    off += n;
  }
  const bc = p.brass.colors as Float32Array;
  for (let i = 0; i < bc.length; i++) if (i % 4 !== 3) bc[i] = 1 - (1 - bc[i]) * 0.45;
  cached = p;
  return p;
}

export function createSnowballLauncher(scene: Scene, look: Look): CannonModel {
  const geo = buildCannonGeometry();
  const vp = parts();
  const plastic = look.material('cannon-plastic', () =>
    plasticMaterial(scene, null, { name: 'cannonPlastic', clearcoat: 0.3, clearcoatRoughness: 0.18, roughness: 0.4 }),
  );
  const brass = look.material('cannon-brass', () => brassMaterial(scene, { name: 'cannonBrass', roughness: 0.3 }));
  const wood = look.material('cannon-wood', () =>
    woodMaterial(scene, null, { name: 'cannonWood', textureScale: 1, normalStrength: 0.3 }),
  );

  const root = new TransformNode('cannon-snowball', scene);
  const tip = new TransformNode('cannon-snowball-tip', scene);
  tip.parent = root;
  tip.position.set(0, 0, TRAIL_END_Z);
  const body = new TransformNode('cannon-snowball-body', scene);
  body.parent = tip;
  body.position.set(0, 0, -TRAIL_END_Z);

  const carriage = buildMesh(
    scene,
    'cannon-snowball-carriage',
    mergeParts([clone(geo.carriage), clone(vp.fixed)]),
    plastic,
  );
  carriage.parent = body;

  const barrel = new TransformNode('cannon-snowball-arm', scene);
  barrel.parent = body;
  barrel.position.set(0, BARREL_Y, BARREL_Z);
  barrel.rotation.x = ARM_REST;
  const armMesh = buildMesh(scene, 'cannon-snowball-armMesh', clone(vp.arm), plastic);
  armMesh.parent = barrel;
  const brassMesh = buildMesh(scene, 'cannon-snowball-brass', clone(vp.brass), brass);
  brassMesh.parent = barrel;

  const wheels = buildMesh(scene, 'cannon-snowball-wheels', clone(geo.wheels), wood);
  wheels.parent = body;
  wheels.position.set(0, AXLE_Y, 0);

  const blob = createBlobShadowMesh(scene, 'cannon-snowball-blob', 0.38);
  blob.parent = root;
  blob.scaling.set(1.9, 1, 2.3);
  blob.position.z = -0.12;

  const meshes: Mesh[] = [carriage, armMesh, brassMesh, wheels];
  for (const m of meshes) look.addShadowCaster(m, 'static');
  look.receiveShadows(carriage);
  look.receiveShadows(wheels);
  look.receiveShadows(armMesh);

  // The loaded ball at rest (rx turns +Z down for a positive angle).
  const by = SCOOP_Y + 0.11;
  const muzzle = new Vector3(
    0,
    BARREL_Y + by * Math.cos(ARM_REST) - SCOOP_Z * Math.sin(ARM_REST),
    BARREL_Z + SCOOP_Z * Math.cos(ARM_REST) + by * Math.sin(ARM_REST),
  );

  return {
    root,
    barrel,
    muzzle,
    setRecoil(k: number): void {
      const r = Math.max(0, Math.min(1, k));
      barrel.rotation.x = ARM_REST - ARM_FLING * r;
      tip.rotation.x = -RECOIL_TIP * r * 0.6;
    },
    setWheelSpin(rad: number): void {
      wheels.rotation.x = rad;
    },
    dispose(): void {
      for (const m of meshes) look.removeShadowCaster(m);
      root.dispose(false, false);
    },
  };
}

// ---------- preview ----------
export function preview(scene: Scene, look: Look, _opts: PreviewOptions): PreviewResult {
  const cannon = createSnowballLauncher(scene, look);
  const holder = new TransformNode('snowballLauncherPreviewRoot', scene);
  cannon.root.parent = holder;
  let x = 0;
  let spin = 0;
  return {
    root: holder,
    update(time: number): void {
      const phase = (time * 1.5) % 1;
      cannon.setRecoil((1 - phase) * (1 - phase));
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
