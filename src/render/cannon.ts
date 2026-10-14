// The player's cannon: the green plastic toy field cannon (models/cannon.ts) at the
// player base. It follows the game's clamped cannonX (the wooden wheels roll as it
// slides) and kicks on every shot: the barrel recoils and the carriage tips about its
// trail spade. Nothing here moves the camera.
import type { Scene } from '@babylonjs/core/scene';
import { LAYOUT } from '../contracts.ts';
import type { Look } from './look/index.ts';
import { WHEEL_RADIUS, createCannon } from './models/cannon.ts';
import type { CannonModel } from './models/cannon.ts';

// The cannon is the player's main tool: drawn 1.4x, with the carriage and wheels widened
// a further 15% so it reads as a chunky toy rather than a thin stick. The root sits so the
// muzzle ends just past LAYOUT.cannonZ (units pop out right under the barrel's mouth) and
// the trail spade tucks against the fort's front wall.
const CANNON_SCALE = 1.4;
const CANNON_WIDEN = 1.15;
const ROOT_Z = LAYOUT.cannonZ - 0.65;

export class Cannon {
  private readonly model: CannonModel;
  private fireRate = 4; // shots per second, from the level
  private lastX = 0;
  private spin = 0;

  constructor(scene: Scene, look: Look) {
    this.model = createCannon(scene, look);
    this.model.root.scaling.set(CANNON_SCALE * CANNON_WIDEN, CANNON_SCALE, CANNON_SCALE);
    this.model.root.position.set(0, 0, ROOT_Z);
  }

  setFireRate(rate: number): void {
    this.fireRate = rate > 0 ? rate : 4;
  }

  update(x: number, time: number, active: boolean): void {
    const root = this.model.root;
    root.position.x = x;
    const dx = x - this.lastX;
    this.lastX = x;
    if (dx !== 0 && Math.abs(dx) < 2) {
      this.spin += Math.abs(dx) / (WHEEL_RADIUS * CANNON_SCALE);
      this.model.setWheelSpin(this.spin);
    }
    // Saw-tooth recoil at the fire rate: snap back, ease forward.
    const phase = active ? (time * this.fireRate) % 1 : 1;
    this.model.setRecoil(active ? (1 - phase) * (1 - phase) : 0);
  }

  dispose(): void {
    this.model.dispose();
  }
}
