// Gates: toy plastic arches the crowd walks through. Good gates (multiply / add) are
// glossy green, trap gates (subtract / divide) are red with yellow-black hazard-striped
// posts and a hazard-striped sign with skull stickers, so the two differ in shape as well
// as colour. Between the posts hangs a tinted see-through film with a brighter rim; a
// cream sign card with a thick ink outline sits on brass hinges on the top beam, held up
// by two thin kickstand struts, and is tilted back toward the camera so the number reads
// from the far end of the lane.
//
// Draw calls per gate: 4 (frame, film, card, struts) plus shadow passes for frame, card
// and struts. Shared materials (look.material): 'gate-frame' (vertex-coloured clearcoat
// plastic, frame + struts of all gates), 'gate-film-good' / 'gate-film-trap'. Per gate:
// one card material + a 512 px DynamicTexture (disposed by dispose()).
//
// LAYOUT / SLOTS: a gate never draws outside its slot, `maxSpan` lane units wide and
// centred on the gate (posts, feet, beam and sign card all fit inside). Gates that stand
// side by side at the same z (level 1-03: x -3 / 0 / 3, widths 3 / 2.6 / 3) must get
// slots from gateSlots(), which splits the space between neighbours and also returns a
// `layer` that nudges each card a few mm in depth so cards can never z-fight. Without
// `maxSpan` the slot defaults to width + 0.15 (safe for abutting gates but a smaller card).
//
// GAME API (integration):
//   const slots = gateSlots(level.gates);             // once per level, same order as gates
//   const g = createGate(scene, look, { width: def.width, good, label: gateLabel(def), usesLeft,
//                                       maxSpan: slots[i].maxSpan, layer: slots[i].layer });
//   g.root.parent = levelRoot; g.root.position.set(gateX(def, 0), 0, def.z);
//   g.root.rotation.y = Math.PI;          // side 'neutral': sign faces the camera
//   g.setLabelTilt(rig.pitch);            // camera pitch (radians below horizontal)
//   moving gates: g.root.position.x = gateX(def, time)
//   g.setLabel(gateLabel(def), usesLeft); // redraws only when text or count changed
//   g.pulse(k, strong);                   // k: 1 -> 0 over the crossing pulse; strong = added > 0
//   g.setBreak(o.scale, o.alpha);         // from fxLogic.gateBreakAt; hides itself at alpha 0
//   g.dispose();
// Pivot: ground centre (y = 0); the arch spans x in [-width/2, width/2] (posts pull in a
// little only when the slot is tighter than the posts' outer edges). Front (sign face) is
// +Z. Shadows are registered here (frame, card and struts cast; frame receives). The film
// never casts and never writes depth, so units show through it.
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Look } from '../look/index.ts';
import {
  HEX,
  buildMesh,
  fixWinding,
  lathe,
  lin,
  mergeParts,
  paint,
  place,
  plasticMaterial,
  roundedBox,
} from '../look/index.ts';
import type { ModelInfo, PreviewOptions, PreviewResult } from '../look/model.ts';
import { computeFraming } from '../framing.ts';

export const info: ModelInfo = {
  key: 'gate',
  title: 'Gates: good (x / +) and trap (- / ÷)',
  instanced: false,
  teams: false,
  side: 'neutral',
  height: 3.6,
  triangleBudget: 3000,
  gameZ: 30,
  variants: ['row', 'single', 'tight'],
};

export interface GateOptions {
  width: number; // lane units between post centres (2-6 typical)
  good: boolean; // mul / add = true, sub / div = false
  label: string; // gateLabel(def): 'x2', '+10', '-5', '÷2'
  usesLeft: number; // -1 = unlimited
  maxSpan?: number; // slot width the whole gate (card included) must fit in; see gateSlots()
  layer?: number; // 0..2 small card depth offset so neighbouring cards never z-fight
}

export interface GateModel {
  root: TransformNode;
  setLabel(label: string, usesLeft: number): void;
  setLabelTilt(pitch: number): void;
  pulse(k: number, strong: boolean): void;
  setBreak(scale: number, alpha: number): void;
  dispose(): void;
}

// ---------- dimensions ----------
export const GATE_DIMS = {
  postTop: 1.95, // top of the posts / beam (champions are 2.6 kneeling but walk under the film)
  post: 0.3,
  beamH: 0.3,
  beamD: 0.34,
  cardH: 2.05, // card height without a uses line
  cardHUses: 2.05, // one-use gates: the count is a separate badge token now (usesBadge)
  cardD: 0.12,
  textEm: 1.7, // target em height (world units) without a uses line
  textEmUses: 1.35, // with the 'N left' line
  textEmMin: 1.2, // floor: the card widens (inside its slot) before the em goes below this
};

const TEX_W = 512;
const STRIP = 16; // px band under the card face: solid ink (left) and cream (right) for edges and back
const FILM_REST = 0.6; // film mesh visibility at rest (vertex alpha x this ~= 0.33 inside)
// Card face layout in px of the 512 px wide texture.
const OUTLINE_W = 18; // thick ink outline
const BAND_IN = 14; // coloured / hazard band starts here
const BAND_W = 12;
const PANEL_IN = BAND_IN + BAND_W; // inner paper panel inset
const PAD_X = 0.06; // text padding inside the panel, per side, as a fraction of card width
const SLOT_GAP = 0.06; // clearance between neighbouring slots
const DEFAULT_EXTRA = 0.15; // default slot = width + this
// Easel arm behind the beam (struts start at its end).
const STRUT_ARM = { y: 1.95 - 0.12, len: 0.66 };

