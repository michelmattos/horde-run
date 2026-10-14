// The Tin General (World 1 boss, level 1-10): a vintage lithographed tin toy. A riveted tin
// tank in deep red livery with cream racing stripes, a navy skirt and printed gold stars,
// black rubber treads with real track links over pressed-tin road wheels, a cream turret
// with a stubby tin cannon, headlights, and a BIG brass wind-up key on the back. The
// General stands in the open turret hatch: red coat, white cross-belts, gold epaulettes,
// tall navy shako with gold bands and a red plume, painted face with a handlebar
// moustache, sabre raised.
//
// Everything except the treads shares ONE PBR material driven by a 512 px canvas atlas
// (albedo + a packed clearcoat/roughness/metal map + an embossing normal map), so bare
// tin, painted tin, printed gold and brass all come from one shader:
//   tank (static mesh)   1 draw   atlas material
//   general (mesh)       1 draw   atlas material (bobs, turns, pops)
//   key (mesh)           1 draw   atlas material (turns about local Z)
//   treads (thin inst.)  1 draw   rubberMaterial, links moved by setTreadPhase
//   contact blob         1 draw   look blob shadow
// = 5 draw calls (+ shadow-map passes), ~12k triangles.
//
// GAME API
//   createTinGeneral(scene, look, { width, depth, hullHeight }): TinGeneralModel
//     width:      level.enemyBase.width (5 on 1-10); the treads sit inside it
//     depth:      LAYOUT.enemyBaseDepth (4)
//     hullHeight: hull deck height (~1.4)
//   Pivot: the hull's ground centre; front (cannon, General's face) is +Z. side 'enemy':
//   integration sets root.rotation.y = PI so the front faces the camera, and moves
//   root.position (x strafe, z = base centre). Shadows (casters + receivers) and the
//   contact blob are registered here.
//   model.general       TransformNode: integration may bob it (position.y += ...) and turn
//                       it (rotation.y in +-0.15 rad). Its rest position is generalRestY.
//   model.key           TransformNode: rotate key.rotation.z (any speed, ~2.2 rad/s).
//   model.hpBarAnchor   Vector3, root-local: just above the glacis at the hull's front edge.
//   model.setFlash(k)   0..1 warm white flash on the whole toy (phase: long and strong;
//                       hit: short flicker). 0 = off.
//   model.setPop(s)     General scale (1 = rest; ~1.35 peak on a phase change).
//   model.setTreadPhase(t) tread travel in lane units (links run round the loop).
//   model.dispose()
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Look } from '../look/index.ts';
import {
  buildMesh,
  createBlobShadowMesh,
  fixWinding,
  HEX,
  lin,
  mergeParts,
  paintedTinMaterial,
  place,
  roundedBox,
  rubberMaterial,
} from '../look/index.ts';
import type { ModelInfo, PreviewOptions, PreviewResult } from '../look/model.ts';

export const info: ModelInfo = {
  key: 'tinGeneral',
  title: 'Boss: the Tin General on his wind-up tin tank',
  instanced: false,
  teams: false,
  side: 'enemy',
  height: 4.4,
  triangleBudget: 15000,
  gameZ: 57,
};

const GENERAL_SCALE = 1.15; // the General reads at the far end of the lane
const KEY_SCALE = 1.3; // a BIG wind-up key

export interface TinGeneralOptions {
  width: number;
  depth: number;
  hullHeight: number;
}

