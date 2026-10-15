// Champion 'tank' (variant 9): a green wind-up toy tank. A chunky moulded hull with a
// sloped glacis and a fender deck, a domed turret with a fat short gun and a muzzle
// collar, a little commander in a helmet standing in the open hatch, side skirts with
// road-wheel hubs inside soft black rubber tread loops (moulded ribs), a tool box on the
// rear deck, brass stars on the turret sides and a big brass wind-up key on the back
// (the camera behind the player's champion sees the key first).
//
// GAME API (same shape as models/champion.ts, drop-in for the crowd's champion batches)
//   createChampionTank(scene, look): ChampionMeshes   synchronous, geometry cached
//   - body: team plastic ('army-plastic', white albedo): give it the thin-instance
//     'color' buffer of LINEAR teamColor(team) (x 1.12 like the sarge). Greyscale moulding
//     and AO in vertex colours.
//   - trim: treads, key and stars in the shared 'toy-mix' material (rubber / brass picked
//     per part); NO 'color' buffer; the SAME matrices as the body, in the same order.
//   - Pivot on the floor at the hull centre, front +Z, ~2.05 long (gun to 2.75 overall)
//     x 1.66 wide x 1.62 tall (commander's helmet): fills the champion's radius-1
//     footprint like the kneeling sarge, so the crowd scales it by radius / 1.0.
//   - Both: not pickable, alwaysSelectAsActiveMesh, doNotSyncBoundingInfo, 'crowd'
//     shadow casters and receivers (dropped on 'low': blob footprint ~1.8 x 2.2).
//   Triangles: body ~1,700, trim ~1,600. AO baked offline (AO_BAKED, aoTable.ts).
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { CreateTorusVertexData } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { Matrix } from '@babylonjs/core/Maths/math.vector';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
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
  roundedBox,
  teamColor,
} from '../look/index.ts';
import type { MixSlot } from '../look/index.ts';
import type { ModelInfo, PreviewOptions, PreviewResult } from '../look/model.ts';
import type { TeamName } from '../look/palette.ts';
import type { ChampionMeshes } from './champion.ts';
import { greyByProfile, grey, pillow, scale3, sphere } from './champion.ts';
import { star } from './cannon.ts';

export const info: ModelInfo = {
  key: 'championTank',
  title: 'Champion: wind-up toy tank',
  instanced: true,
  teams: true,
  side: 'team',
  height: 1.62,
  triangleBudget: 3000,
  gameZ: 15,
};

// Tread loop: a stadium in the YZ plane (centre line), swept with a rounded section.
const TREAD = { x: 0.64, halfW: 0.165, thick: 0.045, r: 0.22, y: 0.27, z: 0.68, samples: 32, rib: 0.022 };
const TURRET = { y: 0.74, z: -0.08 };
const GUN_Y = 0.93;
const KEY = { y: 0.62, z: -1.0 };

// Greyscale moulding (team colour multiplies in).
const G = { hull: 0.92, deck: 1, turret: 1, gun: 0.86, bore: 0.35, skirt: 0.86, hub: 0.78, box: 0.8, face: 1.05 };

