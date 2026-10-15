// Freezer props: the frozen food and ice scattered on the frosted liner beside the World 2
// runner. Six kinds, all thin-instanced, eight meshes in all (so the whole set is at most
// eight draw calls per pass however many props a level scatters):
//
//   cube      chunky ice cubes (1-3 per cluster): glossy see-through ice, frosted edges
//   peas      a frozen pea bag: a crinkled pillow of blue plastic with crimped seals and a
//             printed window of pale peas (packaging atlas)
//   popsicle  ice lollies lying flat (instance colour: cherry, orange, grape, raspberry)
//             with a separate wooden stick mesh
//   fishbox   a fish-finger carton: orange box, blue wave band, a smiling fish (atlas)
//   tub       ice-cream tubs (instance pastel colour) with a cream lid: closed, lid off,
//             or two stacked
//   flake     snowflake confetti: flat six-armed glitter flakes, scattered in little drifts
//
// Colours are toy-bright but never army green or tan (the peas are a pale mint-teal).
// During a gust the loose light props (flakes and pea bags) sway and slide a little:
// setGust() rewrites only those two meshes' matrices from their rest poses, cheap enough
// to do every frame; at rest nothing is touched.
//
// GAME API (scenery.ts):
//   const kit = createFreezerPropKit(scene, look);   // when the freezer theme loads
//   kit.begin(); kit.add(kind, variant, x, z, yaw, scale, colorIndex); ... kit.commit();
//   kit.setGust(strength 0..1, dir -1|0|1, time);    // per frame while the theme is up
//   kit.dispose();                                   // theme change (materials: 'freezer-props-*')
// Shadows: every mesh casts (flakes excepted) and receives; the swaying pea bags are
// registered as 'crowd' casters (redrawn every frame, dropped on the low tier).
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Look } from '../look/index.ts';
import {
  bakeVertexAO,
  buildMesh,
  glassMaterial,
  lathe,
  lin,
  mergeParts,
  paint,
  place,
  plasticMaterial,
  roundedBox,
  woodMaterial,
} from '../look/index.ts';
import type { ModelInfo, PreviewOptions, PreviewResult } from '../look/model.ts';
import type { FreezerPropKind } from '../fxLogic.ts';
import { FREEZER_KINDS, FREEZER_RADIUS, FREEZER_VARIANTS, writeTRS } from '../fxLogic.ts';

export const info: ModelInfo = {
  key: 'freezerProps',
  title: 'Freezer props (ice cubes, pea bags, popsicles, fish-finger box, ice-cream tubs, snowflakes)',
  instanced: true,
  teams: false,
  side: 'neutral',
  height: 1.4,
  triangleBudget: 1500, // per kind-mesh
  gameZ: 20,
  variants: ['all', 'scatter', 'gust'],
};

export const FREEZER_PROP_CAPACITY = 120;

export interface FreezerPropKit {
  meshes: Mesh[];
  begin(): void;
  add(
    kind: FreezerPropKind,
    variant: number,
    x: number,
    z: number,
    yaw: number,
    scale: number,
    colorIndex: number,
  ): void;
  commit(): void;
  // Gust sway: strength 0..1 (fxLogic gustStrength), dir -1 left / 1 right, battle time.
  setGust(strength: number, dir: number, time: number): void;
  dispose(): void;
}

// Popsicle and tub colours (sRGB): fruity and pastel, never green or tan.
const POPSICLE = ['#d8333b', '#f07a24', '#8e4fc4', '#2f8fd6', '#e8558f', '#f2c230'];
const TUB = ['#f2a7bf', '#b9a6e6', '#f5d77a', '#9fcbef', '#f4b98c', '#e7e0f2'];
const FLAKE = ['#eef4f8', '#dbe9f5', '#f2f0fa'];
const ATLAS_W = 512;
const ATLAS_H = 256;

// ---------- the packaging atlas (pea bag print | fish box top | fish box side) ----------

