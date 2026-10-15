// Blizzard ultimate (World 2): the pieces its sweep shows in battle. ultimates.ts animates
// them (pooled, thin-instanced) on the 'ultimate' cue with id 'blizzard'.
//
//   flake    - a toy paper-cut snowflake: a six-armed crystal plate with side branches,
//              a little thickness so it reads edge-on as it tumbles. Thin-instanced.
//   frost    - a frost sheet: a flat decal of ice-crystal plates (cool blue, brighter
//              crystal edges, soft border) that fades in over the frozen enemy crowd.
//              Procedural texture (RawTexture, no render target).
//   sparkle  - an ice glint: a tiny elongated octahedron that twinkles over the frost.
//              Thin-instanced.
// Flakes and sparkles are self-lit pale ice (they are weather / glints, not toys), the
// frost sheet is unlit and alpha blended; none of them casts shadows.
//
// GAME API
//   createFlakeMesh(scene, look): Mesh       unit size (~0.5 across), pivot at its centre,
//                                             plate in XY (faces +Z); 'matrix' buffer only.
//   createSparkleMesh(scene, look): Mesh     ~0.5 tall, centred; 'matrix' buffer only.
//   createFrostSheet(scene): Mesh            unit quad in XZ at y ~0.02, centred: scale x/z
//                                             to the area; fade with setFrostAlpha().
//   setFrostAlpha(mesh, a)                    0..1 (hides the mesh at 0).
// Draw calls while the sweep runs: 3 (flakes, sparkles, frost).
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Look } from '../look/index.ts';
import { buildMesh, fixWinding, mergeParts, place, srgb } from '../look/index.ts';
import type { ModelInfo, PreviewOptions, PreviewResult } from '../look/model.ts';
import { mulberry32, writeTRS } from '../fxLogic.ts';

export const info: ModelInfo = {
  key: 'blizzard',
  title: 'Blizzard: snowflakes, frost sheet, ice sparkles',
  instanced: true,
  teams: false,
  side: 'neutral',
  height: 3,
  triangleBudget: 400,
  gameZ: 40,
};

const ICE = '#cfe9f7';

