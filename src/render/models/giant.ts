// The Giant (World 2 mob item, variant 4): a big green plastic army man, the classic
// rifleman (models/soldier.ts) moulded at ~2.6x scale, with a backpack platform: a ribbed
// deck on two struts behind his shoulders, a low rail round it, and three little army men
// riding on it (the squad that jumps off and fights on when he falls; the sim releases
// them as single mobs, the 'giantFell' event). Seen from behind and above in the game, so
// the deck and the riders are what the camera reads first.
//
// One mesh in the shared 'army-plastic' material, team colour per instance (LINEAR
// teamColor), greyscale moulding and baked AO in vertex colours (offline table; a stale
// one bakes at runtime once).
//
// GAME API
//   createGiantMesh(scene, look): Mesh
//     Synchronous, geometry cached. Thin-instance ready ('matrix' + 'color'), not pickable,
//     alwaysSelectAsActiveMesh, doNotSyncBoundingInfo, 'crowd' shadow caster and receiver.
//     Pivot at the base-plate centre on y = 0, front +Z; authored for collision radius
//     GIANT_RADIUS (crowdLogic.ts, 0.8): scale r / 0.8. Player unit: yaw 0.
//   GIANT_HEIGHT = 3.4 (helmet top; the riders' helmets reach ~3.2). Base ~1.2 x 1.45;
//   the deck reaches ~1.15 behind the pivot.
//   Triangles: ~1,800 (<= 2,000).
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Look } from '../look/index.ts';
import {
  aoChecksum,
  armyPlasticMaterial,
  bakeAOFactors,
  bakedParts,
  buildMesh,
  cloneVD,
  encodeAO,
  mergeParts,
  place,
  roundedBox,
} from '../look/index.ts';
import type { ModelInfo, PreviewOptions, PreviewResult } from '../look/model.ts';
import { GIANT_RADIUS, HOP_STYLE } from '../crowdLogic.ts';
import { SOLDIER_HEIGHT, footShade, shade, soldierGeometryRaw, tube } from './soldier.ts';
import type { V3 } from './soldier.ts';
import { crowdMesh, crowdPreview } from './snowman.ts';

export const GIANT_HEIGHT = 3.4;
const K = GIANT_HEIGHT / SOLDIER_HEIGHT; // the rifleman's scale
const RIDER = 0.6; // riders are 0.6 of a mob rifleman (~0.78 tall)

export const info: ModelInfo = {
  key: 'giant',
  title: 'The Giant: a big army man with a riders platform',
  instanced: true,
  teams: true,
  side: 'team',
  height: GIANT_HEIGHT,
  triangleBudget: 2000,
  gameZ: 16,
};

// Deck (platform) frame, in giant space: behind the shoulders.
const DECK_Y = 2.33; // deck top
const DECK_Z0 = -0.42; // front edge (against the pack)
const DECK_Z1 = -1.12; // back edge
const DECK_W = 1.2;
const S = { deck: 0.8, rib: 0.9, rail: 0.86, strut: 0.76 };

function box(w: number, h: number, d: number, r: number, g: number, t: Parameters<typeof place>[1], seg = 1) {
  const vd = roundedBox(w, h, d, r, seg);
  vd.uvs = null;
  return shade(place(vd, t), g);
}

function rod(a: V3, b: V3, r: number, g: number, sides = 5): VertexData {
  return shade(
    tube(
      [
        { p: a, a: r },
        { p: b, a: r },
      ],
      sides,
      [1, 0, 0],
      0.5,
      0.5,
    ),
    g,
  );
}

