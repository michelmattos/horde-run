// Champion 'drummer' (variant 10): a green plastic toy drummer marching with a big drum.
// A tall shako with a peak and a pompom plume, a tunic with a belt and white-moulded
// cross belts (lighter vertex shade), the left knee lifted mid-march, both arms raised
// with the sticks over a big tenor drum at the hip, its batter head
// tilted up toward the high camera: red plastic shell, cream paper heads, brass hoops and
// a zig-zag of cream tension cords. A brass badge on the shako. On a bevelled oval base.
//
// GAME API (same shape as models/champion.ts)
//   createChampionDrummer(scene, look): ChampionMeshes   synchronous, geometry cached
//   - body: team plastic ('army-plastic'): thin-instance 'color' = LINEAR teamColor(team)
//     x 1.12 like the sarge; greyscale moulding and AO in vertex colours.
//   - trim: the drum, sticks and shako badge in the shared 'toy-mix' material (vertex
//     colours; plastic / paper / brass surfaces). NO 'color' buffer, the body's matrices.
//   - Pivot at the base-plate centre on y = 0, front +Z, 2.75 tall to the plume tip
//     (shako top 2.5), footprint radius ~1 like the sarge: crowd scale = radius / 1.0.
//   - Not pickable, alwaysSelectAsActiveMesh, doNotSyncBoundingInfo, 'crowd' shadow
//     casters and receivers (blob footprint ~1.7 x 2.0 on 'low').
//   Triangles: body ~1,700, trim ~900. AO baked offline (AO_BAKED, aoTable.ts).
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Look } from '../look/index.ts';
import {
  MIX,
  aoChecksum,
  armyPlasticMaterial,
  bakeAOFactors,
  bakedParts,
  buildMesh,
  cloneVD,
  encodeAO,
  fixWinding,
  lathe,
  lin,
  mergeParts,
  mixUv,
  mixedToyMaterial,
  paint,
  place,
} from '../look/index.ts';
import type { MixSlot } from '../look/index.ts';
import type { ModelInfo, PreviewOptions, PreviewResult } from '../look/model.ts';
import type { ChampionMeshes, V3 } from './champion.ts';
import { frame, grey, greyByProfile, limb, pillow, scale3, sphere } from './champion.ts';
import { star } from './cannon.ts';
import { championPreview } from './championTank.ts';

export const info: ModelInfo = {
  key: 'championDrummer',
  title: 'Champion: toy drummer with a big drum',
  instanced: true,
  teams: true,
  side: 'team',
  height: 2.75,
  triangleBudget: 2800,
  gameZ: 15,
};

const HI = { hi: true };
const G = {
  tunic: 0.93,
  trousers: 0.86,
  belt: 1.0,
  boot: 0.76,
  face: 1.0,
  shako: 0.84,
  peak: 0.7,
  plume: 1.0,
  base: 0.86,
};

// Joints (x right, y up, z forward).
const J = {
  hipL: [-0.2, 1.08, 0.0] as V3,
  kneeL: [-0.22, 0.78, 0.3] as V3, // lifted mid-march
  ankleL: [-0.22, 0.42, 0.18] as V3,
  hipR: [0.2, 1.08, -0.02] as V3,
  kneeR: [0.21, 0.6, -0.02] as V3,
  ankleR: [0.21, 0.18, -0.04] as V3,
  shoulderL: [-0.4, 1.86, 0.0] as V3,
  shoulderR: [0.4, 1.86, 0.0] as V3,
  elbowL: [-0.56, 1.58, 0.2] as V3,
  elbowR: [0.56, 1.6, 0.18] as V3,
  handL: [-0.32, 1.66, 0.5] as V3,
  handR: [0.32, 1.7, 0.48] as V3,
};
const HEAD: V3 = [0, 2.14, 0.03];
// The drum: centre, radius, depth; tilted so its top head faces up and a bit to the camera.
const DRUM = { y: 1.12, z: 0.56, r: 0.46, depth: 0.42, tilt: -0.32 };