// ---------- slots (pure; integration calls once per level) ----------
export interface GateSlotInput {
  x: number;
  z: number;
  width: number;
  move?: { amplitude: number };
}

/** Per gate (same order): the slot width it may draw in and a card depth layer. Gates within
 *  1.5 units of z of each other share the space between them; moving gates reserve their
 *  swing. The lane edge (±laneWidth/2 plus a small overhang) also bounds the slot. */
export function gateSlots(gates: readonly GateSlotInput[], laneWidth = 10): { maxSpan: number; layer: number }[] {
  return gates.map((g, i) => {
    const ampI = Math.abs(g.move?.amplitude ?? 0);
    let half = laneWidth / 2 + 0.35 - Math.abs(g.x) - ampI;
    let rank = 0;
    gates.forEach((o, j) => {
      if (j === i || Math.abs(o.z - g.z) > 1.5) return;
      const ampJ = Math.abs(o.move?.amplitude ?? 0);
      const d = Math.abs(o.x - g.x) - ampI - ampJ;
      const gap = d - g.width / 2 - o.width / 2; // free space between the two hit widths
      half = Math.min(half, g.width / 2 + gap / 2 - SLOT_GAP / 2);
      if (o.x < g.x || (o.x === g.x && j < i)) rank++;
    });
    return { maxSpan: Math.max(1.2, 2 * half), layer: rank % 3 };
  });
}

// ---------- label measurement ----------
const FONT =
  '"Arial Rounded MT Bold", ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", "Helvetica Neue", Arial, system-ui, sans-serif';

function prettyLabel(label: string): string {
  return label.replace(/^x/i, '×').replace(/^-/, '−');
}

interface LabelParts {
  op: string;
  shaped: boolean;
  digits: string;
}

function splitLabel(label: string): LabelParts {
  const text = prettyLabel(label);
  const op = text.charAt(0);
  const shaped = op === '×' || op === '+' || op === '−' || op === '÷';
  return { op, shaped, digits: shaped ? text.slice(1) : text };
}

// Glyph metrics as fractions of the em (outline and drop shadow included).
const SYM_W = 0.56;
const SYM_GAP = 0.1;
const OUTLINE = 0.16; // ink outline stroke width (half sits outside the glyph)
const SHADOW_DY = 0.06;

interface LabelMetrics {
  w: number; // total ink width / em
  asc: number; // ascent above the baseline / em (outline included)
  desc: number; // descent below the baseline / em (outline + drop shadow included)
  digitsW: number; // advance of the digits / em
}

function measureLabel(ctx: CanvasRenderingContext2D, label: string): LabelMetrics {
  const { shaped, digits } = splitLabel(label);
  ctx.font = `900 100px ${FONT}`;
  const m = ctx.measureText(digits || '0');
  const digitsW = (digits ? m.width : 0) / 100;
  const asc = (m.actualBoundingBoxAscent || 72) / 100;
  const desc = (m.actualBoundingBoxDescent || 1) / 100;
  const symW = shaped ? SYM_W + (digits ? SYM_GAP : 0) : 0;
  return {
    w: symW + digitsW + OUTLINE,
    asc: Math.max(asc, 0.62) + OUTLINE / 2,
    desc: desc + OUTLINE / 2 + SHADOW_DY,
    digitsW,
  };
}

let measureCtx: CanvasRenderingContext2D | null = null;
function measuringContext(): CanvasRenderingContext2D | null {
  if (measureCtx) return measureCtx;
  try {
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(8, 8) : document.createElement('canvas');
    measureCtx = (c.getContext('2d') as unknown as CanvasRenderingContext2D) ?? null;
  } catch {
    measureCtx = null;
  }
  return measureCtx;
}

/** Card width for a gate: comfortable default, widened so the label keeps >= textEmMin,
 *  never wider than the slot. */
function cardWidthFor(width: number, maxSpan: number, label: string): number {
  const base = Math.min(3.9, Math.max(3.1, width * 0.6 + 1.7));
  const ctx = measuringContext();
  const k = ctx ? measureLabel(ctx, label).w : 0.62 + 0.62 * Math.max(1, splitLabel(label).digits.length) + OUTLINE;
  const usable = 1 - (2 * PANEL_IN) / TEX_W - 2 * PAD_X;
  const need = (GATE_DIMS.textEmMin * k) / usable;
  return Math.max(1.2, Math.min(maxSpan - 0.04, Math.max(base, need)));
}

// Linear colours from the palette.
function cols(good: boolean) {
  return good
    ? { main: lin(HEX.gateGood), dark: lin(HEX.gateGoodDark), ink: HEX.gateGoodDark, bright: HEX.gateGood }
    : { main: lin(HEX.gateTrap), dark: lin(HEX.gateTrapDark), ink: HEX.gateTrapDark, bright: HEX.gateTrap };
}

// ---------- geometry ----------
function box(
  w: number,
  h: number,
  d: number,
  r: number,
  c: Color3,
  at: { x?: number; y?: number; z?: number },
  seg = 1,
): VertexData {
  return paint(place(roundedBox(w, h, d, r, seg), at), c);
}