// A flat prism from a closed outline in the XY plane (front and back faces as fans from
// the centre, side walls), thickness t.
function plate(outline: [number, number][], t: number): VertexData {
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  const n = outline.length;
  for (const side of [1, -1]) {
    const c = pos.length / 3;
    pos.push(0, 0, (side * t) / 2);
    nrm.push(0, 0, side);
    for (const [x, y] of outline) {
      pos.push(x, y, (side * t) / 2);
      nrm.push(0, 0, side);
    }
    for (let i = 0; i < n; i++) idx.push(c, c + 1 + i, c + 1 + ((i + 1) % n));
  }
  for (let i = 0; i < n; i++) {
    const [ax, ay] = outline[i];
    const [bx, by] = outline[(i + 1) % n];
    let nx = by - ay;
    let ny = -(bx - ax);
    const l = Math.hypot(nx, ny) || 1;
    nx /= l;
    ny /= l;
    if (nx * (ax + bx) + ny * (ay + by) < 0) {
      nx = -nx;
      ny = -ny;
    }
    const b = pos.length / 3;
    pos.push(ax, ay, t / 2, bx, by, t / 2, bx, by, -t / 2, ax, ay, -t / 2);
    for (let k = 0; k < 4; k++) nrm.push(nx, ny, 0);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const vd = new VertexData();
  vd.positions = pos;
  vd.normals = nrm;
  vd.indices = idx;
  return fixWinding(vd);
}

// Six arms, each a thin spoke with a pair of side branches (one outline).
function flakeGeometry(): VertexData {
  const arms: VertexData[] = [];
  const spoke: [number, number][] = [
    [-0.022, 0],
    [0.022, 0],
    [0.022, 0.12],
    [0.085, 0.17],
    [0.075, 0.19],
    [0.022, 0.155],
    [0.018, 0.25],
    [0, 0.27],
    [-0.018, 0.25],
    [-0.022, 0.155],
    [-0.075, 0.19],
    [-0.085, 0.17],
    [-0.022, 0.12],
  ];
  for (let k = 0; k < 6; k++) arms.push(place(plate(spoke, 0.02), { rz: (k * Math.PI) / 3 }));
  const hex: [number, number][] = [];
  for (let k = 0; k < 6; k++) hex.push([Math.cos((k * Math.PI) / 3) * 0.06, Math.sin((k * Math.PI) / 3) * 0.06]);
  arms.push(plate(hex, 0.03));
  return mergeParts(arms);
}

function sparkleGeometry(): VertexData {
  const pos = [0, 0.26, 0, 0.08, 0, 0, 0, 0, 0.08, -0.08, 0, 0, 0, 0, -0.08, 0, -0.26, 0];
  const idx = [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1, 5, 2, 1, 5, 3, 2, 5, 4, 3, 5, 1, 4];
  const vd = new VertexData();
  vd.positions = pos;
  vd.indices = idx;
  const nrm: number[] = [];
  VertexData.ComputeNormals(pos, idx, nrm);
  vd.normals = nrm;
  return fixWinding(vd);
}

// Self-lit ice for the weather pieces (shared per look).
function iceMaterial(scene: Scene, look: Look): StandardMaterial {
  return look.material('blizzard-ice', () => {
    const m = new StandardMaterial('blizzardIce', scene);
    m.disableLighting = true;
    m.emissiveColor = srgb(ICE);
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    return m;
  });
}

function thin(mesh: Mesh): Mesh {
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.doNotSyncBoundingInfo = true;
  mesh.thinInstanceCount = 0;
  return mesh;
}

export function createFlakeMesh(scene: Scene, look: Look): Mesh {
  return thin(buildMesh(scene, 'blizzardFlakes', flakeGeometry(), iceMaterial(scene, look)));
}

export function createSparkleMesh(scene: Scene, look: Look): Mesh {
  const mesh = buildMesh(scene, 'blizzardSparkles', sparkleGeometry(), null);
  mesh.material = look.material('blizzard-sparkle', () => {
    const m = new StandardMaterial('blizzardSparkle', scene);
    m.disableLighting = true;
    m.emissiveColor = new Color3(1.4, 1.6, 1.8); // above 1: the bloom catches the glints
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    return m;
  });
  return thin(mesh);
}

// Frost texture: ice-crystal plates (a Voronoi pattern) with brighter edges and fine
// feathering, fading out toward the border so the sheet has no hard edge.
const FROST_PX = 256;
function frostTexture(scene: Scene): RawTexture {
  const n = FROST_PX;
  const rand = mulberry32(0xf205);
  const seeds: [number, number][] = [];
  for (let i = 0; i < 46; i++) seeds.push([rand(), rand()]);
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n;
      const v = (y + 0.5) / n;
      let d1 = 9;
      let d2 = 9;
      for (const [sx, sy] of seeds) {
        const d = Math.hypot(u - sx, v - sy);
        if (d < d1) {
          d2 = d1;
          d1 = d;
        } else if (d < d2) d2 = d;
      }
      const edge = Math.max(0, 1 - (d2 - d1) / 0.018); // 1 on a crystal boundary
      const feather = 0.5 + 0.5 * Math.sin(u * 211 + Math.sin(v * 97) * 3) * Math.sin(v * 173 + u * 41);
      const border = Math.min(1, Math.min(u, v, 1 - u, 1 - v) / 0.14);
      const a = (0.32 + 0.45 * edge + 0.06 * feather) * border * border;
      const i = (y * n + x) * 4;
      data[i] = Math.round(200 + 55 * edge);
      data[i + 1] = Math.round(228 + 27 * edge);
      data[i + 2] = 250;
      data[i + 3] = Math.round(Math.min(1, a) * 255);
    }
  }
  const t = RawTexture.CreateRGBATexture(data, n, n, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  t.name = 'blizzard-frost';
  t.hasAlpha = true;
  t.wrapU = Texture.CLAMP_ADDRESSMODE;
  t.wrapV = Texture.CLAMP_ADDRESSMODE;
  return t;
}