function body(): VertexData {
  const p: VertexData[] = [];
  // Base plate.
  p.push(
    grey(
      place(
        scale3(
          lathe(
            [
              [0.95, 0],
              [0.975, 0.05],
              [0.9, 0.112],
              [0, 0.115],
            ],
            22,
          ),
          0.84,
          1,
          1,
        ),
        { z: 0.05 },
      ),
      G.base,
    ),
  );
  // Legs: the right planted, the left knee lifted; boots.
  p.push(grey(limb(J.hipL, J.kneeL, 0.19, 0.15, 7, HI), G.trousers));
  p.push(grey(limb(J.kneeL, J.ankleL, 0.15, 0.13, 7, HI), G.trousers));
  p.push(grey(limb(J.hipR, J.kneeR, 0.19, 0.15, 7, HI), G.trousers));
  p.push(grey(limb(J.kneeR, J.ankleR, 0.15, 0.13, 7, HI), G.trousers));
  p.push(grey(sphere(J.kneeL, 0.16, 6, 3), G.trousers));
  p.push(grey(sphere(J.kneeR, 0.16, 6, 3), G.trousers));
  p.push(grey(pillow(0.24, 0.22, 0.44, { x: J.ankleR[0], y: 0.2, z: 0.06 }, 0.35, 8), G.boot));
  p.push(grey(pillow(0.24, 0.22, 0.42, { x: J.ankleL[0], y: 0.4, z: 0.28, rx: 0.35 }, 0.35, 8), G.boot));
  // Tunic: an elliptical lathe from the skirt flare at the hips to the shoulders.
  const tunic = lathe(
    [
      [0, 0.9],
      [0.37, 0.92],
      [0.36, 1.06],
      [0.33, 1.2],
      [0.35, 1.45],
      [0.4, 1.7],
      [0.37, 1.86],
      [0.22, 1.98],
      [0, 2.0],
    ],
    12,
  );
  greyByProfile(tunic, [G.tunic, G.tunic, G.tunic, G.belt, G.tunic, G.tunic, G.tunic, G.tunic, G.tunic]);
  p.push(place(scale3(tunic, 1.15, 1, 0.72), { z: -0.02 }));
  // Cross belts (moulded lighter): an X over the chest, one across the back.
  const strapBetween = (a: V3, b: V3, g: number): void => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const vd = pillow(0.11, L, 0.05, { y: L / 2 }, 0.3);
    vd.transform(frame(a, b, [0, 0, a[2] > 0 ? 1 : -1]));
    p.push(grey(vd, g));
  };
  strapBetween([-0.3, 1.24, 0.27], [0.3, 1.86, 0.2], G.belt);
  strapBetween([0.3, 1.24, 0.27], [-0.3, 1.86, 0.2], G.belt);
  strapBetween([-0.3, 1.24, -0.25], [0.3, 1.86, -0.2], G.belt);
  // Epaulettes.
  for (const s of [-1, 1]) p.push(grey(sphere([s * 0.42, 1.9, 0], 0.15, 8, 4, [1, 0.6, 1]), G.tunic));
  // Arms raised, hands holding the sticks over the drum.
  p.push(grey(limb(J.shoulderL, J.elbowL, 0.14, 0.12, 7, HI), G.tunic));
  p.push(grey(limb(J.elbowL, J.handL, 0.12, 0.1, 7, HI), G.tunic));
  p.push(grey(limb(J.shoulderR, J.elbowR, 0.14, 0.12, 7, HI), G.tunic));
  p.push(grey(limb(J.elbowR, J.handR, 0.12, 0.1, 7, HI), G.tunic));
  p.push(grey(sphere(J.elbowL, 0.125, 6, 3), G.tunic));
  p.push(grey(sphere(J.elbowR, 0.125, 6, 3), G.tunic));
  p.push(grey(sphere(J.handL, 0.1, 6, 3, [1, 0.9, 1.2]), G.face));
  p.push(grey(sphere(J.handR, 0.1, 6, 3, [1, 0.9, 1.2]), G.face));
  // Head with a chin strap line under the shako.
  p.push(grey(sphere(HEAD, 0.21, 10, 5, [0.92, 1, 1]), G.face));
  const nose = lathe(
    [
      [0, 0],
      [0.05, 0],
      [0, 0.09],
    ],
    4,
  );
  p.push(grey(place(nose, { rx: Math.PI / 2 + 0.3, x: 0, y: HEAD[1] - 0.04, z: HEAD[2] + 0.18 }), G.face));
  // Shako: a flaring drum of a hat with a peak and a pompom plume on top.
  const shako = lathe(
    [
      [0.2, -0.02],
      [0.215, 0.0],
      [0.235, 0.3],
      [0.245, 0.33],
      [0.2, 0.35],
      [0, 0.355],
    ],
    14,
  );
  greyByProfile(shako, [G.peak, G.shako, G.shako, G.peak, G.shako, G.shako]);
  p.push(place(shako, { x: HEAD[0], y: HEAD[1] + 0.1, z: HEAD[2] - 0.02, rx: -0.06 }));
  p.push(
    grey(
      place(
        scale3(
          lathe(
            [
              [0.0, 0],
              [0.2, 0],
              [0.17, 0.03],
              [0, 0.035],
            ],
            10,
          ),
          1,
          1,
          0.7,
        ),
        { x: HEAD[0], y: HEAD[1] + 0.11, z: HEAD[2] + 0.12, rx: 0.25 },
      ),
      G.peak,
    ),
  );
  p.push(grey(sphere([HEAD[0], HEAD[1] + 0.6, HEAD[2] - 0.05], 0.11, 8, 4, [1, 1.3, 1]), G.plume));
  return fixWinding(mergeParts(p));
}