function body(): VertexData {
  const p: VertexData[] = [];
  // Lower hull between the treads and the deck with its fenders.
  p.push(grey(pillow(0.94, 0.36, 1.8, { y: 0.4 }, 0.3), G.hull));
  p.push(grey(place(roundedBox(1.64, 0.17, 1.9, 0.07, 1), { y: 0.645 }), G.deck));
  // Sloped glacis plate in front and a short one at the rear.
  p.push(grey(place(roundedBox(0.96, 0.1, 0.4, 0.04, 1), { y: 0.45, z: 0.9, rx: 0.62 }), G.hull));
  p.push(grey(place(roundedBox(0.96, 0.1, 0.3, 0.04, 1), { y: 0.47, z: -0.9, rx: -0.7 }), G.hull));
  // Turret dome, slightly long, and the ring under it.
  const turret = lathe(
    [
      [0, 0],
      [0.5, 0],
      [0.535, 0.05],
      [0.53, 0.16],
      [0.45, 0.3],
      [0.29, 0.39],
      [0, 0.42],
    ],
    18,
  );
  p.push(grey(place(scale3(turret, 1, 1, 1.12), { y: TURRET.y, z: TURRET.z }), G.turret));
  // Mantlet and the fat gun with a muzzle collar and a moulded bore.
  p.push(grey(pillow(0.36, 0.27, 0.22, { y: GUN_Y, z: 0.47 }, 0.35, 8), G.gun));
  const gun = lathe(
    [
      [0.088, 0],
      [0.082, 0.62],
      [0.112, 0.65],
      [0.115, 0.8],
      [0.098, 0.82],
      [0.062, 0.815],
      [0, 0.74],
    ],
    10,
  );
  greyByProfile(gun, [G.gun, G.gun, G.gun, G.gun, G.gun, G.bore, G.bore]);
  p.push(place(gun, { rx: Math.PI / 2, y: GUN_Y, z: 0.55 }));
  // Hatch ring and the commander: torso, head and an M1 helmet.
  const hz = TURRET.z - 0.16;
  const hy = TURRET.y + 0.4;
  p.push(
    grey(
      place(
        lathe(
          [
            [0.18, 0],
            [0.19, 0.04],
            [0.17, 0.065],
            [0.13, 0.06],
          ],
          12,
        ),
        { y: hy - 0.02, z: hz },
      ),
      G.gun,
    ),
  );
  p.push(grey(pillow(0.28, 0.24, 0.2, { y: hy + 0.12, z: hz }, 0.4, 8), G.turret));
  p.push(grey(sphere([0, hy + 0.3, hz + 0.01], 0.095, 8, 4, [0.95, 1, 1]), G.face));
  const helmet = lathe(
    [
      [0, 0.17],
      [0.085, 0.15],
      [0.12, 0.08],
      [0.125, 0.02],
      [0.16, -0.005],
      [0.155, -0.02],
      [0.12, -0.01],
    ],
    12,
  );
  greyByProfile(helmet, [0.9, 0.9, 0.9, 0.88, 0.78, 0.7, 0.66]);
  p.push(place(scale3(helmet, 1, 1, 1.08), { y: hy + 0.33, z: hz }));
  // Hatch lid flipped open behind him.
  p.push(grey(place(roundedBox(0.34, 0.04, 0.34, 0.02, 1), { y: hy + 0.14, z: hz - 0.27, rx: -1.2 }), G.gun));
  // Side skirts inside the tread loops, with road-wheel hubs.
  for (const s of [-1, 1]) {
    const x = s * (TREAD.x + TREAD.halfW - 0.035);
    p.push(grey(place(roundedBox(0.06, 0.28, 1.34, 0.025, 1), { x, y: TREAD.y }), G.skirt));
    for (const z of [-0.66, -0.22, 0.22, 0.66]) {
      const hub = lathe(
        [
          [0.12, 0],
          [0.115, 0.03],
          [0.06, 0.058],
          [0, 0.062],
        ],
        7,
      );
      p.push(grey(place(hub, { rz: -s * (Math.PI / 2), x: x + s * 0.025, y: TREAD.y, z }), G.hub));
    }
  }
  // Tool box and exhausts on the rear deck.
  p.push(grey(pillow(0.56, 0.13, 0.22, { y: 0.79, z: -0.78 }, 0.35), G.box));
  for (const s of [-1, 1])
    p.push(grey(place(lathe(sphereProfile(0.07), 6), { x: s * 0.52, y: 0.76, z: -0.82 }), G.box));
  return fixWinding(mergeParts(p));
}

function sphereProfile(r: number): [number, number][] {
  return [
    [0, -r],
    [r * 0.8, -r * 0.6],
    [r, 0],
    [r * 0.8, r * 0.6],
    [0, r],
  ];
}