export function createFrostSheet(scene: Scene): Mesh {
  const vd = new VertexData();
  const y = 0.02;
  vd.positions = [-0.5, y, -0.5, 0.5, y, -0.5, 0.5, y, 0.5, -0.5, y, 0.5];
  vd.normals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
  vd.uvs = [0, 0, 1, 0, 1, 1, 0, 1];
  vd.indices = [0, 2, 1, 0, 3, 2];
  const mesh = new Mesh('blizzardFrost', scene);
  vd.applyToMesh(mesh);
  mesh.isPickable = false;
  // Its own material: the alpha is animated per sheet.
  const m = new StandardMaterial('blizzardFrostMat', scene);
  const tex = frostTexture(scene);
  m.disableLighting = true;
  m.emissiveTexture = tex;
  m.opacityTexture = tex;
  m.diffuseColor = Color3.Black();
  m.specularColor = Color3.Black();
  m.disableDepthWrite = true;
  m.zOffset = -3; // over the rug and blob shadows without z-fighting
  m.backFaceCulling = false; // a floor decal: only its top is ever seen
  m.alpha = 0;
  mesh.material = m;
  mesh.isVisible = false;
  mesh.onDisposeObservable.addOnce(() => {
    m.dispose();
    tex.dispose();
  });
  return mesh;
}

export function setFrostAlpha(mesh: Mesh, a: number): void {
  const m = mesh.material;
  if (!m) return;
  m.alpha = Math.max(0, Math.min(1, a));
  mesh.isVisible = m.alpha > 0.002;
}

// ---------- preview ----------
// A frost sheet over a patch of lane with flakes blowing across it and sparkles on it.
export function preview(scene: Scene, look: Look, _opts: PreviewOptions): PreviewResult {
  const root = new TransformNode('blizzardRoot', scene);
  const flakes = createFlakeMesh(scene, look);
  const sparkles = createSparkleMesh(scene, look);
  const frost = createFrostSheet(scene);
  for (const m of [flakes, sparkles, frost]) m.parent = root;
  frost.scaling.set(6, 1, 5);
  setFrostAlpha(frost, 0.9);
  const rand = mulberry32(7);
  const F = 60;
  const S = 24;
  const fm = new Float32Array(F * 16);
  const sm = new Float32Array(S * 16);
  const fseed = Array.from({ length: F }, () => [rand(), rand(), rand()]);
  const sseed = Array.from({ length: S }, () => [rand() * 5.4 - 2.7, rand() * 4.4 - 2.2, rand() * 6]);
  const write = (time: number): void => {
    fseed.forEach(([a, b, c], i) => {
      const t = (time * 0.6 + a) % 1;
      writeTRS(
        fm,
        i * 16,
        -4 + t * 8,
        2.6 - t * 2.2 + b * 0.6,
        (c - 0.5) * 4,
        0.7,
        0.7,
        0.7,
        time * 2 + i,
        time * 3 + c * 6,
        a * 6,
      );
    });
    sseed.forEach(([x, z, p], i) => {
      const s = Math.max(0, Math.sin(time * 4 + p)) * 0.9 + 0.1;
      writeTRS(sm, i * 16, x, 0.22, z, s, s, s, p, 0, 0);
    });
  };
  write(0.5);
  flakes.thinInstanceSetBuffer('matrix', fm, 16, false);
  sparkles.thinInstanceSetBuffer('matrix', sm, 16, false);
  return {
    root,
    update(time) {
      write(time);
      flakes.thinInstanceBufferUpdated('matrix');
      sparkles.thinInstanceBufferUpdated('matrix');
    },
    dispose() {
      root.dispose();
    },
  };
}