function drawAtlas(tex: DynamicTexture): void {
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const W = ATLAS_W;
  const H = ATLAS_H;
  // Left half: the pea bag. Glossy blue with a white oval window full of pale peas.
  const bag = ctx.createLinearGradient(0, 0, 0, H);
  bag.addColorStop(0, '#3f7fd0');
  bag.addColorStop(1, '#2a5fae');
  ctx.fillStyle = bag;
  ctx.fillRect(0, 0, W / 2, H);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  for (let i = 0; i < 6; i++) ctx.fillRect(0, i * 44 + 10, W / 2, 6); // crinkle highlights
  ctx.beginPath();
  ctx.ellipse(W / 4, H / 2 + 6, 92, 72, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#f4f6f6';
  ctx.fill();
  ctx.lineWidth = 7;
  ctx.strokeStyle = '#f2b630';
  ctx.stroke();
  let s = 7;
  const rnd = (): number => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  for (let i = 0; i < 70; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd());
    const x = W / 4 + Math.cos(a) * r * 78;
    const y = H / 2 + 6 + Math.sin(a) * r * 58;
    const pea = ctx.createRadialGradient(x - 3, y - 3, 1, x, y, 10);
    pea.addColorStop(0, '#c9eadf');
    pea.addColorStop(1, '#6fae9f');
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fillStyle = pea;
    ctx.fill();
  }
  // A frost-white snowflake sticker in the corner.
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 5;
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 40, 38);
    ctx.lineTo(W / 2 - 40 + Math.cos(a) * 24, 38 + Math.sin(a) * 24);
    ctx.stroke();
  }
  // Right top: the fish box's top. Orange with a blue wave band and a round cartoon fish.
  const x0 = W / 2;
  ctx.fillStyle = '#f07a24';
  ctx.fillRect(x0, 0, W / 2, H / 2);
  ctx.fillStyle = '#2f6fd6';
  ctx.beginPath();
  ctx.moveTo(x0, H / 2);
  for (let x = 0; x <= W / 2; x += 8) ctx.lineTo(x0 + x, H / 2 - 30 - Math.sin(x / 18) * 8);
  ctx.lineTo(x0 + W / 2, H / 2);
  ctx.fill();
  ctx.fillStyle = '#fff1d6';
  ctx.beginPath();
  ctx.ellipse(x0 + 118, 54, 52, 30, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x0 + 162, 54);
  ctx.lineTo(x0 + 196, 30);
  ctx.lineTo(x0 + 196, 78);
  ctx.fill();
  ctx.fillStyle = '#2b1d12';
  ctx.beginPath();
  ctx.arc(x0 + 92, 46, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#2b1d12';
  ctx.beginPath();
  ctx.arc(x0 + 86, 60, 10, 0.2, 1.4);
  ctx.stroke();
  // Breaded fish fingers lined up on the box.
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = '#d99a4a';
    ctx.fillRect(x0 + 24 + i * 70, 98, 56, 18);
    ctx.fillStyle = 'rgba(120,60,20,0.35)';
    for (let k = 0; k < 6; k++) ctx.fillRect(x0 + 28 + i * 70 + k * 9, 102 + (k % 2) * 6, 3, 3);
  }
  // Right bottom: the box sides, orange with a blue stripe and a frosted bottom edge.
  ctx.fillStyle = '#e8701f';
  ctx.fillRect(x0, H / 2, W / 2, H / 2);
  ctx.fillStyle = '#2f6fd6';
  ctx.fillRect(x0, H / 2 + 44, W / 2, 26);
  ctx.fillStyle = 'rgba(240,248,255,0.55)';
  ctx.fillRect(x0, H - 14, W / 2, 14);
  tex.update(true);
}

// ---------- geometry ----------

