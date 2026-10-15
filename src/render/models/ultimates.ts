// Ultimate visuals (Milestone 4): the pieces the three ultimates show in battle.
//
//   marble       - a big glass toy marble (radius MARBLE_RADIUS) with a cat's-eye swirl:
//                  three twisted coloured vanes inside a clear, glossy shell. Cheap: an
//                  alpha-blended clear-coated PBR sphere with strong environment
//                  reflections over an opaque vane mesh (no refraction pass), plus a blob.
//   parachute    - a paper-and-string paratrooper: a scalloped canopy of alternating red
//                  and cream paper gores, four strings and a little green army man hanging
//                  under it. One vertex-coloured mesh, thin-instanced and pooled.
//   flare        - the barrage's toy-cannon muzzle flare: a layered paper starburst
//                  (yellow, orange, a cream heart) drawn unlit; Effects billboards it.
//
// GAME API
//   MARBLE_RADIUS = 1.1
//   createMarble(scene, look): MarbleModel
//     root (move it: x, y = MARBLE_RADIUS * scale, z), spin (rotate .rotation.x to roll),
//     setScale(k), setVisible(on), dispose(). 3 draw calls while visible (vanes, shell,
//     blob). Shell and vanes are 'crowd' shadow casters (dropped on 'low').
//   createParachuteMesh(scene, look): Mesh
//     Thin-instance ready (matrix only, no colour buffer), pivot at the trooper's feet,
//     ~2.9 tall, front +Z. Not a shadow caster (they fly high and fast).
//   flareGeometry(): VertexData   unit starburst in the local XY plane, sRGB vertex colours.
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Matrix } from '@babylonjs/core/Maths/math.vector';
import type { Look } from '../look/index.ts';
import {
  buildMesh,
  createBlobShadowMesh,
  fixWinding,
  glassMaterial,
  lathe,
  lin,
  mergeParts,
  paint,
  place,
  plasticMaterial,
  srgb,
} from '../look/index.ts';
import type { ModelInfo, PreviewOptions, PreviewResult } from '../look/model.ts';
import { sphereVD } from './champion.ts';
import { tube } from './soldier.ts';

export const MARBLE_RADIUS = 1.1;

export const info: ModelInfo = {
  key: 'ultimates',
  title: 'Ultimates: marble, paratroopers, barrage flare',
  instanced: true,
  teams: false,
  side: 'neutral',
  height: 3,
  triangleBudget: 1400,
  gameZ: 12,
  variants: ['all', 'marble', 'parachute', 'flare'],
};

// ---------- marble ----------
export interface MarbleModel {
  root: TransformNode;
  spin: TransformNode; // child of root: the rolling rotation (rotation.x)
  setScale(k: number): void;
  setVisible(on: boolean): void;
  dispose(): void;
}

// Three twisted vanes (a cat's eye), each a strip from the axis out to near the shell,
// turning half a revolution from bottom to top. Vertex colours, double-sided.
function vanesGeometry(r: number): VertexData {
  const cols = [lin('#f07a24'), lin('#2f6fd6'), lin('#f2b630')];
  const ROWS = 10;
  const COLS = 3;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (let v = 0; v < 3; v++) {
    const base = positions.length / 3;
    const c = cols[v];
    for (let i = 0; i <= ROWS; i++) {
      const t = i / ROWS;
      const y = (t * 2 - 1) * r * 0.82;
      const ang = (v / 3) * Math.PI * 2 + t * Math.PI;
      const w = Math.sqrt(Math.max(0, r * r * 0.72 - y * y));
      for (let j = 0; j <= COLS; j++) {
        const d = (j / COLS) * w;
        positions.push(Math.cos(ang) * d, y, Math.sin(ang) * d);
        const k = 0.75 + 0.25 * (j / COLS);
        colors.push(c.r * k, c.g * k, c.b * k, 1);
      }
    }
    for (let i = 0; i < ROWS; i++)
      for (let j = 0; j < COLS; j++) {
        const a = base + i * (COLS + 1) + j;
        indices.push(a, a + 1, a + COLS + 2, a, a + COLS + 2, a + COLS + 1);
      }
  }
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.colors = colors;
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  vd.normals = normals;
  return vd;
}