function part(vd: VertexData, color: string, slot: MixSlot): VertexData {
  vd.uvs = null;
  return mixUv(paint(vd, lin(color)), slot);
}

function trim(): VertexData {
  const p: VertexData[] = [];
  const { r, depth: d } = DRUM;
  const hd = d / 2;
  const drum: VertexData[] = [];
  // Shell (red plastic), heads (cream paper), hoops (brass), all built around +Y.
  drum.push(
    part(
      lathe(
        [
          [r, -hd + 0.03],
          [r + 0.012, -hd * 0.5],
          [r + 0.012, hd * 0.5],
          [r, hd - 0.03],
        ],
        20,
      ),
      '#c8352b',
      MIX.plastic,
    ),
  );
  for (const s of [-1, 1]) {
    const y = s * (hd - 0.01);
    drum.push(
      part(
        lathe(
          s > 0
            ? [
                [r - 0.02, y - 0.03],
                [r + 0.035, y - 0.03],
                [r + 0.04, y],
                [r + 0.03, y + 0.025],
                [r - 0.02, y + 0.025],
              ]
            : [
                [r - 0.02, y - 0.025],
                [r + 0.03, y - 0.025],
                [r + 0.04, y],
                [r + 0.035, y + 0.03],
                [r - 0.02, y + 0.03],
              ],
          20,
        ),
        'brass',
        MIX.brass,
      ),
    );
    drum.push(
      part(
        lathe(
          s > 0
            ? [
                [r - 0.02, y + 0.012],
                [r * 0.6, y + 0.016],
                [0, y + 0.018],
              ]
            : [
                [0, y - 0.018],
                [r * 0.6, y - 0.016],
                [r - 0.02, y - 0.012],
              ],
          20,
        ),
        '#efe3c6',
        MIX.paper,
      ),
    );
  }
  // Zig-zag tension cords round the shell.
  const n = 10;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 0.5) / n) * Math.PI * 2;
    const rr = r + 0.022;
    const top: V3 = [Math.cos(a0) * rr, hd - 0.04, Math.sin(a0) * rr];
    const bot: V3 = [Math.cos(a1) * rr, -hd + 0.04, Math.sin(a1) * rr];
    const L = Math.hypot(top[0] - bot[0], top[1] - bot[1], top[2] - bot[2]);
    const cord = lathe(
      [
        [0.012, 0],
        [0.012, L],
      ],
      4,
    );
    cord.transform(frame(bot, top));
    drum.push(part(cord, '#efe3c6', MIX.paper));
  }
  for (const vd of drum) p.push(place(vd, { rx: DRUM.tilt, y: DRUM.y, z: DRUM.z }));
  // Sticks from the hands down to the batter head, light wood with round tips.
  const head = (x: number): V3 => [x, DRUM.y + hd * Math.cos(DRUM.tilt) + 0.07, DRUM.z - hd * Math.sin(DRUM.tilt) * -1];
  for (const [h, t] of [
    [J.handL, head(-0.14)],
    [J.handR, head(0.16)],
  ] as const) {
    const back: V3 = [h[0] - (t[0] - h[0]) * 0.25, h[1] - (t[1] - h[1]) * 0.25, h[2] - (t[2] - h[2]) * 0.25];
    const L = Math.hypot(t[0] - back[0], t[1] - back[1], t[2] - back[2]);
    const stick = lathe(
      [
        [0, -0.02],
        [0.026, 0],
        [0.022, L * 0.9],
        [0.034, L * 0.96],
        [0, L + 0.02],
      ],
      6,
    );
    stick.transform(frame(back, t));
    p.push(part(stick, 'oakLight', MIX.plastic));
  }
  // Brass badge on the shako front.
  const badge = star(0.1, 0.045, 0.02);
  p.push(
    part(
      place(badge, { rx: Math.PI / 2 - 0.06, x: HEAD[0], y: HEAD[1] + 0.3, z: HEAD[2] + 0.235 }),
      'brass',
      MIX.brass,
    ),
  );
  return mergeParts(p);
}