function shadeBy(
  vd: VertexData,
  fn: (x: number, y: number, z: number, nx: number, ny: number, nz: number) => number,
): VertexData {
  const p = vd.positions!;
  const n = vd.normals!;
  const c = vd.colors ? Float32Array.from(vd.colors) : new Float32Array((p.length / 3) * 4).fill(1);
  for (let i = 0; i < p.length / 3; i++) {
    const k = fn(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], n[i * 3], n[i * 3 + 1], n[i * 3 + 2]);
    c[i * 4] *= k;
    c[i * 4 + 1] *= k;
    c[i * 4 + 2] *= k;
  }
  vd.colors = c;
  return vd;
}

function recomputeNormals(vd: VertexData): VertexData {
  const normals: number[] = [];
  VertexData.ComputeNormals(vd.positions!, vd.indices!, normals);
  vd.normals = normals;
  return vd;
}

const CUBE = 0.72;
// An ice cube: a softly rounded cube, frost-white along its edges and corners, a clearer
// cool core on the faces (vertex colours times the glassy material).
function cubeGeometry(): VertexData {
  const vd = roundedBox(CUBE, CUBE, CUBE, 0.12, 2);
  const h = CUBE / 2;
  return place(
    shadeBy(paint(vd, lin('#cfe6f3')), (x, y, z) => {
      const e = [Math.abs(x), Math.abs(y), Math.abs(z)].filter((v) => v > h - 0.1).length;
      return e >= 2 ? 1.18 : 0.9;
    }),
    { y: h },
  );
}

const BAG_L = 2.6;
const BAG_W = 1.8;
const BAG_T = 0.46;
// A frozen pea bag: a pillow whose thickness falls to a crimped seal at both ends, with
// lumps where the peas push the plastic. The print covers top and bottom.
function peasGeometry(): VertexData {
  const vd = roundedBox(BAG_L, BAG_T, BAG_W, 0.2, 3);
  const p = vd.positions as number[];
  for (let i = 0; i < p.length; i += 3) {
    const u = Math.abs(p[i]) / (BAG_L / 2);
    const pinch = 1 - Math.pow(u, 5) * 0.86;
    const lump = 1 + 0.08 * Math.sin(p[i] * 7.1) * Math.sin(p[i + 2] * 6.3);
    p[i + 1] = p[i + 1] * pinch * lump + BAG_T / 2;
  }
  vd.positions = p;
  recomputeNormals(vd);
  // UVs: the print over the top and bottom faces (x along the bag), seals and sides a
  // plain blue strip of the print.
  const n = vd.normals!;
  const uv = new Float32Array((p.length / 3) * 2);
  for (let i = 0; i < p.length / 3; i++) {
    const top = Math.abs(n[i * 3 + 1]) > 0.55;
    if (top) {
      uv[i * 2] = 0.5 * (0.5 + p[i * 3] / BAG_L);
      uv[i * 2 + 1] = 0.5 + p[i * 3 + 2] / BAG_W;
    } else {
      uv[i * 2] = 0.03;
      uv[i * 2 + 1] = 0.03;
    }
  }
  vd.uvs = uv;
  return shadeBy(vd, (x, y) => (Math.abs(x) > BAG_L * 0.42 ? 0.86 : 1) * (y < 0.05 ? 0.8 : 1));
}

// An ice lolly lying flat: a rounded slab with a domed far end and a frosty skin; the
// stick (separate mesh) pokes out of the near end.
function popsicleGeometry(): [VertexData, VertexData] {
  const ice = roundedBox(0.95, 0.3, 1.55, 0.13, 2);
  const p = ice.positions as number[];
  for (let i = 0; i < p.length; i += 3) {
    const t = Math.max(0, (p[i + 2] - 0.35) / 0.43); // round off the far end
    p[i] *= 1 - 0.22 * t * t;
    p[i + 1] += 0.15;
  }
  ice.positions = p;
  recomputeNormals(ice);
  shadeBy(ice, (x, y, z) => (y > 0.27 ? 1.05 : 0.92) * (1 - 0.06 * Math.abs(x)) * (z < -0.65 ? 0.9 : 1));
  const stick = paint(place(roundedBox(0.24, 0.07, 1.1, 0.03, 1), { y: 0.06, z: -1.1 }), lin('#e3c591').scale(0.95));
  return [place(ice, { z: 0.2 }), place(stick, { z: 0.2 })];
}

