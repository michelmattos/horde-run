// Freezer room: the World 2 "Freezer / Snow Globe" diorama, the inside of a big chest
// freezer seen as a giant toy box. Same API shape as createEnvironment (environment.ts).
//
//   - FLOOR: the freezer's moulded white plastic liner under a dusting of frost: a 512 px
//     procedural frost texture (fern-like ice crystals in its normal map, faint crystal
//     sparkle in the albedo) under an icy clearcoat, cool vertex-colour drift, lighter
//     frost patches, contact darkening, and soft snow drifts banked against the back wall.
//     One draw call.
//   - RUNNER (the lane): a knitted winter runner in deep glacier blue, lane.width wide,
//     with Nordic snowflake bands every 10 units (lighter blue knit, low contrast so both
//     armies read on it), a frosted lighter rim and a soft blue sheen. Knit stitches are a
//     512 px texture (one repeat = 10 x 10 units, ~0.2 unit stitches). Its top is at
//     RUG_Y like the bedroom rug, under the look's blob shadows. One draw call.
//   - BORDER: a cream binding with blue cross-stitches and a rolled edge. One draw call.
//   - BACK WALL: frosty liner wall (one call) with a giant ice-cube tray stood on its edge
//     in front of it: glossy pale-blue plastic cells, some still holding ice cubes (one call).
//   - SNOW GLOBE: right of the enemy base, a big snow globe on a red-and-brass plinth with
//     a tiny snowy cabin whose windows glow warm (the room's warm accent), teal pines and
//     frozen flakes inside (one call), under a clear glass dome (one call), throwing a soft
//     warm pool of light on the frost in front of it (a multiplicative decal, one call).
//   Total: 8 draw calls, ~18k triangles, no downloads: every texture is procedural and
//   cached in the look's material cache under 'freezer-room-*' (index.ts releases them with
//   look.releaseMaterials('freezer-') when the theme changes back to the bedroom).
//   Nothing is animated per frame.
//
// GAME API (level.ts, by LevelDef.theme === 'freezer'):
//   const room = createFreezerRoom(scene, look, { laneWidth, laneLength, zMin: -3, zMax: L + 4 });
//   scene.clearColor = room.clearColor;
//   room.dispose();   // meshes only; materials stay cached while the theme stays
// Built in LANE coordinates like the environment (parent it without rotation).
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Look } from '../look/index.ts';
import {
  bakeVertexAO,
  buildMesh,
  fabricMaterial,
  glassMaterial,
  lathe,
  lin,
  mergeParts,
  paint,
  place,
  plasticMaterial,
  roundedBox,
  srgb,
  teamColor,
} from '../look/index.ts';
import type { ModelInfo, PreviewOptions, PreviewResult } from '../look/model.ts';
import type { EnvironmentModel, EnvironmentOptions } from './environment.ts';
import {
  FLOOR_Y,
  Geo,
  RUG_Y,
  heightToNormal,
  noise,
  rawImageProcessing,
  rawTex,
  rng,
  sunBlend,
  tfbm,
  tnoise,
} from './environment.ts';

export const info: ModelInfo = {
  key: 'freezerRoom',
  title: 'Freezer room: frosted liner, knitted runner lane, ice-cube tray wall, snow globe',
  instanced: false,
  teams: false,
  side: 'neutral',
  height: 12,
  triangleBudget: 20000,
  gameZ: 0,
  variants: ['empty', 'units'],
};

// ---------- palette (sRGB) ----------
const LINER = '#cbd9e3'; // frosted white plastic: kept under the white ceiling so it never blows out
const LINER_COOL = '#a9c2d6'; // hollows and shade
const FROST = '#e3ecf2'; // frost patches and drifts
const RUNNER = '#2a5679'; // deep glacier-blue knit: darker than both armies, a different hue
const RUNNER_DARK = '#1f405f';
const RUNNER_FROST = '#7d9fbd'; // frosted rim
const BORDER_CREAM = '#ece4d2';
const BORDER_THREAD = '#3a6c9c';
const TRAY = '#9cc6df';
const ICE = '#d9ecf5';
const PLINTH = '#a8322c'; // snow-globe plinth: lacquered red with a brass band
const CABIN = '#8c5a3a';
const PINE = '#2c6669'; // teal pines (never green: props must not read as the army)

const BORDER_W = 0.4;
const RUNNER_RADIUS = 0.6;
const KNIT = 10; // world units per knit texture repeat (u across the lane, v along it)
const FROST_REPEAT = 4.2;
const FLOOR_HALF_W = 130;
const WALL_HEIGHT = 30;
const TRAY_TOP = 7.4;
const TRAY_HW = 34;
const CELL = 1.7;
const CELL_RIM = 0.24;
const CELL_DEPTH = 0.55;
const GLOBE_X = 12.4;
const GLOBE_R = 2.9;
const PLINTH_H = 1.15;
const WINDOW_GLOW = 2.2; // emissive strength of the cabin windows (they bloom a little)
const GLOW_STRENGTH = 0.22; // warm pool under the globe (HDR pipeline)
const GLOW_STRENGTH_LDR = 0.1;

interface Layout {
  hw: number;
  z0: number; // runner outer edge, player end
  z1: number; // runner outer edge, enemy end
  wallZ: number;
  floorZ0: number;
  laneLength: number;
}

