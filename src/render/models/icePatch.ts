// Ice patches (World 2): glossy sheets of clear ice lying on the lane where units slide
// (LevelDef.ice, contracts IcePatchDef). Each patch is a thin slab with a softly wavy,
// rounded outline: a frosted white rim that bevels down to the runner, clear blue-tinted
// ice inside with faint scratches and hairline cracks (a 256 px procedural texture), and
// a mirror-like clearcoat that picks up the room's reflections, so it reads as wet ice
// from the camera without hiding the units' contact. Its top sits at ICE_Y, under the
// look's blob shadows (BLOB_Y) and over the runner, and it draws first among the
// transparent things (alphaIndex), so blob shadows and effects lie on top of it.
//
// GAME API (level.ts):
//   const ice = createIcePatches(scene, look, level.ice ?? []);  // null when there are none
//   ice.root.parent = levelRoot; ... ice.dispose();
// All patches of a level share one mesh: one draw call. Receives shadows, casts none.
// Shared with models/iceWall.ts: iceSurfaceTexture() (materials under 'ice-*').
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Constants } from '@babylonjs/core/Engines/constants';
import type { IcePatchDef } from '../../contracts.ts';
import type { Look } from '../look/index.ts';
import { buildMesh, lin } from '../look/index.ts';
import type { ModelInfo, PreviewResult } from '../look/model.ts';
import { Geo, noise, rng, tfbm } from './environment.ts';

export const info: ModelInfo = {
  key: 'icePatch',
  title: 'Ice patches on the lane',
  instanced: false,
  teams: false,
  side: 'neutral',
  height: 0.2,
  triangleBudget: 3000,
  gameZ: 22,
  variants: ['patches'],
};

export const ICE_Y = 0.0105; // top of a patch: above the runner (0.006), under blob shadows (0.012)
const RIM = 0.28; // frosted rim width
const CORNER = 0.7;

// Scratches, hairline cracks and a few trapped bubbles over a faint frost mottle. RGB is
// near white (the material tints it); alpha carries how opaque the ice is there.
export function iceSurfaceTexture(scene: Scene, look: Look): Texture {
  const owner = look.material('ice-surface-holder', () => {
    const S = 256;
    const a = new Float32Array(S * S);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) a[y * S + x] = 0.55 + 0.25 * tfbm(x / S, y / S, 6, 6, 3, 211);
    const r = rng(61);
    const splat = (px: number, py: number, k: number): void => {
      const i = (((Math.round(py) % S) + S) % S) * S + (((Math.round(px) % S) + S) % S);
      if (k > a[i]) a[i] = k;
    };
    // Skate-like scratches: long, nearly straight, faint.
    for (let s = 0; s < 26; s++) {
      let x = r() * S;
      let y = r() * S;
      const ang = r() * Math.PI;
      const len = 30 + r() * 90;
      for (let t = 0; t < len; t++) {
        x += Math.cos(ang);
        y += Math.sin(ang) + (r() - 0.5) * 0.3;
        splat(x, y, 0.8);
      }
    }
    // Hairline cracks: short jagged branching walks.
    for (let c = 0; c < 9; c++) {
      const walk = (x0: number, y0: number, ang0: number, n: number, depth: number): void => {
        let x = x0;
        let y = y0;
        let ang = ang0;
        for (let t = 0; t < n; t++) {
          ang += (r() - 0.5) * 0.7;
          x += Math.cos(ang) * 1.2;
          y += Math.sin(ang) * 1.2;
          splat(x, y, 0.97);
          splat(x + 1, y, 0.85);
          if (depth < 2 && r() < 0.04) walk(x, y, ang + (r() < 0.5 ? 0.9 : -0.9), n * 0.5, depth + 1);
        }
      };
      walk(r() * S, r() * S, r() * Math.PI * 2, 40 + r() * 40, 0);
    }
    // Trapped bubbles.
    for (let bub = 0; bub < 40; bub++) {
      const cx = r() * S;
      const cy = r() * S;
      const rad = 1 + r() * 2.2;
      for (let dy = -3; dy <= 3; dy++)
        for (let dx = -3; dx <= 3; dx++) {
          const d = Math.hypot(dx, dy);
          if (d <= rad) splat(cx + dx, cy + dy, d > rad - 0.9 ? 0.95 : 0.7);
        }
    }
    const data = new Uint8Array(S * S * 4);
    for (let i = 0; i < S * S; i++) {
      const k = Math.round((0.86 + 0.14 * a[i]) * 255);
      data[i * 4] = k;
      data[i * 4 + 1] = k;
      data[i * 4 + 2] = 255;
      data[i * 4 + 3] = Math.round(Math.min(1, a[i]) * 255);
    }
    const t = RawTexture.CreateRGBATexture(data, S, S, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
    t.name = 'ice-surface';
    t.wrapU = Texture.WRAP_ADDRESSMODE;
    t.wrapV = Texture.WRAP_ADDRESSMODE;
    t.anisotropicFilteringLevel = 4;
    t.hasAlpha = true;
    // A placeholder material keeps the texture alive in the look's cache (released with 'ice-').
    const holder = new PBRMaterial('ice-surface-holder', scene);
    holder.albedoTexture = t;
    return holder;
  });
  return owner.albedoTexture as Texture;
}

