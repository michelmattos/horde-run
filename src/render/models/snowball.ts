// Rolling snowball (World 2, variant 5: the Snowball Launcher's shot). A lumpy ball of
// packed snow with a glittering crust (a glossy clear coat over fine surface bumps, so it
// sparkles as it turns) and a few army men it has rolled up on the way: a pair of green
// boots and a helmet poking out of the snow, which also make the roll easy to read.
//
// One mesh: its own 'snowball-snow' material (white albedo, thin-instance 'color'),
// cool-blue hollows and the green bits in LINEAR vertex colours.
//
// GAME API
//   createSnowballMesh(scene, look): Mesh
//     Synchronous, geometry cached. A UNIT sphere centred on the origin (radius 1): the
//     instance scale is the sim radius (snowballScale() in crowdLogic.ts) and the centre
//     sits at y = radius. Roll it with pitch (rotation about x) from the distance travelled
//     (RollTracker / snowballRoll in crowdLogic.ts). Thin-instance ready ('matrix' +
//     'color', white x shade), not pickable, alwaysSelectAsActiveMesh,
//     doNotSyncBoundingInfo, 'crowd' shadow caster and receiver.
//   Triangles: ~360.
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Look } from '../look/index.ts';
import { buildMesh, cloneVD, lin, mergeParts, paint, place, plasticMaterial } from '../look/index.ts';
import type { ModelInfo, PreviewOptions, PreviewResult } from '../look/model.ts';
import { RollTracker, snowballScale } from '../crowdLogic.ts';
import { writeTRS } from '../fxLogic.ts';
import { sphereVD } from './champion.ts';
import { tube } from './soldier.ts';
import { crowdMesh } from './snowman.ts';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';

export const info: ModelInfo = {
  key: 'snowball',
  title: 'Rolling snowball',
  instanced: true,
  teams: false,
  side: 'player',
  height: 1.4,
  triangleBudget: 700,
  gameZ: 18,
};

// Lumps of packed snow: a smooth bumpy field over the sphere (direction -> radius offset).
function lump(x: number, y: number, z: number): number {
  return (
    0.075 * Math.sin(4.1 * x + 1.3) * Math.sin(3.7 * y + 0.4) * Math.sin(4.4 * z + 2.2) +
    0.03 * Math.sin(7.3 * x + 5.1 * y + 0.9) +
    0.025 * Math.sin(6.1 * z - 4.7 * x + 2.6)
  );
}

function ball(): VertexData {
  const vd = sphereVD(1, 20, 12);
  vd.uvs = null;
  const p = vd.positions as number[];
  const nr = vd.normals as number[];
  const snow = lin('#edf0f2');
  const hollow = lin('#c9d8e6');
  const colors = new Float32Array((p.length / 3) * 4);
  for (let i = 0; i < p.length; i += 3) {
    const l = Math.hypot(p[i], p[i + 1], p[i + 2]) || 1;
    const dx = p[i] / l,
      dy = p[i + 1] / l,
      dz = p[i + 2] / l;
    const h = lump(dx, dy, dz);
    const k = 1 + h;
    p[i] = dx * k;
    p[i + 1] = dy * k;
    p[i + 2] = dz * k;
    // Tilt the normal against the lump's slope (finite difference along the field).
    const e = 0.05;
    const gx = (lump(dx + e, dy, dz) - h) / e;
    const gy = (lump(dx, dy + e, dz) - h) / e;
    const gz = (lump(dx, dy, dz + e) - h) / e;
    const d = gx * dx + gy * dy + gz * dz;
    let nx = dx - (gx - d * dx),
      ny = dy - (gy - d * dy),
      nz = dz - (gz - d * dz);
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    nr[i] = nx;
    nr[i + 1] = ny;
    nr[i + 2] = nz;
    const t = Math.min(1, Math.max(0, (0.02 - h) / 0.08));
    const v = (i / 3) * 4;
    colors[v] = snow.r + (hollow.r - snow.r) * t;
    colors[v + 1] = snow.g + (hollow.g - snow.g) * t;
    colors[v + 2] = snow.b + (hollow.b - snow.b) * t;
    colors[v + 3] = 1;
  }
  vd.colors = colors;
  return vd;
}

// Bits of rolled-up army men poking out of the snow (green plastic, vertex coloured).
function rolledUp(): VertexData[] {
  const green = lin('green');
  const greenDark = lin('greenDark');
  const p: VertexData[] = [];
  // A pair of boots and legs sticking out of one side.
  for (const s of [-1, 1])
    p.push(
      paint(
        tube(
          [
            { p: [0.82 + s * 0.02, 0.2, s * 0.09], a: 0.07 },
            { p: [1.12, 0.32, s * 0.12], a: 0.06 },
            { p: [1.2, 0.36, s * 0.13], a: 0.075, b: 0.06 },
          ],
          5,
          [0, 1, 0],
          0,
          0.6,
        ),
        greenDark,
      ),
    );
  // A helmet dome on the far side.
  const helmet = sphereVD(0.17, 8, 4);
  helmet.uvs = null;
  p.push(paint(place(helmet, { x: -0.55, y: 0.66, z: -0.52, sy: 0.75, rx: 0.7, rz: 0.6 }), green));
  // A rifle barrel half buried near the top.
  p.push(
    paint(
      tube(
        [
          { p: [0.15, 0.93, 0.25], a: 0.03 },
          { p: [0.3, 1.12, 0.52], a: 0.026 },
        ],
        4,
        [1, 0, 0],
        0,
        0.6,
      ),
      greenDark,
    ),
  );
  return p;
}

let cached: VertexData | null = null;

function geometry(): VertexData {
  cached ??= mergeParts([ball(), ...rolledUp()]);
  return cached;
}

export function snowballTriangles(): number {
  return (geometry().indices as ArrayLike<number>).length / 3;
}

export function createSnowballMesh(scene: Scene, look: Look): Mesh {
  const mat = look.material('snowball-snow', () =>
    plasticMaterial(scene, null, {
      name: 'snowballSnow',
      instanceColor: true,
      roughness: 0.72,
      clearcoat: 0.4,
      clearcoatRoughness: 0.2,
      texture: 'plastic',
      textureScale: 4,
      normalStrength: 1,
    }),
  );
  return crowdMesh(buildMesh(scene, 'snowball', cloneVD(geometry()), mat), look);
}

// ---------- preview ----------
// Three snowballs of growing size rolling back and forth up the lane.
export function preview(scene: Scene, look: Look, _opts: PreviewOptions): PreviewResult {
  const root = new TransformNode('snowballRoot', scene);
  const mesh = createSnowballMesh(scene, look);
  mesh.parent = root;
  const balls = [
    { x: -1.6, r: 0.35 },
    { x: 0, r: 0.6 },
    { x: 1.9, r: 0.9 },
  ];
  const m = new Float32Array(balls.length * 16);
  const colors = new Float32Array(balls.length * 4).fill(1);
  const roll = new RollTracker();
  const write = (time: number): void => {
    balls.forEach((b, i) => {
      const z = Math.sin(time * 0.8 + i) * 1.2;
      const s = snowballScale(b.r);
      roll.step(i, b.x, z, b.r);
      writeTRS(m, i * 16, b.x, s, z, s, s, s, 0, roll.pitch, roll.roll);
    });
  };
  write(0);
  mesh.thinInstanceSetBuffer('matrix', m, 16, false);
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