export interface TinGeneralModel {
  root: TransformNode;
  general: TransformNode;
  key: TransformNode;
  generalRestY: number;
  hpBarAnchor: Vector3;
  setFlash(k: number): void;
  setPop(scale: number): void;
  setTreadPhase(t: number): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------------------
// Colours (sRGB). The livery is a deeper red than the General's coat so he pops off it.
const C = {
  livery: '#8e2420',
  liveryDark: '#5e1714',
  cream: '#f1e4c4',
  navy: HEX.tinNavy,
  gold: '#e0b04a',
  tin: HEX.tin,
  coat: HEX.tinRed,
  skin: HEX.skin,
  white: '#f2efe6',
  ink: '#1d1a1c',
  cheek: '#e88f7e',
  moustache: '#4a2c1a',
  brass: HEX.brass,
  lens: '#fff3c8',
  plume: '#d43a2c',
} as const;

// ---------------------------------------------------------------------------------------
// Atlas layout (canvas pixels, 512 x 512). Canvas y runs down; texture v runs up.
const AW = 512;
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
const R = {
  paint: { x: 0, y: 0, w: 64, h: 48 }, // swatch: painted tin (colour from vertex colours)
  tin: { x: 64, y: 0, w: 64, h: 48 }, // swatch: bare tin
  brass: { x: 128, y: 0, w: 64, h: 48 }, // swatch: brass
  skin: { x: 192, y: 0, w: 64, h: 48 }, // swatch: matte-ish paint (skin, cloth)
  side: { x: 0, y: 48, w: 512, h: 112 },
  glacis: { x: 0, y: 160, w: 512, h: 96 },
  deck: { x: 0, y: 256, w: 320, h: 160 },
  face: { x: 320, y: 256, w: 128, h: 128 },
  turret: { x: 0, y: 416, w: 512, h: 80 },
} satisfies Record<string, Rect>;

// Region-local (0..1, v up) -> atlas uv.
function ruv(r: Rect, u: number, v: number): [number, number] {
  const iu = 1.5 / r.w,
    iv = 1.5 / r.h;
  const uu = Math.min(1 - iu, Math.max(iu, u));
  const vv = Math.min(1 - iv, Math.max(iv, v));
  return [(r.x + uu * r.w) / AW, 1 - (r.y + (1 - vv) * r.h) / AW];
}

// Material classes for the packed map: R = clearcoat, G = roughness, B = metallic.
interface Ink {
  hex: string;
  cc: number;
  rough: number;
  metal: number;
}
const paintInk = (hex: string): Ink => ({ hex, cc: 0.75, rough: 0.34, metal: 0.18 });
const INK = {
  livery: paintInk(C.livery),
  liveryDark: paintInk(C.liveryDark),
  cream: paintInk(C.cream),
  navy: paintInk(C.navy),
  white: paintInk('#ffffff'),
  gold: { hex: C.gold, cc: 0.7, rough: 0.28, metal: 0.75 }, // metallic litho gold ink
  tin: { hex: '#ffffff', cc: 0, rough: 0.18, metal: 0.95 },
  tinPrint: { hex: C.tin, cc: 0, rough: 0.2, metal: 0.95 }, // bare tin showing through the print
  brass: { hex: '#ffffff', cc: 0, rough: 0.24, metal: 1 },
  skin: { hex: '#ffffff', cc: 0.45, rough: 0.46, metal: 0.05 },
  face: { hex: C.skin, cc: 0.45, rough: 0.46, metal: 0.05 },
  ink: { hex: C.ink, cc: 0.5, rough: 0.3, metal: 0.05 },
  cheek: { hex: C.cheek, cc: 0.45, rough: 0.5, metal: 0.05 },
  moustache: { hex: C.moustache, cc: 0.4, rough: 0.5, metal: 0.05 },
  eyeWhite: { hex: '#fbf7ee', cc: 0.6, rough: 0.3, metal: 0.05 },
} satisfies Record<string, Ink>;

type Mode = 'albedo' | 'orm' | 'height';

class Painter {
  readonly g: CanvasRenderingContext2D;
  readonly mode: Mode;
  constructor(g: CanvasRenderingContext2D, mode: Mode) {
    this.g = g;
    this.mode = mode;
  }
  // Sets the fill for an ink (and optional relief height 0..1); false = skip in this mode.
  private fill(ink: Ink | null, h?: number): boolean {
    if (this.mode === 'height') {
      if (h === undefined) return false;
      const v = Math.round(h * 255);
      this.g.fillStyle = `rgb(${v},${v},${v})`;
      return true;
    }
    if (!ink) return false;
    this.g.fillStyle =
      this.mode === 'albedo'
        ? ink.hex
        : `rgb(${Math.round(ink.cc * 255)},${Math.round(ink.rough * 255)},${Math.round(ink.metal * 255)})`;
    return true;
  }
  rect(x: number, y: number, w: number, h: number, ink: Ink | null, hgt?: number): void {
    if (this.fill(ink, hgt)) this.g.fillRect(x, y, w, h);
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, ink: Ink | null, hgt?: number): void {
    if (!this.fill(ink, hgt)) return;
    this.g.beginPath();
    this.g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    this.g.fill();
  }
  circle(cx: number, cy: number, r: number, ink: Ink | null, hgt?: number): void {
    this.ellipse(cx, cy, r, r, ink, hgt);
  }
  // Five-point star, sx squashes it horizontally (to undo a stretched mapping).
  star(cx: number, cy: number, r: number, ink: Ink | null, hgt?: number, sx = 1): void {
    if (!this.fill(ink, hgt)) return;
    const g = this.g;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? r * 0.42 : r;
      const x = cx + Math.cos(a) * rr * sx,
        y = cy + Math.sin(a) * rr;
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.closePath();
    g.fill();
  }
  path(build: (g: CanvasRenderingContext2D) => void, ink: Ink | null, hgt?: number): void {
    if (!this.fill(ink, hgt)) return;
    this.g.beginPath();
    build(this.g);
    this.g.fill();
  }
  // A pressed rivet: bare tin dot with a domed relief.
  rivet(cx: number, cy: number, r: number): void {
    if (this.mode === 'height') {
      const grd = this.g.createRadialGradient(cx, cy, 0, cx, cy, r);
      grd.addColorStop(0, 'rgb(255,255,255)');
      grd.addColorStop(0.7, 'rgb(200,200,200)');
      grd.addColorStop(1, 'rgb(128,128,128)');
      this.g.fillStyle = grd;
      this.g.beginPath();
      this.g.arc(cx, cy, r, 0, Math.PI * 2);
      this.g.fill();
      return;
    }
    this.circle(cx, cy, r, INK.tinPrint);
  }
  // Star roundel: cream ring, navy disc, gold star (embossed slightly).
  roundel(cx: number, cy: number, r: number, sx = 1): void {
    this.ellipse(cx, cy, r * sx, r, INK.cream, 0.62);
    this.ellipse(cx, cy, r * 0.8 * sx, r * 0.8, INK.navy, 0.6);
    this.star(cx, cy, r * 0.7, INK.gold, 0.68, sx);
  }
}

function paintAtlas(p: Painter): void {
  const g = p.g;
  // Base: everything painted, relief neutral.
  p.rect(0, 0, AW, AW, INK.white, 0.5);
  // Swatches.
  p.rect(R.paint.x, R.paint.y, R.paint.w, R.paint.h, INK.white);
  p.rect(R.tin.x, R.tin.y, R.tin.w, R.tin.h, INK.tin);
  p.rect(R.brass.x, R.brass.y, R.brass.w, R.brass.h, INK.brass);
  p.rect(R.skin.x, R.skin.y, R.skin.w, R.skin.h, INK.skin);

  // ---- Hull sides (z along u, y up) ----
  {
    const { x, y, w, h } = R.side;
    p.rect(x, y, w, h, INK.livery);
    p.rect(x, y + 3, w, 3, INK.tinPrint); // bare tin pinstripe along the top fold
    p.rect(x, y + 16, w, 12, INK.cream);
    p.rect(x, y + 30, w, 2, INK.tinPrint);
    p.rect(x, y + 74, w, h - 74, INK.navy);
    p.rect(x, y + 70, w, 4, INK.cream);
    for (let k = 0; k < 16; k++) p.rivet(x + 16 + k * 32, y + 10, 3.2);
    for (let k = 0; k < 16; k++) p.rivet(x + 16 + k * 32, y + 96, 3.2);
    for (const gx of [150, 362]) p.rect(x + gx, y + 34, 2, 36, null, 0.25); // pressed panel seams
    p.roundel(x + w / 2, y + 51, 17, 0.55);
  }

  // ---- Glacis (x across, slope up). The star faces the camera. ----
  {
    const { x, y, w, h } = R.glacis;
    p.rect(x, y, w, h, INK.livery);
    p.rect(x, y + h - 14, w, 14, INK.navy); // navy lower lip band
    p.rect(x, y + h - 17, w, 3, INK.cream);
    // Cream speed stripes either side of the star, with bare-tin pinstripes.
    for (const s of [-1, 1]) {
      const x0 = s < 0 ? x + 70 : x + w / 2 + 58;
      const x1 = s < 0 ? x + w / 2 - 58 : x + w - 70;
      for (const [yy, hh] of [
        [y + 24, 9],
        [y + 40, 9],
        [y + 56, 9],
      ] as const) {
        p.rect(x0, yy, x1 - x0, hh, INK.cream);
      }
      p.rect(x0, y + 20, x1 - x0, 2, INK.tinPrint);
      p.rect(x0, y + 68, x1 - x0, 2, INK.tinPrint);
    }
    // Pressed panel seams and rivet rows.
    for (const gx of [128, 384]) p.rect(x + gx, y + 4, 2, h - 22, null, 0.25);
    for (let k = 0; k < 24; k++) {
      const rx = x + 12 + k * ((w - 24) / 23);
      p.rivet(rx, y + 8, 3.4);
    }
    p.roundel(x + w / 2, y + h / 2 - 6, 36);
  }

  // ---- Deck (x across, z along v; canvas top = rear) ----
  {
    const { x, y, w, h } = R.deck;
    p.rect(x, y, w, h, INK.livery);
    // Racing stripes front to back.
    for (const u of [0.3, 0.7]) {
      const cx = x + u * w;
      p.rect(cx - 12, y, 24, h, INK.cream);
      p.rect(cx - 15, y, 2, h, INK.tinPrint);
      p.rect(cx + 13, y, 2, h, INK.tinPrint);
    }
    // Engine grille at the rear: navy panel with raised tin slats.
    p.rect(x + w / 2 - 70, y + 6, 140, 34, INK.navy, 0.42);
    for (let k = 0; k < 11; k++) p.rect(x + w / 2 - 62 + k * 12.4, y + 10, 5, 26, INK.tinPrint, 0.75);
    // Perimeter seam and rivets.
    p.rect(x + 6, y + 4, w - 12, 2, null, 0.25);
    p.rect(x + 6, y + h - 6, w - 12, 2, null, 0.25);
    for (let k = 0; k < 14; k++) {
      p.rivet(x + 12 + k * ((w - 24) / 13), y + h - 12, 2.8);
    }
    p.rect(x, y + h - 3, w, 3, INK.tinPrint);
    // Printed roundels and hatch outlines on the fender tops either side of the turret.
    for (const u of [0.11, 0.89]) {
      const cx = x + u * w;
      p.rect(cx - 22, y + 30, 44, 2, null, 0.3);
      p.rect(cx - 22, y + 30, 2, 64, null, 0.3);
      p.rect(cx + 20, y + 30, 2, 64, null, 0.3);
      p.rect(cx - 22, y + 92, 44, 2, null, 0.3);
      p.roundel(cx, y + 118, 20, 0.95);
      for (const dy of [36, 88]) for (const dx of [-16, 16]) p.rivet(cx + dx, y + dy, 2.4);
    }
  }

  // ---- The General's face (front hemisphere, planar from the front) ----
  {
    const { x, y, w } = R.face;
    const s = w / 128;
    const X = (v: number): number => x + v * s;
    const Y = (v: number): number => y + v * s;
    p.rect(x, y, w, w, INK.face, 0.5);
    // Rosy cheeks (soft-edged).
    if (p.mode === 'albedo') {
      for (const cx of [34, 94]) {
        const grd = g.createRadialGradient(X(cx), Y(80), 0, X(cx), Y(80), 15 * s);
        grd.addColorStop(0, 'rgba(232,130,112,0.85)');
        grd.addColorStop(1, 'rgba(232,130,112,0)');
        g.fillStyle = grd;
        g.fillRect(X(cx - 16), Y(64), 32 * s, 32 * s);
      }
    }
    // Eyebrows.
    for (const sgn of [-1, 1]) {
      p.path(
        (c) => {
          const cx = X(64 + sgn * 21);
          c.ellipse(cx, Y(45), 11 * s, 3.2 * s, sgn * 0.18, 0, Math.PI * 2);
        },
        INK.moustache,
        0.56,
      );
    }
    // Eyes: white, black pupil, glint.
    for (const sgn of [-1, 1]) {
      const cx = X(64 + sgn * 20);
      p.ellipse(cx, Y(57), 7.5 * s, 8.5 * s, INK.eyeWhite, 0.52);
      p.ellipse(cx + sgn * 0.5 * s, Y(58), 5 * s, 6 * s, INK.ink, 0.54);
      p.circle(cx - 1.8 * s, Y(55.5), 1.7 * s, INK.eyeWhite);
    }
    // Handlebar moustache with curled tips.
    p.path(
      (c) => {
        c.moveTo(X(64), Y(84));
        c.bezierCurveTo(X(54), Y(76), X(40), Y(80), X(30), Y(84));
        c.bezierCurveTo(X(22), Y(87), X(14), Y(82), X(16), Y(72));
        c.bezierCurveTo(X(18), Y(80), X(24), Y(82), X(30), Y(90));
        c.bezierCurveTo(X(40), Y(98), X(56), Y(96), X(64), Y(90));
        c.bezierCurveTo(X(72), Y(96), X(88), Y(98), X(98), Y(90));
        c.bezierCurveTo(X(104), Y(82), X(110), Y(80), X(112), Y(72));
        c.bezierCurveTo(X(114), Y(82), X(106), Y(87), X(98), Y(84));
        c.bezierCurveTo(X(88), Y(80), X(74), Y(76), X(64), Y(84));
      },
      INK.moustache,
      0.62,
    );
    // Small smile under it.
    p.path(
      (c) => {
        c.ellipse(X(64), Y(103), 7 * s, 2.4 * s, 0, 0, Math.PI);
      },
      INK.liveryDark,
      0.48,
    );
  }

  // ---- Turret band (u around, front of the turret at u = 0.25) ----
  {
    const { x, y, w, h } = R.turret;
    const sx = 0.42; // the band is ~2.4x wider in the world than in the atlas
    p.rect(x, y, w, h, INK.cream);
    p.rect(x, y + 6, w, 3, INK.livery);
    p.rect(x, y + h - 34, w, 34, INK.navy);
    p.rect(x, y + h - 38, w, 3, INK.livery);
    for (let k = 0; k < 32; k++) p.rivet(x + 8 + k * 16, y + h - 6, 2.4);
    for (const [u, r] of [
      [0.25, 13],
      [0.75, 11],
      [0.0, 11],
      [0.5, 11],
      [1.0, 11],
      [0.125, 7],
      [0.375, 7],
      [0.625, 7],
      [0.875, 7],
    ] as const) {
      p.star(x + u * w, y + h - 19, r, INK.gold, 0.66, sx);
    }
    // A printed number on the cream above the front star: "10" (level 1-10).
    if (p.mode !== 'height') {
      g.save();
      g.translate(x + 0.25 * w, y + 24);
      g.scale(sx * 1.6, 1);
      g.font = 'bold 24px Georgia, serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = p.mode === 'albedo' ? C.navy : 'rgb(191,87,46)';
      g.fillText('No.10', 0, 0);
      g.restore();
    }
  }
}

interface Atlas {
  albedo: DynamicTexture;
  orm: DynamicTexture;
  normal: DynamicTexture;
}

function makeAtlas(scene: Scene): Atlas {
  const mk = (name: string): DynamicTexture => {
    const t = new DynamicTexture(name, { width: AW, height: AW }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    t.wrapU = t.wrapV = Texture.CLAMP_ADDRESSMODE;
    t.anisotropicFilteringLevel = 4;
    return t;
  };
  const albedo = mk('tinGeneralAlbedo');
  paintAtlas(new Painter(albedo.getContext() as unknown as CanvasRenderingContext2D, 'albedo'));
  albedo.update(true);

  const orm = mk('tinGeneralOrm');
  paintAtlas(new Painter(orm.getContext() as unknown as CanvasRenderingContext2D, 'orm'));
  orm.update(true);
  orm.gammaSpace = false;

  const normal = mk('tinGeneralNormal');
  const nctx = normal.getContext() as unknown as CanvasRenderingContext2D;
  paintAtlas(new Painter(nctx, 'height'));
  const img = nctx.getImageData(0, 0, AW, AW);
  const src = img.data;
  const hgt = new Float32Array(AW * AW);
  for (let i = 0; i < AW * AW; i++) hgt[i] = src[i * 4] / 255;
  // Soften the height map with two separable 3-tap box passes (~ a 1.2 px blur). Done in JS:
  // a canvas 'blur()' filter costs seconds in software rasterisers and is not cheap on phones.
  const tmp = new Float32Array(AW * AW);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < AW; y++) {
      const r = y * AW;
      for (let x = 0; x < AW; x++)
        tmp[r + x] = (hgt[r + Math.max(0, x - 1)] + hgt[r + x] + hgt[r + Math.min(AW - 1, x + 1)]) / 3;
    }
    for (let y = 0; y < AW; y++) {
      const ym = Math.max(0, y - 1) * AW,
        y0 = y * AW,
        yp = Math.min(AW - 1, y + 1) * AW;
      for (let x = 0; x < AW; x++) hgt[y0 + x] = (tmp[ym + x] + tmp[y0 + x] + tmp[yp + x]) / 3;
    }
  }

