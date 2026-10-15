// Ice walls (World 2 chokepoints, contracts IceWallDef): unbreakable ramparts of chunky
// ice blocks narrowing the lane. Each wall is two staggered courses of big rough-hewn ice
// blocks (bevelled, their faces knocked a little uneven so the highlights wobble) filling
// the wall's width x depth footprint, about 1.45 tall: glossy see-through blue ice with
// frosted white edges and corners, a darker cold core low down, scratches and trapped
// bubbles from the shared ice texture. Snow sits on top in soft lumpy caps, and a few
// broken ice chips lie at the foot. Never damaged; a hit only puffs (effects).
//
// GAME API (level.ts):
//   const walls = createIceWalls(scene, look, level.iceWalls ?? []);  // null when none
//   walls.root.parent = levelRoot; ... walls.dispose();
// Every wall of a level shares two meshes (ice: alpha-blended with depth write, so the
// blocks sort cleanly; snow: opaque): two draw calls plus their shadow passes. Ice and
// snow both cast and receive shadows. Materials under 'ice-*'.
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type { IceWallDef } from '../../contracts.ts';
import type { Look } from '../look/index.ts';
import { buildMesh, lathe, lin, mergeParts, paint, place, plasticMaterial, roundedBox } from '../look/index.ts';
import type { ModelInfo, PreviewResult } from '../look/model.ts';
import { noise, rng } from './environment.ts';
import { iceSurfaceTexture } from './icePatch.ts';

export const info: ModelInfo = {
  key: 'iceWall',
  title: 'Ice wall: chunky ice-block rampart',
  instanced: false,
  teams: false,
  side: 'neutral',
  height: 1.6,
  triangleBudget: 6000,
  gameZ: 30,
  variants: ['walls'],
};

export const ICE_WALL_HEIGHT = 1.45;

function iceMaterial(scene: Scene, look: Look): PBRMaterial {
  return look.material('ice-wall', () => {
    const m = new PBRMaterial('ice-wall', scene);
    m.albedoColor = lin('#a9d6ee');
    m.albedoTexture = iceSurfaceTexture(scene, look);
    m.alpha = 0.8;
    m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
    m.forceDepthWrite = true;
    m.metallic = 0;
    m.roughness = 0.1;
    m.clearCoat.isEnabled = true;
    m.clearCoat.intensity = 1;
    m.clearCoat.roughness = 0.04;
    m.environmentIntensity = 1.7;
    m.useRadianceOverAlpha = true;
    m.useSpecularOverAlpha = true;
    m.indexOfRefraction = 1.31;
    return m;
  });
}

function snowMaterial(scene: Scene, look: Look): PBRMaterial {
  return look.material('ice-snow', () =>
    plasticMaterial(scene, null, {
      name: 'ice-snow',
      roughness: 0.78,
      texture: 'paper',
      normalStrength: 0.35,
      envIntensity: 0.8,
    }),
  );
}

// A rough-hewn ice block: a bevelled box whose faces bulge and dip a little, frosted
// white along the edges, colder and darker toward its bottom.
function iceBlock(w: number, h: number, d: number, seed: number): VertexData {
  const vd = roundedBox(w, h, d, Math.min(w, h, d) * 0.14, 2);
  const p = vd.positions as number[];
  const hx = w / 2;
  const hy = h / 2;
  const hz = d / 2;
  for (let i = 0; i < p.length; i += 3) {
    const n = noise(p[i] * 2.3 + seed, p[i + 1] * 2.1, seed) - 0.5;
    const n2 = noise(p[i + 2] * 2.2, p[i] * 1.7 - seed, seed + 3) - 0.5;
    p[i] += n * 0.06;
    p[i + 1] += n2 * 0.05;
    p[i + 2] += (n + n2) * 0.04;
  }
  vd.positions = p;
  const normals: number[] = [];
  VertexData.ComputeNormals(p, vd.indices as number[], normals);
  vd.normals = normals;
  const c = new Float32Array((p.length / 3) * 4);
  const frost = lin('#f1f7fb');
  const core = lin('#9fcfe8');
  const deep = lin('#6fa9cc');
  for (let i = 0; i < p.length / 3; i++) {
    const x = Math.abs(p[i * 3]) / hx;
    const y = p[i * 3 + 1] / hy;
    const z = Math.abs(p[i * 3 + 2]) / hz;
    const edges = (x > 0.82 ? 1 : 0) + (Math.abs(y) > 0.8 ? 1 : 0) + (z > 0.8 ? 1 : 0);
    const f = edges >= 2 ? 0.85 : edges === 1 ? 0.25 : 0;
    const low = Math.max(0, -y) * 0.6;
    const base = core.scale(1 - low).add(deep.scale(low));
    const col = base.scale(1 - f).add(frost.scale(f));
    c.set([col.r, col.g, col.b, 1], i * 4);
  }
  vd.colors = c;
  return vd;
}

