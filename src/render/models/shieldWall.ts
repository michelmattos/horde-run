// Shield walls (World 3 defender kind 'shield', contracts SHIELD_DEFAULTS): a riveted tin
// barricade only champions can dent. A corrugated, lithographed tin plate (royal blue with
// yellow pinstripes) stands between two navy posts braced from behind, framed top and
// bottom by bright steel bars with brass rivets. A champion-crest sticker sits in the
// middle (a yellow roundel with a kneeling bazooka man and three stars). Damage shows in
// four stages: more and deeper dents each time, the paint chipped to bare tin at their
// bottoms and scratches round them (the sticker stays clear). Hits flash it; a blocked
// mob clangs it (a cold white flash and a tiny rock back on its feet).
//
// GAME API (defenders.ts):
//   const kit = createShieldWallKit(scene, look);    // while a level has shield walls
//   const wall = kit.create(width);                 // def.width ?? SHIELD_DEFAULTS.width
//   wall.root.position.set(x, 0, z); wall.root.rotation.y = Math.PI;  // front to the camera
//   wall.setDamage(1 - hp / maxHp);   // true when the dent stage changed
//   wall.setHit(k); wall.setClang(k); // 0..1 flashes
//   wall.topY(); wall.dispose(); kit.dispose();
// Every wall shares hidden sources (4 plate stages, frame, crest, blob) drawn as
// InstancedMesh copies: ~4 draw calls for any number of walls. Materials 'workshop-shield-*'.
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import '@babylonjs/core/Meshes/instancedMesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { SHIELD_DEFAULTS } from '../../contracts.ts';
import type { Look } from '../look/index.ts';
import {
  buildMesh,
  createBlobShadowMesh,
  fixWinding,
  lin,
  mergeParts,
  paint,
  paintedTinMaterial,
  place,
  plasticMaterial,
  roundedBox,
  srgb,
} from '../look/index.ts';
import type { ModelInfo, PreviewResult } from '../look/model.ts';
import { dentStage } from '../fxLogic.ts';
import { rng } from './environment.ts';

import { latheOut } from './workshopProps.ts';
export const info: ModelInfo = {
  key: 'shieldWall',
  title: 'Shield wall: riveted tin barricade',
  instanced: true,
  teams: false,
  side: 'enemy',
  height: 1.6,
  triangleBudget: 9000,
  gameZ: 30,
  variants: ['0', '1', '2', '3'],
};

const REF_W = SHIELD_DEFAULTS.width; // built at this width, scaled in x
const PLATE_W = REF_W - 0.1;
const PLATE_Y0 = 0.12;
const PLATE_Y1 = 1.32;
const PLATE_Z = 0.08; // front face (local +z is the front)
const CORR = 0.2; // corrugation period
const CORR_A = 0.018;
const POST_H = 1.5;
export const SHIELD_TOP = POST_H + 0.08;
const CREST = { y: 0.74, r: 0.34 };
const BLUE = '#2e5aa8';
const NAVY = '#22355e';
const PIN = '#f2c230';
const TIN = '#c9ced4';
const BRASS = '#c9a24a';

interface Dent {
  x: number;
  y: number;
  r: number;
  d: number;
}

// Dents for each stage: each stage keeps the last stage's dents (a little deeper) and adds
// more, never over the crest.
function dentSets(): Dent[][] {
  const r = rng(4242);
  const sets: Dent[][] = [[]];
  const add = [0, 3, 5, 6];
  let cur: Dent[] = [];
  for (let s = 1; s <= 3; s++) {
    cur = cur.map((d) => ({ ...d, d: d.d * 1.25 }));
    for (let k = 0; k < add[s]; k++) {
      let x = 0;
      let y = 0;
      do {
        x = (r() - 0.5) * (PLATE_W - 0.5);
        y = PLATE_Y0 + 0.15 + r() * (PLATE_Y1 - PLATE_Y0 - 0.3);
      } while (Math.hypot(x, y - CREST.y) < CREST.r + 0.3);
      cur.push({ x, y, r: 0.12 + r() * 0.16, d: 0.025 + r() * 0.03 });
    }
    sets.push(cur.slice());
  }
  return sets;
}

