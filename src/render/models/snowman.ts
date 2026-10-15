// Enemy snowman soldier (World 2, variant 16): a chunky moulded-plastic toy snowman in
// the tan army's kit. Three packed-snow balls with coal eyes and buttons and a carrot
// nose, twig arms holding a twig rifle at port across the chest, and the tan army's
// gear: an upturned bucket worn as a helmet (its handle is the chin strap), a knitted
// scarf with a tail over the chest, and the army men's oval base plate. Tanky and slow:
// ~1.6 tall on a radius-0.42 footprint (LAYOUT mob is 0.28), so it reads as the heavy
// of the enemy crowd.
//
// Two meshes drawn with the same matrices (one draw call each per pass):
//   snow - the snowman itself in the shared 'toy-mix' material: albedo from LINEAR vertex
//          colours (snow, coal, carrot, twig), surface per part (plastic snow, rubbery
//          coal, matte twig). It takes a thin-instance 'color' buffer too: white (x the
//          crowd's +-4% shade) normally, lerped toward ice blue while frozen.
//   kit  - base plate, bucket helmet and scarf in the shared 'army-plastic' material,
//          coloured per instance with LINEAR teamColor('enemy') (greyscale moulding and
//          AO in vertex colours), so the snowman reads as part of the tan army.
// AO is baked over both together (offline table, see snowmanAOTable()).
//
// GAME API
//   createSnowmanMeshes(scene, look): { snow: Mesh; kit: Mesh }
//     Synchronous, geometry cached per session. Both: thinInstanceSetBuffer('matrix') and
//     ('color', LINEAR) ready, not pickable, alwaysSelectAsActiveMesh, doNotSyncBoundingInfo,
//     'crowd' shadow casters and receivers. Pivot at the base-plate centre on y = 0, front
//     +Z, authored for collision radius SNOWMAN_RADIUS (crowdLogic.ts): scale r / 0.42.
//   Facing: an enemy unit, yaw PI (crowd.ts adds the three-quarter turn).
//   Triangles: snow ~470 + kit ~230 (<= 700 in all).
//
// Helpers shared with models/penguin.ts: mixPart(), ball(), CrowdPreview.
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Color3 } from '@babylonjs/core/Maths/math.color';
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
  lin,
  mergeParts,
  mixUv,
  mixedToyMaterial,
  paint,
  place,
  teamColor,
} from '../look/index.ts';
import type { MixSlot } from '../look/index.ts';
import type { ModelInfo, PreviewOptions, PreviewResult } from '../look/model.ts';
import type { TeamName } from '../look/palette.ts';
import { HOP_STYLE, SNOWMAN_RADIUS, frostColor } from '../crowdLogic.ts';
import type { HopStyle } from '../crowdLogic.ts';
import { writeTRS } from '../fxLogic.ts';
import { limb, sphere } from './champion.ts';
import type { V3 } from './soldier.ts';
import { revolve, scaled, shade, tube } from './soldier.ts';

export const info: ModelInfo = {
  key: 'snowman',
  title: 'Enemy snowman soldier',
  instanced: true,
  teams: false, // enemy only (the kit takes the tan team colour)
  side: 'enemy',
  height: 1.6,
  triangleBudget: 700,
  gameZ: 40,
  variants: ['crowd', 'frozen'],
};

export interface SnowmanMeshes {
  snow: Mesh;
  kit: Mesh;
}

// ---------- shared helpers ----------
// A part of a 'toy-mix' mesh: LINEAR colour (palette key, hex or Color3) and surface slot.
export function mixPart(vd: VertexData, color: string | Color3, slot: MixSlot): VertexData {
  paint(vd, typeof color === 'string' ? lin(color) : color);
  return mixUv(vd, slot);
}

// A ball (sphere of radius r at c, squashed by sy) without UVs or colours.
export function ball(c: V3, r: number, tess: number, rings: number, sy = 1): VertexData {
  const vd = sphere(c, r, tess, rings, [1, sy, 1]);
  vd.uvs = null;
  return vd;
}

// ---------- colours ----------
const C = {
  snow: '#eceff0', // packed snow plastic, a touch cool (never pure white)
  snowShade: '#dfe5ea',
  coal: '#26262a',
  carrot: '#e8742a',
  twig: '#6e4a2c',
  twigDark: '#4e3420',
};
// Greyscale moulding on the team-coloured kit.
const S = { base: 0.92, bucket: 1, rim: 0.86, strap: 0.78, scarf: 0.84, stripe: 1.04 };

// Key points (front +Z). Balls: bottom, middle, head.
const B0: V3 = [0, 0.4, 0];
const B1: V3 = [0, 0.87, 0.015];
const HEAD: V3 = [0, 1.235, 0.03];
const R0 = 0.37;
const R1 = 0.27;
const RH = 0.185;

