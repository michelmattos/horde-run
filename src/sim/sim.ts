// Data-oriented crowd simulation (concept §8 "Crowd simulation").
// Every unit lives in flat typed arrays (structure of arrays) preallocated in the
// constructor; step() runs a handful of linear passes and never allocates per unit.
//
// Units are discs on the XZ plane. A mob's health IS its weight (weight = ceil(hp)),
// so cancellation by min(hpA, hpB) is 1:1 by weight and a stacked mob simply has more hp.

import type { LevelDef, SimEvent, SimView } from '../contracts.ts';
import { LAYOUT, Team, UnitKind, gateX } from '../contracts.ts';
import { SpatialGrid } from './grid.ts';

export interface SpawnOpts {
  hp?: number; // per weight for mobs (default 1, so hp == weight); absolute for champions
  damage?: number; // per weight for mobs (default 1, so damage == weight); absolute for champions
  radius?: number; // base radius; default LAYOUT.mobRadius / LAYOUT.championRadius by kind
  spread?: number; // half-width of random x jitter for count > 1 (default 0.35)
}

export interface SimOptions {
  unitBudget?: number; // live units across both teams before new weight is stacked (default 1500)
  capacity?: number; // hard array size (default unitBudget + 512)
}

export interface Sim {
  readonly view: SimView;
  readonly time: number;
  readonly unitBudget: number;
  spawn(team: Team, kind: UnitKind, x: number, z: number, count: number, opts?: SpawnOpts): void;
  step(dt: number, events: SimEvent[]): void;
  totals(): { player: number; enemy: number };
}

// Mutable so tuning code can tweak it live; tests read it.
export const SIM_TUNING = {
  mobSpeed: 7,
  championSpeed: 4.5,
  enemySpeed: 5,
  separation: 0.5, // fraction of an overlap resolved per step
};

const MAX_GATES = 32;
const DEAD_EPS = 1e-4; // hp at or below this counts as dead (absorbs float dust)
const MAX_PUSH = 0.08; // per-step cap on separation correction (world units)
const STEER_ZONE = 6; // player units steer toward the enemy base span in the last N units
const STEER_FACTOR = 0.8; // lateral steering speed as a fraction of forward speed
const MERGE_RADIUS = 1.5; // over budget, spawned weight joins a same-team mob within this range
const MAX_CLASH_EVENTS = 6;
const BURST_MAX_HALF = 1.2;
const BURST_DEPTH = 0.8;

// Heavier stacked units are drawn (and collide) bigger, capped at 2.2x.
function stackedRadius(base: number, w: number): number {
  return w <= 1 ? base : base * Math.min(2.2, 1 + 0.22 * Math.log2(w));
}

class CrowdSim implements Sim {
  readonly view: SimView;
  readonly unitBudget: number;

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

  private readonly grid: SpatialGrid;
  private readonly gateXs: Float64Array;
  private readonly gateAdded: Float64Array;
  private readonly gateHits: Int32Array;
  private readonly gateSumX: Float64Array;
  private clashes = 0;

