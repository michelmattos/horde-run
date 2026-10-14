// Wall defender: a kid's wall of big toy alphabet blocks in two courses, the top course
// staggered by half a block, tan and cream blocks alternating, embossed tan-dark letters,
// hand-stacked with small random twists and offsets. It only soaks damage; as HP drops,
// blocks fall off top-first (at 75 / 50 / 25 % HP) and the removed blocks' world positions
// are handed back so effects can throw plastic debris there.
//
// GAME API (integration):
//
//   const kit = createWallKit(scene, look);         // once per scene (shared meshes/material)
//   const wall = kit.create(def.width ?? 4, DEFENDER_DEFAULTS.wallDepth);
//   wall.root.position.set(def.x, 0, def.z);
//   wall.root.rotation.y = Math.PI;                 // side 'enemy': letters face the camera
//   const debris = wall.setDamage(1 - hp / maxHp);  // Vector3[] of blocks removed by this call
//                                                   // (cheap to call every frame: no work and a
//                                                   // shared frozen empty array when unchanged)
//   wall.setHit(k);                                 // 0..1 flash + small pop (decay it yourself)
//   hpBar.y = wall.topY() + 0.35;                   // current top of the remaining blocks
//   wall.dispose();                                 // when the level ends (kit.dispose() at scene end)
//
// Draw calls: every wall in the scene shares three: tan blocks, cream blocks (two
// InstancedMesh sources sharing one PBR material with a 1024x768 generated letter atlas,
// albedo + embossing normal map) and one faint contact-shadow blob per wall (instanced).
// Each block: 300 triangles (rounded cube, edge radius 8% of the side, 2 bevel segments).
// At most 14 blocks per wall. Shadows: block sources are registered as static casters and
// receivers through the look.
//
// Layout: bottom course n = round(width / 0.65) blocks, top course in the n - 1 half-
// staggered slots. Walls wider than ~4.5 use bigger blocks (8 at width 6, squashed to 0.7
// high) and a contiguous, centred top course, so every intact wall is a complete stack.
// Blocks are pushed to the front (+Z, the face toward the player after the PI yaw) of the
// depth box, so units stop at the visible face. kit.root holds the hidden sources.
//
// Block recipe (shared with the tower task, which imports it): blockVertexData(side,
// faces, turns?, ao = true) + toyBlockMaterial(scene, look) + BLOCK_FACES / BLOCK_TURNS +
// bakeBlockAO (stacking/contact AO in vertex colours, for upright blocks). Edge radius = 8%
// of the side.
import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import '@babylonjs/core/Meshes/instancedMesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type { Look } from '../look/index.ts';
import { HEX, buildMesh, createBlobShadowMesh, plasticMaterial, roundedBox } from '../look/index.ts';
import type { ModelInfo, PreviewOptions, PreviewResult } from '../look/model.ts';

export const info: ModelInfo = {
  key: 'wall',
  title: 'Wall defender: toy-block wall',
  instanced: true,
  teams: false,
  side: 'enemy',
  height: 1.3,
  triangleBudget: 300 * 14,
  gameZ: 35,
  variants: ['intact', 'crumbling'],
};

// ---------- the shared block recipe ----------

export const BLOCK_SIDE = 0.65;
export const BLOCK_EDGE = 0.08; // edge radius as a fraction of the side

