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

import type { DefenderKind, DefenderView, LevelDef, SimEvent, SimView } from '../contracts.ts';
import { DEFENDER_DEFAULTS, LAYOUT, Team, UnitKind, gateX } from '../contracts.ts';
import { SpatialGrid } from './grid.ts';

export interface SpawnOpts {
  hp?: number; // per weight for mobs (default 1, so hp == weight); absolute for champions
  damage?: number; // per weight for mobs (default 1, so damage == weight); absolute for champions
  radius?: number; // base radius; default LAYOUT.mobRadius / LAYOUT.championRadius by kind
  spread?: number; // half-width of random x jitter for count > 1 (default 0.35)
  speed?: number; // world units / s; default SIM_TUNING by team and kind
  variant?: number; // render variant byte (0 rifleman / enemy mob, 1 knight, ...); default 0
  deathBlast?: { radius: number; damage: number }; // on death, hurts the other team nearby (damage per weight)
}

// The view with the per-unit render variant (Milestone 4).
export type SimViewM4 = SimView & { readonly variant: Uint8Array };

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

// Heavier stacked units are drawn (and collide) bigger, capped at 2.2x.
function stackedRadius(base: number, w: number): number {
  return w <= 1 ? base : base * Math.min(2.2, 1 + 0.22 * Math.log2(w));
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

  private readonly grid: SpatialGrid;
  private readonly gateXs: Float64Array;
  private readonly gateAdded: Float64Array;
  private readonly gateHits: Int32Array;
  private readonly gateSumX: Float64Array;
  private readonly gateUses: Float64Array; // remaining crossing weight; Infinity = unlimited
  private readonly gateBroken: Uint8Array;
  private clashes = 0;

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

    const dc = defDefs.length;
    this.defRange = new Float64Array(dc);
    this.defPeriod = new Float64Array(dc);
    this.defDamage = new Float64Array(dc);
    this.defCd = new Float64Array(dc);
    this.defDmgStep = new Float64Array(dc);
    this.defDead = new Uint8Array(dc);
    this.defs = defDefs.map((d, k) => {
      const tower = d.kind === 'tower';
      const width = d.width ?? (tower ? DEFENDER_DEFAULTS.towerWidth : DEFENDER_DEFAULTS.wallWidth);
      const depth = tower ? width : DEFENDER_DEFAULTS.wallDepth;
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

    if (isChamp) {
      // Champions are rare and never stacked; they only need array space.
      for (let k = 0; k < count; k++) {
        const jx = spread > 0 ? x + (this.rand() * 2 - 1) * spread : x;
        if (this.n < this.capacity)
          this.traits(this.addUnit(team, kind, jx, z, 1, hpPer, dmgPer, rad, 0), spd, variant, br, bd);
        else this.mergeIntoNearest(team, jx, z, Infinity, 1, -1);
      }
      return;
    }

    const free = Math.min(this.unitBudget, this.capacity) - this.n;
    if (count <= free) {
      for (let k = 0; k < count; k++) {
        const jx = spread > 0 ? x + (this.rand() * 2 - 1) * spread : x;
        this.traits(this.addUnit(team, kind, jx, z, 1, hpPer, dmgPer, rad, 0), spd, variant, br, bd);
      }
    } else if (free >= 1) {
      // Fill the budget with singles, the rest rides on one stacked unit.
      for (let k = 0; k < free - 1; k++) {
        const jx = x + (this.rand() * 2 - 1) * spread;
        this.traits(this.addUnit(team, kind, jx, z, 1, hpPer, dmgPer, rad, 0), spd, variant, br, bd);
      }
      this.traits(this.addUnit(team, kind, x, z, count - (free - 1), hpPer, dmgPer, rad, 0), spd, variant, br, bd);
    } else if (!this.mergeIntoNearest(team, x, z, MERGE_RADIUS, count, variant)) {
      if (this.n < this.capacity)
        this.traits(this.addUnit(team, kind, x, z, count, hpPer, dmgPer, rad, 0), spd, variant, br, bd);
      else this.mergeIntoNearest(team, x, z, Infinity, count, -1);
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
    const r = stackedRadius(this.baseRad[i], w);
    this.radius[i] = r;
    this.posX[i] = this.clampX(this.posX[i], r);
  }

  private clampX(x: number, r: number): number {
    let lim = this.level.lane.width / 2 - r;
    if (lim < 0) lim = 0;
    return x < -lim ? -lim : x > lim ? lim : x;
  }

  // ---------- Step ----------

  step(dt: number, events: SimEvent[]): void {
    this._time += dt;
    this.move(dt);
    this.defenderContacts(dt);
    this.interact(events);
    this.applyPushes();
    this.applyGates(events);
    this.towersFire(dt, events);
    this.defenderEvents(events);
    this.baseHits(events);
    this.detonate();
    this.compact();
  }

  private move(dt: number): void {
    const { posX, posZ, prevZ, team, kind, radius, speed: unitSpeed } = this;
    const len = this.level.lane.length;
    const halfW = this.level.enemyBase.width / 2;
    const bx = this.baseX;
    // A strafing (boss) base must be led by the player, so the funnel is off there.
    const steerFrom = this.level.boss ? Infinity : len - STEER_ZONE;
    for (let i = 0; i < this.n; i++) {
      const z = posZ[i];
      prevZ[i] = z;
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
          const maxStep = speed * STEER_FACTOR * dt;
          if (x < lo) posX[i] = Math.min(lo, x + maxStep);
          else if (x > hi) posX[i] = Math.max(hi, x - maxStep);
        }
      } else {
        const own = unitSpeed[i];
        const speed = own > 0 ? own : kind[i] === UnitKind.Champion ? SIM_TUNING.championSpeed : SIM_TUNING.enemySpeed;
        posZ[i] = z - speed * dt;
      }
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
    // Wall: distance from the disc centre to the closest point of the rectangle.
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
  // crowd (min of both hp); champions stop and strike every CHAMPION_HIT_INTERVAL.
  // Enemy units ignore defenders.
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
  // teams, separation within a team. Mob pairs use a small neighbourhood; champions
  // (large radius) query a wider one in a second pass.
  private interact(events: SimEvent[]): void {
    const n = this.n;
    const { posX, posZ, kind, radius, grid } = this;
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
      if (kind[i] === UnitKind.Mob && r > maxMobR) maxMobR = r;
    }

    const cols = grid.cols;
    const rows = grid.rows;
    const inv = 1 / grid.cellSize;

    for (let i = 0; i < n; i++) {
      const champ = kind[i] === UnitKind.Champion;
      const k = Math.ceil((radius[i] + (champ ? maxR : maxMobR)) * inv);
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
            // Each pair once: mob-mob from the lower index; anything involving a
            // champion from the champion's pass (lower index if both are champions).
            if (champ) {
              if (j === i || (kind[j] === UnitKind.Champion && j < i)) continue;
            } else if (j <= i || kind[j] === UnitKind.Champion) continue;
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
      const d = hp[i] < hp[j] ? hp[i] : hp[j];
      hp[i] -= d;
      hp[j] -= d;
      if (this.clashes < MAX_CLASH_EVENTS) {
        this.clashes++;
        events.push({ type: 'unitsClash', x: (posX[i] + posX[j]) * 0.5, z: (posZ[i] + posZ[j]) * 0.5 });
      }
      return;
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
    const { posX, posZ, pushX, pushZ, radius, held } = this;
    const cap2 = MAX_PUSH * MAX_PUSH;
    for (let i = 0; i < this.n; i++) {
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
      posX[i] = this.clampX(posX[i] + px, radius[i]);
      posZ[i] += pz;
    }
  }

  // Player mobs crossing a gate line inside its width get the gate's op once.
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
      if (team[i] !== Team.Player || kind[i] !== UnitKind.Mob) continue;
      const z = posZ[i];
      const pz = prevZ[i];
      for (let g = 0; g < gc; g++) {
        if (hp[i] <= DEAD_EPS) break;
        if (this.gateBroken[g] || (passed[i] >>> g) & 1) continue;
        const gate = gates[g];
        if (!(pz < gate.z && gate.z <= z)) continue;
        if (Math.abs(posX[i] - this.gateXs[g]) > gate.width / 2) continue;
        this.crossGate(i, g);
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

  private crossGate(i: number, g: number): void {
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
  private burst(i: number, g: number, added: number): void {
    if (added <= 0) return;
    this.gateAdded[g] += added;
    const free = Math.min(this.unitBudget, this.capacity) - this.n;
    const singles = added <= free ? added : free > 0 ? free : 0;
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

  // Units reaching the far end hit the opposing base. Aggregated to one event per base per step.
  // On boss levels a player unit arriving outside the base span is lost (baseMiss).
  private baseHits(events: SimEvent[]): void {
    const len = this.level.lane.length;
    const baseZ = LAYOUT.playerBaseZ;
    const strafing = this.level.boss !== undefined;
    const halfW = this.level.enemyBase.width / 2;
    const bx = this.baseX;
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
      this.compact();
    }
    return removed;
  }

  damageDefender(index: number, amount: number): void {
    const d = this.defs[index];
    if (d && d.hp > 0 && amount > 0) this.applyDefenderDamage(index, amount);
  }
}

export function createSim(level: LevelDef, rand: () => number, opts?: SimOptions): Sim {
  return new CrowdSim(level, rand, opts);
}