// One rubber tread loop around x = xc, swept around the stadium centre line.
function tread(xc: number): VertexData {
  const { halfW: hw, thick: t, r: R, y: yc, z: zc, samples: M, rib } = TREAD;
  const e = 0.02;
  const cs: [number, number][] = [
    [-hw + e, -t],
    [hw - e, -t],
    [hw, -t + e],
    [hw, t - e],
    [hw - e, t],
    [-hw + e, t],
    [-hw, t - e],
    [-hw, -t + e],
  ];
  const straight = 2 * zc;
  const L = 2 * straight + 2 * Math.PI * R;
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const rubber = lin('tread');
  for (let k = 0; k < M; k++) {
    // Centre line point and outward normal (in y, z) at arc length s.
    let s = (k / M) * L;
    let cy: number, cz: number, ny: number, nz: number;
    if (s < straight) {
      cy = yc + R;
      cz = zc - s;
      ny = 1;
      nz = 0;
    } else if ((s -= straight) < Math.PI * R) {
      const a = s / R;
      ny = Math.cos(a);
      nz = -Math.sin(a);
      cy = yc + ny * R;
      cz = -zc + nz * R;
    } else if ((s -= Math.PI * R) < straight) {
      cy = yc - R;
      cz = -zc + s;
      ny = -1;
      nz = 0;
    } else {
      const a = Math.PI + (s - straight) / R;
      ny = Math.cos(a);
      nz = -Math.sin(a);
      cy = yc + ny * R;
      cz = zc + nz * R;
    }
    const ribbed = k % 2 === 0;
    for (const [x, r0] of cs) {
      const outer = r0 > t - 1e-6;
      const r = outer && ribbed ? r0 + rib : r0;
      positions.push(xc + x, cy + ny * r, cz + nz * r);
      const qx = Math.sign(x) * Math.pow(Math.abs(x) / hw, 4);
      const qr = Math.sign(r0) * Math.pow(Math.abs(r0) / t, 4);
      const l = Math.hypot(qx, qr) || 1;
      normals.push(qx / l, (qr / l) * ny, (qr / l) * nz);
      const g = outer ? (ribbed ? 1.15 : 0.75) : 1;
      colors.push(rubber.r * g, rubber.g * g, rubber.b * g, 1);
    }
  }
  const n = cs.length;
  const indices: number[] = [];
  for (let k = 0; k < M; k++) {
    const k1 = (k + 1) % M;
    for (let j = 0; j < n; j++) {
      const j1 = (j + 1) % n;
      const a = k * n + j,
        b = k * n + j1,
        c = k1 * n + j1,
        d = k1 * n + j;
      indices.push(a, b, c, a, c, d);
    }
  }
  const vd = new VertexData();
  vd.positions = positions;
  vd.normals = normals;
  vd.indices = indices;
  vd.colors = colors;
  return mixUv(fixWinding(vd), MIX.rubber);
}

function part(vd: VertexData, color: string, slot: MixSlot): VertexData {
  return mixUv(paint(vd, lin(color)), slot);
}

function trim(): VertexData {
  const p: VertexData[] = [tread(-TREAD.x), tread(TREAD.x)];
  // Wind-up key: shaft out of the rear plate, a hub and a butterfly bow of two rings.
  const shaft = lathe(
    [
      [0.06, 0],
      [0.045, 0.02],
      [0.045, 0.2],
      [0, 0.21],
    ],
    10,
  );
  p.push(part(place(shaft, { rx: -Math.PI / 2, y: KEY.y, z: KEY.z + 0.04 }), 'brass', MIX.brass));
  p.push(part(place(lathe(sphereProfile(0.075), 10), { y: KEY.y, z: KEY.z - 0.19 }), 'brass', MIX.brass));
  for (const s of [-1, 1]) {
    const ring = CreateTorusVertexData({ diameter: 0.3, thickness: 0.075, tessellation: 10 });
    ring.uvs = null;
    p.push(
      part(
        place(scale3(ring, 1, 1, 0.82), { rx: Math.PI / 2, x: s * 0.175, y: KEY.y + 0.02, z: KEY.z - 0.19 }),
        'brass',
        MIX.brass,
      ),
    );
  }
  // Brass stars on the turret sides.
  for (const s of [-1, 1]) {
    const st = star(0.13, 0.055, 0.016);
    st.uvs = null;
    p.push(
      part(place(st, { rz: -s * (Math.PI / 2), x: s * 0.528, y: TURRET.y + 0.12, z: TURRET.z }), 'brass', MIX.brass),
    );
  }
  return mergeParts(p);
}