// The corrugated plate for one damage stage (front grid + flat back), vertex coloured.
function plateGeometry(dents: readonly Dent[], stage: number): VertexData {
  const nx = 84;
  const ny = 28;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const blue = lin(BLUE);
  const pin = lin(PIN);
  const tin = lin(TIN);
  const r = rng(77 + stage);
  // Scratches: short streaks near dents (from stage 2).
  const scratches: [number, number, number, number][] = [];
  if (stage >= 2)
    for (const d of dents)
      for (let k = 0; k < 2; k++) {
        const a = r() * Math.PI;
        scratches.push([d.x, d.y, Math.cos(a), Math.sin(a)]);
      }
  for (let j = 0; j <= ny; j++) {
    const y = PLATE_Y0 + ((PLATE_Y1 - PLATE_Y0) * j) / ny;
    for (let i = 0; i <= nx; i++) {
      const x = -PLATE_W / 2 + (PLATE_W * i) / nx;
      let z = PLATE_Z + CORR_A * Math.cos((x / CORR) * Math.PI * 2);
      let chip = 0;
      for (const d of dents) {
        const q = Math.hypot(x - d.x, y - d.y) / d.r;
        if (q >= 1) continue;
        const f = (1 - q * q) ** 2;
        z -= Math.min(0.1, d.d) * f;
        if (f > 0.8) chip = Math.max(chip, f);
      }
      for (const [sx, sy, dx, dy] of scratches) {
        const px = x - sx;
        const py = y - sy;
        const along = px * dx + py * dy;
        const across = Math.abs(px * -dy + py * dx);
        if (Math.abs(along) < 0.32 && across < 0.012) chip = Math.max(chip, 0.7);
      }
      const band = Math.abs(y - 0.3) < 0.025 || Math.abs(y - 1.16) < 0.025;
      const base = band ? pin : blue;
      const c = chip > 0.6 ? tin : base;
      pos.push(x, y, z);
      col.push(c.r, c.g, c.b, 1);
    }
  }
  const row = nx + 1;
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * row + i;
      idx.push(a, a + 1, a + row + 1, a, a + row + 1, a + row);
    }
  const front = new VertexData();
  front.positions = pos;
  front.indices = idx;
  front.colors = col;
  const normals: number[] = [];
  VertexData.ComputeNormals(pos, idx, normals);
  // ComputeNormals follows the winding; make them face the front (+z).
  let flip = 0;
  for (let i = 2; i < normals.length; i += 3) flip += normals[i];
  if (flip < 0) for (let i = 0; i < normals.length; i++) normals[i] = -normals[i];
  front.normals = normals;
  fixWinding(front);
  const back = paint(roundedBox(PLATE_W, PLATE_Y1 - PLATE_Y0, 0.03, 0.01, 1), lin(NAVY));
  place(back, { y: (PLATE_Y0 + PLATE_Y1) / 2, z: PLATE_Z - 0.13 });
  return mergeParts([front, back]);
}

function rivet(x: number, y: number, z: number): VertexData {
  const v = latheOut(
    [
      [0, 0.03],
      [0.022, 0.024],
      [0.032, 0.01],
      [0.034, 0],
    ],
    8,
  );
  place(v, { rx: Math.PI / 2 });
  return paint(place(v, { x, y, z }), lin(BRASS));
}

// Posts, braces, the steel bars and rivets: one source shared by every stage.
function frameGeometry(): VertexData {
  const parts: VertexData[] = [];
  const navy = lin(NAVY);
  const steel = lin(TIN);
  for (const s of [-1, 1]) {
    const x = s * (REF_W / 2 - 0.02);
    parts.push(paint(place(roundedBox(0.16, POST_H, 0.18, 0.04, 2), { x, y: POST_H / 2 }), navy));
    const cap = latheOut(
      [
        [0, 0.08],
        [0.06, 0.07],
        [0.1, 0.03],
        [0.11, 0],
      ],
      12,
    );
    parts.push(paint(place(cap, { x, y: POST_H }), lin(BRASS)));
    // A brace from high on the post down to a foot behind it.
    const brace = roundedBox(0.09, 1.2, 0.09, 0.03, 1);
    place(brace, { rx: -0.62 });
    parts.push(paint(place(brace, { x, y: 0.5, z: -0.27 }), navy));
    parts.push(paint(place(roundedBox(0.22, 0.05, 0.3, 0.02, 1), { x, y: 0.025, z: -0.52 }), navy));
    parts.push(paint(place(roundedBox(0.26, 0.05, 0.3, 0.02, 1), { x, y: 0.025, z: 0 }), navy));
    for (const y of [0.35, 0.75, 1.15]) parts.push(rivet(x, y, 0.09));
  }
  for (const y of [PLATE_Y0, PLATE_Y1]) {
    parts.push(paint(place(roundedBox(REF_W - 0.1, 0.09, 0.07, 0.025, 2), { y, z: PLATE_Z + 0.01 }), steel));
    const n = 15;
    for (let k = 0; k < n; k++)
      parts.push(rivet(-PLATE_W / 2 + 0.15 + (k / (n - 1)) * (PLATE_W - 0.3), y, PLATE_Z + 0.045));
  }
  return mergeParts(parts);
}