const BOX_L = 2.5;
const BOX_W = 1.5;
const BOX_H = 0.72;
// A fish-finger carton: a crisp card box (small bevel), its top printed with the fish and
// the fingers, its sides with the blue stripe.
function fishboxGeometry(): VertexData {
  const vd = roundedBox(BOX_L, BOX_H, BOX_W, 0.05, 1);
  const p = vd.positions!;
  const n = vd.normals!;
  const uv = vd.uvs!;
  const out = new Float32Array(uv.length);
  for (let i = 0; i < p.length / 3; i++) {
    const ny = n[i * 3 + 1];
    if (ny > 0.6) {
      out[i * 2] = 0.5 + 0.5 * (0.5 - p[i * 3] / BOX_L);
      out[i * 2 + 1] = 0.5 * (0.5 + p[i * 3 + 2] / BOX_W);
    } else {
      const along = Math.abs(n[i * 3]) > 0.6 ? p[i * 3 + 2] / BOX_W : p[i * 3] / BOX_L;
      out[i * 2] = 0.5 + 0.5 * (0.5 + along);
      out[i * 2 + 1] = 0.5 + 0.5 * (0.5 + p[i * 3 + 1] / BOX_H);
    }
  }
  vd.uvs = out;
  return place(
    shadeBy(vd, (_x, y) => (y < -BOX_H / 2 + 0.06 ? 0.75 : 1)),
    { y: BOX_H / 2 },
  );
}

const TUB_H = 0.9;
// Ice-cream tub: a tapered round tub with a rolled rim and a lighter label band, holding a
// scoop-dimpled surface of ice cream; the lid is its own mesh.
function tubGeometry(): [VertexData, VertexData] {
  const body = lathe(
    [
      [0, 0.02],
      [0.56, 0],
      [0.62, 0.05],
      [0.66, 0.3],
      [0.7, 0.62],
      [0.74, TUB_H - 0.08],
      [0.79, TUB_H - 0.04],
      [0.78, TUB_H],
      [0.7, TUB_H - 0.02],
      [0.68, TUB_H - 0.1],
      [0.5, TUB_H - 0.08],
      [0.2, TUB_H - 0.03],
      [0, TUB_H - 0.06],
    ],
    24,
  );
  shadeBy(body, (_x, y, _z, _nx, ny) => {
    if (y > TUB_H - 0.11 && ny > 0.3) return 1.12; // the ice cream: paler
    const band = y > 0.25 && y < 0.65 ? 1.08 : 0.86;
    return band * (y < 0.06 ? 0.7 : 1);
  });
  const lid = lathe(
    [
      [0, 0.1],
      [0.5, 0.1],
      [0.74, 0.08],
      [0.83, 0.06],
      [0.84, 0.0],
      [0.79, -0.04],
      [0.77, 0.03],
      [0, 0.03],
    ],
    24,
  );
  paint(lid, lin('#f1ece2'));
  return [body, lid];
}

// One flat six-armed snowflake (radius ~0.45), arms with two pairs of twigs.
function flakeGeometry(): VertexData {
  const parts: VertexData[] = [];
  const t = 0.035;
  for (let a = 0; a < 6; a++) {
    const ry = (a * Math.PI) / 3;
    parts.push(place(roundedBox(0.07, t, 0.45, 0.015, 1), { z: 0.225, y: t / 2 + 0.01, ry }));
    for (const [f, len] of [
      [0.22, 0.16],
      [0.34, 0.1],
    ] as const) {
      for (const s of [-1, 1]) {
        const v = place(roundedBox(0.05, t, len, 0.012, 1), { z: len / 2, y: t / 2 + 0.01, ry: (s * Math.PI) / 3 });
        place(v, { z: f });
        place(v, { ry });
        parts.push(v);
      }
    }
  }
  parts.push(place(roundedBox(0.14, t + 0.01, 0.14, 0.03, 1), { y: t / 2 + 0.012, ry: 0.4 }));
  return mergeParts(parts);
}