  const out = nctx.createImageData(AW, AW);
  const d = out.data;
  const k = 4.5;
  for (let y = 0; y < AW; y++) {
    for (let x = 0; x < AW; x++) {
      const xm = Math.max(0, x - 1),
        xp = Math.min(AW - 1, x + 1);
      const ym = Math.max(0, y - 1),
        yp = Math.min(AW - 1, y + 1);
      const dx = hgt[y * AW + xp] - hgt[y * AW + xm];
      const dy = hgt[yp * AW + x] - hgt[ym * AW + x];
      let nx = -dx * k,
        ny = dy * k,
        nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const o = (y * AW + x) * 4;
      d[o] = (nx * 0.5 + 0.5) * 255;
      d[o + 1] = (ny * 0.5 + 0.5) * 255;
      d[o + 2] = (nz * 0.5 + 0.5) * 255;
      d[o + 3] = 255;
    }
  }
  nctx.putImageData(out, 0, 0);
  normal.update(true);
  normal.gammaSpace = false;
  return { albedo, orm, normal };
}

function makeAtlasMaterial(scene: Scene, atlas: Atlas): PBRMaterial {
  const m = paintedTinMaterial(scene, null, {
    name: 'tinGeneralAtlas',
    albedoTexture: atlas.albedo,
    normalTexture: atlas.normal,
    normalStrength: 0.9,
    metallic: 1,
    roughness: 1,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    texture: false,
  });
  m.metallicTexture = atlas.orm;
  m.useRoughnessFromMetallicTextureAlpha = false;
  m.useRoughnessFromMetallicTextureGreen = true;
  m.useMetallnessFromMetallicTextureBlue = true;
  m.useAmbientOcclusionFromMetallicTextureRed = false;
  m.clearCoat.texture = atlas.orm;
  m.clearCoat.useRoughnessFromMainTexture = false;
  return m;
}

// ---------------------------------------------------------------------------------------
// Geometry helpers.
type P2 = readonly [number, number];

// Lathe around +Y over an angle range [a0, a1] (radians; 0 = +X, PI/2 = +Z).
function latheArc(profile: readonly P2[], tess: number, a0 = 0, a1 = Math.PI * 2): VertexData {
  const n = profile.length;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const n2: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    let pa = profile[Math.max(0, i - 1)];
    let pb = profile[Math.min(n - 1, i + 1)];
    if (i > 0 && profile[i - 1][0] === profile[i][0] && profile[i - 1][1] === profile[i][1]) pa = profile[i];
    if (i < n - 1 && profile[i + 1][0] === profile[i][0] && profile[i + 1][1] === profile[i][1]) pb = profile[i];
    let dr = pb[0] - pa[0],
      dy = pb[1] - pa[1];
    if (Math.abs(dr) + Math.abs(dy) < 1e-9) {
      dr = 0;
      dy = 1;
    }
    const l = Math.hypot(dr, dy);
    n2.push([dy / l, -dr / l]);
  }
  const along = [0];
  for (let i = 1; i < n; i++)
    along.push(along[i - 1] + Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]));
  const total = along[n - 1] || 1;
  for (let s = 0; s <= tess; s++) {
    const th = a0 + ((a1 - a0) * s) / tess;
    const c = Math.cos(th),
      sn = Math.sin(th);
    for (let i = 0; i < n; i++) {
      const [r, y] = profile[i];
      positions.push(r * c, y, r * sn);
      normals.push(n2[i][0] * c, n2[i][1], n2[i][0] * sn);
      uvs.push(s / tess, along[i] / total);
    }
  }
  for (let s = 0; s < tess; s++) {
    for (let i = 0; i < n - 1; i++) {
      const a = s * n + i,
        b = (s + 1) * n + i;
      const pa = profile[i],
        pb = profile[i + 1];
      if (pa[0] === 0 && pb[0] === 0) continue;
      if (pa[0] === pb[0] && pa[1] === pb[1]) continue;
      indices.push(a, b, b + 1, a, b + 1, a + 1);
    }
  }
  const vd = new VertexData();
  vd.positions = positions;
  vd.normals = normals;
  vd.uvs = uvs;
  vd.indices = indices;
  return fixWinding(dropDegenerate(vd));
}

function dropDegenerate(vd: VertexData): VertexData {
  const p = vd.positions!;
  const src = vd.indices!;
  const out: number[] = [];
  for (let t = 0; t < src.length; t += 3) {
    const a = src[t] * 3,
      b = src[t + 1] * 3,
      c = src[t + 2] * 3;
    const e1x = p[b] - p[a],
      e1y = p[b + 1] - p[a + 1],
      e1z = p[b + 2] - p[a + 2];
    const e2x = p[c] - p[a],
      e2y = p[c + 1] - p[a + 1],
      e2z = p[c + 2] - p[a + 2];
    if (Math.hypot(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x) > 1e-10)
      out.push(src[t], src[t + 1], src[t + 2]);
  }
  vd.indices = out;
  return vd;
}

// Paints a vertex colour (linear) and points every uv at a swatch.
function swatch(vd: VertexData, r: Rect, color: string | Color3, alpha = 1): VertexData {
  const c = typeof color === 'string' ? lin(color) : color;
  const n = vd.positions!.length / 3;
  const colors = new Float32Array(n * 4);
  const uvs = new Float32Array(n * 2);
  const [u, v] = ruv(r, 0.5, 0.5);
  for (let i = 0; i < n; i++) {
    colors.set([c.r, c.g, c.b, alpha], i * 4);
    uvs[i * 2] = u;
    uvs[i * 2 + 1] = v;
  }
  vd.colors = colors;
  vd.uvs = uvs;
  return vd;
}