// The champion-crest sticker: yellow roundel, navy ring, a kneeling bazooka man, stars.
function crestTexture(scene: Scene): DynamicTexture {
  const S = 256;
  const c = S / 2;
  const tex = new DynamicTexture('workshop-shield-crest-tex', { width: S, height: S }, scene, true);
  tex.hasAlpha = true;
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, S, S);
  const circle = (r: number, fill: string): void => {
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  };
  circle(124, '#f6f1e3');
  circle(114, '#22355e');
  circle(104, '#f3c443');
  ctx.fillStyle = '#22355e';
  // Kneeling figure facing right with a bazooka on his shoulder.
  ctx.beginPath();
  ctx.arc(c - 10, c - 40, 15, 0, Math.PI * 2); // head
  ctx.fill();
  ctx.beginPath(); // helmet brim
  ctx.ellipse(c - 10, c - 48, 21, 9, 0, Math.PI, 0);
  ctx.fill();
  ctx.beginPath(); // torso, knee and boot
  ctx.moveTo(c - 30, c - 24);
  ctx.lineTo(c + 8, c - 24);
  ctx.lineTo(c + 14, c + 14);
  ctx.lineTo(c + 44, c + 18);
  ctx.lineTo(c + 44, c + 34);
  ctx.lineTo(c + 2, c + 34);
  ctx.lineTo(c - 6, c + 16);
  ctx.lineTo(c - 22, c + 60);
  ctx.lineTo(c - 44, c + 60);
  ctx.lineTo(c - 36, c + 52);
  ctx.lineTo(c - 26, c + 12);
  ctx.closePath();
  ctx.fill();
  ctx.save(); // bazooka tube across the shoulder
  ctx.translate(c - 4, c - 26);
  ctx.rotate(-0.12);
  ctx.fillRect(-58, -10, 122, 20);
  ctx.fillRect(56, -14, 12, 28);
  ctx.restore();
  const star = (x: number, y: number, r: number): void => {
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      const rr = k % 2 === 0 ? r : r * 0.45;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  };
  ctx.fillStyle = '#b5372f';
  star(c - 52, c + 82, 11);
  star(c, c + 88, 13);
  star(c + 52, c + 82, 11);
  tex.update(true);
  return tex;
}

function crestGeometry(): VertexData {
  const vd = new VertexData();
  const r = CREST.r;
  const z = PLATE_Z + CORR_A + 0.006;
  vd.positions = [-r, CREST.y - r, z, r, CREST.y - r, z, r, CREST.y + r, z, -r, CREST.y + r, z];
  vd.normals = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
  // The wall stands at yaw PI, so the camera sees local -x on its right: u runs that way.
  vd.uvs = [1, 0, 0, 0, 0, 1, 1, 1];
  vd.indices = [0, 1, 2, 0, 2, 3];
  return fixWinding(vd);
}

export interface ShieldWallModel {
  root: TransformNode;
  setDamage(frac: number): boolean; // 0..1 damage share; true when the dent stage changed
  setHit(k: number): void; // 0..1 hit flash
  setClang(k: number): void; // 0..1 clang (blocked mob): cold flash and a tiny rock back
  topY(): number;
  dispose(): void;
}
export interface ShieldWallKit {
  root: TransformNode;
  create(width: number): ShieldWallModel;
  dispose(): void;
}

// The kit's colours live in a tiny palette texture (vertex uv picks a texel), because the
// instances' hit / clang tint takes the 'color' attribute that vertex colours would use.
const PALETTE = [PIN, BLUE, TIN, NAVY, BRASS]; // neighbours that meet on the plate sit side by side

function paletteTexture(scene: Scene): Texture {
  const data = new Uint8Array(8 * 4);
  PALETTE.forEach((hex, i) => {
    const c = srgb(hex);
    data.set([Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255), 255], i * 4);
  });
  const t = RawTexture.CreateRGBATexture(data, 8, 1, scene, false, false, Texture.NEAREST_SAMPLINGMODE);
  t.name = 'workshop-shield-palette';
  t.gammaSpace = true;
  t.wrapU = Texture.CLAMP_ADDRESSMODE;
  t.wrapV = Texture.CLAMP_ADDRESSMODE;
  return t;
}

// Swaps the painted vertex colours for uvs into the palette (nearest entry).
function toPalette(vd: VertexData): VertexData {
  const c = vd.colors!;
  const pal = PALETTE.map((hex) => lin(hex));
  const n = c.length / 4;
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    let best = 0;
    let bestD = Infinity;
    pal.forEach((p, k) => {
      const d = (p.r - c[i * 4]) ** 2 + (p.g - c[i * 4 + 1]) ** 2 + (p.b - c[i * 4 + 2]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    });
    uv[i * 2] = (best + 0.5) / 8;
    uv[i * 2 + 1] = 0.5;
  }
  vd.uvs = uv;
  vd.colors = null;
  return vd;
}

