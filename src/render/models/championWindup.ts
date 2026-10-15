// Champion 'windup' (Milestone 6, variant 11): the player's Wind-up Robot, a big tin toy
// robot painted army green that walks a gate's line and re-triggers it. A deep barrel
// chest with a big brass gear set into a porthole on the front and a smaller one meshing
// beside it, rows of brass rivets and a brass star; a boxy head with a dark visor band,
// two round amber lamp eyes, ear dishes and an antenna; bolted shoulder joints, tin
// forearms and big mitt hands held forward; piston legs on wide, rubber-soled feet; and
// a large brass wind-up key on its back (a separate mesh the crowd turns per instance;
// the camera behind the player's champion sees the key first).
//
// GAME API (same shape as models/champion.ts, plus the key)
//   createChampionWindup(scene, look): ChampionMeshes & { key: Mesh }  synchronous, cached
//   - body: team plastic ('army-plastic', white albedo; reads as painted tin under the
//     clearcoat-free plastic): thin-instance 'color' = LINEAR teamColor(team) x 1.12 like
//     the sarge. Greyscale moulding and AO in vertex colours.
//   - trim: tin joints and pistons, brass gears, rivets, star, lamps and rubber soles in
//     the shared 'toy-mix' material; NO 'color' buffer; the SAME matrices as the body.
//   - key: the brass key authored at the ORIGIN with its shaft along -Z: draw it at the
//     body matrix offset by WINDUP_KEY (rotateLocal) and rolled by its turn angle; NO
//     'color' buffer.
//   - Pivot on the floor between the feet, front +Z, 2.45 tall to the antenna bead
//     (head top 2.2), footprint radius ~1 like the sarge: crowd scale = radius / 1.0.
//   - All: not pickable, alwaysSelectAsActiveMesh, doNotSyncBoundingInfo, 'crowd'
//     shadow casters and receivers (blob footprint ~1.9 x 2.0 on 'low').
//   gearVD(outer, root, teeth, thick): a flat toothed gear (normal +Y, y 0..thick), shared
//     with the Gear Gun, the Jack-in-the-Box and the unit effects.
//   Triangles: body ~1,500, trim ~1,900, key ~250. AO baked offline (AO_BAKED, aoTable.ts).
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { CreateTorusVertexData } from '@babylonjs/core/Meshes/Builders/torusBuilder';
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
} from '../look/index.ts';
import type { MixSlot } from '../look/index.ts';
import type { ModelInfo, PreviewOptions, PreviewResult } from '../look/model.ts';
import type { ChampionMeshes, V3 } from './champion.ts';
import { grey, limb, pillow, scale3, sphere } from './champion.ts';
import { star } from './cannon.ts';
import { HOP_STYLE } from '../crowdLogic.ts';
import { keyedPreview } from './windupRobot.ts';

export const info: ModelInfo = {
  key: 'championWindup',
  title: 'Champion: Wind-up Robot',
  instanced: true,
  teams: true,
  side: 'team',
  height: 2.45,
  triangleBudget: 4000,
  gameZ: 15,
};

export interface ChampionWindupMeshes extends ChampionMeshes {
  key: Mesh;
}

// Where the key's origin sits on the robot (unscaled, root-local).
export const WINDUP_KEY = { x: 0, y: 1.32, z: -0.44 } as const;

