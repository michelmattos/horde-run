// Igloo (World 2 enemy spawner, DefenderKind 'igloo'): a toy snow-block igloo that lets
// penguins and snowmen out of its door until it is knocked down. A slightly oval dome of
// five courses of packed-snow blocks (grooved joints, staggered like real blocks, baked
// darker in the seams and toward the ground) with a rounded key block on top, and an
// arched entrance tunnel with a deep dark doorway on its front (+Z; side 'enemy', so in
// the game the door faces the camera). It soaks damage in three stages: intact; blocks
// knocked out of the top courses with the dark inside showing and snow rubble at the
// foot; caved in, the upper dome gone. A hit flashes it and pops its scale; a release
// pops it (squash and stretch) while effects puff snow out of the door.
//
// GAME API (defenders.ts):
//   const kit = createIglooKit(scene, look);       // once a level has igloos; dispose with the level
//   const ig = kit.create(view.width, view.depth); // footprint of the sim's igloo
//   ig.root.position.set(x, 0, z); ig.root.rotation.y = Math.PI;
//   ig.setDamage(1 - hp / maxHp);                  // true when the stage changed (throw debris)
//   ig.setHit(k); ig.setPop(k);                    // 0..1, decay them yourself
//   ig.topY(); ig.doorZ;                           // HP bar height; door front (local +Z)
//   ig.dispose(); kit.dispose();
// Draw calls: every igloo shares three stage sources (InstancedMesh, one PBR snow
// material 'igloo-snow' with vertex colours) plus an instanced contact blob: at most 4.
// Triangles: ~2.6k intact. Shadows: instances cast; the sources receive.
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import '@babylonjs/core/Meshes/instancedMesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type { Look } from '../look/index.ts';
import {
  buildMesh,
  createBlobShadowMesh,
  fixWinding,
  lin,
  mergeParts,
  paint,
  place,
  plasticMaterial,
  roundedBox,
} from '../look/index.ts';
import type { ModelInfo, PreviewOptions, PreviewResult } from '../look/model.ts';
import { noise, rng } from './environment.ts';

export const info: ModelInfo = {
  key: 'igloo',
  title: 'Igloo spawner: snow-block dome with an entrance tunnel',
  instanced: true,
  teams: false,
  side: 'enemy',
  height: 1.7,
  triangleBudget: 3200,
  gameZ: 36,
  variants: ['intact', 'damaged'],
};

// Reference footprint the geometry is built for (sim default: 0.75 x wall width, 1.6 deep).
const REF_W = 3;
const REF_D = 1.6;
const RX = 1.42; // dome radii
const RZ = 0.92;
const RY = 1.5;
const COURSES = 5;
const SEG = 56; // around
const DOOR_W = 0.44; // tunnel half width
const DOOR_H = 0.88;
const TUNNEL_LEN = 0.62;
const POP = 0.07;

function snowMaterial(scene: Scene, look: Look): PBRMaterial {
  return look.material('igloo-snow', () =>
    plasticMaterial(scene, null, {
      name: 'igloo-snow',
      roughness: 0.66,
      clearcoat: 0.18,
      clearcoatRoughness: 0.3,
      texture: 'paper',
      normalStrength: 0.45,
      envIntensity: 0.85,
    }),
  );
}

interface DomeOpts {
  removed: (course: number, block: number) => boolean;
  cave: number; // 0 intact .. 1: courses above (COURSES - 1) * (1 - cave) are flattened away
}

