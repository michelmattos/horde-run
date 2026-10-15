// Procedural, tileable surface textures generated in JS (no downloads, no canvas): wood
// grain, fabric weave, paper fibre and a soft radial blob. Each is a small power-of-two
// RawTexture with mipmaps, greyscale-ish so a material's albedoColor tints it, plus a
// matching tangent-space normal map. Cached per scene and kind, so every material that
// asks for 'wood' shares one upload. A model or the environment may instead load a
// downloaded CC0 texture (ambientcg / polyhaven) and pass it to the material recipes.
import type { Scene } from '@babylonjs/core/scene';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Constants } from '@babylonjs/core/Engines/constants';

export type SurfaceKind = 'wood' | 'fabric' | 'paper' | 'plastic';

export interface SurfaceTextures {
  albedo: Texture; // sRGB, values near 1 so albedoColor sets the colour
  normal: Texture; // tangent-space normal map (OpenGL convention, +Y up)
}

const SIZE = 256;
const cache = new WeakMap<Scene, Map<string, SurfaceTextures | Texture>>();

function sceneCache(scene: Scene): Map<string, SurfaceTextures | Texture> {
  let m = cache.get(scene);
  if (!m) {
    m = new Map();
    cache.set(scene, m);
  }
  return m;
}

// ---------- tileable noise ----------
function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// Periodic value noise: period p lattice cells across the texture.
function vnoise(u: number, v: number, p: number, seed: number): number {
  const x = u * p;
  const y = v * p;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const w = (i: number): number => ((i % p) + p) % p;
  const a = hash(w(x0), w(y0), seed);
  const b = hash(w(x0 + 1), w(y0), seed);
  const c = hash(w(x0), w(y0 + 1), seed);
  const d = hash(w(x0 + 1), w(y0 + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(u: number, v: number, p: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += vnoise(u, v, p << o, seed + o * 31) * amp;
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

// ---------- height fields (0..1) and albedo multipliers ----------
interface Field {
  height: Float32Array;
  albedo: Float32Array; // rgb per texel
}

function makeField(fn: (u: number, v: number) => [number, number, number, number]): Field {
  const height = new Float32Array(SIZE * SIZE);
  const albedo = new Float32Array(SIZE * SIZE * 3);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const [h, r, g, b] = fn(x / SIZE, y / SIZE);
      const i = y * SIZE + x;
      height[i] = h;
      albedo[i * 3] = r;
      albedo[i * 3 + 1] = g;
      albedo[i * 3 + 2] = b;
    }
  }
  return { height, albedo };
}

// Grain runs along V (texture rows); rings warped by noise, with darker late wood.
function woodField(): Field {
  return makeField((u, v) => {
    const warp = fbm(u, v, 4, 3, 7) * 2.2 + fbm(u, v * 0.25, 2, 2, 9) * 1.5;
    const rings = u * 6 + warp * 0.8;
    const t = rings - Math.floor(rings);
    const late = Math.pow(Math.sin(t * Math.PI), 6); // thin dark late-wood band
    const fleck = fbm(u * 1, v, 32, 2, 3);
    const k = 1 - late * 0.12 - (fleck - 0.5) * 0.06;
    // Slightly warmer in the dark bands.
    return [1 - late * 0.6, k, k * 0.97, k * 0.93];
  });
}

// Plain weave: threads alternate over/under every cell; soft fuzz on top.
function fabricField(): Field {
  const cells = 32;
  return makeField((u, v) => {
    const cx = u * cells;
    const cy = v * cells;
    const ix = Math.floor(cx);
    const iy = Math.floor(cy);
    const fx = cx - ix;
    const fy = cy - iy;
    const warpOver = (ix + iy) % 2 === 0;
    const across = warpOver ? Math.sin(fx * Math.PI) : Math.sin(fy * Math.PI);
    const along = warpOver ? Math.sin(fy * Math.PI) * 0.35 + 0.65 : Math.sin(fx * Math.PI) * 0.35 + 0.65;
    const fuzz = fbm(u, v, 64, 2, 5);
    const h = across * along * 0.85 + fuzz * 0.15;
    const k = 0.82 + h * 0.18 + (fuzz - 0.5) * 0.06;
    return [h, k, k, k];
  });
}

function paperField(): Field {
  return makeField((u, v) => {
    const fibre = fbm(u, v * 0.4, 32, 3, 11);
    const mottle = fbm(u, v, 4, 3, 13);
    const k = 0.95 + (mottle - 0.5) * 0.06 + (fibre - 0.5) * 0.03;
    return [fibre * 0.6 + mottle * 0.4, k, k, k * 0.98];
  });
}

// Very fine moulding texture for plastic and tin: almost flat, breaks up perfect highlights.
function plasticField(): Field {
  return makeField((u, v) => {
    const n = fbm(u, v, 16, 3, 17);
    return [n, 1, 1, 1];
  });
}

function toRgba(field: Field): Uint8Array {
  const out = new Uint8Array(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) {
    out[i * 4] = Math.round(Math.min(1, field.albedo[i * 3]) * 255);
    out[i * 4 + 1] = Math.round(Math.min(1, field.albedo[i * 3 + 1]) * 255);
    out[i * 4 + 2] = Math.round(Math.min(1, field.albedo[i * 3 + 2]) * 255);
    out[i * 4 + 3] = 255;
  }
  return out;
}

// Central differences on the wrapped height field → tangent-space normal (OpenGL +Y).
function toNormal(field: Field, strength: number): Uint8Array {
  const h = field.height;
  const out = new Uint8Array(SIZE * SIZE * 4);
  const at = (x: number, y: number): number => h[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * SIZE + x) * 4;
      out[i] = Math.round((-dx / len) * 127.5 + 127.5);
      out[i + 1] = Math.round((dy / len) * 127.5 + 127.5);
      out[i + 2] = Math.round((1 / len) * 127.5 + 127.5);
      out[i + 3] = 255;
    }
  }
  return out;
}

