// Workshop room: the World 3 "Clockwork Workshop" diorama, a toymaker's workbench at
// evening seen at toy scale. Same API shape as createEnvironment (environment.ts).
//
//   - BENCH (the floor): a honey-maple butcher-block workbench top, strips running toward
//     the wall with V-grooves between them, each strip its own tone, darker oil patches,
//     contact darkening at the wall and beside the mat, under the look's wood grain and a
//     satin varnish. One draw call.
//   - CUTTING MAT (the lane): a slate green-grey self-healing cutting mat, lane.width wide,
//     printed with a pale grid (fine every unit, bold every five) and scored by old knife
//     cuts; a 512 px procedural texture, one repeat = 10 x 10 units. Darker than both
//     armies and a different hue, like the bedroom rug. Its top is at RUG_Y. One draw call.
//   - RULER (the border): brushed-steel rules round the mat, etched ticks every 0.1 unit,
//     longer every half and whole unit, with numbers (a 128 x 1024 canvas texture per 10
//     units). One draw call.
//   - PEGBOARD (the back wall): pale blue-grey painted pegboard (hole grid in the normal and
//     albedo maps) with a maple backsplash. One draw call.
//   - KIT: the tools hanging on the pegboard (adjustable wrench, claw hammer, pliers with red
//     grips, four screwdrivers in a rack, a coil of string), a shelf of paint tins and jars,
//     the window frame and a big red desk lamp standing on the bench left of the enemy base,
//     its arm on springs and its shade turned toward the lane, the bulb glowing inside. One
//     mesh: vertex colours plus a 5-texel surface lookup (rubber, paint, metal, wood, glow)
//     for roughness, metalness and emission. One draw call.
//   - WINDOW: the evening sky through four panes (dusk gradient, rooftops, lit windows, an
//     early moon; unlit canvas texture). One draw call.
//   - LAMP POOL: a warm pool of lamplight on the bench under the shade (a multiplicative
//     light decal like the bedroom's sun patch). One draw call.
//   Total: 7 draw calls, ~30k triangles. Textures: three 512 px procedural maps (mat and
//   pegboard albedo + normal), the ruler (128 x 1024) and window (256) canvases and two tiny
//   lookups, about 6 MB with mipmaps, all cached under 'workshop-room-*' (index.ts releases
//   them with look.releaseMaterials('workshop-') when the theme changes). Nothing is
//   animated per frame.
//
// GAME API (level.ts, by LevelDef.theme === 'workshop'):
//   const room = createWorkshopRoom(scene, look, { laneWidth, laneLength, zMin: -3, zMax: L + 4 });
//   scene.clearColor = room.clearColor;
//   room.dispose();   // meshes only; materials stay cached while the theme stays
// Built in LANE coordinates like the environment (parent it without rotation).
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Constants } from '@babylonjs/core/Engines/constants';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Look } from '../look/index.ts';
import {
  bakeVertexAO,
  buildMesh,
  lin,
  mergeParts,
  paint,
  place,
  plasticMaterial,
  roundedBox,
  srgb,
  teamColor,
  woodMaterial,
} from '../look/index.ts';
import type { ModelInfo, PreviewOptions, PreviewResult } from '../look/model.ts';
import type { EnvironmentModel, EnvironmentOptions } from './environment.ts';
import {
  FLOOR_Y,
  Geo,
  RUG_Y,
  hash2,
  heightToNormal,
  noise,
  rawImageProcessing,
  rawTex,
  rng,
  sunBlend,
  tfbm,
} from './environment.ts';
import { gearData, latheOut, tube } from './workshopProps.ts';

export const info: ModelInfo = {
  key: 'workshopRoom',
  title: 'Workshop room: maple workbench, cutting-mat lane, steel rulers, pegboard with tools, desk lamp',
  instanced: false,
  teams: false,
  side: 'neutral',
  height: 12,
  triangleBudget: 34000,
  gameZ: 0,
  variants: ['empty', 'units'],
};

// ---------- palette (sRGB) ----------
const MAPLE = ['#c99a6c', '#d4a77a', '#bb8b5f', '#dab288', '#c59266']; // butcher-block strips
const MAT = '#33494a'; // slate green-grey cutting mat: darker than both armies, a cool hue
const MAT_DARK = '#283b3c';
const PEG = '#a9b7bb'; // painted pegboard, pale blue-grey (calm, cool against the warm bench)
const LAMP_RED = '#a8322c';
const LAMP_CREAM = '#efe6d2';

const BORDER_W = 0.4;
const MAT_RADIUS = 0.5;
const MAT_REP = 10; // world units per mat texture repeat
const RULER_REP = 10; // world units per ruler texture repeat
const PEG_REP = 2.4; // world units per pegboard texture repeat (4 x 4 holes)
const GRAIN_U = 3.4; // bench grain: world units along z per wood texture repeat
const GRAIN_V = 2.4;
const FLOOR_HALF_W = 130;
const DETAIL_X = 24; // narrow strips within this |x|
const STRIP = 0.9;
const WALL_HEIGHT = 30;
const SPLASH_H = 0.7;
const LAMP_GLOW = 2.6; // emissive strength of the bulb (blooms a little)
const POOL_STRENGTH = 0.3; // warm lamplight pool (HDR pipeline)
const POOL_STRENGTH_LDR = 0.12;
const WIN = { x: 15.5, y: 6.4, w: 7, h: 5.4 };

interface Layout {
  hw: number;
  z0: number; // mat outer edge, player end
  z1: number; // mat outer edge, enemy end
  wallZ: number;
  floorZ0: number;
}