function snow(): VertexData {
  const p: VertexData[] = [];
  const snowCol = lin(C.snow);
  p.push(mixPart(ball(B0, R0, 10, 5, 0.9), snowCol, MIX.plastic));
  p.push(mixPart(ball(B1, R1, 10, 5, 0.95), snowCol, MIX.plastic));
  p.push(mixPart(ball(HEAD, RH, 8, 5), snowCol, MIX.plastic));
  // Coal eyes and buttons: little lumps pressed into the snow.
  const onBall = (c: V3, r: number, el: number, az: number): V3 => [
    c[0] + r * Math.cos(el) * Math.sin(az),
    c[1] + r * Math.sin(el),
    c[2] + r * Math.cos(el) * Math.cos(az),
  ];
  for (const s of [-1, 1])
    p.push(mixPart(ball(onBall(HEAD, RH * 0.96, 0.3, s * 0.38), 0.03, 4, 2), C.coal, MIX.rubber));
  for (const el of [0.42, 0.05])
    p.push(mixPart(ball(onBall(B1, R1 * 0.97, el, -0.12), 0.034, 4, 2), C.coal, MIX.rubber));
  p.push(mixPart(ball(onBall(B0, R0 * 0.94, 0.42, 0.05), 0.04, 4, 2), C.coal, MIX.rubber));
  // Carrot nose, a little crooked.
  p.push(
    mixPart(
      tube(
        [
          { p: [0, HEAD[1] - 0.005, HEAD[2] + RH * 0.9], a: 0.042 },
          { p: [0.01, HEAD[1] - 0.02, HEAD[2] + RH + 0.09], a: 0.026 },
          { p: [0.025, HEAD[1] - 0.035, HEAD[2] + RH + 0.19], a: 0.006 },
        ],
        6,
        [1, 0, 0],
        0,
        0.3,
      ),
      C.carrot,
      MIX.plastic,
    ),
  );
  // Twig arms out of the middle ball to the rifle, a twig finger spur at each hand.
  const handR: V3 = [0.17, 0.74, 0.34];
  const handL: V3 = [-0.12, 0.98, 0.36];
  const arm = (a: V3, j: V3, b: V3): void => {
    p.push(
      mixPart(
        tube(
          [
            { p: a, a: 0.034 },
            { p: j, a: 0.028 },
            { p: b, a: 0.022 },
          ],
          5,
          [0, 1, 0],
          0.3,
          0.5,
        ),
        C.twig,
        MIX.paper,
      ),
    );
  };
  arm([0.2, 0.92, 0.0], [0.33, 0.8, 0.16], handR);
  arm([-0.2, 0.95, 0.0], [-0.32, 0.9, 0.2], handL);
  for (const [h, d] of [
    [handR, [0.06, -0.05, 0.05]],
    [handL, [-0.07, 0.04, 0.04]],
  ] as [V3, V3][])
    p.push(
      mixPart(limb(h, [h[0] + d[0], h[1] + d[1], h[2] + d[2]], 0.016, 0.008, 4, { hi: false }), C.twig, MIX.paper),
    );
  // Twig rifle at port: a fat crooked stock at the right hand, a thin straight barrel up
  // past the left shoulder with a dark knot for a muzzle.
  const butt: V3 = [0.24, 0.62, 0.36];
  const muzzle: V3 = [-0.2, 1.2, 0.44];
  const at = (t: number): V3 => [
    butt[0] + (muzzle[0] - butt[0]) * t,
    butt[1] + (muzzle[1] - butt[1]) * t,
    butt[2] + (muzzle[2] - butt[2]) * t,
  ];
  p.push(
    mixPart(
      tube(
        [
          { p: butt, a: 0.05, b: 0.035 },
          { p: at(0.18), a: 0.04, b: 0.03 },
          { p: at(0.32), a: 0.03 },
          { p: at(0.94), a: 0.022 },
        ],
        5,
        [0, 0, 1],
        0.5,
        0,
      ),
      C.twig,
      MIX.paper,
    ),
  );
  p.push(mixPart(limb(at(0.94), muzzle, 0.026, 0.024, 5, { hi: false }), C.twigDark, MIX.paper));
  return mergeParts(p);
}

