// Data-oriented crowd simulation (concept §8 "Crowd simulation").
// Every unit lives in flat typed arrays (structure of arrays) preallocated in the
// constructor; step() runs a handful of linear passes and never allocates per unit.
//
// Units are discs on the XZ plane. A mob's health IS its weight (weight = ceil(hp)),
// so cancellation by min(hpA, hpB) is 1:1 by weight and a stacked mob simply has more hp.
//
// Milestone 2 adds enemy defenders (towers shoot, walls soak), one-use gates that break
// after a crossing-weight budget, and a movable enemy base (boss levels strafe it).
//
// Milestone 4 adds mob types from the loadout: every unit carries its own speed (0 means
// the SIM_TUNING default for its team and kind, so enemies and old callers move exactly
// as before), a render variant byte and an optional death blast. A unit with a blast that
// dies hurts nearby units of the other team once and records the blast for the battle
// layer (takeBlasts). damageArea and damageDefender let ultimates hurt the lane from
// outside step(); neither allocates.
//
// Milestone 5 (World 2, concept §9.1). Every feature is off unless the level or a caller
// turns it on, so a World 1 level runs bit for bit as before (no extra rand() calls).
// - Ice patches (level.ice): units on ice keep a lateral velocity that separation pushes
//   and wind feed and that decays slowly (ICE_DECAY), so crowds slide; it bleeds off fast
//   once off the ice. Player steering on ice keeps mods.iceGrip of its strength, and grip
//   also takes that share of the push out of the slide. Forward speed never changes.
// - Freezing gates (gate.freeze, freezeGate): after `after * mods.freezeAfter` crossing
//   weight a gate ices over for `duration` s. Frozen, it gives no effect and player units
//   reaching its line cancel against its ice hp (min of both, x mods.thawRate) like a wall.
//   It thaws at 0 hp or when the duration (run at thawRate) ends, then counts afresh.
// - Ice walls (level.iceWalls): static rectangles; overlapping units of both teams are
//   pushed out sideways toward the nearer open side, or back off the face and slid along
//   it when they hit it head-on. Never damaged.
// - Wind (setWind): a lateral push every unfrozen unit gets each step (heavies 50%); on
//   ice it feeds the slide instead. The battle layer schedules gusts.
// - Freeze (freezeUnits): frozen units neither move nor hit bases but still cancel and die.
// - Riders (SpawnOpts.riders): a unit that dies by any cause drops that many single mobs
//   carrying its passed-gate mask (giantFell).
// - Rolling snowballs (SpawnOpts.roll): gates and lone player mobs add weight into the
//   ball (radius grows up to maxRadius); it bursts into its weight in single mobs when it
//   touches an enemy, a defender, a frozen gate or an ice wall, reaches burstWeight, or
//   gets within ROLL_BURST_BEFORE_BASE of the enemy base. It never cancels itself.
// - Igloos (DefenderKind 'igloo') soak like walls with their own footprint and never shoot.

import type { DefenderKind, DefenderView, LevelDef, SimEvent, SimView } from '../contracts.ts';
import { DEFENDER_DEFAULTS, LAYOUT, Team, UnitKind, gateX } from '../contracts.ts';
import { SpatialGrid } from './grid.ts';
import { IcePatches, IceWalls } from './hazards.ts';

export interface SpawnOpts {
  hp?: number; // per weight for mobs (default 1, so hp == weight); absolute for champions
  damage?: number; // per weight for mobs (default 1, so damage == weight); absolute for champions
  radius?: number; // base radius; default LAYOUT.mobRadius / LAYOUT.championRadius by kind
  spread?: number; // half-width of random x jitter for count > 1 (default 0.35)
  speed?: number; // world units / s; default SIM_TUNING by team and kind
  variant?: number; // render variant byte (0 rifleman / enemy mob, 1 knight, ...); default 0
  deathBlast?: { radius: number; damage: number }; // on death, hurts the other team nearby (damage per weight)
  riders?: number; // on death (any cause), releases this many single player mobs (Giant)
  roll?: { burstWeight: number; maxRadius: number }; // player mob only: a rolling, growing snowball
}

// The view with the per-unit render variant (Milestone 4) and the sideways ice slide in
// u/s (Milestone 5; 0 off ice), which the crowd renderer turns into a skid pose.
export type SimViewM4 = SimView & { readonly variant: Uint8Array; readonly slide: Float32Array };

// A death blast recorded by the sim, handed out by takeBlasts().
export interface SimBlast {
  x: number;
  z: number;
  radius: number;
}

export interface SimOptions {
  unitBudget?: number; // live units across both teams before new weight is stacked (default 1500)
  capacity?: number; // hard array size (default unitBudget + 512)
}

export interface Sim {
  readonly view: SimViewM4;
  readonly time: number;
  readonly unitBudget: number;
  spawn(team: Team, kind: UnitKind, x: number, z: number, count: number, opts?: SpawnOpts): void;
  step(dt: number, events: SimEvent[]): void;
  totals(): { player: number; enemy: number };
  // Live defenders in level order; destroyed ones stay with hp 0. Mutated in place.
  readonly defenders: readonly DefenderView[];
  // Moves the enemy base centre (boss strafing). Defaults to level.enemyBase.x.
  setEnemyBaseX(x: number): void;
  // Moves the blasts recorded since the last call into `out` (pushed in order) and clears them.
  takeBlasts(out: SimBlast[]): void;
  // Kills or damages units of `team` whose disc overlaps the circle, nearest index first,
  // until maxWeight is spent (a mob's weight is hp / hp-per-weight, a champion's is its hp).
  // Returns the weight removed. Dead units are removed at once.
  damageArea(team: Team, x: number, z: number, radius: number, maxWeight: number): number;
  // Damages the defender at `index` (level order); reported as defenderHit next step.
  damageDefender(index: number, amount: number): void;
  // Milestone 5. Lateral wind in world units/s (+ = right) applied every step until changed.
  setWind(vx: number): void;
  // Freezes gate `index` (level order) now for `seconds` with `hp` ice, freeze def or not.
  // Reported as gateFrozen next step.
  freezeGate(index: number, seconds: number, hp: number): void;
  // Remaining ice hp of gate `index`; 0 = not frozen.
  gateIce(index: number): number;
  // Freezes units of `team` whose disc overlaps the circle (radius Infinity = the whole
  // team) for `seconds`. Returns the weight frozen (a champion counts 1); one unitsFrozen
  // event is reported next step.
  freezeUnits(team: Team, x: number, z: number, radius: number, seconds: number): number;
}

// Mutable so tuning code can tweak it live; tests read it.
export const SIM_TUNING = {
  mobSpeed: 7,
  championSpeed: 4.5,
  enemySpeed: 5,
  separation: 0.5, // fraction of an overlap resolved per step
};

const MAX_GATES = 32;
const MAX_DEFENDERS = 16;
const CHAMPION_HIT_INTERVAL = 0.5; // seconds between a held champion's blows on a defender
const DEAD_EPS = 1e-4; // hp at or below this counts as dead (absorbs float dust)
const MAX_PUSH = 0.08; // per-step cap on separation correction (world units)
const STEER_ZONE = 6; // player units steer toward the enemy base span in the last N units
const STEER_FACTOR = 0.8; // lateral steering speed as a fraction of forward speed
const MERGE_RADIUS = 1.5; // over budget, spawned weight joins a same-team mob within this range
const MAX_CLASH_EVENTS = 6;
const BURST_MAX_HALF = 1.2;
const BURST_DEPTH = 0.8;
const MAX_BLASTS = 64; // recorded blasts kept until takeBlasts(); later ones still hurt, unrecorded
// Milestone 5
const ICE_DECAY = 0.6; // 1/s: exponential decay of the slide while on ice
const OFF_ICE_DECAY = 8; // 1/s: how fast the slide bleeds off once a unit leaves the ice
const ICE_WIND_GAIN = 1.5; // on ice, wind accelerates the slide by gain * vx per second
const ICE_PUSH_GAIN = 4; // on ice, each separation push also adds push * gain to the slide (u/s)
const ICE_KICK_MIN = 0.8; // u/s: a unit stepping onto ice skids sideways at least this fast...
const ICE_KICK_MAX = 1.6; // ...and at most this fast (hashed; keeps the sign of a slide it already has)
const ICE_MAX_SLIDE = 8; // u/s cap on the slide speed
const SLIDE_EPS = 0.01; // u/s: slower slides stop
const HEAVY_WIND = 0.5; // share of the wind champions and heavies feel
const FREEZE_EPS = 1e-4; // freeze timers at or below this have run out
const CHIP_EVENT_GAP = 0.1; // s: at most one gateChipped per gate in this time
const MAX_ICE_WALL_EVENTS = 2; // iceWallHit events per step
const ICE_WALL_SLIDE = 5; // u/s a unit pressed head-on against an ice wall slides toward the gap
const ROLL_BURST_BEFORE_BASE = 6; // snowballs burst this far before the enemy base
const IGLOO_DEPTH = 1.6;