function layoutOf(o: EnvironmentOptions): Layout {
  const wallZ = o.zMax + 6;
  return {
    hw: o.laneWidth / 2,
    z0: o.zMin - 1.5,
    z1: o.zMax + 1.5,
    wallZ,
    floorZ0: o.zMin - 16,
    laneLength: o.laneLength,
  };
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

// ---------- procedural textures ----------

// Frost: feathery six-armed ice crystals (each arm with side branches at 60 degrees)
// rasterised into a wrapped height field over a faint mottle. Greyscale albedo near 0.93
// with the crystals a touch brighter; the crystals carry most of their look in the normal map.
function frostTextures(scene: Scene): { albedo: Texture; normal: Texture } {
  const S = 512;
  const h = new Float32Array(S * S);
  const spark = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) h[y * S + x] = tfbm(x / S, y / S, 8, 8, 3, 31) * 0.22;
  const r = rng(77);
  // Soft line splat in the wrapped domain (pixel units).
  const line = (ax: number, ay: number, bx: number, by: number, w: number, k: number): void => {
    const x0 = Math.floor(Math.min(ax, bx) - w - 1);
    const x1 = Math.ceil(Math.max(ax, bx) + w + 1);
    const y0 = Math.floor(Math.min(ay, by) - w - 1);
    const y1 = Math.ceil(Math.max(ay, by) + w + 1);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const t = clamp01(((px - ax) * dx + (py - ay) * dy) / len2);
        const d = Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
        if (d > w) continue;
        const v = k * (1 - (d / w) * (d / w)) * (1 - t * 0.35);
        const i = (((py % S) + S) % S) * S + (((px % S) + S) % S);
        if (v > h[i]) h[i] = v;
        if (v > spark[i]) spark[i] = v;
      }
    }
  };
  for (let c = 0; c < 34; c++) {
    const cx = r() * S;
    const cy = r() * S;
    const R = 14 + r() * 34;
    const rot = r() * Math.PI;
    const k = 0.55 + r() * 0.4;
    for (let a = 0; a < 6; a++) {
      const ang = rot + (a * Math.PI) / 3;
      const ex = cx + Math.cos(ang) * R;
      const ey = cy + Math.sin(ang) * R;
      line(cx, cy, ex, ey, 1.5, k);
      for (const f of [0.35, 0.6, 0.82]) {
        const bx = cx + Math.cos(ang) * R * f;
        const by = cy + Math.sin(ang) * R * f;
        const bl = R * (1 - f) * 0.55;
        for (const s of [-1, 1]) {
          const ba = ang + (s * Math.PI) / 3;
          line(bx, by, bx + Math.cos(ba) * bl, by + Math.sin(ba) * bl, 1.1, k * 0.8);
        }
      }
    }
  }
  const alb = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    const mott = tnoise((i % S) / S, Math.floor(i / S) / S, 16, 16, 9);
    const k = Math.min(1, 0.9 + spark[i] * 0.1 + (mott - 0.5) * 0.05);
    alb[i * 4] = Math.round(k * 0.975 * 255);
    alb[i * 4 + 1] = Math.round(k * 0.99 * 255);
    alb[i * 4 + 2] = Math.round(k * 255);
    alb[i * 4 + 3] = 255;
  }
  return {
    albedo: rawTex(scene, 'freezer-frost-albedo', alb, S, S, true),
    normal: rawTex(scene, 'freezer-frost-normal', heightToNormal(h, S, S, 2.4), S, S, false),
  };
}

// An eight-pointed Nordic star on the stitch grid (13 x 13 stitches).
function nordicStar(i: number, j: number): boolean {
  const a = Math.abs(i);
  const b = Math.abs(j);
  if (a > 6 || b > 6) return false;
  if (a === 0 || b === 0) return a + b !== 2; // the cross, with a gap around the centre
  if (a === b) return a <= 4; // diagonals
  if ((a === 6 && b === 1) || (a === 1 && b === 6)) return true; // barbs at the arm tips
  return a + b === 2; // a small diamond round the centre
}

// Knitted runner: rows of V stitches (each a pair of slanted plump legs) 48 across x 60
// along one 10-unit repeat, a Nordic band (dotted rows, solid rows, a row of stars, two
// per lane width) across the middle of each repeat. Greyscale (vertex colours carry the
// blue): the plain knit ~0.74, the motif stitches near white so they read as a lighter blue.
function knitTextures(scene: Scene): { albedo: Texture; normal: Texture } {
  const S = 512;
  const COLS = 48;
  const ROWS = 60;
  const h = new Float32Array(S * S);
  const alb = new Uint8Array(S * S * 4);
  const motif = (col: number, row: number): boolean => {
    const r0 = row - 30; // band centre
    if (Math.abs(r0) === 10) return col % 2 === 0; // dotted rows
    if (Math.abs(r0) === 9) return true; // solid rows
    if (Math.abs(r0) === 8) return (col + (r0 > 0 ? 1 : 0)) % 4 === 0; // little peaks
    const c0 = (((col % 20) + 20) % 20) - 10;
    return nordicStar(c0, r0);
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const cx = (x / S) * COLS;
      const cy = (y / S) * ROWS;
      const ix = Math.floor(cx);
      const iy = Math.floor(cy);
      const fx = cx - ix;
      const fy = cy - iy;
      // Two legs of the V in stitch space scaled to its real aspect (0.25 x 0.2 units).
      const legs = (sx: number): number => {
        // Leg from (0.5 + sx * 0.46, 1.05) down to (0.5, -0.05).
        const ax = 0.5 + sx * 0.46;
        const ay = 1.05;
        const bx = 0.5;
        const by = -0.05;
        const dx = (bx - ax) * 1.25;
        const dy = by - ay;
        const px = (fx - ax) * 1.25;
        const py = fy - ay;
        const t = clamp01((px * dx + py * dy) / (dx * dx + dy * dy));
        const d = Math.hypot(px - dx * t, py - dy * t);
        const w = 0.3;
        return d < w ? Math.sqrt(1 - (d / w) * (d / w)) : 0;
      };
      const leg = Math.max(legs(-1), legs(1));
      const fibre = tfbm(x / S, y / S, 128, 128, 2, 41);
      const hh = leg * 0.85 + fibre * 0.15;
      h[y * S + x] = hh;
      const on = motif(ix, iy);
      const base = on ? 1.0 : 0.74;
      const k = base * (0.84 + 0.16 * leg) + (fibre - 0.5) * 0.05;
      const g = Math.round(clamp01(k) * 255);
      const i = (y * S + x) * 4;
      alb[i] = g;
      alb[i + 1] = g;
      alb[i + 2] = Math.min(255, g + 3);
      alb[i + 3] = 255;
    }
  }
  return {
    albedo: rawTex(scene, 'freezer-knit-albedo', alb, S, S, true),
    normal: rawTex(scene, 'freezer-knit-normal', heightToNormal(h, S, S, 2.0), S, S, false),
  };
}

