// The Tin General (World 1 boss): drives the lithographed tin toy of models/tinGeneral.ts.
// On a boss level he and his wind-up tin tank ARE the enemy base: the tank fills the
// base footprint, strafes with BattleState.enemyBaseX (treads roll, the brass key turns),
// the General bobs and looks around in the turret hatch, hits flicker the whole toy and
// a phase change flashes it bright and pops the General. Nothing here moves the camera.
// World 2's Snow Globe Giant (SnowGlobeGiant, below) has the same interface.
import type { Scene } from '@babylonjs/core/scene';
import type { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Look } from './look/index.ts';
import { createTinGeneral } from './models/tinGeneral.ts';
import type { TinGeneralModel } from './models/tinGeneral.ts';
import { ARM_REST, createSnowGlobeGiant } from './models/snowGlobeGiant.ts';
import type { SnowGlobeGiantModel } from './models/snowGlobeGiant.ts';
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

// ---------- The Snow Globe Giant (World 2 boss) ----------
// Drives models/snowGlobeGiant.ts: the music-box snow globe IS the enemy base. Same
// public interface as TinGeneral (integration swaps it in on boss.model 'snowGlobeGiant'),
// plus lob() and the gust hooks. The globe follows the strafing base, the Giant turns on
// his music-box turntable while snow swirls round him, and the phases change the look:
//   phase 0 - lobs: lob() (the battle's 'lob' cue) plays an over-arm throw with the
//             snowball in his mitten, which is scooped up again on the way back;
//   phase 1 - the glass frosts over bright;
//   phase 2 - the globe rocks on its base (the MODEL wobbles, never the camera) and the
//             snow churns: he is the gusts' source. gustWarn()/gust() lean it hard toward
//             the coming push.
// Hits flicker the toy; a phase change flashes it and pops the Giant.
const GLOBE_BASE_HEIGHT = 0.75; // music-box height as a share of the hull height it is given
const LOB_WIND = 0.14; // seconds: arm swings back
const LOB_THROW = 0.2; // seconds: over the top, the ball leaves at the end
const LOB_RETURN = 0.55; // seconds: back to rest, scooping the next ball
const ARM_BACK = 2.4; // radians (hand behind and above the head)
const ARM_FOLLOW = -1.6; // radians (hand forward after the release)
const TURN_SPEED = 0.55;
const TURN_ANGLE = 0.3;
const FROST_EASE = 1.2; // seconds the glass takes to frost over
const WOBBLE = 0.05; // radians of the phase-3 rocking
const GUST_LEAN = 0.12; // radians the globe leans toward a gust

export class SnowGlobeGiant {
  private readonly model: SnowGlobeGiantModel;
  private flash = 0;
  private flashMax = 1;
  private pop = 0;
  private lastFlash = -1;
  private lastPop = -1;
  private stage = 0; // 0-based boss phase
  private frost = 0;
  private lobT = -1; // seconds into the current throw; < 0 = idle
  private shake = 0; // 0..1 rocking strength (eases toward its target)
  private gustDir = 0;
  private gustWarnLeft = 0;
  private gustWarnTotal = 0;
  private gustLeft = 0;

  constructor(scene: Scene, look: Look, width: number, depth: number, hullHeight: number) {
    this.model = createSnowGlobeGiant(scene, look, { width, depth, baseHeight: hullHeight * GLOBE_BASE_HEIGHT });
    this.model.root.rotation.y = Math.PI; // side 'enemy': the Giant faces the camera
  }

  get hpBarAnchor(): Vector3 {
    return this.model.hpBarAnchor;
  }

  get root() {
    return this.model.root;
  }

  // Strong flash and a pop of the Giant on entering a phase. `index`: the bossPhase
  // event's 0-based phase (absent: the next one).
  phase(index?: number): void {
    this.stage = index ?? this.stage + 1;
    this.flash = PHASE_FLASH_TIME;
    this.flashMax = 1;
    this.pop = PHASE_FLASH_TIME;
  }

  hit(): void {
    if (this.flash > HIT_FLASH_TIME) return;
    this.flash = HIT_FLASH_TIME;
    this.flashMax = HIT_FLASH;
  }