// ---------- shared gear ----------
// A flat spur gear in the XZ plane, normal +Y, from y = 0 to y = thick: `teeth` square-ish
// teeth between radius `root` and `outer`, top and bottom fans and flat-shaded walls.
export function gearVD(outer: number, root: number, teeth: number, thick: number): VertexData {
  const ring: [number, number][] = [];
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2;
    const da = (Math.PI * 2) / teeth;
    for (const [f, r] of [
      [0, root],
      [0.12, outer],
      [0.45, outer],
      [0.57, root],
    ] as const) {
      const a = a0 + f * da;
      ring.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
  }
  const n = ring.length;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (const [y, ny] of [
    [thick, 1],
    [0, -1],
  ] as const) {
    const c = positions.length / 3;
    positions.push(0, y, 0);
    normals.push(0, ny, 0);
    for (const [x, z] of ring) {
      positions.push(x, y, z);
      normals.push(0, ny, 0);
    }
    for (let i = 0; i < n; i++) indices.push(c, c + 1 + i, c + 1 + ((i + 1) % n));
  }
  for (let i = 0; i < n; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % n];
    let nx = bz - az;
    let nz = -(bx - ax);
    const l = Math.hypot(nx, nz) || 1;
    nx /= l;
    nz /= l;
    if (nx * (ax + bx) + nz * (az + bz) < 0) {
      nx = -nx;
      nz = -nz;
    }
    const b = positions.length / 3;
    positions.push(ax, thick, az, bx, thick, bz, bx, 0, bz, ax, 0, az);
    for (let k = 0; k < 4; k++) normals.push(nx, 0, nz);
    indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const vd = new VertexData();
  vd.positions = positions;
  vd.normals = normals;
  vd.indices = indices;
  return fixWinding(vd);
}

const C = {
  brass: '#d2a33f',
  brassDark: '#a77d2a',
  tin: '#c9ced4',
  tinDark: '#8d959d',
  sole: '#2f3336',
  lamp: '#ffc864',
  lampRim: '#3a2c22',
  cream: '#efe3c6',
};

// Greyscale moulding on the team colour.
const G = { chest: 1, chestDark: 0.86, hip: 0.84, foot: 0.8, head: 0.96, visor: 0.36, mitt: 0.9, arm: 0.94 };

function part(vd: VertexData, color: string, slot: MixSlot): VertexData {
  vd.uvs = null;
  return mixUv(paint(vd, lin(color)), slot);
}

function boxVD(w: number, h: number, d: number, r: number, t: Parameters<typeof place>[1], seg = 1): VertexData {
  const vd = roundedBox(w, h, d, r, seg);
  vd.uvs = null;
  return place(vd, t);
}

// Key points (front +Z).
const SHOULDER_X = 0.74;
const SHOULDER_Y = 1.58;
const ELBOW: V3 = [0.86, 1.18, 0.3];
const HAND: V3 = [0.8, 1.05, 0.72];
const HIP_X = 0.33;
const CHEST = { y: 1.32, w: 1.3, h: 0.95, d: 0.84 };
const HEAD = { y: 1.97, w: 0.66, h: 0.5, d: 0.58 };

function body(): VertexData {
  const p: VertexData[] = [];
  // Wide feet (the rubber soles are trim).
  for (const s of [-1, 1]) p.push(grey(boxVD(0.42, 0.16, 0.66, 0.07, { x: s * HIP_X, y: 0.12, z: 0.06 }), G.foot));
  // Hips and the barrel chest (a soft pillow box, a darker skirt band at the bottom).
  p.push(grey(pillow(0.98, 0.26, 0.6, { y: 0.74 }, 0.3, 8), G.hip));
  p.push(grey(pillow(CHEST.w, CHEST.h, CHEST.d, { y: CHEST.y }, 0.22, 12), G.chest));
  p.push(grey(pillow(CHEST.w + 0.05, 0.1, CHEST.d + 0.05, { y: CHEST.y - CHEST.h / 2 + 0.06 }, 0.3, 12), G.chestDark));
  // Shoulder caps, upper arms, mitt hands held forward.
  for (const s of [-1, 1]) {
    p.push(grey(sphere([s * SHOULDER_X, SHOULDER_Y, 0], 0.2, 10, 5), G.chestDark));
    p.push(
      grey(
        limb([s * (SHOULDER_X + 0.04), SHOULDER_Y - 0.08, 0.0], [s * ELBOW[0], ELBOW[1], ELBOW[2]], 0.13, 0.11, 8, {
          hi: false,
        }),
        G.arm,
      ),
    );
    p.push(grey(boxVD(0.26, 0.24, 0.3, 0.09, { x: s * HAND[0], y: HAND[1], z: HAND[2] }), G.mitt));
    p.push(
      grey(boxVD(0.08, 0.1, 0.16, 0.03, { x: s * (HAND[0] - 0.13), y: HAND[1] + 0.06, z: HAND[2] + 0.04 }, 0), G.mitt),
    );
  }
  // Head with its visor band.
  p.push(grey(pillow(HEAD.w, HEAD.h, HEAD.d, { y: HEAD.y }, 0.2, 8), G.head));
  p.push(grey(boxVD(HEAD.w * 0.86, 0.17, 0.05, 0.03, { y: HEAD.y + 0.02, z: HEAD.d / 2 - 0.005 }), G.visor));
  // A mouth grille moulded under the visor.
  for (const x of [-0.12, -0.04, 0.04, 0.12])
    p.push(grey(boxVD(0.04, 0.09, 0.03, 0.01, { x, y: HEAD.y - 0.15, z: HEAD.d / 2 }, 0), G.visor + 0.2));
  return mergeParts(p);
}

