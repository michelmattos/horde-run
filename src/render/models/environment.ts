// Environment: the Bedroom Floor that every World 1 level is played on.
//
//   - FLOOR: varnished oak floorboards (1.4 wide) running along the lane (+Z), each board
//     a bevelled slab so the seams catch the sun, with staggered end joints, per-board tone
//     and grain offset (no visible repeat), a low-frequency tone drift and baked contact
//     darkening at the baseboard and under the bed. Real CC0 oak (ambientCG Wood048:
//     albedo + normal + roughness) under a satin clearcoat varnish. One draw call.
//   - RUG (the lane): a worn indigo wool rug, lane.width wide plus a cream stitched border
//     (0.4) with rounded corners, a thin inner frame line barely darker than the field, and
//     soft feathered darker cross bands every 10 units (alternating strengths). The wool is
//     a 512 px noise pile repeating every 6.4 units (tufts ~0.18 units, heather blotches,
//     fibres; irregular, so it never moires at grazing angles) plus low-frequency mottling,
//     abrash and a worn centre in vertex colours, and an indigo velvet sheen. Flat: the
//     body's top is at y = 0.006, the border at <= 0.011, below the look's blob shadows
//     (0.012), so units at the edge are never hidden. Two draw calls (body, border).
//   - ROOM: beyond the enemy base the painted baseboard and pale striped wallpaper, and to
//     the right a low bed: a pleated pale-rose skirt topped by a quilted cream duvet that
//     droops over it, with the wall visible above. Three draw calls.
//   - SUNLIGHT: a soft warm window-shaped light pool (multiplicative decal, static) thrown
//     across the floor and the left part of the rug mid-lane, along KEY_DIRECTION. One call.
//   Total: 7 draw calls, ~18k triangles, 3 downloaded JPEGs (0.43 MB) plus small
//   procedural textures. Nothing is animated per frame.
//
// GAME API (integration replaces the ground, rug, stripes and borders of src/render/level.ts):
//
//   const env = createEnvironment(scene, look, { laneWidth, laneLength, zMin: -3, zMax: L + 4 });
//   scene.clearColor = env.clearColor;  // optional: the wall tone, for anything the room misses
//   ...
//   env.dispose();                      // on level unload (materials stay in the look's cache)
//
//   - Built in LANE coordinates: x = 0 is the lane centre, z = 0 the player base line, the
//     enemy base at z = laneLength. Parent it to the level root without any rotation or
//     offset. (info.side is 'neutral' for the preview harness only; do NOT apply the
//     neutral yaw PI to the environment.)
//   - The floor's top is at y = FLOOR_Y (-0.02): props standing at y = 0 sit 0.02 above it,
//     which is invisible. The rug's top is at y = RUG_Y (0.006).
//   - Every surface already receives shadows (look.receiveShadows). Nothing casts.
//     Integration still calls look.fitShadows per level as before.
//   - The floor renders at once with plain vertex-coloured boards; the oak textures from
//     public/models/environment-oak-*.jpg are attached as they arrive. env.ready resolves
//     when all three have loaded (or failed): await it before revealing a level if you want
//     the first frame fully dressed. Add the three files to the SHELL list in sw.js.
//   - Materials are shared through look.material('env-...'), so rebuilding per level reuses
//     them and their textures; env.dispose() disposes only meshes.
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Look } from '../look/index.ts';
import {
  HEX,
  KEY_DIRECTION,
  assetUrl,
  bakeVertexAO,
  buildMesh,
  fixWinding,
  fabricMaterial,
  lathe,
  lin,
  paperMaterial,
  plasticMaterial,
  srgb,
  teamColor,
  woodMaterial,
} from '../look/index.ts';
import type { ModelInfo, PreviewOptions, PreviewResult } from '../look/model.ts';

export const info: ModelInfo = {
  key: 'environment',
  title: 'Environment: oak floor, rug lane, room, sunlight',
  instanced: false,
  teams: false,
  side: 'neutral',
  height: 12,
  triangleBudget: 20000,
  gameZ: 0,
  variants: ['empty', 'units'],
};

export interface EnvironmentOptions {
  laneWidth: number; // 10
  laneLength: number; // L (55-64)
  zMin: number; // player base back edge (-3)
  zMax: number; // enemy base back edge (L + 4)
}

export interface EnvironmentModel {
  root: TransformNode;
  clearColor: Color4; // suggested scene clear colour (the wall tone)
  meshes: Mesh[];
  // Resolves when the oak textures have loaded (or failed). The floor already renders
  // before that with plain vertex-coloured boards; await it to show the level fully dressed.
  ready: Promise<void>;
  dispose(): void;
}

export const FLOOR_Y = -0.02; // top of the floorboards
export const RUG_Y = 0.006; // top of the rug body (units stand at y = 0, sunk into the pile)

const BOARD_W = 1.4;
const BOARD_GAP = 0.012;
const BOARD_BEVEL = 0.022;
const BOARD_DROP = 0.018;
const FLOOR_HALF_W = 130; // covers a 2.2:1 desktop window at the far wall
const FLOOR_DETAIL_X = 26; // short, staggered boards within this |x|; longer ones outside
const GRAIN_U = 3.2; // world units along the grain per texture repeat
const GRAIN_V = 2.8; // world units across the grain per texture repeat (two boards)
const BORDER_W = 0.4;
const RUG_RADIUS = 0.6;
const BAND_STEP = 10; // soft darker cross bands (alternating strengths)
const BAND_CORE = 0.35; // half width of a band's full-strength core
const BAND_FEATHER = 0.45; // and of its feathered edge beyond the core
const WOOL_REPEAT = 6.4; // world units per wool texture repeat (tufts ~0.18 units)
const WALL_HEIGHT = 30;
const BASEBOARD_H = 1.2;
const SKIRT_X0 = 8.5; // the bed runs from here to the right
const SKIRT_COLOR = '#d3c0bb'; // pale dusty rose, close to the wall's value (never green or tan)
const DUVET_COLOR = '#ece6df'; // a soft cream duvet over the mattress
const SKIRT_TOP = 1.45; // the skirt hangs from the bed frame at this height
const DUVET_TOP = 2.55; // top of the duvet

// ---------- small deterministic noise ----------
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// Value noise in world units (period-free), 0..1.
function noise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