// Letter atlas: 4 columns x 3 rows of 256 px cells. Row 0-1 left half and so on are listed
// here; each block source maps its six faces to six cells.
const CELL = 256;
const COLS = 4;
const ROWS = 3;
type Glyph = string; // a character, or '*' star, '@' heart, '#' sun
interface Cell {
  glyph: Glyph;
  body: 'tan' | 'tanLight';
}
// Cells 0-5 are tan blocks, 6-11 cream blocks.
const CELLS: Cell[] = [
  { glyph: 'A', body: 'tan' },
  { glyph: 'C', body: 'tan' },
  { glyph: 'E', body: 'tan' },
  { glyph: '1', body: 'tan' },
  { glyph: 'G', body: 'tan' },
  { glyph: '*', body: 'tan' },
  { glyph: 'B', body: 'tanLight' },
  { glyph: 'D', body: 'tanLight' },
  { glyph: 'F', body: 'tanLight' },
  { glyph: '2', body: 'tanLight' },
  { glyph: 'H', body: 'tanLight' },
  { glyph: '@', body: 'tanLight' },
];
// Face order of roundedBox: +X, -X, +Y, -Y, +Z, -Z.
export const BLOCK_FACES = {
  tan: [1, 2, 5, 3, 0, 4],
  cream: [7, 8, 11, 9, 6, 10],
} as const;
// Quarter turns of each face's glyph (same face order). One side face of the tan block has
// its letter on its side, so a few blocks read as 'rolled' while every block stays upright
// (and its baked stacking AO stays at the bottom). Nothing is upside down.
export const BLOCK_TURNS = {
  tan: [0, 0, 0, 0, 0, 1],
  cream: [0, 0, 0, 0, 0, 0],
} as const;

// Cream body: HEX.tanLight pushed toward the chalky #f4f0e8 ceiling so tan and cream blocks
// keep a clear value split at game distance.
const CREAM_BODY = '#ecdcbc';

// Stacking / contact AO for an upright block, multiplied into vertex colours: the bottom
// face ~0.6, the lower bevel ramps 0.64 -> 0.86 (the flat side then interpolates up to 1),
// vertical edges a touch darker. Exported so every block user gets the same treatment.
export function bakeBlockAO(vd: VertexData, side: number): VertexData {
  const p = vd.positions!;
  const n = vd.normals!;
  const nv = p.length / 3;
  const colors = vd.colors ? Float32Array.from(vd.colors) : new Float32Array(nv * 4).fill(1);
  const h = side / 2;
  const r = side * BLOCK_EDGE;
  for (let v = 0; v < nv; v++) {
    const y = p[v * 3 + 1];
    const nx = n[v * 3], ny = n[v * 3 + 1], nz = n[v * 3 + 2];
    let ao = 1;
    if (ny < -0.9) ao = 0.6;
    else if (y < -h + r * 1.01) ao = 0.64 + 0.22 * Math.min(1, Math.max(0, (y + h) / r));
    if (Math.abs(nx) > 0.3 && Math.abs(nz) > 0.3) ao *= 0.92;
    colors[v * 4] *= ao;
    colors[v * 4 + 1] *= ao;
    colors[v * 4 + 2] *= ao;
  }
  vd.colors = colors;
  return vd;
}