function trim(): VertexData {
  const p: VertexData[] = [];
  // Rubber soles and piston legs.
  for (const s of [-1, 1]) {
    p.push(part(boxVD(0.44, 0.05, 0.68, 0.02, { x: s * HIP_X, y: 0.025, z: 0.06 }, 0), C.sole, MIX.rubber));
    p.push(part(limb([s * HIP_X, 0.2, 0], [s * HIP_X, 0.66, 0], 0.13, 0.13, 10, { hi: false }), C.tin, MIX.brass));
    p.push(part(place(lathe(ringProf(0.16, 0.05), 10), { x: s * HIP_X, y: 0.4 }), C.tinDark, MIX.brass));
  }
  // The chest gears: a big one in a porthole, a smaller one meshing up and to the right.
  const front = CHEST.d / 2 + 0.005;
  p.push(
    part(
      place(lathe(ringProf(0.34, 0.04), 20), { rx: Math.PI / 2, y: CHEST.y, z: front - 0.02 }),
      C.brassDark,
      MIX.brass,
    ),
  );
  p.push(
    part(place(gearVD(0.29, 0.24, 14, 0.05), { rx: Math.PI / 2, y: CHEST.y, z: front + 0.03 }), C.brass, MIX.brass),
  );
  p.push(
    part(place(lathe(hubProf(0.08, 0.05), 10), { rx: Math.PI / 2, y: CHEST.y, z: front + 0.03 }), C.tin, MIX.brass),
  );
  p.push(
    part(
      place(gearVD(0.15, 0.115, 9, 0.05), { rx: Math.PI / 2, x: 0.36, y: CHEST.y + 0.27, z: front }),
      C.brass,
      MIX.brass,
    ),
  );
  p.push(
    part(
      place(lathe(hubProf(0.04, 0.04), 8), { rx: Math.PI / 2, x: 0.36, y: CHEST.y + 0.27, z: front }),
      C.tin,
      MIX.brass,
    ),
  );
  // Brass star on the chest's left, rivet rows on the front corners.
  const st = star(0.11, 0.045, 0.016);
  p.push(part(place(st, { rx: Math.PI / 2, x: -0.4, y: CHEST.y + 0.26, z: front - 0.01 }), C.brass, MIX.brass));
  for (const s of [-1, 1])
    for (let k = 0; k < 4; k++)
      p.push(part(sphere([s * 0.56, CHEST.y - 0.32 + k * 0.2, front - 0.06], 0.028, 5, 2), C.brass, MIX.brass));
  // Bolted shoulder joints and tin forearms.
  for (const s of [-1, 1]) {
    p.push(
      part(
        place(lathe(hubProf(0.12, 0.07), 10), { rz: -s * (Math.PI / 2), x: s * (SHOULDER_X + 0.17), y: SHOULDER_Y }),
        C.brass,
        MIX.brass,
      ),
    );
    p.push(part(sphere([s * ELBOW[0], ELBOW[1], ELBOW[2]], 0.12, 10, 5), C.tinDark, MIX.brass));
    p.push(
      part(
        limb([s * ELBOW[0], ELBOW[1], ELBOW[2]], [s * HAND[0], HAND[1], HAND[2] - 0.14], 0.085, 0.08, 8, { hi: false }),
        C.tin,
        MIX.brass,
      ),
    );
  }
  // Lamp eyes in brass rims, ear dishes, the antenna and its bead.
  const hz = HEAD.d / 2 + 0.02;
  for (const s of [-1, 1]) {
    p.push(
      part(
        place(lathe(ringProf(0.085, 0.03), 12), { rx: Math.PI / 2, x: s * 0.15, y: HEAD.y + 0.02, z: hz - 0.01 }),
        C.brass,
        MIX.brass,
      ),
    );
    p.push(part(sphere([s * 0.15, HEAD.y + 0.02, hz], 0.068, 12, 4, [1, 1, 0.45]), C.lamp, MIX.plastic));
    p.push(
      part(
        place(lathe(dishProf(0.13), 10), { rz: -s * (Math.PI / 2), x: s * (HEAD.w / 2 + 0.005), y: HEAD.y }),
        C.brass,
        MIX.brass,
      ),
    );
  }
  p.push(
    part(
      limb([0, HEAD.y + HEAD.h / 2 - 0.02, -0.05], [0, HEAD.y + HEAD.h / 2 + 0.2, -0.05], 0.022, 0.018, 6, {
        hi: false,
      }),
      C.tinDark,
      MIX.brass,
    ),
  );
  p.push(part(sphere([0, HEAD.y + HEAD.h / 2 + 0.23, -0.05], 0.06, 8, 4), C.brass, MIX.brass));
  // The key's collar on the back.
  p.push(
    part(
      place(lathe(hubProf(0.11, 0.06), 12), { rx: -Math.PI / 2, y: WINDUP_KEY.y, z: WINDUP_KEY.z + 0.06 }),
      C.brassDark,
      MIX.brass,
    ),
  );
  return mergeParts(p);
}

