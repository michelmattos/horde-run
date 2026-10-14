// Thin-instance crowd renderer: one low-poly mesh per UnitKind, team colour via a
// per-instance 'color' buffer, matrices rewritten every frame from the SimView.
// Units are little plastic toy soldiers (one colour each, like real army men): a base
// plate, legs, torso, head, helmet and a rifle held upright, so the same mesh reads
// the same for both armies without turning it. The whole crowd is three draw calls
// (mobs, champions, champion trim); buffers grow geometrically and nothing is
// allocated per frame in steady state.
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { CreateCylinderVertexData } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateBoxVertexData } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { Matrix } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { SimView } from '../contracts.ts';
import { LAYOUT, Team, UnitKind } from '../contracts.ts';
import { PALETTE } from './palette.ts';

const MOB_HEIGHT = 0.9;
const CHAMPION_HEIGHT = 2.0;
const BOB_HEIGHT = 0.1; // stand-in for baked vertex animation
const BOB_SPEED = 12;
const INITIAL_CAPACITY = 1024;

class InstanceBatch {
  readonly mesh: Mesh;
  private matrices: Float32Array;
  private colors: Float32Array;
  private capacity = 0;
  count = 0;

  constructor(mesh: Mesh) {
    this.mesh = mesh;
    this.matrices = new Float32Array(0);
    this.colors = new Float32Array(0);
    this.ensureCapacity(INITIAL_CAPACITY);
  }

  ensureCapacity(n: number): void {
    if (n <= this.capacity) return;
    let cap = Math.max(this.capacity, INITIAL_CAPACITY);
    while (cap < n) cap *= 2;
    this.capacity = cap;
    this.matrices = new Float32Array(cap * 16);
    this.colors = new Float32Array(cap * 4);
    // Scale + translation matrices only; the constant entries are written once here.
    for (let i = 0; i < cap; i++) this.matrices[i * 16 + 15] = 1;
    this.mesh.thinInstanceSetBuffer('matrix', this.matrices, 16, false);
    this.mesh.thinInstanceSetBuffer('color', this.colors, 4, false);
    this.mesh.thinInstanceCount = 0;
  }

  write(x: number, y: number, z: number, s: number, r: number, g: number, b: number): void {
    const m = this.matrices;
    const o = this.count * 16;
    m[o] = s;
    m[o + 5] = s;
    m[o + 10] = s;
    m[o + 12] = x;
    m[o + 13] = y;
    m[o + 14] = z;
    const c = this.colors;
    const p = this.count * 4;
    c[p] = r;
    c[p + 1] = g;
    c[p + 2] = b;
    c[p + 3] = 1;
    this.count++;
  }

  commit(): void {
    this.mesh.thinInstanceCount = this.count;
    this.mesh.isVisible = this.count > 0;
    if (this.count > 0) {
      this.mesh.thinInstanceBufferUpdated('matrix');
      this.mesh.thinInstanceBufferUpdated('color');
    }
  }
}

// Box part centred at (x, y, z).
function box(w: number, h: number, d: number, x: number, y: number, z: number): VertexData {
  const vd = CreateBoxVertexData({ width: w, height: h, depth: d });
  vd.transform(Matrix.Translation(x, y, z));
  return vd;
}

// Upright cylinder part centred at height y (diameterTop defaults to the diameter).
function cyl(diameter: number, h: number, y: number, tessellation: number, diameterTop = diameter): VertexData {
  const vd = CreateCylinderVertexData({ height: h, diameterBottom: diameter, diameterTop, tessellation });
  vd.transform(Matrix.Translation(0, y, 0));
  return vd;
}

function merge(scene: Scene, name: string, parts: VertexData[]): Mesh {
  const vd = parts[0];
  vd.merge(parts.slice(1));
  const mesh = new Mesh(name, scene);
  vd.applyToMesh(mesh);
  return mesh;
}

export class CrowdRenderer {
  private readonly mob: InstanceBatch;
  private readonly champion: InstanceBatch;
  private readonly championTrim: InstanceBatch;
  private readonly material: StandardMaterial;

  constructor(scene: Scene) {
    // White diffuse so the instance colour shows through unchanged.
    this.material = new StandardMaterial('crowdMat', scene);
    this.material.diffuseColor = new Color3(1, 1, 1);
    this.material.emissiveColor = new Color3(0.22, 0.22, 0.22);
    this.material.specularColor = Color3.Black();
    this.material.freeze();

    this.mob = new InstanceBatch(this.buildMob(scene));
    this.champion = new InstanceBatch(this.buildChampion(scene));
    this.championTrim = new InstanceBatch(this.buildChampionTrim(scene));
  }