// A rounded cube of the given side, centred on the origin, with each face's UVs mapped to
// an atlas cell so the glyph reads upright from outside (side faces: up = +Y; top: up = -Z;
// bottom: up = +Z). turns[f] rotates face f's glyph by quarter turns. Stacking AO is baked
// into the vertex colours unless ao is false. 300 triangles.
export function blockVertexData(side: number, faces: readonly number[], turns: readonly number[] = [0, 0, 0, 0, 0, 0], ao = true): VertexData {
  const seg = 2;
  const vd = roundedBox(side, side, side, side * BLOCK_EDGE, seg);
  const p = vd.positions!;
  const per = (2 * (seg + 1)) ** 2; // vertices per face
  const uvs = new Float32Array((p.length / 3) * 2);
  const h = side / 2;
  // [normal, up] per face in roundedBox order
  const frames: [number[], number[]][] = [
    [[1, 0, 0], [0, 1, 0]],
    [[-1, 0, 0], [0, 1, 0]],
    [[0, 1, 0], [0, 0, -1]],
    [[0, -1, 0], [0, 0, 1]],
    [[0, 0, 1], [0, 1, 0]],
    [[0, 0, -1], [0, 1, 0]],
  ];
  // Inset so mip filtering never bleeds a neighbouring cell in.
  const inset = 3 / CELL;
  for (let f = 0; f < 6; f++) {
    const n = frames[f][0];
    let up = frames[f][1];
    const cross = (a: number[], b: number[]): number[] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    // right as seen from outside (roundedBox mirrors u otherwise): n x up
    let r = cross(n, up);
    for (let t = 0; t < ((turns[f] ?? 0) & 3); t++) {
      const nr = up.map((c) => -c);
      up = r;
      r = nr;
    }
    const cell = faces[f];
    const cx = cell % COLS;
    const cy = Math.floor(cell / COLS);
    for (let k = f * per; k < (f + 1) * per; k++) {
      const x = p[k * 3], y = p[k * 3 + 1], z = p[k * 3 + 2];
      let u = (x * r[0] + y * r[1] + z * r[2]) / (2 * h) + 0.5;
      let v = (x * up[0] + y * up[1] + z * up[2]) / (2 * h) + 0.5;
      u = inset + Math.min(1, Math.max(0, u)) * (1 - 2 * inset);
      v = inset + Math.min(1, Math.max(0, v)) * (1 - 2 * inset);
      uvs[k * 2] = (cx + u) / COLS;
      // Canvas row 0 is at the top; with invertY the texture's v = 1 is the canvas top.
      uvs[k * 2 + 1] = 1 - (cy + 1 - v) / ROWS;
    }
  }
  vd.uvs = uvs;
  return ao ? bakeBlockAO(vd, side) : vd;
}