// A flat ring profile (washer / rim) of radius r, height h.
function ringProf(r: number, h: number): [number, number][] {
  return [
    [r * 0.78, 0],
    [r, 0],
    [r, h],
    [r * 0.78, h],
    [r * 0.78, 0],
  ];
}
// A domed hub / bolt head of radius r, height h, closed at the top.
function hubProf(r: number, h: number): [number, number][] {
  return [
    [r, 0],
    [r, h * 0.6],
    [r * 0.7, h],
    [0, h * 1.05],
  ];
}
// A shallow dish (ear) facing +Y.
function dishProf(r: number): [number, number][] {
  return [
    [0, 0],
    [r * 0.4, 0.01],
    [r, 0.06],
    [r * 0.94, 0.075],
    [r * 0.35, 0.03],
    [0, 0.025],
  ];
}

// The key at the origin, shaft along -Z: a stem, a collar and a butterfly bow of two rings.
function key(): VertexData {
  const p: VertexData[] = [];
  p.push(
    part(
      place(
        lathe(
          [
            [0.05, 0],
            [0.05, 0.16],
            [0.075, 0.18],
            [0.075, 0.24],
            [0, 0.25],
          ],
          10,
        ),
        { rx: -Math.PI / 2 },
      ),
      C.brass,
      MIX.brass,
    ),
  );
  for (const s of [-1, 1]) {
    const ring = CreateTorusVertexData({ diameter: 0.34, thickness: 0.085, tessellation: 10 });
    p.push(part(place(scale3(ring, 1, 1, 0.8), { rx: Math.PI / 2, x: s * 0.2, z: -0.26 }), C.brass, MIX.brass));
  }
  return mergeParts(p);
}