// Maps uvs into a region with a per-vertex function (x, y, z -> region-local u, v) and
// paints the vertex colour white (the region holds the colours).
function regionMap(vd: VertexData, r: Rect, f: (x: number, y: number, z: number, i: number) => P2): VertexData {
  const p = vd.positions!;
  const n = p.length / 3;
  const uvs = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const [u, v] = f(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], i);
    const [a, b] = ruv(r, u, v);
    uvs[i * 2] = a;
    uvs[i * 2 + 1] = b;
  }
  vd.uvs = uvs;
  vd.colors = new Float32Array(n * 4).fill(1);
  return vd;
}

// Multiplies vertex colours by a height gradient (cheap AO toward the floor / a crevice).
function shadeY(vd: VertexData, y0: number, y1: number, min: number): VertexData {
  const p = vd.positions!;
  const c = vd.colors as Float32Array;
  for (let i = 0; i < p.length / 3; i++) {
    const t = Math.min(1, Math.max(0, (p[i * 3 + 1] - y0) / (y1 - y0)));
    const k = min + (1 - min) * t * t * (3 - 2 * t);
    c[i * 4] *= k;
    c[i * 4 + 1] *= k;
    c[i * 4 + 2] *= k;
  }
  return vd;
}

// A quad with a flat normal; uv per corner.
function quad(pts: readonly Vector3[], n: Vector3, uv: readonly P2[]): VertexData {
  const vd = new VertexData();
  vd.positions = pts.flatMap((q) => [q.x, q.y, q.z]);
  vd.normals = pts.flatMap(() => [n.x, n.y, n.z]);
  vd.uvs = uv.flatMap((q) => [q[0], q[1]]);
  vd.indices = [0, 1, 2, 0, 2, 3];
  return fixWinding(vd);
}

// Convex polygon fan (flat normal).
function fan(pts: readonly Vector3[], n: Vector3): VertexData {
  const vd = new VertexData();
  vd.positions = pts.flatMap((q) => [q.x, q.y, q.z]);
  vd.normals = pts.flatMap(() => [n.x, n.y, n.z]);
  vd.uvs = pts.flatMap(() => [0, 0]);
  const idx: number[] = [];
  for (let i = 1; i < pts.length - 1; i++) idx.push(0, i, i + 1);
  vd.indices = idx;
  return fixWinding(vd);
}

// Orients a part built along +Y so +Y runs from a to b (length already |b - a|).
function alongSegment(vd: VertexData, a: Vector3, b: Vector3, sx = 1, sz = 1, spin = 0): VertexData {
  const dir = b.subtract(a).normalize();
  const q = new Quaternion();
  Quaternion.FromUnitVectorsToRef(Vector3.Up(), dir, q);
  const spinQ = Quaternion.RotationAxis(Vector3.Up(), spin);
  vd.transform(Matrix.Compose(new Vector3(sx, 1, sz), q.multiply(spinQ), a));
  return vd;
}

// A rounded limb (capsule-ish lathe) from a to b, radius r0 at a, r1 at b.
function limb(a: Vector3, b: Vector3, r0: number, r1: number, tess = 10): VertexData {
  const L = Vector3.Distance(a, b);
  const prof: P2[] = [
    [0, -r0 * 0.9],
    [r0 * 0.6, -r0 * 0.75],
    [r0, -r0 * 0.1],
    [r0 * 1.02, L * 0.3],
    [r1, L],
    [r1 * 0.7, L + r1 * 0.6],
    [0, L + r1 * 0.85],
  ];
  return alongSegment(latheArc(prof, tess), a, b);
}