// Tileable value noise on a period-p lattice (for textures), 0..1.
function tnoise(u: number, v: number, pu: number, pv: number, seed: number): number {
  const x = u * pu;
  const y = v * pv;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const wx = (i: number): number => ((i % pu) + pu) % pu;
  const wy = (i: number): number => ((i % pv) + pv) % pv;
  const a = hash2(wx(x0), wy(y0), seed);
  const b = hash2(wx(x0 + 1), wy(y0), seed);
  const c = hash2(wx(x0), wy(y0 + 1), seed);
  const d = hash2(wx(x0 + 1), wy(y0 + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function tfbm(u: number, v: number, pu: number, pv: number, oct: number, seed: number): number {
  let s = 0;
  let amp = 0.5;
  let n = 0;
  for (let o = 0; o < oct; o++) {
    s += tnoise(u, v, pu << o, pv << o, seed + o * 17) * amp;
    n += amp;
    amp *= 0.5;
  }
  return s / n;
}

// ---------- geometry accumulator ----------
class Geo {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];

  vert(
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    u: number,
    v: number,
    c: Color3 | readonly number[],
  ): number {
    const i = this.pos.length / 3;
    this.pos.push(x, y, z);
    const l = Math.hypot(nx, ny, nz) || 1;
    this.nrm.push(nx / l, ny / l, nz / l);
    this.uv.push(u, v);
    if (c instanceof Color3) this.col.push(c.r, c.g, c.b, 1);
    else this.col.push(c[0], c[1], c[2], 1);
    return i;
  }

  // Quad a-b-c-d (any winding: data() fixes it from the normals).
  quad(a: number, b: number, c: number, d: number): void {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  data(): VertexData {
    const vd = new VertexData();
    vd.positions = this.pos;
    vd.normals = this.nrm;
    vd.uvs = this.uv;
    vd.colors = this.col;
    vd.indices = this.idx;
    return fixWinding(vd); // faces point along their vertex normals
  }
}

// ---------- procedural textures ----------
function rawTex(
  scene: Scene,
  name: string,
  data: Uint8Array,
  w: number,
  h: number,
  gamma: boolean,
  wrap = true,
): Texture {
  const t = RawTexture.CreateRGBATexture(
    data,
    w,
    h,
    scene,
    true,
    false,
    Texture.TRILINEAR_SAMPLINGMODE,
    Constants.TEXTURETYPE_UNSIGNED_BYTE,
  );
  t.name = name;
  t.wrapU = wrap ? Texture.WRAP_ADDRESSMODE : Texture.CLAMP_ADDRESSMODE;
  t.wrapV = wrap ? Texture.WRAP_ADDRESSMODE : Texture.CLAMP_ADDRESSMODE;
  t.anisotropicFilteringLevel = 4;
  t.gammaSpace = gamma;
  return t;
}

// Height field (0..1, wrapped) to a tangent-space normal map (OpenGL +Y).
function heightToNormal(h: Float32Array, w: number, hgt: number, strength: number): Uint8Array {
  const out = new Uint8Array(w * hgt * 4);
  const at = (x: number, y: number): number => h[((y + hgt) % hgt) * w + ((x + w) % w)];
  for (let y = 0; y < hgt; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      out[i] = Math.round((-dx / len) * 127.5 + 127.5);
      out[i + 1] = Math.round((dy / len) * 127.5 + 127.5);
      out[i + 2] = Math.round((1 / len) * 127.5 + 127.5);
      out[i + 3] = 255;
    }
  }
  return out;
}

// Wool pile: irregular tufts and heathered yarn (no regular weave grid, so it never moires),
// one repeat = WOOL_REPEAT world units. Three scales: tufts (~0.18 units, the pile you see
// at game distance), heather blotches (~0.5 units, yarn lots) and fine fibres. Greyscale
// around 0.78 (vertex colours carry the indigo), plus its normal map.
function woolTextures(scene: Scene): { albedo: Texture; normal: Texture } {
  const S = 512;
  const h = new Float32Array(S * S);
  const alb = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const tuftN = tfbm(u, v, 36, 36, 2, 3);
      // Tufts: rounded clumps with darker crevices between them.
      const tuft = Math.pow(Math.max(0, Math.min(1, (tuftN - 0.28) / 0.5)), 0.8);
      const blotch = tfbm(u, v, 12, 12, 2, 11); // heather / yarn lots
      const fibre = tfbm(u, v, 128, 64, 2, 7); // fine fibres
      const fleck = tnoise(u, v, 96, 96, 23) > 0.8 ? 1 : 0; // a few lighter yarn flecks
      const hh = tuft * 0.72 + fibre * 0.28;
      h[y * S + x] = hh;
      const k = 0.78 + (tuft - 0.5) * 0.16 + (blotch - 0.5) * 0.06 + (fibre - 0.5) * 0.08 + fleck * 0.04;
      const i = (y * S + x) * 4;
      const g = Math.round(Math.max(0, Math.min(1, k)) * 255);
      alb[i] = g;
      alb[i + 1] = g;
      alb[i + 2] = Math.min(255, g + 4);
      alb[i + 3] = 255;
    }
  }
  return {
    albedo: rawTex(scene, 'env-wool-albedo', alb, S, S, true),
    normal: rawTex(scene, 'env-wool-normal', heightToNormal(h, S, S, 3.2), S, S, false),
  };
}

// The wool textures are shared by the rug and the bed skirt (one pair per look).
const woolCache = new WeakMap<Look, { albedo: Texture; normal: Texture }>();
function sharedWool(scene: Scene, look: Look): { albedo: Texture; normal: Texture } {
  let w = woolCache.get(look);
  if (!w || w.albedo.getScene() !== scene) {
    w = woolTextures(scene);
    woolCache.set(look, w);
  }
  return w;
}

// Border binding: u across the border (0 outer edge .. 1 inner edge), v along it (one
// repeat = BORDER_REPEAT units). Cream wool with two rows of indigo running stitches.
const BORDER_REPEAT = 2.4;
function borderTextures(scene: Scene): { albedo: Texture; normal: Texture } {
  const W = 128;
  const H = 512;
  const h = new Float32Array(W * H);
  const alb = new Uint8Array(W * H * 4);
  const cream = srgb(HEX.rugBorder);
  const thread = srgb('#2a3b63');
  const stitchesPerRepeat = 12; // 0.2 units apart
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const v = y / H;
      const ribs = 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * 14 + tnoise(u, v, 8, 16, 5) * 2); // twill ribs along the edge
      const fibre = tfbm(u, v, 16, 128, 2, 9);
      let height = ribs * 0.35 + fibre * 0.25;
      let k = 0.9 + (fibre - 0.5) * 0.16 + (ribs - 0.5) * 0.06;
      let st = 0;
      for (const row of [0.2, 0.8]) {
        // A running stitch: slanted dashes, 60% on, along v.
        const s = v * stitchesPerRepeat + (u - row) * 1.6;
        const f = s - Math.floor(s);
        const along = f < 0.62 ? Math.sin((f / 0.62) * Math.PI) : 0;
        const across = Math.max(0, 1 - Math.abs(u - row) / 0.055);
        const m = Math.min(1, along * 1.6) * Math.pow(across, 0.7);
        if (m > st) st = m;
        // Needle holes: tiny dark dimples where the thread goes under.
        if (f >= 0.62 && across > 0.4) k *= 1 - 0.18 * Math.sin(((f - 0.62) / 0.38) * Math.PI) * across;
      }
      height = height * (1 - st) + (0.75 + st * 0.25) * st;
      h[y * W + x] = height;
      const i = (y * W + x) * 4;
      const sh = Math.max(0, Math.min(1, k));
      const r = cream.r * sh * (1 - st) + thread.r * st * (0.85 + fibre * 0.3);
      const g = cream.g * sh * (1 - st) + thread.g * st * (0.85 + fibre * 0.3);
      const b = cream.b * sh * (1 - st) + thread.b * st * (0.85 + fibre * 0.3);
      alb[i] = Math.round(Math.min(1, r) * 255);
      alb[i + 1] = Math.round(Math.min(1, g) * 255);
      alb[i + 2] = Math.round(Math.min(1, b) * 255);
      alb[i + 3] = 255;
    }
  }
  return {
    albedo: rawTex(scene, 'env-border-albedo', alb, W, H, true),
    normal: rawTex(scene, 'env-border-normal', heightToNormal(h, W, H, 2.5), W, H, false),
  };
}

// Pale wallpaper: soft vertical stripes (two close tones) with a fine pinstripe and paper
// mottle. One repeat = 4 units. Greyscale near 1; the wall colour comes from the material.
function wallpaperTexture(scene: Scene): Texture {
  const S = 256;
  const alb = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const stripe = u % 0.5 < 0.25 ? 1 : 0.982;
      const pin = Math.abs((u % 0.5) - 0.25) < 0.004 || Math.abs(u % 0.5) < 0.004 ? 0.972 : 1;
      const mottle = tfbm(u, v, 8, 8, 3, 21);
      const k = stripe * pin * (0.97 + (mottle - 0.5) * 0.05);
      const g = Math.round(Math.min(1, k) * 255);
      const i = (y * S + x) * 4;
      alb[i] = g;
      alb[i + 1] = g;
      alb[i + 2] = g;
      alb[i + 3] = 255;
    }
  }
  return rawTex(scene, 'env-wallpaper', alb, S, S, true);
}