// Deterministic 0..1 hash for the ice skid, kept off the seeded rand() stream so stepping
// onto ice does not reshuffle every later random draw of the battle.
function skidHash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b, 0xc2b2ae35);
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2d);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Heavier stacked units are drawn (and collide) bigger, capped at 2.2x.
function stackedRadius(base: number, w: number): number {
  return w <= 1 ? base : base * Math.min(2.2, 1 + 0.22 * Math.log2(w));
}

// A snowball grows like a ball of packed snow: radius with the cube root of its weight.
function rollRadius(base: number, w: number, max: number): number {
  const r = base * Math.cbrt(w > 1 ? w : 1);
  return r < max ? r : max;
}

// Mutable defender record; exposed read-only through Sim.defenders.
interface Defender {
  id: string;
  kind: DefenderKind;
  x: number;
  z: number;
  width: number;
  depth: number;
  hp: number;
  maxHp: number;
}

class CrowdSim implements Sim {
  readonly view: SimViewM4;
  readonly unitBudget: number;
  readonly defenders: readonly DefenderView[];

  private readonly level: LevelDef;
  private readonly rand: () => number;
  private readonly capacity: number;
  private n = 0;
  private _time = 0;

  // Public (via view)
  private readonly posX: Float32Array;
  private readonly posZ: Float32Array;
  private readonly team: Uint8Array;
  private readonly kind: Uint8Array;
  private readonly weight: Uint16Array;
  private readonly radius: Float32Array;
  private readonly hp: Float32Array;
  // Private
  private readonly w: Float64Array; // true weight (view.weight clamps at 65535)
  private readonly hpPer: Float32Array;
  private readonly dmgPer: Float32Array;
  private readonly baseRad: Float32Array;
  private readonly prevZ: Float32Array;
  private readonly passed: Uint32Array; // gate bitmask
  private readonly pushX: Float32Array;
  private readonly pushZ: Float32Array;
  private readonly atkT: Float32Array; // champion: seconds until its next blow on a defender
  private readonly held: Uint8Array; // champion held by a defender this step (no forward push)
  private readonly speed: Float32Array; // 0 = SIM_TUNING default for the unit's team and kind
  private readonly variant: Uint8Array;
  private readonly blastR: Float32Array; // death blast radius; 0 = none (also cleared once it fired)
  private readonly blastD: Float32Array; // death blast damage per weight
  private readonly blastX = new Float32Array(MAX_BLASTS);
  private readonly blastZ = new Float32Array(MAX_BLASTS);
  private readonly blastRad = new Float32Array(MAX_BLASTS);
  private blastCount = 0;
  private hasBlasts = false; // set once any unit with a death blast is spawned; skips detonate() until then
  // Milestone 5 per-unit state (moved by compact like the rest)
  private readonly velX: Float32Array; // sliding lateral velocity (ice only)
  private readonly onIce: Uint8Array; // on an ice patch this step
  private readonly frozenT: Float32Array; // seconds of freeze left
  private readonly riders: Uint16Array; // mobs released on death
  private readonly rollBurst: Float32Array; // snowball burst weight; 0 = not a snowball
  private readonly rollMaxR: Float32Array;
  private readonly rollPop: Uint8Array; // snowball touched something this step and bursts
  private hasRiders = false;
  private hasRollers = false;
  private freezeUntil = 0; // sim time the last unit freeze ends; 0 = nobody frozen
  private wind = 0;
  private readonly pending: SimEvent[] = []; // events raised outside step(), reported by the next step
  private readonly ice: IcePatches;
  private readonly iceWalls: IceWalls;
  private readonly slip: number; // 1 - iceGrip: share of ice behaviour player units feel
  private readonly thawRate: number;
  private readonly freezeAfter: number;

  private readonly grid: SpatialGrid;
  private readonly gateXs: Float64Array;
  private readonly gateAdded: Float64Array;
  private readonly gateHits: Int32Array;
  private readonly gateSumX: Float64Array;
  private readonly gateUses: Float64Array; // remaining crossing weight; Infinity = unlimited
  private readonly gateBroken: Uint8Array;
  private readonly gateCross: Float64Array; // freezing gates: crossing weight since the last thaw
  private readonly gateIceHp: Float64Array; // > 0 while frozen
  private readonly gateIceMax: Float64Array;
  private readonly gateFreezeT: Float64Array; // seconds of freeze left
  private readonly gateChipAt: Float64Array; // sim time of the last gateChipped event
  private frozenGates = 0;
  private clashes = 0;
  private wallHits = 0;

  private readonly defs: Defender[];
  private readonly defRange: Float64Array; // towers only
  private readonly defPeriod: Float64Array; // seconds between shots
  private readonly defDamage: Float64Array;
  private readonly defCd: Float64Array; // seconds until the tower may fire again
  private readonly defDmgStep: Float64Array; // damage taken this step (for defenderHit)
  private readonly defDead: Uint8Array; // defenderDestroyed already reported
  private defMinZ = Infinity; // z extent of all footprints, a cheap prefilter
  private defMaxZ = -Infinity;
  private baseX: number;