function ball(radius: number, c: Color3, x: number, y: number, z = 0, tess = 16, rows = 6): VertexData {
  const prof: [number, number][] = [];
  for (let i = 0; i <= rows; i++) {
    const a = -Math.PI / 2 + (i / rows) * Math.PI;
    prof.push([Math.max(0, Math.cos(a) * radius), Math.sin(a) * radius]);
  }
  prof[0][0] = 0;
  prof[rows][0] = 0;
  return paint(place(lathe(prof, tess), { x, y, z }), c);
}

function ring(rOut: number, h: number, c: Color3, x: number, y: number, tess = 8): VertexData {
  const r0 = rOut * 0.8;
  const prof: [number, number][] = [
    [r0, 0],
    [rOut - h * 0.25, 0],
    [rOut, h * 0.3],
    [rOut, h * 0.7],
    [rOut - h * 0.25, h],
    [r0, h],
  ];
  return paint(place(lathe(prof, tess), { x, y }), c);
}

// Fake contact occlusion: darken near the floor and right under the beam.
function shadeAO(vd: VertexData, beamBottom: number): VertexData {
  const p = vd.positions!;
  const c = vd.colors as Float32Array;
  for (let i = 0, v = 0; i < p.length; i += 3, v += 4) {
    const y = p[i + 1];
    let k = 0.62 + 0.38 * Math.min(1, Math.max(0, y / 0.45));
    if (y < beamBottom && y > beamBottom - 0.25) k *= 0.85 + 0.15 * ((beamBottom - y) / 0.25);
    c[v] *= k;
    c[v + 1] *= k;
    c[v + 2] *= k;
  }
  return vd;
}

interface FrameLayout {
  postX: number; // post centre |x|
  foot: number; // foot size in x (z stays chunky)
  beamW: number;
  hingeX: number;
  strutX: number;
}

function frameLayout(width: number, maxSpan: number, cw: number): FrameLayout {
  const D = GATE_DIMS;
  const half = maxSpan / 2;
  const postX = Math.max(0.4, Math.min(width / 2, half - D.post / 2 - 0.03));
  const foot = Math.max(D.post + 0.06, Math.min(0.56, 2 * (half - postX) - 0.02));
  const beamW = Math.min(2 * postX + D.post + 0.06, maxSpan - 0.02);
  const hingeX = Math.max(0.15, Math.min(cw * 0.32, postX - 0.2));
  return { postX, foot, beamW, hingeX, strutX: hingeX * 0.7 };
}

function buildFrameData(L: FrameLayout, good: boolean): VertexData {
  const D = GATE_DIMS;
  const { main, dark } = cols(good);
  const ink = lin('#2a2420');
  const yellow = lin(HEX.toyYellow);
  const brass = lin(HEX.brass);
  const top = D.postTop;
  const beamY = top - D.beamH / 2;
  const parts: VertexData[] = [];
  for (const s of [-1, 1]) {
    const x = s * L.postX;
    // Foot: a chunky stepped base (deep in z, only as wide in x as the slot allows).
    parts.push(box(L.foot, 0.12, 0.56, 0.05, dark, { x, y: 0.06 }));
    parts.push(box(L.foot - 0.12, 0.1, 0.44, 0.04, dark, { x, y: 0.16 }));
    const shaftH = top - 0.2;
    if (good) {
      parts.push(box(D.post, shaftH, D.post, 0.08, main, { x, y: 0.2 + shaftH / 2 }, 2));
      parts.push(box(D.post + 0.06, 0.08, D.post + 0.06, 0.03, dark, { x, y: 0.36 }));
      parts.push(box(D.post + 0.06, 0.08, D.post + 0.06, 0.03, dark, { x, y: top - D.beamH - 0.1 }));
    } else {
      // Hazard post: black core with moulded-in yellow stripes, just proud of the surface.
      const core = D.post - 0.02;
      parts.push(box(core, shaftH, core, 0.07, ink, { x, y: 0.2 + shaftH / 2 }, 1));
      const bands = 4;
      const span = top - D.beamH - 0.28;
      const step = span / bands;
      for (let b = 0; b < bands; b++) {
        parts.push(box(core + 0.024, step * 0.5, core + 0.024, 0.05, yellow, { x, y: 0.28 + step * (b + 0.5) }));
      }
    }
    // Ball cap on a collar above the beam.
    parts.push(ring(0.17, 0.08, dark, x, top));
    parts.push(ball(0.19, main, x, top + 0.24, 0, 16, 6));
  }
  // Top beam with dark trim strip along the bottom edge.
  parts.push(box(L.beamW, D.beamH, D.beamD, 0.09, main, { y: beamY }, 2));
  parts.push(box(L.beamW - 0.08, 0.07, D.beamD + 0.04, 0.03, dark, { y: top - D.beamH + 0.02 }));
  // Screw heads on the beam front.
  for (const s of [-1, 1]) parts.push(ball(0.045, dark, s * L.postX, beamY, D.beamD / 2 + 0.005, 6, 3));
  // Brass hinges that the sign card sits on.
  for (const s of [-1, 1]) {
    parts.push(
      paint(
        place(
          lathe(
            [
              [0, -0.11],
              [0.05, -0.11],
              [0.055, -0.1],
              [0.055, 0.1],
              [0.05, 0.11],
              [0, 0.11],
            ],
            6,
          ),
          { x: s * L.hingeX, y: top + 0.05, rz: Math.PI / 2 },
        ),
        brass,
      ),
    );
  }
  // Easel arms: short rods running back from the beam; the kickstand struts rise from their ends.
  for (const s of [-1, 1]) {
    parts.push(
      paint(
        place(
          lathe(
            [
              [0, 0],
              [0.04, 0],
              [0.04, STRUT_ARM.len],
              [0, STRUT_ARM.len],
            ],
            6,
          ),
          { x: s * L.strutX, y: STRUT_ARM.y, z: -D.beamD / 2 + 0.03, rx: -Math.PI / 2 },
        ),
        dark,
      ),
    );
  }
  return shadeAO(mergeParts(parts), top - D.beamH);
}

