// Pooled one-shot effects. Gate rings and clash dust are reused meshes; foam darts, debris,
// puffs and the boss phase ring come from fixed particle/tracer pools drawn as two
// thin-instance batches. Spawning an effect never allocates, and no effect ever
// touches the camera: all hit feedback lives on the units, gates, bases and defenders.
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { PALETTE } from './palette.ts';
import { unlitMaterial } from './materials.ts';
import { PropBatch, instanceLitMaterial, instanceUnlitMaterial, unitMesh } from './instances.ts';
import { ParticlePool, TracerPool, mulberry32 } from './fxLogic.ts';

const RING_COUNT = 8;
const PUFF_COUNT = 8;
const RING_LIFE = 0.4;
const PUFF_LIFE = 0.35;
const PUFF_MIN_INTERVAL = 0.06; // clash events arrive by the dozen; throttle the puffs
const PARTICLES = 192;
const TRACERS = 24;
const DART_TIME = 0.15;
const DART_LEN = 0.7;
const DART_FROM_Y = 2.6; // the rifleman on top of a block tower
const DART_TO_Y = 0.5;
const GRAVITY = 18;

interface Fx {
  mesh: Mesh;
  life: number; // seconds left; 0 = idle
  maxLife: number;
  startScale: number;
  endScale: number;
}

export class Effects {
  private readonly rings: Fx[] = [];
  private readonly puffs: Fx[] = [];
  private nextRing = 0;
  private nextPuff = 0;
  private sincePuff = 0;
  private readonly ringGood: StandardMaterial;
  private readonly ringBad: StandardMaterial;
  private readonly puffMat: StandardMaterial;
  private readonly instMats: StandardMaterial[];
  private readonly particles = new ParticlePool(PARTICLES);
  private readonly tracers = new TracerPool(TRACERS);
  private readonly chunkBatch: PropBatch;
  private readonly dartBatch: PropBatch;
  private readonly rand = mulberry32(0x9e3779b9);

  constructor(scene: Scene) {
    this.ringGood = unlitMaterial(scene, 'fxRingGood', new Color3(0.6, 1, 0.7));
    this.ringBad = unlitMaterial(scene, 'fxRingBad', new Color3(1, 0.55, 0.55));
    this.puffMat = unlitMaterial(scene, 'fxPuff', PALETTE.dust);
    this.puffMat.backFaceCulling = false;
    for (const m of [this.ringGood, this.ringBad, this.puffMat]) m.freeze();

    for (let i = 0; i < RING_COUNT; i++) {
      const mesh = CreateTorus('fxRing', { diameter: 1, thickness: 0.12, tessellation: 20 }, scene);
      mesh.material = this.ringGood;
      this.rings.push(this.idle(mesh));
    }
    for (let i = 0; i < PUFF_COUNT; i++) {
      const mesh = CreateDisc('fxPuff', { radius: 0.5, tessellation: 10 }, scene);
      mesh.rotation.x = Math.PI / 2; // lie flat on the lane
      mesh.material = this.puffMat;
      this.puffs.push(this.idle(mesh));
    }

    const lit = instanceLitMaterial(scene, 'fxChunkMat');
    const unlit = instanceUnlitMaterial(scene, 'fxDartMat');
    this.instMats = [lit, unlit];
    this.chunkBatch = new PropBatch(unitMesh(scene, 'fxChunks', 'box'), lit, PARTICLES);
    this.dartBatch = new PropBatch(unitMesh(scene, 'fxDarts', 'box'), unlit, TRACERS);
  }

  private idle(mesh: Mesh): Fx {
    mesh.isPickable = false;
    mesh.isVisible = false;
    return { mesh, life: 0, maxLife: 1, startScale: 1, endScale: 1 };
  }

  gateBurst(x: number, z: number, width: number, positive: boolean): void {
    const fx = this.rings[this.nextRing];
    this.nextRing = (this.nextRing + 1) % RING_COUNT;
    fx.mesh.material = positive ? this.ringGood : this.ringBad;
    fx.mesh.position.set(x, 0.6, z);
    this.start(fx, RING_LIFE, width * 0.5, width * 1.1);
  }

  dust(x: number, z: number): void {
    if (this.sincePuff < PUFF_MIN_INTERVAL) return;
    this.sincePuff = 0;
    const fx = this.puffs[this.nextPuff];
    this.nextPuff = (this.nextPuff + 1) % PUFF_COUNT;
    fx.mesh.position.set(x, 0.08, z);
    this.start(fx, PUFF_LIFE, 0.6, 1.8);
  }

  // A tower's foam dart flies to (tx, tz); a tiny tan puff marks where it lands.
  dart(x: number, z: number, tx: number, tz: number): void {
    this.tracers.spawn(x, z, tx, tz, DART_TIME);
  }

  // Tan toy-block chunks thrown out of a destroyed defender; walls throw more, wider.
  debris(x: number, z: number, wall: boolean, width: number): void {
    const n = wall ? 14 : 10;
    const spread = wall ? width * 0.5 : 0.5;
    const e = PALETTE.enemy;
    const d = PALETTE.enemyDark;
    for (let i = 0; i < n; i++) {
      const dark = i % 3 === 0;
      const a = this.rand() * Math.PI * 2;
      const sp = 2 + this.rand() * 3;
      this.particles.spawn(
        x + (this.rand() * 2 - 1) * spread,
        0.6 + this.rand() * 1.2,
        z + (this.rand() - 0.5) * 0.6,
        Math.cos(a) * sp,
        4 + this.rand() * 4,
        Math.sin(a) * sp,
        0.7 + this.rand() * 0.3,
        0.22 + this.rand() * 0.18,
        dark ? d.r : e.r,
        dark ? d.g : e.g,
        dark ? d.b : e.b,
        GRAVITY,
      );
    }
  }

