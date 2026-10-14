// Pooled one-shot effects: an expanding ring where units pass a gate and a small dust
// puff where the two crowds clash. A fixed set of meshes is reused round-robin, so
// spawning an effect never allocates.
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { PALETTE } from './palette.ts';
import { unlitMaterial } from './materials.ts';

const RING_COUNT = 8;
const PUFF_COUNT = 8;
const RING_LIFE = 0.4;
const PUFF_LIFE = 0.35;
const PUFF_MIN_INTERVAL = 0.06; // clash events arrive by the dozen; throttle the puffs

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
  }

  private reset(fx: Fx): void {
    fx.life = 0;
    fx.mesh.isVisible = false;
  }

  dispose(): void {
    for (const fx of this.rings) fx.mesh.dispose();
    for (const fx of this.puffs) fx.mesh.dispose();
    this.ringGood.dispose();
    this.ringBad.dispose();
    this.puffMat.dispose();
  }
}