// ---------- AO, cache, meshes ----------
const AO_OPTS = { samples: 16, maxDist: 0.5, strength: 0.65, maxTriangles: 8000 };
const AO_BAKED: Record<'body' | 'trim', string> = {
  body: 'MB9BQQAAMA0NAAAAMAAAAAAAMABBQQAAMB9BQQAA7v///9z////c////7v/////////u////7v///////////////////////////////9zc7u6GddzudWTc/8vu7v/L7u7/////////////////3Nzu////////////////AAAAAAANHwBSl6ncdbq67g0AAAAAHx8AQYap3GS6utwAAAAAAAAAANzc7tzc7u7uDQAfAAANAABBQTBSZFJkdWRSZHW6qam6urq6utzu7u4NAB8AAAAAAAANDQAAAAAAUqmp/0GGhssAMB8AAAAAAGS6uu4wl5fcDR8fAAAAAADu7u7/3NzLywAAAAAAAAAAZGRSUjAwQUENAAAAAAAAAAAAAAAAAAAAAB8fAAAAAABkZFJSurq6qbrLy6nu7u7/AAAAAP/cAAAAde7//wAAAHXc/+4AAAB1y//uAAAAHwAA/wAAADAAAP8AAABk3P//AAAAde7//wAAAHXc/+4AAAAAAP/uAAAAddz/ywAAAIbL/8sAAABS3O51AAAAAMvuAAAAAADL3AAAAABky+51AAAAddzuugAAAHXc/8sAAAAAAP/cAAAADXX//wAAhtz//wAfZKn//wAfZLr//wANl+7//wAADYb//wAAUlLL/wAAZFLL/wAADXX//wDu////3AAAy9zu/9wAAKm6///LAACpy+7/ywAAy9z//+4AANzu///cAADu////3AAA7v///+4AAO7////uAADu////ywAA7v///9wAALqpQTC6y2RBl8uGQZfLhjCX3IYfustkANy6UgDcumQAl3VBMB8wUgBkdVIAuqlBALqpQXUAl9yGAHWGqe6GAHVkl9x1AHVkhtx1AHVBuu6GAHUAqcuGAHUAMHUfAHUAQWRkAHUAl9yGAAAAdQAAAABkAAAAAFIAAAAAUgAAAABkAAAAAFIAAAAAMAAAAABSAAAAAHUAAAAAAAAAAAAfDQAAAAAAMAAAAAAAAAAAAAAAAAANAAAAAAAAAAAAAAAAADANAAAAAAANAAANAAAAHwANAAAAAAAAAB8AAAANHwAAAAAAAAANAAAAAAAAAAAAAABShobuhtzc/7ru7v/c////ZIaG3IbLy//L7u7/3P///9y6uu7///////////////9kDR9ShkFBhst1dbrcl7rc3Je63P/Ly///y8v//////2QNH1KGUoaGhlKGhty6uu4AHx8NDR8fAA0NDQANHw0AMFIfqUF1l8tBdZfLUlINuqlBMA3LMDAAyzAwALpkQQAwMDAAQQAADUEAAA1SHx8NUh8fDVIfHx8NMDANumRBADAwMABSHzAfH0EwH6lBMA2G3O7cANzuywCpy8sAZJfLH3WXy2Spy8uG3O7Lhtzu3ADc7twA3O7LAKnLywBkl8sAdZfLAKnLywDc7ssA3O7cANzu3ADc7ssAqcvLAGSXywB1l8sAqcvLANzuywDc7tyG3O7chtzuy2Spy8sNZJfLAHWXywCpy8sA3O7Lhtzu3FIAhpcwUqm6MFK6ukEAl6kADQAAHw0NAA0fHwANHwAAADAwlwAfH7oAHx+6AB9BqQAADVIfAAAwDQAAMA0fH0ENHx9BHzBBAAAfDZcAH0GpAAANUg0wMAAADTCGADAwlwBBl8sAZKnLAMvcywDc7tx13O7cddzcyx+GqcsAQZfLAEGXywBkqcsAy9zLANzu3ADc7twAy9zLAHWpywBBl8sAQZfLAGSpywDL3MsA3O7cANzu3ADL3MsAdanLAEGXywBBl8swdanLddzcy3Xu7twA3O7cAMvcywB1qcsAQZfLDQCG///cDQ0AdbrcDR8fl8vcDQCG3P/cDQCG///cDQ1By/8ADUG63A0fZNz/AACG7v8AAO7//wAAy///DQ1By/8AAJf//w0AZNzuADAwqcsADVK63AAAuu7uAADL//8AAJf//w==',
  trim: 'hh8AAAB1/+6GDQAAAIb/7oYNAAAAdf/uhh8AAACG/+6GHwAAAHX/7oYfAAAAhv/uhh8AAAB1/+51HwAAAIb/7oYfAAAAdf/uhg0AAACG/+6GDQAAAHX/7qkAAAAAl//ulzAAAFLu7u6XQWRky+7c3JcwUmR1hqm6qTBBUh8fhpeGUkEwAABkl3UwMDANAGSGhh8wMAAAZJeGMB8wDQBkl3UwHzAAAGSGhjAfMA0AZJeGMB8wAABkl3UwHzANAGSXdTAfMAAAZIaGHzAwDQBkl3UwQTAAAGSXlx9BUgANdYapMFJkMFKXl5cwZHWXy8vLhkEwQWT/7typHwAAH8v/7g2X7v9kAAAADYbu/4YAAAAfl+7/ZAAAAB+X7v+GAAAAH4bu/2QAAAAfl+7/hgAAAB+X7v9kAAAAH4bu/4YAAAAfhu7/ZAAAAB+X7v+GAAAAH5fu/2QAAAAfhu7/hgAAAB+G7u7uUgAAUnXc3P+6ZEFShrqpdYZkZEGXhoYfH3VBMHWXZAAAMEEfdZdkDQAwMDCGl2QAADAwMIaGZA0AMB8wdZdkAAAwHzCGl2QNADAfMIaGZAAAMB8wdZdkDQAwHzB1l2QAADAfMIaXZA0AMDAwhoZkAAAwMEFkl3UADUFBUnWpl0FSUlJSdcvLuql1ZDCG3O7/dR9SMJfu/8sfAAB1hgAAhroAAO7LAADLugAAqZcAAIZSAAB1hgAAl0EAAFJSAACGQQAAdYYAALoAugCpqWR1hpeXUgCGl5dkAHWGl0FShrrLAKkAqdyXy6m67u7u/7ru7v//y9yp3Mu6ugC6AKmpuv///9ypUkFkqam6///u3IYwMFKpAAAAAAAAAAAAAACXy9zclwBSZFJkl3WX7v///9x1ZDB1dcvu////7oZkQXWXuu7////ul1JSl4a6////7st1QTCGl6n//+7chlJSZJep3P///9yXQUF1qam6////3KlSQWSpurr////cqVJSdbqXuv///9ypUlJBl3XL7v//3HVBUlJ1htzu///uumRBQYZkl+7////chlIfZIbL/////+6XUjCGl8vu/+7cumRSZJeXuu7clwBkUjBBlwAAAAAAAAAAAAAAutz/7u7cdUFBdbq6uv///9ypUlJ1urq6qXWGhrrLuty6DQ0NDVJBQQ0AMAAAAAAAAJeXQYZBZFIf3LqX3LrcuoaphnWpusvLl7q6uty6y7qGhnWpuqmGuoapqXXLqZfLutzcqWQwMGSXdWRkAAAAAA0AAABBQTBBAA0AAA==',
};
const AO_CHECK: Record<'body' | 'trim', number> = { body: 10181569, trim: 6133424 };

