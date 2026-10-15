// The home base village: five toy buildings on the play rug (barracks, block walls,
// workshop, garden, flagpole), each at one of four tiers (src/home/villagePieces.ts).
// Static pieces of the whole village are merged into one mesh per material (plastic,
// varnished wood, felt, paper, tin, brass: six draw calls), with ambient occlusion baked
// per building and tier (box AO, a few ms) and cached for the session. When a building
// gains a tier its new pieces drop in, lowest first, with a squash on landing; then the
// village re-merges and `onLanded` fires (the home scene puts a confetti puff there).
// Nothing moves once a build has finished.
//
// GAME API
//   const v = createVillage(scene, look, { onLanded(id, x, y, z) {...} });
//   v.setTiers({ barracks: 2, walls: 1, ... }, animate);  // animate: drop in what is new
//   v.update(dt)          // per frame while it returns true (a build is running)
//   v.tiers               // tiers as currently shown (the target tiers once a build starts)
//   v.triangles           // triangles of the merged static meshes (budget check)
//   v.dispose()
// Pivot: village space = the rug, x = 0 its centre, the parade ground at z = 0; front
// toward the camera (-Z). Every static mesh casts and receives shadows.
import type { Scene } from '@babylonjs/core/scene';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Look } from '../../render/look/index.ts';
import {
  brassMaterial,
  buildMesh,
  fabricMaterial,
  paperMaterial,
  place,
  plasticMaterial,
  tinMaterial,
  woodMaterial,
} from '../../render/look/index.ts';
import type { ModelInfo, PreviewOptions, PreviewResult } from '../../render/look/model.ts';
import { bakePieces, cloneData, mergeByMaterial } from './pieceGeometry.ts';
import { BUILDING_IDS, PIECE_MATS, PLOTS, clampTier, piecesAt, tierDiff } from '../villagePieces.ts';
import type { BuildingId, Piece, PieceMat } from '../villagePieces.ts';
import { dropGroups, dropPose, dropSchedule, buildingBounds } from '../villageMath.ts';

export const info: ModelInfo = {
  key: 'village',
  title: 'Home base village (5 buildings, 4 tiers)',
  instanced: false,
  teams: false,
  side: 'neutral',
  height: 4.2,
  triangleBudget: 40000,
  gameZ: 0,
  variants: ['tier3', 'tier2', 'tier1', 'tier0', 'mixed'],
};

export type Tiers = Record<BuildingId, number>;

export interface VillageModel {
  readonly root: TransformNode;
  readonly tiers: Readonly<Tiers>;
  readonly triangles: number;
  setTiers(t: Partial<Tiers>, animate: boolean): BuildingId[]; // ids whose build animation started
  update(dt: number): boolean; // true while a build animation runs
  dispose(): void;
}

export interface VillageOptions {
  onLanded?(id: BuildingId, x: number, y: number, z: number): void;
}

// ---------- baked geometry, cached per building and tier for the session ----------
const bakeCache = new Map<string, { pieces: Piece[]; data: VertexData[] }>();

function baked(id: BuildingId, tier: number): { pieces: Piece[]; data: VertexData[] } {
  const key = `${id}:${tier}`;
  let b = bakeCache.get(key);
  if (!b) {
    const pieces = piecesAt(id, tier);
    b = { pieces, data: bakePieces(pieces, BUILDING_IDS.indexOf(id) * 31 + tier) };
    bakeCache.set(key, b);
  }
  return b;
}

export function villageMaterials(scene: Scene, look: Look): Record<PieceMat, Material> {
  // Colour comes from the vertex colours (paint x AO), so every albedo is white.
  const brass = look.material('home-brass', () => {
    const m = brassMaterial(scene, { name: 'home-brass' });
    m.albedoColor = Color3.White();
    return m;
  });
  return {
    plastic: look.material('home-plastic', () =>
      plasticMaterial(scene, null, { name: 'home-plastic', clearcoat: 0.3 }),
    ),
    wood: look.material('home-wood', () => woodMaterial(scene, null, { name: 'home-wood' })),
    felt: look.material('home-felt', () => fabricMaterial(scene, null, { name: 'home-felt' })),
    paper: look.material('home-paper', () =>
      paperMaterial(scene, null, { name: 'home-paper', backFaceCulling: false }),
    ),
    tin: look.material('home-tin', () => tinMaterial(scene, null, { name: 'home-tin' })),
    brass,
  };
}