// Border binding: cream twill with a row of blue cross-stitches down the middle and a
// blanket stitch along the inner edge. u across (0 outer .. 1 inner), v along (2.4 units).
const BORDER_REPEAT = 2.4;
function borderTextures(scene: Scene): { albedo: Texture; normal: Texture } {
  const W = 128;
  const H = 512;
  const h = new Float32Array(W * H);
  const alb = new Uint8Array(W * H * 4);
  const cream = srgb(BORDER_CREAM);
  const thread = srgb(BORDER_THREAD);
  const crosses = 8; // per repeat (0.3 units apart)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const v = y / H;
      const ribs = 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * 12 + tnoise(u, v, 8, 16, 3) * 2);
      const fibre = tfbm(u, v, 16, 128, 2, 13);
      let st = 0;
      // Cross-stitch: two diagonal strokes in a cell centred at u = 0.45.
      const cv = v * crosses;
      const fv = cv - Math.floor(cv);
      const du = (u - 0.45) / 0.3; // -1..1 across the cell
      const dv = (fv - 0.5) * 2;
      if (Math.abs(du) < 1 && Math.abs(dv) < 0.8) {
        const d1 = Math.abs(du - dv) / Math.SQRT2;
        const d2 = Math.abs(du + dv) / Math.SQRT2;
        st = Math.max(st, Math.max(0, 1 - Math.min(d1, d2) / 0.14));
      }
      // Blanket stitch along the inner edge: a line at u = 0.86 with ticks every 0.15 units.
      const along = Math.max(0, 1 - Math.abs(u - 0.86) / 0.03);
      const tick = v * 16 - Math.floor(v * 16);
      const tickOn = tick < 0.18 && u > 0.7 && u < 0.88 ? Math.max(0, 1 - Math.abs(tick - 0.09) / 0.09) : 0;
      st = Math.max(st, along * 0.9, tickOn * 0.9);
      h[y * W + x] = ribs * 0.35 + fibre * 0.25 + st * 0.5;
      const k = 0.9 + (fibre - 0.5) * 0.14 + (ribs - 0.5) * 0.05;
      const i = (y * W + x) * 4;
      const mix = (a: number, b: number): number => Math.round(clamp01(a * k * (1 - st) + b * st) * 255);
      alb[i] = mix(cream.r, thread.r);
      alb[i + 1] = mix(cream.g, thread.g);
      alb[i + 2] = mix(cream.b, thread.b);
      alb[i + 3] = 255;
    }
  }
  return {
    albedo: rawTex(scene, 'freezer-border-albedo', alb, W, H, true),
    normal: rawTex(scene, 'freezer-border-normal', heightToNormal(h, W, H, 2.5), W, H, false),
  };
}

// Warm pool of light under the snow globe: a soft amber ellipse (linear light amount).
function glowTexture(scene: Scene): Texture {
  const S = 64;
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S - 0.5;
      const v = (y + 0.5) / S - 0.5;
      const r = Math.min(1, Math.hypot(u, v) * 2);
      const a = Math.pow(1 - r, 2) * (1 - r * 0.3);
      const i = (y * S + x) * 4;
      data[i] = Math.round(a * 255);
      data[i + 1] = Math.round(a * 0.68 * 255);
      data[i + 2] = Math.round(a * 0.34 * 255);
      data[i + 3] = 255;
    }
  }
  return rawTex(scene, 'freezer-glow', data, S, S, false, false);
}

// ---------- materials (shared per look under 'freezer-room-*') ----------

const frostCache = new WeakMap<Look, { albedo: Texture; normal: Texture }>();
function sharedFrost(scene: Scene, look: Look): { albedo: Texture; normal: Texture } {
  let f = frostCache.get(look);
  if (!f || f.albedo.getScene() !== scene || !f.albedo.getInternalTexture()) {
    f = frostTextures(scene);
    frostCache.set(look, f);
  }
  return f;
}

function linerMaterial(scene: Scene, look: Look, key: string, clearcoat: number): PBRMaterial {
  return look.material(`freezer-room-${key}`, () => {
    const t = sharedFrost(scene, look);
    const m = plasticMaterial(scene, null, {
      name: `freezer-room-${key}`,
      albedoTexture: t.albedo,
      normalTexture: t.normal,
      normalStrength: 0.55,
      roughness: 0.5,
      clearcoat,
      clearcoatRoughness: 0.18,
      envIntensity: 0.8,
    });
    return m;
  });
}

function runnerMaterial(scene: Scene, look: Look): PBRMaterial {
  return look.material('freezer-room-runner', () => {
    const t = knitTextures(scene);
    const m = fabricMaterial(scene, null, {
      name: 'freezer-room-runner',
      albedoTexture: t.albedo,
      normalTexture: t.normal,
      normalStrength: 0.8,
      roughness: 0.93,
      envIntensity: 0.7,
    });
    m.sheen.color = lin('#9cc0e0');
    m.sheen.intensity = 0.7;
    m.sheen.roughness = 0.5;
    return m;
  });
}

function borderMaterial(scene: Scene, look: Look): PBRMaterial {
  return look.material('freezer-room-border', () => {
    const t = borderTextures(scene);
    const m = fabricMaterial(scene, null, {
      name: 'freezer-room-border',
      albedoTexture: t.albedo,
      normalTexture: t.normal,
      normalStrength: 0.6,
      roughness: 0.9,
      envIntensity: 0.7,
    });
    m.sheen.color = lin('#f6f1e6');
    m.sheen.intensity = 0.2;
    return m;
  });
}

function trayMaterial(scene: Scene, look: Look): PBRMaterial {
  return look.material('freezer-room-tray', () =>
    plasticMaterial(scene, null, {
      name: 'freezer-room-tray',
      roughness: 0.2,
      clearcoat: 0.7,
      clearcoatRoughness: 0.08,
      envIntensity: 1.1,
    }),
  );
}