// Two kickstand struts, unit length along +Y from the origin (scaled to length at runtime).
function buildStrutData(L: FrameLayout, good: boolean): VertexData {
  const { dark } = cols(good);
  const r = 0.032;
  const parts: VertexData[] = [];
  for (const s of [-1, 1]) {
    parts.push(
      paint(
        place(
          lathe(
            [
              [0, 0],
              [r, 0],
              [r, 1],
              [0, 1],
            ],
            6,
          ),
          { x: s * L.strutX },
        ),
        dark,
      ),
    );
  }
  return mergeParts(parts);
}

// Card slab: one rounded box whose front face samples the sign texture; sides take the
// ink patch, the back the cream patch (both in the strip under the face).
function buildCardData(cw: number, ch: number, texH: number): VertexData {
  const D = GATE_DIMS;
  const vd = roundedBox(cw, ch, D.cardD, 0.07, 2);
  const p = vd.positions!;
  const n = vd.normals!;
  const uv = new Float32Array((p.length / 3) * 2);
  const vFace0 = STRIP / texH; // face occupies v in [vFace0, 1]
  const vStrip = (STRIP * 0.5) / texH;
  for (let i = 0, j = 0; i < p.length; i += 3, j += 2) {
    const nz = n[i + 2];
    if (nz > 0.35) {
      uv[j] = 0.5 - p[i] / cw; // +X is screen-left when seen from +Z
      uv[j + 1] = vFace0 + (p[i + 1] / ch + 0.5) * (1 - vFace0);
    } else if (nz < -0.6) {
      uv[j] = 0.75;
      uv[j + 1] = vStrip;
    } else {
      uv[j] = 0.25;
      uv[j + 1] = vStrip;
    }
  }
  vd.uvs = uv;
  // Hinge line at the card's bottom edge.
  return place(vd, { y: ch / 2, z: 0 });
}

// Film: a 4x4 grid (outer rim + inset interior) so the rim can glow brighter.
function buildFilmData(w: number, h: number, good: boolean): VertexData {
  const base = good ? lin(HEX.gateGood) : lin(HEX.gateTrap);
  const rim = Color3.Lerp(base, Color3.White(), 0.55);
  const inset = 0.14;
  const xs = [-w / 2, -w / 2 + inset, w / 2 - inset, w / 2];
  const ys = [-h / 2, -h / 2 + inset * 0.7, h / 2 - inset, h / 2];
  const positions: number[] = [];
  const colors: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      positions.push(xs[i], ys[j], 0);
      normals.push(0, 0, 1);
      uvs.push(i / 3, j / 3);
      const edge = i === 0 || i === 3 || j === 0 || j === 3;
      // Interior slightly denser toward the top (a hanging film catches more light there).
      const c = edge ? rim : Color3.Lerp(base, rim, j >= 2 ? 0.15 : 0);
      colors.push(c.r, c.g, c.b, edge ? 0.95 : j >= 2 ? 0.6 : 0.52);
    }
  }
  const indices: number[] = [];
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) {
      const a = j * 4 + i;
      indices.push(a, a + 1, a + 5, a, a + 5, a + 4);
    }
  }
  const vd = new VertexData();
  vd.positions = positions;
  vd.normals = normals;
  vd.uvs = uvs;
  vd.colors = colors;
  vd.indices = indices;
  return vd;
}

