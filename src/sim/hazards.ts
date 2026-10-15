// World 2 lane hazards as flat tables the sim reads every step (concept §9.1): ice patches
// where units slide, and ice walls, static blocks that narrow the lane into chokepoints.
// Both are built once per level from the LevelDef; lookups never allocate.

import type { LevelDef } from '../contracts.ts';
import { LAYOUT } from '../contracts.ts';

export const MAX_ICE_PATCHES = 8;
export const MAX_ICE_WALLS = 8;

// Axis-aligned slide zones: x in [x0, x1], z in [z0, z1].
export class IcePatches {
  readonly count: number;
  private readonly box: Float64Array; // x0, x1, z0, z1 per patch

  constructor(level: LevelDef) {
    const ice = level.ice ?? [];
    if (ice.length > MAX_ICE_PATCHES) {
      throw new Error(
        `Level "${level.id}" has ${ice.length} ice patches; the sim supports at most ${MAX_ICE_PATCHES}.`,
      );
    }
    this.count = ice.length;
    this.box = new Float64Array(ice.length * 4);
    for (let k = 0; k < ice.length; k++) {
      const p = ice[k];
      this.box[k * 4] = p.x - p.width / 2;
      this.box[k * 4 + 1] = p.x + p.width / 2;
      this.box[k * 4 + 2] = p.z;
      this.box[k * 4 + 3] = p.z + p.length;
    }
  }

  contains(x: number, z: number): boolean {
    const b = this.box;
    for (let o = 0; o < b.length; o += 4) {
      if (x >= b[o] && x <= b[o + 1] && z >= b[o + 2] && z <= b[o + 3]) return true;
    }
    return false;
  }
}

// Unbreakable rectangles. A side counts as open when a mob fits between it and the lane
// edge, so units are only ever pushed toward a real way round.
export class IceWalls {
  readonly count: number;
  readonly ids: string[];
  readonly cx: Float64Array;
  readonly cz: Float64Array;
  readonly hw: Float64Array; // half width (x)
  readonly hd: Float64Array; // half depth (z)
  readonly leftOpen: Uint8Array;
  readonly rightOpen: Uint8Array;
  readonly minZ: number; // z extent of all walls, a cheap prefilter
  readonly maxZ: number;

  constructor(level: LevelDef) {
    const walls = level.iceWalls ?? [];
    if (walls.length > MAX_ICE_WALLS) {
      throw new Error(`Level "${level.id}" has ${walls.length} ice walls; the sim supports at most ${MAX_ICE_WALLS}.`);
    }
    const n = walls.length;
    this.count = n;
    this.ids = walls.map((w) => w.id);
    this.cx = new Float64Array(n);
    this.cz = new Float64Array(n);
    this.hw = new Float64Array(n);
    this.hd = new Float64Array(n);
    this.leftOpen = new Uint8Array(n);
    this.rightOpen = new Uint8Array(n);
    const edge = level.lane.width / 2;
    const gap = 2 * LAYOUT.mobRadius;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let k = 0; k < n; k++) {
      const w = walls[k];
      this.cx[k] = w.x;
      this.cz[k] = w.z;
      this.hw[k] = w.width / 2;
      this.hd[k] = w.depth / 2;
      this.leftOpen[k] = w.x - w.width / 2 + edge > gap ? 1 : 0;
      this.rightOpen[k] = edge - (w.x + w.width / 2) > gap ? 1 : 0;
      minZ = Math.min(minZ, w.z - w.depth / 2);
      maxZ = Math.max(maxZ, w.z + w.depth / 2);
    }
    this.minZ = minZ;
    this.maxZ = maxZ;
  }
}

// Result of pushOutOfBox: where the disc ends up (x unclamped) and how it got there.
export interface BoxPush {
  x: number;
  z: number;
}
export const BOX_CLEAR = 0; // no contact
export const BOX_SIDE = 1; // pushed out sideways past the nearer open side
export const BOX_FACE = 2; // backed off the face it hit (x unchanged: no open side)
export const BOX_FACE_SLIDE = 3; // backed off the face and slid `slide` toward the open side

// Pushes a disc (x, z, r) out of an axis-aligned box (centre cx, cz; half sizes hw, hd):
// sideways to the nearer open side when that is the shorter way out, otherwise back off
// the face it hit while sliding toward the gap. Shared by ice walls and shield walls.
export function pushOutOfBox(
  x: number,
  z: number,
  r: number,
  cx: number,
  cz: number,
  hw: number,
  hd: number,
  leftOpen: boolean,
  rightOpen: boolean,
  slide: number,
  out: BoxPush,
): number {
  const dx = x - cx;
  const dz = z - cz;
  const ex = hw + r;
  const ez = hd + r;
  const adx = dx < 0 ? -dx : dx;
  const adz = dz < 0 ? -dz : dz;
  if (adx >= ex || adz >= ez) return BOX_CLEAR;
  if (adx > hw && adz > hd) {
    const ox = adx - hw;
    const oz = adz - hd;
    if (ox * ox + oz * oz >= r * r) return BOX_CLEAR; // clear of the rounded corner
  }
  const near = dx < 0 ? -1 : 1;
  let side = near;
  if (!(side < 0 ? leftOpen : rightOpen)) side = -side;
  const open = side < 0 ? leftOpen : rightOpen;
  const outX = side === near ? ex - adx : ex + adx;
  if (open && outX <= ez - adz) {
    out.x = cx + side * ex;
    out.z = z;
    return BOX_SIDE;
  }
  out.z = cz + (dz < 0 ? -ez : ez);
  if (!open) {
    out.x = x;
    return BOX_FACE;
  }
  out.x = x + side * slide;
  return BOX_FACE_SLIDE;
}

// A side of a box counts as open when a mob fits between it and the lane edge.
export function sideOpen(laneWidth: number, x: number, width: number, side: -1 | 1): boolean {
  const edge = laneWidth / 2;
  const gap = 2 * LAYOUT.mobRadius;
  return side < 0 ? x - width / 2 + edge > gap : edge - (x + width / 2) > gap;
}