  constructor(level: LevelDef, rand: () => number, opts?: SimOptions) {
    if (level.gates.length > MAX_GATES) {
      throw new Error(`Level "${level.id}" has ${level.gates.length} gates; the sim supports at most ${MAX_GATES}.`);
    }
    const defDefs = level.defenders ?? [];
    if (defDefs.length > MAX_DEFENDERS) {
      throw new Error(
        `Level "${level.id}" has ${defDefs.length} defenders; the sim supports at most ${MAX_DEFENDERS}.`,
      );
    }
    this.level = level;
    this.baseX = level.enemyBase.x;
    this.rand = rand;
    this.unitBudget = opts?.unitBudget ?? 1500;
    const cap = opts?.capacity ?? this.unitBudget + 512;
    this.capacity = cap;

    this.posX = new Float32Array(cap);
    this.posZ = new Float32Array(cap);
    this.team = new Uint8Array(cap);
    this.kind = new Uint8Array(cap);
    this.weight = new Uint16Array(cap);
    this.radius = new Float32Array(cap);
    this.hp = new Float32Array(cap);
    this.w = new Float64Array(cap);
    this.hpPer = new Float32Array(cap);
    this.dmgPer = new Float32Array(cap);
    this.baseRad = new Float32Array(cap);
    this.prevZ = new Float32Array(cap);
    this.passed = new Uint32Array(cap);
    this.pushX = new Float32Array(cap);
    this.pushZ = new Float32Array(cap);
    this.atkT = new Float32Array(cap);
    this.held = new Uint8Array(cap);
    this.speed = new Float32Array(cap);
    this.variant = new Uint8Array(cap);
    this.blastR = new Float32Array(cap);
    this.blastD = new Float32Array(cap);
    this.velX = new Float32Array(cap);
    this.onIce = new Uint8Array(cap);
    this.frozenT = new Float32Array(cap);
    this.riders = new Uint16Array(cap);
    this.rollBurst = new Float32Array(cap);
    this.rollMaxR = new Float32Array(cap);
    this.rollPop = new Uint8Array(cap);
    this.ice = new IcePatches(level);
    this.iceWalls = new IceWalls(level);
    const grip = level.mods?.iceGrip ?? 0;
    this.slip = 1 - (grip < 0 ? 0 : grip > 1 ? 1 : grip);
    this.thawRate = Math.max(0.01, level.mods?.thawRate ?? 1); // > 0: it divides chip damage
    this.freezeAfter = level.mods?.freezeAfter ?? 1;

    const hw = level.lane.width / 2;
    this.grid = new SpatialGrid(-hw, hw, LAYOUT.playerBaseZ - 2, level.lane.length + 2, 2 * LAYOUT.mobRadius, cap);

    const g = level.gates.length;
    this.gateXs = new Float64Array(g);
    this.gateAdded = new Float64Array(g);
    this.gateHits = new Int32Array(g);
    this.gateSumX = new Float64Array(g);
    this.gateUses = new Float64Array(g);
    this.gateBroken = new Uint8Array(g);
    for (let k = 0; k < g; k++) this.gateUses[k] = level.gates[k].uses ?? Infinity;
    this.gateCross = new Float64Array(g);
    this.gateIceHp = new Float64Array(g);
    this.gateIceMax = new Float64Array(g);
    this.gateFreezeT = new Float64Array(g);
    this.gateChipAt = new Float64Array(g).fill(-Infinity);

    const dc = defDefs.length;
    this.defRange = new Float64Array(dc);
    this.defPeriod = new Float64Array(dc);
    this.defDamage = new Float64Array(dc);
    this.defCd = new Float64Array(dc);
    this.defDmgStep = new Float64Array(dc);
    this.defDead = new Uint8Array(dc);
    this.defs = defDefs.map((d, k) => {
      const tower = d.kind === 'tower';
      const igloo = d.kind === 'igloo';
      const width =
        d.width ??
        (tower
          ? DEFENDER_DEFAULTS.towerWidth
          : igloo
            ? DEFENDER_DEFAULTS.wallWidth * 0.75
            : DEFENDER_DEFAULTS.wallWidth);
      const depth = tower ? width : igloo ? IGLOO_DEPTH : DEFENDER_DEFAULTS.wallDepth;
      this.defRange[k] = tower ? (d.range ?? DEFENDER_DEFAULTS.range) : 0;
      this.defPeriod[k] = tower ? 1 / (d.fireRate ?? DEFENDER_DEFAULTS.fireRate) : 0;
      this.defDamage[k] = tower ? (d.damage ?? DEFENDER_DEFAULTS.damage) : 0;
      this.defMinZ = Math.min(this.defMinZ, d.z - depth / 2);
      this.defMaxZ = Math.max(this.defMaxZ, d.z + depth / 2);
      return { id: d.id, kind: d.kind, x: d.x, z: d.z, width, depth, hp: d.hp, maxHp: d.hp };
    });
    this.defenders = this.defs;

    const self = this;
    this.view = {
      get count() {
        return self.n;
      },
      posX: this.posX,
      posZ: this.posZ,
      team: this.team,
      kind: this.kind,
      weight: this.weight,
      radius: this.radius,
      hp: this.hp,
      variant: this.variant,
      slide: this.velX,
    };
  }

  get time(): number {
    return this._time;
  }

  setEnemyBaseX(x: number): void {
    this.baseX = x;
  }

  totals(): { player: number; enemy: number } {
    let player = 0;
    let enemy = 0;
    for (let i = 0; i < this.n; i++) {
      const v = this.kind[i] === UnitKind.Champion ? 1 : this.w[i];
      if (this.team[i] === Team.Player) player += v;
      else enemy += v;
    }
    return { player, enemy };
  }

  // ---------- Spawning ----------

  spawn(team: Team, kind: UnitKind, x: number, z: number, count: number, opts?: SpawnOpts): void {
    count = Math.floor(count);
    if (count <= 0) return;
    const isChamp = kind === UnitKind.Champion;
    const hpPer = opts?.hp ?? 1;
    const dmgPer = opts?.damage ?? 1;
    const rad = opts?.radius ?? (isChamp ? LAYOUT.championRadius : LAYOUT.mobRadius);
    const spread = count > 1 ? (opts?.spread ?? 0.35) : 0;
    const spd = opts?.speed ?? 0;
    const variant = opts?.variant ?? 0;
    const br = opts?.deathBlast?.radius ?? 0;
    const bd = opts?.deathBlast?.damage ?? 0;
    // Milestone 5 traits: riders on anything, rolling only for player mobs.
    const rd = Math.max(0, Math.floor(opts?.riders ?? 0));
    const roll = team === Team.Player && !isChamp ? opts?.roll : undefined;
    const rb = roll ? (roll.burstWeight > 0 ? roll.burstWeight : Infinity) : 0;
    const rr = roll?.maxRadius ?? 0;
    const w2 = rd > 0 || rb > 0;

    if (isChamp) {
      // Champions are rare and never stacked; they only need array space.
      for (let k = 0; k < count; k++) {
        const jx = spread > 0 ? x + (this.rand() * 2 - 1) * spread : x;
        if (this.n < this.capacity) {
          const i = this.addUnit(team, kind, jx, z, 1, hpPer, dmgPer, rad, 0);
          this.traits(i, spd, variant, br, bd);
          if (w2) this.traitsW2(i, rd, rb, rr);
        } else this.mergeIntoNearest(team, jx, z, Infinity, 1, -1);
      }
      return;
    }

    const free = Math.min(this.unitBudget, this.capacity) - this.n;
    if (count <= free) {
      for (let k = 0; k < count; k++) {
        const jx = spread > 0 ? x + (this.rand() * 2 - 1) * spread : x;
        const i = this.addUnit(team, kind, jx, z, 1, hpPer, dmgPer, rad, 0);
        this.traits(i, spd, variant, br, bd);
        if (w2) this.traitsW2(i, rd, rb, rr);
      }
    } else if (free >= 1) {
      // Fill the budget with singles, the rest rides on one stacked unit.
      for (let k = 0; k < free - 1; k++) {
        const jx = x + (this.rand() * 2 - 1) * spread;
        const i = this.addUnit(team, kind, jx, z, 1, hpPer, dmgPer, rad, 0);
        this.traits(i, spd, variant, br, bd);
        if (w2) this.traitsW2(i, rd, rb, rr);
      }
      const i = this.addUnit(team, kind, x, z, count - (free - 1), hpPer, dmgPer, rad, 0);
      this.traits(i, spd, variant, br, bd);
      if (w2) this.traitsW2(i, rd, rb, rr);
    } else if (!this.mergeIntoNearest(team, x, z, MERGE_RADIUS, count, variant)) {
      if (this.n < this.capacity) {
        const i = this.addUnit(team, kind, x, z, count, hpPer, dmgPer, rad, 0);
        this.traits(i, spd, variant, br, bd);
        if (w2) this.traitsW2(i, rd, rb, rr);
      } else this.mergeIntoNearest(team, x, z, Infinity, count, -1);
    }
  }

  // Milestone 4 per-unit traits; addUnit leaves them at the defaults (0).
  private traits(i: number, spd: number, variant: number, br: number, bd: number): void {
    this.speed[i] = spd;
    this.variant[i] = variant;
    this.blastR[i] = br;
    this.blastD[i] = bd;
    if (br > 0) this.hasBlasts = true;
  }

  // Milestone 5 traits: riders released on death, and the rolling snowball.
  private traitsW2(i: number, riders: number, burstWeight: number, maxRadius: number): void {
    if (riders > 0) {
      this.riders[i] = riders > 65535 ? 65535 : riders;
      this.hasRiders = true;
    }
    if (burstWeight > 0) {
      this.rollBurst[i] = burstWeight;
      this.rollMaxR[i] = maxRadius > 0 ? maxRadius : this.baseRad[i];
      this.hasRollers = true;
      this.setWeight(i, this.w[i]); // radius by the snowball rule
    }
  }

