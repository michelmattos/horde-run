// World 3 lane hazards as flat tables the sim reads every step (concept §9.1, Clockwork
// Workshop): conveyor belts that carry units, turntables that rotate them about a centre,
// and saw blades that bite both teams. Built once per level; lookups never allocate.

import type { LevelDef, SawDef } from '../contracts.ts';
import { conveyorDir, turntableSpin } from '../contracts.ts';

export const MAX_CONVEYORS = 8;
export const MAX_TURNTABLES = 8;
export const MAX_SAWS = 8;

function capped<T>(level: LevelDef, list: T[] | undefined, what: string, max: number): T[] {
  const l = list ?? [];
  if (l.length > max) {
    throw new Error(`Level "${level.id}" has ${l.length} ${what}; the sim supports at most ${max}.`);
  }
  return l;
}

// Axis-aligned belts: x in [x0, x1], z in [z0, z1], each with this step's velocity.
export class Belts {
  readonly count: number;
  readonly box: Float64Array; // x0, x1, z0, z1 per belt
  readonly vx: Float64Array; // this step's velocity (direction applied), set by update()
  readonly vz: Float64Array;
  readonly minZ: number;
  readonly maxZ: number;
  private readonly defs: NonNullable<LevelDef['conveyors']>;

  constructor(level: LevelDef) {
    const defs = capped(level, level.conveyors, 'conveyors', MAX_CONVEYORS);
    this.defs = defs;
    this.count = defs.length;
    this.box = new Float64Array(defs.length * 4);
    this.vx = new Float64Array(defs.length);
    this.vz = new Float64Array(defs.length);
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let k = 0; k < defs.length; k++) {
      const c = defs[k];
      this.box[k * 4] = c.x - c.width / 2;
      this.box[k * 4 + 1] = c.x + c.width / 2;
      this.box[k * 4 + 2] = c.z;
      this.box[k * 4 + 3] = c.z + c.length;
      minZ = Math.min(minZ, c.z);
      maxZ = Math.max(maxZ, c.z + c.length);
    }
    this.minZ = minZ;
    this.maxZ = maxZ;
  }

  update(t: number): void {
    for (let k = 0; k < this.count; k++) {
      const c = this.defs[k];
      const dir = conveyorDir(c, t);
      this.vx[k] = c.vx * dir;
      this.vz[k] = c.vz * dir;
    }
  }

  // Index of the first belt whose rectangle holds (x, z), or -1.
  at(x: number, z: number): number {
    const b = this.box;
    for (let k = 0; k < this.count; k++) {
      const o = k * 4;
      if (x >= b[o] && x <= b[o + 1] && z >= b[o + 2] && z <= b[o + 3]) return k;
    }
    return -1;
  }
}

// Rotating platforms. update() computes, once per platform per step, the cos/sin of the
// step angle for each of the four carry shares (full, heavy, player, player heavy).
export class Turntables {
  readonly count: number;
  readonly cx: Float64Array;
  readonly cz: Float64Array;
  readonly r2: Float64Array; // radius squared
  readonly cs: Float64Array; // cos, sin per share: 8 per platform
  private readonly defs: NonNullable<LevelDef['turntables']>;

  constructor(level: LevelDef) {
    const defs = capped(level, level.turntables, 'turntables', MAX_TURNTABLES);
    this.defs = defs;
    this.count = defs.length;
    this.cx = new Float64Array(defs.length);
    this.cz = new Float64Array(defs.length);
    this.r2 = new Float64Array(defs.length);
    this.cs = new Float64Array(defs.length * 8);
    for (let k = 0; k < defs.length; k++) {
      this.cx[k] = defs[k].x;
      this.cz[k] = defs[k].z;
      this.r2[k] = defs[k].radius * defs[k].radius;
    }
  }

  // shares: carry fractions for [enemy mob, enemy heavy, player mob, player heavy].
  update(t: number, dt: number, full: number, heavy: number, player: number, playerHeavy: number): void {
    for (let k = 0; k < this.count; k++) {
      const a = turntableSpin(this.defs[k], t) * dt;
      const o = k * 8;
      this.cs[o] = Math.cos(a * full);
      this.cs[o + 1] = Math.sin(a * full);
      this.cs[o + 2] = Math.cos(a * heavy);
      this.cs[o + 3] = Math.sin(a * heavy);
      this.cs[o + 4] = Math.cos(a * player);
      this.cs[o + 5] = Math.sin(a * player);
      this.cs[o + 6] = Math.cos(a * playerHeavy);
      this.cs[o + 7] = Math.sin(a * playerHeavy);
    }
  }

  // Index of the first platform whose disc holds (x, z), or -1.
  at(x: number, z: number): number {
    for (let k = 0; k < this.count; k++) {
      const dx = x - this.cx[k];
      const dz = z - this.cz[k];
      if (dx * dx + dz * dz <= this.r2[k]) return k;
    }
    return -1;
  }
}

// Saw list with its bite per second resolved.
export class Saws {
  readonly count: number;
  readonly defs: SawDef[];
  readonly bite: Float64Array;

  constructor(level: LevelDef, defaultBite: number) {
    const defs = capped(level, level.saws, 'saws', MAX_SAWS);
    this.defs = defs;
    this.count = defs.length;
    this.bite = new Float64Array(defs.length);
    for (let k = 0; k < defs.length; k++) this.bite[k] = defs[k].bite ?? defaultBite;
  }
}