function kit(): VertexData {
  const p: VertexData[] = [];
  // The army men's oval base plate.
  p.push(
    shade(
      scaled(
        revolve(
          [
            [0.5, 0],
            [0.5, 0.025],
            [0.47, 0.045],
            [0, 0.045],
          ],
          10,
        ),
        0.86,
        1,
        0.92,
      ),
      S.base,
    ),
  );
  // Bucket helmet: rolled rim, tapered wall, a raised band, closed top; tilted back a bit.
  const bucket = revolve(
    [
      [0.17, -0.02],
      [0.205, 0.0],
      [0.19, 0.03],
      [0.176, 0.12],
      [0.165, 0.175],
      [0.13, 0.2],
      [0, 0.205],
    ],
    10,
    [S.rim, S.rim, S.bucket, S.stripe, S.bucket, S.bucket, S.bucket],
  );
  const helm = { x: HEAD[0], y: HEAD[1] + 0.105, z: HEAD[2] - 0.02, rx: -0.14, rz: 0.08 };
  p.push(place(bucket, helm));
  // The bucket handle worn as a chin strap.
  p.push(
    place(
      shade(
        tube(
          [
            { p: [-0.19, 0.0, 0.0], a: 0.016 },
            { p: [0, -0.21, 0.12], a: 0.016 },
            { p: [0.19, 0.0, 0.0], a: 0.016 },
          ],
          4,
          [0, 0, 1],
          0.5,
          0.5,
        ),
        S.strap,
      ),
      helm,
    ),
  );
  // Knitted scarf round the neck and a tail falling over the chest.
  p.push(
    shade(
      place(
        revolve(
          [
            [0.15, -0.035],
            [0.19, -0.02],
            [0.195, 0.015],
            [0.165, 0.04],
          ],
          8,
        ),
        { y: 1.075, z: 0.02, rx: 0.08 },
      ),
      S.scarf,
    ),
  );
  p.push(
    tube(
      [
        { p: [-0.09, 1.07, 0.2], a: 0.05, b: 0.018, s: S.scarf },
        { p: [-0.11, 0.97, 0.27], a: 0.048, b: 0.017, s: S.scarf },
        { p: [-0.12, 0.86, 0.29], a: 0.046, b: 0.016, s: S.stripe },
        { p: [-0.11, 0.8, 0.285], a: 0.05, b: 0.016, s: S.scarf },
      ],
      4,
      [1, 0, 0],
      0.3,
      0.4,
    ),
  );
  return mergeParts(p);
}

// ---------- AO, cache, meshes ----------
const AO_OPTS = { samples: 20, maxDist: 0.45, strength: 0.6, maxTriangles: 4000 };
const AO_BAKED = {
  snow: 'DUDM/7IADTO/8pkAAEC/8owAADO/8n8AADPM/6YAACbM/7IADTPM/78ADSa//9kAAEDM/78ADTO//78ADUDM/7IAjEzl8gAAf0Cm/w0AjEy/zA0AmTPZDQAAjEDysg0AjEzy8gAAmUzy/wAAjEzy/w0AjEDy/wAAmTPy/wAAjEzl8gAAAADy8gAAAA3y8gAAAAC//wAAAADZ8gAAAA3y2QAAAADyjAAAAA3ymQAAAADyvwAAAADy8gAAJgBZpvLMjMyMJgAaJgBZptmypuXMGgBZGgAzptmyDZmmAMyyABqmJiZMDZmmZn+Zstm/czN/QBomZn+ZJn9/AP/MJpmyZoxZJn9/ppmZsgAA2eXy5aay8v//2dnZ/wAAAAAA2WZM5f+Zc1kAvwAAAAANAAC//+VzM78A/4xzAJkAAOXyAABMpgAAc78Asv//AADl8pmy2dkA8v//AADM/wAAv+WZstnZ///ZWb///wBZzP//plnM//Kmv/LZANny/wD///8A////AL/l/wB/v/IA2fL/',
  kit: 'jH9/f3+Mf39/f7+/zMzMv8zZv8zMv7+/zL+/zL+yJgC/mYyZAKayv8z////y8vLy8vL/////8v////////////////////////////////////////////////8A8gAAAAAAAAD/AAAAAA0NAA0NAA0AsqZMc7LMv7/y/9nl8vL/8szZssy/zL/MZr/ZGkC/phpA5dkaZvLMGkyZ',
};
const AO_CHECK = { snow: 1934495, kit: 813832 };

let cached: { snow: VertexData; kit: VertexData } | null = null;

function geometry(): { snow: VertexData; kit: VertexData } {
  if (!cached) {
    const [s, k] = bakedParts(
      'snowman',
      [snow(), kit()],
      [
        { b64: AO_BAKED.snow, check: AO_CHECK.snow },
        { b64: AO_BAKED.kit, check: AO_CHECK.kit },
      ],
      AO_OPTS,
    );
    cached = { snow: cloneVD(s), kit: cloneVD(k) };
  }
  return cached;
}