interface DropGroup {
  id: BuildingId;
  meshes: Mesh[];
  anchor: [number, number, number];
  delay: number;
}

interface Build {
  id: BuildingId;
  time: number;
  groups: DropGroup[];
  hidden: Set<Piece>; // pieces that are dropping (left out of the static merge)
}

export function createVillage(scene: Scene, look: Look, opts: VillageOptions = {}): VillageModel {
  const root = new TransformNode('village', scene);
  const mats = villageMaterials(scene, look);
  const tiers: Tiers = { barracks: 0, walls: 0, workshop: 0, garden: 0, flagpole: 0 };
  let statics: Mesh[] = [];
  let triangles = 0;
  const builds = new Map<BuildingId, Build>();

  function rebuild(): void {
    for (const m of statics) m.dispose();
    statics = [];
    triangles = 0;
    const items: { piece: Piece; data: VertexData; dx: number; dz: number }[] = [];
    for (const id of BUILDING_IDS) {
      const b = baked(id, tiers[id]);
      const hidden = builds.get(id)?.hidden;
      const plot = PLOTS[id];
      b.pieces.forEach((piece, i) => {
        if (!hidden?.has(piece)) items.push({ piece, data: b.data[i], dx: plot.x, dz: plot.z });
      });
    }
    const groups = mergeByMaterial(items);
    for (const mat of PIECE_MATS) {
      const vd = groups.get(mat);
      if (!vd || !vd.indices || vd.indices.length === 0) continue;
      const mesh = buildMesh(scene, `village-${mat}`, vd, mats[mat]);
      mesh.parent = root;
      look.addShadowCaster(mesh);
      look.receiveShadows(mesh);
      statics.push(mesh);
      triangles += vd.indices.length / 3;
    }
  }

  // Meshes for one drop group (per material), pivoted at the leader's anchor.
  function groupMeshes(
    id: BuildingId,
    members: number[],
    data: VertexData[],
    pieces: Piece[],
    anchor: number[],
  ): Mesh[] {
    const byMat = new Map<PieceMat, VertexData[]>();
    for (const i of members) {
      const vd = place(cloneData(data[i]), { x: PLOTS[id].x - anchor[0], y: -anchor[1], z: PLOTS[id].z - anchor[2] });
      const list = byMat.get(pieces[i].mat) ?? [];
      list.push(vd);
      byMat.set(pieces[i].mat, list);
    }
    const out: Mesh[] = [];
    for (const [mat, list] of byMat) {
      const m = buildMesh(scene, `village-drop-${mat}`, list, mats[mat]);
      m.parent = root;
      m.position.set(anchor[0], anchor[1], anchor[2]);
      m.setEnabled(false);
      look.addShadowCaster(m);
      out.push(m);
    }
    return out;
  }

  function startBuild(id: BuildingId, from: number, to: number): void {
    builds.get(id)?.groups.forEach((g) => g.meshes.forEach((m) => m.dispose()));
    const b = baked(id, to);
    const added = new Set(tierDiff(id, from, to).added);
    const idx = b.pieces.map((q, i) => (added.has(q) ? i : -1)).filter((i) => i >= 0);
    const sub = idx.map((i) => b.pieces[i]);
    const leaders = dropGroups(sub);
    const members = new Map<number, number[]>();
    leaders.forEach((l, k) => members.set(l, [...(members.get(l) ?? []), idx[k]]));
    const leaderList = [...members.keys()];
    const delays = dropSchedule(leaderList.map((l) => sub[l]));
    const plot = PLOTS[id];
    const groups: DropGroup[] = leaderList.map((l, n) => {
      const q = sub[l];
      const anchor: [number, number, number] = [q.x + plot.x, q.y, q.z + plot.z];
      return { id, meshes: groupMeshes(id, members.get(l) ?? [], b.data, b.pieces, anchor), anchor, delay: delays[n] };
    });
    builds.set(id, { id, time: 0, groups, hidden: added });
  }

  function finishBuild(build: Build): void {
    for (const g of build.groups) for (const m of g.meshes) m.dispose();
    builds.delete(build.id);
    const bb = buildingBounds(build.id, tiers[build.id]);
    opts.onLanded?.(build.id, (bb.min[0] + bb.max[0]) / 2, Math.max(0.6, bb.max[1] * 0.6), (bb.min[2] + bb.max[2]) / 2);
  }

  rebuild(); // every building starts as an empty taped plot

  return {
    root,
    get tiers() {
      return tiers;
    },
    get triangles() {
      return triangles;
    },
    setTiers(next, animate) {
      const started: BuildingId[] = [];
      let changed = false;
      for (const id of BUILDING_IDS) {
        const want = next[id];
        if (want === undefined) continue;
        const t = clampTier(want);
        if (t === tiers[id]) continue;
        changed = true;
        const from = tiers[id];
        tiers[id] = t;
        const running = builds.get(id);
        if (running) {
          for (const g of running.groups) for (const m of g.meshes) m.dispose();
          builds.delete(id);
        }
        // Only a gain with something new to drop animates; a loss (an imported save) snaps.
        if (animate && t > from && tierDiff(id, from, t).added.length > 0) {
          startBuild(id, from, t);
          started.push(id);
        }
      }
      if (changed) rebuild();
      return started;
    },
    update(dt) {
      if (builds.size === 0) return false;
      const finished: Build[] = [];
      for (const build of builds.values()) {
        build.time += dt;
        let done = true;
        for (const g of build.groups) {
          const pose = dropPose(build.time - g.delay);
          for (const m of g.meshes) {
            m.setEnabled(pose.visible);
            m.position.y = g.anchor[1] + pose.y;
            m.scaling.set(pose.sxz, pose.sy, pose.sxz);
          }
          if (!pose.done) done = false;
        }
        if (done) finished.push(build);
      }
      if (finished.length > 0) {
        for (const b of finished) finishBuild(b);
        rebuild();
      }
      return builds.size > 0 || finished.length > 0;
    },
    dispose() {
      for (const b of builds.values()) for (const g of b.groups) for (const m of g.meshes) m.dispose();
      builds.clear();
      root.dispose();
    },
  };
}