  private addUnit(
    team: Team,
    kind: UnitKind,
    x: number,
    z: number,
    w: number,
    hpPer: number,
    dmgPer: number,
    rad: number,
    mask: number,
  ): number {
    const i = this.n++;
    this.team[i] = team;
    this.kind[i] = kind;
    this.baseRad[i] = rad;
    this.hpPer[i] = hpPer;
    this.dmgPer[i] = dmgPer;
    this.passed[i] = mask;
    this.atkT[i] = 0;
    this.speed[i] = 0;
    this.variant[i] = 0;
    this.blastR[i] = 0;
    this.blastD[i] = 0;
    this.velX[i] = 0;
    this.onIce[i] = 0;
    this.frozenT[i] = 0;
    this.riders[i] = 0;
    this.rollBurst[i] = 0;
    this.rollMaxR[i] = 0;
    this.rollPop[i] = 0;
    if (kind === UnitKind.Champion) {
      this.w[i] = 1;
      this.weight[i] = 1;
      this.hp[i] = hpPer;
      this.radius[i] = rad;
    } else {
      this.hp[i] = w * hpPer;
      this.setWeight(i, w);
    }
    this.posX[i] = this.clampX(x, this.radius[i]);
    this.posZ[i] = z;
    this.prevZ[i] = z;
    return i;
  }