export function createMarble(scene: Scene, look: Look): MarbleModel {
  const root = new TransformNode('marble', scene);
  const spin = new TransformNode('marbleSpin', scene);
  spin.parent = root;
  const vaneMat = look.material('marble-vanes', () => {
    const m = plasticMaterial(scene, null, { name: 'marbleVanes', roughness: 0.3, backFaceCulling: false });
    m.twoSidedLighting = true;
    return m;
  });
  const shellMat = look.material('marble-glass', () => {
    const m = glassMaterial(scene, '#e4f4f6', { name: 'marbleGlass', alpha: 0.22, envIntensity: 1.8 });
    m.clearCoat.intensity = 1;
    return m;
  });
  const vanes = buildMesh(scene, 'marbleVanes', vanesGeometry(MARBLE_RADIUS), vaneMat);
  vanes.parent = spin;
  const shell = buildMesh(scene, 'marbleShell', sphereVD(MARBLE_RADIUS, 24, 12), shellMat);
  shell.parent = spin;
  // The blob stays on the floor: parented to root, offset down by the root's height.
  const blob = createBlobShadowMesh(scene, 'marbleBlob', 0.5);
  blob.parent = root;
  const meshes: Mesh[] = [vanes, shell];
  for (const m of meshes) {
    m.isPickable = false;
    look.addShadowCaster(m, 'crowd');
  }
  let scale = 1;
  const setScale = (k: number): void => {
    scale = Math.max(0, k);
    spin.scaling.setAll(scale);
    blob.scaling.set(MARBLE_RADIUS * 2.1 * scale, 1, MARBLE_RADIUS * 2.1 * scale);
    blob.position.y = -MARBLE_RADIUS * scale;
  };
  setScale(1);
  return {
    root,
    spin,
    setScale,
    setVisible(on: boolean): void {
      root.setEnabled(on);
    },
    dispose(): void {
      root.dispose(false, false);
    },
  };
}

// ---------- parachute ----------
const CANOPY_Y = 2.1; // canopy rim height above the trooper's feet
const CANOPY_R = 0.95;

function parachuteGeometry(): VertexData {
  const parts: VertexData[] = [];
  // Canopy: a dome with a scalloped rim (each gore sags between its seams).
  const GORES = 8;
  const SEG = GORES * 2;
  const prof: [number, number][] = [
    [CANOPY_R, 0],
    [CANOPY_R * 0.93, 0.28],
    [CANOPY_R * 0.72, 0.55],
    [CANOPY_R * 0.38, 0.74],
    [0, 0.8],
  ];
  const canopy = lathe(prof, SEG);
  const red = lin('#d93a2f');
  const cream = lin('#f4eddc');
  {
    const p = canopy.positions as number[];
    const n = prof.length;
    const colors = new Float32Array((p.length / 3) * 4);
    // lathe vertex order: column s (0..SEG) then profile index i.
    for (let s = 0; s <= SEG; s++)
      for (let i = 0; i < n; i++) {
        const v = s * n + i;
        const gore = Math.floor(s / 2) % 2;
        const c = gore ? red : cream;
        const k = 0.9 + 0.1 * (i / (n - 1));
        colors.set([c.r * k, c.g * k, c.b * k, 1], v * 4);
        // Scallop: seams (even columns) stay out, gore middles (odd) pull in and lift.
        if (i === 0 && s % 2 === 1) {
          p[v * 3] *= 0.9;
          p[v * 3 + 2] *= 0.9;
          p[v * 3 + 1] += 0.08;
        }
      }
    canopy.colors = colors;
    canopy.uvs = null;
  }
  parts.push(place(canopy, { y: CANOPY_Y }));
  // Strings from four seams down to the trooper's shoulders.
  const ink = lin('#3a2c22');
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    parts.push(
      paint(
        tube(
          [
            { p: [Math.cos(a) * CANOPY_R * 0.97, CANOPY_Y + 0.01, Math.sin(a) * CANOPY_R * 0.97], a: 0.012 },
            { p: [Math.cos(a) * 0.08, 1.02, Math.sin(a) * 0.06], a: 0.012 },
          ],
          3,
          [0, 1, 0],
          0,
          0,
        ),
        ink,
      ),
    );
  }
  // The trooper: legs together, arms up to the risers, helmet.
  const g = lin('#4f8f3c');
  const gd = lin('#2f5d27');
  const limb = (a: [number, number, number], b: [number, number, number], r: number) =>
    paint(
      tube(
        [
          { p: a, a: r },
          { p: b, a: r * 0.85 },
        ],
        5,
        [1, 0, 0],
        0.6,
        0.6,
      ),
      g,
    );
  parts.push(limb([-0.06, 0.48, 0], [-0.07, 0.06, 0.02], 0.055));
  parts.push(limb([0.06, 0.48, 0], [0.07, 0.06, -0.02], 0.055));
  parts.push(
    paint(
      tube(
        [
          { p: [0, 0.44, 0], a: 0.11, b: 0.08 },
          { p: [0, 0.7, 0.01], a: 0.12, b: 0.085 },
          { p: [0, 0.84, 0], a: 0.1, b: 0.07 },
        ],
        6,
        [1, 0, 0],
        0.3,
        0.4,
      ),
      g,
    ),
  );
  parts.push(limb([-0.11, 0.8, 0], [-0.1, 1.06, 0.02], 0.045));
  parts.push(limb([0.11, 0.8, 0], [0.1, 1.06, 0.02], 0.045));
  parts.push(paint(place(sphereVD(0.075, 6, 3), { y: 0.93, z: 0.01 }), lin('#5f9a48')));
  const helmet = lathe(
    [
      [0.13, 0],
      [0.12, 0.03],
      [0.09, 0.09],
      [0, 0.12],
    ],
    8,
  );
  helmet.uvs = null;
  parts.push(paint(place(helmet, { y: 0.95 }), gd));
  return fixWinding(mergeParts(parts));
}

