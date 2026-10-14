// Thin-instance crowd renderer: classic green-vs-tan plastic army men (models/soldier.ts
// and models/champion.ts). Mobs are riflemen striding forward, the champion is a big
// kneeling bazooka sergeant with gold chevrons (a second 'trim' mesh drawn with the same
// matrices). One mesh per unit kind for both armies: the shared 'army-plastic' PBR
// material has a white albedo and the team colour comes from a per-instance LINEAR
// 'color' buffer. Matrices are rewritten every frame from the SimView with a little
// "hop" (bounce, forward lean and waddle, phase-offset per unit) like a kid hopping the
// toys along. The whole crowd is three draw calls (+ the same in the shadow pass on the
// high and medium tiers); buffers grow geometrically and nothing is allocated per frame
// in steady state. On the 'low' tier the crowd leaves the shadow map and gets soft blob
// shadows instead (one more draw call).
//
// Load: the synchronous fallback meshes (lite soldier, low champion) are drawn from the
// first frame; the full meshes replace them as soon as their promises resolve (a few
// ms; the champion fetches its baked AO file once).
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { SimView } from '../contracts.ts';
import { LAYOUT, Team, UnitKind } from '../contracts.ts';
import type { Look } from './look/index.ts';
import { createBlobShadowMesh, teamColor } from './look/index.ts';
import { createSoldierFallback, createSoldierMesh } from './models/soldier.ts';
import { createChampionFallback, createChampionMeshes } from './models/champion.ts';
import type { ChampionMeshes } from './models/champion.ts';
import { writeTRS } from './fxLogic.ts';

// Hop: |sin| bounce with a forward lean on each hop and a side-to-side waddle.
const HOP_HEIGHT = 0.11;
const HOP_SPEED = 10;
const HOP_LEAN = 0.16; // radians at the top of a hop (positive pitch tips the +Z front down)
const WADDLE = 0.1; // radians of roll either side
const CHAMPION_BRIGHT = 1.12; // the champion is moulded a shade lighter so he pops
// ±4% per-instance brightness (art direction section 3): neighbouring figures separate
// instead of reading as one continuous plastic band. Keyed by sim index (swap-remove
// keeps most indices stable; a moved unit changes shade by a few percent at most).
const SHADE_VARIATION = 0.04;
const SHADES = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  SHADES[i] = 1 + SHADE_VARIATION * (((h >>> 0) / 0xffffffff) * 2 - 1);
}
const INITIAL_CAPACITY = 1024;
// The figures (authored facing +Z) stand three-quarter on to the lane camera rather than
// square: a profile shows the helmet, the rifle and the striding legs, the army-man
// silhouette, where a straight back view is just a green blob. Player toys face up the
// lane, the tan army faces down it (toward the camera).
const PLAYER_YAW = -0.7;
const ENEMY_YAW = Math.PI + 0.55;
// Blob shadow footprints (low tier), in units of the instance scale.
const MOB_BLOB = { x: 1.05, z: 1.2 }; // the radial falloff leaves a soft dark core about the size of the base plate
const CHAMP_BLOB = { x: 2.1, z: 2.4 };

class InstanceBatch {
  mesh: Mesh;
  private matrices = new Float32Array(0);
  private colors: Float32Array | null;
  private capacity = 0;
  count = 0;

  constructor(mesh: Mesh, withColor = true) {
    this.mesh = mesh;
    this.colors = withColor ? new Float32Array(0) : null;
    this.ensureCapacity(INITIAL_CAPACITY);
  }

  get matrixData(): Float32Array {
    return this.matrices;
  }

  // Swap in a new mesh (fallback -> full model): the buffers move over.
  setMesh(mesh: Mesh): void {
    const old = this.mesh;
    this.mesh = mesh;
    this.attach();
    old.dispose();
  }

  ensureCapacity(n: number): void {
    if (n <= this.capacity) return;
    let cap = Math.max(this.capacity, INITIAL_CAPACITY);
    while (cap < n) cap *= 2;
    this.capacity = cap;
    this.matrices = new Float32Array(cap * 16);
    if (this.colors) this.colors = new Float32Array(cap * 4);
    for (let i = 0; i < cap; i++) this.matrices[i * 16 + 15] = 1;
    this.attach();
  }

  private attach(): void {
    this.mesh.thinInstanceSetBuffer('matrix', this.matrices, 16, false);
    if (this.colors) this.mesh.thinInstanceSetBuffer('color', this.colors, 4, false);
    // Never compile the material with zero instances (Babylon would leave the instance
    // colour attribute off for good): keep one instance and hide the mesh instead.
    this.mesh.thinInstanceCount = Math.max(1, this.count);
    this.mesh.isVisible = this.count > 0;
  }

  // Scale s, roll (Z), pitch (X), yaw (Y), translate; colour (linear).
  write(x: number, y: number, z: number, s: number, pitch: number, roll: number, yaw: number, r: number, g: number, b: number): void {
    writeTRS(this.matrices, this.count * 16, x, y, z, s, s, s, yaw, pitch, roll);
    const c = this.colors;
    if (c) {
      const p = this.count * 4;
      c[p] = r;
      c[p + 1] = g;
      c[p + 2] = b;
      c[p + 3] = 1;
    }
    this.count++;
  }