// ---------- the kit ----------

// Thin-instance batch with stored rest poses (x, y, z, scale, yaw, pitch, roll) so the
// loose ones can sway from their rest pose without accumulating drift.
class Batch {
  readonly mesh: Mesh;
  readonly m: Float32Array;
  readonly c: Float32Array | null;
  readonly pose: Float32Array; // 7 per instance
  count = 0;
  private readonly cap: number;

  constructor(mesh: Mesh, cap: number, colored: boolean) {
    this.mesh = mesh;
    this.cap = cap;
    this.m = new Float32Array(cap * 16);
    for (let i = 0; i < cap; i++) this.m[i * 16] = this.m[i * 16 + 5] = this.m[i * 16 + 10] = this.m[i * 16 + 15] = 1;
    this.c = colored ? new Float32Array(cap * 4).fill(1) : null;
    this.pose = new Float32Array(cap * 7);
    mesh.thinInstanceSetBuffer('matrix', this.m, 16, false);
    if (this.c) mesh.thinInstanceSetBuffer('color', this.c, 4, false);
    mesh.thinInstanceCount = 0;
    mesh.isVisible = false;
    mesh.doNotSyncBoundingInfo = true;
  }

  push(x: number, y: number, z: number, s: number, yaw: number, pitch: number, roll: number, c: Color3 | null): void {
    if (this.count >= this.cap) return;
    const i = this.count++;
    this.pose.set([x, y, z, s, yaw, pitch, roll], i * 7);
    writeTRS(this.m, i * 16, x, y, z, s, s, s, yaw, pitch, roll);
    if (this.c && c) this.c.set([c.r, c.g, c.b, 1], i * 4);
  }

  commit(): void {
    const m = this.mesh;
    m.thinInstanceCount = this.count;
    m.thinInstanceBufferUpdated('matrix');
    if (this.c) m.thinInstanceBufferUpdated('color');
    m.isVisible = this.count > 0;
    if (this.count > 0) m.thinInstanceRefreshBoundingInfo(false);
  }
}

interface Geometry {
  cube: VertexData;
  peas: VertexData;
  popsicle: [VertexData, VertexData];
  fishbox: VertexData;
  tub: [VertexData, VertexData];
  flake: VertexData;
}
let geometryCache: Geometry | null = null;
function geometry(): Geometry {
  geometryCache ??= {
    cube: cubeGeometry(),
    peas: bakeVertexAO(peasGeometry(), { samples: 10, strength: 0.4, maxDist: 0.4 }),
    popsicle: popsicleGeometry(),
    fishbox: fishboxGeometry(),
    tub: tubGeometry(),
    flake: flakeGeometry(),
  };
  return geometryCache;
}