// A lumpy snow cap on top of a block: a squashed dome sagging over the edges.
function snowCap(w: number, d: number, seed: number): VertexData {
  const prof: [number, number][] = [
    [0, 0.2],
    [0.35, 0.18],
    [0.7, 0.12],
    [0.92, 0.06],
    [1.0, 0.0],
    [0.98, -0.04],
  ];
  const vd = lathe(prof, 14);
  const p = vd.positions as number[];
  for (let i = 0; i < p.length; i += 3) {
    const bump = 1 + 0.18 * (noise(p[i] * 3 + seed, p[i + 2] * 3, seed + 9) - 0.5);
    p[i] *= (w / 2) * 0.96;
    p[i + 2] *= (d / 2) * 0.96;
    p[i + 1] *= bump;
  }
  vd.positions = p;
  const normals: number[] = [];
  VertexData.ComputeNormals(p, vd.indices as number[], normals);
  vd.normals = normals;
  return paint(vd, lin('#eef3f7'));
}

export interface IceWallModel {
  root: TransformNode;
  meshes: Mesh[];
  dispose(): void;
}

function wallParts(def: IceWallDef, seed: number): { ice: VertexData[]; snow: VertexData[] } {
  const r = rng(seed);
  const ice: VertexData[] = [];
  const snow: VertexData[] = [];
  const W = def.width;
  const D = def.depth;
  const courseH = ICE_WALL_HEIGHT / 2;
  for (let course = 0; course < 2; course++) {
    const n = Math.max(1, Math.round(W / (course === 0 ? 1.15 : 1.25)));
    const bw = W / n;
    const off = course === 1 && n > 1 ? bw * 0.5 * (r() < 0.5 ? 1 : -1) : 0;
    for (let i = 0; i < n; i++) {
      let x0 = -W / 2 + i * bw + off;
      let x1 = x0 + bw;
      x0 = Math.max(-W / 2, x0);
      x1 = Math.min(W / 2, x1);
      if (x1 - x0 < 0.35) continue;
      const w = (x1 - x0) * 0.97;
      const h = courseH * (0.95 + r() * 0.08);
      const d = D * (0.9 + r() * 0.08);
      const block = iceBlock(w, h, d, seed + course * 31 + i * 7);
      place(block, {
        x: def.x + (x0 + x1) / 2 + (r() - 0.5) * 0.05,
        y: h / 2 + course * courseH * 0.99,
        z: def.z + (r() - 0.5) * 0.08,
        ry: (r() - 0.5) * 0.1,
        rz: (r() - 0.5) * 0.04,
      });
      ice.push(block);
      if (course === 1) {
        const cap = snowCap(w * (0.75 + r() * 0.2), d * 0.9, seed + i);
        place(cap, {
          x: def.x + (x0 + x1) / 2 + (r() - 0.5) * 0.15,
          y: course * courseH + h - 0.02,
          z: def.z + (r() - 0.5) * 0.1,
        });
        snow.push(cap);
      }
    }
  }
  // Broken chips at the foot, mostly on the camera side.
  const chips = Math.round(W * 1.2);
  for (let i = 0; i < chips; i++) {
    const s = 0.12 + r() * 0.16;
    const chip = iceBlock(s * 1.3, s, s, seed + 100 + i);
    place(chip, {
      x: def.x + (r() - 0.5) * W,
      y: s / 2 - 0.02,
      z: def.z - D / 2 - 0.15 - r() * 0.35,
      ry: r() * 3,
      rz: (r() - 0.5) * 0.6,
    });
    ice.push(chip);
  }
  // A drift of snow banked against the foot of the wall.
  const drift = snowCap(W + 0.5, D + 0.7, seed + 50);
  place(drift, { x: def.x, y: -0.05, z: def.z, sy: 0.9 });
  snow.push(drift);
  return { ice, snow };
}

export function createIceWalls(scene: Scene, look: Look, walls: readonly IceWallDef[]): IceWallModel | null {
  if (walls.length === 0) return null;
  const ice: VertexData[] = [];
  const snow: VertexData[] = [];
  walls.forEach((w, i) => {
    const parts = wallParts(w, 7000 + i * 131);
    ice.push(...parts.ice);
    snow.push(...parts.snow);
  });
  const root = new TransformNode('iceWalls', scene);
  const iceMesh = buildMesh(scene, 'iceWallBlocks', mergeParts(ice), iceMaterial(scene, look));
  const snowMesh = buildMesh(scene, 'iceWallSnow', mergeParts(snow), snowMaterial(scene, look));
  iceMesh.alphaIndex = 2;
  for (const m of [iceMesh, snowMesh]) {
    m.parent = root;
    look.addShadowCaster(m);
    look.receiveShadows(m);
  }
  return {
    root,
    meshes: [iceMesh, snowMesh],
    dispose() {
      root.dispose(false, false);
    },
  };
}

// ---------- preview ----------
export function preview(scene: Scene, look: Look): PreviewResult {
  const root = new TransformNode('iceWallPreview', scene);
  const old = look.theme;
  look.setTheme('freezer');
  const walls = createIceWalls(scene, look, [
    { id: 'a', x: -3, z: 0, width: 4, depth: 1.2 },
    { id: 'b', x: 3.2, z: 0, width: 2.4, depth: 1.2 },
  ])!;
  walls.root.parent = root;
  return {
    root,
    dispose() {
      walls.dispose();
      root.dispose();
      look.setTheme(old);
    },
  };
}
