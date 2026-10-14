// Per-level visuals: the Bedroom Floor (oak floorboards, the indigo play rug as the lane,
// the far wall, the bed and a pool of window light, models/environment.ts), the toys
// scattered beside the rug (models/props.ts via scenery.ts), the gates (toy plastic
// arches with cream sign cards, models/gate.ts), both bases as moulded plastic toy forts
// (models/playerFort.ts / enemyFort.ts) with diegetic HP bars, and on boss levels the Tin
// General on his wind-up tin tank in place of the enemy fort (boss.ts). The enemy base
// can strafe; its fort or tank and its HP bar move with it. Everything here is rebuilt by
// loadLevel and disposed as a unit, so retries never leak meshes or materials (shared
// materials live in the look's cache and are reused across levels).
import type { Scene } from '@babylonjs/core/scene';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { BattleState, GateDef, LevelDef } from '../contracts.ts';
import { LAYOUT, gateLabel, gateX } from '../contracts.ts';
import type { Look } from './look/index.ts';
import { createEnvironment } from './models/environment.ts';
import type { EnvironmentModel } from './models/environment.ts';
import { createGate, gateSlots } from './models/gate.ts';
import type { GateModel } from './models/gate.ts';
import { createPlayerFort } from './models/playerFort.ts';
import type { FortModel as PlayerFortModel } from './models/playerFort.ts';
import { createEnemyFort } from './models/enemyFort.ts';
import type { FortModel as EnemyFortModel } from './models/enemyFort.ts';
import type { PropKit } from './models/props.ts';
import { layoutScenery } from './scenery.ts';
import { TinGeneral } from './boss.ts';
import type { HpBars } from './hpBars.ts';
import { gateBreakAt, hpFraction } from './fxLogic.ts';

const GATE_PULSE_TIME = 0.3;
const BASE_FLASH_TIME = 0.12;
const PHASE_FLASH_TIME = 0.3;
const BOSS_HULL_HEIGHT = 1.4;
const ENEMY_BAR_W = 4;
// The goal at the far end must read at a glance: the tan fort is drawn 1.3x and the Tin
// General's tank 1.7x their base footprint (he should rival the player fort on screen).
// Both grow backwards, so their front edge stays on the lane end where units hit them.
const ENEMY_FORT_SCALE = 1.3;
const BOSS_SCALE = 1.7;

interface GateVisual {
  def: GateDef;
  good: boolean;
  model: GateModel;
  pulse: number; // seconds left
  pulseStrong: boolean;
  usesLeft: number; // -1 = unlimited gate
  breakTime: number; // seconds since it broke; -1 = intact
  hidden: boolean;
}

interface BaseFlash {
  flash: number; // seconds left
  max: number;
  last: number; // last k sent to the model
}

export class LevelVisuals {
  readonly level: LevelDef;
  private readonly root: TransformNode;
  private readonly env: EnvironmentModel;
  private readonly gates: GateVisual[] = [];
  private readonly gateById = new Map<string, GateVisual>();
  private readonly playerFort: PlayerFortModel;
  private readonly enemyFort: EnemyFortModel | null;
  private readonly boss: TinGeneral | null;
  private readonly playerFlash: BaseFlash = { flash: 0, max: BASE_FLASH_TIME, last: -1 };
  private readonly enemyFlash: BaseFlash = { flash: 0, max: BASE_FLASH_TIME, last: -1 };
  private readonly breakOut = { scale: 1, alpha: 1, done: false };
  private readonly anchor = new Vector3();
  private baseX: number;
  private playerHp = 1;
  private enemyHp = 1;
  private lastPlayerDamage = -1;
  private lastEnemyDamage = -1;