// ---------- AO, cache, meshes ----------
const AO_OPTS = { samples: 16, maxDist: 0.5, strength: 0.65, maxTriangles: 8000 };
const AO_BAKED: Record<'body' | 'trim', string> = {
  body: 'H4ap3ABSUroAdXXcMJeX3EGXqdwwl5fcMJeX3FKXl+7c/9zc3Nyputzuy9zu7u7cQQ0NHzAAAAAwAAAAUjAwMFIwMDCXl5eXl5eXl+7u7txBDQ0fl5eXhqmpqanc/9zcH5ep7g2Xl/8Nl5f/MJeX7jCGl8sNdXWpH2RkqVKGhtzL7u7uqbq6/6nc3P/c7u7uMA0NHw0AAA0fAAANUjAwMFIwMDCGl5eXhpeXl9zu7u4wDQ0fhpeXl5epqanL7u7ulwD/hgAAlwD/hgAAl8v/qQAAl7r/ugAAlwD/lwAAlwDulwAAl8v/qQAAl7r/ugAAlwD/hgAAAKnuANwAAJe6AMsAAKm6ussAANyXhssAAMuXl7oAAMvcy8sAALq6ANwAAKnuAO4AAMv//9wAALr//9wAAMv//7oAAKn//8sAAKnuANwAAKnuulLuAJfcdWTuALrul2TuALruqYbuALrul2TuALr/l2TuALrudXXuAJfuqWTuAKnuy2TuALr/3GTuAKn/y2TuAKnuunXuAKnuulLuAIa6ZJfcAGR1QbrcAADc3O7/AADc////AADc3P//AAAAAP//AADc7v//AO7////uALq63O7uAGR1QbruAIa6ZJfcAAAAAAAAAAAAywAAAP8AAAAAAAAAAAAAAAAAAAAAAAAAAAAA3KmGuv/Ly+7/7gAA///u7v/u3Mv////////////////Lqam6////7v///wD////u/+7u3P//////////////////////////////7v///+7/7u7c7gAAqdwAAIbLqam6y8v//wCGANyGy9z/AMsA/wD/3P8Ay4bLAAAAAP/uAAC63P/uAADL///uAAC6y+7uAGRkMMvcAIa6ZKnuAGR1MLrcAKm67tzcANz////uAADc3P/uAAAAAP/uAAAAAAD/AAAAugAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA7tzc3P///////////////9y6l4bu7tzc/+4AAP//7tyGqbrc3P///wD////c////3O7/7u7/////////////////////////7v///9z////c7v/uugAA3JcAANyGqbrcAKkA3Lq6//+6qf/cugD/AP8A/9y6ALqp7peX7v/L7pdk///L7oaG7v/L7nWp7v/L7peG7u7L7oZ17u7L7mTL///L7obc///L7peX7v/LQXWXuobLy/+Gy8v/qe7u/0GGqcuXy9z/l8vc/8v////Lhpe6/9zc///c3P//////QR8NQZdSQYaXUkGGy7qGqcu6hqn/7tzu///u7v////9BHw1BhjAAdakwMJfLhpe6ZEEfqYYwDakwQamphmQNHw0fqamGZDBBUjAfulIwMJcwMJe6UlIwHzAfl7pSUjAwQUENqVJBMJdBQZepUkEwDTANl6lSQUFBdTANulJSMJdSMJe6UnUwDTANl7pSdVIw',
  trim: 'H7ofujDcMMvcusu6MB8wHzAfy7owH9y6AAANAAAADQAAAAAAAAAAAAAAywAAAMsAAADLAAAAAAAAAAAAAAANAAAADQAAdVIAAACGlwAAAKm6AAAAl9wAAAC63AAAALrcAAAAutwAAAC63AAAALq6AAAAl2QAAAB1UgAAH8sfyx/LH8vLy8vLHx8fHx8fy8sfH8vLAADLAAAAugAAAAAAAAAAAAAADQ0AAA0AAAANAAAAAAAAAAAAAACpAAAAywAAussAAAC6ywAAAKnLAAAAhroAAACGhgAAAFIwAAAAl3UAAAC6ugAAAMvLAAAAussAAAC6ywAAAA3/MAAAMNwwALoN7gBkqUH/H2SXAO5SZIYA7jBkhgDuAGSXQf8wZKkf/0FSADDLAAAAH9wwAAAw/1IAyw3uAHXLZO4Adbof/0F1qQ3/MHXLDf8AdbpSqTBkuh8AUmQADdwAAAAN/zAAAP//7v//////////////////////////////7v//////////////////////////////////////AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAhpdkH9zuhpeplx9BurpBQYaXZB+pupeXuoYfUpepQUGXumQwurqGl7qGMGSpqUFBhqlkMLq6hoaphjBkqalBQYapZDDLy4aGqZcwZKmXQUGGqWQw3LqXl6mXMHXLukFBl5dkMLq6dWSGlzB1qZdkQYapZDDLy3WGl4YwdampZEGXumQwurqGdamXMGSpl2RBhqlkH7q6hoaplzB1qZdkQYaXdR+6y4Z1qZcfUpeXZEGGl3Ufuql1hpd1MFKGhmRBhpdkH5eGH0GXhh9BdXVSH3V1MA2pqYZkupcwZLq6QUENAP//HwD//wAA//8AAP//AADu/wAA7v8AAO7/AAD//wAA//8AAP//DQD/////////////////7u7u3Nzu7tzu//////////////////////8wDR8fHx8fDQAAAAAAAAAAAAAAAA0NHx8NHzAwMEEwQTBBQUEwutzcl9zLusuphlJkust1l5e6upeXl4aXdYYwZKmpdYaXqamGl5d1dWRSAA1kdQ0wdYYAMDAwAAAwUgAAQVIAAFIfAAAwUgAAl4ZSdYZ1ZEFkZEEfl6mXl8uphsuXhoaGhoZkQcvLuqncuqncuqnLy6mphlLu7u7u3KmGurrL7ty6y7p17tzc3MuXdZfL3JeXQQAAAA0AAAAAAAAAAAAAAAAAAAANAAAAUgAAAEEAAABBAAAA//////////////+6qZepl5eXZNy6usupy9yXurqXurq6y6lkdTBSdXWGZHVkQVJSUkENulJk7sup3KmXy6l1hh9BulJkhlJSuty6upephmR1ZAAwhlJSUlJkuu7cusvcdWSXHw1SUlJkUmSX3O7c3Nz/dXW6HzCXUmSX3KmX3Mupy7qXdQ0wukFS3KmXqYaXy8u6l6l1ZAANZDBSqYaXhpfLqe7cl5eGQQ1BUh9ShpfLqdzc3O7udXWXHx9kQUG6qdzc3P///+7////c////y////2Tc//+X3P//7v///+7////u/////////9z////uy4aGAADu3ACpywD/AAC67gD/AADu/wD/7v///wD/////AAD////uAADu7u4AAADuy5cAAADuumQAAADuy4aGAAAAAKkAAADuAAAA/wAAAO4AAAAAAAAAAAAAAAAAAAAAAAAAqQCX3P//ZMv//7r////u////7v///+7////u////7v///+7////L7v//l9z///////8AAP/u7v//ANwAANz/AP8AAMvuAO6pALq6AO66UmQAAO66UgAAAO7clwAAANzc7gAAAP///9wAAP////8AAAAAAAAAANwAAAD/AAAA3AAAAMsAAAAAAAAAAAAAAAAAAAAAAAAAy5cAAAC6ugAAAJeXAAAfl6kAAACpugAAAO66AAAA7ssAAADuqQAAAP+pAACX/7oAAADulwAAAMupAAAAy5cAAAAAAAAAAJcAAADc/+4AANz//wAAy//cAAAAhgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADYbcl6kAAIbcl5cADXXcqboAAGTLussAAB+6y8sAAADLy8sAAB/LuroAAHXLuroAAJfLuroAAJfLqakADYbcl6kAANyXAAAAy7oAAACplwAAAIapAAAAdboAAACpugAAALrLAAAA3KkAAADcqQAAl/+6AAAA/5cAAADuqQAAANyXAAAAAAAAAACXAAAA3P/uAADc//8AAMvc3AAAAIYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAy8vLAAAfy7q6AABky7q6AAB1y7q6AACGy6mpAA2G3JepAACp3JeXAA2X3Km6AAB1y7rLAAANusvLAAAAy8vLAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB17v//AJfu//8Ahu7//wB17v//AIbc//8Al+7//wCX////ALr///8Ade7//0EN//8fAP//HwD//x8A//8fAP//QQ3//zAA//8fDf//DQD//w0A//8NAP//MAD//0EN//8=',
};
const AO_CHECK: Record<'body' | 'trim', number> = { body: 8478696, trim: 16504100 };