  // The battle's 'lob' cue: an over-arm throw (a new cue mid-throw restarts it).
  lob(): void {
    this.lobT = 0;
  }

  // A gust is telegraphed: the globe rocks harder and leans toward dir over `seconds`.
  gustWarn(dir: number, seconds: number): void {
    this.gustDir = Math.sign(dir);
    this.gustWarnTotal = Math.max(0.01, seconds);
    this.gustWarnLeft = this.gustWarnTotal;
  }

  // The push starts: the globe holds its lean and the snow churns for `duration`.
  gust(dir: number, duration: number): void {
    this.gustDir = Math.sign(dir);
    this.gustWarnLeft = 0;
    this.gustLeft = Math.max(0, duration);
  }

  update(x: number, zCenter: number, time: number, dt: number, alive: boolean): void {
    const m = this.model;
    m.root.setEnabled(alive);
    if (!alive) return;
    this.flash = Math.max(0, this.flash - dt);
    this.pop = Math.max(0, this.pop - dt);
    m.root.position.set(x, 0, zCenter);

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

    // Phase 2 on: the glass frosts over (eased so it reads as it happens).
    const frostTarget = this.stage >= 1 ? 1 : 0;
    if (this.frost !== frostTarget) {
      this.frost = Math.max(0, Math.min(1, this.frost + Math.sign(frostTarget - this.frost) * (dt / FROST_EASE)));
      m.setFrost(this.frost);
    }

    // Music-box turntable.
    m.interior.rotation.y = Math.sin(time * TURN_SPEED) * TURN_ANGLE;

    // The throw.
    let ball = true;
    if (this.lobT >= 0) {
      this.lobT += dt;
      const t = this.lobT;
      let a: number;
      if (t < LOB_WIND) a = ARM_REST + (ARM_BACK - ARM_REST) * ease(t / LOB_WIND);
      else if (t < LOB_WIND + LOB_THROW) a = ARM_BACK + (ARM_FOLLOW - ARM_BACK) * ease((t - LOB_WIND) / LOB_THROW);
      else if (t < LOB_WIND + LOB_THROW + LOB_RETURN) {
        a = ARM_FOLLOW + (ARM_REST - ARM_FOLLOW) * ease((t - LOB_WIND - LOB_THROW) / LOB_RETURN);
        ball = t > LOB_WIND + LOB_THROW + LOB_RETURN * 0.7; // scooped up again near the end
      } else {
        a = ARM_REST;
        this.lobT = -1;
      }
      if (t >= LOB_WIND + LOB_THROW * 0.8 && t < LOB_WIND + LOB_THROW) ball = false;
      m.arm.rotation.x = a;
    } else {
      m.arm.rotation.x = ARM_REST + Math.sin(time * 1.7) * 0.06; // idle sway
    }

    // Phase 3: the globe rocks on its base, harder toward a coming or blowing gust.
    this.gustWarnLeft = Math.max(0, this.gustWarnLeft - dt);
    this.gustLeft = Math.max(0, this.gustLeft - dt);
    const warn = this.gustWarnLeft > 0 ? 1 - this.gustWarnLeft / this.gustWarnTotal : 0;
    const blowing = this.gustLeft > 0 ? 1 : 0;
    const target = Math.max(this.stage >= 2 ? 0.5 : 0, warn, blowing);
    this.shake += (target - this.shake) * Math.min(1, dt * 4);
    const lean = this.gustDir * GUST_LEAN * Math.max(warn, blowing);
    // Positive rotation.z tips the top toward local -x, which is the lane's +x once the root
    // is turned by PI: the globe leans the way the gust pushes (dir +1 = right).
    m.globe.rotation.z = this.shake * WOBBLE * 2 * Math.sin(time * 9.5) + lean;
    m.globe.rotation.x = this.shake * WOBBLE * Math.sin(time * 7.1 + 1);
    m.setSnow(dt, Math.max(this.shake, blowing), ball);
  }

  dispose(): void {
    this.model.dispose();
  }
}

// Smoothstep 0..1.
function ease(t: number): number {
  const c = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}