let cached: { body: VertexData; trim: VertexData } | null = null;

function geometry(): { body: VertexData; trim: VertexData } {
  if (!cached) {
    const [b, t] = bakedParts(
      'championTank',
      [body(), trim()],
      [
        { b64: AO_BAKED.body, check: AO_CHECK.body },
        { b64: AO_BAKED.trim, check: AO_CHECK.trim },
      ],
      AO_OPTS,
    );
    // Metal and rubber: occlusion mostly darkens reflections; keep the trim's bake gentle.
    const c = t.colors as Float32Array | number[];
    const raw = trim().colors as ArrayLike<number>;
    for (let i = 0; i < c.length; i++) if (i % 4 !== 3) c[i] = raw[i] - (raw[i] - c[i]) * 0.6;
    cached = { body: cloneVD(b), trim: cloneVD(t) };
  }
  return cached;
}

// Tool: recomputes AO_BAKED / AO_CHECK (run through vite's ssrLoadModule).
export function championTankAOTable(): {
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

export function championTankTriangles(): { body: number; trim: number } {
  const g = geometry();
  return {
    body: (g.body.indices as ArrayLike<number>).length / 3,
    trim: (g.trim.indices as ArrayLike<number>).length / 3,
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

export function createChampionTank(scene: Scene, look: Look): ChampionMeshes {
  const g = geometry();
  const plastic = look.material('army-plastic', () => armyPlasticMaterial(scene));
  const mix = look.material('toy-mix', () => mixedToyMaterial(scene));
  return {
    body: setup(buildMesh(scene, 'championTankBody', cloneVD(g.body), plastic), look),
    trim: setup(buildMesh(scene, 'championTankTrim', cloneVD(g.trim), mix), look),
  };
}

// ---------- preview ----------
export function preview(scene: Scene, look: Look, opts: PreviewOptions): PreviewResult {
  return championPreview(scene, opts, createChampionTank(scene, look), 'championTankRoot');
}

// Shared by the champion previews: two of opts.team and one of the other team facing them.
export function championPreview(
  scene: Scene,
  opts: PreviewOptions,
  meshes: ChampionMeshes,
  name: string,
): PreviewResult {
  const root = new TransformNode(name, scene);
  meshes.body.parent = root;
  if (meshes.trim) meshes.trim.parent = root;
  const team: TeamName = opts.team;
  const other: TeamName = team === 'player' ? 'enemy' : 'player';
  const units = [
    { x: -1.4, z: 0, yaw: 0, team },
    { x: 1.4, z: 0.3, yaw: -0.7, team },
    { x: 0.3, z: 3.6, yaw: Math.PI, team: other },
  ];
  const matrices = new Float32Array(units.length * 16);
  const colors = new Float32Array(units.length * 4);
  const tmp = new Matrix();
  const write = (time: number): void => {
    units.forEach((u, i) => {
      Matrix.RotationYToRef(u.yaw, tmp);
      tmp.setTranslationFromFloats(u.x, Math.max(0, Math.sin(time * 2 + i)) * 0.03, u.z);
      tmp.copyToArray(matrices, i * 16);
    });
  };
  write(0);
  units.forEach((u, i) => {
    const c = teamColor(u.team).scale(1.12);
    colors.set([c.r, c.g, c.b, 1], i * 4);
  });
  meshes.body.thinInstanceSetBuffer('matrix', matrices, 16, false);
  meshes.body.thinInstanceSetBuffer('color', colors, 4, true);
  meshes.trim?.thinInstanceSetBuffer('matrix', matrices, 16, false);
  return {
    root,
    update(time) {
      write(time);
      meshes.body.thinInstanceBufferUpdated('matrix');
      meshes.trim?.thinInstanceBufferUpdated('matrix');
    },
    dispose() {
      root.dispose();
    },
  };
}