function raw(scene: Scene, name: string, data: Uint8Array, gamma: boolean): Texture {
  const t = RawTexture.CreateRGBATexture(
    data,
    SIZE,
    SIZE,
    scene,
    true,
    false,
    Texture.TRILINEAR_SAMPLINGMODE,
    Constants.TEXTURETYPE_UNSIGNED_BYTE,
  );
  t.name = name;
  t.wrapU = Texture.WRAP_ADDRESSMODE;
  t.wrapV = Texture.WRAP_ADDRESSMODE;
  t.anisotropicFilteringLevel = 4;
  t.gammaSpace = gamma;
  return t;
}

const NORMAL_STRENGTH: Record<SurfaceKind, number> = { wood: 3, fabric: 10, paper: 4, plastic: 2 };
const FIELDS: Record<SurfaceKind, () => Field> = {
  wood: woodField,
  fabric: fabricField,
  paper: paperField,
  plastic: plasticField,
};

// Shared albedo + normal textures for a surface kind. Do not dispose them yourself: they
// live as long as the scene. Clone() a texture if you need a different uScale/vScale.
export function surfaceTextures(scene: Scene, kind: SurfaceKind): SurfaceTextures {
  const c = sceneCache(scene);
  const hit = c.get(kind) as SurfaceTextures | undefined;
  if (hit) return hit;
  const field = FIELDS[kind]();
  const tex: SurfaceTextures = {
    albedo: raw(scene, `look-${kind}-albedo`, toRgba(field), true),
    normal: raw(scene, `look-${kind}-normal`, toNormal(field, NORMAL_STRENGTH[kind]), false),
  };
  c.set(kind, tex);
  return tex;
}

// Soft radial falloff (white centre → transparent edge) for blob shadows, glows and puffs.
export function radialTexture(scene: Scene): Texture {
  const c = sceneCache(scene);
  const hit = c.get('radial') as Texture | undefined;
  if (hit) return hit;
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n - 0.5;
      const dy = (y + 0.5) / n - 0.5;
      const r = Math.min(1, Math.hypot(dx, dy) * 2);
      const a = Math.pow(1 - r, 1.6) * (1 - r * r);
      const i = (y * n + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  const t = RawTexture.CreateRGBATexture(data, n, n, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  t.name = 'look-radial';
  t.hasAlpha = true;
  t.wrapU = Texture.CLAMP_ADDRESSMODE;
  t.wrapV = Texture.CLAMP_ADDRESSMODE;
  c.set('radial', t);
  return t;
}

// True for the scene-wide procedural textures above (surfaces and the radial blob): they
// are shared by many materials and must survive a material release.
export function isSharedTexture(scene: Scene, t: unknown): boolean {
  const c = cache.get(scene);
  if (!c) return false;
  for (const v of c.values()) {
    if (v === t) return true;
    if ('albedo' in v && (v.albedo === t || v.normal === t)) return true;
  }
  return false;
}
