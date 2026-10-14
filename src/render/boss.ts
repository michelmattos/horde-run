// The Tin General (World 1 boss): drives the lithographed tin toy of models/tinGeneral.ts.
// On a boss level he and his wind-up tin tank ARE the enemy base: the tank fills the
// base footprint, strafes with BattleState.enemyBaseX (treads roll, the brass key turns),
// the General bobs and looks around in the turret hatch, hits flicker the whole toy and
// a phase change flashes it bright and pops the General. Nothing here moves the camera.
import type { Scene } from '@babylonjs/core/scene';
import type { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Look } from './look/index.ts';
import { createTinGeneral } from './models/tinGeneral.ts';
import type { TinGeneralModel } from './models/tinGeneral.ts';
import { popScale } from './fxLogic.ts';

const BOB_SPEED = 3;
const BOB_HEIGHT = 0.06;
const KEY_SPEED = 2.2; // radians per second while the tank is running
const TREAD_IDLE = 0.35; // lane units per second the treads creep while idling in place
const PHASE_FLASH_TIME = 0.6;
const HIT_FLASH_TIME = 0.08;
const HIT_FLASH = 0.5;
const POP = 0.2; // above ~1.2 the coat skirt would pass through the hatch ring

export class TinGeneral {
  private readonly model: TinGeneralModel;
  private flash = 0;
  private flashMax = 1;
  private pop = 0;
  private keyAngle = 0;
  private tread = 0;
  private lastX = Number.NaN;
  private lastFlash = -1;
  private lastPop = -1;

  constructor(scene: Scene, look: Look, width: number, depth: number, hullHeight: number) {
    this.model = createTinGeneral(scene, look, { width, depth, hullHeight });
    this.model.root.rotation.y = Math.PI; // side 'enemy': the General faces the camera
  }

  get hpBarAnchor(): Vector3 {
    return this.model.hpBarAnchor;
  }

  // Root-local anchor -> world, written into `out`.
  get root() {
    return this.model.root;
  }

  // Strong flash and scale pop when the boss enters a new phase.
  phase(): void {
    this.flash = PHASE_FLASH_TIME;
    this.flashMax = 1;
    this.pop = PHASE_FLASH_TIME;
  }

  // Brief flicker when the tank takes a hit (no pop, so phase changes stand out).
  hit(): void {
    if (this.flash > HIT_FLASH_TIME) return;
    this.flash = HIT_FLASH_TIME;
    this.flashMax = HIT_FLASH;
  }

  // (x, zCenter): the hull's centre on the ground; it follows the strafing base.
  update(x: number, zCenter: number, time: number, dt: number, alive: boolean): void {
    const m = this.model;
    m.root.setEnabled(alive);
    if (!alive) return;
    this.flash = Math.max(0, this.flash - dt);
    this.pop = Math.max(0, this.pop - dt);
    m.root.position.set(x, 0, zCenter);

    const dx = Number.isNaN(this.lastX) ? 0 : Math.abs(x - this.lastX);
    this.lastX = x;
    this.tread += dx + TREAD_IDLE * dt;
    m.setTreadPhase(this.tread);

    const f =
      this.flash > 0 ? (this.flash / (this.flashMax === 1 ? PHASE_FLASH_TIME : HIT_FLASH_TIME)) * this.flashMax : 0;
    if (f !== this.lastFlash) {
      m.setFlash(f);
      this.lastFlash = f;
    }
    const sc = popScale(this.pop / PHASE_FLASH_TIME, POP);
    if (sc !== this.lastPop) {
      m.setPop(sc);
      this.lastPop = sc;
    }
    m.general.position.y = m.generalRestY + Math.abs(Math.sin(time * BOB_SPEED)) * BOB_HEIGHT;
    m.general.rotation.y = Math.sin(time * 1.3) * 0.15; // looks around a little

    this.keyAngle += KEY_SPEED * dt;
    m.key.rotation.z = this.keyAngle;
  }

  dispose(): void {
    this.model.dispose();
  }
}