  // Adds weight to the nearest same-team mob within maxDist, of the same variant unless
  // variant is -1. The stack keeps its own stats and variant. Returns false if none found.
  private mergeIntoNearest(team: Team, x: number, z: number, maxDist: number, w: number, variant: number): boolean {
    let best = -1;
    let bestD2 = maxDist * maxDist;
    for (let i = 0; i < this.n; i++) {
      if (this.team[i] !== team || this.kind[i] !== UnitKind.Mob || this.hp[i] <= DEAD_EPS) continue;
      if (variant >= 0 && this.variant[i] !== variant) continue;
      const dx = this.posX[i] - x;
      const dz = this.posZ[i] - z;
      const d2 = dx * dx + dz * dz;
      if (d2 <= bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    if (best < 0) return false;
    this.hp[best] += w * this.hpPer[best];
    this.setWeight(best, this.w[best] + w);
    return true;
  }

  private setWeight(i: number, w: number): void {
    this.w[i] = w;
    this.weight[i] = w > 65535 ? 65535 : w;
    const r =
      this.rollBurst[i] > 0 ? rollRadius(this.baseRad[i], w, this.rollMaxR[i]) : stackedRadius(this.baseRad[i], w);
    this.radius[i] = r;
    this.posX[i] = this.clampX(this.posX[i], r);
  }

  private clampX(x: number, r: number): number {
    let lim = this.level.lane.width / 2 - r;
    if (lim < 0) lim = 0;
    return x < -lim ? -lim : x > lim ? lim : x;
  }

  // Drops `count` weight of single player mobs around (x, z), never ahead of z so they
  // cannot skip a gate line; past the unit budget the rest rides on one stacked mob.
  private scatter(
    x: number,
    z: number,
    count: number,
    half: number,
    hpPer: number,
    dmgPer: number,
    mask: number,
  ): void {
    const free = Math.min(this.unitBudget, this.capacity) - this.n;
    const singles = count <= free ? count : free > 1 ? free - 1 : 0;
    const rad = LAYOUT.mobRadius;
    for (let k = 0; k < singles; k++) {
      const jx = x + (this.rand() * 2 - 1) * half;
      const jz = z - this.rand() * half;
      this.addUnit(Team.Player, UnitKind.Mob, jx, jz, 1, hpPer, dmgPer, rad, mask);
    }
    const rest = count - singles;
    if (rest <= 0) return;
    if (this.n < this.capacity) this.addUnit(Team.Player, UnitKind.Mob, x, z, rest, hpPer, dmgPer, rad, mask);
    else this.mergeIntoNearest(Team.Player, x, z, Infinity, rest, -1);
  }

  // ---------- Step ----------

  step(dt: number, events: SimEvent[]): void {
    this._time += dt;
    if (this.pending.length > 0) {
      for (const e of this.pending) events.push(e);
      this.pending.length = 0;
    }
    this.thawGates(dt, events);
    this.move(dt);
    this.defenderContacts(dt);
    this.interact(events);
    this.applyPushes();
    this.iceWallContacts(dt, events);
    this.applyGates(events);
    this.rollers(events);
    this.towersFire(dt, events);
    this.defenderEvents(events);
    this.baseHits(events);
    this.detonate();
    this.releaseRiders(events);
    this.tickFreeze(dt);
    this.compact();
  }

  private move(dt: number): void {
    const { posX, posZ, prevZ, team, kind, radius, speed: unitSpeed, frozenT } = this;
    const len = this.level.lane.length;
    const halfW = this.level.enemyBase.width / 2;
    const bx = this.baseX;
    // A strafing (boss) base must be led by the player, so the funnel is off there.
    const steerFrom = this.level.boss ? Infinity : len - STEER_ZONE;
    // World 2 lateral motion (ice, wind, freeze); off on every World 1 level.
    const ice = this.ice.count > 0;
    const hazards = ice || this.wind !== 0 || this.freezeUntil > 0;
    const decayOn = ice ? Math.exp(-ICE_DECAY * dt) : 1;
    const decayOff = ice ? Math.exp(-OFF_ICE_DECAY * dt) : 1;
    for (let i = 0; i < this.n; i++) {
      const z = posZ[i];
      prevZ[i] = z;
      if (hazards && frozenT[i] > 0) continue;
      const on = ice && this.ice.contains(posX[i], z);
      if (team[i] === Team.Player) {
        const own = unitSpeed[i];
        const speed = own > 0 ? own : kind[i] === UnitKind.Champion ? SIM_TUNING.championSpeed : SIM_TUNING.mobSpeed;
        posZ[i] = z + speed * dt;
        if (z > steerFrom) {
          // Funnel toward the enemy base so units near the end don't miss it.
          const r = radius[i];
          let lo = bx - halfW + r;
          let hi = bx + halfW - r;
          if (lo > hi) lo = hi = bx;
          const x = posX[i];
          let maxStep = speed * STEER_FACTOR * dt;
          if (on) maxStep *= 1 - this.slip; // only iceGrip's share of steering works on ice
          if (x < lo) posX[i] = Math.min(lo, x + maxStep);
          else if (x > hi) posX[i] = Math.max(hi, x - maxStep);
        }
      } else {
        const own = unitSpeed[i];
        const speed = own > 0 ? own : kind[i] === UnitKind.Champion ? SIM_TUNING.championSpeed : SIM_TUNING.enemySpeed;
        posZ[i] = z - speed * dt;
      }
      if (hazards) this.drift(i, on, dt, decayOn, decayOff);
    }
  }

  // Wind and the ice slide for one unit. On ice the wind (minus the player's grip share)
  // accelerates the slide instead of moving the unit directly; off ice the slide bleeds off.
  private drift(i: number, on: boolean, dt: number, decayOn: number, decayOff: number): void {
    const wf = this.kind[i] === UnitKind.Champion ? this.wind * HEAVY_WIND : this.wind;
    let x = this.posX[i];
    let v = this.velX[i];
    if (on) {
      const s = this.team[i] === Team.Player ? this.slip : 1;
      if (!this.onIce[i] && s > 0 && this.team[i] === Team.Player) {
        // Stepping onto the ice: the player's soldier loses its footing and skids sideways,
        // so the crowd fans out on a patch even with no wind (iceGrip shrinks the skid).
        // Enemies, walking toward the player, only slide from wind and crowd pushes.
        const r = skidHash(i, Math.round(this._time * 1000));
        const dir = v !== 0 ? Math.sign(v) : r < 0.5 ? -1 : 1;
        v += dir * s * (ICE_KICK_MIN + (ICE_KICK_MAX - ICE_KICK_MIN) * (r < 0.5 ? r * 2 : r * 2 - 1));
      }
      v = v * decayOn + wf * s * ICE_WIND_GAIN * dt;
      v = v > ICE_MAX_SLIDE ? ICE_MAX_SLIDE : v < -ICE_MAX_SLIDE ? -ICE_MAX_SLIDE : v;
      if (s < 1) x += wf * (1 - s) * dt;
    } else {
      x += wf * dt;
      if (v !== 0) {
        v *= decayOff;
        if (v < SLIDE_EPS && v > -SLIDE_EPS) v = 0;
      }
    }
    this.onIce[i] = on ? 1 : 0;
    if (v !== 0) x += v * dt;
    const cx = this.clampX(x, this.radius[i]);
    if (cx !== x) v = 0; // the lane edge stops a slide
    this.posX[i] = cx;
    this.velX[i] = v;
  }

  // Counts down unit freezes (after move and base hits, so `seconds` means that many
  // seconds of standing still).
  private tickFreeze(dt: number): void {
    if (this.freezeUntil <= 0) return;
    const t = this.frozenT;
    for (let i = 0; i < this.n; i++) {
      const left = t[i] - dt;
      if (t[i] > 0) t[i] = left > FREEZE_EPS ? left : 0;
    }
    if (this._time >= this.freezeUntil - FREEZE_EPS) {
      t.fill(0, 0, this.n);
      this.freezeUntil = 0;
    }
  }

  // ---------- Defenders ----------

  // Does unit i (disc) overlap defender d's footprint?
  private touches(i: number, d: Defender): boolean {
    const r = this.radius[i];
    const dx = this.posX[i] - d.x;
    const dz = this.posZ[i] - d.z;
    if (d.kind === 'tower') {
      const rs = r + d.width / 2;
      return dx * dx + dz * dz < rs * rs;
    }
    // Wall or igloo: distance from the disc centre to the closest point of the rectangle.
    const hx = d.width / 2;
    const hz = d.depth / 2;
    const ox = dx < -hx ? dx + hx : dx > hx ? dx - hx : 0;
    const oz = dz < -hz ? dz + hz : dz > hz ? dz - hz : 0;
    return ox * ox + oz * oz < r * r;
  }

  private applyDefenderDamage(k: number, amount: number): void {
    const d = this.defs[k];
    const dealt = amount < d.hp ? amount : d.hp;
    d.hp -= dealt;
    if (d.hp <= DEAD_EPS) d.hp = 0;
    this.defDmgStep[k] += dealt;
  }

  // Player units touching a live defender: mobs cancel against it like against an enemy
  // crowd (min of both hp); champions stop and strike every CHAMPION_HIT_INTERVAL; a
  // snowball bursts instead. Enemy units ignore defenders.
  private defenderContacts(dt: number): void {
    const dc = this.defs.length;
    if (dc === 0) return;
    this.held.fill(0);
    const { posZ, prevZ, team, kind, hp, radius, atkT } = this;
    const zLo = this.defMinZ - LAYOUT.championRadius * 2.2;
    const zHi = this.defMaxZ + LAYOUT.championRadius * 2.2;
    for (let i = 0; i < this.n; i++) {
      if (team[i] !== Team.Player || hp[i] <= DEAD_EPS) continue;
      const z = posZ[i];
      if (z + radius[i] < zLo || z - radius[i] > zHi) continue;
      if (this.hasRollers && this.rollBurst[i] > 0) {
        for (let k = 0; k < dc; k++) {
          if (this.defs[k].hp > 0 && this.touches(i, this.defs[k])) {
            this.rollPop[i] = 1;
            break;
          }
        }
        continue;
      }
      const champ = kind[i] === UnitKind.Champion;
      let held = false;
      for (let k = 0; k < dc; k++) {
        const d = this.defs[k];
        if (d.hp <= 0 || !this.touches(i, d)) continue;
        if (champ) {
          held = true;
          this.held[i] = 1;
          posZ[i] = prevZ[i]; // stays put until the defender breaks
          atkT[i] -= dt;
          if (atkT[i] <= 0) {
            atkT[i] += CHAMPION_HIT_INTERVAL;
            this.applyDefenderDamage(k, this.dmgPer[i]);
          }
          break;
        }
        const before = this.defs[k].hp;
        this.applyDefenderDamage(k, hp[i]);
        hp[i] -= before - this.defs[k].hp;
        if (hp[i] <= DEAD_EPS) break;
      }
      if (champ && !held) atkT[i] = 0;
    }
  }

  // Each ready tower shoots the nearest live player unit within range (grid query).
  private towersFire(dt: number, events: SimEvent[]): void {
    const dc = this.defs.length;
    if (dc === 0) return;
    const { grid, posX, posZ, team, hp } = this;
    const head = grid.head;
    const next = grid.next;
    const cols = grid.cols;
    const rows = grid.rows;
    for (let k = 0; k < dc; k++) {
      const d = this.defs[k];
      if (d.kind !== 'tower' || d.hp <= 0) continue;
      let cd = this.defCd[k] - dt;
      if (cd > 0) {
        this.defCd[k] = cd;
        continue;
      }
      const range = this.defRange[k];
      const kc = Math.ceil(range / grid.cellSize);
      const cx = grid.cellX(d.x);
      const cz = grid.cellZ(d.z);
      const x0 = cx - kc < 0 ? 0 : cx - kc;
      const x1 = cx + kc >= cols ? cols - 1 : cx + kc;
      const z0 = cz - kc < 0 ? 0 : cz - kc;
      const z1 = cz + kc >= rows ? rows - 1 : cz + kc;
      let best = -1;
      let bestD2 = range * range;
      for (let gz = z0; gz <= z1; gz++) {
        const rowBase = gz * cols;
        for (let gx = x0; gx <= x1; gx++) {
          for (let j = head[rowBase + gx]; j >= 0; j = next[j]) {
            if (team[j] !== Team.Player || hp[j] <= DEAD_EPS) continue;
            const dx = posX[j] - d.x;
            const dz = posZ[j] - d.z;
            const d2 = dx * dx + dz * dz;
            if (d2 <= bestD2) {
              bestD2 = d2;
              best = j;
            }
          }
        }
      }
      if (best < 0) {
        this.defCd[k] = 0; // ready, waiting for a target
        continue;
      }
      cd += this.defPeriod[k];
      this.defCd[k] = cd > 0 ? cd : 0;
      hp[best] -= this.defDamage[k]; // compact() turns lost hp into lost weight
      events.push({ type: 'defenderShot', id: d.id, x: d.x, z: d.z, tx: posX[best], tz: posZ[best] });
    }
  }

  // One defenderHit per damaged defender per step, then defenderDestroyed exactly once.
  private defenderEvents(events: SimEvent[]): void {
    for (let k = 0; k < this.defs.length; k++) {
      const d = this.defs[k];
      const dmg = this.defDmgStep[k];
      if (dmg > 0) events.push({ type: 'defenderHit', id: d.id, damage: dmg, x: d.x, z: d.z });
      this.defDmgStep[k] = 0; // damage dealt outside step() (damageDefender) shows up next step
      if (d.hp <= 0 && !this.defDead[k]) {
        this.defDead[k] = 1;
        events.push({ type: 'defenderDestroyed', id: d.id, kind: d.kind, x: d.x, z: d.z });
      }
    }
  }

  // Builds the grid, then resolves every overlapping pair once: cancellation across
  // teams, separation within a team. Mob pairs use a small neighbourhood; big units
  // (champions and snowballs) query a wider one in a second pass.
  private interact(events: SimEvent[]): void {
    const n = this.n;
    const { posX, posZ, kind, radius, grid, rollBurst } = this;
    const rollers = this.hasRollers;
    const head = grid.head;
    const next = grid.next;
    this.clashes = 0;
    this.pushX.fill(0, 0, n);
    this.pushZ.fill(0, 0, n);

    grid.clear();
    let maxMobR = 0;
    let maxR = 0;
    for (let i = 0; i < n; i++) {
      grid.insert(i, posX[i], posZ[i]);
      const r = radius[i];
      if (r > maxR) maxR = r;
      if (kind[i] === UnitKind.Mob && !(rollers && rollBurst[i] > 0) && r > maxMobR) maxMobR = r;
    }

    const cols = grid.cols;
    const rows = grid.rows;
    const inv = 1 / grid.cellSize;

    for (let i = 0; i < n; i++) {
      const big = kind[i] === UnitKind.Champion || (rollers && rollBurst[i] > 0);
      const k = Math.ceil((radius[i] + (big ? maxR : maxMobR)) * inv);
      const cx = grid.cellX(posX[i]);
      const cz = grid.cellZ(posZ[i]);
      const x0 = cx - k < 0 ? 0 : cx - k;
      const x1 = cx + k >= cols ? cols - 1 : cx + k;
      const z0 = cz - k < 0 ? 0 : cz - k;
      const z1 = cz + k >= rows ? rows - 1 : cz + k;
      for (let gz = z0; gz <= z1; gz++) {
        const rowBase = gz * cols;
        for (let gx = x0; gx <= x1; gx++) {
          for (let j = head[rowBase + gx]; j >= 0; j = next[j]) {
            // Each pair once: mob-mob from the lower index; anything involving a big
            // unit from the big unit's pass (lower index if both are big).
            const bigJ = kind[j] === UnitKind.Champion || (rollers && rollBurst[j] > 0);
            if (big) {
              if (j === i || (bigJ && j < i)) continue;
            } else if (j <= i || bigJ) continue;
            this.pair(i, j, events);
          }
        }
      }
    }
  }

  private pair(i: number, j: number, events: SimEvent[]): void {
    const { posX, posZ, radius, hp } = this;
    if (hp[i] <= DEAD_EPS || hp[j] <= DEAD_EPS) return;
    const dx = posX[j] - posX[i];
    const dz = posZ[j] - posZ[i];
    const rs = radius[i] + radius[j];
    const d2 = dx * dx + dz * dz;
    if (d2 >= rs * rs) return;

    if (this.team[i] !== this.team[j]) {
      if (this.hasRollers && (this.rollBurst[i] > 0 || this.rollBurst[j] > 0)) {
        // A snowball meeting the enemy bursts (rollers()) instead of cancelling.
        if (this.rollBurst[i] > 0) this.rollPop[i] = 1;
        if (this.rollBurst[j] > 0) this.rollPop[j] = 1;
        return;
      }
      const d = hp[i] < hp[j] ? hp[i] : hp[j];
      hp[i] -= d;
      hp[j] -= d;
      if (this.clashes < MAX_CLASH_EVENTS) {
        this.clashes++;
        events.push({ type: 'unitsClash', x: (posX[i] + posX[j]) * 0.5, z: (posZ[i] + posZ[j]) * 0.5 });
      }
      return;
    }

    if (this.hasRollers) {
      // A snowball rolling over a lone player mob picks it up.
      const ri = this.rollBurst[i] > 0;
      if (ri !== this.rollBurst[j] > 0) {
        const b = ri ? i : j;
        const m = ri ? j : i;
        if (this.kind[m] === UnitKind.Mob) {
          hp[b] += this.w[m] * this.hpPer[b];
          this.setWeight(b, this.w[b] + this.w[m]);
          hp[m] = 0;
          return;
        }
      }
    }

    // Same team: push apart, the smaller unit moving more.
    const dist = Math.sqrt(d2);
    let nx: number;
    let nz: number;
    if (dist < 1e-6) {
      nx = (i ^ j) & 1 ? 1 : -1; // coincident: deterministic sideways split
      nz = 0;
    } else {
      nx = dx / dist;
      nz = dz / dist;
    }
    const overlap = (rs - dist) * SIM_TUNING.separation;
    const si = (overlap * radius[j]) / rs;
    const sj = (overlap * radius[i]) / rs;
    this.pushX[i] -= nx * si;
    this.pushZ[i] -= nz * si;
    this.pushX[j] += nx * sj;
    this.pushZ[j] += nz * sj;
  }

  private applyPushes(): void {
    const { posX, posZ, pushX, pushZ, radius, held, frozenT, onIce, velX } = this;
    const cap2 = MAX_PUSH * MAX_PUSH;
    const frozen = this.freezeUntil > 0;
    const ice = this.ice.count > 0;
    for (let i = 0; i < this.n; i++) {
      if (frozen && frozenT[i] > 0) continue; // frozen solid: others are pushed off it
      let px = pushX[i];
      let pz = pushZ[i];
      // A champion held at a defender must not be shoved into it by the crowd behind.
      if (held[i] && pz > 0) pz = 0;
      const l2 = px * px + pz * pz;
      if (l2 > cap2) {
        const s = MAX_PUSH / Math.sqrt(l2);
        px *= s;
        pz *= s;
      }
      const x = posX[i] + px;
      const cx = this.clampX(x, radius[i]);
      if (ice && onIce[i]) {
        // On ice the push is not forgotten: part of it carries on as slide.
        const s = this.team[i] === Team.Player ? this.slip : 1;
        let v = velX[i] + px * s * ICE_PUSH_GAIN;
        v = v > ICE_MAX_SLIDE ? ICE_MAX_SLIDE : v < -ICE_MAX_SLIDE ? -ICE_MAX_SLIDE : v;
        velX[i] = cx !== x ? 0 : v;
      }
      posX[i] = cx;
      posZ[i] += pz;
    }
  }

  // ---------- Ice walls (Milestone 5) ----------

  // Pushes every unit out of the ice walls: sideways to the nearer open side when that is
  // the shorter way out, otherwise back off the face it hit while sliding toward the gap.
  private iceWallContacts(dt: number, events: SimEvent[]): void {
    const W = this.iceWalls;
    if (W.count === 0) return;
    const { posX, posZ, radius, hp } = this;
    const zLo = W.minZ - LAYOUT.championRadius * 2.2;
    const zHi = W.maxZ + LAYOUT.championRadius * 2.2;
    const slide = ICE_WALL_SLIDE * dt;
    this.wallHits = 0;
    for (let i = 0; i < this.n; i++) {
      if (hp[i] <= DEAD_EPS) continue;
      const r = radius[i];
      if (posZ[i] + r < zLo || posZ[i] - r > zHi) continue;
      for (let k = 0; k < W.count; k++) {
        const x = posX[i];
        const dx = x - W.cx[k];
        const dz = posZ[i] - W.cz[k];
        const hw = W.hw[k];
        const hd = W.hd[k];
        const ex = hw + r;
        const ez = hd + r;
        const adx = dx < 0 ? -dx : dx;
        const adz = dz < 0 ? -dz : dz;
        if (adx >= ex || adz >= ez) continue;
        if (adx > hw && adz > hd) {
          const ox = adx - hw;
          const oz = adz - hd;
          if (ox * ox + oz * oz >= r * r) continue; // clear of the rounded corner
        }
        if (this.hasRollers && this.rollBurst[i] > 0) this.rollPop[i] = 1;
        const near = dx < 0 ? -1 : 1;
        let side = near;
        if (!(side < 0 ? W.leftOpen[k] : W.rightOpen[k])) side = -side;
        const open = side < 0 ? W.leftOpen[k] : W.rightOpen[k];
        const outX = side === near ? ex - adx : ex + adx;
        if (open && outX <= ez - adz) {
          posX[i] = this.clampX(W.cx[k] + side * ex, r);
          this.velX[i] = 0;
          continue;
        }
        const face = W.cz[k] + (dz < 0 ? -ez : ez);
        posZ[i] = face;
        if (open) posX[i] = this.clampX(x + side * slide, r);
        if (this.wallHits < MAX_ICE_WALL_EVENTS) {
          this.wallHits++;
          events.push({ type: 'iceWallHit', id: W.ids[k], x, z: face });
        }
      }
    }
  }

  // ---------- Gates ----------

  // Player mobs crossing a gate line inside its width get the gate's op once. A frozen
  // gate gives nothing and player units (champions too) reaching it chip its ice instead.
  private applyGates(events: SimEvent[]): void {
    const gates = this.level.gates;
    const gc = gates.length;
    if (gc === 0) return;
    const t = this._time;
    for (let g = 0; g < gc; g++) {
      this.gateXs[g] = gateX(gates[g], t);
      this.gateAdded[g] = 0;
      this.gateHits[g] = 0;
      this.gateSumX[g] = 0;
    }
    const n = this.n; // clones appended below are not re-tested this step
    const { posX, posZ, prevZ, team, kind, hp, passed } = this;
    for (let i = 0; i < n; i++) {
      if (team[i] !== Team.Player) continue;
      const mob = kind[i] === UnitKind.Mob;
      if (!mob && this.frozenGates === 0) continue;
      const z = posZ[i];
      const pz = prevZ[i];
      for (let g = 0; g < gc; g++) {
        if (hp[i] <= DEAD_EPS) break;
        if (this.gateBroken[g] || (passed[i] >>> g) & 1) continue;
        const gate = gates[g];
        if (!(pz < gate.z && gate.z <= z)) continue;
        if (Math.abs(posX[i] - this.gateXs[g]) > gate.width / 2) continue;
        if (this.frozenGates > 0 && this.gateIceHp[g] > 0 && !this.hitIce(i, g, events)) {
          if (this.rollPop[i]) break; // a snowball stopped at the ice
          continue;
        }
        if (mob) this.crossGate(i, g, events);
      }
    }
    for (let g = 0; g < gc; g++) {
      const hits = this.gateHits[g];
      if (hits === 0) continue;
      const gate = gates[g];
      const x = this.gateSumX[g] / hits;
      if (gate.uses === undefined) {
        events.push({ type: 'gate', gateId: gate.id, x, z: gate.z, added: this.gateAdded[g] });
        continue;
      }
      const usesLeft = Math.max(0, Math.floor(this.gateUses[g]));
      events.push({ type: 'gate', gateId: gate.id, x, z: gate.z, added: this.gateAdded[g], usesLeft });
      if (this.gateBroken[g]) events.push({ type: 'gateBroken', gateId: gate.id, x: this.gateXs[g], z: gate.z });
    }
  }

  private crossGate(i: number, g: number, events: SimEvent[]): void {
    const gate = this.level.gates[g];
    this.passed[i] = (this.passed[i] | (1 << g)) >>> 0;
    this.gateHits[g]++;
    this.gateSumX[g] += this.posX[i];
    const w = this.w[i];
    // One-use gates spend the crossing unit's weight from their budget; the unit that
    // empties it still gets the full effect.
    if (this.gateUses[g] !== Infinity) {
      this.gateUses[g] -= w;
      if (this.gateUses[g] <= 0) {
        this.gateUses[g] = 0;
        this.gateBroken[g] = 1;
      }
    }
    // Freezing gates count crossing weight the same way; the unit that fills the budget
    // still gets the effect, everyone after it meets the ice.
    const fz = gate.freeze;
    if (fz !== undefined) {
      this.gateCross[g] += w;
      if (this.gateCross[g] >= fz.after * this.freezeAfter) this.freezeNow(g, fz.duration, fz.hp, events);
    }
    const v = gate.value;
    switch (gate.op) {
      case 'mul':
        this.burst(i, g, Math.round((v - 1) * w));
        break;
      case 'add':
        this.burst(i, g, Math.round(v));
        break;
      case 'sub': {
        const nw = Math.max(0, w - Math.round(v));
        this.gateAdded[g] += nw - w;
        this.hp[i] = nw * this.hpPer[i];
        if (nw > 0) this.setWeight(i, nw);
        break;
      }
      case 'div': {
        const q = w / v;
        let nw = Math.floor(q);
        if (this.rand() < q - nw) nw++;
        this.gateAdded[g] += nw - w;
        this.hp[i] = nw * this.hpPer[i];
        if (nw > 0) this.setWeight(i, nw);
        break;
      }
    }
  }

  // New weight from a gate appears as single clones around the crossing point;
  // whatever does not fit in the budget is stacked onto the crossing unit itself.
  // A snowball takes all of it into itself.
  private burst(i: number, g: number, added: number): void {
    if (added <= 0) return;
    this.gateAdded[g] += added;
    const free = Math.min(this.unitBudget, this.capacity) - this.n;
    const singles = this.rollBurst[i] > 0 ? 0 : added <= free ? added : free > 0 ? free : 0;
    const gate = this.level.gates[g];
    const half = Math.min(0.45 * gate.width, BURST_MAX_HALF);
    const cx = this.posX[i];
    const mask = this.passed[i];
    for (let k = 0; k < singles; k++) {
      const x = cx + (this.rand() * 2 - 1) * half;
      const z = gate.z + this.rand() * BURST_DEPTH;
      const j = this.addUnit(Team.Player, UnitKind.Mob, x, z, 1, this.hpPer[i], this.dmgPer[i], this.baseRad[i], mask);
      this.traits(j, this.speed[i], this.variant[i], this.blastR[i], this.blastD[i]);
    }
    const rest = added - singles;
    if (rest > 0) {
      this.hp[i] += rest * this.hpPer[i];
      this.setWeight(i, this.w[i] + rest);
    }
  }

  // Unit i reached frozen gate g: a snowball stops and bursts; anything else cancels
  // against the ice (min of both, chip damage x thawRate). Returns true when the ice
  // broke and the unit survived, so it goes on to cross the thawed gate.
  private hitIce(i: number, g: number, events: SimEvent[]): boolean {
    if (this.hasRollers && this.rollBurst[i] > 0) {
      this.rollPop[i] = 1;
      this.posZ[i] = this.prevZ[i]; // burst on the near side of the line
      return false;
    }
    const rate = this.thawRate;
    const ice = this.gateIceHp[g];
    const can = this.hp[i] * rate;
    const chip = can < ice ? can : ice;
    this.gateIceHp[g] = ice - chip;
    this.hp[i] -= chip / rate;
    const gate = this.level.gates[g];
    if (this.gateIceHp[g] <= DEAD_EPS) {
      this.thaw(g, true, events);
      if (this.hp[i] <= DEAD_EPS) return false;
      if (this.kind[i] === UnitKind.Mob) {
        const w = Math.ceil(this.hp[i] / this.hpPer[i] - 1e-6);
        if (w !== this.w[i]) this.setWeight(i, w);
      }
      return true;
    }
    if (this._time - this.gateChipAt[g] >= CHIP_EVENT_GAP - 1e-9) {
      this.gateChipAt[g] = this._time;
      events.push({
        type: 'gateChipped',
        gateId: gate.id,
        x: this.gateXs[g],
        z: gate.z,
        hp: this.gateIceHp[g],
        maxHp: this.gateIceMax[g],
      });
    }
    return false;
  }

  private freezeNow(g: number, seconds: number, hp: number, events: SimEvent[]): void {
    const gate = this.level.gates[g];
    if (this.gateIceHp[g] <= 0) this.frozenGates++;
    this.gateIceHp[g] = hp;
    this.gateIceMax[g] = hp;
    this.gateFreezeT[g] = seconds;
    this.gateCross[g] = 0;
    events.push({ type: 'gateFrozen', gateId: gate.id, x: gateX(gate, this._time), z: gate.z, duration: seconds });
  }

  private thaw(g: number, chipped: boolean, events: SimEvent[]): void {
    const gate = this.level.gates[g];
    this.gateIceHp[g] = 0;
    this.gateFreezeT[g] = 0;
    this.gateCross[g] = 0;
    this.frozenGates--;
    events.push({ type: 'gateThawed', gateId: gate.id, x: gateX(gate, this._time), z: gate.z, chipped });
  }

  // Frozen gates melt on their own at thawRate.
  private thawGates(dt: number, events: SimEvent[]): void {
    if (this.frozenGates === 0) return;
    const step = dt * this.thawRate;
    for (let g = 0; g < this.gateIceHp.length; g++) {
      if (this.gateIceHp[g] <= 0) continue;
      this.gateFreezeT[g] -= step;
      if (this.gateFreezeT[g] <= 1e-9) this.thaw(g, false, events);
    }
  }

  // ---------- Snowballs and riders (Milestone 5) ----------

  // Bursts every snowball that touched something this step, reached its burst weight or
  // came close to the enemy base, into its weight in single mobs.
  private rollers(events: SimEvent[]): void {
    if (!this.hasRollers) return;
    const lim = this.level.lane.length - ROLL_BURST_BEFORE_BASE;
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const burstAt = this.rollBurst[i];
      if (burstAt <= 0 || this.hp[i] <= DEAD_EPS) continue;
      if (!this.rollPop[i] && this.w[i] < burstAt && this.posZ[i] < lim) continue;
      const x = this.posX[i];
      const z = this.posZ[i];
      const count = this.w[i];
      this.rollBurst[i] = 0;
      this.rollPop[i] = 0;
      this.hp[i] = 0;
      this.scatter(x, z, count, this.radius[i], this.hpPer[i], this.dmgPer[i], this.passed[i]);
      events.push({ type: 'snowballBurst', x, z, count });
    }
  }

  // Units carrying riders that died this step (any cause) drop them where they fell.
  private releaseRiders(events: SimEvent[]): void {
    if (!this.hasRiders) return;
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const c = this.riders[i];
      if (c === 0 || this.hp[i] > DEAD_EPS) continue;
      this.riders[i] = 0;
      const x = this.posX[i];
      const z = this.posZ[i];
      this.scatter(x, z, c, this.radius[i], 1, 1, this.passed[i]);
      events.push({ type: 'giantFell', x, z, riders: c });
    }
  }