  constructor(level: LevelDef, rand: () => number, opts?: SimOptions) {
    if (level.gates.length > MAX_GATES) {
      throw new Error(`Level "${level.id}" has ${level.gates.length} gates; the sim supports at most ${MAX_GATES}.`);
    }
    this.level = level;
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

    const hw = level.lane.width / 2;
    this.grid = new SpatialGrid(-hw, hw, LAYOUT.playerBaseZ - 2, level.lane.length + 2, 2 * LAYOUT.mobRadius, cap);

    const g = level.gates.length;
    this.gateXs = new Float64Array(g);
    this.gateAdded = new Float64Array(g);
    this.gateHits = new Int32Array(g);
    this.gateSumX = new Float64Array(g);

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
    };
  }

  get time(): number {
    return this._time;
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

    if (isChamp) {
      // Champions are rare and never stacked; they only need array space.
      for (let k = 0; k < count; k++) {
        const jx = spread > 0 ? x + (this.rand() * 2 - 1) * spread : x;
        if (this.n < this.capacity) this.addUnit(team, kind, jx, z, 1, hpPer, dmgPer, rad, 0);
        else this.mergeIntoNearest(team, jx, z, Infinity, 1);
      }
      return;
    }

    const free = Math.min(this.unitBudget, this.capacity) - this.n;
    if (count <= free) {
      for (let k = 0; k < count; k++) {
        const jx = spread > 0 ? x + (this.rand() * 2 - 1) * spread : x;
        this.addUnit(team, kind, jx, z, 1, hpPer, dmgPer, rad, 0);
      }
    } else if (free >= 1) {
      // Fill the budget with singles, the rest rides on one stacked unit.
      for (let k = 0; k < free - 1; k++) {
        const jx = x + (this.rand() * 2 - 1) * spread;
        this.addUnit(team, kind, jx, z, 1, hpPer, dmgPer, rad, 0);
      }
      this.addUnit(team, kind, x, z, count - (free - 1), hpPer, dmgPer, rad, 0);
    } else if (!this.mergeIntoNearest(team, x, z, MERGE_RADIUS, count)) {
      if (this.n < this.capacity) this.addUnit(team, kind, x, z, count, hpPer, dmgPer, rad, 0);
      else this.mergeIntoNearest(team, x, z, Infinity, count);
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

  // Adds weight to the nearest same-team mob within maxDist. Returns false if none found.
  private mergeIntoNearest(team: Team, x: number, z: number, maxDist: number, w: number): boolean {
    let best = -1;
    let bestD2 = maxDist * maxDist;
    for (let i = 0; i < this.n; i++) {
      if (this.team[i] !== team || this.kind[i] !== UnitKind.Mob || this.hp[i] <= DEAD_EPS) continue;
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
    this.interact(events);
    this.applyPushes();
    this.applyGates(events);
    this.baseHits(events);
    this.compact();
  }

  private move(dt: number): void {
    const { posX, posZ, prevZ, team, kind, radius } = this;
    const len = this.level.lane.length;
    const eb = this.level.enemyBase;
    const steerFrom = len - STEER_ZONE;
    for (let i = 0; i < this.n; i++) {
      const z = posZ[i];
      prevZ[i] = z;
      if (team[i] === Team.Player) {
        const speed = kind[i] === UnitKind.Champion ? SIM_TUNING.championSpeed : SIM_TUNING.mobSpeed;
        posZ[i] = z + speed * dt;
        if (z > steerFrom) {
          // Funnel toward the enemy base so units near the end don't miss it.
          const r = radius[i];
          let lo = eb.x - eb.width / 2 + r;
          let hi = eb.x + eb.width / 2 - r;
          if (lo > hi) lo = hi = eb.x;
          const x = posX[i];
          const maxStep = speed * STEER_FACTOR * dt;
          if (x < lo) posX[i] = Math.min(lo, x + maxStep);
          else if (x > hi) posX[i] = Math.max(hi, x - maxStep);
        }
      } else {
        const speed = kind[i] === UnitKind.Champion ? SIM_TUNING.championSpeed : SIM_TUNING.enemySpeed;
        posZ[i] = z - speed * dt;
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
    const { posX, posZ, pushX, pushZ, radius } = this;
    const cap2 = MAX_PUSH * MAX_PUSH;
    for (let i = 0; i < this.n; i++) {
      let px = pushX[i];
      let pz = pushZ[i];
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
        if ((passed[i] >>> g) & 1) continue;
        const gate = gates[g];
        if (!(pz < gate.z && gate.z <= z)) continue;
        if (Math.abs(posX[i] - this.gateXs[g]) > gate.width / 2) continue;
        this.crossGate(i, g);
      }
    }
    for (let g = 0; g < gc; g++) {
      const hits = this.gateHits[g];
      if (hits > 0) {
        events.push({ type: 'gate', gateId: gates[g].id, x: this.gateSumX[g] / hits, z: gates[g].z, added: this.gateAdded[g] });
      }
    }
  }

  private crossGate(i: number, g: number): void {
    const gate = this.level.gates[g];
    this.passed[i] = (this.passed[i] | (1 << g)) >>> 0;
    this.gateHits[g]++;
    this.gateSumX[g] += this.posX[i];
    const w = this.w[i];
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
      this.addUnit(Team.Player, UnitKind.Mob, x, z, 1, this.hpPer[i], this.dmgPer[i], this.baseRad[i], mask);
    }
    const rest = added - singles;
    if (rest > 0) {
      this.hp[i] += rest * this.hpPer[i];
      this.setWeight(i, this.w[i] + rest);
    }
  }

  // Units reaching the far end hit the opposing base. Aggregated to one event per base per step.
  private baseHits(events: SimEvent[]): void {
    const len = this.level.lane.length;
    const baseZ = LAYOUT.playerBaseZ;
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
  }
}

export function createSim(level: LevelDef, rand: () => number, opts?: SimOptions): Sim {
  return new CrowdSim(level, rand, opts);
}