// The window's light pool: 3 x 2 panes with a frame and muntins, soft penumbra edges.
// u runs across the window (floor z), v up the window (projected along the sun).
function windowTexture(scene: Scene): Texture {
  const S = 128;
  const data = new Uint8Array(S * S * 4);
  const smooth = (e0: number, e1: number, x: number): number => {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S;
      const v = (y + 0.5) / S;
      const pen = 0.05; // penumbra width (fraction)
      const outer =
        smooth(0.04, 0.04 + pen, u) *
        smooth(0.04, 0.04 + pen, 1 - u) *
        smooth(0.04, 0.04 + pen * 1.4, v) *
        smooth(0.04, 0.04 + pen * 1.4, 1 - v);
      // Muntins: 2 vertical bars (3 columns), 1 horizontal bar (2 rows).
      const bar = (c: number, w: number, p: number, t: number): number =>
        1 - (1 - smooth(w, w + p, Math.abs(t - c))) * 0.85;
      const m = bar(1 / 3, 0.012, 0.03, u) * bar(2 / 3, 0.012, 0.03, u) * bar(0.5, 0.014, 0.04, v);
      // Slightly brighter toward the window end (v = 0), fading where the light spreads.
      const fall = 0.75 + 0.25 * (1 - v);
      const a = outer * m * fall;
      // Warm sunlight colour (linear), times the mask.
      const i = (y * S + x) * 4;
      data[i] = Math.round(a * 255);
      data[i + 1] = Math.round(a * 0.8 * 255);
      data[i + 2] = Math.round(a * 0.55 * 255);
      data[i + 3] = 255;
    }
  }
  return rawTex(scene, 'env-window', data, S, S, false, false);
}

// ---------- materials (shared per look) ----------
// The floor renders at once with plain vertex-coloured boards (no textures), and the oak
// textures are attached as each one arrives, so a cold load never shows a missing floor.
// floorReady resolves when all three have loaded (or failed).
const FLOOR_TEX_MEAN = 0.75; // linear mean of the oak albedo texture
const floorReady = new WeakMap<PBRMaterial, Promise<void>>();

function floorMaterial(scene: Scene, look: Look): PBRMaterial {
  return look.material('env-floor', () => {
    const m = woodMaterial(scene, null, { name: 'env-floor', texture: false, clearcoat: 0.3, envIntensity: 1 });
    m.clearCoat.roughness = 0.25;
    m.roughness = 0.5;
    m.metallic = 0;
    // Until the albedo arrives, the mean of the texture stands in for it.
    m.albedoColor = new Color3(FLOOR_TEX_MEAN, FLOOR_TEX_MEAN, FLOOR_TEX_MEAN);
    let disposed = false;
    m.onDisposeObservable.addOnce(() => {
      disposed = true;
    });
    const load = (file: string, apply: (t: Texture) => void): Promise<void> =>
      new Promise<void>((resolve) => {
        const t = new Texture(
          assetUrl(`models/${file}`),
          scene,
          false,
          true,
          Texture.TRILINEAR_SAMPLINGMODE,
          () => {
            if (!disposed) apply(t);
            else t.dispose();
            resolve();
          },
          () => {
            t.dispose();
            resolve();
          },
        );
        t.anisotropicFilteringLevel = 8;
      });
    floorReady.set(
      m,
      Promise.all([
        load('environment-oak-albedo.jpg', (t) => {
          m.albedoTexture = t;
          m.albedoColor = Color3.White();
        }),
        load('environment-oak-normal.jpg', (t) => {
          m.bumpTexture = t;
          t.level = 0.5;
          m.invertNormalMapY = false;
        }),
        load('environment-oak-orm.jpg', (t) => {
          m.metallicTexture = t;
          m.useRoughnessFromMetallicTextureGreen = true;
          m.useMetallnessFromMetallicTextureBlue = true;
          m.useAmbientOcclusionFromMetallicTextureRed = false;
          m.roughness = 1;
          m.metallic = 0;
        }),
      ]).then(() => undefined),
    );
    return m;
  });
}

function rugMaterial(scene: Scene, look: Look): PBRMaterial {
  return look.material('env-rug', () => {
    const wool = sharedWool(scene, look);
    const m = fabricMaterial(scene, null, {
      name: 'env-rug',
      albedoTexture: wool.albedo,
      normalTexture: wool.normal,
      normalStrength: 0.75,
      roughness: 0.95,
      envIntensity: 0.7,
    });
    // White albedo would give a white sheen; tint it like lighter indigo wool, strong
    // enough that the far end gets a soft velvet rim at grazing angles.
    m.sheen.color = lin('#8a9fd0');
    m.sheen.intensity = 0.8;
    m.sheen.roughness = 0.5;
    return m;
  });
}

function borderMaterial(scene: Scene, look: Look): PBRMaterial {
  return look.material('env-rug-border', () => {
    const t = borderTextures(scene);
    const m = fabricMaterial(scene, null, {
      name: 'env-rug-border',
      albedoTexture: t.albedo,
      normalTexture: t.normal,
      normalStrength: 0.6,
      roughness: 0.9,
      envIntensity: 0.7,
    });
    m.sheen.color = lin('#fff4dc');
    m.sheen.intensity = 0.2;
    return m;
  });
}

function wallMaterial(scene: Scene, look: Look): PBRMaterial {
  return look.material('env-wall', () =>
    paperMaterial(scene, null, {
      name: 'env-wall',
      albedoTexture: wallpaperTexture(scene),
      roughness: 0.9,
      normalStrength: 0,
      envIntensity: 0.6,
    }),
  );
}

function baseboardMaterial(scene: Scene, look: Look): PBRMaterial {
  return look.material('env-baseboard', () =>
    plasticMaterial(scene, null, { name: 'env-baseboard', roughness: 0.38, clearcoat: 0.2, envIntensity: 0.8 }),
  );
}

function skirtMaterial(scene: Scene, look: Look): PBRMaterial {
  return look.material('env-skirt', () => {
    const wool = sharedWool(scene, look);
    const m = fabricMaterial(scene, null, {
      name: 'env-skirt',
      albedoTexture: wool.albedo,
      normalTexture: wool.normal,
      normalStrength: 0.3,
      envIntensity: 0.7,
    });
    m.sheen.color = lin('#f4ece6');
    m.sheen.intensity = 0.25;
    return m;
  });
}

function sunMaterial(scene: Scene, look: Look): StandardMaterial {
  return look.material('env-sun', () => {
    // Output = mask * warm * SUN_STRENGTH; blended as dst * (1 + output) (see sunBlend), so
    // the pool brightens whatever it falls on in proportion to its colour, like light.
    const m = new StandardMaterial('env-sun', scene);
    m.disableLighting = true;
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.emissiveColor = Color3.Black();
    m.emissiveTexture = windowTexture(scene);
    m.alpha = 0.999; // transparent pass; the blend factors are replaced in sunBlend
    m.alphaMode = Constants.ALPHA_ADD;
    m.imageProcessingConfiguration = rawImageProcessing();
    m.disableDepthWrite = true;
    m.zOffset = -3;
    m.backFaceCulling = true;
    return m;
  });
}

// No tone mapping or grading on the light decals: their output is a light amount, not a colour.
function rawImageProcessing(): ImageProcessingConfiguration {
  const ip = new ImageProcessingConfiguration();
  ip.isEnabled = false;
  return ip;
}

const SUN_STRENGTH = 0.7; // peak brightening inside a pane (+70%)
// On the 'low' tier there is no post pipeline: the frame buffer already holds tone-mapped
// colours, so the same brightening factor would blow out. Use a gentler one there.
const SUN_STRENGTH_LDR = 0.28;
const GL_DST_COLOR = 0x0306;
const GL_ONE = 1;
const GL_ZERO = 0;

interface BlendState {
  setAlphaBlendFunctionParameters(srcRGB: number, dstRGB: number, srcA: number, dstA: number, target?: number): void;
  setAlphaMode(mode: number, target?: number): void;
}

// Multiplicative brightening (dst * (1 + src)): set right before the decal's draw call and
// restored after it. If the engine's blend state is not reachable, the decal falls back to
// a plain (weaker-looking) additive blend.
function sunBlend(mesh: Mesh): void {
  const st = (mesh.getScene().getEngine() as unknown as { _alphaState?: BlendState })._alphaState;
  if (!st || typeof st.setAlphaBlendFunctionParameters !== 'function' || typeof st.setAlphaMode !== 'function') return;
  mesh.onBeforeDrawObservable.add(() => st.setAlphaBlendFunctionParameters(GL_DST_COLOR, GL_ONE, GL_ZERO, GL_ONE, 0));
  mesh.onAfterRenderObservable.add(() => st.setAlphaMode(Constants.ALPHA_ADD, 0));
}

