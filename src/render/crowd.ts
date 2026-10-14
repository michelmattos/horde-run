// Thin-instance crowd renderer: one low-poly mesh per UnitKind, team colour via a
// per-instance 'color' buffer, matrices rewritten every frame from the SimView.
// The whole crowd is two draw calls; buffers grow geometrically and nothing is
// allocated per frame in steady state.
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
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

export class CrowdRenderer {
  private readonly mob: InstanceBatch;
  private readonly champion: InstanceBatch;
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
  }

  private finish(mesh: Mesh): Mesh {
    mesh.material = this.material;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true; // instances span the lane; never cull by the base mesh bounds
    mesh.doNotSyncBoundingInfo = true;
    mesh.freezeWorldMatrix();
    return mesh;
  }

  // Mob: a 6-sided cylinder with its feet at y = 0, radius LAYOUT.mobRadius.
  private buildMob(scene: Scene): Mesh {
    const vd = CreateCylinderVertexData({ height: MOB_HEIGHT, diameter: LAYOUT.mobRadius * 2, tessellation: 6 });
    vd.transform(Matrix.Translation(0, MOB_HEIGHT / 2, 0));
    const mesh = new Mesh('mob', scene);
    vd.applyToMesh(mesh);
    return this.finish(mesh);
  }

  // Champion: a chunky 8-sided body with a box 'helmet' and crest, radius LAYOUT.championRadius.
  private buildChampion(scene: Scene): Mesh {
    const r = LAYOUT.championRadius;
    const body = CreateCylinderVertexData({ height: CHAMPION_HEIGHT * 0.7, diameterTop: r * 1.5, diameterBottom: r * 2, tessellation: 8 });
    body.transform(Matrix.Translation(0, CHAMPION_HEIGHT * 0.35, 0));
    const helmet = CreateBoxVertexData({ width: r * 1.3, height: CHAMPION_HEIGHT * 0.3, depth: r * 1.3 });
    helmet.transform(Matrix.Translation(0, CHAMPION_HEIGHT * 0.85, 0));
    const crest = CreateBoxVertexData({ width: r * 0.25, height: CHAMPION_HEIGHT * 0.15, depth: r * 1.1 });
    crest.transform(Matrix.Translation(0, CHAMPION_HEIGHT * 1.05, 0));
    body.merge([helmet, crest]);
    const mesh = new Mesh('champion', scene);
    body.applyToMesh(mesh);
    return this.finish(mesh);
  }

  update(view: SimView, time: number): void {
    const n = view.count;
    this.mob.ensureCapacity(n);
    this.champion.ensureCapacity(n);
    this.mob.count = 0;
    this.champion.count = 0;
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
    }
    this.mob.commit();
    this.champion.commit();
  }

  dispose(): void {
    this.mob.mesh.dispose();
    this.champion.mesh.dispose();
    this.material.dispose();
  }
}