  // Units reaching the far end hit the opposing base. Aggregated to one event per base per step.
  // On boss levels a player unit arriving outside the base span is lost (baseMiss).
  // Frozen units never hit a base.
  private baseHits(events: SimEvent[]): void {
    const len = this.level.lane.length;
    const baseZ = LAYOUT.playerBaseZ;
    const strafing = this.level.boss !== undefined;
    const halfW = this.level.enemyBase.width / 2;
    const bx = this.baseX;
    const frozen = this.freezeUntil > 0;
    let misses = 0;
    let missX = 0;
    let pDmg = 0;
    let pHits = 0;
    let pX = 0;
    let eDmg = 0;
    let eHits = 0;
    let eX = 0;
    const { posX, posZ, team, kind, hp } = this;
    for (let i = 0; i < this.n; i++) {
      if (hp[i] <= DEAD_EPS) continue;
      if (frozen && this.frozenT[i] > 0) continue;
      const dmg = kind[i] === UnitKind.Champion ? this.dmgPer[i] : this.dmgPer[i] * this.w[i];
      if (team[i] === Team.Player) {
        if (posZ[i] < len) continue;
        if (strafing && Math.abs(posX[i] - bx) > halfW + this.radius[i]) {
          misses++;
          missX += posX[i];
          hp[i] = 0;
          continue;
        }
        eDmg += dmg;
        eHits++;
        eX += posX[i];
      } else {
        if (posZ[i] > baseZ) continue;
        pDmg += dmg;
        pHits++;
        pX += posX[i];
      }
      hp[i] = 0;
    }
    if (eHits > 0) events.push({ type: 'baseHit', team: Team.Enemy, damage: eDmg, x: eX / eHits, z: len });
    if (misses > 0) events.push({ type: 'baseMiss', x: missX / misses, z: len, count: misses });
    if (pHits > 0) events.push({ type: 'baseHit', team: Team.Player, damage: pDmg, x: pX / pHits, z: baseZ });
  }