// ---------- sign texture ----------
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  begin = true,
): void {
  if (begin) ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function skull(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = HEX.ink;
  ctx.beginPath();
  ctx.arc(0, -s * 0.12, s * 0.5, Math.PI * 0.85, Math.PI * 2.15);
  ctx.lineTo(s * 0.3, s * 0.42);
  ctx.lineTo(-s * 0.3, s * 0.42);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = HEX.paper;
  ctx.beginPath();
  ctx.arc(-s * 0.19, -s * 0.08, s * 0.14, 0, Math.PI * 2);
  ctx.arc(s * 0.19, -s * 0.08, s * 0.14, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, s * 0.08);
  ctx.lineTo(s * 0.07, s * 0.2);
  ctx.lineTo(-s * 0.07, s * 0.2);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(-s * 0.15, s * 0.3, s * 0.06, s * 0.12);
  ctx.fillRect(s * 0.09, s * 0.3, s * 0.06, s * 0.12);
  ctx.restore();
}

function drawCard(tex: DynamicTexture, cw: number, texH: number, good: boolean, label: string, usesLeft: number): void {
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const W = TEX_W;
  const H = texH - STRIP; // face height in px (face drawn at the top of the canvas)
  const pxU = W / cw; // pixels per world unit
  const { ink: inkCol, bright } = cols(good);
  ctx.clearRect(0, 0, W, texH);
  // Strip: ink patch (sides) and cream patch (back).
  ctx.fillStyle = HEX.ink;
  ctx.fillRect(0, H, W / 2, STRIP);
  ctx.fillStyle = HEX.paper;
  ctx.fillRect(W / 2, H, W / 2, STRIP);

  // Paper ground with a soft lighter centre and a little fibre.
  const g = ctx.createRadialGradient(W / 2, H * 0.42, 10, W / 2, H / 2, W * 0.6);
  g.addColorStop(0, '#fffaf0');
  g.addColorStop(1, '#efe2c4');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  let seed = 7;
  const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
  ctx.fillStyle = 'rgba(120,90,50,0.07)';
  for (let i = 0; i < 260; i++) ctx.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 3, 1);

  // Thick ink outline, then a coloured (good) or hazard-striped (trap) band inside it.
  const edge = 0.07 * pxU; // the slab's rounded edge (rendered in the outline)
  const r = 0.2 * pxU;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = HEX.ink;
  ctx.lineWidth = OUTLINE_W * 1.4;
  roundRect(ctx, edge * 0.2, edge * 0.2, W - edge * 0.4, H - edge * 0.4, r);
  ctx.stroke();
  ctx.save();
  roundRect(ctx, BAND_IN, BAND_IN, W - BAND_IN * 2, H - BAND_IN * 2, r * 0.8);
  ctx.clip();
  if (good) {
    ctx.fillStyle = bright;
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = HEX.toyYellow;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = HEX.ink;
    for (let x = -H; x < W + H; x += 30) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 15, 0);
      ctx.lineTo(x + 15 - H, H);
      ctx.lineTo(x - H, H);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
  // Inner paper panel.
  const pin = PANEL_IN;
  ctx.save();
  roundRect(ctx, pin, pin, W - pin * 2, H - pin * 2, r * 0.6);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = HEX.ink;
  ctx.stroke();
  ctx.restore();

  // The uses count is drawn on its own big token (usesBadge), not as a pill on the card.
  const hasUses: boolean = false;
  // Layout box for the number: inside the panel, minus padding, above the pill.
  const padX = PAD_X * W;
  const padY = 0.035 * H;
  const boxL = pin + padX;
  const boxR = W - pin - padX;
  const boxT = pin + padY;
  let boxB = H - pin - padY;
  // Uses pill: brass with ink text ('12 left'), sitting on the panel's bottom edge.
  let pill: { line: string; fh: number; ph: number; py: number } | null = null;
  if (hasUses) {
    const fh = 0.27 * pxU;
    const ph = fh * 1.18;
    const py = H - pin - ph - 0.025 * H;
    pill = { line: `${Math.max(0, Math.floor(usesLeft))} left`, fh, ph, py };
    boxB = py - 0.05 * H; // number (drop shadow included) ends a clear gap above the pill
  }

  // The number: measured, then scaled uniformly (never squeezed) to fit the box.
  const parts = splitLabel(label);
  const met = measureLabel(ctx, label);
  const target = (hasUses ? GATE_DIMS.textEmUses : GATE_DIMS.textEm) * pxU;
  const em = Math.max(8, Math.min(target, (boxR - boxL) / met.w, (boxB - boxT) / (met.asc + met.desc)));
  // Centre the ink box (ascent + descent incl. outline and shadow) in the layout box.
  const inkH = (met.asc + met.desc) * em;
  const baseline = boxT + (boxB - boxT - inkH) / 2 + met.asc * em;
  const tw = (met.w - OUTLINE) * em;
  const x0 = W / 2 - tw / 2;
  const symW = parts.shaped ? SYM_W * em : 0;
  const gap = parts.shaped && parts.digits ? SYM_GAP * em : 0;
  const symCx = x0 + symW / 2;
  const capH = Math.max(0.62, met.asc - OUTLINE / 2) * em;
  const symCy = baseline - capH / 2;
  const op = parts.op;
  const symPath = (): void => {
    ctx.beginPath();
    const bl = em * 0.5; // bar length
    const bt = em * 0.13; // bar thickness
    if (op === '+' || op === '×') {
      ctx.save();
      ctx.translate(symCx, symCy);
      if (op === '×') ctx.rotate(Math.PI / 4);
      roundRect(ctx, -bl / 2, -bt / 2, bl, bt, bt / 2, false);
      roundRect(ctx, -bt / 2, -bl / 2, bt, bl, bt / 2, false);
      ctx.restore();
    } else {
      roundRect(ctx, symCx - bl / 2, symCy - bt / 2, bl, bt, bt / 2, false);
      if (op === '÷') {
        const dr = em * 0.08;
        ctx.moveTo(symCx + dr, symCy - em * 0.245);
        ctx.arc(symCx, symCy - em * 0.245, dr, 0, Math.PI * 2);
        ctx.moveTo(symCx + dr, symCy + em * 0.245);
        ctx.arc(symCx, symCy + em * 0.245, dr, 0, Math.PI * 2);
      }
    }
  };
  ctx.font = `900 ${Math.round(em)}px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const dx = x0 + symW + gap;
  // One sticker layer: operator shapes + digits, filled and stroked with the given styles.
  const layer = (fill: string | CanvasGradient, stroke: string | CanvasGradient, lw: number, dy: number): void => {
    ctx.save();
    ctx.translate(0, dy);
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    if (parts.shaped) {
      symPath();
      if (lw > 0) ctx.stroke();
      ctx.fill();
    }
    if (parts.digits) {
      if (lw > 0) ctx.strokeText(parts.digits, dx, baseline);
      ctx.fillText(parts.digits, dx, baseline);
    }
    ctx.restore();
  };
  ctx.lineJoin = 'round';
  layer(HEX.ink, HEX.ink, em * OUTLINE, em * SHADOW_DY); // drop shadow
  layer(HEX.ink, HEX.ink, em * OUTLINE, 0); // outline
  const tg = ctx.createLinearGradient(0, baseline - capH, 0, baseline);
  tg.addColorStop(0, bright);
  tg.addColorStop(1, inkCol);
  // A thin same-colour stroke fattens the digits into a rounder, heavier sticker letter.
  layer(tg, tg, em * 0.04, 0);

  if (pill) {
    const { line, fh, ph, py } = pill;
    ctx.font = `900 ${Math.round(fh)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const maxLw = boxR - boxL - fh;
    const lw = Math.min(ctx.measureText(line).width, maxLw);
    roundRect(ctx, W / 2 - lw / 2 - fh * 0.45, py, lw + fh * 0.9, ph, ph / 2);
    ctx.fillStyle = HEX.brass;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = HEX.ink;
    ctx.stroke();
    ctx.fillStyle = HEX.ink;
    ctx.fillText(line, W / 2, py + ph / 2 + 2, maxLw);
  }
  if (!good) {
    // Skull stickers in the top corners of the paper panel (shape cue for traps), kept
    // small and tucked into the corners so they never touch the number's box.
    const s = Math.min(0.3 * pxU, 0.16 * H);
    skull(ctx, pin + s * 0.6, pin + s * 0.6, s);
    skull(ctx, W - pin - s * 0.6, pin + s * 0.6, s);
  }
  tex.update(true);
}