  // Units that ran past the enemy base: a small grey puff just beyond the lane end.
  missPuff(x: number, z: number): void {
    this.burst(x, z + 0.4, 5, 0.6, 1.2, 0.35, 0.18, 0.62, 0.64, 0.68, 0.4);
  }

  // Gate shards when a one-use gate breaks (green for good ops, red for bad).
  gateShards(x: number, z: number, width: number, good: boolean): void {
    const c = good ? PALETTE.gateGood : PALETTE.gateBad;
    for (let i = 0; i < 10; i++) {
      const px = x + (this.rand() * 2 - 1) * width * 0.5;
      this.particles.spawn(
        px,
        0.4 + this.rand() * 1.2,
        z,
        (px - x) * 1.5,
        2 + this.rand() * 3,
        (this.rand() - 0.3) * 2,
        0.5,
        0.16,
        c.r,
        c.g,
        c.b,
        GRAVITY,
      );
    }
  }

  // Boss phase change: a bright ring of gold and red sparks bursting out of the tank.
  phaseRing(x: number, z: number, width: number): void {
    const n = 28;
    const r = width * 0.35;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const gold = i % 2 === 0;
      this.particles.spawn(
        x + Math.cos(a) * r,
        1.6,
        z + Math.sin(a) * r * 0.6,
        Math.cos(a) * 7,
        3,
        Math.sin(a) * 4,
        0.6,
        0.3,
        gold ? 2.2 : 2.0,
        gold ? 1.7 : 0.5,
        0.4, // colours above 1 overdrive the flat shading so sparks glow
        6,
      );
    }
  }

  private burst(
    x: number,
    z: number,
    n: number,
    speed: number,
    up: number,
    life: number,
    size: number,
    r: number,
    g: number,
    b: number,
    y: number,
  ): void {
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      this.particles.spawn(x, y, z, Math.cos(a) * speed, up * this.rand(), Math.sin(a) * speed, life, size, r, g, b, 0);
    }
  }

  private start(fx: Fx, life: number, from: number, to: number): void {
    fx.life = life;
    fx.maxLife = life;
    fx.startScale = from;
    fx.endScale = to;
    fx.mesh.isVisible = true;
  }

  update(dt: number): void {
    this.sincePuff += dt;
    this.tick(this.rings, dt);
    this.tick(this.puffs, dt);

    const t = this.tracers;
    t.step(dt);
    const e = PALETTE.enemy;
    for (let i = 0; i < t.endedCount; i++)
      this.burst(t.endedX[i], t.endedZ[i], 4, 1.2, 1.5, 0.25, 0.14, e.r * 1.2, e.g, e.b, 0.4);
    this.dartBatch.begin();
    for (let i = 0; i < t.capacity; i++) {
      if (!t.isLive(i)) continue;
      const k = t.progress(i);
      const dx = t.x1[i] - t.x0[i];
      const dz = t.z1[i] - t.z0[i];
      const y = DART_FROM_Y + (DART_TO_Y - DART_FROM_Y) * k + 0.8 * k * (1 - k);
      const yaw = Math.atan2(dx, dz);
      this.dartBatch.write(t.x0[i] + dx * k, y, t.z0[i] + dz * k, 0.13, 0.13, DART_LEN, yaw, 1, 0.55, 0.12); // orange foam dart
    }
    this.dartBatch.commit();

    const p = this.particles;
    p.step(dt);
    this.chunkBatch.begin();
    for (let i = 0; i < p.capacity; i++) {
      if (!p.isLive(i)) continue;
      const s = p.size[i] * (0.35 + 0.65 * p.remaining(i));
      this.chunkBatch.write(p.px[i], p.py[i], p.pz[i], s, s, s, p.px[i] * 3, p.r[i], p.g[i], p.b[i]);
    }
    this.chunkBatch.commit();
  }

  private tick(list: Fx[], dt: number): void {
    for (const fx of list) {
      if (fx.life <= 0) continue;
      fx.life -= dt;
      if (fx.life <= 0) {
        fx.mesh.isVisible = false;
        continue;
      }
      const t = 1 - fx.life / fx.maxLife; // 0 → 1
      const s = fx.startScale + (fx.endScale - fx.startScale) * t;
      fx.mesh.scaling.set(s, s, s);
      fx.mesh.visibility = 0.85 * (1 - t);
    }
  }

  // Hide everything (used when a level is reloaded).
  clear(): void {
    for (const fx of this.rings) this.reset(fx);
    for (const fx of this.puffs) this.reset(fx);
    this.particles.clear();
    this.tracers.clear();
    this.chunkBatch.begin();
    this.chunkBatch.commit();
    this.dartBatch.begin();
    this.dartBatch.commit();
  }

  private reset(fx: Fx): void {
    fx.life = 0;
    fx.mesh.isVisible = false;
  }

  dispose(): void {
    for (const fx of this.rings) fx.mesh.dispose();
    for (const fx of this.puffs) fx.mesh.dispose();
    this.chunkBatch.dispose();
    this.dartBatch.dispose();
    for (const m of [this.ringGood, this.ringBad, this.puffMat, ...this.instMats]) m.dispose();
  }
}