// The dome: courses of blocks between elevation rings. Groove rows at each course edge are
// pulled inward and darkened; vertical joints (staggered per course) darken the vertices
// nearest them. Quads of removed blocks are skipped (the inner shell shows through).
function dome(o: DomeOpts): VertexData {
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const snow = lin('#e9eff3');
  const seam = lin('#b8c9d6');
  const rows: { phi: number; groove: boolean; course: number }[] = [];
  for (let c = 0; c < COURSES; c++) {
    const a0 = (c / COURSES) * (Math.PI / 2) * 0.93;
    const a1 = ((c + 1) / COURSES) * (Math.PI / 2) * 0.93;
    const g = (a1 - a0) * 0.12;
    rows.push({ phi: a0, groove: true, course: c });
    rows.push({ phi: a0 + g, groove: false, course: c });
    rows.push({ phi: (a0 + a1) / 2, groove: false, course: c });
    rows.push({ phi: a1 - g, groove: false, course: c });
  }
  rows.push({ phi: (Math.PI / 2) * 0.93, groove: true, course: COURSES - 1 });
  const vid = (r: number, s: number): number => r * (SEG + 1) + s;
  const blocksIn = (c: number): number => Math.max(4, Math.round(15 * Math.cos(((c + 0.5) / COURSES) * (Math.PI / 2))));
  for (let r = 0; r < rows.length; r++) {
    const { phi, groove, course } = rows[r];
    const n = blocksIn(course);
    const off = (course % 2) * 0.5;
    for (let s = 0; s <= SEG; s++) {
      const th = (s / SEG) * Math.PI * 2;
      // Distance (in blocks) to the nearest vertical joint of this course.
      const bpos = (th / (Math.PI * 2)) * n + off;
      const dj = Math.abs(bpos - Math.round(bpos));
      const inset = groove ? 0.035 : dj < 0.06 ? 0.02 : 0;
      const lump = 1 + 0.02 * (noise(th * 3, phi * 5, 41) - 0.5);
      const cp = Math.cos(phi);
      const nx = Math.cos(th) * cp;
      const nz = Math.sin(th) * cp;
      const ny = Math.sin(phi);
      const k = 1 - inset;
      pos.push(nx * RX * k * lump, ny * RY * k * lump, nz * RZ * k * lump);
      // Ellipsoid normal.
      const ex = nx / RX;
      const ey = ny / RY;
      const ez = nz / RZ;
      const l = Math.hypot(ex, ey, ez) || 1;
      nrm.push(ex / l, ey / l, ez / l);
      const ground = 0.78 + 0.22 * Math.min(1, phi / 0.35);
      const isSeam = groove || dj < 0.06;
      const c = isSeam ? seam : snow;
      const shade = ground * (0.97 + 0.06 * noise(th * 4, phi * 7 + course, 43));
      col.push(c.r * shade, c.g * shade, c.b * shade, 1);
    }
  }
  const caveAbove = o.cave > 0 ? Math.floor((COURSES - 1) * (1 - o.cave)) : COURSES;
  for (let r = 0; r < rows.length - 1; r++) {
    const course = rows[r].course;
    if (course > caveAbove) continue;
    const n = blocksIn(course);
    const off = (course % 2) * 0.5;
    for (let s = 0; s < SEG; s++) {
      const thMid = ((s + 0.5) / SEG) * Math.PI * 2;
      // Leave the doorway open: the tunnel covers the dome's front between |x| < DOOR_W.
      const fx = Math.cos(thMid) * RX;
      const fz = Math.sin(thMid);
      const phiMid = (rows[r].phi + rows[r + 1].phi) / 2;
      if (fz > 0.5 && Math.abs(fx) < DOOR_W * 0.9 && Math.sin(phiMid) * RY < DOOR_H * 0.92) continue;
      const block = Math.floor((thMid / (Math.PI * 2)) * n + off) % n;
      if (o.removed(course, block)) continue;
      const a = vid(r, s);
      const b = vid(r, s + 1);
      const c = vid(r + 1, s + 1);
      const d = vid(r + 1, s);
      idx.push(a, b, c, a, c, d);
    }
  }
  // Key block cap.
  const top = pos.length / 3;
  if (o.cave === 0 && !o.removed(COURSES, 0)) {
    pos.push(0, RY * 1.0, 0);
    nrm.push(0, 1, 0);
    col.push(snow.r, snow.g, snow.b, 1);
    const last = rows.length - 1;
    for (let s = 0; s < SEG; s++) idx.push(top, vid(last, s + 1), vid(last, s));
  }
  const vd = new VertexData();
  vd.positions = pos;
  vd.normals = nrm;
  vd.colors = col;
  vd.indices = idx;
  return fixWinding(vd);
}