// ---------- preview ----------
// Variant tierN shows every building at tier N; 'mixed' shows 0..3 across the buildings
// and replays a build of the barracks every few seconds.
export function preview(scene: Scene, look: Look, opts: PreviewOptions): PreviewResult {
  const root = new TransformNode('villagePreview', scene);
  const v = createVillage(scene, look);
  v.root.parent = root;
  root.rotation.y = Math.PI; // the harness turns 'neutral' models by PI: undo it
  const variant = opts.variant ?? 'tier3';
  const all = (n: number): Tiers => ({ barracks: n, walls: n, workshop: n, garden: n, flagpole: n });
  if (variant === 'mixed') v.setTiers({ barracks: 1, walls: 3, workshop: 2, garden: 1, flagpole: 0 }, false);
  else v.setTiers(all(Number(variant.replace('tier', '')) || 0), false);
  let clock = 0;
  return {
    root,
    update(_time, dt) {
      v.update(dt);
      if (variant !== 'mixed') return;
      clock += dt;
      if (clock > 4) {
        clock = 0;
        const next = (v.tiers.barracks % 3) + 1;
        if (next === 1) v.setTiers({ barracks: 0 }, false);
        v.setTiers({ barracks: next }, true);
      }
    },
    dispose() {
      v.dispose();
      root.dispose();
    },
  };
}