// ---------- layout ----------
interface Layout {
  hw: number; // half width of the rug body (lane)
  rugZ0: number; // outer edge of the rug (player end)
  rugZ1: number; // outer edge of the rug (enemy end)
  wallZ: number; // face of the wall
  skirtZ: number; // face of the bed skirt
  floorZ0: number;
  laneLength: number;
}

function layoutOf(o: EnvironmentOptions): Layout {
  const wallZ = o.zMax + 6;
  return {
    hw: o.laneWidth / 2,
    rugZ0: o.zMin - 1.5,
    rugZ1: o.zMax + 1.5,
    wallZ,
    skirtZ: wallZ - 2.6,
    floorZ0: o.zMin - 16,
    laneLength: o.laneLength,
  };
}

// ---------- floor ----------
function floorShade(L: Layout, x: number, z: number): number {
  let k = 0.93 + 0.13 * noise(x / 17, z / 13, 41) + 0.05 * (noise(x / 5, z / 7, 43) - 0.5);
  // Contact darkening at the baseboard and in the gap under the bed skirt.
  k *= 1 - 0.5 * Math.exp(-Math.max(0, L.wallZ - z) / 0.7);
  if (x > SKIRT_X0 - 0.5) {
    const side = Math.min(1, (x - (SKIRT_X0 - 0.5)) / 1.2);
    k *= 1 - 0.6 * side * Math.exp(-Math.max(0, L.skirtZ - z) / 1.0);
  }
  // A faint halo of darkening just outside the rug (its thickness occludes a little sky).
  const dx = Math.abs(x) - (L.hw + BORDER_W);
  if (dx > -0.05 && z > L.rugZ0 && z < L.rugZ1) k *= 1 - 0.18 * Math.exp(-Math.max(0, dx) / 0.25);
  return k;
}

function buildFloor(scene: Scene, look: Look, L: Layout, seed: number): Mesh {
  const g = new Geo();
  const r = rng(seed);
  const oak = lin(HEX.oak);
  const oakDark = lin(HEX.oakDark);
  const oakLight = lin(HEX.oakLight);
  const TEX_MEAN = FLOOR_TEX_MEAN;
  const calmTarget = lin('#b98656'); // pull every board a little toward a calm mid oak
  const z0All = L.floorZ0;
  const z1All = L.wallZ + 0.3; // under the baseboard
  // Dark underlay: the gaps between boards.
  {
    const c = [0.03, 0.017, 0.008];
    const y = FLOOR_Y - BOARD_DROP - 0.004;
    const a = g.vert(-FLOOR_HALF_W, y, z0All, 0, 1, 0, 0, 0, c);
    const b = g.vert(FLOOR_HALF_W, y, z0All, 0, 1, 0, 0, 0, c);
    const cc = g.vert(FLOOR_HALF_W, y, z1All, 0, 1, 0, 0, 0, c);
    const d = g.vert(-FLOOR_HALF_W, y, z1All, 0, 1, 0, 0, 0, c);
    g.quad(a, b, cc, d);
  }
  // Backstop under the rug body (the boards there are skipped): plain oak at FLOOR_Y, so
  // hiding the rug or a close camera never shows the dark underlay.
  {
    const c = Color3.Lerp(oak, calmTarget, 0.5).scale(1 / TEX_MEAN);
    const y = FLOOR_Y - 0.006; // below the board tops (no z-fight), above the underlay
    const x0 = -L.hw - 0.2,
      x1 = L.hw + 0.2,
      za = L.rugZ0 + 0.6,
      zb = L.rugZ1 - 0.6;
    const a = g.vert(x0, y, za, 0, 1, 0, za / GRAIN_U, 0, c);
    const b = g.vert(x1, y, za, 0, 1, 0, za / GRAIN_U, 7, c);
    const cc = g.vert(x1, y, zb, 0, 1, 0, zb / GRAIN_U, 7, c);
    const d = g.vert(x0, y, zb, 0, 1, 0, zb / GRAIN_U, 0, c);
    g.quad(a, b, cc, d);
  }
  const wallCuts = [L.wallZ - 1.7, L.wallZ - 0.6];
  const skirtCuts = [L.skirtZ - 1.9, L.skirtZ - 0.7];
  const n = Math.ceil((FLOOR_HALF_W * 2) / BOARD_W);
  const xStart = -n * BOARD_W * 0.5;
  for (let i = 0; i < n; i++) {
    const x0 = xStart + i * BOARD_W;
    const x1 = x0 + BOARD_W;
    const xc = (x0 + x1) / 2;
    const near = Math.abs(xc) < FLOOR_DETAIL_X;
    // Behind the bed skirt the floor is hidden: stop just past it.
    const bed = x0 > SKIRT_X0 + 0.2;
    const zEnd = bed ? L.skirtZ + 0.4 : z1All;
    const cuts = bed ? skirtCuts : wallCuts;
    let z = z0All - r() * (near ? 8 : 20);
    while (z < zEnd) {
      const len = near ? 3.2 + r() * 5.6 : 9 + r() * 14;
      const za = Math.max(z, z0All);
      const zb = Math.min(z + len, zEnd);
      z += len;
      if (zb - za < 0.3) continue;
      // Hidden under the rug body: skip.
      const underRug = x0 > -L.hw - 0.1 && x1 < L.hw + 0.1 && za > L.rugZ0 + 0.8 && zb < L.rugZ1 - 0.8;
      if (underRug) continue;
      // Per-board tone: a mix toward light or dark oak, plus a little hue drift.
      const t = r();
      const base = t < 0.5 ? Color3.Lerp(oakDark, oak, 0.72 + t * 0.56) : Color3.Lerp(oak, oakLight, (t - 0.5) * 0.5);
      const warm = 0.97 + r() * 0.06;
      const grey = (base.r + base.g + base.b) / 3;
      // The floor is the calmest thing on screen: desaturated and pulled toward mid oak.
      const calm = Color3.Lerp(Color3.Lerp(base, calmTarget, 0.25), new Color3(grey, grey, grey), 0.5).scale(0.95);
      const tint = new Color3((calm.r * warm) / TEX_MEAN, calm.g / TEX_MEAN, calm.b / warm / TEX_MEAN);
      const uOff = r() * 10;
      const vOff = r(); // any fraction: no two boards show the same strip of figure
      const flip = r() < 0.5;
      const uScale = 0.8 + r() * 0.4; // grain length varies per board (+-20%)
      // End bevels only on short boards in the near and middle part of the view: far away
      // they are sub-pixel and their clearcoat only glints as specks.
      const bevels = near && zb - za < 12 && zb < L.laneLength * 0.6;
      addBoard(g, L, x0, x1, za, zb, tint, uOff, vOff, flip, uScale, bevels, cuts);
    }
  }
  const mesh = buildMesh(scene, 'envFloor', g.data(), floorMaterial(scene, look));
  look.receiveShadows(mesh);
  return mesh;
}