// The dark inside: a slightly smaller shell facing inward, seen through knocked-out blocks.
function innerShell(): VertexData {
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  const ROWS = 6;
  for (let r = 0; r <= ROWS; r++) {
    const phi = (r / ROWS) * (Math.PI / 2);
    for (let s = 0; s <= 24; s++) {
      const th = (s / 24) * Math.PI * 2;
      const nx = Math.cos(th) * Math.cos(phi);
      const nz = Math.sin(th) * Math.cos(phi);
      const ny = Math.sin(phi);
      pos.push(nx * RX * 0.86, ny * RY * 0.86, nz * RZ * 0.82);
      nrm.push(-nx, -ny, -nz);
    }
  }
  for (let r = 0; r < ROWS; r++)
    for (let s = 0; s < 24; s++) {
      const a = r * 25 + s;
      idx.push(a, a + 1, a + 26, a, a + 26, a + 25);
    }
  const vd = new VertexData();
  vd.positions = pos;
  vd.normals = nrm;
  vd.indices = idx;
  fixWinding(vd);
  return paint(vd, lin('#2b3644'));
}

// Entrance tunnel along +Z: an arch (straight walls, round top) of snow blocks with
// grooved rings, a dark doorway set back inside, and a floor lip.
function tunnel(): VertexData {
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const snow = lin('#e6edf2');
  const seam = lin('#b5c6d3');
  const T = 0.2; // wall thickness
  const z0 = RZ * 0.55;
  const z1 = RZ + TUNNEL_LEN;
  const wallH = DOOR_H - DOOR_W;
  // Outer arch profile around the opening (x, y, outward normal x, y).
  const prof: [number, number, number, number][] = [];
  const R = DOOR_W + T;
  prof.push([-R, 0, -1, 0], [-R, wallH, -1, 0]);
  for (let i = 1; i < 10; i++) {
    const a = Math.PI - (i / 10) * Math.PI;
    prof.push([Math.cos(a) * R, wallH + Math.sin(a) * R, Math.cos(a), Math.sin(a)]);
  }
  prof.push([R, wallH, 1, 0], [R, 0, 1, 0]);
  const rings: number[] = [];
  const nr = 5;
  for (let k = 0; k <= nr; k++) rings.push(z0 + ((z1 - z0) * k) / nr);
  const np = prof.length;
  rings.forEach((z, k) => {
    const groove = k > 0 && k < nr && k % 2 === 0;
    for (const [x, y, nx, ny] of prof) {
      const g = groove ? 0.97 : 1;
      pos.push(x * g, y * g, z);
      nrm.push(nx, ny, 0);
      const c = groove ? seam : snow;
      const s = 0.8 + 0.2 * Math.min(1, y / 0.4);
      col.push(c.r * s, c.g * s, c.b * s, 1);
    }
  });
  for (let k = 0; k < nr; k++)
    for (let i = 0; i < np - 1; i++) {
      const a = k * np + i;
      idx.push(a, a + 1, a + np + 1, a, a + np + 1, a + np);
    }
  // Front face: the ring between the outer arch and the opening.
  const inner: [number, number][] = [];
  inner.push([-DOOR_W, 0], [-DOOR_W, wallH]);
  for (let i = 1; i < 10; i++) {
    const a = Math.PI - (i / 10) * Math.PI;
    inner.push([Math.cos(a) * DOOR_W, wallH + Math.sin(a) * DOOR_W]);
  }
  inner.push([DOOR_W, wallH], [DOOR_W, 0]);
  const f0 = pos.length / 3;
  for (let i = 0; i < np; i++) {
    pos.push(prof[i][0], prof[i][1], z1);
    nrm.push(0, 0, 1);
    col.push(snow.r, snow.g, snow.b, 1);
    pos.push(inner[i][0], inner[i][1], z1);
    nrm.push(0, 0, 1);
    col.push(snow.r * 0.92, snow.g * 0.92, snow.b * 0.92, 1);
  }
  for (let i = 0; i < np - 1; i++) {
    const a = f0 + i * 2;
    idx.push(a, a + 2, a + 3, a, a + 3, a + 1);
  }
  const vd = new VertexData();
  vd.positions = pos;
  vd.normals = nrm;
  vd.colors = col;
  vd.indices = idx;
  fixWinding(vd);
  // The doorway: a dark arch-shaped panel set back inside the tunnel, darker at the top.
  const door: number[] = [];
  const dn: number[] = [];
  const dc: number[] = [];
  const di: number[] = [];
  const dz = z1 - 0.38;
  const dark = lin('#1f2833');
  door.push(0, wallH * 0.6, dz);
  dn.push(0, 0, 1);
  dc.push(dark.r, dark.g, dark.b, 1);
  for (const [x, y] of inner) {
    door.push(x * 0.98, y * 0.98, dz);
    dn.push(0, 0, 1);
    const k = 0.7 + 0.3 * (1 - y / DOOR_H);
    dc.push(dark.r * k, dark.g * k, dark.b * k, 1);
  }
  for (let i = 1; i < inner.length; i++) di.push(0, i, i + 1);
  // Inside walls of the tunnel (dark, facing in).
  const iw = door.length / 3;
  for (const z of [dz, z1]) {
    for (const [x, y] of inner) {
      door.push(x, y, z);
      const l = Math.hypot(x, y - wallH) || 1;
      dn.push(-x / l, y > wallH ? -(y - wallH) / l : 0, 0);
      const k = z === z1 ? 0.75 : 0.35;
      const c = lin('#9fb3c4');
      dc.push(c.r * k, c.g * k, c.b * k, 1);
    }
  }
  for (let i = 0; i < inner.length - 1; i++) {
    const a = iw + i;
    const b = iw + inner.length + i;
    di.push(a, a + 1, b + 1, a, b + 1, b);
  }
  const dvd = new VertexData();
  dvd.positions = door;
  dvd.normals = dn;
  dvd.colors = dc;
  dvd.indices = di;
  fixWinding(dvd);
  return mergeParts([vd, dvd]);
}