  // Swap-remove dead units so live ones stay in [0, count); refresh mob weights from hp.
  private compact(): void {
    const { hp, kind } = this;
    let i = 0;
    while (i < this.n) {
      if (hp[i] <= DEAD_EPS) {
        const last = --this.n;
        if (i !== last) this.copy(last, i);
        continue;
      }
      if (kind[i] === UnitKind.Mob) {
        const w = Math.ceil(hp[i] / this.hpPer[i] - 1e-6);
        if (w !== this.w[i]) this.setWeight(i, w);
      }
      i++;
    }
  }

  private copy(from: number, to: number): void {
    this.posX[to] = this.posX[from];
    this.posZ[to] = this.posZ[from];
    this.prevZ[to] = this.prevZ[from];
    this.team[to] = this.team[from];
    this.kind[to] = this.kind[from];
    this.weight[to] = this.weight[from];
    this.radius[to] = this.radius[from];
    this.hp[to] = this.hp[from];
    this.w[to] = this.w[from];
    this.hpPer[to] = this.hpPer[from];
    this.dmgPer[to] = this.dmgPer[from];
    this.baseRad[to] = this.baseRad[from];
    this.passed[to] = this.passed[from];
    this.atkT[to] = this.atkT[from];
    this.speed[to] = this.speed[from];
    this.variant[to] = this.variant[from];
    this.blastR[to] = this.blastR[from];
    this.blastD[to] = this.blastD[from];
    this.velX[to] = this.velX[from];
    this.onIce[to] = this.onIce[from];
    this.frozenT[to] = this.frozenT[from];
    this.riders[to] = this.riders[from];
    this.rollBurst[to] = this.rollBurst[from];
    this.rollMaxR[to] = this.rollMaxR[from];
    this.rollPop[to] = this.rollPop[from];
  }