function addBoard(
  g: Geo,
  L: Layout,
  x0: number,
  x1: number,
  za: number,
  zb: number,
  tint: Color3,
  uOff: number,
  vOff: number,
  flip: boolean,
  uScale: number,
  endBevels: boolean,
  cuts: number[],
): void {
  const gap = BOARD_GAP / 2;
  const ox0 = x0 + gap,
    ox1 = x1 - gap; // outer (bottom of bevel)
  const oz0 = za + gap,
    oz1 = zb - gap;
  const ix0 = ox0 + BOARD_BEVEL,
    ix1 = ox1 - BOARD_BEVEL; // inner (top)
  const iz0 = endBevels ? oz0 + BOARD_BEVEL : oz0;
  const iz1 = endBevels ? oz1 - BOARD_BEVEL : oz1;
  const yTop = FLOOR_Y;
  const yLow = FLOOR_Y - BOARD_DROP;
  const uvOf = (x: number, z: number): [number, number] => {
    const across = (x - x0) / GRAIN_V;
    return [z / (GRAIN_U * uScale) + uOff, vOff + (flip ? 0.5 - across : across)];
  };
  const col = (x: number, z: number, k = 1): Color3 => tint.scale(floorShade(L, x, z) * k);
  // Top surface, split at the shading cuts so the contact darkening has vertices.
  const zs = [iz0];
  for (const c of cuts) if (c > iz0 + 0.05 && c < iz1 - 0.05) zs.push(c);
  zs.sort((a, b) => a - b);
  zs.push(iz1);
  let prevA = -1,
    prevB = -1;
  for (let k = 0; k < zs.length; k++) {
    const z = zs[k];
    const [ua, va] = uvOf(ix0, z);
    const [ub, vb] = uvOf(ix1, z);
    const a = g.vert(ix0, yTop, z, 0, 1, 0, ua, va, col(ix0, z));
    const b = g.vert(ix1, yTop, z, 0, 1, 0, ub, vb, col(ix1, z));
    if (prevA >= 0) g.quad(prevA, prevB, b, a);
    prevA = a;
    prevB = b;
  }
  // Long-side bevels (normals tilted ~40 degrees outward).
  const tiltY = 1;
  const tiltS = 0.55; // ~30 degrees: a steeper sunward bevel aliases into bright specks far away
  const sideBevel = (xi: number, xo: number, s: number): void => {
    const zz = [iz0, iz1];
    let pi = -1,
      po = -1;
    for (const z of zz) {
      const zo = z === iz0 ? oz0 : z === iz1 ? oz1 : z;
      const [u1, v1] = uvOf(xi, z);
      const [u2, v2] = uvOf(xo, zo);
      const a = g.vert(xi, yTop, z, s * tiltS, tiltY, 0, u1, v1, col(xi, z, 0.8));
      const b = g.vert(xo, yLow, zo, s * tiltS, tiltY, 0, u2, v2, col(xo, zo, 0.55));
      if (pi >= 0) g.quad(pi, a, b, po);
      pi = a;
      po = b;
    }
  };
  sideBevel(ix0, ox0, -1);
  sideBevel(ix1, ox1, 1);
  if (endBevels) {
    const endBevel = (zi: number, zo: number, s: number): void => {
      const [u1, v1] = uvOf(ix0, zi);
      const [u2, v2] = uvOf(ix1, zi);
      const [u3, v3] = uvOf(ox1, zo);
      const [u4, v4] = uvOf(ox0, zo);
      const a = g.vert(ix0, yTop, zi, 0, tiltY, s * 0.15, u1, v1, col(ix0, zi, 0.9));
      const b = g.vert(ix1, yTop, zi, 0, tiltY, s * 0.15, u2, v2, col(ix1, zi, 0.9));
      const c = g.vert(ox1, yLow, zo, 0, tiltY, s * 0.15, u3, v3, col(ox1, zo, 0.55));
      const d = g.vert(ox0, yLow, zo, 0, tiltY, s * 0.15, u4, v4, col(ox0, zo, 0.55));
      g.quad(a, b, c, d);
    };
    endBevel(iz0, oz0, -1);
    endBevel(iz1, oz1, 1);
  }
}

// ---------- rug ----------
// Half width of the rug's outer outline at z (rounded corners of radius RUG_RADIUS).
function outlineHalfWidth(L: Layout, z: number, inset: number): number {
  const R = Math.max(0.001, RUG_RADIUS - inset);
  const hw = L.hw + BORDER_W - inset;
  const z0 = L.rugZ0 + inset;
  const z1 = L.rugZ1 - inset;
  const dz = z < z0 + R ? z0 + R - z : z > z1 - R ? z - (z1 - R) : 0;
  return hw - R + Math.sqrt(Math.max(0, R * R - dz * dz));
}

// Inner frame: a thin line FRAME_IN..FRAME_OUT inside the border, all the way round, only a
// little darker than the field.
const FRAME_IN = 0.26;
const FRAME_OUT = 0.31;
// A second, pale woven inner border line (reads as a pattern, not a flat navy field).
const LINE_IN = 0.62;
const LINE_OUT = 0.7;
function rugDesign(x: number, z: number, bz0: number, bz1: number, hw: number): 'field' | 'frame' | 'line' {
  const fromSide = hw - Math.abs(x);
  const fromEnd = Math.min(z - bz0, bz1 - z);
  const edge = Math.min(fromSide, fromEnd);
  if (edge > FRAME_IN && edge < FRAME_OUT) return 'frame';
  return edge > LINE_IN && edge < LINE_OUT ? 'line' : 'field';
}

// Soft darker cross bands every BAND_STEP units, alternating strengths: 0 outside a band,
// up to 0.45 in a strong band's core, feathered (smoothstep) over BAND_FEATHER.
function bandCentres(L: Layout): number[] {
  const out: number[] = [];
  for (let c = BAND_STEP; c < L.laneLength - 1; c += BAND_STEP) out.push(c);
  return out;
}
function bandWeight(L: Layout, z: number): number {
  let w = 0;
  bandCentres(L).forEach((c, i) => {
    const d = Math.abs(z - c);
    const t = Math.max(0, Math.min(1, (d - BAND_CORE) / BAND_FEATHER));
    const f = 1 - t * t * (3 - 2 * t);
    w = Math.max(w, f * (i % 2 === 0 ? 0.5 : 0.32));
  });
  return w;
}

function buildRug(scene: Scene, look: Look, L: Layout): Mesh {
  const g = new Geo();
  const inset = BORDER_W;
  const bz0 = L.rugZ0 + inset;
  const bz1 = L.rugZ1 - inset;
  // The wool reads a step lighter than the palette swatch once lit and tone mapped:
  // lift it so the lane is not the heaviest, dullest area of the frame.
  const LIFT = 1.32;
  const rug = lin(HEX.rug).scale(LIFT);
  const rugDark = lin(HEX.rugDark).scale(LIFT);
  const frame = Color3.Lerp(rug, rugDark, 0.4);
  const line = Color3.Lerp(rug.scale(1.25), lin('#c9b98f'), 0.22);
  const TEX_MEAN = 0.74; // linear mean of the wool albedo (slightly under: the key light is strong)
  const color = (kind: string, x: number, z: number, hwz: number): Color3 => {
    const base = kind === 'frame' ? frame : kind === 'line' ? line : Color3.Lerp(rug, rugDark, bandWeight(L, z));
    // Low-frequency mottling (about +-9%), finer patchiness, and abrash: hand-dyed yarn
    // lots give soft colour drifts across the rug.
    // (Gentler than before: strong mottling read as blotchy noise rather than wool.)
    let k = 0.95 + 0.1 * noise(x / 2.6, z / 3.1, 7) + 0.04 * (noise(x / 0.9, z / 1.1, 9) - 0.5);
    k *= 1 + 0.12 * (noise(x / 14, z / 2.4, 17) - 0.5);
    // Worn (lighter, a touch greyer) path down the middle, darker toward the edge.
    const wear = Math.exp(-((x / 3.2) ** 2)) * (0.6 + 0.4 * noise(x / 4, z / 6, 13));
    k *= 1 + 0.16 * wear;
    // Lighter streaks along the lane where the pile is brushed flat (long in z, narrow in x).
    k *= 1 + 0.12 * wear * Math.max(0, noise(x / 0.45, z / 10, 21) - 0.45);
    const fromEdge = hwz - Math.abs(x);
    k *= 1 - 0.1 * Math.exp(-Math.max(0, fromEdge) / 0.5);
    const c = base.scale(k / TEX_MEAN);
    const grey = (c.r + c.g + c.b) / 3;
    return Color3.Lerp(c, new Color3(grey, grey, grey), 0.1 + 0.12 * wear);
  };
  // Z rows: dense near the rounded ends, the frame line's edges, the band feathers, ~0.9 elsewhere.
  const zr = new Set<number>();
  const add = (z: number): void => {
    if (z >= bz0 && z <= bz1) zr.add(Math.round(z * 1000) / 1000);
  };
  for (let z = bz0; z < bz1; z += 0.9) add(z);
  add(bz1);
  for (let k = 0; k <= 4; k++) {
    add(bz0 + (k / 4) * 0.2);
    add(bz1 - (k / 4) * 0.2);
  }
  for (const e of [FRAME_IN, FRAME_OUT, LINE_IN, LINE_OUT]) {
    add(bz0 + e);
    add(bz1 - e);
  }
  for (const c of bandCentres(L)) {
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      add(c - BAND_CORE - f * BAND_FEATHER);
      add(c + BAND_CORE + f * BAND_FEATHER);
    }
    add(c);
  }
  const zs = [...zr].sort((a, b) => a - b);
  // Columns as fractions of the half width at each z (frame line edges kept exact).
  const xsAt = (hwz: number): number[] => {
    const xs = [-hwz, -hwz + FRAME_IN, -hwz + FRAME_OUT, -hwz + LINE_IN, -hwz + LINE_OUT];
    const inner = hwz - LINE_OUT;
    const nIn = Math.max(2, Math.round((inner * 2) / 1.0));
    for (let k = 1; k < nIn; k++) xs.push(-inner + (k / nIn) * inner * 2);
    xs.push(hwz - LINE_OUT, hwz - LINE_IN, hwz - FRAME_OUT, hwz - FRAME_IN, hwz);
    return xs;
  };
  for (let j = 0; j < zs.length - 1; j++) {
    const za = zs[j];
    const zb = zs[j + 1];
    const hwa = outlineHalfWidth(L, za, inset);
    const hwb = outlineHalfWidth(L, zb, inset);
    const xa = xsAt(hwa);
    const xb = xsAt(hwb);
    for (let i = 0; i < xa.length - 1; i++) {
      const cx = (xa[i] + xa[i + 1] + xb[i] + xb[i + 1]) / 4;
      const cz = (za + zb) / 2;
      const kind = rugDesign(cx, cz, bz0, bz1, (hwa + hwb) / 2);
      const p = [
        [xa[i], za, hwa],
        [xa[i + 1], za, hwa],
        [xb[i + 1], zb, hwb],
        [xb[i], zb, hwb],
      ];
      const ids = p.map(([x, z, h]) =>
        g.vert(x, RUG_Y, z, 0, 1, 0, x / WOOL_REPEAT, z / WOOL_REPEAT, color(kind, x, z, h)),
      );
      g.quad(ids[0], ids[1], ids[2], ids[3]);
    }
  }
  const mesh = buildMesh(scene, 'envRug', g.data(), rugMaterial(scene, look));
  look.receiveShadows(mesh);
  return mesh;
}

