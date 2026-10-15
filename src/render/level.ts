// Per-level visuals: the Bedroom Floor (oak floorboards, the indigo play rug as the lane,
// the far wall, the bed and a pool of window light, models/environment.ts), the toys
// scattered beside the rug (models/props.ts via scenery.ts), the gates (toy plastic
// arches with cream sign cards, models/gate.ts), both bases as moulded plastic toy forts
// (models/playerFort.ts / enemyFort.ts) with diegetic HP bars, and on boss levels the Tin
// General on his wind-up tin tank in place of the enemy fort (boss.ts). The enemy base
// can strafe; its fort or tank and its HP bar move with it. Everything here is rebuilt by
// loadLevel and disposed as a unit, so retries never leak meshes or materials (shared
// materials live in the look's cache and are reused across levels).
//
// World 2 (LevelDef.theme 'freezer'): the Freezer room (models/freezerRoom.ts) and its
// props (freezerProps.ts via scenery.ts) instead of the bedroom; ice patches on the lane
// (icePatch.ts), ice walls (iceWall.ts), a signpost between fork gates, and freezing
// gates that grow an ice sheet, crack as units chip it and shatter or melt away. Which
// room's assets are alive is index.ts's job (RoomSlot); this class only uses them.
//
// World 3 (theme 'workshop'): the Clockwork Workshop bench (models/workshopRoom.ts) and
// its props (workshopProps.ts via scenery.ts); conveyor belts, turntables and saw blades
// on the lane (conveyor.ts, turntable.ts, saw.ts) driven by the contracts' own clocks;
// toggling gates (clock token, shutter or split-flap card, all a pure function of the
// battle time); gates that glide to a new spot (gateMoved: lift, glide, drop) and tremble
// while the Jack-in-the-Box winds up a shuffle (BattleState.shuffle.warn). The camera
// never moves for any of it.
import type { Scene } from '@babylonjs/core/scene';
import type { Node } from '@babylonjs/core/node';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { BattleState, ConveyorDef, GateDef, LevelDef, SawDef, TurntableDef } from '../contracts.ts';
import { LAYOUT, conveyorDir, gateLabel, gateX, sawPos, turntableSpin } from '../contracts.ts';
import type { Look } from './look/index.ts';
import { createEnvironment } from './models/environment.ts';
import type { EnvironmentModel } from './models/environment.ts';
import { createForkSign, createGate, gateSlots } from './models/gate.ts';
import type { ForkSignModel, GateModel } from './models/gate.ts';
import { createFreezerRoom } from './models/freezerRoom.ts';
import type { FreezerPropKit } from './models/freezerProps.ts';
import { createIcePatches } from './models/icePatch.ts';
import type { IcePatchModel } from './models/icePatch.ts';
import { createIceWalls } from './models/iceWall.ts';
import type { IceWallModel } from './models/iceWall.ts';
import { createPlayerFort } from './models/playerFort.ts';
import type { FortModel as PlayerFortModel } from './models/playerFort.ts';
import { createEnemyFort } from './models/enemyFort.ts';
import type { FortModel as EnemyFortModel } from './models/enemyFort.ts';
import type { PropKit } from './models/props.ts';
import { createWorkshopRoom } from './models/workshopRoom.ts';
import type { WorkshopPropKit } from './models/workshopProps.ts';
import { createConveyor } from './models/conveyor.ts';
import type { ConveyorModel } from './models/conveyor.ts';
import { createTurntable } from './models/turntable.ts';
import type { TurntableModel } from './models/turntable.ts';
import { SAW_SPIN, createSaw } from './models/saw.ts';
import type { SawModel } from './models/saw.ts';
import { layoutFreezerScenery, layoutScenery, layoutWorkshopScenery } from './scenery.ts';
import { JackInTheBox, SnowGlobeGiant, TinGeneral } from './boss.ts';
import type { HpBars } from './hpBars.ts';
import {
  GLIDE_LIFT,
  ICE_GROW_TIME,
  ICE_MELT_TIME,
  beltScroll,
  beltYaw,
  clockWarn,
  flapAt,
  forkSigns,
  gateBreakAt,
  glidePoseAt,
  hpFraction,
  iceCrackStage,
  iceGrowAt,
  sawRaiseAt,
  shuffleJitter,
  shutterAt,
  toggleLabels,
  toggleViewAt,
  turntableAngle,
} from './fxLogic.ts';
import type { GlidePose, RoomTheme, ToggleView } from './fxLogic.ts';