function patchMaterial(scene: Scene, look: Look): PBRMaterial {
  return look.material('ice-patch', () => {
    const m = new PBRMaterial('ice-patch', scene);
    m.albedoColor = lin('#bfe2f4');
    m.albedoTexture = iceSurfaceTexture(scene, look);
    m.useAlphaFromAlbedoTexture = true;
    m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
    m.alpha = 1;
    m.metallic = 0;
    m.roughness = 0.08;
    m.clearCoat.isEnabled = true;
    m.clearCoat.intensity = 1;
    m.clearCoat.roughness = 0.03;
    m.environmentIntensity = 1.9;
    m.useRadianceOverAlpha = true;
    m.useSpecularOverAlpha = true;
    m.disableDepthWrite = true;
    m.zOffset = -1;
    m.alphaMode = Constants.ALPHA_COMBINE;
    return m;
  });
}

export interface IcePatchModel {
  root: TransformNode;
  mesh: Mesh;
  dispose(): void;
}

// One patch into the accumulator: rows along z, each with a frosted rim column on both
// sides and clear columns between; the outline wobbles a little and rounds its corners.
function addPatch(g: Geo, p: IcePatchDef, seed: number): void {
  const z0 = p.z;
  const z1 = p.z + p.length;
  const hw = p.width / 2;
  const R = Math.min(CORNER, hw * 0.6, p.length * 0.3);
  const clear = lin('#c8e6f5');
  const frost = lin('#f2f7fb');
  const rows: number[] = [];
  const nz = Math.max(2, Math.ceil(p.length / 0.45));
  for (let k = 0; k <= nz; k++) rows.push(z0 + (k / nz) * p.length);
  const nInner = Math.max(2, Math.ceil((p.width - 2 * RIM) / 0.7));
  const grid: number[][] = [];
  for (const z of rows) {
    const dz = z < z0 + R ? z0 + R - z : z > z1 - R ? z - (z1 - R) : 0;
    const round = R - Math.sqrt(Math.max(0, R * R - dz * dz));
    const wobL = 0.12 * (noise(z / 1.3, 1, seed) - 0.5);
    const wobR = 0.12 * (noise(z / 1.3, 5, seed) - 0.5);
    const xl = p.x - hw + round + wobL;
    const xr = p.x + hw - round + wobR;
    const span = Math.max(0.05, xr - xl);
    const rim = Math.min(RIM, span * 0.3);
    const endFrost = Math.min(1, Math.min(z - z0, z1 - z) / 0.4);
    const xs = [xl, xl + rim * 0.4, xl + rim];
    for (let i = 1; i < nInner; i++) xs.push(xl + rim + ((span - 2 * rim) * i) / nInner);
    xs.push(xr - rim, xr - rim * 0.4, xr);
    const row: number[] = [];
    xs.forEach((x, i) => {
      const edge = i === 0 || i === xs.length - 1;
      const nearEdge = i === 1 || i === xs.length - 2;
      const rimish = edge || nearEdge || endFrost < 1;
      const y = edge || (endFrost === 0 && !nearEdge) ? ICE_Y - 0.004 : ICE_Y;
      // Frost along the rim, patchy frost blooms inside, clearer toward the middle.
      const bloom = Math.max(0, noise(x / 1.6, z / 1.4, seed + 7) - 0.62) * 1.6;
      const f = edge ? 1 : nearEdge ? 0.75 : Math.max(bloom, 1 - endFrost);
      const c = clear.scale(1 - f).add(frost.scale(f));
      const alpha = rimish ? 0.62 + 0.3 * f : 0.34 + 0.4 * f;
      const nx = edge ? (i === 0 ? -0.5 : 0.5) : 0;
      const id = g.vert(x, y, z, nx, 1, 0, x / 3.1, z / 3.1, [c.r, c.g, c.b]);
      g.col[id * 4 + 3] = alpha;
      row.push(id);
    });
    grid.push(row);
  }
  for (let j = 0; j < grid.length - 1; j++)
    for (let i = 0; i < grid[j].length - 1; i++) g.quad(grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]);
}

export function createIcePatches(scene: Scene, look: Look, patches: readonly IcePatchDef[]): IcePatchModel | null {
  if (patches.length === 0) return null;
  const g = new Geo();
  patches.forEach((p, i) => addPatch(g, p, 300 + i * 17));
  const root = new TransformNode('icePatches', scene);
  const mesh = buildMesh(scene, 'icePatches', g.data(), patchMaterial(scene, look));
  mesh.hasVertexAlpha = true;
  mesh.alphaIndex = 0; // before blob shadows, effects and glass
  mesh.parent = root;
  look.receiveShadows(mesh);
  return {
    root,
    mesh,
    dispose() {
      root.dispose(false, false);
    },
  };
}

// ---------- preview ----------
export function preview(scene: Scene, look: Look): PreviewResult {
  const root = new TransformNode('icePatchPreview', scene);
  const old = look.theme;
  look.setTheme('freezer');
  const ice = createIcePatches(scene, look, [
    { x: 0, z: -3, width: 7, length: 6 },
    { x: -2.5, z: 4, width: 4, length: 3 },
  ])!;
  ice.root.parent = root;
  return {
    root,
    dispose() {
      ice.dispose();
      root.dispose();
      look.setTheme(old);
    },
  };
}