function platform(): VertexData[] {
  const p: VertexData[] = [];
  const zc = (DECK_Z0 + DECK_Z1) / 2;
  const depth = DECK_Z0 - DECK_Z1;
  p.push(box(DECK_W, 0.09, depth, 0.035, S.deck, { y: DECK_Y - 0.045, z: zc }));
  // Moulded ribs across the deck (they catch the light from the camera behind).
  for (const k of [0.25, 0.5, 0.75])
    p.push(box(DECK_W - 0.08, 0.025, 0.05, 0.012, S.rib, { y: DECK_Y + 0.008, z: DECK_Z0 - depth * k }, 0));
  // Low rail round the back and sides: four posts, a top rail.
  const ry = DECK_Y + 0.26;
  const xs = DECK_W / 2 - 0.05;
  const zb = DECK_Z1 + 0.05;
  const zf = DECK_Z0 - 0.08;
  const corners: V3[] = [
    [-xs, ry, zf],
    [-xs, ry, zb],
    [xs, ry, zb],
    [xs, ry, zf],
  ];
  for (const c of corners) p.push(rod([c[0], DECK_Y, c[2]], c, 0.032, S.rail, 4));
  p.push(
    shade(
      tube(
        corners.map((c) => ({ p: c, a: 0.03 })),
        4,
        [0, 1, 0],
        0.6,
        0.6,
      ),
      S.rail,
    ),
  );
  // Two struts from the pack up under the deck, and a cross bar.
  for (const s of [-1, 1]) p.push(rod([s * 0.2, 1.78, -0.42], [s * 0.36, DECK_Y - 0.08, -0.95], 0.05, S.strut));
  p.push(rod([-0.38, DECK_Y - 0.1, -0.9], [0.38, DECK_Y - 0.1, -0.9], 0.04, S.strut, 4));
  return p;
}

function geometryRaw(): VertexData {
  const parts: VertexData[] = [];
  const body = soldierGeometryRaw('full');
  parts.push(place(body, { s: K }));
  parts.push(...platform());
  // Three riders on the deck: two at the front corners looking ahead past his helmet, one
  // at the back rail turned to keep watch.
  const riders: Parameters<typeof place>[1][] = [
    { x: -0.34, y: DECK_Y, z: -0.62, ry: 0.25 },
    { x: 0.33, y: DECK_Y, z: -0.66, ry: -0.2 },
    { x: 0.02, y: DECK_Y, z: -0.94, ry: 0.5 },
  ];
  for (const t of riders) parts.push(place(soldierGeometryRaw('lite'), { ...t, s: RIDER }));
  return mergeParts(parts);
}