// ---------- uses badge ----------
// One-use gates carry their remaining count on a round brass-rimmed cream token at the
// card's top-right corner, numbers >= 0.6 units tall so they read at phone distance.
const BADGE_R = 0.6;
const BADGE_T = 0.08;
const BADGE_TEX = 128;

function badgeData(r: number, t: number): VertexData {
  const seg = 28;
  const pos: number[] = [],
    nrm: number[] = [],
    uv: number[] = [],
    idx: number[] = [];
  const rimUv = [0.5, 0.015]; // brass rim texels
  // Front face (+Z) and back face (-Z).
  for (const side of [1, -1]) {
    const c = pos.length / 3;
    const z = (side * t) / 2;
    pos.push(0, 0, z);
    nrm.push(0, 0, side);
    if (side > 0) uv.push(0.5, 0.5);
    else uv.push(rimUv[0], rimUv[1]);
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      const x = Math.cos(a) * r,
        y = Math.sin(a) * r;
      pos.push(x, y, z);
      nrm.push(0, 0, side);
      if (side > 0) uv.push(0.5 - x / (2 * r), 0.5 + y / (2 * r));
      else uv.push(rimUv[0], rimUv[1]);
    }
    for (let k = 0; k < seg; k++) {
      if (side > 0) idx.push(c, c + 1 + k, c + 2 + k);
      else idx.push(c, c + 2 + k, c + 1 + k);
    }
  }
  // Edge band.
  const e = pos.length / 3;
  for (let k = 0; k <= seg; k++) {
    const a = (k / seg) * Math.PI * 2;
    const x = Math.cos(a),
      y = Math.sin(a);
    for (const z of [t / 2, -t / 2]) {
      pos.push(x * r, y * r, z);
      nrm.push(x, y, 0);
      uv.push(rimUv[0], rimUv[1]);
    }
  }
  for (let k = 0; k < seg; k++) {
    const a = e + k * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const vd = new VertexData();
  vd.positions = pos;
  vd.normals = nrm;
  vd.uvs = uv;
  vd.indices = idx;
  fixWinding(vd);
  return vd;
}