// The border: a ring following the rounded outline, with a rolled outer edge down to the
// floor (the soft edge) and a flat stitched band on top.
function buildBorder(scene: Scene, look: Look, L: Layout): Mesh {
  const g = new Geo();
  const hwo = L.hw + BORDER_W;
  const R = RUG_RADIUS;
  // Outline loop, counter-clockwise seen from above, starting mid player end (hidden by the base).
  interface P {
    x: number;
    z: number;
    nx: number; // outward normal
    nz: number;
  }
  const pts: P[] = [];
  const arc = (cx: number, cz: number, a0: number, a1: number): void => {
    const steps = 10;
    for (let k = 0; k <= steps; k++) {
      const a = a0 + ((a1 - a0) * k) / steps;
      pts.push({ x: cx + Math.cos(a) * R, z: cz + Math.sin(a) * R, nx: Math.cos(a), nz: Math.sin(a) });
    }
  };
  const z0 = L.rugZ0;
  const z1 = L.rugZ1;
  pts.push({ x: 0, z: z0, nx: 0, nz: -1 });
  arc(hwo - R, z0 + R, -Math.PI / 2, 0);
  arc(hwo - R, z1 - R, 0, Math.PI / 2);
  arc(-hwo + R, z1 - R, Math.PI / 2, Math.PI);
  arc(-hwo + R, z0 + R, Math.PI, Math.PI * 1.5);
  pts.push({ x: 0, z: z0, nx: 0, nz: -1 });
  // Cross-section: [distance inward from the outer edge, y, outward normal component, up component].
  const prof: [number, number, number, number][] = [
    [0, FLOOR_Y + 0.002, 1, 0.35],
    [0.025, 0.002, 0.8, 1],
    [0.07, 0.009, 0.25, 1],
    [0.14, 0.011, 0, 1],
    [BORDER_W - 0.06, 0.011, 0, 1],
    [BORDER_W - 0.01, RUG_Y + 0.001, -0.3, 1],
    [BORDER_W + 0.02, RUG_Y, 0, 1],
  ];
  let s = 0;
  const rows: number[][] = [];
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k];
    if (k > 0) s += Math.hypot(p.x - pts[k - 1].x, p.z - pts[k - 1].z);
    const row: number[] = [];
    for (const [d, y, no, nu] of prof) {
      const shade = d < 0.03 ? 0.7 : d > BORDER_W ? 0.85 : 1;
      const u = Math.min(1, d / BORDER_W);
      row.push(
        g.vert(p.x - p.nx * d, y, p.z - p.nz * d, p.nx * no, nu, p.nz * no, u, s / BORDER_REPEAT, [
          shade,
          shade,
          shade,
        ]),
      );
    }
    rows.push(row);
  }
  for (let k = 0; k < rows.length - 1; k++) {
    for (let j = 0; j < prof.length - 1; j++) g.quad(rows[k][j], rows[k + 1][j], rows[k + 1][j + 1], rows[k][j + 1]);
  }
  const mesh = buildMesh(scene, 'envRugBorder', g.data(), borderMaterial(scene, look));
  look.receiveShadows(mesh);
  return mesh;
}

// ---------- room ----------
function buildWall(scene: Scene, look: Look, L: Layout): Mesh {
  const g = new Geo();
  const wall = lin(HEX.wall);
  const W = FLOOR_HALF_W + 10;
  const ys = [BASEBOARD_H - 0.05, BASEBOARD_H + 0.3, BASEBOARD_H + 1.2, DUVET_TOP + 0.4, 4.6, 9, WALL_HEIGHT];
  const xs: number[] = [];
  for (let x = -W; x <= W + 0.01; x += 10) xs.push(x);
  const shade = (x: number, y: number): number => {
    // Darker low on the wall (the baseboard's ledge and the floor's shadow), a faint
    // large-scale drift, and darker behind the bed corner.
    let k = 0.9 + 0.08 * Math.min(1, (y - BASEBOARD_H) / 6) + 0.04 * (noise(x / 23, y / 9, 61) - 0.5);
    if (y < BASEBOARD_H + 0.35) k *= 0.85;
    // The bed's soft shadow on the wall, low down only.
    if (x > SKIRT_X0 - 3)
      k *=
        1 -
        0.15 *
          Math.min(1, (x - SKIRT_X0 + 3) / 3) *
          (y <= DUVET_TOP + 0.4 ? 1 : Math.exp(-(y - DUVET_TOP - 0.4) / 1.2));
    return k;
  };
  const grid: number[][] = [];
  for (const y of ys) {
    const row: number[] = [];
    for (const x of xs) row.push(g.vert(x, y, L.wallZ, 0, 0, -1, x / 4, y / 4, wall.scale(shade(x, y))));
    grid.push(row);
  }
  for (let j = 0; j < ys.length - 1; j++)
    for (let i = 0; i < xs.length - 1; i++) g.quad(grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]);
  const mesh = buildMesh(scene, 'envWall', g.data(), wallMaterial(scene, look));
  look.receiveShadows(mesh);
  return mesh;
}