// ---------- AO, cache, mesh ----------
const AO_OPTS = { samples: 20, maxDist: 0.9, strength: 0.6, maxTriangles: 4000 };
const AO_BAKED = {
  giant:
    'jIyMjH+MjIyMjIx/f3+MjLKysrLZprKysrKysvKmsrK/zL/l8gCMmczMsr/MWYy/pnNZsowzDYzMzIwNAL9/mcy/mTMzf6ZZZgAA8kwAAMzlvxpmv8zMpmamv9m/pkymsrKmmVmMmZmMjEDlmQAAstnMsnNmpr/MpmaZpr+yfyaZsr+ZWTOMv78NAP/MAADlAKby8tka5bLM8gAA8pnMMzMAMxoAAFnZ5QAzJgAAv+XZpmZ/mZmysqYAv79ZpgAAANn/QGby/4zl//////9z/9kAAED/8mYAprLy5UwmMwDyzIx/pv//zFkAzPKZAABZ5f+yZiZz//LyWTOMAP//AIymTAC/8v+/ZgAATNnl5dm/AACyv6aZpswAAL9mQEwzzAAApqZ/jH9zAA1mQAAAAAAAANl/mVmMsplzZhpMfwAAAAAAADMzQEAaGhpAWVlMTH+ZpqZ/f2ZzTDNmc/Ly8vLZ8vLyZr+M8vLy8v/M8vLyzOW/8v/////l////2fLZ///////////////////////y////5f///+XZ5eXl/////////+Xy///y8uXl5f/y5fLlAADl8n+y5eWMv+X///////////LMv//yjJnZ8oyZ2eWZsuXlmabl5Yy/5f/////////////////y5fJAzCamJtkaptnMpqYmQBomGiampiZA2cxAvzO/JtkmzNm/zL8mQCYzJjPMvyZA2b8zzDO/Jswm2czM2b8mMyYzJjPZvyYzzMwNAL8AZgD/sgAADcy/DQD//wAAAL/MDQ3//wAAAAC/AA0A/wBmvwAAsgAAAP9mAP/yWQD/vwAAAAAATMzZmQAAv7IADWYAzNmZDQAAzH8AAGYAAGYAAABmAACMf1lMM0BmAIwAAEB/pnNzmcy/pn+ymVm/MxpzskANc0yymVlZc1kaDaZMAADMAEyysnNzZn9/fwANjJlAf4xzM3OmAH+yjABzGllZsn9ZjIyysmZMADNzJkym2fK/QPK/AHOyjDNmjABmAHOZAKbyWQCy8n8zf2Ymc4wAjKaypgAAzMz/5RomQIxzWX9zTExAZoxmTFkNDQANAABzQEBmc4xmc5lmZqbyzMy/zJmZsv//8szlv7/Z////8vJZZkBAAFkAf1lZpqZzM3OmjL+ZpqZ/fzMmWUwNGlkm5X9MWYxZDSZ/WQ0Acw2Mf3NMZmZZTNkAAKamWVmZjFlZvwCZjH8Af0x/QHNzZtmmjH9MfwCymUBZmfLMf1mysgBz5YwzpuUAWQC/jACMpmYAjH9mTIxZf4x/AKamjHMNANny5aYmJjOMZjNMc4x/ZkBMTH9/DQ0AABoaf3NZWUxmf3/yzHNzpr+/5f/lmZnM2fLy/9m/v9ny///yfzNZAEBzWYzMjL/MmWaMstmymbKZjJkzM5mMACZzWb+yf8ymcxom8lkAAIwNc4xzjFlmQHOZABrMsllmjMxAc9kAmb9ZAFkzc1l/c1mypr+MWXMAmaZAWbLlzH9ZzLIAZvKmGn+/AFkAc4wApvJmAHN/jDOMc4yMjACZv79/AADM//+/GjNMpn9Mf3Nmc1lAc2Z/fw0NAA0NAH9/WXNzf5l/zLJ/c7LZ5dnyzLKmzP/////lsr/M/////w==',
};
const AO_CHECK = { giant: 15821085 };

let cached: VertexData | null = null;

function geometry(): VertexData {
  if (!cached) {
    const [g] = bakedParts('giant', [geometryRaw()], [{ b64: AO_BAKED.giant, check: AO_CHECK.giant }], AO_OPTS);
    footShade(g);
    g.uvs = null;
    cached = cloneVD(g);
  }
  return cached;
}

// Tool: recomputes AO_BAKED / AO_CHECK (run through vite's ssrLoadModule).
export function giantAOTable(): { baked: Record<'giant', string>; check: Record<'giant', number> } {
  const raw = geometryRaw();
  const [f] = bakeAOFactors([raw], AO_OPTS);
  return { baked: { giant: encodeAO(f) }, check: { giant: aoChecksum(raw.positions as number[]) } };
}

export function giantTriangles(): number {
  return (geometry().indices as ArrayLike<number>).length / 3;
}

export function createGiantMesh(scene: Scene, look: Look): Mesh {
  const plastic = look.material('army-plastic', () => armyPlasticMaterial(scene));
  return crowdMesh(buildMesh(scene, 'giant', cloneVD(geometry()), plastic), look);
}

// ---------- preview ----------
// Two Giants stomping up the lane among a few riflemen-sized gaps, and one of the other
// army facing them.
export function preview(scene: Scene, look: Look, opts: PreviewOptions): PreviewResult {
  const mesh = createGiantMesh(scene, look);
  const s = 0.8 / GIANT_RADIUS;
  return crowdPreview(
    scene,
    'giantRoot',
    [{ mesh, team: true }],
    [
      { x: -1.1, z: 0, yaw: -0.7, s, frost: 0 },
      { x: 1.2, z: -0.6, yaw: -0.7, s, frost: 0 },
    ],
    HOP_STYLE.giant,
    0.11,
    opts.team,
  );
}