  // Flat footprint (blob shadow): scale (sx, 1, sz), yaw only.
  writeFlat(x: number, z: number, sx: number, sz: number, yaw: number): void {
    writeTRS(this.matrices, this.count * 16, x, 0, z, sx, 1, sz, yaw, 0, 0);
    this.count++;
  }

  commit(): void {
    this.mesh.thinInstanceCount = Math.max(1, this.count);
    this.mesh.isVisible = this.count > 0;
    if (this.count > 0) {
      this.mesh.thinInstanceBufferUpdated('matrix');
      if (this.colors) this.mesh.thinInstanceBufferUpdated('color');
    }
  }

  dispose(): void {
    this.mesh.dispose();
  }
}

export class CrowdRenderer {
  private readonly mob: InstanceBatch;
  private readonly champion: InstanceBatch;
  private trim: InstanceBatch | null = null;
  private readonly blobs: InstanceBatch;
  private readonly look: Look;
  private readonly playerColor = teamColor('player');
  private readonly enemyColor = teamColor('enemy');
  private disposed = false;

  constructor(scene: Scene, look: Look) {
    this.look = look;
    const lite = createSoldierFallback(scene, look);
    look.addShadowCaster(lite, 'crowd');
    look.receiveShadows(lite);
    this.mob = new InstanceBatch(lite);
    const low = createChampionFallback(scene, look);
    this.champion = new InstanceBatch(low.body);
    this.useTrim(low);
    const blob = createBlobShadowMesh(scene, 'crowdBlobs', 0.62);
    blob.alwaysSelectAsActiveMesh = true;
    blob.doNotSyncBoundingInfo = true;
    this.blobs = new InstanceBatch(blob, false);

    void createSoldierMesh(scene, look).then((m) => {
      if (this.disposed) return void m.dispose();
      look.receiveShadows(m);
      this.mob.setMesh(m);
    });
    void createChampionMeshes(scene, look).then((c) => {
      if (this.disposed) {
        c.body.dispose();
        c.trim?.dispose();
        return;
      }
      this.champion.setMesh(c.body);
      this.useTrim(c);
    });
  }

  private useTrim(c: ChampionMeshes): void {
    this.trim?.dispose();
    this.trim = c.trim ? new InstanceBatch(c.trim, false) : null;
  }

  update(view: SimView, time: number): void {
    const n = view.count;
    const trim = this.trim;
    const blobs = this.look.settings.crowdShadows ? null : this.blobs;
    this.mob.ensureCapacity(n);
    this.champion.ensureCapacity(n);
    trim?.ensureCapacity(n);
    blobs?.ensureCapacity(n);
    this.mob.count = 0;
    this.champion.count = 0;
    if (trim) trim.count = 0;
    this.blobs.count = 0;
    const pc = this.playerColor;
    const ec = this.enemyColor;
    const pr = pc.r, pg = pc.g, pb = pc.b;
    const er = ec.r, eg = ec.g, eb = ec.b;
    const cb = CHAMPION_BRIGHT;
    const { posX, posZ, team, kind, radius } = view;
    for (let i = 0; i < n; i++) {
      const isChampion = kind[i] === UnitKind.Champion;
      const base = isChampion ? LAYOUT.championRadius : LAYOUT.mobRadius;
      const s = radius[i] > 0 ? radius[i] / base : 1;
      // Phase from time and position: stable per unit (the sim reorders its arrays) and
      // varied across the crowd, so the army hops along out of step.
      const x = posX[i];
      const z = posZ[i];
      const phase = time * HOP_SPEED + z * 1.9 + x * 3.7;
      const sn = Math.sin(phase);
      const hop = Math.abs(sn);
      const player = team[i] === Team.Player;
      const yaw = player ? PLAYER_YAW : ENEMY_YAW;
      if (isChampion) {
        const y = hop * HOP_HEIGHT * s * 0.6;
        const lean = hop * HOP_LEAN * 0.4;
        const roll = sn * WADDLE * 0.5;
        if (player) this.champion.write(x, y, z, s, lean, roll, yaw, pr * cb, pg * cb, pb * cb);
        else this.champion.write(x, y, z, s, lean, roll, yaw, er * cb, eg * cb, eb * cb);
        trim?.write(x, y, z, s, lean, roll, yaw, 1, 1, 1);
        blobs?.writeFlat(x, z, CHAMP_BLOB.x * s, CHAMP_BLOB.z * s, yaw);
      } else {
        const y = hop * HOP_HEIGHT * s;
        const v = SHADES[i & 255];
        if (player) this.mob.write(x, y, z, s, hop * HOP_LEAN, sn * WADDLE, yaw, pr * v, pg * v, pb * v);
        else this.mob.write(x, y, z, s, hop * HOP_LEAN, sn * WADDLE, yaw, er * v, eg * v, eb * v);
        blobs?.writeFlat(x, z, MOB_BLOB.x * s, MOB_BLOB.z * s, yaw);
      }
    }
    this.mob.commit();
    this.champion.commit();
    trim?.commit();
    this.blobs.commit();
  }

  dispose(): void {
    this.disposed = true;
    this.mob.dispose();
    this.champion.dispose();
    this.trim?.dispose();
    this.blobs.dispose();
  }
}