function hash(x: number, z: number, k: number): number {
  const s = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

export function createFreezerPropKit(scene: Scene, look: Look): FreezerPropKit {
  const root = new TransformNode('freezerPropKit', scene);
  const mat = <T extends PBRMaterial>(key: string, make: () => T): T => look.material(`freezer-props-${key}`, make);
  const iceMat = mat('ice', () => {
    const m = glassMaterial(scene, null, {
      alpha: 0.8,
      envIntensity: 1.7,
      roughness: 0.08,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
    });
    m.useRadianceOverAlpha = true;
    m.useSpecularOverAlpha = true;
    return m;
  });
  const packMat = mat('pack', () => {
    const tex = new DynamicTexture(
      'freezer-props-atlas',
      { width: ATLAS_W, height: ATLAS_H },
      scene,
      true,
      Texture.TRILINEAR_SAMPLINGMODE,
    );
    tex.wrapU = Texture.CLAMP_ADDRESSMODE;
    tex.wrapV = Texture.CLAMP_ADDRESSMODE;
    tex.anisotropicFilteringLevel = 4;
    drawAtlas(tex);
    return plasticMaterial(scene, null, {
      albedoTexture: tex,
      roughness: 0.34,
      clearcoat: 0.45,
      clearcoatRoughness: 0.12,
      texture: 'plastic',
      normalStrength: 0.25,
    });
  });
  const lollyMat = mat('lolly', () =>
    plasticMaterial(scene, null, { instanceColor: true, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.2 }),
  );
  const stickMat = mat('stick', () => woodMaterial(scene, null, { normalStrength: 0.2, clearcoat: 0 }));
  const tubMat = mat('tub', () =>
    plasticMaterial(scene, null, { instanceColor: true, roughness: 0.4, clearcoat: 0.35 }),
  );
  const lidMat = mat('lid', () => plasticMaterial(scene, null, { roughness: 0.38, clearcoat: 0.3 }));
  const flakeMat = mat('flake', () =>
    plasticMaterial(scene, null, { instanceColor: true, roughness: 0.22, clearcoat: 0.8, envIntensity: 1.5 }),
  );

  const g = geometry();
  const C = FREEZER_PROP_CAPACITY;
  const mk = (
    name: string,
    vd: VertexData,
    m: PBRMaterial,
    per: number,
    colored: boolean,
    cast: 'static' | 'crowd' | 'none',
  ): Batch => {
    const mesh = buildMesh(scene, `freezerProp-${name}`, vd, m);
    mesh.parent = root;
    if (cast !== 'none') look.addShadowCaster(mesh, cast);
    look.receiveShadows(mesh);
    return new Batch(mesh, C * per, colored);
  };
  const b = {
    cube: mk('cube', g.cube, iceMat, 3, false, 'static'),
    peas: mk('peas', g.peas, packMat, 1, false, 'crowd'),
    lolly: mk('lolly', g.popsicle[0], lollyMat, 2, true, 'static'),
    stick: mk('stick', g.popsicle[1], stickMat, 2, false, 'static'),
    fishbox: mk('fishbox', g.fishbox, packMat, 2, false, 'static'),
    tub: mk('tub', g.tub[0], tubMat, 2, true, 'static'),
    lid: mk('lid', g.tub[1], lidMat, 2, false, 'static'),
    flake: mk('flake', g.flake, flakeMat, 7, true, 'none'),
  };
  b.cube.mesh.alphaIndex = 1;
  const batches = Object.values(b);
  const loose = [b.flake, b.peas];
  const col = new Color3();
  const pick = (list: readonly string[], i: number): Color3 => {
    const c = lin(list[((i % list.length) + list.length) % list.length]);
    return col.copyFrom(c);
  };

  // Writes an instance at a local offset (ox, oz) from the prop's pivot, turned by yaw.
  let px = 0,
    pz = 0,
    pyaw = 0,
    ps = 1;
  const put = (
    batch: Batch,
    ox: number,
    oy: number,
    oz: number,
    s: number,
    yaw: number,
    pitch: number,
    roll: number,
    c: Color3 | null,
  ): void => {
    const cy = Math.cos(pyaw);
    const sy = Math.sin(pyaw);
    batch.push(
      px + (ox * cy + oz * sy) * ps,
      oy * ps,
      pz + (-ox * sy + oz * cy) * ps,
      s * ps,
      pyaw + yaw,
      pitch,
      roll,
      c,
    );
  };

  let swayed = 0; // the gust offset last written (0 = props at rest)
  const kit: FreezerPropKit = {
    meshes: batches.map((x) => x.mesh),
    begin() {
      for (const x of batches) x.count = 0;
    },
    add(kind, variant, x, z, yaw, scale, colorIndex) {
      px = x;
      pz = z;
      pyaw = yaw;
      ps = scale;
      const v = Math.abs(Math.floor(variant)) % FREEZER_VARIANTS[kind];
      const ci = Math.floor(colorIndex);
      const h = (k: number): number => hash(x, z, k);
      switch (kind) {
        case 'cube': {
          const n = v + 1;
          const spots: [number, number][] = [
            [0, 0],
            [0.82, 0.18],
            [0.25, -0.8],
          ];
          for (let i = 0; i < n; i++) {
            const s = 0.85 + h(i) * 0.3;
            // The third cube leans on the first two.
            const lean = i === 2 ? 0.35 : 0;
            put(
              b.cube,
              spots[i][0],
              i === 2 ? 0.12 : 0,
              spots[i][1],
              s,
              h(i + 3) * 1.6,
              lean,
              (h(i + 5) - 0.5) * 0.1,
              null,
            );
          }
          break;
        }
        case 'peas':
          put(b.peas, 0, 0, 0, 1, v === 1 ? 0.3 : 0, 0, v === 1 ? 0.06 : 0, null);
          break;
        case 'popsicle': {
          const n = v === 0 ? 1 : 2;
          for (let i = 0; i < n; i++) {
            const ox = i === 0 ? 0 : 1.0;
            const oz = i === 0 ? 0 : 0.35;
            const ry = i === 0 ? 0 : v === 2 ? 0.9 : 0.25;
            const c = pick(POPSICLE, ci + i * 2);
            put(b.lolly, ox, 0, oz, 1, ry, 0, 0, c);
            put(b.stick, ox, 0, oz, 1, ry, 0, 0, null);
          }
          break;
        }
        case 'fishbox':
          put(b.fishbox, 0, 0, 0, 1, 0, 0, 0, null);
          if (v === 1) put(b.fishbox, 0.15, BOX_H, 0.1, 0.92, 0.35 + h(1) * 0.2, 0, 0, null);
          break;
        case 'tub': {
          const c = pick(TUB, ci);
          put(b.tub, 0, 0, 0, 1, 0, 0, 0, c);
          if (v === 0) put(b.lid, 0, TUB_H - 0.02, 0, 1, 0, 0, 0, null);
          else if (v === 1) put(b.lid, 1.05, 0.48, 0.2, 1, 0, 0, Math.PI / 2 - 0.3, null); // lid leaning on the tub
          else {
            put(b.lid, 0, TUB_H - 0.02, 0, 1, 0, 0, 0, null);
            put(b.tub, 0.05, TUB_H + 0.08, 0.02, 0.92, 0.4, 0, 0, pick(TUB, ci + 3));
            put(b.lid, 0.05, TUB_H * 1.92 + 0.06, 0.02, 0.92, 0, 0, 0, null);
          }
          break;
        }
        case 'flake': {
          const n = [3, 5, 7][v];
          for (let i = 0; i < n; i++) {
            const a = h(i) * Math.PI * 2;
            const r = i === 0 ? 0 : 0.35 + h(i + 9) * 0.55;
            put(
              b.flake,
              Math.cos(a) * r,
              0,
              Math.sin(a) * r,
              1.25 + h(i + 17) * 0.7,
              h(i + 21) * 3,
              0,
              0,
              pick(FLAKE, ci + i),
            );
          }
          break;
        }
      }
    },
    commit() {
      for (const x of batches) x.commit();
    },
    setGust(strength, dir, time) {
      const k = strength > 0 ? Math.min(1, strength) * (dir < 0 ? -1 : dir > 0 ? 1 : 0) : 0;
      if (k === 0 && swayed === 0) return;
      for (const batch of loose) {
        const flake = batch === b.flake;
        for (let i = 0; i < batch.count; i++) {
          const o = i * 7;
          const x = batch.pose[o];
          const z = batch.pose[o + 2];
          // Each prop has its own phase; flakes slide further and flutter, bags only nudge.
          const ph = x * 1.7 + z * 0.9;
          const wob = 0.5 + 0.5 * Math.sin(time * (flake ? 7 : 4) + ph);
          const slide = k * (flake ? 0.38 : 0.12) * (0.6 + 0.4 * wob);
          const s = batch.pose[o + 3];
          writeTRS(
            batch.m,
            i * 16,
            x + slide,
            batch.pose[o + 1] + (flake ? Math.abs(k) * 0.05 * wob : 0),
            z,
            s,
            s,
            s,
            batch.pose[o + 4] + k * (flake ? 0.5 : 0.06) * wob,
            batch.pose[o + 5],
            batch.pose[o + 6] + (flake ? k * 0.25 * wob : k * 0.03),
          );
        }
        if (batch.count > 0) batch.mesh.thinInstanceBufferUpdated('matrix');
      }
      swayed = k;
    },
    dispose() {
      for (const x of batches) look.removeShadowCaster(x.mesh);
      root.dispose();
    },
  };
  (kit as FreezerPropKit & { root: TransformNode }).root = root;
  return kit;
}

// ---------- preview ----------

export function preview(scene: Scene, look: Look, opts: PreviewOptions): PreviewResult {
  const kit = createFreezerPropKit(scene, look) as FreezerPropKit & { root: TransformNode };
  const oldTheme = look.theme;
  look.setTheme('freezer');
  kit.begin();
  if (opts.variant && (FREEZER_KINDS as readonly string[]).includes(opts.variant)) {
    const kind = opts.variant as FreezerPropKind;
    const n = FREEZER_VARIANTS[kind];
    const step = FREEZER_RADIUS[kind] * 2.2;
    for (let i = 0; i < n; i++) kit.add(kind, i, (i - (n - 1) / 2) * step, 0, 0.35, 1, i);
  } else if (opts.variant === 'scatter' || opts.variant === 'gust') {
    let s = 98765;
    const rand = (): number => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < 60; i++) {
      const kind = FREEZER_KINDS[Math.floor(rand() * FREEZER_KINDS.length)];
      const side = i % 2 === 0 ? -1 : 1;
      kit.add(
        kind,
        Math.floor(rand() * 3),
        side * (7 + rand() * 12),
        -30 + rand() * 60,
        rand() * 6.28,
        0.9 + rand() * 0.2,
        i,
      );
    }
  } else {
    const P = Math.PI;
    kit.add('peas', 0, -4.2, -2.4, 0.2, 1, 0);
    kit.add('fishbox', 1, -0.6, -2.6, -0.15, 1, 0);
    kit.add('tub', 2, 3.4, -2.6, 0, 1, 0);
    kit.add('tub', 1, 5.2, -0.4, 0.4, 1, 2);
    kit.add('cube', 2, -5.0, 0.6, 0.3, 1, 0);
    kit.add('cube', 1, -3.0, 0.8, 1.1, 1, 0);
    kit.add('popsicle', 0, -0.8, 0.6, P * 0.6, 1, 0);
    kit.add('popsicle', 1, 1.3, 0.8, P * 0.4, 1, 2);
    kit.add('popsicle', 2, 3.0, 2.4, P * 0.2, 1, 4);
    kit.add('tub', 0, 5.4, 2.6, 0, 1, 4);
    kit.add('flake', 2, -4.4, 3.4, 0, 1, 0);
    kit.add('flake', 1, -1.5, 3.3, 0, 1, 1);
    kit.add('peas', 1, 0.8, -5.6, 1.4, 1, 0);
    kit.add('cube', 0, -4.6, -5.2, 0.2, 1, 0);
  }
  kit.commit();
  return {
    root: kit.root,
    update(time) {
      if (opts.variant === 'gust') kit.setGust(1, 1, time);
    },
    dispose() {
      kit.dispose();
      look.setTheme(oldTheme);
    },
  };
}