  constructor(scene: Scene, look: Look, level: LevelDef, props: PropKit) {
    this.level = level;
    this.baseX = level.enemyBase.x;
    this.root = new TransformNode('level', scene);
    const { width: w, length } = level.lane;

    this.env = createEnvironment(scene, look, {
      laneWidth: w,
      laneLength: length,
      zMin: LAYOUT.playerBaseZ - LAYOUT.playerBaseDepth,
      zMax: length + LAYOUT.enemyBaseDepth,
    });
    this.env.root.parent = this.root;
    scene.clearColor.copyFrom(this.env.clearColor);
    layoutScenery(props, level);

    // Player fort along the bottom of the lane (yaw 0: its front faces up the lane).
    const pd = LAYOUT.playerBaseDepth;
    this.playerFort = createPlayerFort(scene, look, { width: w + 0.36, depth: pd });
    this.playerFort.root.parent = this.root;
    this.playerFort.root.position.set(0, 0, LAYOUT.playerBaseZ - pd / 2);
    this.playerFort.prewarm(); // damage stages now, while the level loads, not mid-battle
    // No in-world bar over the player fort: the HUD shows its HP, and a bar there ran into
    // the cannon.

    // Enemy base: the tan fort, or on a boss level the Tin General's tank (yaw PI: faces the camera).
    const ed = LAYOUT.enemyBaseDepth;
    if (level.boss) {
      this.enemyFort = null;
      this.boss = new TinGeneral(scene, look, level.enemyBase.width, ed, BOSS_HULL_HEIGHT);
      this.boss.root.parent = this.root;
      this.boss.root.scaling.setAll(BOSS_SCALE);
      this.boss.root.position.set(this.baseX, 0, this.enemyCenterZ);
    } else {
      this.boss = null;
      this.enemyFort = createEnemyFort(scene, look, { width: level.enemyBase.width, depth: ed });
      const r = this.enemyFort.root;
      r.parent = this.root;
      r.scaling.setAll(ENEMY_FORT_SCALE);
      r.position.set(this.baseX, 0, this.enemyCenterZ);
      r.rotation.y = Math.PI;
      // Build (and cache) every damage stage now so a stage change never stalls a frame.
      for (const f of [0.3, 0.6, 0.9, 0]) this.enemyFort.setDamage(f);
    }

    const slots = gateSlots(
      level.gates.map((g) => ({ x: g.x, z: g.z, width: g.width, move: g.move })),
      w,
    );
    level.gates.forEach((g, i) => this.buildGate(scene, look, g, slots[i]));
  }

  // Ground z of the enemy fort's / tank's centre (scaled models grow backwards).
  get enemyCenterZ(): number {
    return this.level.lane.length + (LAYOUT.enemyBaseDepth * (this.level.boss ? BOSS_SCALE : ENEMY_FORT_SCALE)) / 2;
  }

  // Highest point of the enemy fort / boss (flag tip, plume) and its z, so the camera can
  // keep it clear of the top HUD.
  farTop(): { y: number; z: number } {
    const root = this.enemyFort ? this.enemyFort.root : this.boss?.root;
    if (!root) return { y: 0, z: this.level.lane.length };
    const { max } = root.getHierarchyBoundingVectors(true);
    return { y: max.y, z: this.enemyCenterZ };
  }

  // Current enemy base centre x (follows BattleState.enemyBaseX on boss levels).
  get enemyBaseX(): number {
    return this.baseX;
  }

  // Resolves when the floor textures have arrived (or failed).
  get ready(): Promise<void> {
    return this.env.ready;
  }

  private buildGate(scene: Scene, look: Look, g: GateDef, slot: { maxSpan: number; layer: number }): void {
    const good = g.op === 'mul' || g.op === 'add';
    const usesLeft = g.uses !== undefined && g.uses > 0 ? g.uses : -1;
    const model = createGate(scene, look, {
      width: g.width,
      good,
      label: gateLabel(g),
      usesLeft,
      maxSpan: slot.maxSpan,
      layer: slot.layer,
    });
    model.root.parent = this.root;
    model.root.position.set(gateX(g, 0), 0, g.z);
    model.root.rotation.y = Math.PI; // side 'neutral': the sign faces the camera
    const visual: GateVisual = {
      def: g,
      good,
      model,
      pulse: 0,
      pulseStrong: false,
      usesLeft,
      breakTime: -1,
      hidden: false,
    };
    this.gates.push(visual);
    this.gateById.set(g.id, visual);
  }

  // Sign cards lean back to face the camera so they read as flat signs from above.
  setLabelTilt(pitch: number): void {
    for (const g of this.gates) g.model.setLabelTilt(pitch);
  }

  pulseGate(id: string, added: number): void {
    const g = this.gateById.get(id);
    if (!g || g.breakTime >= 0) return;
    g.pulse = GATE_PULSE_TIME;
    g.pulseStrong = added > 0;
  }

  // One-use gates: the card redraws only when the number changes.
  setGateUses(id: string, usesLeft: number): void {
    const g = this.gateById.get(id);
    if (!g || g.usesLeft < 0 || g.breakTime >= 0) return;
    const n = Math.max(0, Math.floor(usesLeft));
    if (n === g.usesLeft) return;
    g.usesLeft = n;
    g.model.setLabel(gateLabel(g.def), n);
  }