// The globe's insides and plinth: vertex colours, plus an emissive lookup (u < 0.5 dark,
// u > 0.5 warm lamplight) so the cabin windows glow in the same draw call.
function globeMaterial(scene: Scene, look: Look): PBRMaterial {
  return look.material('freezer-room-globe', () => {
    const data = new Uint8Array([0, 0, 0, 255, 255, 176, 92, 255]);
    const tex = RawTexture.CreateRGBATexture(data, 2, 1, scene, false, false, Texture.NEAREST_SAMPLINGMODE);
    tex.name = 'freezer-room-globe-glow';
    tex.wrapU = Texture.CLAMP_ADDRESSMODE;
    tex.wrapV = Texture.CLAMP_ADDRESSMODE;
    const m = plasticMaterial(scene, null, {
      name: 'freezer-room-globe',
      roughness: 0.42,
      clearcoat: 0.45,
      envIntensity: 0.9,
    });
    m.emissiveTexture = tex;
    m.emissiveColor = Color3.White();
    m.emissiveIntensity = WINDOW_GLOW;
    return m;
  });
}

function domeMaterial(scene: Scene, look: Look): PBRMaterial {
  return look.material('freezer-room-dome', () => {
    const m = glassMaterial(scene, '#e4f1fb', {
      name: 'freezer-room-dome',
      alpha: 0.14,
      envIntensity: 1.8,
      roughness: 0.03,
    });
    m.useRadianceOverAlpha = true;
    m.useSpecularOverAlpha = true;
    m.backFaceCulling = true;
    return m;
  });
}

function glowMaterial(scene: Scene, look: Look): StandardMaterial {
  return look.material('freezer-room-glow', () => {
    const m = new StandardMaterial('freezer-room-glow', scene);
    m.disableLighting = true;
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.emissiveColor = Color3.Black();
    m.emissiveTexture = glowTexture(scene);
    m.alpha = 0.999;
    m.alphaMode = Constants.ALPHA_ADD;
    m.imageProcessingConfiguration = rawImageProcessing();
    m.disableDepthWrite = true;
    m.zOffset = -3;
    return m;
  });
}

// ---------- floor and drifts ----------

function linerShade(L: Layout, x: number, z: number): Color3 {
  const base = lin(LINER);
  let k = 0.95 + 0.08 * noise(x / 9, z / 7, 101) + 0.035 * (noise(x / 2.3, z / 2.1, 103) - 0.5);
  // Contact darkening at the back wall (mostly under the drift) and a halo beside the runner.
  k *= 1 - 0.3 * Math.exp(-Math.max(0, L.wallZ - z) / 1.2);
  const dx = Math.abs(x) - (L.hw + BORDER_W);
  if (dx > -0.05 && z > L.z0 && z < L.z1) k *= 1 - 0.2 * Math.exp(-Math.max(0, dx) / 0.3);
  // Hollows cooler, frost patches whiter.
  const cool = clamp01(0.6 - noise(x / 13, z / 11, 107)) * 0.5;
  const frost = smooth(0.55, 0.8, noise(x / 5.5, z / 4.5, 109));
  const c = Color3.Lerp(base, lin(LINER_COOL), cool);
  return Color3.Lerp(c, lin(FROST), frost * 0.55).scale(k / 0.93);
}

function buildFloor(scene: Scene, look: Look, L: Layout): Mesh {
  const g = new Geo();
  const xs: number[] = [];
  for (let x = -FLOOR_HALF_W; x < -26; x += 8) xs.push(x);
  for (let x = -26; x <= 26.001; x += 1.3) xs.push(x);
  for (let x = 34; x <= FLOOR_HALF_W; x += 8) xs.push(x);
  const zs: number[] = [];
  for (let z = L.floorZ0; z < L.wallZ; z += 1.3) zs.push(z);
  zs.push(L.wallZ + 0.2);
  const ids: number[][] = [];
  for (const z of zs) {
    const row: number[] = [];
    for (const x of xs)
      row.push(g.vert(x, FLOOR_Y, z, 0, 1, 0, x / FROST_REPEAT, z / FROST_REPEAT, linerShade(L, x, z)));
    ids.push(row);
  }
  for (let j = 0; j < zs.length - 1; j++)
    for (let i = 0; i < xs.length - 1; i++) g.quad(ids[j][i], ids[j][i + 1], ids[j + 1][i + 1], ids[j + 1][i]);

  // Snow drifts banked against the back wall: a soft rolling mound, taller and deeper in
  // places, whiter than the liner and darker where it meets the floor.
  const drift = lin(FROST);
  const dx: number[] = [];
  for (let x = -FLOOR_HALF_W; x < -30; x += 6) dx.push(x);
  for (let x = -30; x <= 30.001; x += 0.9) dx.push(x);
  for (let x = 36; x <= FLOOR_HALF_W; x += 6) dx.push(x);
  const STEPS = 7;
  const heightAt = (x: number): number => 0.7 + 0.9 * noise(x / 6.5, 3, 113) + 0.25 * noise(x / 2.1, 7, 117);
  const depthAt = (x: number): number => 1.8 + 1.8 * noise(x / 8, 11, 119);
  const pt = (x: number, s: number): [number, number, number] => {
    const H = heightAt(x);
    const D = depthAt(x);
    const d = s * D; // distance out from the wall
    const y = FLOOR_Y + H * Math.pow(1 - s, 1.6) * (0.75 + 0.25 * Math.cos(s * Math.PI * 0.5));
    return [x, y, L.wallZ + 0.05 - d];
  };
  const rows: number[][] = [];
  for (const x of dx) {
    const row: number[] = [];
    for (let k = 0; k <= STEPS; k++) {
      const s = k / STEPS;
      const [px, py, pz] = pt(x, s);
      const [, ya, za] = pt(x, Math.max(0, s - 0.05));
      const [, yb, zb] = pt(x, Math.min(1, s + 0.05));
      const [xa, yl] = [x - 0.3, pt(x - 0.3, s)[1]];
      const yr = pt(x + 0.3, s)[1];
      // Normal from the two tangents (along x and down the slope).
      const tx = [px + 0.3 - xa, yr - yl, 0];
      const ts = [0, yb - ya, zb - za];
      const nx = tx[1] * ts[2] - tx[2] * ts[1];
      const ny = tx[2] * ts[0] - tx[0] * ts[2];
      const nz = tx[0] * ts[1] - tx[1] * ts[0];
      const sgn = ny < 0 ? -1 : 1;
      const shade = (0.8 + 0.2 * smooth(0.6, 0.1, s)) * (s > 0.9 ? 0.92 : 1);
      row.push(
        g.vert(
          px,
          py,
          pz,
          nx * sgn,
          ny * sgn,
          nz * sgn,
          px / FROST_REPEAT,
          pz / FROST_REPEAT,
          drift.scale(shade / 0.93),
        ),
      );
    }
    rows.push(row);
  }
  for (let i = 0; i < rows.length - 1; i++)
    for (let k = 0; k < STEPS; k++) g.quad(rows[i][k], rows[i + 1][k], rows[i + 1][k + 1], rows[i][k + 1]);
  const mesh = buildMesh(scene, 'freezerFloor', g.data(), linerMaterial(scene, look, 'floor', 0.35));
  look.receiveShadows(mesh);
  return mesh;
}