// ---------- AO, cache, meshes ----------
const AO_OPTS = { samples: 16, maxDist: 0.5, strength: 0.65, maxTriangles: 8000 };
const AO_BAKED: Record<'body' | 'trim', string> = {
  body: 'MLrulzC67pdBy/+XQcv/lzDL/5cwy/+XQbr/l1K6/5dSqf+XQanulzC6/5cwuv+XQbr/l0Gp/5dBqf+XQZf/lzCp/5cwuv+XMLr/lzDL/5cwuv+XUrr/lzC67pdBHwCXywANAAAAAAAAAAAAAAANAADuywANl9wAAABSAABSHwBkAAB1HwBBHwCXywAAH3V1MAAAAACXdQAAAADuqQAAAADuqQAAde4AAAAAde4AAAAAUtwAAAAAH3V1MAAfDQDu3ABBDQD/3ABBDQD/ugBkQQDcywBkAACXhgBBAACpqQAfAADuugAfDQDu3AAAy+6GDQAAy/+GHw0AAP+GDQ0AANyGHwAAQZcAAAAAZKkAAAAAqe4AAAAAy+6GDQAAqVIAANx1AAD/MAAA/8sAAAAAAAAAAAAAqVIAAAAAAAC6AAAAlwAAAJcAAADLAAAAAAAAAAAAAAAAUgAAAAAAZLrcAAAAZNzLAAAAUpepAAANQXWGAAANZJcAAAANQcsAAAAAUssAAAAAUgAAAA0fdQAAAA0Ndbq6AA0AddzLAA0AhtzcAA1Bqdy6AA1Sy9wAAA1S3AAAAA1SlwAAAA0fdQAAAHXc/+7cAAC6AIa6upepAACpAIYAQVJBZNyGAIYAhnUNy/8AAIYAAEFSdcuXAIa6AKmpAACpAJfu/+7/AADcAJf////u/+7LAJfu7svc///cAIb////u///cAHX////////LAHXL///////LAHXc/+7cAAC6AAANZIbLywAAdcvLywAwdQ2GywAAAB91ywANZIbLyw0Ahsvclw0NUobLlw0AAB9klw1BdR91lw0Ahsvcl9z//7ru3Nzc3O7c3NypHw0A3NzuqQ0A3Nz//7ru3AAAQZfLAAB1y9wAAMvu3AAA7u7cAAD//+4AAP//7gB17u7cAEENutwAAEGXywAA/+7cAADu7ssAALrcywAAdbrLAABShssAQR+6ywB17v/cAAD//9wAAP/u3AAfQQAAAAANUnWXAADL7u7LAAAA7v/uAAAAAP//AAAAAAAAAABShgAAAAAfQQAAAAAAAHWXAAC6dQAAAADc3GSGAAD//+66AADu////AAAAAP//AAAAAKnuAAAAAHWXAAAAAP/uAADc///cAAANH6mpAAAwdR+GAAAwMAAAAACpywAAAAAAAP/cAAAAAP/uAADu///LAADu7rqpAADLlx9kAACpQUGpAAAAAHXLAAAAANzuAADc7v/uAADu///LAHUfAACXAAAA3O7uANz//wDL7gAAl3UAAHUfAADc//8Ay+7uAJcAAACGQQAAqXUAAMvuAADc//8AAHXc3ACG//8Auv/uAAAA3AAAALoAMGTLAHXc3AAAAP8Ay///AJf/7gB13O4AMHXcAAAA3AAAAP9SQanLAABBH8u6AABSZNxkAABkddyGAABSH8upAABSH7q6AABSQcupAABBMNx1AABkMMt1AABkH8uGAABSQanLAAAAANwAAIYAAMsAUu4AANy63P//3DCp3P//3DCXAP//3DCGAO7/7h9kAO7/7h+XAP//3B/c7v//3B/L7v//3B+67v//7h/L7v//7h/L////3B/L////7h/L////3B+63P//7jC63P//3DAAZKkAAJfcAACGywAAhu4AAJfLAAB1qQAAAAAAAAAAAAAAAAAAAAAAAGSpAABS7v//AFLu//8AUu7//wBk7v//AGTu//8NUv///wB1////AGT///8AUu7//w==',
  trim: 'AO7uAADc/wAA/9wAAO7/AAD/3AAA7v8AAP/cAADc/wAA/9wAANz/AADu7gAA3P8AAO7LAAAAAAAAAAAAAEEAAAAfAAAAhlIAANzcAADL/wAA7u4A////yx////+6MP///8sw////ujD///+pH////7ow////uh/////LDf///8sw////ujD////LMO7u/8sNy9zulw0AAAAAAAAAAAAAhpeGDQ26hkEADcu6l1If7v/ulw3///+pMP///8sf7v9k7v917v917v9k7v917v9k7v9S7v9k7v9k7v9k7v9k7txS7txB7gAA7qkA7stS7u5k7v9B7v9k7v9k7v9kMMv/qYYwuv/ulzC6/+7cH7r//+4fuv//7h/L////H8v//+4wy///3A3L/+7LH8v/3Mswy+6phjC67peGH6ncdVINAABBAAAAAEFSAAAAMFIAAABSZB8AAEEAH6nuZGQwuu6XdTDL/6mGH3WXH5eXQcuXUsuXZO6XZNyXQcuXUtyXQbqXMIaXDWSXDWSXDVKXAA2XHw2XHx+XQTCXAB+XHx+XMKmXH3WXAP+XAAAAAHUA/wDu7gANAABBAO4Al/8AhgAAAACXDTAA/8sAAAANMAANANz/AFIAAA0AAAB1AP+GAAAAAAAAQQD/AAAAAAAAAAAAAGQAAACpAAAAAAAAAKkA/wBSAA0AAHX/AO4AhpdSugAwMADLAEEwANwAUh8A/wBSHwD/y3VkMO4AhpdS3ABBMADLAFINAMsAHwAN7rqGUjD/7qlkMP91Uh8A3ABBMAD//////////////5epl5eXqZeG3Lqp3Lrcy5fLqZe6l7q6qe7cl8up3MupupdShsu6upc=',
};
const AO_CHECK: Record<'body' | 'trim', number> = { body: 9676206, trim: 5246333 };

