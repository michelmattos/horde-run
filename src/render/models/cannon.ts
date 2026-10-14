// The player's toy field cannon (World 1: plastic army men on a bedroom floor).
//
// A chunky injection-moulded toy: green plastic carriage, cheeks and box trail with a
// cream star moulded on top, a fat dark-green barrel with a brass breech ring, cascabel
// knob, muzzle band and sights, big varnished-wood spoked wheels with dark rubber-look
// tyres, an elevation screw with a little crank (red knob) and a towing ring on the
// trail. The camera sees it from behind and above, so the breech, trail and top carry the
// detail. Procedural (no downloaded assets): geometry is built from lathes and bevelled
// boxes, with ambient occlusion baked into vertex colours once per page load (cached).
//
// Size: ~1.52 wide x 1.95 deep x 1.0 tall (barrel top ~0.93, rear sight ~0.98).
// Pivot: centre of the axle on the ground (y = 0). Barrel along +Z, muzzle tip ~1.0 ahead.
// side 'player': yaw 0 in the game (front up the lane).
//
// GAME API
//   const cannon = createCannon(scene, look);
//   cannon.root.position.set(x, 0, LAYOUT.cannonZ);   // integration places/slides it
//   cannon.setRecoil(k);       // 0 = rest, 1 = full kick (barrel 0.2 back, carriage tips ~4 deg)
//   cannon.setWheelSpin(rad);  // wheel angle; e.g. rad = x / WHEEL_RADIUS as it slides in x
//   cannon.muzzle              // muzzle tip in root-local space at rest (spawn point offset)
//   cannon.dispose();
// Draw calls: 4 meshes (carriage + barrel share one plastic material; brass; wood wheels)
// plus 1 faint contact blob (unlit quad). All four meshes cast shadows (static caster);
// the carriage and wheels also receive them. Materials come from look.material(...).
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { CreateCylinderVertexData } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateTorusVertexData } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Look } from '../look/index.ts';
import {
  bakeVertexAO,
  brassMaterial,
  buildMesh,
  createBlobShadowMesh,
  fixWinding,
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

export const info: ModelInfo = {
  key: 'cannon',
  title: 'Player toy field cannon',
  instanced: false,
  teams: false,
  side: 'player',
  height: 1.0,
  triangleBudget: 5000,
  gameZ: 1.5,
};

// ---------- dimensions (body space: origin = axle centre on the ground) ----------
export const WHEEL_RADIUS = 0.445; // tyre outer radius; divide a slide distance by it for setWheelSpin
const AXLE_Y = WHEEL_RADIUS;
const WHEEL_X = 0.64;
const BARREL_Y = 0.72; // barrel axis height at rest
const BARREL_Z = 0.03; // barrel node (trunnion line) z
const BARREL_PITCH = -0.05; // a touch of elevation (negative rx lifts the muzzle)
const MUZZLE_LOCAL = 0.98; // muzzle face along the barrel axis
const TRAIL_END_Z = -0.9; // where the trail spade meets the floor: the recoil tip pivot
const RECOIL_DIST = 0.2;
const CHEEK_X = 0.305; // cheek plate centre (inner face clears the fat barrel)
const FAT = 1.15; // barrel girth multiplier
const fat = (p: readonly number[]): [number, number] => [p[0] * FAT, p[1]];
const RECOIL_TIP = (4 * Math.PI) / 180;

export interface CannonModel {
  root: TransformNode; // place and slide this (y = 0 on the floor)
  barrel: TransformNode; // slides back on recoil
  muzzle: Vector3; // muzzle tip, root-local, at rest
  setRecoil(k: number): void;
  setWheelSpin(rad: number): void;
  dispose(): void;
}

// ---------- colours (linear, vertex colours over white-albedo materials) ----------
interface Colors {
  green: Color3;
  greenDark: Color3;
  greenLight: Color3;
  cream: Color3;
  red: Color3;
  bore: [number, number, number];
  oak: Color3;
  oakDark: Color3;
  oakLight: Color3;
  tyre: Color3;
}

function colors(): Colors {
  return {
    green: lin('green'),
    greenDark: lin('greenDark'),
    greenLight: lin('greenLight'),
    cream: lin('rugBorder'),
    red: lin('toyRed'),
    bore: [0.012, 0.014, 0.01],
    oak: lin('oak'),
    oakDark: lin('oakDark'),
    oakLight: lin('oakLight'),
    tyre: lin('tread'),
  };
}

// ---------- small part builders ----------
// Cylinder along X from x0 to x1 at (y, z).
function rodX(x0: number, x1: number, y: number, z: number, r: number, tess = 10): VertexData {
  const vd = CreateCylinderVertexData({ height: Math.abs(x1 - x0), diameter: r * 2, tessellation: tess });
  return place(vd, { rz: Math.PI / 2, x: (x0 + x1) / 2, y, z });
}

// A small dome rivet / bolt head facing +axis (built facing +Y, then placed).
function rivet(r: number, tess = 8): VertexData {
  return lathe(
    [
      [0, 0],
      [r, 0],
      [r, r * 0.35],
      [r * 0.7, r * 0.75],
      [0, r * 0.9],
    ],
    tess,
  );
}

// Flat five-point star in the XZ plane (normal +Y), centred on the origin, a thin raised
// plate so it reads as moulded relief: top face plus side walls.
function star(outer: number, inner: number, thick: number): VertexData {
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? outer : inner;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  const positions: number[] = [0, thick, 0];
  const normals: number[] = [0, 1, 0];
  const indices: number[] = [];
  for (const [x, z] of pts) {
    positions.push(x, thick, z);
    normals.push(0, 1, 0);
  }
  for (let i = 0; i < 10; i++) indices.push(0, 1 + i, 1 + ((i + 1) % 10));
  // Side walls (flat-shaded quads).
  for (let i = 0; i < 10; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[(i + 1) % 10];
    let nx = bz - az;
    let nz = -(bx - ax);
    const l = Math.hypot(nx, nz) || 1;
    nx /= l;
    nz /= l;
    // Outward check (star is star-shaped around the origin).
    if (nx * (ax + bx) + nz * (az + bz) < 0) {
      nx = -nx;
      nz = -nz;
    }
    const b = positions.length / 3;
    positions.push(ax, thick, az, bx, thick, bz, bx, 0, bz, ax, 0, az);
    for (let k = 0; k < 4; k++) normals.push(nx, 0, nz);
    indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const vd = new VertexData();
  vd.positions = positions;
  vd.normals = normals;
  vd.indices = indices;
  vd.uvs = new Array((positions.length / 3) * 2).fill(0);
  return fixWinding(vd);
}

// ---------- geometry ----------
export interface CannonGeometry {
  carriage: VertexData; // green plastic, body space
  barrel: VertexData; // green plastic, barrel space (axis +Z, origin on the trunnion line)
  brass: VertexData; // brass, barrel space
  wheels: VertexData; // wood, wheel space (axle along X through the origin)
}

function buildCarriage(c: Colors): VertexData {
  const parts: VertexData[] = [];
  const add = (vd: VertexData, col: Color3 | [number, number, number]): void => {
    parts.push(paint(vd, col));
  };
  // Axle tree: a squared beam between the cheeks, round stub axles out to the wheels.
  add(place(roundedBox(1.04, 0.13, 0.14, 0.04, 1), { y: AXLE_Y, z: 0 }), c.green);
  add(rodX(-WHEEL_X - 0.02, WHEEL_X + 0.02, AXLE_Y, 0, 0.05, 10), c.greenDark);
  // Cheeks (side brackets) cradling the barrel.
  for (const s of [-1, 1]) {
    // Main cheek plate, front edge raked back a little.
    add(place(roundedBox(0.09, 0.28, 0.66, 0.04, 1), { x: s * CHEEK_X, y: 0.56, z: -0.03, rx: 0.06 }), c.green);
    // Trunnion cap (capsquare) on top of the cheek.
    add(
      place(roundedBox(0.13, 0.08, 0.17, 0.035, 1), { x: s * (CHEEK_X + 0.004), y: 0.715, z: BARREL_Z }),
      c.greenDark,
    );
    // Bolt on the capsquare and rivets along the cheek's outer face.
    add(place(rivet(0.03), { rz: (-s * Math.PI) / 2, x: s * (CHEEK_X + 0.07), y: 0.715, z: BARREL_Z }), c.greenLight);
  }
  // Rear transom between the cheeks, joining the trail.
  add(place(roundedBox(0.56, 0.14, 0.14, 0.045, 1), { y: 0.45, z: -0.27 }), c.green);
  // Box trail sloping down to the floor behind.
  const tz0 = -0.24,
    ty0 = 0.43,
    tz1 = TRAIL_END_Z + 0.04,
    ty1 = 0.09;
  const len = Math.hypot(tz0 - tz1, ty0 - ty1);
  const ang = Math.atan2(ty0 - ty1, tz0 - tz1);
  const trailPl = { y: (ty0 + ty1) / 2, z: (tz0 + tz1) / 2, rx: -ang };
  add(place(roundedBox(0.3, 0.15, len + 0.08, 0.05, 2), trailPl), c.green);
  // Raised cream star moulded on the trail's top face (seen by the camera).
  add(place(place(star(0.11, 0.045, 0.012), { y: 0.074, z: -0.05 }), trailPl), c.cream);
  // Side rails along the trail (moulded ribs).
  for (const s of [-1, 1]) {
    add(
      place(place(roundedBox(0.035, 0.05, len * 0.8, 0.017, 1), { x: s * 0.16, y: 0.04, z: 0.02 }), trailPl),
      c.greenDark,
    );
  }
  // Spade at the trail end, and a towing ring lying on top of it.
  add(place(roundedBox(0.36, 0.17, 0.06, 0.025, 1), { y: 0.085, z: TRAIL_END_Z - 0.01, rx: 0.25 }), c.greenDark);
  add(
    place(CreateTorusVertexData({ diameter: 0.16, thickness: 0.04, tessellation: 9 }), {
      y: 0.18,
      z: TRAIL_END_Z - 0.02,
      rx: -0.35,
    }),
    c.greenDark,
  );
  // Elevation screw under the breech and a crank handwheel on the right side.
  add(
    place(CreateCylinderVertexData({ height: 0.16, diameter: 0.06, tessellation: 10 }), { y: 0.5, z: -0.29 }),
    c.greenDark,
  );
  add(
    place(
      lathe(
        [
          [0, 0],
          [0.07, 0],
          [0.072, 0.025],
          [0, 0.045],
        ],
        10,
      ),
      { y: 0.5, z: -0.29 },
    ),
    c.greenDark,
  );
  add(rodX(CHEEK_X - 0.02, 0.4, 0.5, -0.22, 0.02, 6), c.greenDark);
  add(
    place(CreateTorusVertexData({ diameter: 0.16, thickness: 0.026, tessellation: 9 }), {
      rz: Math.PI / 2,
      x: 0.4,
      y: 0.5,
      z: -0.22,
    }),
    c.greenDark,
  );
  add(rodX(0.39, 0.41, 0.5, -0.22, 0.012, 6), c.greenDark);
  for (const a of [0, Math.PI / 2]) {
    add(
      place(CreateCylinderVertexData({ height: 0.15, diameter: 0.018, tessellation: 6 }), {
        rx: a,
        x: 0.4,
        y: 0.5,
        z: -0.22,
      }),
      c.greenDark,
    );
  }
  // Red handle knob on the handwheel rim.
  add(
    place(
      lathe(
        [
          [0, 0],
          [0.025, 0.005],
          [0.032, 0.03],
          [0.026, 0.06],
          [0, 0.068],
        ],
        10,
      ),
      { rz: -Math.PI / 2, x: 0.41, y: 0.565, z: -0.22 },
    ),
    c.red,
  );
  return mergeParts(parts);
}

function buildBarrel(c: Colors): VertexData {
  // Lathe around +Y, then turned so +Y runs along +Z (rx +90 deg maps +Y to +Z).
  const body = lathe(
    [
      [0, -0.345],
      [0.11, -0.345],
      [0.17, -0.335],
      [0.2, -0.315],
      [0.212, -0.29],
      [0.214, -0.2],
      [0.208, 0.06],
      [0.208, 0.09],
      [0.224, 0.1],
      [0.226, 0.15],
      [0.21, 0.165],
      [0.198, 0.18],
      [0.18, 0.6],
      [0.172, 0.78],
      [0.172, 0.86],
      [0.19, 0.89],
      [0.202, 0.925],
      [0.2, 0.955],
      [0.182, 0.975],
      [0.155, MUZZLE_LOCAL],
      [0.128, 0.975],
    ].map(fat),
    18,
  );
  const bore = lathe(
    (
      [
        [0.128, 0.975],
        [0.11, 0.94],
        [0, 0.85],
      ] as [number, number][]
    ).map(fat),
    12,
  );
  const parts = [paint(body, c.greenDark), paint(bore, c.bore)];
  // Trunnions: short stubs riding in the cheeks' capsquares.
  parts.push(paint(rodX(-CHEEK_X, CHEEK_X, 0, 0, 0.055, 8), c.greenDark));
  // Turn the lathe parts (bore + body) to the +Z axis; trunnions are already in place.
  place(parts[0], { rx: Math.PI / 2 });
  place(parts[1], { rx: Math.PI / 2 });
  return mergeParts(parts);
}

function buildBrass(): VertexData {
  const parts: VertexData[] = [];
  // Breech ring.
  parts.push(
    lathe(
      [
        [0.205, -0.305],
        [0.226, -0.3],
        [0.236, -0.28],
        [0.236, -0.235],
        [0.226, -0.215],
        [0.205, -0.21],
      ].map(fat),
      18,
    ),
  );
  // Muzzle band.
  parts.push(
    lathe(
      [
        [0.168, 0.775],
        [0.186, 0.78],
        [0.192, 0.795],
        [0.192, 0.835],
        [0.186, 0.85],
        [0.168, 0.855],
      ].map(fat),
      18,
    ),
  );
  // Cascabel: neck, button knob at the very back (faces the camera).
  parts.push(
    lathe(
      [
        [0.13, -0.335],
        [0.13, -0.35],
        [0.1, -0.37],
        [0.048, -0.395],
        [0.036, -0.42],
        [0.052, -0.445],
        [0.076, -0.475],
        [0.078, -0.505],
        [0.062, -0.535],
        [0.032, -0.552],
        [0, -0.555],
      ].map(fat),
      12,
    ),
  );
  for (const p of parts) place(p, { rx: Math.PI / 2 });
  // Rear sight (a notched leaf on a block) just ahead of the breech ring, front sight bead.
  parts.push(place(roundedBox(0.1, 0.045, 0.07, 0.015, 1), { y: 0.245, z: -0.15 }));
  parts.push(place(roundedBox(0.026, 0.07, 0.022, 0, 0), { x: -0.032, y: 0.29, z: -0.15 }));
  parts.push(place(roundedBox(0.026, 0.07, 0.022, 0, 0), { x: 0.032, y: 0.29, z: -0.15 }));
  parts.push(place(roundedBox(0.024, 0.05, 0.04, 0, 0), { y: 0.245, z: 0.9 }));
  return mergeParts(parts);
}

// One wheel built around +Y (outer face toward +Y), then turned onto the X axis.
function buildWheel(c: Colors): VertexData {
  const parts: VertexData[] = [];
  const W = 0.09; // half width of the tyre
  // Tyre: rounded rubber band.
  parts.push(
    paint(
      lathe(
        [
          [0.37, -W + 0.004],
          [0.4, -W],
          [0.428, -W + 0.012],
          [WHEEL_RADIUS, -0.03],
          [WHEEL_RADIUS, 0.03],
          [0.428, W - 0.012],
          [0.37, W - 0.004],
        ],
        24,
      ),
      c.tyre,
    ),
  );
  // Wooden felloe (rim) inside the tyre.
  parts.push(
    paint(
      lathe(
        [
          [0.372, -0.066],
          [0.312, -0.062],
          [0.312, 0.062],
          [0.372, 0.066],
        ],
        24,
      ),
      c.oakLight,
    ),
  );
  // Spokes: tapered, slightly flattened, 10 of them.
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const spoke = CreateCylinderVertexData({
      height: 0.24,
      diameterTop: 0.04,
      diameterBottom: 0.06,
      tessellation: 5,
      cap: 0,
    });
    // Along +X from r = 0.08 to 0.32 (in the XZ plane), then spun around Y.
    place(spoke, { sz: 0.75, rz: -Math.PI / 2, x: 0.2 });
    place(spoke, { ry: a });
    parts.push(paint(spoke, c.oak));
  }
  // Hub (nave) with an outer cap and axle nut.
  parts.push(
    paint(
      lathe(
        [
          [0.06, -0.1],
          [0.1, -0.06],
          [0.1, 0.04],
          [0.085, 0.075],
          [0.065, 0.085],
          [0.06, 0.125],
        ],
        12,
      ),
      c.oakDark,
    ),
  );
  parts.push(
    paint(
      lathe(
        [
          [0.06, 0.125],
          [0.045, 0.145],
          [0, 0.152],
        ],
        12,
      ),
      c.greenDark,
    ),
  );
  const wheel = mergeParts(parts);
  // +Y outward -> +X: rz = -90 deg maps +Y to +X.
  return place(wheel, { rz: -Math.PI / 2 });
}

function mirrorX(vd: VertexData): VertexData {
  const m = new VertexData();
  m.positions = Float32Array.from(vd.positions!);
  m.normals = Float32Array.from(vd.normals!);
  m.indices = Int32Array.from(vd.indices!);
  if (vd.uvs) m.uvs = Float32Array.from(vd.uvs);
  if (vd.colors) m.colors = Float32Array.from(vd.colors);
  for (let i = 0; i < m.positions.length; i += 3) {
    (m.positions as Float32Array)[i] = -m.positions[i];
    (m.normals as Float32Array)[i] = -m.normals[i];
  }
  const idx = m.indices as Int32Array;
  for (let t = 0; t < idx.length; t += 3) {
    const tmp = idx[t + 1];
    idx[t + 1] = idx[t + 2];
    idx[t + 2] = tmp;
  }
  return m;
}

function clone(vd: VertexData): VertexData {
  const m = new VertexData();
  m.positions = Float32Array.from(vd.positions!);
  m.normals = Float32Array.from(vd.normals!);
  m.indices = Int32Array.from(vd.indices!);
  if (vd.uvs) m.uvs = Float32Array.from(vd.uvs);
  if (vd.colors) m.colors = Float32Array.from(vd.colors);
  return m;
}

// Builds the four parts with AO baked into the vertex colours. Pure (no scene); the
// result is cached per page, so later cannons (every level load) cost nothing.
let cached: CannonGeometry | null = null;
export function buildCannonGeometry(): CannonGeometry {
  if (cached) return cached;
  const c = colors();
  const carriage = buildCarriage(c);
  const barrel = buildBarrel(c);
  const brass = paint(buildBrass(), [1, 1, 1]);
  // AO for the carriage + barrel + brass together, in body space at rest (barrel placed
  // on its trunnions), with the wheels present as occluders (a cheap low-res copy).
  const toBody = { y: BARREL_Y, z: BARREL_Z, rx: BARREL_PITCH };
  const barrelBody = place(clone(barrel), toBody);
  const brassBody = place(clone(brass), toBody);
  const wheelOccluder = lathe(
    [
      [0.1, -0.06],
      [0.44, -0.06],
      [0.44, 0.06],
      [0.1, 0.06],
    ],
    12,
  );
  place(wheelOccluder, { rz: -Math.PI / 2 });
  const wl = place(clone(wheelOccluder), { x: WHEEL_X, y: AXLE_Y });
  const wr = place(mirrorX(wheelOccluder), { x: -WHEEL_X, y: AXLE_Y });
  const groups = [carriage, barrelBody, brassBody, wl, wr];
  const combined = mergeParts(groups.map(clone));
  bakeVertexAO(combined, { samples: 14, maxDist: 0.35, strength: 0.7, maxTriangles: 9000 });
  // Copy the baked colours back (merge keeps part order).
  let off = 0;
  const targets = [carriage, barrel, brass];
  for (let g = 0; g < 3; g++) {
    const n = groups[g].positions!.length / 3;
    targets[g].colors = Float32Array.from(combined.colors!).slice(off * 4, (off + n) * 4);
    off += n;
  }
  // Brass is metal: occlusion mostly darkens its reflections, so keep the bake gentle.
  const bc = brass.colors as Float32Array;
  for (let i = 0; i < bc.length; i++) if (i % 4 !== 3) bc[i] = 1 - (1 - bc[i]) * 0.45;
  // Wheels: self-occlusion only (they spin, so no ground term), then mirrored pair.
  const wheel = bakeVertexAO(buildWheel(c), { samples: 12, maxDist: 0.15, strength: 0.6, ground: false });
  const wheels = mergeParts([place(clone(wheel), { x: WHEEL_X }), place(mirrorX(wheel), { x: -WHEEL_X })]);
  cached = { carriage, barrel, brass, wheels };
  return cached;
}

// ---------- game API ----------
export function createCannon(scene: Scene, look: Look): CannonModel {
  const geo = buildCannonGeometry();
  const plastic = look.material('cannon-plastic', () =>
    plasticMaterial(scene, null, { name: 'cannonPlastic', clearcoat: 0.3, clearcoatRoughness: 0.18, roughness: 0.4 }),
  );
  const brass = look.material('cannon-brass', () => brassMaterial(scene, { name: 'cannonBrass', roughness: 0.3 }));
  const wood = look.material('cannon-wood', () =>
    woodMaterial(scene, null, { name: 'cannonWood', textureScale: 1, normalStrength: 0.3 }),
  );

  const root = new TransformNode('cannon', scene);
  // Recoil tip pivots on the trail spade: tip node sits there, body is offset back.
  const tip = new TransformNode('cannonTip', scene);
  tip.parent = root;
  tip.position.set(0, 0, TRAIL_END_Z);
  const body = new TransformNode('cannonBody', scene);
  body.parent = tip;
  body.position.set(0, 0, -TRAIL_END_Z);

  const carriage = buildMesh(scene, 'cannonCarriage', clone(geo.carriage), plastic);
  carriage.parent = body;

  const barrel = new TransformNode('cannonBarrel', scene);
  barrel.parent = body;
  barrel.position.set(0, BARREL_Y, BARREL_Z);
  barrel.rotation.x = BARREL_PITCH;
  const barrelMesh = buildMesh(scene, 'cannonBarrelMesh', clone(geo.barrel), plastic);
  barrelMesh.parent = barrel;
  const brassMesh = buildMesh(scene, 'cannonBrass', clone(geo.brass), brass);
  brassMesh.parent = barrel;

  const wheels = buildMesh(scene, 'cannonWheels', clone(geo.wheels), wood);
  wheels.parent = body;
  wheels.position.set(0, AXLE_Y, 0);

  const blob = createBlobShadowMesh(scene, 'cannonBlob', 0.38);
  blob.parent = root;
  blob.scaling.set(1.9, 1, 2.3);
  blob.position.z = -0.12;

  const meshes: Mesh[] = [carriage, barrelMesh, brassMesh, wheels];
  for (const m of meshes) look.addShadowCaster(m, 'static');
  look.receiveShadows(carriage);
  look.receiveShadows(wheels);
  look.receiveShadows(barrelMesh);

  const muzzle = new Vector3(
    0,
    BARREL_Y - Math.sin(BARREL_PITCH) * MUZZLE_LOCAL,
    BARREL_Z + Math.cos(BARREL_PITCH) * MUZZLE_LOCAL,
  );

  return {
    root,
    barrel,
    muzzle,
    setRecoil(k: number): void {
      const r = Math.max(0, Math.min(1, k));
      barrel.position.z = BARREL_Z - RECOIL_DIST * r;
      tip.rotation.x = -RECOIL_TIP * r; // negative rx lifts the front (wheels) off the trail spade
    },
    setWheelSpin(rad: number): void {
      wheels.rotation.x = rad;
    },
    dispose(): void {
      for (const m of meshes) look.removeShadowCaster(m);
      root.dispose(false, false); // materials are shared via look.material (disposed by the look)
    },
  };
}

// ---------- preview ----------
export function preview(scene: Scene, look: Look, _opts: PreviewOptions): PreviewResult {
  const cannon = createCannon(scene, look);
  const holder = new TransformNode('cannonPreviewRoot', scene);
  cannon.root.parent = holder;
  let x = 0;
  let spin = 0;
  return {
    root: holder,
    update(time: number): void {
      // Saw-tooth recoil at 6 shots/s: snap back, ease forward.
      const phase = (time * 6) % 1;
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