// The current room's long-lived assets (index.ts keeps exactly one theme alive).
export type RoomKit =
  | { theme: 'bedroom'; props: PropKit }
  | { theme: 'freezer'; props: FreezerPropKit }
  | { theme: 'workshop'; props: WorkshopPropKit };

// What level.ts needs of a boss model. TinGeneral implements it; the Snow Globe Giant
// (BossDef.model 'snowGlobeGiant') plugs in through BOSS_DRIVERS without other changes.
export interface BossDriver {
  readonly root: Node & { scaling: Vector3; position: Vector3 };
  hit(): void;
  phase(index?: number): void; // 0-based bossPhase index; absent = next phase
  // Snow Globe Giant only: the over-arm throw and the lean into a gust.
  lob?(): void;
  gustWarn?(dir: number, seconds: number): void;
  gust?(dir: number, duration: number): void;
  // Jack-in-the-Box only: cranks for `seconds` before a shuffle, then springs as the gates glide.
  shuffleWarn?(seconds: number): void;
  shuffle?(glide: number): void;
  update(x: number, zCenter: number, time: number, dt: number, alive: boolean): void;
  dispose(): void;
}
export type BossModelId = 'tinGeneral' | 'snowGlobeGiant' | 'jackInTheBox';
export type BossFactory = (scene: Scene, look: Look, width: number, depth: number, hullHeight: number) => BossDriver;
// Boss model registry: a missing entry falls back to the Tin General.
export const BOSS_DRIVERS: Partial<Record<BossModelId, BossFactory>> = {
  tinGeneral: (scene, look, width, depth, hullHeight) => new TinGeneral(scene, look, width, depth, hullHeight),
  snowGlobeGiant: (scene, look, width, depth, hullHeight) => new SnowGlobeGiant(scene, look, width, depth, hullHeight),
  jackInTheBox: (scene, look, width, depth, hullHeight) => new JackInTheBox(scene, look, width, depth, hullHeight),
};
export function createBossDriver(
  scene: Scene,
  look: Look,
  model: BossModelId | undefined,
  width: number,
  depth: number,
  hullHeight: number,
): BossDriver {
  const make = BOSS_DRIVERS[model ?? 'tinGeneral'] ?? BOSS_DRIVERS.tinGeneral!;
  return make(scene, look, width, depth, hullHeight);
}

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
  // World 2 ice: 'grow' after gateFrozen, 'melt' after a timed-out thaw.
  ice: 'none' | 'grow' | 'frozen' | 'melt';
  iceTime: number;
  iceK: number; // current cover sent to the model
  iceFrom: number; // cover when the melt started
  crack: number; // 0..3, only rises while frozen
  // World 3: base spot (moved by gateMoved), the current glide, toggle faces.
  spotX: number;
  spotZ: number;
  glide: { fromX: number; fromZ: number; toX: number; toZ: number; seconds: number; elapsed: number } | null;
  labels: { on: string; off: string } | null; // toggling gates: '' off face = shutter
  altGood: boolean;
  face: string; // label on the card now
  faceGood: boolean;
  phase: number; // decorrelates the shuffle tremble
}

interface Conveyor {
  def: ConveyorDef;
  model: ConveyorModel;
  offset: number;
}
interface Turntable {
  def: TurntableDef;
  model: TurntableModel;
  angle: number;
}
interface Saw {
  def: SawDef;
  model: SawModel;
  spin: number;
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
  private readonly boss: BossDriver | null;
  readonly theme: RoomTheme;
  private readonly icePatches: IcePatchModel | null;
  private readonly iceWalls: IceWallModel | null;
  private readonly forks: ForkSignModel[] = [];
  private readonly conveyors: Conveyor[] = [];
  private readonly turntables: Turntable[] = [];
  private readonly saws: Saw[] = [];
  private readonly sawById = new Map<string, Saw>();
  private readonly view: ToggleView = { on: true, closed: false, flipIn: 0, progress: 0, since: 0 };
  private readonly glidePose: GlidePose = { x: 0, z: 0, lift: 0, landed: true };
  private readonly jitter = { x: 0, z: 0 };
  private readonly sawAt = { x: 0, z: 0 };
  private readonly shuffles: boolean;
  // Called when a gliding gate lands (for a dust puff).
  onGateLanded: ((x: number, z: number, width: number) => void) | null = null;
  private readonly playerFlash: BaseFlash = { flash: 0, max: BASE_FLASH_TIME, last: -1 };
  private readonly enemyFlash: BaseFlash = { flash: 0, max: BASE_FLASH_TIME, last: -1 };
  private readonly breakOut = { scale: 1, alpha: 1, done: false };
  private readonly anchor = new Vector3();
  private baseX: number;
  private playerHp = 1;
  private enemyHp = 1;
  private lastPlayerDamage = -1;
  private lastEnemyDamage = -1;