// Tool: recomputes AO_BAKED / AO_CHECK (run through vite's ssrLoadModule).
export function snowmanAOTable(): { baked: Record<'snow' | 'kit', string>; check: Record<'snow' | 'kit', number> } {
  const parts = [snow(), kit()];
  const f = bakeAOFactors(parts, AO_OPTS);
  return {
    baked: { snow: encodeAO(f[0]), kit: encodeAO(f[1]) },
    check: { snow: aoChecksum(parts[0].positions as number[]), kit: aoChecksum(parts[1].positions as number[]) },
  };
}

export function snowmanTriangles(): { snow: number; kit: number } {
  const g = geometry();
  return {
    snow: (g.snow.indices as ArrayLike<number>).length / 3,
    kit: (g.kit.indices as ArrayLike<number>).length / 3,
  };
}

// Common setup of a thin-instanced crowd mesh.
export function crowdMesh(mesh: Mesh, look: Look): Mesh {
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.doNotSyncBoundingInfo = true;
  look.addShadowCaster(mesh, 'crowd');
  look.receiveShadows(mesh);
  return mesh;
}

export function createSnowmanMeshes(scene: Scene, look: Look): SnowmanMeshes {
  const g = geometry();
  const mix = look.material('toy-mix', () => mixedToyMaterial(scene));
  const plastic = look.material('army-plastic', () => armyPlasticMaterial(scene));
  return {
    snow: crowdMesh(buildMesh(scene, 'snowmanSnow', cloneVD(g.snow), mix), look),
    kit: crowdMesh(buildMesh(scene, 'snowmanKit', cloneVD(g.kit), plastic), look),
  };
}

// ---------- preview ----------
// A thin-instanced preview group: every mesh shares the units' matrices; `team` meshes
// take the unit's team colour, the others white; frost (0..1) tints both like crowd.ts.
export interface CrowdPreviewMesh {
  mesh: Mesh;
  team: boolean;
}
export interface CrowdPreviewUnit {
  x: number;
  z: number;
  yaw: number;
  s: number;
  frost: number;
}

export function crowdPreview(
  scene: Scene,
  name: string,
  meshes: CrowdPreviewMesh[],
  units: CrowdPreviewUnit[],
  style: HopStyle,
  hopHeight = 0.11,
  army: TeamName = 'enemy',
): PreviewResult {
  const root = new TransformNode(name, scene);
  const matrices = new Float32Array(units.length * 16);
  const team = teamColor(army);
  const tmp = [0, 0, 0];
  for (const m of meshes) {
    m.mesh.parent = root;
    const colors = new Float32Array(units.length * 4);
    units.forEach((u, i) => {
      const [r, g, b] = m.team ? [team.r, team.g, team.b] : [1, 1, 1];
      frostColor(r, g, b, u.frost, tmp);
      colors.set([tmp[0], tmp[1], tmp[2], 1], i * 4);
    });
    m.mesh.thinInstanceSetBuffer('matrix', matrices, 16, false);
    m.mesh.thinInstanceSetBuffer('color', colors, 4, true);
  }
  const write = (time: number): void => {
    units.forEach((u, i) => {
      const live = 1 - u.frost;
      const sn = Math.sin(time * 10 * style.speed + u.x * 3.7 + u.z * 1.9);
      const hop = Math.abs(sn) * live;
      writeTRS(
        matrices,
        i * 16,
        u.x,
        hop * hopHeight * style.height * u.s,
        u.z,
        u.s,
        u.s,
        u.s,
        u.yaw,
        hop * 0.16 * style.lean,
        sn * 0.1 * style.waddle * live,
      );
    });
  };
  write(0.37);
  return {
    root,
    update(time) {
      write(time);
      for (const m of meshes) m.mesh.thinInstanceBufferUpdated('matrix');
    },
    dispose() {
      root.dispose();
    },
  };
}

// A squad of snowmen marching at the camera ('frozen': half of them frosted by a Blizzard).
export function preview(scene: Scene, look: Look, opts: PreviewOptions): PreviewResult {
  const m = createSnowmanMeshes(scene, look);
  const frozen = opts.variant === 'frozen';
  const units: CrowdPreviewUnit[] = [];
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 4; c++)
      units.push({
        x: (c - 1.5) * 1.0 + (r % 2 ? 0.25 : -0.25),
        z: (r - 0.5) * 1.1,
        yaw: 0.55,
        s: 0.42 / SNOWMAN_RADIUS,
        frost: frozen && c >= 2 ? 1 : 0,
      });
  units.push({ x: 0.3, z: 2.2, yaw: 0, s: 1, frost: 0 });
  return crowdPreview(
    scene,
    'snowmanRoot',
    [
      { mesh: m.snow, team: false },
      { mesh: m.kit, team: true },
    ],
    units,
    HOP_STYLE.snowman,
  );
}