// ---------- the knitted runner (lane) ----------

function outlineHalfWidth(L: Layout, z: number, inset: number): number {
  const R = Math.max(0.001, RUNNER_RADIUS - inset);
  const hw = L.hw + BORDER_W - inset;
  const z0 = L.z0 + inset;
  const z1 = L.z1 - inset;
  const dz = z < z0 + R ? z0 + R - z : z > z1 - R ? z - (z1 - R) : 0;
  return hw - R + Math.sqrt(Math.max(0, R * R - dz * dz));
}

function buildRunner(scene: Scene, look: Look, L: Layout): Mesh {
  const g = new Geo();
  const bz0 = L.z0 + BORDER_W;
  const bz1 = L.z1 - BORDER_W;
  const LIFT = 1.3; // like the rug: wool reads darker than its swatch once lit
  const base = lin(RUNNER).scale(LIFT);
  const dark = lin(RUNNER_DARK).scale(LIFT);
  const frost = lin(RUNNER_FROST);
  const TEX_MEAN = 0.76;
  const color = (x: number, z: number, hwz: number): Color3 => {
    let k = 0.96 + 0.08 * noise(x / 2.8, z / 3.3, 121) + 0.03 * (noise(x / 0.9, z / 1.1, 123) - 0.5);
    k *= 1 + 0.08 * (noise(x / 12, z / 2.6, 125) - 0.5); // dye lots
    const edge = Math.max(0, hwz - Math.abs(x));
    const c = Color3.Lerp(base, dark, 0.25 * Math.exp(-edge / 0.6) + 0.15 * noise(x / 6, z / 8, 127));
    // Frost creeping in from the rim (patchy), never into the middle of the lane.
    const f = 0.3 * Math.exp(-edge / 0.55) * (0.5 + noise(x / 1.5, z / 1.7, 129));
    return Color3.Lerp(c.scale(k / TEX_MEAN), frost.scale(1 / TEX_MEAN), Math.min(0.45, f));
  };
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
  const zs = [...zr].sort((a, b) => a - b);
  const xsAt = (hwz: number): number[] => {
    const xs = [-hwz, -hwz + 0.3, -hwz + 0.7];
    const inner = hwz - 0.7;
    const n = Math.max(2, Math.round((inner * 2) / 1.0));
    for (let k = 1; k < n; k++) xs.push(-inner + (k / n) * inner * 2);
    xs.push(hwz - 0.7, hwz - 0.3, hwz);
    return xs;
  };
  for (let j = 0; j < zs.length - 1; j++) {
    const za = zs[j];
    const zb = zs[j + 1];
    const hwa = outlineHalfWidth(L, za, BORDER_W);
    const hwb = outlineHalfWidth(L, zb, BORDER_W);
    const xa = xsAt(hwa);
    const xb = xsAt(hwb);
    for (let i = 0; i < xa.length - 1; i++) {
      const p: [number, number, number][] = [
        [xa[i], za, hwa],
        [xa[i + 1], za, hwa],
        [xb[i + 1], zb, hwb],
        [xb[i], zb, hwb],
      ];
      const ids = p.map(([x, z, h]) => g.vert(x, RUG_Y, z, 0, 1, 0, x / KNIT + 0.5, z / KNIT, color(x, z, h)));
      g.quad(ids[0], ids[1], ids[2], ids[3]);
    }
  }
  const mesh = buildMesh(scene, 'freezerRunner', g.data(), runnerMaterial(scene, look));
  look.receiveShadows(mesh);
  return mesh;
}

function buildBorder(scene: Scene, look: Look, L: Layout): Mesh {
  const g = new Geo();
  const hwo = L.hw + BORDER_W;
  const R = RUNNER_RADIUS;
  interface P {
    x: number;
    z: number;
    nx: number;
    nz: number;
  }
  const pts: P[] = [];
  const arc = (cx: number, cz: number, a0: number, a1: number): void => {
    for (let k = 0; k <= 10; k++) {
      const a = a0 + ((a1 - a0) * k) / 10;
      pts.push({ x: cx + Math.cos(a) * R, z: cz + Math.sin(a) * R, nx: Math.cos(a), nz: Math.sin(a) });
    }
  };
  pts.push({ x: 0, z: L.z0, nx: 0, nz: -1 });
  arc(hwo - R, L.z0 + R, -Math.PI / 2, 0);
  arc(hwo - R, L.z1 - R, 0, Math.PI / 2);
  arc(-hwo + R, L.z1 - R, Math.PI / 2, Math.PI);
  arc(-hwo + R, L.z0 + R, Math.PI, Math.PI * 1.5);
  pts.push({ x: 0, z: L.z0, nx: 0, nz: -1 });
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
      const shade = d < 0.03 ? 0.72 : d > BORDER_W ? 0.85 : 1;
      row.push(
        g.vert(
          p.x - p.nx * d,
          y,
          p.z - p.nz * d,
          p.nx * no,
          nu,
          p.nz * no,
          Math.min(1, d / BORDER_W),
          s / BORDER_REPEAT,
          [shade, shade, shade],
        ),
      );
    }
    rows.push(row);
  }
  for (let k = 0; k < rows.length - 1; k++)
    for (let j = 0; j < prof.length - 1; j++) g.quad(rows[k][j], rows[k + 1][j], rows[k + 1][j + 1], rows[k][j + 1]);
  const mesh = buildMesh(scene, 'freezerBorder', g.data(), borderMaterial(scene, look));
  look.receiveShadows(mesh);
  return mesh;
}

// ---------- back wall and the ice-cube tray ----------