// Painted skirting board: a moulded profile (bead, cove, ogee cap) extruded along x.
function buildBaseboard(scene: Scene, look: Look, L: Layout): Mesh {
  const g = new Geo();
  const W = FLOOR_HALF_W + 10;
  const paint = lin(HEX.baseboard);
  // [depth out from the wall, y]; normals are derived from the neighbours.
  const prof: [number, number][] = [
    [0.26, FLOOR_Y - 0.01],
    [0.26, 0.06],
    [0.24, 0.1], // bead at the foot
    [0.25, 0.14],
    [0.25, 0.86],
    [0.235, 0.92],
    [0.2, 0.96], // cove
    [0.15, 1.02],
    [0.13, 1.08], // ogee cap
    [0.1, 1.15],
    [0.05, BASEBOARD_H],
    [0, BASEBOARD_H],
  ];
  const n = prof.length;
  const normals: [number, number][] = prof.map((_p, i) => {
    const a = prof[Math.max(0, i - 1)];
    const b = prof[Math.min(n - 1, i + 1)];
    const dd = b[0] - a[0];
    const dy = b[1] - a[1];
    // Outward (toward -z, i.e. +depth) perpendicular of the profile tangent.
    const l = Math.hypot(dd, dy) || 1;
    return [dy / l, -dd / l];
  });
  const shade = (y: number, x: number): number => {
    let k = 0.96 + 0.05 * Math.min(1, y / 0.5);
    if (y < 0.06) k *= 0.7;
    if (x > SKIRT_X0 - 2) k *= 0.6;
    return k;
  };
  const xs = [-W, -40, -12, -4, 4, SKIRT_X0 - 2, SKIRT_X0, W];
  const rows: number[][] = [];
  for (const x of xs) {
    const row: number[] = [];
    for (let i = 0; i < n; i++) {
      const [d, y] = prof[i];
      const [nd, ny] = normals[i];
      row.push(g.vert(x, y, L.wallZ - d, 0, ny, -nd, x / 2, y, paint.scale(shade(y, x))));
    }
    rows.push(row);
  }
  for (let k = 0; k < rows.length - 1; k++)
    for (let i = 0; i < n - 1; i++) g.quad(rows[k][i], rows[k + 1][i], rows[k + 1][i + 1], rows[k][i + 1]);
  const mesh = buildMesh(scene, 'envBaseboard', g.data(), baseboardMaterial(scene, look));
  look.receiveShadows(mesh);
  return mesh;
}

// A low bed against the wall, to the right of the enemy base: a pleated pale-rose valance
// (box pleats, turned hem) from just above the floor up to the frame at SKIRT_TOP, topped by
// a quilted cream duvet whose rounded front edge droops over the skirt, with the wall
// visible above. A short return of the skirt and an end cap of the duvet face the lane.
// One mesh, one fabric material; the colours are vertex colours.
function buildSkirt(scene: Scene, look: Look, L: Layout): Mesh {
  const g = new Geo();
  const MEAN = 0.74; // the wool texture's mean
  const skirtCol = lin(SKIRT_COLOR).scale(1 / MEAN);
  const duvetCol = lin(DUVET_COLOR).scale(1 / MEAN);
  const x0 = SKIRT_X0;
  const x1 = FLOOR_HALF_W + 10;
  const hem = 0.28; // gap to the floor
  const ys = [hem, hem + 0.06, hem + 0.22, hem + 0.3, 0.9, SKIRT_TOP + 0.15];
  const PLEAT = 4.2; // box pleats
  const depthAt = (x: number, y: number): number => {
    const t = ((x - x0) / PLEAT) % 1;
    // Box pleat: a crisp fold in, plus gentle gathers that flare toward the hem.
    const fold = t < 0.08 ? Math.sin((t / 0.08) * Math.PI) * 0.1 : 0;
    const gather = Math.sin(((x - x0) / PLEAT) * Math.PI * 2 * 3 + noise(x / 3, 0, 5) * 2) * 0.03;
    const flare = 1 + 0.5 * Math.max(0, 1 - y / SKIRT_TOP);
    let d = (fold + gather) * flare;
    if (y < hem + 0.3) d += 0.03 * Math.sin(((y - hem) / 0.3) * Math.PI); // turned hem
    return d;
  };
  const cols: number[] = [];
  for (let x = x0; x < x1;) {
    cols.push(x);
    const t = ((x - x0) / PLEAT) % 1;
    x += t < 0.12 ? 0.12 : x - x0 < 20 ? 0.5 : 2;
  }
  cols.push(x1);
  const shade = (x: number, y: number, d: number): number => {
    let k = 0.78 + 0.22 * Math.min(1, (y - hem) / 1.0); // darker toward the floor (contact)
    k *= 0.92 + d * 1.2; // folds: in = darker, out = lighter
    k *= 0.96 + 0.06 * noise(x / 6, y / 4, 71);
    if (y < hem + 0.07) k *= 0.82;
    if (y > SKIRT_TOP - 0.25) k *= 0.8; // in the duvet's shadow
    return Math.max(0.4, k);
  };
  const grid: number[][] = [];
  for (const y of ys) {
    const row: number[] = [];
    for (const x of cols) {
      const d = depthAt(x, y);
      const e = 0.02;
      const slope = (depthAt(x + e, y) - depthAt(x - e, y)) / (2 * e);
      row.push(
        g.vert(x, y, L.skirtZ - d, slope, 0.05, -1, x / WOOL_REPEAT, y / WOOL_REPEAT, skirtCol.scale(shade(x, y, d))),
      );
    }
    grid.push(row);
  }
  for (let j = 0; j < ys.length - 1; j++)
    for (let i = 0; i < cols.length - 1; i++) g.quad(grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]);
  // Return of the skirt round the bed's corner (faces -x), back to the wall.
  const zr = [L.skirtZ - depthAt(x0, 0), L.skirtZ + 0.8, L.wallZ - 0.27];
  const ret: number[][] = [];
  for (const y of ys) {
    const row: number[] = [];
    for (const z of zr)
      row.push(g.vert(x0, y, z, -1, 0.05, 0, z / WOOL_REPEAT, y / WOOL_REPEAT, skirtCol.scale(shade(x0, y, 0) * 0.84)));
    ret.push(row);
  }
  for (let j = 0; j < ys.length - 1; j++)
    for (let i = 0; i < zr.length - 1; i++) g.quad(ret[j][i], ret[j][i + 1], ret[j + 1][i + 1], ret[j + 1][i]);

  // Duvet: a soft rolled profile in (forward of skirtZ, y), extruded along x. Quilted
  // squares puff the top; the front edge droops a little between them.
  const xd0 = x0 - 0.3;
  const QUILT = 1.7;
  const prof: [number, number][] = [
    // [forward of skirtZ (toward -z), y]
    [-(L.wallZ - L.skirtZ) + 0.05, DUVET_TOP - 0.08],
    [-(L.wallZ - L.skirtZ) * 0.5, DUVET_TOP],
    [-0.4, DUVET_TOP - 0.01],
    [0.0, DUVET_TOP - 0.06],
    [0.24, DUVET_TOP - 0.2],
    [0.36, DUVET_TOP - 0.45],
    [0.38, 1.95],
    [0.33, 1.68],
    [0.22, 1.56],
    [0.05, 1.52],
  ];
  const puff = (x: number, i: number): [number, number] => {
    const q = (x - xd0) / QUILT;
    const f = 0.5 - 0.5 * Math.cos(q * Math.PI * 2); // 0 at the seams, 1 mid-square
    const n = noise(x / 2.3, i, 83);
    // Top puffs up mid-square; the front hangs lower between seams.
    const lift = i <= 3 ? 0.05 * f : 0;
    const droop = i >= 5 ? -0.08 * f - 0.05 * n : 0;
    const out = i >= 4 ? 0.04 * f : 0;
    return [out, lift + droop];
  };
  // End taper: the first 0.5 units round off toward the corner.
  const taper = (x: number): number => {
    const t = Math.min(1, (x - xd0) / 0.5);
    return Math.sqrt(t * (2 - t));
  };
  const dcols: number[] = [];
  for (let x = xd0; x < x1; x += x - xd0 < 0.5 ? 0.125 : x - xd0 < 20 ? QUILT / 4 : 2.5) dcols.push(x);
  dcols.push(x1);
  const pointAt = (x: number, i: number): [number, number, number] => {
    const [f, y] = prof[i];
    const [o, dy] = puff(x, i);
    const tp = taper(x);
    const cy = SKIRT_TOP + 0.4; // the profile's centre the taper shrinks toward
    return [x, cy + (y + dy - cy) * (0.7 + 0.3 * tp), L.skirtZ - (f + o) * (i >= 3 ? tp : 1)];
  };
  const duvetShade = (x: number, i: number, ny: number): number => {
    const q = (x - xd0) / QUILT;
    const seam = Math.pow(Math.abs(Math.cos(q * Math.PI)), 12); // quilting seams darker
    let k = 0.94 - 0.12 * seam + 0.05 * (noise(x / 3, i, 91) - 0.5);
    if (i >= 6) k *= 0.88 - (0.1 * (i - 6)) / 3; // the underside of the roll
    k *= 0.85 + 0.15 * Math.max(0, ny);
    return k;
  };
  const drows: number[][] = [];
  for (const x of dcols) {
    const row: number[] = [];
    const pts = prof.map((_p, i) => pointAt(x, i));
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      // Outward normal of the profile in the (z, y) plane: rotate the tangent.
      const tz = b[2] - a[2];
      const ty = b[1] - a[1];
      const l = Math.hypot(tz, ty) || 1;
      const nz = ty / l; // the profile runs back-to-front then down: this side is outward
      const ny = -tz / l;
      const [px, py, pz] = pts[i];
      // UVs squeezed so the duvet samples only a soft smear of the wool: smooth cotton.
      row.push(g.vert(px, py, pz, 0, ny, nz, px * 0.03, (py + pz) * 0.03, duvetCol.scale(duvetShade(px, i, ny))));
    }
    drows.push(row);
  }
  for (let k = 0; k < drows.length - 1; k++)
    for (let i = 0; i < prof.length - 1; i++)
      g.quad(drows[k][i], drows[k + 1][i], drows[k + 1][i + 1], drows[k][i + 1]);
  // End cap (faces -x): a fan from the profile's centre.
  {
    const pts = prof.map((_p, i) => pointAt(xd0, i));
    let cy = 0,
      cz = 0;
    for (const p of pts) {
      cy += p[1] / pts.length;
      cz += p[2] / pts.length;
    }
    const c = duvetCol.scale(0.8);
    const centre = g.vert(xd0 - 0.02, cy, cz, -1, 0.2, 0, 0, 0, c);
    const ring = pts.map((p) => g.vert(p[0], p[1], p[2], -1, 0.2, 0, p[2] * 0.03, p[1] * 0.03, c));
    for (let i = 0; i < ring.length - 1; i++) g.tri(centre, ring[i], ring[i + 1]);
    g.tri(centre, ring[ring.length - 1], ring[0]);
  }
  const mesh = buildMesh(scene, 'envBedSkirt', g.data(), skirtMaterial(scene, look));
  look.receiveShadows(mesh);
  return mesh;
}