export function createParachuteMesh(scene: Scene, look: Look): Mesh {
  const mat = look.material('parachute-paper', () => {
    const m = plasticMaterial(scene, null, { name: 'parachutePaper', roughness: 0.78, backFaceCulling: false });
    m.twoSidedLighting = true;
    return m;
  });
  const mesh = buildMesh(scene, 'parachutes', parachuteGeometry(), mat);
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.doNotSyncBoundingInfo = true;
  mesh.receiveShadows = false;
  return mesh;
}

// ---------- barrage flare ----------
// A unit (radius 1) starburst in the local XY plane facing -Z (towards a billboard's
// viewer): a 12-point yellow burst, a smaller offset orange one and a cream centre, each
// a hair in front of the last. Colours are sRGB for the unlit sprite material.
export function flareGeometry(): VertexData {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const layer = (points: number, ro: number, ri: number, z: number, rot: number, hex: string, edge: number): void => {
    const c = srgb(hex);
    const centre = positions.length / 3;
    positions.push(0, 0, z);
    colors.push(c.r, c.g, c.b, 1);
    for (let i = 0; i < points * 2; i++) {
      const a = rot + (i / (points * 2)) * Math.PI * 2;
      const r = i % 2 === 0 ? ro : ri;
      positions.push(Math.cos(a) * r, Math.sin(a) * r, z);
      colors.push(c.r * edge, c.g * edge, c.b * edge, 1);
    }
    for (let i = 0; i < points * 2; i++) indices.push(centre, centre + 1 + i, centre + 1 + ((i + 1) % (points * 2)));
  };
  layer(12, 1, 0.56, 0, 0, '#ffd34d', 0.92);
  layer(9, 0.72, 0.42, -0.01, 0.3, '#f07a24', 0.9);
  layer(7, 0.36, 0.24, -0.02, 0.1, '#fff1c9', 1);
  const vd = new VertexData();
  vd.positions = positions;
  vd.colors = colors;
  vd.indices = indices;
  vd.normals = positions.map((_, i) => (i % 3 === 2 ? -1 : 0));
  return vd;
}

// ---------- preview ----------
// The marble rolling to and fro across the rug, a stack of parachutes at different stages
// of the fall, and the flare drawn flat (the game billboards it).
export function preview(scene: Scene, look: Look, opts: PreviewOptions): PreviewResult {
  const root = new TransformNode('ultimatesRoot', scene);
  const v = opts.variant ?? 'all';
  const marble = v === 'all' || v === 'marble' ? createMarble(scene, look) : null;
  if (marble) {
    marble.root.parent = root;
    marble.root.position.set(v === 'all' ? -2.5 : 0, MARBLE_RADIUS, 0);
  }
  let chutes: Mesh | null = null;
  const m = new Float32Array(4 * 16);
  const tmp = new Matrix();
  const writeChutes = (time: number): void => {
    for (let i = 0; i < 4; i++) {
      const y = ((i / 4 + time * 0.25) % 1) * 3;
      Matrix.RotationYawPitchRollToRef(i, 0, Math.sin(time * 2 + i) * 0.15, tmp);
      tmp.setTranslationFromFloats((i - 1.5) * 1.1 + (v === 'all' ? 1.5 : 0), 3 - y, i % 2);
      tmp.copyToArray(m, i * 16);
    }
  };
  if (v === 'all' || v === 'parachute') {
    chutes = createParachuteMesh(scene, look);
    chutes.parent = root;
    writeChutes(0);
    chutes.thinInstanceSetBuffer('matrix', m, 16, false);
  }
  if (v === 'all' || v === 'flare') {
    const flare = buildMesh(scene, 'flarePreview', flareGeometry(), null);
    const mat = plasticMaterial(scene, null, { name: 'flarePreviewMat', emissive: '#ffffff', backFaceCulling: false });
    mat.disableLighting = true;
    flare.material = mat;
    flare.parent = root;
    flare.position.set(v === 'all' ? 4.5 : 0, 1.6, 0);
    flare.rotation.y = Math.PI;
    flare.onDisposeObservable.addOnce(() => mat.dispose());
  }
  return {
    root,
    update(time) {
      if (marble) {
        const x = Math.sin(time * 0.7) * 1.2 + (v === 'all' ? -2.5 : 0);
        marble.spin.rotation.z = -(x / MARBLE_RADIUS);
        marble.root.position.x = x;
      }
      if (chutes) {
        writeChutes(time);
        chutes.thinInstanceBufferUpdated('matrix');
      }
    },
    dispose() {
      marble?.dispose();
      root.dispose();
    },
  };
}