function buildWall(scene: Scene, look: Look, L: Layout): Mesh {
  const g = new Geo();
  const W = FLOOR_HALF_W + 10;
  const ys = [0, 1.5, 4, TRAY_TOP, TRAY_TOP + 1.5, 12, WALL_HEIGHT];
  const xs: number[] = [];
  for (let x = -W; x <= W + 0.01; x += 10) xs.push(x);
  const liner = lin(LINER);
  const frost = lin(FROST);
  const grid: number[][] = [];
  for (const y of ys) {
    const row: number[] = [];
    for (const x of xs) {
      // Frost builds up low on the wall; higher up the liner shows a cool sheen.
      const f = smooth(9, 1, y) * (0.6 + 0.4 * noise(x / 9, y / 3, 131));
      const k = 0.88 + 0.06 * noise(x / 17, y / 6, 133);
      row.push(
        g.vert(
          x,
          y,
          L.wallZ,
          0,
          0,
          -1,
          x / FROST_REPEAT,
          y / FROST_REPEAT,
          Color3.Lerp(liner, frost, f).scale(k / 0.93),
        ),
      );
    }
    grid.push(row);
  }
  for (let j = 0; j < ys.length - 1; j++)
    for (let i = 0; i < xs.length - 1; i++) g.quad(grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]);
  const mesh = buildMesh(scene, 'freezerWall', g.data(), linerMaterial(scene, look, 'wall', 0.2));
  look.receiveShadows(mesh);
  return mesh;
}

// A giant ice-cube tray stood on its long edge against the back wall: a moulded panel of
// tapered square cells with rounded rims, a rolled top lip and end caps; about a third of
// the cells near the middle still hold a frosty ice cube. One mesh, vertex colours.
function buildTray(L: Layout): VertexData {
  const g = new Geo();
  const tray = lin(TRAY);
  const zf = L.wallZ - 0.4 - CELL_DEPTH; // front face
  const cols = Math.floor((2 * TRAY_HW) / CELL);
  const rowsN = Math.floor((TRAY_TOP - 0.2) / CELL);
  const x0 = -(cols * CELL) / 2;
  const y0 = TRAY_TOP - 0.2 - rowsN * CELL;
  const r = rng(91);
  const rim = CELL_RIM / 2;
  // Front face grid: lines at every cell's opening edges; quads not inside an opening.
  const xl: number[] = [x0 - 0.3];
  for (let i = 0; i < cols; i++) xl.push(x0 + i * CELL + rim, x0 + (i + 1) * CELL - rim);
  xl.push(x0 + cols * CELL + 0.3);
  const yl: number[] = [0];
  for (let j = 0; j < rowsN; j++) yl.push(y0 + j * CELL + rim, y0 + (j + 1) * CELL - rim);
  yl.push(TRAY_TOP);
  const front: number[][] = yl.map((y) =>
    xl.map((x) => g.vert(x, y, zf, 0, 0, -1, 0, 0, tray.scale(0.97 + 0.05 * noise(x / 3, y / 3, 141)))),
  );
  for (let j = 0; j < yl.length - 1; j++)
    for (let i = 0; i < xl.length - 1; i++) {
      const opening = i % 2 === 1 && j % 2 === 1;
      if (!opening) g.quad(front[j][i], front[j][i + 1], front[j + 1][i + 1], front[j + 1][i]);
    }
  const parts: VertexData[] = [];
  for (let j = 0; j < rowsN; j++) {
    for (let i = 0; i < cols; i++) {
      const ax = x0 + i * CELL + rim;
      const bx = ax + CELL - CELL_RIM;
      const ay = y0 + j * CELL + rim;
      const by = ay + CELL - CELL_RIM;
      const t = 0.16; // taper of the cell walls
      const zb = zf + CELL_DEPTH;
      // Rounded rim: the opening edge rolls in a little before the wall drops back.
      const f = [
        [ax, ay],
        [bx, ay],
        [bx, by],
        [ax, by],
      ];
      const b = [
        [ax + t, ay + t],
        [bx - t, ay + t],
        [bx - t, by - t],
        [ax + t, by - t],
      ];
      const sideShade = [0.78, 0.86, 0.95, 0.86]; // bottom wall catches the most light
      for (let e = 0; e < 4; e++) {
        const n = (e + 1) % 4;
        const mx = (f[e][0] + f[n][0]) / 2 - (ax + bx) / 2;
        const my = (f[e][1] + f[n][1]) / 2 - (ay + by) / 2;
        const l = Math.hypot(mx, my) || 1;
        const nx = -mx / l;
        const ny = -my / l;
        const k = sideShade[e];
        const v0 = g.vert(f[e][0], f[e][1], zf, nx * 0.6, ny * 0.6, -0.8, 0, 0, tray.scale(k));
        const v1 = g.vert(f[n][0], f[n][1], zf, nx * 0.6, ny * 0.6, -0.8, 0, 0, tray.scale(k));
        const v2 = g.vert(b[n][0], b[n][1], zb, nx, ny, -0.25, 0, 0, tray.scale(k * 0.7));
        const v3 = g.vert(b[e][0], b[e][1], zb, nx, ny, -0.25, 0, 0, tray.scale(k * 0.7));
        g.quad(v0, v1, v2, v3);
      }
      const ids = b.map(([x, y]) => g.vert(x, y, zb, 0, 0, -1, 0, 0, tray.scale(0.62)));
      g.quad(ids[0], ids[1], ids[2], ids[3]);
      // Ice cubes still frozen into some of the middle cells.
      const cx = (ax + bx) / 2;
      if (Math.abs(cx) < 22 && r() < 0.38) {
        const s = CELL - CELL_RIM - 0.38;
        const ice = lin(ICE).scale(0.9 + r() * 0.15);
        parts.push(
          paint(
            place(roundedBox(s, s, 0.5, 0.12, 1), {
              x: cx + (r() - 0.5) * 0.08,
              y: (ay + by) / 2 + (r() - 0.5) * 0.08,
              z: zf + 0.1,
              rz: (r() - 0.5) * 0.12,
            }),
            ice,
          ),
        );
      }
    }
  }
  // Rolled top lip and end caps.
  const span = cols * CELL + 0.6;
  parts.push(
    paint(place(roundedBox(span + 0.2, 0.34, CELL_DEPTH + 0.5, 0.16, 2), { y: TRAY_TOP + 0.1, z: zf + 0.15 }), tray),
  );
  for (const sx of [-1, 1])
    parts.push(
      paint(
        place(roundedBox(0.36, TRAY_TOP, CELL_DEPTH + 0.4, 0.14, 1), {
          x: (sx * span) / 2,
          y: TRAY_TOP / 2,
          z: zf + 0.2,
        }),
        tray.scale(0.95),
      ),
    );
  return mergeParts([g.data(), ...parts]);
}