// ---------- sunlight ----------
const SUN_WIDTH = 12; // the pool's extent along z
const SUN_REACH = 17; // and along the sun's horizontal direction
const SUN_FOOT_X = 10; // its window end starts this far left of the rug
const SUN_Z = 0.12; // its window end starts at this fraction of the lane
// The window's light pool: a parallelogram on the floor. Across the window (u) runs along
// z; up the window (v) runs along the sun's horizontal direction, so the pool leans the
// way the shadows do.
function buildSunPatch(scene: Scene, look: Look, L: Layout): Mesh {
  const d = KEY_DIRECTION;
  const horiz = Math.hypot(d.x, d.z);
  const hx = d.x / horiz;
  const hz = d.z / horiz;
  const width = SUN_WIDTH; // along z
  const reach = SUN_REACH; // along the sun's horizontal direction
  // Foot of the pool (window end) on the floor, left of the lane, mid-lane.
  const fx = -L.hw - SUN_FOOT_X;
  const fz = L.laneLength * SUN_Z;
  const y = 0.0125;
  const corners: [number, number, number, number][] = [
    [fx, fz, 0, 0],
    [fx, fz + width, 1, 0],
    [fx + hx * reach, fz + width + hz * reach, 1, 1],
    [fx + hx * reach, fz + hz * reach, 0, 1],
  ];
  const g = new Geo();
  const ids = corners.map(([x, z, u, v]) => g.vert(x, y, z, 0, 1, 0, u, v, [1, 1, 1]));
  g.quad(ids[0], ids[1], ids[2], ids[3]);
  const mesh = buildMesh(scene, 'envSunPatch', g.data(), sunMaterial(scene, look));
  mesh.receiveShadows = false;
  sunBlend(mesh);
  return mesh;
}

// ---------- game API ----------
export function createEnvironment(scene: Scene, look: Look, opts: EnvironmentOptions): EnvironmentModel {
  const L = layoutOf(opts);
  const root = new TransformNode('environment', scene);
  const seed = 1337 + Math.round(opts.laneLength * 7);
  const meshes = [
    buildFloor(scene, look, L, seed),
    buildRug(scene, look, L),
    buildBorder(scene, look, L),
    buildWall(scene, look, L),
    buildBaseboard(scene, look, L),
    buildSkirt(scene, look, L),
    buildSunPatch(scene, look, L),
  ];
  for (const m of meshes) {
    m.parent = root;
    m.isPickable = false;
  }
  // The sun pool's strength follows the quality tier (see SUN_STRENGTH_LDR).
  const sunTex = (meshes[6].material as StandardMaterial | null)?.emissiveTexture ?? null;
  const applySun = (): void => {
    if (sunTex) sunTex.level = look.pipeline ? SUN_STRENGTH : SUN_STRENGTH_LDR;
  };
  applySun();
  const unsubscribe = look.onQualityChange(applySun);
  const wall = srgb(HEX.wall).scale(0.86);
  return {
    root,
    clearColor: new Color4(wall.r, wall.g, wall.b, 1),
    meshes,
    ready: floorReady.get(meshes[0].material as PBRMaterial) ?? Promise.resolve(),
    dispose() {
      unsubscribe();
      root.dispose(false, false);
    },
  };
}

// ---------- preview ----------
// Builds the environment for a 10 x 55 lane in lane coordinates. The harness turns
// 'neutral' models by PI in the 'game' view; an inner node turns it back, so the game
// shot is the real in-game frame (without units). Variant 'units' adds a few plain
// team-coloured pawns to judge readability on the rug.
export function preview(scene: Scene, look: Look, opts: PreviewOptions): PreviewResult {
  const root = new TransformNode('environmentPreview', scene);
  const inner = new TransformNode('environmentPreviewInner', scene);
  inner.parent = root;
  inner.rotation.y = Math.PI;
  // The harness's own stage floor and rug would z-fight with ours: hide them while we show.
  const hidden: AbstractMesh[] = [];
  for (const name of ['previewFloor', 'previewRug']) {
    const m = scene.getMeshByName(name);
    if (m && m.isEnabled()) {
      m.setEnabled(false);
      hidden.push(m);
    }
  }
  const oldClear = scene.clearColor.clone();
  const env = createEnvironment(scene, look, { laneWidth: 10, laneLength: 55, zMin: -3, zMax: 59 });
  env.root.parent = inner;
  scene.clearColor = env.clearColor;
  const extra: Mesh[] = [];
  if (opts.variant === 'units') {
    const profile: [number, number][] = [
      [0, 0],
      [0.27, 0],
      [0.28, 0.05],
      [0.16, 0.12],
      [0.13, 0.55],
      [0.2, 0.7],
      [0.2, 0.9],
      [0.14, 1.05],
      [0.17, 1.12],
      [0.12, 1.22],
      [0, 1.28],
    ];
    const vd = bakeVertexAO(lathe(profile, 12), { samples: 12, strength: 0.5 });
    const pawn = buildMesh(
      scene,
      'envPreviewPawns',
      vd,
      look.material('env-preview-pawn', () => plasticMaterial(scene, null, { instanceColor: true })),
    );
    pawn.parent = inner;
    const r = rng(5);
    const mats: number[] = [];
    const cols: number[] = [];
    const put = (x: number, z: number, team: 'player' | 'enemy'): void => {
      mats.push(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, z, 1);
      const c = teamColor(team);
      cols.push(c.r, c.g, c.b, 1);
    };
    for (let k = 0; k < 140; k++) put((r() - 0.5) * 6, 4 + r() * 12, 'player');
    for (let k = 0; k < 90; k++) put((r() - 0.5) * 7, 30 + r() * 14, 'enemy');
    for (let k = 0; k < 14; k++) put(-4.7 + r() * 0.3, 20 + k * 1.2, k % 2 ? 'enemy' : 'player'); // at the very edge
    pawn.thinInstanceSetBuffer('matrix', new Float32Array(mats), 16, true);
    pawn.thinInstanceSetBuffer('color', new Float32Array(cols), 4, true);
    look.addShadowCaster(pawn, 'crowd');
    extra.push(pawn);
  }
  return {
    root,
    dispose() {
      env.dispose();
      for (const m of extra) m.dispose();
      root.dispose();
      for (const m of hidden) m.setEnabled(true);
      scene.clearColor = oldClear;
    },
  };
}