let cached: { body: VertexData; trim: VertexData } | null = null;

function geometry(): { body: VertexData; trim: VertexData } {
  if (!cached) {
    const [b, t] = bakedParts(
      'championDrummer',
      [body(), trim()],
      [
        { b64: AO_BAKED.body, check: AO_CHECK.body },
        { b64: AO_BAKED.trim, check: AO_CHECK.trim },
      ],
      AO_OPTS,
    );
    cached = { body: cloneVD(b), trim: cloneVD(t) };
  }
  return cached;
}

// Tool: recomputes AO_BAKED / AO_CHECK (run through vite's ssrLoadModule).
export function championDrummerAOTable(): {
  baked: Record<'body' | 'trim', string>;
  check: Record<'body' | 'trim', number>;
} {
  const parts = [body(), trim()];
  const f = bakeAOFactors(parts, AO_OPTS);
  return {
    baked: { body: encodeAO(f[0]), trim: encodeAO(f[1]) },
    check: {
      body: aoChecksum(parts[0].positions as number[]),
      trim: aoChecksum(parts[1].positions as number[]),
    },
  };
}

function setup(mesh: Mesh, look: Look): Mesh {
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.doNotSyncBoundingInfo = true;
  look.addShadowCaster(mesh, 'crowd');
  look.receiveShadows(mesh);
  return mesh;
}

export function createChampionDrummer(scene: Scene, look: Look): ChampionMeshes {
  const g = geometry();
  const plastic = look.material('army-plastic', () => armyPlasticMaterial(scene));
  const mix = look.material('toy-mix', () => mixedToyMaterial(scene));
  return {
    body: setup(buildMesh(scene, 'championDrummerBody', cloneVD(g.body), plastic), look),
    trim: setup(buildMesh(scene, 'championDrummerTrim', cloneVD(g.trim), mix), look),
  };
}

export function preview(scene: Scene, look: Look, opts: PreviewOptions): PreviewResult {
  return championPreview(scene, opts, createChampionDrummer(scene, look), 'championDrummerRoot');
}