// ---------- the snow globe ----------

function globeParts(L: Layout): VertexData[] {
  const red = lin(PLINTH);
  const brass = lin('#d2a33f');
  const snow = lin('#e9eff3');
  const parts: VertexData[] = [];
  const lit = new Set<VertexData>();
  const cz = L.wallZ - 4.4;
  // Lacquered plinth: a tapered round base, a brass band, a collar holding the glass.
  const plinth = lathe(
    [
      [0, 0],
      [3.0, 0],
      [3.1, 0.1],
      [3.06, 0.42],
      [2.95, 0.5],
      [2.95, 0.6],
      [2.6, 0.82],
      [2.05, 1.0],
      [1.9, 1.08],
      [1.88, PLINTH_H],
      [0, PLINTH_H],
    ],
    36,
  );
  const pp = plinth.positions!;
  const cols = new Float32Array((pp.length / 3) * 4);
  for (let i = 0; i < pp.length / 3; i++) {
    const y = pp[i * 3 + 1];
    const c = y > 0.41 && y < 0.62 ? brass : y > 1.0 ? brass.scale(0.9) : red.scale(y < 0.1 ? 0.7 : 1);
    cols.set([c.r, c.g, c.b, 1], i * 4);
  }
  plinth.colors = cols;
  parts.push(place(plinth, { x: GLOBE_X, z: cz }));
  // Snowy ground inside the dome.
  const groundY = PLINTH_H + 0.25;
  const ground = paint(
    lathe(
      [
        [0, groundY + 0.45],
        [0.9, groundY + 0.38],
        [1.6, groundY + 0.18],
        [2.05, groundY],
        [2.0, PLINTH_H],
      ],
      28,
    ),
    snow,
  );
  parts.push(place(ground, { x: GLOBE_X, z: cz }));
  // A little cabin: warm painted walls, snow on the roof, two glowing windows and a door.
  const cab = (vd: VertexData, x: number, y: number, z: number, c: Color3, glow = false, ry = 0.5): void => {
    const v = paint(place(vd, { x, y, z }), c);
    place(v, { ry });
    place(v, { x: GLOBE_X - 0.35, z: cz + 0.3 });
    const n = v.positions!.length / 3;
    const uv = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) uv[i * 2] = glow ? 0.75 : 0.25;
    v.uvs = uv;
    if (glow) lit.add(v);
    parts.push(v);
  };
  const cy = groundY + 0.3;
  cab(roundedBox(1.1, 0.75, 0.85, 0.06, 1), 0, cy + 0.37, 0, lin(CABIN));
  // Roof: two snow slabs leaning on the ridge.
  for (const s of [-1, 1]) {
    const slab = paint(place(roundedBox(1.32, 0.13, 0.66, 0.06, 1), { rx: s * 0.62, y: cy + 0.96, z: s * 0.24 }), snow);
    place(slab, { ry: 0.5 });
    place(slab, { x: GLOBE_X - 0.35, z: cz + 0.3 });
    const n = slab.positions!.length / 3;
    slab.uvs = new Float32Array(n * 2).fill(0.25);
    parts.push(slab);
  }
  cab(roundedBox(0.16, 0.36, 0.16, 0.03, 1), 0.3, cy + 1.2, 0.05, lin('#7a3b2a'));
  for (const wx of [-0.3, 0.3]) cab(roundedBox(0.2, 0.2, 0.04, 0.02, 1), wx, cy + 0.45, -0.43, lin('#ffd08a'), true);
  cab(roundedBox(0.22, 0.42, 0.04, 0.02, 1), 0, cy + 0.21, -0.43, lin('#5a3424'));
  cab(roundedBox(0.2, 0.2, 0.04, 0.02, 1), -0.56, cy + 0.45, 0, lin('#ffd08a'), true, 0.5 + Math.PI / 2);
  // Teal pines with snow on their tiers.
  const pine = (px: number, pz: number, s: number): void => {
    const tiers: [number, number, number][] = [
      [0.5, 0.0, 0.55],
      [0.4, 0.35, 0.5],
      [0.28, 0.65, 0.45],
    ];
    for (const [rad, y, h] of tiers) {
      const cone = lathe(
        [
          [0, y],
          [rad, y],
          [rad * 0.92, y + 0.06],
          [0.02, y + h],
          [0, y + h],
        ],
        10,
      );
      const p = cone.positions!;
      const c = new Float32Array((p.length / 3) * 4);
      const tealC = lin(PINE);
      for (let i = 0; i < p.length / 3; i++) {
        const yy = p[i * 3 + 1];
        const k = yy > y + h * 0.55 ? 1 : 0; // snowy tips
        const col = k ? snow : tealC.scale(0.8 + 0.4 * ((yy - y) / h));
        c.set([col.r, col.g, col.b, 1], i * 4);
      }
      cone.colors = c;
      parts.push(place(cone, { x: GLOBE_X + px, y: groundY + 0.1, z: cz + pz, s }));
    }
  };
  pine(0.95, -0.3, 1.0);
  pine(0.75, 0.75, 0.8);
  pine(-1.3, -0.5, 0.65);
  // Frozen flakes hanging in the water.
  const r = rng(53);
  for (let i = 0; i < 46; i++) {
    const a = r() * Math.PI * 2;
    const rr = Math.sqrt(r()) * (GLOBE_R - 0.5);
    const y = PLINTH_H + 1 + r() * (GLOBE_R * 1.6 - 1.2);
    parts.push(
      paint(
        place(roundedBox(0.07, 0.07, 0.015, 0.01, 1), {
          x: GLOBE_X + Math.cos(a) * rr * 0.8,
          y,
          z: cz + Math.sin(a) * rr * 0.8,
          ry: r() * 3,
          rz: r() * 3,
        }),
        snow,
      ),
    );
  }
  // Everything but the windows samples the dark half of the emissive lookup.
  for (const p of parts) {
    if (lit.has(p)) continue;
    p.uvs = new Float32Array((p.positions!.length / 3) * 2).fill(0.25);
  }
  return parts;
}