// Snow rubble at the foot of a damaged igloo (rounded lumps and a few broken blocks).
function rubble(n: number, seed: number): VertexData[] {
  const r = rng(seed);
  const out: VertexData[] = [];
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    const s = 0.16 + r() * 0.18;
    const b = roundedBox(s * 1.5, s, s * 1.1, s * 0.3, 1);
    place(b, {
      x: Math.cos(a) * (RX + 0.15),
      y: s / 2 - 0.02,
      z: Math.sin(a) * (RZ + 0.2),
      ry: r() * 3,
      rz: (r() - 0.5) * 0.7,
    });
    out.push(paint(b, lin('#dfe7ed').scale(0.9 + r() * 0.1)));
  }
  return out;
}

function stageGeometry(stage: 0 | 1 | 2): VertexData {
  const r = rng(17 + stage);
  const knocked = new Set<string>();
  if (stage >= 1) {
    // Blocks knocked out of the upper courses, front-right first (seen by the camera).
    for (const [c, b] of [
      [3, 0],
      [3, 1],
      [4, 1],
      [2, 1],
      [4, 0],
      [COURSES, 0],
    ] as const)
      knocked.add(`${c}:${b}`);
    for (let i = 0; i < 2; i++) knocked.add(`${2 + Math.floor(r() * 2)}:${Math.floor(r() * 8)}`);
  }
  const parts = [dome({ removed: (c, b) => knocked.has(`${c}:${b}`), cave: stage === 2 ? 0.55 : 0 }), tunnel()];
  if (stage >= 1) parts.push(innerShell(), ...rubble(stage === 1 ? 6 : 12, 90 + stage));
  return mergeParts(parts);
}

let geometryCache: [VertexData, VertexData, VertexData] | null = null;
function stages(): [VertexData, VertexData, VertexData] {
  geometryCache ??= [stageGeometry(0), stageGeometry(1), stageGeometry(2)];
  return geometryCache;
}

// Damage stage for a damage fraction: 0 under 40%, 1 under 75%, then 2.
export function iglooStage(damage: number): 0 | 1 | 2 {
  return damage < 0.4 ? 0 : damage < 0.75 ? 1 : 2;
}

export interface IglooModel {
  root: TransformNode;
  readonly doorZ: number; // local +Z of the door's front
  setDamage(frac: number): boolean;
  setHit(k: number): void;
  setPop(k: number): void;
  topY(): number;
  dispose(): void;
}
export interface IglooKit {
  root: TransformNode;
  create(width: number, depth: number): IglooModel;
  dispose(): void;
}

