// The player's cannon: the green plastic toy field cannon (models/cannon.ts, the 'popgun')
// or a loadout variant (models/cannonVariants.ts: the 'repeater' gatling or the
// 'blunderbuss'; World 2's 'snowball-launcher', models/snowballLauncher.ts, whose
// throwing arm is the recoil part: it flings up on every shot) at the player base. It
// follows the game's clamped cannonX (the wooden wheels roll as it slides) and kicks on every shot: the barrel recoils and the carriage
// tips about its trail spade; the repeater's barrel cluster spins while it fires. World 3's
// 'gear-gun' (models/gearGun.ts) ratchets its side gears and crank round one tooth on
// every shot (crowdLogic.gearRatchet, in step with the recoil). Nothing here moves the
// camera.
import type { Scene } from '@babylonjs/core/scene';
import { LAYOUT } from '../contracts.ts';
import type { Look } from './look/index.ts';
import { WHEEL_RADIUS, createCannon } from './models/cannon.ts';
import type { CannonModel } from './models/cannon.ts';
import { createCannonVariant } from './models/cannonVariants.ts';
import { createSnowballLauncher } from './models/snowballLauncher.ts';
import { GEAR_TEETH, createGearGun } from './models/gearGun.ts';
import { gearRatchet } from './crowdLogic.ts';
import type { CannonId } from './crowdLogic.ts';

// The cannon is the player's main tool: drawn 1.4x, with the carriage and wheels widened
// a further 15% so it reads as a chunky toy rather than a thin stick. The root sits so the
// muzzle ends just past LAYOUT.cannonZ (units pop out right under the barrel's mouth) and
// the trail spade tucks against the fort's front wall.
const CANNON_SCALE = 1.4;
const CANNON_WIDEN = 1.15;
const ROOT_Z = LAYOUT.cannonZ - 0.65;
const SPIN_RATE = 14; // rad/s of the repeater's barrels while firing
const SPIN_EASE = 3; // per second: how fast the spin winds up and down

export class Cannon {
  private readonly scene: Scene;
  private readonly look: Look;
  private model: CannonModel & { setSpin?(rad: number): void };
  private id: CannonId = 'popgun';
  private fireRate = 4; // shots per second, from the level
  private lastX = 0;
  private spin = 0;
  private barrelSpin = 0;
  private spinSpeed = 0;
  private shots = 0; // Gear Gun: shots fired so far (fractional: time into the current one)

  constructor(scene: Scene, look: Look) {
    this.scene = scene;
    this.look = look;
    this.model = this.build('popgun');
  }

  private build(id: CannonId): CannonModel & { setSpin?(rad: number): void } {
    const m =
      id === 'popgun'
        ? createCannon(this.scene, this.look)
        : id === 'snowball-launcher'
          ? createSnowballLauncher(this.scene, this.look)
          : id === 'gear-gun'
            ? createGearGun(this.scene, this.look)
            : createCannonVariant(this.scene, this.look, id);
    m.root.scaling.set(CANNON_SCALE * CANNON_WIDEN, CANNON_SCALE, CANNON_SCALE);
    m.root.position.set(this.lastX, 0, ROOT_Z);
    m.setWheelSpin(this.spin);
    return m;
  }

  // Swaps the model (call between battles; a no-op when it is already that cannon).
  setModel(id: CannonId): void {
    if (id === this.id) return;
    this.model.dispose();
    this.id = id;
    this.model = this.build(id);
  }

  get modelId(): CannonId {
    return this.id;
  }

  setFireRate(rate: number): void {
    this.fireRate = rate > 0 ? rate : 4;
  }

  // World position of the muzzle tip at rest (for shot puffs and the barrage flare).
  muzzleX(): number {
    return this.model.root.position.x;
  }
  muzzleY(): number {
    return this.model.muzzle.y * CANNON_SCALE;
  }
  muzzleZ(): number {
    return ROOT_Z + this.model.muzzle.z * CANNON_SCALE;
  }

  update(x: number, time: number, active: boolean, dt = 0): void {
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
    if (this.id === 'gear-gun') {
      // One tooth per shot (in phase with the recoil above); idle, the gears finish their
      // last snap and hold. Whole teeth look alike, so resuming from time is seamless.
      this.shots = active ? time * this.fireRate : Math.ceil(this.shots - 1e-6);
      this.model.setSpin?.(gearRatchet(this.shots, GEAR_TEETH));
    } else if (this.model.setSpin) {
      const target = active ? SPIN_RATE : 0;
      this.spinSpeed += (target - this.spinSpeed) * Math.min(1, dt * SPIN_EASE);
      this.barrelSpin = (this.barrelSpin + this.spinSpeed * dt) % (Math.PI * 2);
      this.model.setSpin(this.barrelSpin);
    }
  }

  dispose(): void {
    this.model.dispose();
  }
}