function drawGlyph(ctx: CanvasRenderingContext2D, g: Glyph, cx: number, cy: number, size: number): void {
  ctx.beginPath();
  if (g === '*') {
    const R = size * 0.5, r = size * 0.22;
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rad = i % 2 ? r : R;
      const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad + size * 0.04;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  } else if (g === '@') {
    const s = size * 0.5;
    ctx.moveTo(cx, cy + s * 0.85);
    ctx.bezierCurveTo(cx - s * 1.15, cy + s * 0.05, cx - s * 0.85, cy - s * 0.95, cx, cy - s * 0.4);
    ctx.bezierCurveTo(cx + s * 0.85, cy - s * 0.95, cx + s * 1.15, cy + s * 0.05, cx, cy + s * 0.85);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.font = `bold ${Math.round(size)}px "Arial Rounded MT Bold", "Arial Black", "Helvetica Neue", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(g, cx, cy + size * 0.05);
  }
}

// Draws one channel picture of the atlas: 'albedo' (block colours, letters, cavity AO) or
// 'height' (greyscale relief: raised frame and letter, sunken field).
function paintAtlas(ctx: CanvasRenderingContext2D, mode: 'albedo' | 'height'): void {
  const W = CELL * COLS, H = CELL * ROWS;
  ctx.clearRect(0, 0, W, H);
  const dark = HEX.tanDark;
  CELLS.forEach((c, i) => {
    const x0 = (i % COLS) * CELL, y0 = Math.floor(i / COLS) * CELL;
    const body = c.body === 'tan' ? HEX.tan : CREAM_BODY;
    const frame = CELL * 0.1; // raised border width
    const glyphSize = CELL * 0.62;
    if (mode === 'albedo') {
      ctx.fillStyle = body;
      ctx.fillRect(x0, y0, CELL, CELL);
      // the sunken field is a touch darker (dust, moulding shade)
      ctx.fillStyle = 'rgba(70,45,15,0.035)';
      roundRect(ctx, x0 + frame, y0 + frame, CELL - 2 * frame, CELL - 2 * frame, CELL * 0.05);
      ctx.fill();
      // thin painted line just inside the frame
      ctx.strokeStyle = dark;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = CELL * 0.018;
      roundRect(ctx, x0 + frame + CELL * 0.025, y0 + frame + CELL * 0.025, CELL - 2 * frame - CELL * 0.05, CELL - 2 * frame - CELL * 0.05, CELL * 0.04);
      ctx.stroke();
      ctx.globalAlpha = 1;
      // the letter's shadowed foot (cheap AO under the relief)
      // (a few offset low-alpha copies instead of a canvas blur() filter, which costs
      // seconds in software rasterisers and is not cheap on phones)
      ctx.fillStyle = 'rgba(40,25,8,0.09)';
      for (const [ox, oy] of FOOT_TAPS) drawGlyph(ctx, c.glyph, x0 + CELL / 2 + 1.5 + ox, y0 + CELL / 2 + 2.5 + oy, glyphSize);
      ctx.fillStyle = dark;
      drawGlyph(ctx, c.glyph, x0 + CELL / 2, y0 + CELL / 2, glyphSize);
    } else {
      // 0.55 = face plane at the frame, 0.25 = sunken field, 1 = letter top.
      ctx.fillStyle = 'rgb(140,140,140)';
      ctx.fillRect(x0, y0, CELL, CELL);
      ctx.fillStyle = 'rgb(64,64,64)';
      roundRect(ctx, x0 + frame, y0 + frame, CELL - 2 * frame, CELL - 2 * frame, CELL * 0.05);
      ctx.fill();
      ctx.fillStyle = 'rgb(255,255,255)';
      drawGlyph(ctx, c.glyph, x0 + CELL / 2, y0 + CELL / 2, glyphSize);
    }
  });
}

const FOOT_TAPS: readonly (readonly [number, number])[] = [[0, 0], [-1.4, 0], [1.4, 0], [0, -1.4], [0, 1.4]];

// Separable 3-tap box blur, `passes` times, in place (two passes ~ a 1.5 px Gaussian).
function softenHeight(h: Float32Array, W: number, H: number, passes: number): void {
  const t = new Float32Array(W * H);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < H; y++) {
      const r = y * W;
      for (let x = 0; x < W; x++) t[r + x] = (h[r + Math.max(0, x - 1)] + h[r + x] + h[r + Math.min(W - 1, x + 1)]) / 3;
    }
    for (let y = 0; y < H; y++) {
      const ym = Math.max(0, y - 1) * W, y0 = y * W, yp = Math.min(H - 1, y + 1) * W;
      for (let x = 0; x < W; x++) h[y0 + x] = (t[ym + x] + t[y0 + x] + t[yp + x]) / 3;
    }
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Builds the shared toy-block material (once per look): plastic with a generated albedo
// atlas and an embossing normal map. Vertex/instance colours multiply in (used for the hit
// flash).
export function toyBlockMaterial(scene: Scene, look: Look): PBRMaterial {
  return look.material('toy-block-atlas', () => {
    const W = CELL * COLS, H = CELL * ROWS;
    const albedo = new DynamicTexture('toyBlockAlbedo', { width: W, height: H }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    const actx = albedo.getContext() as unknown as CanvasRenderingContext2D;
    paintAtlas(actx, 'albedo');
    albedo.update(true);
    albedo.wrapU = albedo.wrapV = Texture.CLAMP_ADDRESSMODE;
    albedo.anisotropicFilteringLevel = 4;

    // Height -> soft blur -> Sobel -> normal map.
    const normal = new DynamicTexture('toyBlockNormal', { width: W, height: H }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    const nctx = normal.getContext() as unknown as CanvasRenderingContext2D;
    paintAtlas(nctx, 'height');
    const img = nctx.getImageData(0, 0, W, H);
    const src = img.data;
    const hgt = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) hgt[i] = src[i * 4] / 255;
    softenHeight(hgt, W, H, 2); // ~1.5 px blur, in JS (no canvas filter)
    const out = nctx.createImageData(W, H);
    const d = out.data;
    const k = 5.5; // relief strength
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const xm = Math.max(0, x - 1), xp = Math.min(W - 1, x + 1);
        const ym = Math.max(0, y - 1), yp = Math.min(H - 1, y + 1);
        const dx = hgt[y * W + xp] - hgt[y * W + xm];
        const dy = hgt[yp * W + x] - hgt[ym * W + x];
        // canvas y runs down, texture v runs up: flip dy for the green channel
        let nx = -dx * k, ny = dy * k, nz = 1;
        const l = Math.hypot(nx, ny, nz);
        nx /= l; ny /= l; nz /= l;
        const o = (y * W + x) * 4;
        d[o] = (nx * 0.5 + 0.5) * 255;
        d[o + 1] = (ny * 0.5 + 0.5) * 255;
        d[o + 2] = (nz * 0.5 + 0.5) * 255;
        d[o + 3] = 255;
      }
    }
    nctx.putImageData(out, 0, 0);
    normal.update(true);
    normal.wrapU = normal.wrapV = Texture.CLAMP_ADDRESSMODE;

    const m = plasticMaterial(scene, null, {
      name: 'toyBlock',
      roughness: 0.4,
      clearcoat: 0.35,
      clearcoatRoughness: 0.2,
      albedoTexture: albedo,
      normalTexture: normal,
      normalStrength: 0.9,
    });
    return m;
  });
}

// ---------- layout (pure) ----------

export interface BlockSlot {
  course: 0 | 1; // 0 bottom, 1 top
  x: number; // centre x
  cream: boolean;
}

// Tallest a block may stand (wide walls use wider blocks, squashed a little so the wall stays
// about 1.3-1.4 high).
export const BLOCK_MAX_HEIGHT = 0.7;

// Plans a wall of the given width: n = round(width / 0.65) blocks in the bottom course and the
// top course in the n - 1 half-staggered slots. When that would exceed maxBlocks, the blocks
// grow (n = max(8, ceil(width / 0.85))) and the top course stays contiguous and centred (a
// stepped mound), so every intact wall is a complete two-course stack. side = width / n.
export function planWall(width: number, maxBlocks = 14): { side: number; height: number; slots: BlockSlot[] } {
  let nb = Math.max(1, Math.round(width / BLOCK_SIDE));
  if (nb + nb - 1 > maxBlocks) nb = Math.min(maxBlocks - 1, Math.max(Math.floor((maxBlocks + 1) / 2) + 1, Math.ceil(width / 0.85)));
  const side = width / nb;
  const height = Math.min(side, BLOCK_MAX_HEIGHT);
  const slots: BlockSlot[] = [];
  for (let i = 0; i < nb; i++) slots.push({ course: 0, x: (i - (nb - 1) / 2) * side, cream: i % 2 === 1 });
  const topSlots = nb - 1;
  const nt = Math.max(0, Math.min(topSlots, maxBlocks - nb));
  const first = Math.floor((topSlots - nt) / 2);
  for (let s = first; s < first + nt; s++) slots.push({ course: 1, x: (s - (topSlots - 1) / 2) * side, cream: s % 2 === 0 });
  return { side, height, slots };
}

// Cumulative number of blocks gone at a damage fraction (0..1): stages at 25/50/75 %
// damage (75/50/25 % HP), everything at 100 %.
export function blocksGone(total: number, top: number, damage: number): number {
  if (damage >= 1) return total;
  const stage = damage >= 0.75 ? 3 : damage >= 0.5 ? 2 : damage >= 0.25 ? 1 : 0;
  if (stage === 0) return 0;
  if (stage === 1) return Math.max(1, Math.round(top * 0.4));
  if (stage === 2) return top;
  return Math.min(total - 1, top + Math.max(1, Math.round((total - top) * 0.4)));
}

// ---------- the kit ----------

export interface WallModel {
  root: TransformNode;
  // 0..1; returns world positions of the blocks removed by this call (a shared frozen empty
  // array when nothing was removed: do not mutate it).
  setDamage(frac: number): Vector3[];
  setHit(k: number): void;
  topY(): number;
  dispose(): void;
}
export interface WallKit {
  root: TransformNode; // parent of the hidden source meshes
  create(width: number, depth: number): WallModel;
  dispose(): void;
}

const NONE = Object.freeze([]) as unknown as Vector3[];

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

export function createWallKit(scene: Scene, look: Look): WallKit {
  const mat = toyBlockMaterial(scene, look);
  const kitRoot = new TransformNode('wallKit', scene);
  const make = (name: string, faces: readonly number[], turns: readonly number[]): Mesh => {
    const m = buildMesh(scene, name, blockVertexData(1, faces, turns), mat);
    m.parent = kitRoot;
    m.registerInstancedBuffer('color', 4);
    m.instancedBuffers.color = new Color4(1, 1, 1, 1);
    m.isVisible = false; // only its instances draw
    // Shadow maps only draw instances that are in their render list themselves, so each
    // block instance is registered as a caster in create(); receiving is set on the source.
    look.receiveShadows(m);
    return m;
  };
  const tanSrc = make('wallBlockTan', BLOCK_FACES.tan, BLOCK_TURNS.tan);
  const creamSrc = make('wallBlockCream', BLOCK_FACES.cream, BLOCK_TURNS.cream);
  const blobSrc = createBlobShadowMesh(scene, 'wallBlob', 0.5);
  blobSrc.parent = kitRoot;
  blobSrc.isVisible = false;
  let serial = 0;
  const walls = new Set<WallModel>();

  const create = (width: number, depth: number): WallModel => {
    const rand = rng(0x9e3779b1 ^ (++serial * 7919) ^ Math.round(width * 100));
    const root = new TransformNode(`wall${serial}`, scene);
    const { side, height, slots } = planWall(width);
    const s = Math.min(side, depth) * 0.985;
    const hgt = Math.min(height, s);
    // Blocks sit toward the front (+Z) of the collision box so units meet the visible face.
    const front = Math.max(0, (depth - s) / 2 - 0.03);
    const blob = blobSrc.createInstance(`wallBlob${serial}`);
    blob.parent = root;
    blob.position.z = front;
    blob.scaling.set(width + 0.7, 1, s + 0.8);
    interface Block {
      inst: InstancedMesh;
      course: 0 | 1;
      base: Vector3;
      rot: Vector3;
      jit: Vector3; // extra knock-askew direction when damaged
      tint: number; // plastic batch brightness variation (+-3%)
    }
    const blocks: Block[] = slots.map((sl, i) => {
      const inst = (sl.cream ? creamSrc : tanSrc).createInstance(`wall${serial}b${i}`);
      inst.parent = root;
      look.addShadowCaster(inst);
      const k = 1 - rand() * 0.03;
      inst.scaling.set(s * k, hgt * k, s * k);
      // Upright, yaw by quarter turns (a random letter faces out) plus a +-0.08 rad twist.
      const yaw = Math.floor(rand() * 4) * (Math.PI / 2) + (rand() - 0.5) * 0.16;
      const base = new Vector3(
        sl.x + (rand() - 0.5) * 0.05 * s,
        hgt / 2 + sl.course * hgt * 0.995,
        front + (rand() - 0.5) * 0.08 * s + (sl.course ? -0.03 + (rand() - 0.5) * 0.04 : 0),
      );
      const rot = new Vector3(0, yaw, 0);
      inst.position.copyFrom(base);
      inst.rotation.copyFrom(rot);
      const tint = 0.97 + rand() * 0.06;
      inst.instancedBuffers.color = new Color4(tint, tint, tint, 1);
      return { inst, course: sl.course, base, rot, tint, jit: new Vector3((rand() - 0.5) * 0.1, (rand() - 0.5) * 0.18, (rand() - 0.5) * 0.08) };
    });
    // Removal order: top course first (shuffled), then the bottom course from the ends in.
    const top = blocks.filter((b) => b.course === 1);
    const bottom = blocks.filter((b) => b.course === 0);
    for (let i = top.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [top[i], top[j]] = [top[j], top[i]];
    }
    const nb = bottom.length;
    const bottomOrder: Block[] = [];
    for (let a = 0, b = nb - 1; a <= b; a++, b--) {
      const first = rand() < 0.5;
      bottomOrder.push(first ? bottom[a] : bottom[b]);
      if (a !== b) bottomOrder.push(first ? bottom[b] : bottom[a]);
    }
    const order = [...top, ...bottomOrder];
    let gone = 0;
    let damage = 0;
    let hit = 0;

    const pose = (): void => {
      // Remaining blocks get knocked a little askew as the wall takes damage.
      const k = damage;
      for (const b of blocks) {
        const lift = b.course === 1 ? 1 : 0.5;
        b.inst.position.set(b.base.x + b.jit.x * k * s * lift, b.base.y, b.base.z + b.jit.z * k * s * 2 * lift);
        b.inst.rotation.set(b.rot.x, b.rot.y + b.jit.y * k * 1.2, b.rot.z);
      }
    };

    const model: WallModel = {
      root,
      setDamage(frac: number): Vector3[] {
        const d = Math.min(1, Math.max(0, frac));
        if (d === damage) return NONE;
        damage = d;
        const want = blocksGone(order.length, top.length, damage);
        let removed = NONE;
        if (want > gone) {
          removed = [];
          root.computeWorldMatrix(true);
          for (let i = gone; i < want; i++) {
            const inst = order[i].inst;
            inst.computeWorldMatrix(true);
            removed.push(inst.getAbsolutePosition().clone());
            inst.setEnabled(false);
          }
        } else {
          for (let i = want; i < gone; i++) order[i].inst.setEnabled(true);
        }
        if (want !== gone) blob.setEnabled(want < order.length);
        gone = want;
        pose();
        return removed;
      },
      setHit(k: number): void {
        const h = Math.min(1, Math.max(0, k));
        if (h === hit) return;
        hit = h;
        const c = 1 + hit * 0.9;
        for (const b of blocks) {
          const col = b.inst.instancedBuffers.color as Color4;
          col.set(b.tint * c, b.tint * c * 0.97, b.tint * c * 0.92, 1);
        }
        root.scaling.set(1 + hit * 0.04, 1 + hit * 0.07, 1 + hit * 0.04);
      },
      topY(): number {
        let y = 0;
        for (let i = gone; i < order.length; i++) y = Math.max(y, (order[i].course + 1) * hgt);
        return y * root.scaling.y;
      },
      dispose(): void {
        walls.delete(model);
        root.dispose();
      },
    };
    walls.add(model);
    return model;
  };

  return {
    root: kitRoot,
    create,
    dispose(): void {
      for (const w of [...walls]) w.dispose();
      kitRoot.dispose();
    },
  };
}

// ---------- preview ----------

export function preview(scene: Scene, look: Look, opts: PreviewOptions): PreviewResult {
  const root = new TransformNode('wallPreview', scene);
  const kit = createWallKit(scene, look);
  // the kit's sources live under its own node; parent it so the harness sees every mesh
  kit.root.parent = root;
  const crumbling = opts.variant === 'crumbling';
  const specs: [number, number][] = [[3, -3.2], [4, 0], [6, 3.4]];
  const walls = specs.map(([w, z]) => {
    const m = kit.create(w, 1);
    m.root.parent = root;
    m.root.position.set(w === 4 ? 0 : w === 3 ? -1.6 : 1.0, 0, z);
    return m;
  });
  let lastHit = 0;
  return {
    root,
    update(time: number): void {
      if (!crumbling) return;
      const t = (time % 7) / 6; // 6 s from intact to gone, 1 s pause
      const d = Math.min(1, t);
      for (const w of walls) w.setDamage(d);
      // a little hit pulse every 0.5 s
      const phase = (time % 0.5) / 0.5;
      const k = Math.max(0, 1 - phase * 4);
      if (k !== lastHit) {
        for (const w of walls) w.setHit(d < 1 ? k : 0);
        lastHit = k;
      }
    },
    dispose(): void {
      kit.dispose();
      root.dispose();
    },
  };
}