function drawBadge(tex: DynamicTexture, n: number): void {
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const S = BADGE_TEX;
  const c = S / 2;
  ctx.clearRect(0, 0, S, S);
  // Brass rim (outer ring) with a highlight, ink outline, cream token face.
  const brass = ctx.createLinearGradient(0, 0, 0, S);
  brass.addColorStop(0, '#f6dc8a');
  brass.addColorStop(0.5, HEX.brass);
  brass.addColorStop(1, '#8a6420');
  ctx.fillStyle = brass;
  ctx.fillRect(0, 0, S, S);
  ctx.beginPath();
  ctx.arc(c, c, S * 0.445, 0, Math.PI * 2);
  ctx.fillStyle = HEX.ink;
  ctx.fill();
  const face = ctx.createRadialGradient(c * 0.85, c * 0.75, 4, c, c, S * 0.42);
  face.addColorStop(0, '#fffaf0');
  face.addColorStop(1, '#efe0bd');
  ctx.beginPath();
  ctx.arc(c, c, S * 0.415, 0, Math.PI * 2);
  ctx.fillStyle = face;
  ctx.fill();
  const text = String(Math.max(0, Math.floor(n)));
  let fs = S * 0.68;
  ctx.font = `900 ${Math.round(fs)}px ${FONT}`;
  const w = ctx.measureText(text).width;
  const maxW = S * 0.7;
  if (w > maxW) {
    fs *= maxW / w;
    ctx.font = `900 ${Math.round(fs)}px ${FONT}`;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = HEX.ink;
  ctx.fillText(text, c, c + fs * 0.06);
  tex.update(true);
}

// ---------- game API ----------
export function createGate(scene: Scene, look: Look, opts: GateOptions): GateModel {
  const D = GATE_DIMS;
  const width = Math.max(1, opts.width);
  const good = opts.good;
  const maxSpan = Math.max(1.2, opts.maxSpan ?? width + DEFAULT_EXTRA);
  const cw = cardWidthFor(width, maxSpan, opts.label);
  const ch = opts.usesLeft >= 0 ? D.cardHUses : D.cardH;
  const L = frameLayout(width, maxSpan, cw);
  const root = new TransformNode(`gate-${good ? 'good' : 'trap'}`, scene);

  const frameMat = look.material('gate-frame', () =>
    plasticMaterial(scene, null, { name: 'gate-frame', roughness: 0.36, clearcoat: 0.4, clearcoatRoughness: 0.12 }),
  );
  const frame = buildMesh(scene, 'gateFrame', buildFrameData(L, good), frameMat);
  frame.parent = root;

  const filmKey = good ? 'gate-film-good' : 'gate-film-trap';
  const filmMat = look.material(filmKey, () => {
    const m = plasticMaterial(scene, null, {
      name: filmKey,
      roughness: 0.12,
      alpha: 0.999,
      backFaceCulling: false,
      emissive: good ? HEX.gateGood : HEX.gateTrap,
      emissiveIntensity: 1.0,
      envIntensity: 0.7,
    });
    m.disableDepthWrite = true;
    return m;
  });
  const filmH = D.postTop - D.beamH - 0.06;
  const filmW = 2 * L.postX - D.post + 0.02;
  const film = buildMesh(scene, 'gateFilm', buildFilmData(filmW, filmH, good), filmMat);
  film.hasVertexAlpha = true;
  film.parent = root;
  film.position.y = 0.04 + filmH / 2;
  film.visibility = FILM_REST;

  // Sign card on its hinge pivot. `layer` nudges it a few mm in depth (never z-fights).
  const layer = Math.abs(Math.round(opts.layer ?? 0)) % 3;
  const pivot = new TransformNode('gateCardPivot', scene);
  pivot.parent = root;
  const pivotY = D.postTop + 0.04;
  const pivotZ = -0.02 - 0.006 * layer;
  pivot.position.set(0, pivotY, pivotZ);
  const texH = Math.round((TEX_W * ch) / cw) + STRIP;
  const tex = new DynamicTexture(
    'gateCardTex',
    { width: TEX_W, height: texH },
    scene,
    true,
    Texture.TRILINEAR_SAMPLINGMODE,
  );
  tex.anisotropicFilteringLevel = 4;
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  const cardMat = new PBRMaterial('gate-card', scene);
  cardMat.albedoTexture = tex;
  cardMat.emissiveTexture = tex;
  cardMat.emissiveColor = Color3.White();
  cardMat.emissiveIntensity = 0.22;
  cardMat.metallic = 0;
  cardMat.roughness = 0.5;
  cardMat.clearCoat.isEnabled = true;
  cardMat.clearCoat.intensity = 0.35;
  cardMat.clearCoat.roughness = 0.2;
  const card = buildMesh(scene, 'gateCard', buildCardData(cw, ch, texH), cardMat);
  card.parent = pivot;

  // Kickstand struts from the beam's back to the card's back; re-aimed by setLabelTilt.
  const strutNode = new TransformNode('gateStruts', scene);
  strutNode.parent = root;
  const strutA = { y: STRUT_ARM.y, z: -D.beamD / 2 + 0.03 - STRUT_ARM.len };
  strutNode.position.set(0, strutA.y, strutA.z);
  const struts = buildMesh(scene, 'gateStruts', buildStrutData(L, good), frameMat);
  struts.parent = strutNode;
  const strutH = Math.min(1.05, ch * 0.5); // how far up the card's back they hold it
  const aimStruts = (pitch: number): void => {
    // Card back point at height strutH, rotated by -pitch about X around the pivot.
    const c = Math.cos(pitch);
    const s = Math.sin(pitch);
    const zb = -D.cardD / 2;
    const by = pivotY + strutH * c + zb * s;
    const bz = pivotZ - strutH * s + zb * c;
    const dy = by - strutA.y;
    const dz = bz - strutA.z;
    const len = Math.max(0.05, Math.hypot(dy, dz));
    strutNode.rotation.x = Math.atan2(dz, dy);
    strutNode.scaling.set(1, len, 1);
  };
  aimStruts(Math.PI / 4);

  // Uses badge (one-use gates only): its own token mesh and 128 px texture.
  let badgeTex: DynamicTexture | null = null;
  let badgeMat: PBRMaterial | null = null;
  let badge: Mesh | null = null;
  if (opts.usesLeft >= 0) {
    badgeTex = new DynamicTexture(
      'gateBadgeTex',
      { width: BADGE_TEX, height: BADGE_TEX },
      scene,
      true,
      Texture.TRILINEAR_SAMPLINGMODE,
    );
    badgeTex.wrapU = Texture.CLAMP_ADDRESSMODE;
    badgeTex.wrapV = Texture.CLAMP_ADDRESSMODE;
    badgeMat = new PBRMaterial('gate-badge', scene);
    badgeMat.albedoTexture = badgeTex;
    badgeMat.emissiveTexture = badgeTex;
    badgeMat.emissiveColor = Color3.White();
    badgeMat.emissiveIntensity = 0.25;
    badgeMat.metallic = 0.15;
    badgeMat.roughness = 0.4;
    badgeMat.clearCoat.isEnabled = true;
    badgeMat.clearCoat.intensity = 0.4;
    badge = buildMesh(scene, 'gateUsesBadge', badgeData(BADGE_R, BADGE_T), badgeMat);
    badge.parent = pivot;
    badge.position.set(-cw / 2 + BADGE_R * 0.3, ch - BADGE_R * 0.25, D.cardD / 2 + BADGE_T / 2 + 0.01);
    badge.isPickable = false;
  }

  look.addShadowCaster(frame);
  look.addShadowCaster(card);
  look.addShadowCaster(struts);
  look.receiveShadows(frame);

  let curLabel = '';
  let curUses = Number.NaN;
  let broken = false;
  const setLabel = (label: string, usesLeft: number): void => {
    const u = usesLeft < 0 ? -1 : Math.max(0, Math.floor(usesLeft));
    if (label === curLabel && u === curUses) return;
    const labelChanged = label !== curLabel;
    curLabel = label;
    curUses = u;
    if (labelChanged) drawCard(tex, cw, texH, good, label, u);
    if (badgeTex && u >= 0) drawBadge(badgeTex, u);
  };
  setLabel(opts.label, opts.usesLeft);

  const meshes: Mesh[] = [frame, film, card, struts];
  if (badge) meshes.push(badge);
  return {
    root,
    setLabel,
    setLabelTilt(pitch: number): void {
      pivot.rotation.x = -pitch;
      aimStruts(pitch);
    },
    pulse(k: number, strong: boolean): void {
      if (broken) return;
      const c = Math.max(0, Math.min(1, k));
      const s = 1 + (strong ? 0.18 : 0.08) * c;
      film.scaling.set(s, s, 1);
      film.visibility = FILM_REST + (1 - FILM_REST) * c;
      const cs = 1 + 0.06 * c;
      pivot.scaling.set(cs, cs, cs);
    },
    setBreak(scale: number, alpha: number): void {
      broken = true;
      const a = Math.max(0, Math.min(1, alpha));
      root.scaling.setAll(Math.max(1e-3, scale));
      frame.visibility = a;
      card.visibility = a;
      struts.visibility = a;
      if (badge) badge.visibility = a;
      film.visibility = FILM_REST * a;
      root.setEnabled(a > 0 && scale > 0);
    },
    dispose(): void {
      for (const m of meshes) look.removeShadowCaster(m);
      root.dispose();
      cardMat.dispose(true, true);
      badgeMat?.dispose(true, true);
    },
  };
}

// ---------- preview ----------
export function preview(scene: Scene, look: Look, opts: PreviewOptions): PreviewResult {
  const root = new TransformNode('gatePreview', scene);
  const f = computeFraming({ aspect: 1170 / 2532, laneWidth: 10, nearZ: 1.5, farZ: 59, margin: 0.6 });
  type Spec = { label: string; good: boolean; uses: number; x: number; width: number; z?: number };
  const specs: Spec[] =
    opts.variant === 'single'
      ? [{ label: '÷2', good: false, uses: 12, x: 0, width: 4.2 }]
      : opts.variant === 'tight'
        ? [
            // Level 1-03's real layout: three gates abutting at spacing 3 (+ a 3-glyph label).
            { label: '÷2', good: false, uses: -1, x: -3, width: 3 },
            { label: 'x3', good: true, uses: -1, x: 0, width: 2.6 },
            { label: '-3', good: false, uses: -1, x: 3, width: 3 },
            { label: '+10', good: true, uses: 900, x: -2.5, width: 3, z: -6 },
            { label: 'x100', good: true, uses: -1, x: 2.5, width: 3, z: -6 },
          ]
        : [
            { label: 'x2', good: true, uses: -1, x: -5.4, width: 3 },
            { label: '+10', good: true, uses: -1, x: -1.8, width: 3 },
            { label: '-5', good: false, uses: -1, x: 1.8, width: 3 },
            { label: '÷2', good: false, uses: 12, x: 5.4, width: 3 },
          ];
  const slots = gateSlots(
    specs.map((s) => ({ x: s.x, z: s.z ?? 0, width: s.width })),
    opts.variant === 'row' || !opts.variant ? 14.4 : 10,
  );
  const gates = specs.map((s, i) => {
    const g = createGate(scene, look, {
      width: s.width,
      good: s.good,
      label: s.label,
      usesLeft: s.uses,
      maxSpan: slots[i].maxSpan,
      layer: slots[i].layer,
    });
    g.root.parent = root;
    g.root.position.set(s.x, 0, s.z ?? 0);
    g.setLabelTilt(f.pitch);
    return g;
  });
  return {
    root,
    update(time) {
      // Pulse each gate in turn (0.6 s apart), like units crossing.
      const period = 0.6 * gates.length;
      gates.forEach((g, i) => {
        const t = (time - i * 0.6) % period;
        const k = t >= 0 && t < 0.3 ? 1 - t / 0.3 : 0;
        g.pulse(k, specs[i].good);
      });
    },
    dispose() {
      for (const g of gates) g.dispose();
      root.dispose();
    },
  };
}