function layoutOf(o: EnvironmentOptions): Layout {
  return { hw: o.laneWidth / 2, z0: o.zMin - 1.5, z1: o.zMax + 1.5, wallZ: o.zMax + 6, floorZ0: o.zMin - 16 };
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

// ---------- procedural textures ----------

// Cutting mat: pebbled matte vinyl, pale grid lines (fine every unit, bold every 5) and
// old knife scores. Greyscale (vertex colours carry the slate green-grey).
function matTextures(scene: Scene): { albedo: Texture; normal: Texture } {
  const S = 512;
  const px = S / MAT_REP; // pixels per unit
  const h = new Float32Array(S * S);
  const alb = new Uint8Array(S * S * 4);
  const r = rng(303);
  const scores: number[] = [];
  for (let i = 0; i < 46; i++) {
    const x = r() * S;
    const y = r() * S;
    const a = (r() - 0.5) * 1.2 + (r() < 0.5 ? Math.PI / 2 : 0);
    const l = 20 + r() * 110;
    scores.push(x, y, x + Math.cos(a) * l, y + Math.sin(a) * l);
  }
  const score = new Float32Array(S * S);
  for (let s = 0; s < scores.length; s += 4) {
    const [ax, ay, bx, by] = [scores[s], scores[s + 1], scores[s + 2], scores[s + 3]];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    const x0 = Math.floor(Math.min(ax, bx) - 2);
    const x1 = Math.ceil(Math.max(ax, bx) + 2);
    const y0 = Math.floor(Math.min(ay, by) - 2);
    const y1 = Math.ceil(Math.max(ay, by) + 2);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const t = clamp01(((x - ax) * dx + (y - ay) * dy) / len2);
        const d = Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
        if (d > 1.2) continue;
        const i = (((y % S) + S) % S) * S + (((x % S) + S) % S);
        score[i] = Math.max(score[i], 1 - d / 1.2);
      }
  }
  const line = (c: number, every: number, half: number): number => {
    const p = c / (every * px);
    const d = Math.abs(p - Math.round(p)) * every * px;
    return clamp01(1 - (d - half));
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const n = tfbm(x / S, y / S, 64, 64, 2, 51);
      const minor = Math.max(line(x, 1, 0.4), line(y, 1, 0.4));
      const major = Math.max(line(x, 5, 1.2), line(y, 5, 1.2));
      let k = 0.64 + (n - 0.5) * 0.06;
      k += (0.93 - k) * minor * 0.5;
      k += (1.0 - k) * major * 0.85;
      k *= 1 - score[i] * 0.22;
      h[i] = n * 0.35 - score[i] * 0.6;
      const g = Math.round(clamp01(k) * 255);
      alb[i * 4] = g;
      alb[i * 4 + 1] = Math.min(255, g + 2);
      alb[i * 4 + 2] = g;
      alb[i * 4 + 3] = 255;
    }
  }
  return {
    albedo: rawTex(scene, 'workshop-room-mat-albedo', alb, S, S, true),
    normal: rawTex(scene, 'workshop-room-mat-normal', heightToNormal(h, S, S, 1.6), S, S, false),
  };
}
const MAT_TEX_MEAN = 0.68;

// Pegboard: painted hardboard with a 0.6-unit hole grid (deep dark holes with a soft
// rounded lip), faint brush mottling. Greyscale (vertex colours carry the paint).
function pegTextures(scene: Scene): { albedo: Texture; normal: Texture } {
  const S = 256;
  const cell = S / 4;
  const hr = 7;
  const h = new Float32Array(S * S);
  const alb = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x % cell) - cell / 2 + 0.5;
      const dy = (y % cell) - cell / 2 + 0.5;
      const d = Math.hypot(dx, dy);
      const hole = clamp01((hr + 0.8 - d) / 1.6);
      const lip = Math.exp(-((d - hr - 1.5) * (d - hr - 1.5)) / 3);
      const n = tfbm(x / S, y / S, 16, 16, 3, 61);
      const i = y * S + x;
      h[i] = 1 - hole * 0.9 - lip * 0.08 + n * 0.08;
      const k = (0.9 + (n - 0.5) * 0.06) * (1 - hole * 0.85) * (1 - lip * 0.06);
      const g = Math.round(clamp01(k) * 255);
      alb[i * 4] = g;
      alb[i * 4 + 1] = g;
      alb[i * 4 + 2] = g;
      alb[i * 4 + 3] = 255;
    }
  }
  return {
    albedo: rawTex(scene, 'workshop-room-peg-albedo', alb, S, S, true),
    normal: rawTex(scene, 'workshop-room-peg-normal', heightToNormal(h, S, S, 3), S, S, false),
  };
}

const FONT = '"Arial Rounded MT Bold", ui-rounded, "Nunito", "Helvetica Neue", Arial, system-ui, sans-serif';