export function createIglooKit(scene: Scene, look: Look): IglooKit {
  const mat = snowMaterial(scene, look);
  const kitRoot = new TransformNode('iglooKit', scene);
  const sources: Mesh[] = stages().map((vd, i) => {
    const m = buildMesh(scene, `iglooStage${i}`, vd.clone(), mat);
    m.parent = kitRoot;
    m.registerInstancedBuffer('color', 4);
    m.instancedBuffers.color = new Color4(1, 1, 1, 1);
    m.isVisible = false;
    look.receiveShadows(m);
    return m;
  });
  const blobSrc = createBlobShadowMesh(scene, 'iglooBlob', 0.5);
  blobSrc.parent = kitRoot;
  blobSrc.isVisible = false;
  let serial = 0;
  const live = new Set<IglooModel>();

  const create = (width: number, depth: number): IglooModel => {
    const id = ++serial;
    const root = new TransformNode(`igloo${id}`, scene);
    const body = new TransformNode(`igloo${id}Body`, scene);
    body.parent = root;
    const sx = Math.max(0.6, width / REF_W);
    const sz = Math.max(0.6, depth / REF_D);
    body.scaling.set(sx, 1, sz);
    const inst: InstancedMesh[] = sources.map((s, i) => {
      const m = s.createInstance(`igloo${id}s${i}`);
      m.parent = body;
      m.setEnabled(i === 0);
      look.addShadowCaster(m);
      return m;
    });
    const blob = blobSrc.createInstance(`igloo${id}Blob`);
    blob.parent = root;
    blob.scaling.set(RX * 2 * sx + 0.8, 1, (RZ * 2 + TUNNEL_LEN) * sz + 0.6);
    blob.position.z = (TUNNEL_LEN / 2) * sz;
    let stage = 0;
    let hit = 0;
    let pop = 0;
    const scale = (): void => {
      const p = pop;
      body.scaling.set(
        sx * (1 + hit * 0.04 + p * POP),
        1 + hit * 0.06 - p * POP * 1.2,
        sz * (1 + hit * 0.04 + p * POP),
      );
    };
    const model: IglooModel = {
      root,
      doorZ: (RZ + TUNNEL_LEN) * sz,
      setDamage(frac: number): boolean {
        const s = iglooStage(Math.min(1, Math.max(0, frac)));
        if (s === stage) return false;
        inst[stage].setEnabled(false);
        inst[s].setEnabled(true);
        stage = s;
        return true;
      },
      setHit(k: number): void {
        const h = Math.min(1, Math.max(0, k));
        if (h === hit) return;
        hit = h;
        const c = 1 + h * 0.6;
        for (const m of inst) (m.instancedBuffers.color as Color4).set(c * 0.96, c, c * 1.04, 1);
        scale();
      },
      setPop(k: number): void {
        const p = Math.min(1, Math.max(0, k));
        if (p === pop) return;
        pop = p;
        scale();
      },
      topY(): number {
        return (stage === 2 ? RY * 0.62 : RY) * body.scaling.y;
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
      for (const m of Array.from(live)) m.dispose();
      kitRoot.dispose();
    },
  };
}

// ---------- preview ----------
export function preview(scene: Scene, look: Look, opts: PreviewOptions): PreviewResult {
  const root = new TransformNode('iglooPreview', scene);
  const old = look.theme;
  look.setTheme('freezer');
  const kit = createIglooKit(scene, look);
  kit.root.parent = root;
  const damaged = opts.variant === 'damaged';
  const igloos = (damaged ? [0, 0.5, 0.9] : [0]).map((d, i, all) => {
    const m = kit.create(REF_W, REF_D);
    m.root.parent = root;
    m.root.position.x = (i - (all.length - 1) / 2) * 3.8;
    m.setDamage(d);
    return m;
  });
  return {
    root,
    update(time: number) {
      // A release pop every 2 s.
      const t = time % 2;
      const k = t < 0.35 ? Math.sin((t / 0.35) * Math.PI) : 0;
      for (const m of igloos) m.setPop(k);
    },
    dispose() {
      kit.dispose();
      root.dispose();
      look.setTheme(old);
    },
  };
}