let cached: { body: VertexData; trim: VertexData; key: VertexData } | null = null;

function geometry(): { body: VertexData; trim: VertexData; key: VertexData } {
  if (!cached) {
    const [b, t] = bakedParts(
      'championWindup',
      [body(), trim()],
      [
        { b64: AO_BAKED.body, check: AO_CHECK.body },
        { b64: AO_BAKED.trim, check: AO_CHECK.trim },
      ],
      AO_OPTS,
    );
    // Metal: keep the trim's bake gentle (occlusion mostly darkens reflections).
    const c = t.colors as Float32Array | number[];
    const raw = trim().colors as ArrayLike<number>;
    for (let i = 0; i < c.length; i++) if (i % 4 !== 3) c[i] = raw[i] - (raw[i] - c[i]) * 0.6;
    cached = { body: cloneVD(b), trim: cloneVD(t), key: cloneVD(key()) };
  }
  return cached;
}

// Tool: recomputes AO_BAKED / AO_CHECK (run through vite's ssrLoadModule).
export function championWindupAOTable(): {
  baked: Record<'body' | 'trim', string>;
  check: Record<'body' | 'trim', number>;
} {
  const parts = [body(), trim()];
  const f = bakeAOFactors(parts, AO_OPTS);
  return {
    baked: { body: encodeAO(f[0]), trim: encodeAO(f[1]) },
    check: { body: aoChecksum(parts[0].positions as number[]), trim: aoChecksum(parts[1].positions as number[]) },
  };
}