// Steel rule: brushed steel (streaks along the rule) with etched ink ticks at the inner
// edge and a number every unit. u across the band (0 outer, 1 inner), v along it.
function rulerTexture(scene: Scene): Texture {
  const W = 128;
  const H = 1024;
  const tex = new DynamicTexture(
    'workshop-room-ruler-tex',
    { width: W, height: H },
    scene,
    true,
    Texture.TRILINEAR_SAMPLINGMODE,
  );
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = 8;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.fillStyle = '#c3c8cc';
  ctx.fillRect(0, 0, W, H);
  const r = rng(707);
  for (let i = 0; i < 260; i++) {
    const x = r() * W;
    const g = Math.round(170 + r() * 70);
    ctx.fillStyle = `rgba(${g},${g + 3},${g + 6},0.35)`;
    ctx.fillRect(x, 0, 1 + r() * 1.5, H);
  }
  // Bevelled edges: a darker outer lip, a bright inner chamfer.
  ctx.fillStyle = 'rgba(60,64,70,0.55)';
  ctx.fillRect(0, 0, 8, H);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillRect(W - 6, 0, 6, H);
  const per = H / RULER_REP; // px per unit
  ctx.fillStyle = '#1f1a16';
  for (let k = 0; k < RULER_REP * 10; k++) {
    const y = k * (per / 10);
    const major = k % 10 === 0;
    const half = k % 5 === 0;
    const len = major ? 64 : half ? 44 : 26;
    const w = major ? 3.2 : 2;
    ctx.fillRect(W - 8 - len, y - w / 2, len, w);
  }
  ctx.font = `900 30px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let k = 1; k <= RULER_REP; k++) {
    ctx.save();
    ctx.translate(30, k * per - per * 0.5);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = k % 5 === 0 ? '#9c2a22' : '#1f1a16';
    ctx.fillText(String(k), 0, 0);
    ctx.restore();
  }
  tex.update(true);
  return tex;
}

// The evening sky through the window: a deep blue dusk over a last band of warm light,
// a row of rooftops with a few lit windows and an early moon. Unlit.
function windowTexture(scene: Scene): DynamicTexture {
  const S = 256;
  const tex = new DynamicTexture(
    'workshop-room-window-tex',
    { width: S, height: S },
    scene,
    true,
    Texture.TRILINEAR_SAMPLINGMODE,
  );
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const sky = ctx.createLinearGradient(0, 0, 0, S);
  sky.addColorStop(0, '#1d2c52');
  sky.addColorStop(0.55, '#3f5b8f');
  sky.addColorStop(0.8, '#c98a6a');
  sky.addColorStop(1, '#f0b070');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = 'rgba(255,248,226,0.95)';
  ctx.beginPath();
  ctx.arc(S * 0.72, S * 0.22, 13, 0, Math.PI * 2);
  ctx.fill();
  const r = rng(808);
  for (let i = 0; i < 30; i++) {
    ctx.fillStyle = `rgba(255,255,240,${0.3 + r() * 0.5})`;
    ctx.fillRect(r() * S, r() * S * 0.45, 1.5, 1.5);
  }
  // Rooftops and chimneys.
  ctx.fillStyle = '#1a2238';
  let x = 0;
  while (x < S) {
    const w = 30 + r() * 46;
    const top = S * (0.7 + r() * 0.12);
    ctx.beginPath();
    ctx.moveTo(x, S);
    ctx.lineTo(x, top + 10);
    ctx.lineTo(x + w / 2, top - 8);
    ctx.lineTo(x + w, top + 10);
    ctx.lineTo(x + w, S);
    ctx.fill();
    if (r() < 0.6) ctx.fillRect(x + w * 0.65, top - 14, 6, 18);
    for (let k = 0; k < 2; k++)
      if (r() < 0.55) {
        ctx.fillStyle = '#ffcf7a';
        ctx.fillRect(x + 6 + r() * (w - 16), top + 20 + r() * 20, 6, 8);
        ctx.fillStyle = '#1a2238';
      }
    x += w - 2;
  }
  tex.update(true);
  return tex;
}

// Warm pool of lamplight: a soft amber ellipse (linear light amount).
function poolTexture(scene: Scene): Texture {
  const S = 64;
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S - 0.5;
      const v = (y + 0.5) / S - 0.5;
      const rr = Math.min(1, Math.hypot(u, v) * 2);
      const a = Math.pow(1 - rr, 1.8) * (1 - rr * 0.2);
      const i = (y * S + x) * 4;
      data[i] = Math.round(a * 255);
      data[i + 1] = Math.round(a * 0.72 * 255);
      data[i + 2] = Math.round(a * 0.4 * 255);
      data[i + 3] = 255;
    }
  return rawTex(scene, 'workshop-room-pool', data, S, S, false, false);
}

// ---------- materials (shared per look under 'workshop-room-*') ----------

function benchMaterial(scene: Scene, look: Look): PBRMaterial {
  return look.material('workshop-room-bench', () => {
    const m = woodMaterial(scene, null, {
      name: 'workshop-room-bench',
      normalStrength: 0.28,
      roughness: 0.5,
      clearcoat: 0.3,
      clearcoatRoughness: 0.3,
      envIntensity: 0.85,
    });
    return m;
  });
}

function matMaterial(scene: Scene, look: Look): PBRMaterial {
  return look.material('workshop-room-mat', () => {
    const t = matTextures(scene);
    return plasticMaterial(scene, null, {
      name: 'workshop-room-mat',
      albedoTexture: t.albedo,
      normalTexture: t.normal,
      normalStrength: 0.5,
      roughness: 0.74,
      envIntensity: 0.6,
    });
  });
}

function rulerMaterial(scene: Scene, look: Look): PBRMaterial {
  return look.material('workshop-room-ruler', () => {
    const m = new PBRMaterial('workshop-room-ruler', scene);
    m.albedoTexture = rulerTexture(scene);
    m.metallic = 0.7;
    m.roughness = 0.34;
    m.environmentIntensity = 1.1;
    m.useRadianceOverAlpha = true;
    return m;
  });
}

function pegMaterial(scene: Scene, look: Look): PBRMaterial {
  return look.material('workshop-room-peg', () => {
    const t = pegTextures(scene);
    return plasticMaterial(scene, null, {
      name: 'workshop-room-peg',
      albedoTexture: t.albedo,
      normalTexture: t.normal,
      normalStrength: 0.8,
      roughness: 0.82,
      envIntensity: 0.6,
    });
  });
}

// The kit's surfaces in one material: u picks a texel of a 5 x 1 lookup for roughness /
// metalness (green / blue) and emission (only the glow texel lights up).
const KIT = { rubber: 0, paint: 1, metal: 2, wood: 3, glow: 4 } as const;
type KitSlot = (typeof KIT)[keyof typeof KIT];
const KIT_SURF: readonly [number, number][] = [
  [0.82, 0],
  [0.42, 0],
  [0.3, 1],
  [0.6, 0],
  [0.5, 0],
];
function kitMaterial(scene: Scene, look: Look): PBRMaterial {
  return look.material('workshop-room-kit', () => {
    const n = KIT_SURF.length;
    const surf = new Uint8Array(n * 4);
    const glow = new Uint8Array(n * 4);
    KIT_SURF.forEach(([rough, metal], i) => {
      surf.set([255, Math.round(rough * 255), Math.round(metal * 255), 255], i * 4);
      glow.set(i === KIT.glow ? [255, 196, 120, 255] : [0, 0, 0, 255], i * 4);
    });
    const lookup = (data: Uint8Array, name: string): RawTexture => {
      const t = RawTexture.CreateRGBATexture(data, n, 1, scene, false, false, Texture.NEAREST_SAMPLINGMODE);
      t.name = name;
      t.wrapU = Texture.CLAMP_ADDRESSMODE;
      t.wrapV = Texture.CLAMP_ADDRESSMODE;
      return t;
    };
    const m = new PBRMaterial('workshop-room-kit', scene);
    m.albedoColor = Color3.White();
    m.metallic = 1;
    m.roughness = 1;
    m.metallicTexture = lookup(surf, 'workshop-room-kit-surface');
    m.useRoughnessFromMetallicTextureAlpha = false;
    m.useRoughnessFromMetallicTextureGreen = true;
    m.useMetallnessFromMetallicTextureBlue = true;
    m.emissiveTexture = lookup(glow, 'workshop-room-kit-glow');
    m.emissiveColor = Color3.White();
    m.emissiveIntensity = LAMP_GLOW;
    m.useRadianceOverAlpha = true;
    m.enableSpecularAntiAliasing = true;
    return m;
  });
}

function windowMaterial(scene: Scene, look: Look): StandardMaterial {
  return look.material('workshop-room-window', () => {
    const m = new StandardMaterial('workshop-room-window', scene);
    m.disableLighting = true;
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.emissiveTexture = windowTexture(scene);
    m.emissiveColor = Color3.White();
    return m;
  });
}

function poolMaterial(scene: Scene, look: Look): StandardMaterial {
  return look.material('workshop-room-pool', () => {
    const m = new StandardMaterial('workshop-room-pool', scene);
    m.disableLighting = true;
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.emissiveColor = Color3.Black();
    m.emissiveTexture = poolTexture(scene);
    m.alpha = 0.999;
    m.alphaMode = Constants.ALPHA_ADD;
    m.imageProcessingConfiguration = rawImageProcessing();
    m.disableDepthWrite = true;
    m.zOffset = -3;
    return m;
  });
}

// ---------- the bench (floor) ----------

function stripTone(i: number): Color3 {
  const h = hash2(i, 7, 311);
  const a = lin(MAPLE[Math.floor(h * MAPLE.length) % MAPLE.length]);
  return a.scale(0.94 + hash2(i, 9, 313) * 0.1);
}

function benchShade(L: Layout, x: number, z: number): number {
  let k = 0.96 + 0.06 * noise(x / 1.3, z / 9, 321);
  // Oil and glue patches, darker.
  k *= 1 - 0.12 * clamp01((noise(x / 6, z / 5, 323) - 0.62) * 4);
  // Contact darkening at the wall and a soft halo beside the mat.
  k *= 1 - 0.32 * Math.exp(-Math.max(0, L.wallZ - z) / 0.9);
  const dx = Math.abs(x) - (L.hw + BORDER_W);
  if (dx > -0.05 && z > L.z0 && z < L.z1) k *= 1 - 0.22 * Math.exp(-Math.max(0, dx) / 0.35);
  return k;
}

function buildBench(scene: Scene, look: Look, L: Layout): Mesh {
  const g = new Geo();
  const edges: number[] = [];
  for (let x = -FLOOR_HALF_W; x < -DETAIL_X; x += 6) edges.push(x);
  for (let x = -DETAIL_X; x < DETAIL_X - 1e-6; x += STRIP) edges.push(x);
  for (let x = DETAIL_X; x <= FLOOR_HALF_W + 1e-6; x += 6) edges.push(x);
  const GAP = 0.025;
  const DROP = 0.014;
  for (let s = 0; s < edges.length - 1; s++) {
    const x0 = edges[s];
    const x1 = edges[s + 1];
    const narrow = x1 - x0 < 2;
    const tone = stripTone(s);
    const step = narrow ? 2.6 : 8;
    const zs: number[] = [];
    for (let z = L.floorZ0; z < L.wallZ; z += step) zs.push(z);
    zs.push(L.wallZ + 0.2);
    const xs = [x0, x0 + GAP, x1 - GAP, x1];
    const ys = [FLOOR_Y - DROP, FLOOR_Y, FLOOR_Y, FLOOR_Y - DROP];
    const ns = [-0.6, 0, 0, 0.6];
    const rows = zs.map((z) =>
      xs.map((x, i) => {
        const k = benchShade(L, x, z) * (i === 0 || i === 3 ? 0.62 : 1);
        return g.vert(x, ys[i], z, ns[i], 1, 0, x / GRAIN_V + s * 0.37, z / GRAIN_U, tone.scale(k / 0.88));
      }),
    );
    for (let j = 0; j < zs.length - 1; j++)
      for (let i = 0; i < 3; i++) g.quad(rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]);
  }
  const mesh = buildMesh(scene, 'workshopBench', g.data(), benchMaterial(scene, look));
  look.receiveShadows(mesh);
  return mesh;
}

// ---------- the cutting mat (lane) and its rulers ----------

function outlineHalfWidth(L: Layout, z: number, inset: number): number {
  const R = Math.max(0.001, MAT_RADIUS - inset);
  const hw = L.hw + BORDER_W - inset;
  const z0 = L.z0 + inset;
  const z1 = L.z1 - inset;
  const dz = z < z0 + R ? z0 + R - z : z > z1 - R ? z - (z1 - R) : 0;
  return hw - R + Math.sqrt(Math.max(0, R * R - dz * dz));
}

function buildMat(scene: Scene, look: Look, L: Layout): Mesh {
  const g = new Geo();
  const bz0 = L.z0 + BORDER_W;
  const bz1 = L.z1 - BORDER_W;
  const LIFT = 1.25; // matte vinyl reads darker than its swatch once lit
  const base = lin(MAT).scale(LIFT);
  const dark = lin(MAT_DARK).scale(LIFT);
  const color = (x: number, z: number, hwz: number): Color3 => {
    const k = 0.96 + 0.07 * noise(x / 3.1, z / 3.6, 331) + 0.03 * (noise(x / 0.8, z / 0.9, 333) - 0.5);
    const edge = Math.max(0, hwz - Math.abs(x));
    // Worn paler where the knife works most (the middle), darker toward the rims.
    const c = Color3.Lerp(base, dark, 0.3 * Math.exp(-edge / 0.5) + 0.12 * noise(x / 7, z / 9, 335));
    return c.scale(k / MAT_TEX_MEAN);
  };
  const zr = new Set<number>();
  const add = (z: number): void => {
    if (z >= bz0 && z <= bz1) zr.add(Math.round(z * 1000) / 1000);
  };
  for (let z = bz0; z < bz1; z += 1.0) add(z);
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
      const ids = p.map(([x, z, h]) => g.vert(x, RUG_Y, z, 0, 1, 0, x / MAT_REP + 0.5, z / MAT_REP, color(x, z, h)));
      g.quad(ids[0], ids[1], ids[2], ids[3]);
    }
  }
  const mesh = buildMesh(scene, 'workshopMat', g.data(), matMaterial(scene, look));
  look.receiveShadows(mesh);
  return mesh;
}

function buildRuler(scene: Scene, look: Look, L: Layout): Mesh {
  const g = new Geo();
  const hwo = L.hw + BORDER_W;
  const R = MAT_RADIUS;
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
  // A thin steel strip with a rounded outer edge and a chamfered inner edge.
  const prof: [number, number, number, number][] = [
    [0, FLOOR_Y + 0.002, 1, 0.3],
    [0.02, 0.008, 0.6, 1],
    [0.05, 0.014, 0, 1],
    [BORDER_W - 0.05, 0.014, 0, 1],
    [BORDER_W - 0.01, RUG_Y + 0.002, -0.4, 1],
    [BORDER_W + 0.02, RUG_Y, 0, 1],
  ];
  let s = 0;
  const rows: number[][] = [];
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k];
    if (k > 0) s += Math.hypot(p.x - pts[k - 1].x, p.z - pts[k - 1].z);
    const row: number[] = [];
    for (const [d, y, no, nu] of prof) {
      const shade = d < 0.03 ? 0.7 : 1;
      row.push(
        g.vert(p.x - p.nx * d, y, p.z - p.nz * d, p.nx * no, nu, p.nz * no, Math.min(1, d / BORDER_W), s / RULER_REP, [
          shade,
          shade,
          shade,
        ]),
      );
    }
    rows.push(row);
  }
  for (let k = 0; k < rows.length - 1; k++)
    for (let j = 0; j < prof.length - 1; j++) g.quad(rows[k][j], rows[k + 1][j], rows[k + 1][j + 1], rows[k][j + 1]);
  const mesh = buildMesh(scene, 'workshopRuler', g.data(), rulerMaterial(scene, look));
  look.receiveShadows(mesh);
  return mesh;
}

// ---------- the pegboard wall ----------

function buildWall(scene: Scene, look: Look, L: Layout): Mesh {
  const g = new Geo();
  const W = FLOOR_HALF_W + 10;
  const ys = [SPLASH_H, 2, 5, 9, 14, WALL_HEIGHT];
  const xs: number[] = [];
  for (let x = -W; x <= W + 0.01; x += 10) xs.push(x);
  const peg = lin(PEG);
  const grid = ys.map((y) =>
    xs.map((x) => {
      const k = (0.9 + 0.08 * noise(x / 11, y / 5, 341)) * (1 - 0.25 * Math.exp(-(y - SPLASH_H) / 0.8));
      return g.vert(x, y, L.wallZ, 0, 0, -1, x / PEG_REP, y / PEG_REP, peg.scale(k / 0.88));
    }),
  );
  for (let j = 0; j < ys.length - 1; j++)
    for (let i = 0; i < xs.length - 1; i++) g.quad(grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]);
  const mesh = buildMesh(scene, 'workshopPegboard', g.data(), pegMaterial(scene, look));
  look.receiveShadows(mesh);
  return mesh;
}

// ---------- the kit: tools, shelf, window frame, desk lamp ----------

function slot(vd: VertexData, s: KitSlot): VertexData {
  const n = (vd.positions?.length ?? 0) / 3;
  const uv = new Float32Array(n * 2);
  const u = (s + 0.5) / KIT_SURF.length;
  for (let i = 0; i < n; i++) {
    uv[i * 2] = u;
    uv[i * 2 + 1] = 0.5;
  }
  vd.uvs = uv;
  return vd;
}
const part = (vd: VertexData, c: Color3, s: KitSlot): VertexData => slot(paint(vd, c), s);

// Maps local +Y onto `dir` at `origin` (local X stays horizontal), positions and normals.
function orient(vd: VertexData, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): VertexData {
  const l = Math.hypot(dx, dy, dz) || 1;
  const D = [dx / l, dy / l, dz / l];
  // X = normalize(D x up-ish), Z = X x D.
  const up = Math.abs(D[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
  let X = [D[1] * up[2] - D[2] * up[1], D[2] * up[0] - D[0] * up[2], D[0] * up[1] - D[1] * up[0]];
  const xl = Math.hypot(X[0], X[1], X[2]) || 1;
  X = [X[0] / xl, X[1] / xl, X[2] / xl];
  const Z = [X[1] * D[2] - X[2] * D[1], X[2] * D[0] - X[0] * D[2], X[0] * D[1] - X[1] * D[0]];
  const p = vd.positions!;
  const n = vd.normals!;
  const P = new Float32Array(p.length);
  const N = new Float32Array(n.length);
  for (let i = 0; i < p.length; i += 3) {
    const [a, b, c] = [p[i], p[i + 1], p[i + 2]];
    P[i] = ox + X[0] * a + D[0] * b + Z[0] * c;
    P[i + 1] = oy + X[1] * a + D[1] * b + Z[1] * c;
    P[i + 2] = oz + X[2] * a + D[2] * b + Z[2] * c;
    const [na, nb, nc] = [n[i], n[i + 1], n[i + 2]];
    N[i] = X[0] * na + D[0] * nb + Z[0] * nc;
    N[i + 1] = X[1] * na + D[1] * nb + Z[1] * nc;
    N[i + 2] = X[2] * na + D[2] * nb + Z[2] * nc;
  }
  vd.positions = P;
  vd.normals = N;
  return vd;
}

type P3 = [number, number, number];
const arcPts = (cx: number, cy: number, r: number, a0: number, a1: number, n: number, z: number): P3[] => {
  const out: P3[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, z]);
  }
  return out;
};

// A tool authored flat in the wall plane (x right, y up, z out of the wall toward the
// lane = -Z in world), then turned by `tilt` and hung at (x, y) in front of the wall.
function hang(parts: VertexData[], x: number, y: number, wallZ: number, tilt: number): VertexData {
  const vd = mergeParts(parts);
  place(vd, { rz: tilt });
  // Flip local +z (out of the wall) to world -z and move onto the wall.
  return place(vd, { ry: Math.PI, x, y, z: wallZ - 0.12 });
}

function toolParts(L: Layout): VertexData[] {
  const steel = lin('#aeb5bc');
  const steelDark = lin('#6e767e');
  const wood = lin('#b7854f');
  const red = lin('#c2352b');
  const out: VertexData[] = [];
  const W = L.wallZ;
  const peg = (x: number, y: number): void => {
    out.push(
      part(
        place(
          latheOut(
            [
              [0, 0],
              [0.06, 0],
              [0.06, 0.32],
              [0, 0.34],
            ],
            8,
          ),
          { rx: -Math.PI / 2, x, y, z: W },
        ),
        steelDark,
        KIT.metal,
      ),
    );
  };
  // Adjustable wrench.
  {
    const p: VertexData[] = [];
    p.push(part(roundedBox(0.55, 3.0, 0.16, 0.08, 2), steel, KIT.metal));
    p.push(part(tube(arcPts(0, 1.95, 0.55, -0.7, Math.PI + 0.7, 18, 0), 0.2, 8, true), steel, KIT.metal));
    p.push(part(tube(arcPts(0, -1.85, 0.4, 0, Math.PI * 2, 20, 0), 0.16, 8, false), steel, KIT.metal));
    p.push(
      part(
        place(
          latheOut(
            [
              [0, 0],
              [0.16, 0],
              [0.16, 0.5],
              [0, 0.5],
            ],
            10,
          ),
          { rz: Math.PI / 2, x: 0.25, y: 1.3 },
        ),
        steelDark,
        KIT.metal,
      ),
    );
    out.push(hang(p, -9.5, 4.9, W, 0.18));
    peg(-9.2, 6.6);
  }
  // Claw hammer.
  {
    const p: VertexData[] = [];
    p.push(part(roundedBox(0.36, 3.2, 0.3, 0.12, 2), wood, KIT.wood));
    p.push(part(place(roundedBox(1.0, 0.55, 0.52, 0.12, 2), { x: 0.42, y: 1.75 }), steel, KIT.metal));
    p.push(
      part(
        place(
          latheOut(
            [
              [0, 0],
              [0.3, 0],
              [0.32, 0.1],
              [0.32, 0.35],
              [0, 0.36],
            ],
            12,
          ),
          { rz: -Math.PI / 2, x: 0.9, y: 1.75 },
        ),
        steel,
        KIT.metal,
      ),
    );
    for (const dz of [-0.12, 0.12])
      p.push(
        part(
          tube(
            [
              [-0.05, 1.75, dz],
              [-0.45, 1.85, dz],
              [-0.8, 1.6, dz],
              [-0.95, 1.3, dz],
            ],
            (i) => 0.13 - i * 0.03,
            6,
            true,
          ),
          steel,
          KIT.metal,
        ),
      );
    out.push(hang(p, -5.4, 4.6, W, -0.1));
    peg(-5.4, 6.55);
  }
  // Pliers with red grips.
  {
    const p: VertexData[] = [];
    for (const s of [-1, 1]) {
      const handle: P3[] = [
        [s * 0.12, 0.2, 0],
        [s * 0.3, -0.6, 0],
        [s * 0.45, -1.4, 0],
        [s * 0.5, -2.1, 0],
      ];
      p.push(part(tube(handle, 0.09, 8, true), steel, KIT.metal));
      p.push(part(tube(handle.slice(1), 0.16, 8, true), red, KIT.rubber));
      p.push(
        part(place(roundedBox(0.22, 0.95, 0.14, 0.06, 1), { x: s * 0.09, y: 0.7, rz: -s * 0.08 }), steel, KIT.metal),
      );
    }
    p.push(
      part(
        place(
          latheOut(
            [
              [0, 0],
              [0.16, 0],
              [0.16, 0.26],
              [0, 0.26],
            ],
            12,
          ),
          { rx: Math.PI / 2, y: 0.25, z: 0.13 },
        ),
        steelDark,
        KIT.metal,
      ),
    );
    out.push(hang(p, 5.6, 5.0, W, 0.08));
    peg(5.6, 6.0);
  }
  // Screwdriver rack: a maple bar with four screwdrivers hanging tip-down.
  {
    const handles = ['#d93a2f', '#2f6fd6', '#f2b630', '#1fa3b0'];
    out.push(part(place(roundedBox(3.4, 0.3, 0.5, 0.08, 2), { x: 9.2, y: 6.7, z: W - 0.25 }), wood, KIT.wood));
    handles.forEach((hex, i) => {
      const x = 7.95 + i * 0.83;
      out.push(
        part(
          place(
            latheOut(
              [
                [0, 0],
                [0.16, 0],
                [0.19, 0.1],
                [0.19, 0.7],
                [0.12, 0.85],
                [0, 0.85],
              ],
              10,
            ),
            { x, y: 6.85, z: W - 0.25 },
          ),
          lin(hex),
          KIT.paint,
        ),
      );
      out.push(
        part(
          tube(
            [
              [x, 6.85, W - 0.25],
              [x, 5.2 - i * 0.2, W - 0.25],
            ],
            0.05,
            6,
            true,
          ),
          steel,
          KIT.metal,
        ),
      );
    });
  }
  // A coil of string on a peg.
  {
    const coil: VertexData[] = [];
    for (let k = 0; k < 4; k++)
      coil.push(
        part(
          tube(arcPts(0, 0, 0.8 + k * 0.05, 0, Math.PI * 2, 28, k * 0.07 - 0.1), 0.06, 5, false),
          lin('#d9c7a2').scale(0.9 + k * 0.04),
          KIT.rubber,
        ),
      );
    out.push(hang(coil, -13.0, 5.6, W, 0));
    peg(-13.0, 6.3);
  }
  // Shelf with paint tins, jars and a stack of gears.
  {
    const sy = 8.9;
    out.push(part(place(roundedBox(20, 0.28, 1.4, 0.08, 2), { y: sy, z: W - 0.7 }), wood, KIT.wood));
    for (const bx of [-8.5, 8.5])
      out.push(
        part(place(roundedBox(0.16, 1.1, 1.2, 0.04, 1), { x: bx, y: sy - 0.65, z: W - 0.62 }), steelDark, KIT.metal),
      );
    const tins = [
      { x: -7.2, r: 0.55, h: 1.1, c: '#2f6fd6' },
      { x: -5.9, r: 0.45, h: 0.9, c: '#d93a2f' },
      { x: 3.6, r: 0.6, h: 1.2, c: '#f2b630' },
      { x: 6.9, r: 0.5, h: 1.0, c: '#8e4fc4' },
    ];
    for (const t of tins) {
      const can = latheOut(
        [
          [0, 0],
          [t.r, 0],
          [t.r, t.h],
          [t.r - 0.04, t.h + 0.04],
          [0, t.h + 0.04],
        ],
        16,
      );
      const pp = can.positions!;
      const cols = new Float32Array((pp.length / 3) * 4);
      const uv = new Float32Array((pp.length / 3) * 2);
      for (let i = 0; i < pp.length / 3; i++) {
        const y = pp[i * 3 + 1];
        const label = y > t.h * 0.2 && y < t.h * 0.8;
        const c = label ? lin(t.c) : steel;
        cols.set([c.r, c.g, c.b, 1], i * 4);
        uv[i * 2] = ((label ? KIT.paint : KIT.metal) + 0.5) / KIT_SURF.length;
        uv[i * 2 + 1] = 0.5;
      }
      can.colors = cols;
      can.uvs = uv;
      out.push(place(can, { x: t.x, y: sy + 0.14, z: W - 0.7 }));
    }
    for (const [jx, c] of [
      [-2.6, '#9fc3cf'],
      [-1.4, '#b6d0c0'],
    ] as const) {
      out.push(
        part(
          place(
            latheOut(
              [
                [0, 0],
                [0.42, 0],
                [0.45, 0.1],
                [0.45, 0.9],
                [0.35, 1.0],
                [0, 1.0],
              ],
              14,
            ),
            { x: jx, y: sy + 0.14, z: W - 0.75 },
          ),
          lin(c),
          KIT.paint,
        ),
      );
      out.push(
        part(
          place(
            latheOut(
              [
                [0, 0],
                [0.37, 0],
                [0.37, 0.16],
                [0, 0.18],
              ],
              14,
            ),
            { x: jx, y: sy + 1.12, z: W - 0.75 },
          ),
          steel,
          KIT.metal,
        ),
      );
    }
    const brass = lin('#d2a33f');
    for (let k = 0; k < 3; k++)
      out.push(
        part(
          place(gearData(0.7 - k * 0.18, 0.6 - k * 0.15, 14 - k * 2, 0.1, 0.1), {
            x: 0.9,
            y: sy + 0.14 + k * 0.12,
            z: W - 0.7,
            ry: k,
          }),
          brass,
          KIT.metal,
        ),
      );
  }
  // Window frame and sill.
  {
    const frame = lin('#9b6b40');
    const { x, y, w, h } = WIN;
    const z = W - 0.12;
    out.push(part(place(roundedBox(w + 0.5, 0.32, 0.3, 0.08, 2), { x, y: y + h / 2, z }), frame, KIT.wood));
    out.push(
      part(place(roundedBox(w + 0.9, 0.3, 0.9, 0.08, 2), { x, y: y - h / 2 - 0.05, z: W - 0.4 }), frame, KIT.wood),
    );
    for (const s of [-1, 1])
      out.push(part(place(roundedBox(0.32, h, 0.3, 0.08, 2), { x: x + (s * w) / 2, y, z }), frame, KIT.wood));
    out.push(part(place(roundedBox(0.16, h, 0.18, 0.05, 1), { x, y, z: z - 0.03 }), frame, KIT.wood));
    out.push(part(place(roundedBox(w, 0.16, 0.18, 0.05, 1), { x, y, z: z - 0.03 }), frame, KIT.wood));
  }
  // Maple backsplash along the foot of the pegboard.
  out.push(
    part(
      place(roundedBox(2 * FLOOR_HALF_W, SPLASH_H, 0.3, 0.06, 1), { y: SPLASH_H / 2, z: W - 0.12 }),
      lin('#b98a5c'),
      KIT.wood,
    ),
  );
  return out;
}

// A big red architect's desk lamp standing on the bench left of the enemy base: weighted
// round foot, two-rod arms with tension springs, knuckle joints, and a conical shade
// turned toward the lane with a glowing bulb inside.
const LAMP = { x: -12.5, dz: -3.4 };
function lampHead(L: Layout): { hx: number; hy: number; hz: number; tx: number; tz: number } {
  const bx = LAMP.x;
  const bz = L.wallZ + LAMP.dz;
  return { hx: bx + 6.6, hy: 8.4, hz: bz - 2.6, tx: bx + 10.5, tz: bz - 8 };
}

function lampParts(L: Layout): VertexData[] {
  const red = lin(LAMP_RED);
  const cream = lin(LAMP_CREAM);
  const steel = lin('#b4bbc2');
  const dark = lin('#3a3632');
  const out: VertexData[] = [];
  const bx = LAMP.x;
  const bz = L.wallZ + LAMP.dz;
  out.push(
    part(
      place(
        latheOut(
          [
            [0, 0],
            [1.9, 0],
            [2.0, 0.08],
            [1.95, 0.3],
            [1.5, 0.48],
            [0.5, 0.58],
            [0.4, 0.75],
            [0, 0.78],
          ],
          32,
        ),
        { x: bx, z: bz },
      ),
      red,
      KIT.paint,
    ),
  );
  out.push(
    part(
      place(
        latheOut(
          [
            [0, 0],
            [0.24, 0],
            [0.24, 1.0],
            [0, 1.0],
          ],
          12,
        ),
        { x: bx, y: 0.7, z: bz },
      ),
      steel,
      KIT.metal,
    ),
  );
  const base: P3 = [bx, 1.7, bz];
  const elbow: P3 = [bx + 2.8, 6.6, bz - 0.9];
  const { hx, hy, hz, tx, tz } = lampHead(L);
  const head: P3 = [hx, hy, hz];
  // Arms: two parallel steel rods each, with a tension spring alongside.
  const arm = (a: P3, b: P3, side: number): void => {
    for (const o of [-0.17, 0.17]) {
      out.push(
        part(
          tube(
            [
              [a[0], a[1], a[2] + o],
              [b[0], b[1], b[2] + o],
            ],
            0.06,
            6,
            true,
          ),
          steel,
          KIT.metal,
        ),
      );
    }
    const pts: P3[] = [];
    const n = 120;
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    const ux = dx / len,
      uy = dy / len;
    // Spring axis offset to the side of the rods (perpendicular in the arm's vertical plane).
    const ox = -uy * 0.32 * side,
      oy = ux * 0.32 * side;
    for (let i = 0; i <= n; i++) {
      const u = 0.15 + (i / n) * 0.55;
      const ang = i * 0.9;
      pts.push([
        a[0] + dx * u + ox + Math.cos(ang) * 0.09 * -uy,
        a[1] + dy * u + oy + Math.cos(ang) * 0.09 * ux,
        a[2] + dz * u + Math.sin(ang) * 0.09,
      ]);
    }
    out.push(part(tube(pts, 0.022, 4, false), steel, KIT.metal));
  };
  arm(base, elbow, 1);
  arm(elbow, head, -1);
  for (const j of [base, elbow, head])
    out.push(
      part(
        place(
          latheOut(
            [
              [0, -0.3],
              [0.2, -0.3],
              [0.24, -0.26],
              [0.24, 0.26],
              [0.2, 0.3],
              [0, 0.3],
            ],
            12,
          ),
          { rx: Math.PI / 2, x: j[0], y: j[1], z: j[2] },
        ),
        dark,
        KIT.paint,
      ),
    );
  // Shade: lathe along local +Y from the back of the shade to its rim, oriented to aim at
  // the pool on the bench.
  const prof: [number, number][] = [
    [0, -0.5],
    [0.32, -0.48],
    [0.48, -0.25],
    [0.55, 0.15],
    [1.35, 1.6],
    [1.6, 2.0],
    [1.62, 2.08],
    [1.52, 2.04],
    [1.3, 1.7],
    [0.5, 0.3],
    [0, 0.25],
  ];
  const shade = latheOut(prof, 28);
  const sp = shade.positions!;
  const sc = new Float32Array((sp.length / 3) * 4);
  const su = new Float32Array((sp.length / 3) * 2);
  for (let i = 0; i < sp.length / 3; i++) {
    const pi = i % prof.length;
    const inner = pi >= 7;
    const c = inner ? cream : pi === 5 || pi === 6 ? red.scale(0.8) : red;
    sc.set([c.r, c.g, c.b, 1], i * 4);
    su[i * 2] = (KIT.paint + 0.5) / KIT_SURF.length;
    su[i * 2 + 1] = 0.5;
  }
  shade.colors = sc;
  shade.uvs = su;
  const dir: P3 = [tx - hx, 0 - hy, tz - hz];
  out.push(orient(shade, hx, hy, hz, dir[0], dir[1], dir[2]));
  // The bulb, glowing.
  const bulb: [number, number][] = [];
  for (let i = 0; i <= 8; i++) {
    const a = -Math.PI / 2 + (i / 8) * Math.PI;
    bulb.push([Math.max(0, Math.cos(a) * 0.45), 0.95 + Math.sin(a) * 0.45]);
  }
  bulb[0][0] = 0;
  bulb[8][0] = 0;
  out.push(orient(part(latheOut(bulb, 14), lin('#fff1d0'), KIT.glow), hx, hy, hz, dir[0], dir[1], dir[2]));
  return out;
}

function buildKit(scene: Scene, look: Look, L: Layout): Mesh {
  const lamp = bakeVertexAO(mergeParts(lampParts(L)), { samples: 8, strength: 0.4, maxTriangles: 9000, maxDist: 1.2 });
  const mesh = buildMesh(scene, 'workshopKit', mergeParts([lamp, ...toolParts(L)]), kitMaterial(scene, look));
  look.addShadowCaster(mesh);
  look.receiveShadows(mesh);
  return mesh;
}

function buildWindow(scene: Scene, look: Look, L: Layout): Mesh {
  const g = new Geo();
  const { x, y, w, h } = WIN;
  const z = L.wallZ - 0.02;
  const white = [1, 1, 1];
  // Seen from -Z: u runs right to left in x so the sky is not mirrored.
  const a = g.vert(x - w / 2, y - h / 2, z, 0, 0, -1, 1, 0, white);
  const b = g.vert(x + w / 2, y - h / 2, z, 0, 0, -1, 0, 0, white);
  const c = g.vert(x + w / 2, y + h / 2, z, 0, 0, -1, 0, 1, white);
  const d = g.vert(x - w / 2, y + h / 2, z, 0, 0, -1, 1, 1, white);
  g.quad(a, b, c, d);
  return buildMesh(scene, 'workshopWindow', g.data(), windowMaterial(scene, look));
}

function buildPool(scene: Scene, look: Look, L: Layout): Mesh {
  const g = new Geo();
  const { tx, tz } = lampHead(L);
  const hx = 7.5;
  const hz = 5.5;
  const y = 0.0125;
  const w = [1, 1, 1];
  const ids = [
    g.vert(tx - hx, y, tz - hz, 0, 1, 0, 0, 0, w),
    g.vert(tx + hx, y, tz - hz, 0, 1, 0, 1, 0, w),
    g.vert(tx + hx, y, tz + hz, 0, 1, 0, 1, 1, w),
    g.vert(tx - hx, y, tz + hz, 0, 1, 0, 0, 1, w),
  ];
  g.quad(ids[0], ids[1], ids[2], ids[3]);
  const mesh = buildMesh(scene, 'workshopLampPool', g.data(), poolMaterial(scene, look));
  mesh.receiveShadows = false;
  sunBlend(mesh);
  return mesh;
}

// ---------- game API ----------

export function createWorkshopRoom(scene: Scene, look: Look, opts: EnvironmentOptions): EnvironmentModel {
  const L = layoutOf(opts);
  const root = new TransformNode('workshopRoom', scene);
  const pool = buildPool(scene, look, L);
  const meshes = [
    buildBench(scene, look, L),
    buildMat(scene, look, L),
    buildRuler(scene, look, L),
    buildWall(scene, look, L),
    buildKit(scene, look, L),
    buildWindow(scene, look, L),
    pool,
  ];
  for (const m of meshes) {
    m.parent = root;
    m.isPickable = false;
  }
  const poolTex = (pool.material as StandardMaterial | null)?.emissiveTexture ?? null;
  const applyPool = (): void => {
    if (poolTex) poolTex.level = look.hdrPipeline ? POOL_STRENGTH : POOL_STRENGTH_LDR;
  };
  applyPool();
  const unsubscribe = look.onQualityChange(applyPool);
  const clear = srgb('#7d8c93');
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
// The room for a 10 x 55 lane in lane coordinates under the workshop light (an inner node
// undoes the harness's neutral yaw so 'game' is the real in-game frame). Variant 'units'
// adds team-coloured pawns to judge readability on the mat.
export function preview(scene: Scene, look: Look, opts: PreviewOptions): PreviewResult {
  const root = new TransformNode('workshopRoomPreview', scene);
  const inner = new TransformNode('workshopRoomPreviewInner', scene);
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
  look.setTheme('workshop');
  const room = createWorkshopRoom(scene, look, { laneWidth: 10, laneLength: 55, zMin: -3, zMax: 59 });
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
      'workshopPreviewPawns',
      bakeVertexAO(latheOut(profile, 12), { samples: 12, strength: 0.5 }),
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