  private finish(mesh: Mesh): Mesh {
    mesh.material = this.material;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true; // instances span the lane; never cull by the base mesh bounds
    mesh.doNotSyncBoundingInfo = true;
    mesh.freezeWorldMatrix();
    return mesh;
  }

  // Mob: a toy soldier on its base plate, feet at y = 0, radius LAYOUT.mobRadius.
  private buildMob(scene: Scene): Mesh {
    const h = MOB_HEIGHT;
    const r = LAYOUT.mobRadius;
    const parts = [
      cyl(r * 1.8, h * 0.07, h * 0.035, 8), // base plate
      box(r * 1.05, h * 0.36, r * 0.62, 0, h * 0.25, 0), // legs
      box(r * 1.3, h * 0.33, r * 0.72, 0, h * 0.595, 0), // torso
      box(r * 0.72, h * 0.2, r * 0.72, 0, h * 0.86, 0), // head
      cyl(r * 1.1, h * 0.1, h * 0.99, 8, r * 0.78), // helmet
      box(r * 0.24, h * 0.62, r * 0.24, r * 0.82, h * 0.6, 0), // rifle, held upright
    ];
    return this.finish(merge(scene, 'mob', parts));
  }

  // Champion (the Sergeant): a big toy soldier, radius LAYOUT.championRadius. Its gold
  // helmet, shoulder boards and belt live in a second batch (buildChampionTrim) drawn
  // with the same matrices, so team colour and gold stay separate at one extra draw call.
  private buildChampion(scene: Scene): Mesh {
    const r = LAYOUT.championRadius;
    const h = CHAMPION_HEIGHT;
    const parts = [
      cyl(r * 1.7, h * 0.05, h * 0.025, 10), // base plate
      box(r * 0.95, h * 0.34, r * 0.6, 0, h * 0.22, 0), // legs
      box(r * 1.25, h * 0.32, r * 0.75, 0, h * 0.55, 0), // torso
      box(r * 0.32, h * 0.32, r * 0.36, -r * 0.8, h * 0.55, 0), // arms
      box(r * 0.32, h * 0.32, r * 0.36, r * 0.8, h * 0.55, 0),
      box(r * 0.62, h * 0.18, r * 0.62, 0, h * 0.8, 0), // head
    ];
    return this.finish(merge(scene, 'champion', parts));
  }

  private buildChampionTrim(scene: Scene): Mesh {
    const r = LAYOUT.championRadius;
    const h = CHAMPION_HEIGHT;
    const parts = [
      cyl(r * 1.0, h * 0.09, h * 0.93, 10, r * 0.72), // helmet
      box(r * 0.42, h * 0.05, r * 0.5, -r * 0.8, h * 0.73, 0), // shoulder boards
      box(r * 0.42, h * 0.05, r * 0.5, r * 0.8, h * 0.73, 0),
      box(r * 1.3, h * 0.05, r * 0.8, 0, h * 0.42, 0), // belt
    ];
    return this.finish(merge(scene, 'championTrim', parts));
  }

  update(view: SimView, time: number): void {
    const n = view.count;
    this.mob.ensureCapacity(n);
    this.champion.ensureCapacity(n);
    this.championTrim.ensureCapacity(n);
    this.mob.count = 0;
    this.champion.count = 0;
    this.championTrim.count = 0;
    const gr = PALETTE.gold.r;
    const gg = PALETTE.gold.g;
    const gb = PALETTE.gold.b;
    const { posX, posZ, team, kind, radius } = view;
    const pr = PALETTE.player.r;
    const pg = PALETTE.player.g;
    const pb = PALETTE.player.b;
    const er = PALETTE.enemy.r;
    const eg = PALETTE.enemy.g;
    const eb = PALETTE.enemy.b;
    for (let i = 0; i < n; i++) {
      const isChampion = kind[i] === UnitKind.Champion;
      const base = isChampion ? LAYOUT.championRadius : LAYOUT.mobRadius;
      const s = radius[i] > 0 ? radius[i] / base : 1;
      const bob = Math.abs(Math.sin(time * BOB_SPEED + i)) * BOB_HEIGHT * s;
      const batch = isChampion ? this.champion : this.mob;
      if (team[i] === Team.Player) batch.write(posX[i], bob, posZ[i], s, pr, pg, pb);
      else batch.write(posX[i], bob, posZ[i], s, er, eg, eb);
      if (isChampion) this.championTrim.write(posX[i], bob, posZ[i], s, gr, gg, gb);
    }
    this.mob.commit();
    this.champion.commit();
    this.championTrim.commit();
  }

  dispose(): void {
    this.mob.mesh.dispose();
    this.champion.mesh.dispose();
    this.championTrim.mesh.dispose();
    this.material.dispose();
  }
}