function sphere(r: number, tess = 10, rings = 6): P2[] {
  const out: P2[] = [];
  for (let i = 0; i <= rings; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / rings;
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  out[0] = [0, -r];
  out[rings] = [0, r];
  void tess;
  return out;
}

// ---------------------------------------------------------------------------------------
// The hull: an extruded side profile (z, y) with bevelled (bare tin) edges, full width.
type HullFace = 'under' | 'edge' | 'lip' | 'glacis' | 'deck' | 'rear';

function hullPrism(profile: readonly P2[], faces: readonly HullFace[], halfW: number, bevel: number): VertexData[] {
  const n = profile.length;
  const cz = profile.reduce((s, q) => s + q[0], 0) / n;
  const cy = profile.reduce((s, q) => s + q[1], 0) / n;
  // Outward edge normals (in z, y).
  const en: P2[] = [];
  for (let i = 0; i < n; i++) {
    const a = profile[i],
      b = profile[(i + 1) % n];
    let nz = b[1] - a[1],
      ny = -(b[0] - a[0]);
    const l = Math.hypot(nz, ny);
    nz /= l;
    ny /= l;
    const mz = (a[0] + b[0]) / 2 - cz,
      my = (a[1] + b[1]) / 2 - cy;
    if (nz * mz + ny * my < 0) {
      nz = -nz;
      ny = -ny;
    }
    en.push([nz, ny]);
  }
  // Inset cap polygon (each vertex moved in along its bisector by `bevel`).
  const inset: P2[] = profile.map((q, i) => {
    const na = en[(i - 1 + n) % n],
      nb = en[i];
    let mz = na[0] + nb[0],
      my = na[1] + nb[1];
    const l = Math.hypot(mz, my) || 1;
    mz /= l;
    my /= l;
    const d = bevel / Math.max(0.3, mz * nb[0] + my * nb[1]);
    return [q[0] - mz * d, q[1] - my * d];
  });
  const hx = halfW - bevel;
  const zs = profile.map((q) => q[0]);
  const ys = profile.map((q) => q[1]);
  const zMin = Math.min(...zs),
    zMax = Math.max(...zs),
    yMin = Math.min(...ys),
    yMax = Math.max(...ys);
  const parts: VertexData[] = [];
  const V = (x: number, q: P2): Vector3 => new Vector3(x, q[1], q[0]);
  for (let i = 0; i < n; i++) {
    const a = profile[i],
      b = profile[(i + 1) % n];
    const nrm = new Vector3(0, en[i][1], en[i][0]);
    const face = faces[i];
    const strip = quad([V(-hx, a), V(hx, a), V(hx, b), V(-hx, b)], nrm, [
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
    // uvs: u from x (mirrored: the viewer in front sees +X on the left), v along the edge.
    const uvOf = (x: number, t: number): P2 => [0.5 - x / (2 * halfW), t];
    if (face === 'glacis') {
      regionMap(strip, R.glacis, (x, _y, _z, k) => uvOf(x, k < 2 ? 0 : 1));
    } else if (face === 'deck') {
      regionMap(strip, R.deck, (x, _y, _z, k) => uvOf(x, k < 2 ? 0 : 1));
    } else if (face === 'edge') {
      swatch(strip, R.tin, C.tin);
    } else if (face === 'under') {
      swatch(strip, R.paint, '#2a2024');
    } else if (face === 'lip') {
      swatch(strip, R.paint, C.navy);
    } else {
      swatch(strip, R.paint, C.livery);
    }
    parts.push(strip);
    // Bevel bands to both caps (bare tin, where the paint wears off the fold).
    for (const s of [-1, 1]) {
      const ia = inset[i],
        ib = inset[(i + 1) % n];
      const bn = new Vector3(s, en[i][1], en[i][0]).normalize();
      parts.push(
        swatch(
          quad([V(s * hx, a), V(s * hx, b), V(s * halfW, ib), V(s * halfW, ia)], bn, [
            [0, 0],
            [0, 0],
            [0, 0],
            [0, 0],
          ]),
          R.tin,
          C.tin,
        ),
      );
    }
  }
  // Caps: printed side livery.
  for (const s of [-1, 1]) {
    const cap = fan(
      inset.map((q) => V(s * halfW, q)),
      new Vector3(s, 0, 0),
    );
    regionMap(cap, R.side, (_x, y, z) => [
      s > 0 ? (zMax - z) / (zMax - zMin) : (z - zMin) / (zMax - zMin),
      (y - yMin) / (yMax - yMin),
    ]);
    parts.push(cap);
  }
  return parts;
}

// ---------------------------------------------------------------------------------------
// Tread geometry: one link (convex hexagonal section across the tread), and the loop path.
function linkVertexData(width: number, pitch: number, thick: number): VertexData {
  const a = pitch * 0.44;
  const prof: P2[] = [
    [-a, 0],
    [a, 0],
    [a, thick * 0.62],
    [a * 0.42, thick],
    [-a * 0.42, thick],
    [-a, thick * 0.62],
  ]; // (along, out)
  const hx = width / 2;
  const parts: VertexData[] = [];
  const n = prof.length;
  for (let i = 0; i < n; i++) {
    const p = prof[i],
      q = prof[(i + 1) % n];
    let nz = q[1] - p[1],
      ny = -(q[0] - p[0]);
    const l = Math.hypot(nz, ny);
    nz /= l;
    ny /= l;
    const mz = (p[0] + q[0]) / 2,
      my = (p[1] + q[1]) / 2 - thick / 2;
    if (nz * mz + ny * my < 0) {
      nz = -nz;
      ny = -ny;
    }
    const V = (x: number, r: P2): Vector3 => new Vector3(x, r[1], r[0]);
    const vd = quad([V(-hx, p), V(hx, p), V(hx, q), V(-hx, q)], new Vector3(0, ny, nz), [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]);
    // Inner face (towards the wheels) darker, the cleat face lighter (worn rubber).
    const shade = i === 0 ? 0.45 : i === 3 ? 1.15 : 0.9;
    vd.colors = new Float32Array(16).fill(shade);
    for (let k = 3; k < 16; k += 4) (vd.colors as Float32Array)[k] = 1;
    parts.push(vd);
  }
  for (const s of [-1, 1]) {
    const cap = fan(
      prof.map((r) => new Vector3(s * hx, r[1], r[0])),
      new Vector3(s, 0, 0),
    );
    cap.colors = new Float32Array(prof.length * 4).fill(0.8);
    parts.push(cap);
  }
  return mergeParts(parts);
}

interface TreadPath {
  length: number;
  // Writes the link frame at distance s: position (y, z) and outward normal (ny, nz).
  at(s: number, out: { y: number; z: number; ny: number; nz: number }): void;
}

function treadPath(zc: number, yc: number, r: number): TreadPath {
  const run = 2 * zc;
  const arc = Math.PI * r;
  const length = 2 * run + 2 * arc;
  return {
    length,
    at(s, o) {
      let t = ((s % length) + length) % length;
      if (t < run) {
        // bottom run, front-going
        o.z = -zc + t;
        o.y = yc - r;
        o.nz = 0;
        o.ny = -1;
        return;
      }
      t -= run;
      if (t < arc) {
        // front arc
        const ph = -Math.PI / 2 + t / r;
        o.nz = Math.cos(ph);
        o.ny = Math.sin(ph);
        o.z = zc + r * o.nz;
        o.y = yc + r * o.ny;
        return;
      }
      t -= arc;
      if (t < run) {
        // top run, rear-going
        o.z = zc - t;
        o.y = yc + r;
        o.nz = 0;
        o.ny = 1;
        return;
      }
      t -= run;
      const ph = Math.PI / 2 + t / r; // rear arc
      o.nz = Math.cos(ph);
      o.ny = Math.sin(ph);
      o.z = -zc + r * o.nz;
      o.y = yc + r * o.ny;
    },
  };
}

// ---------------------------------------------------------------------------------------
export function createTinGeneral(scene: Scene, look: Look, opts: TinGeneralOptions): TinGeneralModel {
  const w = Math.max(3, opts.width);
  const d = Math.max(3, opts.depth);
  const H = Math.max(1, opts.hullHeight);
  const hs = H / 1.4; // vertical scale of the running gear
  const halfW = w / 2;
  const treadW = Math.min(0.85, Math.max(0.6, w * 0.16));
  const xTread = halfW - treadW / 2 - 0.03;
  const linkThick = 0.12 * hs;
  const rLoop = 0.32 * hs; // inner radius of the tread loop's arcs
  const yc = linkThick + rLoop;
  const zc = d / 2 - rLoop - linkThick;
  const y0 = yc + rLoop + linkThick + 0.02; // underside of the upper hull (just over the treads)
  const zb = -d / 2 + 0.1;
  const zf = d / 2 - 0.15;
  const turretR = Math.min(1.1, w * 0.22, d * 0.28);
  const zT = -0.3; // turret centre (a little behind the hull centre, clear of the HP bar)
  const hatchY = H + 0.72;

  const root = new TransformNode('tinGeneral', scene);
  const atlas = makeAtlas(scene);
  const mat = makeAtlasMaterial(scene, atlas);
  const rubber = rubberMaterial(scene, 'tread', { name: 'tinGeneralTread', roughness: 0.82 });

  // ---------------- Tank (static) ----------------
  const t: VertexData[] = [];
  // Upper hull: side profile (z, y), counter-clockwise, with small bevel faces.
  const e = 0.05;
  const prof: P2[] = [
    [zb + e, y0],
    [zf - e, y0],
    [zf, y0 + e],
    [zf, y0 + 0.12],
    [zf - 0.04, y0 + 0.16],
    [zf - 0.82, H - 0.02],
    [zf - 0.9, H],
    [zb + 0.4, H],
    [zb + 0.33, H - 0.03],
    [zb, H - 0.28],
    [zb, y0 + e],
  ];
  const faces: HullFace[] = ['under', 'edge', 'lip', 'edge', 'glacis', 'edge', 'deck', 'edge', 'rear', 'rear', 'edge'];
  for (const part of hullPrism(prof, faces, halfW, 0.045)) t.push(shadeY(part, y0 - 0.05, y0 + 0.35, 0.72));

  // Lower hull between the treads (dark livery red), shaded toward the floor.
  const lowerW = w - 2 * treadW - 0.12;
  t.push(
    shadeY(
      swatch(
        place(roundedBox(lowerW, y0 - 0.12, 2 * zc + 0.2, 0.06, 2), { y: 0.12 + (y0 - 0.12) / 2 }),
        R.paint,
        C.liveryDark,
      ),
      0.1,
      y0,
      0.5,
    ),
  );
  // Lithographed radiator panel filling the lower front between the treads (it read as a
  // flat dark slot): cream-framed navy panel with pressed tin slats and a gold star badge.
  {
    const ph = (y0 - 0.12) * 0.86;
    const pw = lowerW * 0.94;
    const pz = zc + 0.1;
    const py = 0.12 + (y0 - 0.12) / 2;
    t.push(swatch(place(roundedBox(pw, ph, 0.05, 0.02, 1), { y: py, z: pz + 0.01 }), R.paint, C.cream));
    t.push(swatch(place(roundedBox(pw - 0.1, ph - 0.08, 0.05, 0.015, 1), { y: py, z: pz + 0.03 }), R.paint, C.navy));
    const nSlat = Math.max(7, Math.round(pw / 0.16));
    for (let k = 0; k < nSlat; k++) {
      const sx = -pw / 2 + 0.11 + (k * (pw - 0.22)) / (nSlat - 1);
      t.push(swatch(place(roundedBox(0.045, ph - 0.16, 0.05, 0.015, 1), { x: sx, y: py, z: pz + 0.05 }), R.tin, C.tin));
    }
  }
  // Front towing plate with rivets on the lower hull.
  t.push(
    swatch(place(roundedBox(lowerW * 0.7, 0.26 * hs, 0.08, 0.03, 1), { y: y0 * 0.55, z: zc + 0.16 }), R.tin, C.tin),
  );

  // Brass tow hooks on the lower front plate.
  for (const s of [-1, 1]) {
    t.push(
      swatch(
        place(
          latheArc(
            [
              [0, 0],
              [0.07, 0],
              [0.075, 0.03],
              [0.05, 0.05],
              [0.05, 0.16],
              [0.08, 0.18],
              [0.08, 0.22],
              [0, 0.23],
            ],
            10,
          ),
          { rx: Math.PI / 2, x: s * lowerW * 0.36, y: y0 * 0.55, z: zc + 0.16 },
        ),
        R.brass,
        C.brass,
      ),
    );
  }

  // Rivets on the front lip (geometry: they catch the sun).
  const rivet: P2[] = [
    [0, 0],
    [0.04, 0],
    [0.036, 0.018],
    [0.02, 0.032],
    [0, 0.036],
  ];
  const nRiv = Math.max(6, Math.round(w / 0.42));
  for (let i = 0; i < nRiv; i++) {
    const x = -halfW + 0.2 + (i * (w - 0.4)) / (nRiv - 1);
    t.push(swatch(place(latheArc(rivet, 8), { rx: Math.PI / 2, x, y: y0 + 0.065, z: zf }), R.tin, C.tin));
  }

  // Headlights on the front corners of the fenders: brass bucket, cream lens.
  for (const s of [-1, 1]) {
    const hx = s * (halfW - treadW / 2 - 0.05);
    const hz = zf - 0.32;
    const hy = y0 + 0.36;
    t.push(swatch(place(roundedBox(0.12, 0.2, 0.12, 0.03, 1), { x: hx, y: hy - 0.14, z: hz - 0.06 }), R.tin, C.tin));
    t.push(
      swatch(
        place(
          latheArc(
            [
              [0.06, -0.08],
              [0.1, -0.06],
              [0.15, 0.06],
              [0.155, 0.12],
              [0.14, 0.13],
            ],
            14,
          ),
          { rx: Math.PI / 2, x: hx, y: hy, z: hz },
        ),
        R.brass,
        C.brass,
      ),
    );
    t.push(
      swatch(
        place(
          latheArc(
            [
              [0.14, 0.12],
              [0.1, 0.15],
              [0, 0.16],
            ],
            14,
          ),
          { rx: Math.PI / 2, x: hx, y: hy, z: hz },
        ),
        R.skin,
        C.lens,
      ),
    );
  }

  // Exhaust pipes at the rear.
  for (const s of [-1, 1]) {
    t.push(
      swatch(
        place(
          latheArc(
            [
              [0, 0],
              [0.09, 0],
              [0.1, 0.03],
              [0.1, 0.3],
              [0.07, 0.31],
              [0.05, 0.25],
              [0, 0.25],
            ],
            10,
          ),
          { rx: -Math.PI / 2, x: s * (halfW - 0.45), y: y0 + 0.1, z: zb },
        ),
        R.tin,
        HEX.tinDark,
      ),
    );
  }

  // Road wheels, idler and sprocket (pressed tin with a red hub) inside each tread loop.
  const hw = treadW * 0.33;
  const wheel = (r: number): VertexData[] => {
    const rim: P2[] = [
      [r * 0.75, -hw],
      [r, -hw + 0.03],
      [r, hw - 0.03],
      [r * 0.93, hw],
      [r * 0.66, hw + 0.01],
      [r * 0.6, hw + 0.03],
    ];
    const hub: P2[] = [
      [r * 0.6, hw + 0.03],
      [r * 0.42, hw + 0.05],
      [r * 0.3, hw + 0.08],
      [0, hw + 0.09],
    ];
    return [swatch(latheArc(rim, 12), R.tin, C.tin), swatch(latheArc(hub, 12), R.paint, C.coat)];
  };
  const rRoad = 0.27 * hs;
  const nRoad = Math.max(2, Math.floor((2 * zc - 2 * rLoop + 0.1) / (2 * rRoad + 0.06)));
  const wheelSpots: [number, number, number][] = [
    [zc, yc, rLoop - 0.03],
    [-zc, yc, rLoop - 0.03],
  ];
  for (let i = 0; i < nRoad; i++) {
    const span = 2 * zc - 2 * rLoop - 2 * rRoad + 0.1;
    const z = -span / 2 + (nRoad === 1 ? span / 2 : (i * span) / (nRoad - 1));
    wheelSpots.push([z, linkThick + rRoad + 0.005, rRoad]);
  }
  for (const s of [-1, 1]) {
    for (const [z, y, r] of wheelSpots) {
      for (const part of wheel(r))
        t.push(shadeY(place(part, { rz: (-s * Math.PI) / 2, x: s * xTread, y, z }), 0, y0, 0.7));
    }
  }

  // Turret: base ring (tin), printed band, bevel (tin), cream top, hatch ring, dark hole.
  const tr = turretR;
  const tz = (vd: VertexData): VertexData => place(vd, { y: H, z: zT });
  const tess = 36;
  t.push(
    tz(
      swatch(
        latheArc(
          [
            [tr + 0.07, -0.02],
            [tr + 0.07, 0.04],
            [tr + 0.03, 0.08],
          ],
          tess,
        ),
        R.tin,
        C.tin,
      ),
    ),
  );
  {
    const band = latheArc(
      [
        [tr + 0.03, 0.08],
        [tr + 0.01, 0.2],
        [tr - 0.03, 0.5],
      ],
      tess,
    );
    const uvs = band.uvs as number[];
    const p = band.positions!;
    const out: number[] = [];
    for (let i = 0; i < p.length / 3; i++) {
      const u = uvs[i * 2]; // 0..1 around from +X; front (+Z) at 0.25
      const v = (p[i * 3 + 1] - 0.08) / 0.42;
      out.push(...ruv(R.turret, u, v));
    }
    band.uvs = out;
    band.colors = new Float32Array((p.length / 3) * 4).fill(1);
    t.push(tz(shadeY(band, 0.0, 0.3, 0.75)));
  }
  t.push(
    tz(
      swatch(
        latheArc(
          [
            [tr - 0.03, 0.5],
            [tr - 0.07, 0.56],
            [tr - 0.16, 0.6],
          ],
          tess,
        ),
        R.tin,
        C.tin,
      ),
    ),
  );
  t.push(
    tz(
      shadeY(
        swatch(
          latheArc(
            [
              [tr - 0.16, 0.6],
              [0.66, 0.635],
            ],
            tess,
          ),
          R.paint,
          C.cream,
        ),
        0.6,
        0.63,
        0.9,
      ),
    ),
  );
  t.push(
    tz(
      swatch(
        latheArc(
          [
            [0.66, 0.635],
            [0.64, 0.7],
            [0.58, 0.725],
            [0.53, 0.7],
            [0.5, 0.64],
          ],
          24,
        ),
        R.tin,
        C.tin,
      ),
    ),
  );
  t.push(
    tz(
      swatch(
        latheArc(
          [
            [0.5, 0.64],
            [0.48, 0.2],
            [0, 0.2],
          ],
          20,
        ),
        R.paint,
        '#1a1416',
      ),
    ),
  );
  // Open hatch lid, hinged at the back of the ring.
  t.push(
    swatch(
      place(
        latheArc(
          [
            [0, 0],
            [0.5, 0],
            [0.54, 0.025],
            [0.5, 0.06],
            [0.24, 0.075],
            [0.1, 0.11],
            [0, 0.115],
          ],
          20,
        ),
        { rx: -Math.PI / 2 - 0.28, y: hatchY + 0.42, z: zT - 0.7 },
      ),
      R.tin,
      C.tin,
    ),
  );
  // Turret rivets around the band top.
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    t.push(
      swatch(
        place(latheArc(rivet, 6), {
          rz: -Math.PI / 2,
          ry: -a,
          x: Math.cos(a) * (tr - 0.03),
          y: H + 0.47,
          z: zT + Math.sin(a) * (tr - 0.03),
        }),
        R.tin,
        C.tin,
      ),
    );
  }

  // Cannon: painted mantlet, stubby tin barrel, brass muzzle band, dark bore.
  const cy = H + 0.3;
  const cz0 = zT + tr - 0.08;
  t.push(swatch(place(roundedBox(0.8, 0.46, 0.34, 0.1, 2), { y: cy, z: cz0 + 0.1 }), R.paint, C.livery));
  const barrel = (prof2: P2[], sw: Rect, col: string, tessB = 16): VertexData =>
    swatch(place(latheArc(prof2, tessB), { rx: Math.PI / 2, y: cy, z: cz0 + 0.25 }), sw, col);
  t.push(
    barrel(
      [
        [0.22, 0],
        [0.22, 0.08],
        [0.17, 0.14],
        [0.155, 0.78],
      ],
      R.tin,
      C.tin,
    ),
  );
  t.push(
    barrel(
      [
        [0.155, 0.78],
        [0.2, 0.8],
        [0.215, 0.84],
        [0.215, 0.98],
        [0.2, 1.01],
        [0.12, 1.01],
      ],
      R.brass,
      C.brass,
    ),
  );
  t.push(
    barrel(
      [
        [0.12, 1.01],
        [0.11, 0.9],
        [0, 0.9],
      ],
      R.paint,
      '#120d0e',
      12,
    ),
  );

  // Antenna with a little pennant at the turret's rear left.
  {
    const ax = -tr * 0.62,
      az = zT - tr * 0.55;
    t.push(
      swatch(
        place(
          latheArc(
            [
              [0.06, 0],
              [0.06, 0.06],
              [0.02, 0.08],
              [0.018, 1.5],
              [0, 1.52],
            ],
            6,
          ),
          { x: ax, y: H + 0.55, z: az },
        ),
        R.tin,
        C.tin,
      ),
    );
    const top = H + 0.55 + 1.45;
    for (const sd of [-1, 1]) {
      const pen = new VertexData();
      pen.positions = [ax, top, az, ax, top - 0.3, az, ax + 0.0, top - 0.15, az - 0.5];
      pen.normals = [sd, 0, 0, sd, 0, 0, sd, 0, 0];
      pen.indices = [0, 1, 2];
      pen.uvs = [0, 0, 0, 0, 0, 0];
      fixWinding(pen);
      t.push(swatch(pen, R.paint, C.plume));
    }
  }

  const tank = buildMesh(scene, 'tinGeneralTank', t, mat);
  tank.parent = root;

  // ---------------- Treads (thin-instanced links) ----------------
  const pitch = 0.16 * hs;
  const path = treadPath(zc, yc, rLoop);
  const nLinks = Math.max(20, Math.round(path.length / pitch));
  const links = buildMesh(scene, 'tinGeneralTreads', linkVertexData(treadW, path.length / nLinks, linkThick), rubber);
  links.parent = root;
  const linkMatrices = new Float32Array(nLinks * 2 * 16);
  const frame = { y: 0, z: 0, ny: 0, nz: 0 };
  const writeLinks = (phase: number): void => {
    let o = 0;
    const m = linkMatrices;
    for (let side = 0; side < 2; side++) {
      const x = (side === 0 ? -1 : 1) * xTread;
      for (let i = 0; i < nLinks; i++) {
        path.at((i * path.length) / nLinks + phase, frame);
        // Rows: local X = (1,0,0); local Y = outward normal; local Z = X cross Y.
        // Written in place (no array literal): this runs every frame while the tank moves.
        m[o] = 1;
        m[o + 1] = 0;
        m[o + 2] = 0;
        m[o + 3] = 0;
        m[o + 4] = 0;
        m[o + 5] = frame.ny;
        m[o + 6] = frame.nz;
        m[o + 7] = 0;
        m[o + 8] = 0;
        m[o + 9] = -frame.nz;
        m[o + 10] = frame.ny;
        m[o + 11] = 0;
        m[o + 12] = x;
        m[o + 13] = frame.y;
        m[o + 14] = frame.z;
        m[o + 15] = 1;
        o += 16;
      }
    }
  };
  writeLinks(0);
  links.thinInstanceSetBuffer('matrix', linkMatrices, 16, false);
  links.thinInstanceRefreshBoundingInfo(false);

  // ---------------- The General ----------------
  const g: VertexData[] = [];
  const ZS = 0.82; // torso depth squash
  const coatProf: P2[] = [
    [0, -0.5],
    [0.42, -0.5],
    [0.44, -0.32],
    [0.385, -0.06],
    [0.35, 0.12],
    [0.37, 0.32],
    [0.405, 0.5],
    [0.395, 0.62],
    [0.33, 0.72],
    [0.2, 0.8],
    [0.12, 0.82],
    [0, 0.83],
  ];
  const radiusAt = (y: number): number => {
    for (let i = 1; i < coatProf.length; i++) {
      const [r1, y1] = coatProf[i];
      const [r0, yy0] = coatProf[i - 1];
      if (y <= y1) return r0 + ((r1 - r0) * (y - yy0)) / (y1 - yy0 || 1);
    }
    return 0;
  };
  g.push(swatch(place(latheArc(coatProf, 22), { sz: ZS }), R.paint, C.coat));
  // Coat front piping (navy) and gold buttons.
  // Waist belt (white) with a brass buckle.
  g.push(
    swatch(
      place(
        latheArc(
          [
            [0.352, 0.03],
            [0.368, 0.05],
            [0.368, 0.16],
            [0.352, 0.18],
          ],
          22,
        ),
        { sz: ZS },
      ),
      R.paint,
      C.white,
    ),
  );
  g.push(swatch(place(roundedBox(0.15, 0.12, 0.04, 0.015, 1), { y: 0.105, z: 0.368 * ZS + 0.01 }), R.brass, C.brass));
  // Cross belts: white straps hugging the coat, front and back.
  const strap = (x0: number, y0s: number, x1: number, y1s: number, back: boolean): VertexData => {
    const N = 10;
    const wd = 0.042;
    const pos: number[] = [],
      nrm: number[] = [],
      idx: number[] = [];
    const dx = x1 - x0,
      dy = y1s - y0s;
    const L = Math.hypot(dx, dy);
    const px = -dy / L,
      py = dx / L; // in-plane perpendicular
    for (let i = 0; i <= N; i++) {
      const tt = i / N;
      for (const side of [-1, 1]) {
        const x = x0 + dx * tt + px * wd * side;
        const y = y0s + dy * tt + py * wd * side;
        const r = radiusAt(y);
        const zz = Math.sqrt(Math.max(0.0004, r * r - x * x)) * ZS + 0.014;
        const z = back ? -zz : zz;
        const n = new Vector3(x, 0, z / (ZS * ZS)).normalize();
        pos.push(x, y, z);
        nrm.push(n.x, n.y, n.z);
      }
      if (i < N) {
        const a = i * 2;
        idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
      }
    }
    const vd = new VertexData();
    vd.positions = pos;
    vd.normals = nrm;
    vd.indices = idx;
    vd.uvs = Array.from({ length: (pos.length / 3) * 2 }, () => 0);
    return swatch(fixWinding(vd), R.paint, C.white);
  };
  for (const back of [false, true]) {
    g.push(strap(-0.32, 0.7, 0.3, 0.17, back));
    g.push(strap(0.32, 0.7, -0.3, 0.17, back));
  }
  // Brass plate where the belts cross, and coat buttons below it.
  const crossY = 0.7 - (0.32 / 0.62) * 0.53;
  const zAt = (y: number): number => radiusAt(y) * ZS;
  g.push(
    swatch(
      place(
        latheArc(
          [
            [0, 0],
            [0.07, 0],
            [0.065, 0.02],
            [0.04, 0.035],
            [0, 0.04],
          ],
          12,
        ),
        { rx: Math.PI / 2, y: crossY, z: zAt(crossY) + 0.01 },
      ),
      R.brass,
      C.brass,
    ),
  );
  for (const by of [-0.05, -0.2, -0.35]) {
    g.push(
      swatch(
        place(
          latheArc(
            [
              [0, 0],
              [0.032, 0],
              [0.028, 0.015],
              [0, 0.024],
            ],
            8,
          ),
          { rx: Math.PI / 2, y: by, z: zAt(by) - 0.004 },
        ),
        R.brass,
        C.brass,
      ),
    );
  }
  // Collar (navy with a gold edge) and neck.
  g.push(
    swatch(
      latheArc(
        [
          [0.12, 0.76],
          [0.215, 0.79],
          [0.22, 0.88],
          [0.2, 0.9],
          [0.16, 0.9],
        ],
        18,
      ),
      R.paint,
      C.navy,
    ),
  );
  g.push(
    swatch(
      latheArc(
        [
          [0.22, 0.88],
          [0.226, 0.9],
          [0.2, 0.915],
          [0.16, 0.912],
        ],
        18,
      ),
      R.brass,
      C.brass,
    ),
  );
  g.push(
    swatch(
      latheArc(
        [
          [0.13, 0.86],
          [0.13, 0.98],
        ],
        12,
      ),
      R.skin,
      C.skin,
    ),
  );
  // Epaulettes: brass dishes with a fringe, tilted outward.
  for (const s of [-1, 1]) {
    g.push(
      swatch(
        place(
          latheArc(
            [
              [0, 0.05],
              [0.12, 0.045],
              [0.17, 0.01],
              [0.185, -0.06],
              [0.175, -0.08],
              [0.15, -0.02],
              [0, -0.01],
            ],
            16,
          ),
          { rz: -s * 0.45, x: s * 0.34, y: 0.7, sz: 0.9 },
        ),
        R.brass,
        C.brass,
      ),
    );
  }
  // Arms: left hand on the hip, right arm raised with the sabre.
  const sh = (s: number): Vector3 => new Vector3(s * 0.36, 0.6, 0);
  const lElbow = new Vector3(-0.62, 0.3, -0.02);
  const lHand = new Vector3(-0.38, 0.12, 0.12);
  const rElbow = new Vector3(0.66, 0.86, 0.06);
  const rHand = new Vector3(0.72, 1.24, 0.1);
  g.push(swatch(limb(sh(-1), lElbow, 0.12, 0.105), R.paint, C.coat));
  g.push(swatch(limb(lElbow, lHand, 0.105, 0.09), R.paint, C.coat));
  g.push(swatch(limb(sh(1), rElbow, 0.12, 0.105), R.paint, C.coat));
  g.push(swatch(limb(rElbow, rHand, 0.105, 0.09), R.paint, C.coat));
  // Navy cuffs and white gloves.
  const cuff = (a: Vector3, b: Vector3): VertexData => {
    const dir = b.subtract(a).normalize();
    const c0 = b.subtract(dir.scale(0.14));
    return swatch(
      alongSegment(
        latheArc(
          [
            [0.1, 0],
            [0.108, 0.02],
            [0.108, 0.1],
            [0.095, 0.11],
          ],
          12,
        ),
        c0,
        b,
      ),
      R.paint,
      C.navy,
    );
  };
  g.push(cuff(lElbow, lHand));
  g.push(cuff(rElbow, rHand));
  g.push(swatch(place(latheArc(sphere(0.085), 10), { x: lHand.x, y: lHand.y, z: lHand.z, sx: 1.1 }), R.skin, C.white));
  g.push(swatch(place(latheArc(sphere(0.09), 10), { x: rHand.x, y: rHand.y + 0.02, z: rHand.z }), R.skin, C.white));
  // Sabre: brass guard and pommel, navy grip, bright tin blade raised high.
  const tip = new Vector3(0.95, 2.25, -0.08);
  const bladeBase = rHand.add(new Vector3(0.02, 0.12, -0.002));
  g.push(
    swatch(
      alongSegment(
        latheArc(
          [
            [0, 0],
            [0.062, 0.02],
            [0.055, 0.86],
            [0.016, 0.98],
            [0, 1.0],
          ].map(([r, y]) => [r, y * Vector3.Distance(bladeBase, tip)] as P2),
          4,
        ),
        bladeBase,
        tip,
        1,
        0.28,
        Math.PI / 4,
      ),
      R.tin,
      C.tin,
    ),
  );
  g.push(swatch(alongSegment(place(roundedBox(0.26, 0.04, 0.06, 0.015, 1), {}), bladeBase, tip), R.brass, C.brass));
  const gripA = rHand.subtract(new Vector3(0.02, 0.14, -0.002));
  g.push(
    swatch(
      alongSegment(
        latheArc(
          [
            [0.035, 0],
            [0.04, 0.1],
            [0.035, 0.2],
          ],
          8,
        ),
        gripA,
        bladeBase,
      ),
      R.paint,
      C.navy,
    ),
  );
  g.push(swatch(place(latheArc(sphere(0.045), 8), { x: gripA.x, y: gripA.y, z: gripA.z }), R.brass, C.brass));

  // Head: painted face on the front hemisphere (planar from the front), plain skin behind.
  const headR = 0.27,
    headY = 1.1,
    headZ = 0.02,
    headSy = 1.06;
  const headProf: P2[] = [];
  for (let i = 0; i <= 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 10;
    headProf.push([Math.cos(a) * headR, Math.sin(a) * headR]);
  }
  headProf[0] = [0, -headR];
  headProf[10] = [0, headR];
  const face = place(latheArc(headProf, 12, 0, Math.PI), { sy: headSy, y: headY, z: headZ });
  regionMap(face, R.face, (x, y) => [0.5 - x / (2 * headR), 0.5 + (y - headY) / (2 * headR * headSy)]);
  g.push(face);
  g.push(
    swatch(place(latheArc(headProf, 12, Math.PI, Math.PI * 2), { sy: headSy, y: headY, z: headZ }), R.skin, C.skin),
  );
  // Nose and ears.
  g.push(
    swatch(place(latheArc(sphere(0.05), 8), { y: headY - 0.01, z: headZ + headR - 0.01, sz: 0.8 }), R.skin, '#eab08f'),
  );
  for (const s of [-1, 1])
    g.push(
      swatch(
        place(latheArc(sphere(0.055), 8), { x: s * (headR - 0.01), y: headY, z: headZ - 0.02, sx: 0.5 }),
        R.skin,
        '#eab08f',
      ),
    );
  // Shako: tall navy, gold bands, black visor, brass badge, red plume.
  const shako = (vd: VertexData): VertexData => place(vd, { sz: 0.94, z: headZ - 0.02 });
  g.push(
    shako(
      swatch(
        latheArc(
          [
            [0.262, 1.2],
            [0.272, 1.215],
            [0.305, 1.73],
            [0.31, 1.75],
            [0.29, 1.77],
            [0, 1.78],
          ],
          22,
        ),
        R.paint,
        C.navy,
      ),
    ),
  );
  g.push(
    shako(
      swatch(
        latheArc(
          [
            [0.27, 1.2],
            [0.284, 1.215],
            [0.292, 1.31],
            [0.282, 1.325],
          ],
          22,
        ),
        R.brass,
        C.brass,
      ),
    ),
  );
  g.push(
    shako(
      swatch(
        latheArc(
          [
            [0.302, 1.67],
            [0.314, 1.68],
            [0.318, 1.745],
            [0.306, 1.755],
          ],
          22,
        ),
        R.brass,
        C.brass,
      ),
    ),
  );
  g.push(
    swatch(
      place(
        latheArc(
          [
            [0, 0],
            [0.3, 0],
            [0.31, 0.015],
            [0.28, 0.03],
            [0, 0.03],
          ],
          16,
          0,
          Math.PI,
        ),
        { rx: 0.22, y: 1.205, z: headZ + 0.03, sz: 1.25 },
      ),
      R.paint,
      '#141218',
    ),
  );
  g.push(
    swatch(
      place(
        latheArc(
          [
            [0, 0],
            [0.11, 0],
            [0.12, 0.02],
            [0.09, 0.04],
            [0, 0.045],
          ],
          14,
        ),
        { rx: Math.PI / 2 - 0.05, y: 1.48, z: headZ + 0.27 },
      ),
      R.brass,
      C.brass,
    ),
  );
  g.push(swatch(place(latheArc(sphere(0.06), 8), { y: 1.8, z: headZ + 0.13 }), R.brass, C.brass));
  g.push(
    swatch(
      place(
        latheArc(
          [
            [0, 0],
            [0.065, 0.04],
            [0.095, 0.14],
            [0.085, 0.26],
            [0.05, 0.37],
            [0, 0.42],
          ],
          12,
        ),
        { rx: -0.12, y: 1.82, z: headZ + 0.12 },
      ),
      R.paint,
      C.plume,
    ),
  );

  const gvd = place(mergeParts(g), { s: GENERAL_SCALE });
  // Cheap occlusion instead of a ray-traced bake (which costs ~1.5 s at load): darker where
  // the coat sinks into the hatch; the shadow map adds the self-shadowing.
  shadeY(gvd, -0.1 * GENERAL_SCALE, 0.35 * GENERAL_SCALE, 0.5);
  const general = buildMesh(scene, 'tinGeneralFigure', gvd, mat);
  general.parent = root;
  const generalRestY = hatchY - 0.06;
  general.position.set(0, generalRestY, zT);

  // ---------------- Wind-up key (turns about its local Z) ----------------
  const k: VertexData[] = [];
  k.push(
    swatch(
      place(
        latheArc(
          [
            [0.2, 0],
            [0.2, 0.05],
            [0.13, 0.09],
            [0.09, 0.1],
            [0.09, 0.5],
            [0.15, 0.53],
            [0.15, 0.6],
            [0.1, 0.63],
            [0.1, 0.7],
          ],
          14,
        ),
        { rx: -Math.PI / 2 },
      ),
      R.brass,
      C.brass,
    ),
  );
  k.push(swatch(place(latheArc(sphere(0.16), 12), { z: -0.78, sz: 0.8 }), R.brass, C.brass));
  for (const s of [-1, 1]) {
    // Solid butterfly wings with a raised rim.
    k.push(
      swatch(
        place(
          latheArc(
            [
              [0, 0.035],
              [0.27, 0.03],
              [0.33, 0.015],
              [0.345, 0],
              [0.33, -0.015],
              [0.27, -0.03],
              [0, -0.035],
            ],
            22,
          ),
          { rx: Math.PI / 2, x: s * 0.46, z: -0.78, sy: 0.82 },
        ),
        R.brass,
        C.brass,
      ),
    );
    k.push(
      swatch(
        place(
          latheArc(
            [
              [0.1, 0.03],
              [0.14, 0.05],
              [0.18, 0.03],
            ],
            22,
          ),
          { rx: Math.PI / 2, x: s * 0.46, z: -0.78 + 0.0, sy: 0.82 },
        ),
        R.brass,
        C.brass,
      ),
    );
    k.push(swatch(place(roundedBox(0.3, 0.16, 0.08, 0.03, 1), { x: s * 0.16, z: -0.78 }), R.brass, C.brass));
  }
  const key = buildMesh(scene, 'tinGeneralKey', place(mergeParts(k), { s: KEY_SCALE }), mat);
  key.parent = root;
  key.position.set(0, y0 + (H - 0.28 - y0) / 2 + 0.02, zb);

  // ---------------- Contact blob ----------------
  const blob = createBlobShadowMesh(scene, 'tinGeneralBlob', 0.5);
  blob.parent = root;
  blob.scaling.set(w + 0.9, 1, d + 0.9);

  for (const m of [tank, general, key, links] as Mesh[]) look.addShadowCaster(m, 'static');
  look.receiveShadows(tank);
  look.receiveShadows(general);
  look.receiveShadows(links);

  const flashCol = new Color3(1, 0.86, 0.62);
  return {
    root,
    general,
    key,
    generalRestY,
    hpBarAnchor: new Vector3(0, H + 0.6, zf - 0.45),
    setFlash(kf: number) {
      const f = Math.max(0, Math.min(1, kf));
      mat.emissiveColor.copyFrom(flashCol).scaleInPlace(f * 1.1);
      rubber.emissiveColor.copyFrom(flashCol).scaleInPlace(f * 0.35);
    },
    setPop(s: number) {
      general.scaling.setAll(s);
    },
    setTreadPhase(phase: number) {
      writeLinks(phase);
      links.thinInstanceBufferUpdated('matrix');
    },
    dispose() {
      root.dispose(false, false);
      mat.dispose();
      rubber.dispose();
      atlas.albedo.dispose();
      atlas.orm.dispose();
      atlas.normal.dispose();
    },
  };
}

// ---------------------------------------------------------------------------------------
export function preview(scene: Scene, look: Look, _opts: PreviewOptions): PreviewResult {
  const model = createTinGeneral(scene, look, { width: 5, depth: 4, hullHeight: 1.4 });
  let keyAngle = 0;
  return {
    root: model.root,
    update(time, dt) {
      keyAngle += 2.2 * dt;
      model.key.rotation.z = keyAngle;
      model.general.position.y = model.generalRestY + Math.abs(Math.sin(time * 3)) * 0.06;
      model.general.rotation.y = Math.sin(time * 1.3) * 0.15;
      model.setTreadPhase(time * 0.6);
      // Every 3 s: a phase-style flash with a scale pop.
      const ph = time % 3;
      if (ph > 2.6) {
        const u = (ph - 2.6) / 0.4;
        model.setFlash(1 - u);
        model.setPop(1 + 0.35 * Math.sin(Math.PI * u) * (1 - u * 0.5));
      } else {
        model.setFlash(0);
        model.setPop(1);
      }
    },
    dispose() {
      model.dispose();
    },
  };
}