  // Starts the pop-shrink-fade; the gate stays hidden afterwards. Returns whether the gate's op is good.
  breakGate(id: string): boolean {
    const g = this.gateById.get(id);
    if (!g) return true;
    if (g.breakTime < 0) g.breakTime = 0;
    return g.good;
  }

  gateWidth(id: string): number {
    return this.gateById.get(id)?.def.width ?? 2;
  }

  // Flashes the base nearest the event z (robust to either reading of the event's team).
  flashBaseAt(z: number): 'player' | 'enemy' {
    const enemy = z > this.level.lane.length / 2;
    const b = enemy ? this.enemyFlash : this.playerFlash;
    if (b.flash <= 0 || b.max === BASE_FLASH_TIME) {
      b.flash = BASE_FLASH_TIME;
      b.max = BASE_FLASH_TIME;
    }
    if (enemy) this.boss?.hit();
    return enemy ? 'enemy' : 'player';
  }

  // Boss phase change: a long flash on the tank and a pop on the Tin General.
  bossPhase(): void {
    this.enemyFlash.flash = PHASE_FLASH_TIME;
    this.enemyFlash.max = PHASE_FLASH_TIME;
    this.boss?.phase();
  }

  update(time: number, dt: number, battle: BattleState): void {
    for (const g of this.gates) {
      if (g.hidden) continue;
      if (g.breakTime >= 0) {
        this.updateBreak(g, dt);
        continue;
      }
      if (g.def.move) g.model.root.position.x = gateX(g.def, time);
      if (g.pulse > 0) {
        g.pulse = Math.max(0, g.pulse - dt);
        g.model.pulse(g.pulse / GATE_PULSE_TIME, g.pulseStrong);
      }
    }

    this.baseX = battle.enemyBaseX ?? this.level.enemyBase.x;
    const zc = this.enemyCenterZ;
    this.playerHp = hpFraction(battle.playerBaseHp, battle.playerBaseMaxHp);
    this.enemyHp = hpFraction(battle.enemyBaseHp, battle.enemyBaseMaxHp);

    const pk = this.decay(this.playerFlash, dt);
    if (pk >= 0) this.playerFort.setFlash(pk);
    const pDamage = 1 - this.playerHp;
    if (pDamage !== this.lastPlayerDamage) {
      this.playerFort.setDamage(pDamage);
      this.lastPlayerDamage = pDamage;
    }

    if (this.enemyFort) {
      this.enemyFort.root.position.x = this.baseX;
      const ek = this.decay(this.enemyFlash, dt);
      if (ek >= 0) this.enemyFort.setFlash(ek);
      const eDamage = 1 - this.enemyHp;
      if (eDamage !== this.lastEnemyDamage) {
        this.enemyFort.setDamage(eDamage);
        this.lastEnemyDamage = eDamage;
      }
    } else {
      this.decay(this.enemyFlash, dt); // the boss runs its own flash
    }
    this.boss?.update(this.baseX, zc, time, dt, battle.enemyBaseHp > 0);
  }

  // Counts a base flash down; returns the new k (0..1), or -1 when unchanged.
  private decay(b: BaseFlash, dt: number): number {
    if (b.flash > 0) b.flash = Math.max(0, b.flash - dt);
    const k = b.flash / b.max;
    if (k === b.last) return -1;
    b.last = k;
    return k;
  }

  // In-world HP bar in front of the enemy fort. The player fort and the boss have none:
  // the HUD shows both (the boss bar with his phase pips), and in-world bars there cut
  // across the cannon and the General's tank.
  drawBars(bars: HpBars): void {
    if (this.enemyHp <= 0 || !this.enemyFort) return;
    const root = this.enemyFort.root;
    const local = this.enemyFort.hpBarAnchor;
    Vector3.TransformCoordinatesToRef(local, root.computeWorldMatrix(true), this.anchor);
    bars.bar(this.anchor.x, this.anchor.y, this.anchor.z, ENEMY_BAR_W, this.enemyHp, 'enemy');
  }

  private updateBreak(g: GateVisual, dt: number): void {
    g.breakTime += dt;
    const o = this.breakOut;
    gateBreakAt(g.breakTime, o);
    if (o.done) {
      g.model.setBreak(0, 0);
      g.model.root.setEnabled(false);
      g.hidden = true;
      return;
    }
    g.model.setBreak(o.scale, o.alpha);
  }

  dispose(): void {
    for (const g of this.gates) g.model.dispose();
    this.gates.length = 0;
    this.gateById.clear();
    this.playerFort.dispose();
    this.enemyFort?.dispose();
    this.boss?.dispose();
    this.env.dispose();
    this.root.dispose(false, false);
  }
}