  constructor(scene: Scene, look: Look, level: LevelDef, room: RoomKit) {
    this.level = level;
    this.theme = room.theme;
    this.baseX = level.enemyBase.x;
    this.root = new TransformNode('level', scene);
    const { width: w, length } = level.lane;

    const envOpts = {
      laneWidth: w,
      laneLength: length,
      zMin: LAYOUT.playerBaseZ - LAYOUT.playerBaseDepth,
      zMax: length + LAYOUT.enemyBaseDepth,
    };
    this.env =
      room.theme === 'freezer'
        ? createFreezerRoom(scene, look, envOpts)
        : room.theme === 'workshop'
          ? createWorkshopRoom(scene, look, envOpts)
          : createEnvironment(scene, look, envOpts);
    this.env.root.parent = this.root;
    scene.clearColor.copyFrom(this.env.clearColor);
    if (room.theme === 'freezer') layoutFreezerScenery(room.props, level);
    else if (room.theme === 'workshop') layoutWorkshopScenery(room.props, level);
    else layoutScenery(room.props, level);

    // World 2 lane features (any theme may carry them; absent on World 1 levels).
    this.icePatches = createIcePatches(scene, look, level.ice ?? []);
    if (this.icePatches) this.icePatches.root.parent = this.root;
    this.iceWalls = createIceWalls(scene, look, level.iceWalls ?? []);
    if (this.iceWalls) this.iceWalls.root.parent = this.root;
    for (const f of forkSigns(level.gates.map((g) => ({ fork: g.fork, x: g.x, z: g.z, width: g.width })))) {
      const sign = createForkSign(scene, look, f.span);
      sign.root.parent = this.root;
      sign.root.position.set(f.x, 0, f.z);
      sign.root.rotation.y = Math.PI; // authored facing +Z: turn it to the camera
      this.forks.push(sign);
    }

    // World 3 lane hazards (any theme may carry them).
    (level.conveyors ?? []).forEach((def, i) => {
      const model = createConveyor(scene, look, def, i);
      model.root.parent = this.root;
      this.conveyors.push({ def, model, offset: 0 });
    });
    for (const def of level.turntables ?? []) {
      const model = createTurntable(scene, look, def);
      model.root.parent = this.root;
      this.turntables.push({ def, model, angle: 0 });
    }
    for (const def of level.saws ?? []) {
      const model = createSaw(scene, look, def);
      model.root.parent = this.root;
      const saw: Saw = { def, model, spin: 0 };
      this.saws.push(saw);
      this.sawById.set(def.id, saw);
    }

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
      this.boss = createBossDriver(scene, look, level.boss.model, level.enemyBase.width, ed, BOSS_HULL_HEIGHT);
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
    const bossFreezes = !!level.boss?.phases.some((p) => p.freezeGates);
    this.shuffles = !!level.boss?.phases.some((p) => p.shuffle);
    level.gates.forEach((g, i) => this.buildGate(scene, look, g, slots[i], bossFreezes));
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

  private buildGate(
    scene: Scene,
    look: Look,
    g: GateDef,
    slot: { maxSpan: number; layer: number },
    bossFreezes: boolean,
  ): void {
    const good = g.op === 'mul' || g.op === 'add';
    const usesLeft = g.uses !== undefined && g.uses > 0 ? g.uses : -1;
    const alt = g.toggle?.alt;
    const altGood = alt ? alt.op === 'mul' || alt.op === 'add' : good;
    const model = createGate(scene, look, {
      width: g.width,
      good,
      label: gateLabel(g),
      usesLeft,
      maxSpan: slot.maxSpan,
      layer: slot.layer,
      freezing: !!g.freeze,
      freezable: bossFreezes,
      toggle: !!g.toggle,
      altGood: alt ? altGood : undefined,
      shuffles: this.shuffles,
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
      ice: 'none',
      iceTime: 0,
      iceK: 0,
      iceFrom: 0,
      crack: 0,
      spotX: g.x,
      spotZ: g.z,
      glide: null,
      labels: g.toggle ? toggleLabels(g) : null,
      altGood,
      face: gateLabel(g),
      faceGood: good,
      phase: this.gates.length * 1.7,
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
    g.model.setLabel(g.face, n);
  }

  // Starts the pop-shrink-fade; the gate stays hidden afterwards. Returns whether the
  // face it shows (a toggling gate may show its alt) is good.
  breakGate(id: string): boolean {
    const g = this.gateById.get(id);
    if (!g) return true;
    if (g.breakTime < 0) g.breakTime = 0;
    return g.faceGood;
  }

  // ---------- World 3: gliding gates, toggles, hazards ----------

  // gateMoved: the gate lifts, glides from (fromX, fromZ) to (x, z) over `seconds` (base
  // spots, without its move sway) and drops. Returns false for an unknown or broken gate.
  moveGate(id: string, fromX: number, fromZ: number, x: number, z: number, seconds: number): boolean {
    const g = this.gateById.get(id);
    if (!g || g.breakTime >= 0) return false;
    if (seconds <= 0) {
      g.spotX = x;
      g.spotZ = z;
      g.glide = null;
      return true;
    }
    g.glide = { fromX, fromZ, toX: x, toZ: z, seconds, elapsed: 0 };
    return true;
  }

  // Whether a gate closes behind a shutter while off (toggle without alt).
  gateHasShutter(id: string): boolean {
    const l = this.gateById.get(id)?.labels;
    return !!l && l.off === '';
  }

  // Blade radius of a saw (for its sparks), or 1 when unknown.
  sawRadius(id: string): number {
    return this.sawById.get(id)?.def.radius ?? 1;
  }

  // Toggle faces, shutter, split-flap and clock: all from the gate's clock at `time`.
  private updateToggle(g: GateVisual, time: number): void {
    const toggle = g.def.toggle;
    const labels = g.labels;
    if (!toggle || !labels) return;
    const v = toggleViewAt(toggle, time, this.view);
    if (labels.off === '') {
      g.face = labels.on;
      g.faceGood = g.good;
      g.model.setFace(labels.on, g.good, v.closed);
      g.model.setShutter(shutterAt(v));
    } else {
      // The card is edge-on at the flip, so it always shows the current state's face.
      g.face = v.on ? labels.on : labels.off;
      g.faceGood = v.on ? g.good : g.altGood;
      g.model.setFace(g.face, g.faceGood, false);
      g.model.setFlap(flapAt(v));
    }
    g.model.setClock(v.progress, clockWarn(v.flipIn), v.on);
  }

  // Where the gate stands now: its spot (or glide) plus its move sway and any tremble.
  private placeGate(g: GateVisual, time: number, dt: number, warn: number): void {
    const sway = g.def.move ? gateX(g.def, time) - g.def.x : 0;
    let x = g.spotX + sway;
    let z = g.spotZ;
    let lift = 0;
    const gl = g.glide;
    if (gl) {
      gl.elapsed += dt;
      const p = glidePoseAt(gl.elapsed, gl.seconds, gl.fromX, gl.fromZ, gl.toX, gl.toZ, sway, this.glidePose);
      x = p.x;
      z = p.z;
      lift = p.lift;
      if (p.landed) {
        g.spotX = gl.toX;
        g.spotZ = gl.toZ;
        g.glide = null;
        this.onGateLanded?.(x, z, g.def.width);
      }
    }
    if (warn > 0) {
      shuffleJitter(warn, time, g.phase, this.jitter);
      x += this.jitter.x;
      z += this.jitter.z;
    }
    g.model.root.position.set(x, lift, z);
    g.model.setLifted(lift / GLIDE_LIFT);
    if (this.shuffles) g.model.setGlow(warn);
  }

  private updateHazards(time: number, dt: number): void {
    for (const c of this.conveyors) {
      c.model.setYaw(beltYaw(c.def, conveyorDir(c.def, time)));
      c.offset = beltScroll(c.offset, c.def, dt);
      c.model.setScroll(c.offset);
    }
    for (const t of this.turntables) {
      t.angle = turntableAngle(t.angle, t.def, time, dt);
      t.model.setAngle(t.angle);
      t.model.setSpinSign(Math.sign(turntableSpin(t.def, time)));
    }
    for (const s of this.saws) {
      sawPos(s.def, time, this.sawAt);
      s.model.setPos(this.sawAt.x, this.sawAt.z);
      const k = sawRaiseAt(s.def.cycle, time);
      s.model.setRaise(k);
      s.spin = (s.spin + SAW_SPIN * k * dt) % (Math.PI * 2);
      s.model.setSpin(s.spin);
    }
  }

  // ---------- World 2: freezing gates ----------

  // gateFrozen: the ice sheet grows over the gate. Returns false for an unknown gate.
  freezeGate(id: string): boolean {
    const g = this.gateById.get(id);
    if (!g || g.hidden) return false;
    g.ice = 'grow';
    g.iceTime = 0;
    g.crack = 0;
    g.model.setCracks(0);
    return true;
  }

  // gateChipped: the ice cracks in stages as its hp falls (never un-cracks while frozen).
  chipGate(id: string, hp: number, maxHp: number): void {
    const g = this.gateById.get(id);
    if (!g || g.ice === 'none' || g.ice === 'melt') return;
    const stage = Math.max(g.crack, iceCrackStage(hp, maxHp));
    if (stage !== g.crack) {
      g.crack = stage;
      g.model.setCracks(stage);
    }
  }

  // gateThawed: chipped open = the ice is gone at once (the caller bursts it into chips);
  // timed out = it melts away over ICE_MELT_TIME (the caller starts the drips).
  thawGate(id: string, chipped: boolean): void {
    const g = this.gateById.get(id);
    if (!g || g.ice === 'none') return;
    g.crack = 0;
    g.model.setCracks(0);
    if (chipped) {
      g.ice = 'none';
      g.iceK = 0;
      g.model.setFrozen(0);
    } else {
      g.ice = 'melt';
      g.iceTime = 0;
      g.iceFrom = g.iceK;
    }
  }

  // Current x of a gate (its spot plus its move sway at `time`), or NaN when unknown.
  gateXNow(id: string, time: number): number {
    const g = this.gateById.get(id);
    return g ? g.spotX + gateX(g.def, time) - g.def.x : Number.NaN;
  }

  private updateIce(g: GateVisual, dt: number): void {
    if (g.ice === 'none' || g.ice === 'frozen') return;
    g.iceTime += dt;
    let k: number;
    if (g.ice === 'grow') {
      k = iceGrowAt(g.iceTime);
      if (g.iceTime >= ICE_GROW_TIME) {
        k = 1;
        g.ice = 'frozen';
      }
    } else {
      const u = Math.min(1, g.iceTime / ICE_MELT_TIME);
      k = g.iceFrom * (1 - u);
      if (u >= 1) g.ice = 'none';
    }
    g.iceK = Math.max(0, k);
    g.model.setFrozen(g.iceK);
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

  // Boss phase change: a long flash on the tank and a pop on the boss model.
  bossPhase(index?: number): void {
    this.enemyFlash.flash = PHASE_FLASH_TIME;
    this.enemyFlash.max = PHASE_FLASH_TIME;
    this.boss?.phase(index);
  }

  // Snow Globe Giant cues (no-ops for the Tin General).
  bossLob(): void {
    this.boss?.lob?.();
  }
  bossGustWarn(dir: number, seconds: number): void {
    this.boss?.gustWarn?.(dir, seconds);
  }
  bossGust(dir: number, duration: number): void {
    this.boss?.gust?.(dir, duration);
  }
  // Jack-in-the-Box cues (no-ops for the other bosses).
  bossShuffleWarn(seconds: number): void {
    this.boss?.shuffleWarn?.(seconds);
  }
  bossShuffle(glide: number): void {
    this.boss?.shuffle?.(glide);
  }

  update(time: number, dt: number, battle: BattleState): void {
    const warn = battle.shuffle && !battle.shuffle.active ? battle.shuffle.warn : 0;
    for (const g of this.gates) {
      if (g.hidden) continue;
      if (g.breakTime >= 0) {
        this.updateBreak(g, dt);
        continue;
      }
      this.placeGate(g, time, dt, warn);
      this.updateToggle(g, time);
      if (g.pulse > 0) {
        g.pulse = Math.max(0, g.pulse - dt);
        g.model.pulse(g.pulse / GATE_PULSE_TIME, g.pulseStrong);
      }
      this.updateIce(g, dt);
    }
    this.updateHazards(time, dt);

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
    this.icePatches?.dispose();
    this.iceWalls?.dispose();
    for (const f of this.forks) f.dispose();
    this.forks.length = 0;
    for (const h of [...this.conveyors, ...this.turntables, ...this.saws]) h.model.dispose();
    this.conveyors.length = 0;
    this.turntables.length = 0;
    this.saws.length = 0;
    this.sawById.clear();
    this.env.dispose();
    this.root.dispose(false, false);
  }
}