  // ---------- Blasts and area damage (Milestone 4) ----------

  // Dead units carrying a death blast go off once: damage per weight times the weight
  // they had, spent on the other team inside the radius. Repeats while a blast killed
  // another blast unit, so chains resolve in the same step.
  private detonate(): void {
    if (!this.hasBlasts) return;
    const { hp, blastR } = this;
    let again = true;
    while (again) {
      again = false;
      for (let i = 0; i < this.n; i++) {
        const r = blastR[i];
        if (r <= 0 || hp[i] > DEAD_EPS) continue;
        blastR[i] = 0;
        const other = this.team[i] === Team.Player ? Team.Enemy : Team.Player;
        const x = this.posX[i];
        const z = this.posZ[i];
        this.hurt(other, x, z, r, this.blastD[i] * this.w[i]);
        if (this.blastCount < MAX_BLASTS) {
          const b = this.blastCount++;
          this.blastX[b] = x;
          this.blastZ[b] = z;
          this.blastRad[b] = r;
        }
        again = true;
      }
    }
  }

  // Spends up to `budget` weight on live units of `team` overlapping the circle, in index
  // order. Lowers hp only; compact() turns that into weight and removes the dead.
  private hurt(team: Team, x: number, z: number, radius: number, budget: number): number {
    const { posX, posZ, hp, kind } = this;
    let left = budget;
    for (let j = 0; j < this.n && left > DEAD_EPS; j++) {
      if (this.team[j] !== team || hp[j] <= DEAD_EPS) continue;
      const dx = posX[j] - x;
      const dz = posZ[j] - z;
      const rs = radius + this.radius[j];
      if (dx * dx + dz * dz >= rs * rs) continue;
      const per = kind[j] === UnitKind.Champion ? 1 : this.hpPer[j];
      const has = hp[j] / per;
      const take = has < left ? has : left;
      hp[j] -= take * per;
      left -= take;
    }
    return budget - left;
  }

  takeBlasts(out: SimBlast[]): void {
    for (let b = 0; b < this.blastCount; b++) {
      out.push({ x: this.blastX[b], z: this.blastZ[b], radius: this.blastRad[b] });
    }
    this.blastCount = 0;
  }

  damageArea(team: Team, x: number, z: number, radius: number, maxWeight: number): number {
    if (!(maxWeight > 0)) return 0;
    const removed = this.hurt(team, x, z, radius, maxWeight);
    if (removed > 0) {
      this.detonate();
      this.releaseRiders(this.pending);
      this.compact();
    }
    return removed;
  }

  damageDefender(index: number, amount: number): void {
    const d = this.defs[index];
    if (d && d.hp > 0 && amount > 0) this.applyDefenderDamage(index, amount);
  }

  // ---------- Milestone 5 controls ----------

  setWind(vx: number): void {
    this.wind = Number.isFinite(vx) ? vx : 0;
  }

  freezeGate(index: number, seconds: number, hp: number): void {
    if (index < 0 || index >= this.gateIceHp.length || this.gateBroken[index]) return;
    if (!(seconds > 0) || !(hp > 0)) return;
    this.freezeNow(index, seconds, hp, this.pending);
  }

  gateIce(index: number): number {
    return this.gateIceHp[index] ?? 0;
  }

  freezeUnits(team: Team, x: number, z: number, radius: number, seconds: number): number {
    if (!(seconds > 0)) return 0;
    const { posX, posZ, hp, frozenT } = this;
    let frozen = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.team[i] !== team || hp[i] <= DEAD_EPS) continue;
      const dx = posX[i] - x;
      const dz = posZ[i] - z;
      const rs = radius + this.radius[i];
      if (dx * dx + dz * dz >= rs * rs) continue;
      if (frozenT[i] < seconds) frozenT[i] = seconds;
      this.velX[i] = 0;
      frozen += this.kind[i] === UnitKind.Champion ? 1 : this.w[i];
    }
    if (frozen > 0 && this._time + seconds > this.freezeUntil) this.freezeUntil = this._time + seconds;
    this.pending.push({ type: 'unitsFrozen', team, x, z, radius, seconds });
    return frozen;
  }
}

export function createSim(level: LevelDef, rand: () => number, opts?: SimOptions): Sim {
  return new CrowdSim(level, rand, opts);
}