function globeCentreY(): number {
  return PLINTH_H + GLOBE_R * 0.84;
}

function buildDome(scene: Scene, look: Look, L: Layout): Mesh {
  const prof: [number, number][] = [];
  const cy = globeCentreY();
  const a0 = Math.asin(clamp01((cy - PLINTH_H + 0.02) / GLOBE_R));
  for (let i = 0; i <= 18; i++) {
    const a = -a0 + (i / 18) * (Math.PI / 2 + a0);
    prof.push([Math.max(0, Math.cos(a) * GLOBE_R), cy + Math.sin(a) * GLOBE_R]);
  }
  prof[prof.length - 1][0] = 0;
  const vd = place(lathe(prof, 36), { x: GLOBE_X, z: L.wallZ - 4.4 });
  const mesh = buildMesh(scene, 'freezerGlobeDome', vd, domeMaterial(scene, look));
  mesh.alphaIndex = 10;
  return mesh;
}

function buildGlow(scene: Scene, look: Look, L: Layout): Mesh {
  const g = new Geo();
  const cx = GLOBE_X - 0.6;
  const cz = L.wallZ - 6.2;
  const hx = 6.5;
  const hz = 4.6;
  const y = 0.0125;
  const ids = [
    g.vert(cx - hx, y, cz - hz, 0, 1, 0, 0, 0, [1, 1, 1]),
    g.vert(cx + hx, y, cz - hz, 0, 1, 0, 1, 0, [1, 1, 1]),
    g.vert(cx + hx, y, cz + hz, 0, 1, 0, 1, 1, [1, 1, 1]),
    g.vert(cx - hx, y, cz + hz, 0, 1, 0, 0, 1, [1, 1, 1]),
  ];
  g.quad(ids[0], ids[1], ids[2], ids[3]);
  const mesh = buildMesh(scene, 'freezerGlobeGlow', g.data(), glowMaterial(scene, look));
  mesh.receiveShadows = false;
  sunBlend(mesh);
  return mesh;
}

// ---------- game API ----------

export function createFreezerRoom(scene: Scene, look: Look, opts: EnvironmentOptions): EnvironmentModel {
  const L = layoutOf(opts);
  const root = new TransformNode('freezerRoom', scene);
  const tray = buildMesh(scene, 'freezerTray', buildTray(L), trayMaterial(scene, look));
  look.receiveShadows(tray);
  const globe = buildMesh(
    scene,
    'freezerGlobe',
    bakeVertexAO(mergeParts(globeParts(L)), { samples: 10, strength: 0.45, maxTriangles: 9000, maxDist: 0.9 }),
    globeMaterial(scene, look),
  );
  look.addShadowCaster(globe);
  look.receiveShadows(globe);
  const meshes = [
    buildFloor(scene, look, L),
    buildRunner(scene, look, L),
    buildBorder(scene, look, L),
    buildWall(scene, look, L),
    tray,
    globe,
    buildDome(scene, look, L),
    buildGlow(scene, look, L),
  ];
  for (const m of meshes) {
    m.parent = root;
    m.isPickable = false;
  }
  const glowTex = (meshes[7].material as StandardMaterial | null)?.emissiveTexture ?? null;
  const applyGlow = (): void => {
    if (glowTex) glowTex.level = look.hdrPipeline ? GLOW_STRENGTH : GLOW_STRENGTH_LDR;
  };
  applyGlow();
  const unsubscribe = look.onQualityChange(applyGlow);
  const clear = srgb('#cfdde6');
  return {
    root,
    clearColor: new Color4(clear.r, clear.g, clear.b, 1),
    meshes,
    ready: Promise.resolve(),
    dispose() {
      unsubscribe();
      root.dispose(false, false);
    },
  };
}

// ---------- preview ----------
// The room for a 10 x 55 lane in lane coordinates under the freezer light (like the
// environment preview, an inner node undoes the harness's neutral yaw so 'game' is the
// real in-game frame). Variant 'units' adds team-coloured pawns to judge readability.
export function preview(scene: Scene, look: Look, opts: PreviewOptions): PreviewResult {
  const root = new TransformNode('freezerRoomPreview', scene);
  const inner = new TransformNode('freezerRoomPreviewInner', scene);
  inner.parent = root;
  inner.rotation.y = Math.PI;
  const hidden: AbstractMesh[] = [];
  for (const name of ['previewFloor', 'previewRug']) {
    const m = scene.getMeshByName(name);
    if (m && m.isEnabled()) {
      m.setEnabled(false);
      hidden.push(m);
    }
  }
  const oldClear = scene.clearColor.clone();
  const oldTheme = look.theme;
  look.setTheme('freezer');
  const room = createFreezerRoom(scene, look, { laneWidth: 10, laneLength: 55, zMin: -3, zMax: 59 });
  room.root.parent = inner;
  scene.clearColor = room.clearColor;
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
    const pawn = buildMesh(
      scene,
      'freezerPreviewPawns',
      bakeVertexAO(lathe(profile, 12), { samples: 12, strength: 0.5 }),
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
    for (let k = 0; k < 14; k++) put(-4.7 + r() * 0.3, 20 + k * 1.2, k % 2 ? 'enemy' : 'player');
    pawn.thinInstanceSetBuffer('matrix', new Float32Array(mats), 16, true);
    pawn.thinInstanceSetBuffer('color', new Float32Array(cols), 4, true);
    look.addShadowCaster(pawn, 'crowd');
    extra.push(pawn);
  }
  return {
    root,
    dispose() {
      room.dispose();
      for (const m of extra) m.dispose();
      root.dispose();
      for (const m of hidden) m.setEnabled(true);
      scene.clearColor = oldClear;
      look.setTheme(oldTheme);
    },
  };
}