export function championWindupTriangles(): { body: number; trim: number; key: number } {
  const g = geometry();
  const n = (vd: VertexData): number => (vd.indices as ArrayLike<number>).length / 3;
  return { body: n(g.body), trim: n(g.trim), key: n(g.key) };
}

function setup(mesh: Mesh, look: Look): Mesh {
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.doNotSyncBoundingInfo = true;
  look.addShadowCaster(mesh, 'crowd');
  look.receiveShadows(mesh);
  return mesh;
}

export function createChampionWindup(scene: Scene, look: Look): ChampionWindupMeshes {
  const g = geometry();
  const plastic = look.material('army-plastic', () => armyPlasticMaterial(scene));
  const mix = look.material('toy-mix', () => mixedToyMaterial(scene));
  return {
    body: setup(buildMesh(scene, 'championWindupBody', cloneVD(g.body), plastic), look),
    trim: setup(buildMesh(scene, 'championWindupTrim', cloneVD(g.trim), mix), look),
    key: setup(buildMesh(scene, 'championWindupKey', cloneVD(g.key), mix), look),
  };
}

// ---------- preview ----------
// Two of opts.team clanking along (one turned to show the key) and one of the other team.
export function preview(scene: Scene, look: Look, opts: PreviewOptions): PreviewResult {
  const m = createChampionWindup(scene, look);
  return keyedPreview(
    scene,
    'championWindupRoot',
    [
      { mesh: m.body, team: true, key: false },
      { mesh: m.trim!, team: false, key: false },
      { mesh: m.key, team: false, key: true },
    ],
    [
      { x: -1.4, z: 0, yaw: 0, s: 1, frost: 0 },
      { x: 1.4, z: 0.3, yaw: Math.PI - 0.7, s: 1, frost: 0 },
    ],
    HOP_STYLE.windup,
    WINDUP_KEY,
    opts.team,
    1.12,
  );
}