export function createShieldWallKit(scene: Scene, look: Look): ShieldWallKit {
  const tin = look.material('workshop-shield-tin', () =>
    paintedTinMaterial(scene, null, {
      name: 'workshop-shield-tin',
      roughness: 0.34,
      albedoTexture: paletteTexture(scene),
    }),
  );
  const crestMat = look.material('workshop-shield-crest', () => {
    const m = plasticMaterial(scene, null, {
      name: 'workshop-shield-crest',
      albedoTexture: crestTexture(scene),
      roughness: 0.3,
      clearcoat: 0.6,
    });
    m.useAlphaFromAlbedoTexture = true;
    m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
    m.alphaCutOff = 0.5;
    return m;
  });
  const kitRoot = new TransformNode('shieldWallKit', scene);
  const source = (name: string, vd: VertexData, mat: PBRMaterial): Mesh => {
    const m = buildMesh(scene, name, vd, mat);
    m.parent = kitRoot;
    m.registerInstancedBuffer('color', 4);
    m.instancedBuffers.color = new Color4(1, 1, 1, 1);
    m.isVisible = false;
    look.receiveShadows(m);
    return m;
  };
  const sets = dentSets();
  const plates = sets.map((d, s) => source(`shieldPlate${s}`, toPalette(plateGeometry(d, s)), tin));
  const frame = source('shieldFrame', toPalette(frameGeometry()), tin);
  const crest = source('shieldCrest', crestGeometry(), crestMat);
  const blobSrc = createBlobShadowMesh(scene, 'shieldBlob', 0.5);
  blobSrc.parent = kitRoot;
  blobSrc.isVisible = false;
  let serial = 0;
  const live = new Set<ShieldWallModel>();

  const create = (width: number): ShieldWallModel => {
    const id = ++serial;
    const root = new TransformNode(`shield${id}`, scene);
    const body = new TransformNode(`shield${id}Body`, scene);
    body.parent = root;
    const sx = Math.max(0.5, width / REF_W);
    const wide = new TransformNode(`shield${id}Wide`, scene);
    wide.parent = body;
    wide.scaling.x = sx;
    const inst = (src: Mesh, parent: TransformNode, name: string): InstancedMesh => {
      const m = src.createInstance(`shield${id}${name}`);
      m.parent = parent;
      look.addShadowCaster(m);
      return m;
    };
    const stages = plates.map((p, i) => {
      const m = inst(p, wide, `p${i}`);
      m.setEnabled(i === 0);
      return m;
    });
    const all = [...stages, inst(frame, wide, 'f'), inst(crest, body, 'c')];
    const blob = blobSrc.createInstance(`shield${id}Blob`);
    blob.parent = root;
    blob.scaling.set(width + 0.6, 1, 1.3);
    blob.position.z = -0.15;
    let stage = 0;
    let hit = 0;
    let clang = 0;
    const tint = (): void => {
      const h = hit * 0.6;
      const c = clang * 0.9;
      for (const m of all) (m.instancedBuffers.color as Color4).set(1 + h + c * 0.8, 1 + h + c * 0.9, 1 + h + c, 1);
      body.rotation.x = -0.035 * clang;
    };
    const model: ShieldWallModel = {
      root,
      setDamage(frac: number): boolean {
        const s = dentStage(1 - Math.min(1, Math.max(0, frac)), 1);
        if (s === stage) return false;
        stages[stage].setEnabled(false);
        stages[s].setEnabled(true);
        stage = s;
        return true;
      },
      setHit(k: number): void {
        const h = Math.min(1, Math.max(0, k));
        if (h === hit) return;
        hit = h;
        tint();
      },
      setClang(k: number): void {
        const c = Math.min(1, Math.max(0, k));
        if (c === clang) return;
        clang = c;
        tint();
      },
      topY(): number {
        return SHIELD_TOP;
      },
      dispose(): void {
        live.delete(model);
        root.dispose();
      },
    };
    live.add(model);
    return model;
  };

  return {
    root: kitRoot,
    create,
    dispose(): void {
      for (const m of live) m.dispose();
      kitRoot.dispose(false, false);
    },
  };
}

// ---------- preview ----------
export function preview(scene: Scene, look: Look, opts: { variant: string | null }): PreviewResult {
  const root = new TransformNode('shieldWallPreview', scene);
  const old = look.theme;
  look.setTheme('workshop');
  const kit = createShieldWallKit(scene, look);
  kit.root.parent = root;
  const wall = kit.create(SHIELD_DEFAULTS.width);
  wall.root.parent = root;
  const stage = Number(opts.variant ?? '0');
  wall.setDamage([0, 0.3, 0.6, 0.9][stage] ?? 0);
  return {
    root,
    update(time: number): void {
      const u = time % 2.5;
      wall.setClang(u < 0.2 ? 1 - u / 0.2 : 0);
    },
    dispose(): void {
      kit.dispose();
      root.dispose();
      look.setTheme(old);
    },
  };
}
