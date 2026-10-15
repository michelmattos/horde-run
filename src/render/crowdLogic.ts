// Pure crowd bookkeeping (no Babylon, unit-tested under Node): which thin-instance batch a
// unit is drawn with, how big, how it hops, how a snowball rolls and how a Blizzard frosts
// the enemy crowd. The sim's render variant byte (Milestone 4) picks the model; a view
// without it draws today's look (riflemen and the champion).
import { LAYOUT, UNIT_VARIANT, UnitKind } from '../contracts.ts';
import type { SimView, Team } from '../contracts.ts';

// Unit variant bytes on the sim view (shared with the battle and progression tasks).
export const VARIANT = UNIT_VARIANT;

// Crowd batches, one thin-instanced mesh each (both armies share it: team is a colour).
// Milestone 5: the Giant and the rolling snowball (player), the snowman and the wind-up
// penguin (enemy). A batch with no units this frame is hidden and costs no draw call.
export const SLOT = {
  rifleman: 0,
  knight: 1,
  sprinter: 2,
  bomber: 3,
  champion: 4,
  giant: 5,
  snowball: 6,
  snowman: 7,
  penguin: 8,
} as const;
export type CrowdSlot = (typeof SLOT)[keyof typeof SLOT];
export const SLOT_COUNT = 9;

// The figures of the enemy-only units (never used for a player army slot).
export const ENEMY_SLOTS: readonly CrowdSlot[] = [SLOT.snowman, SLOT.penguin];

export type ChampionId = 'sarge' | 'tank' | 'drummer';
export type CannonId = 'popgun' | 'repeater' | 'blunderbuss' | 'snowball-launcher';

// Knights are 'heavy' units (UnitKind.Champion with a ~0.55 radius) drawn as a figure on
// the mob scale, a little under their collision size so packed knights do not overlap.
export const KNIGHT_SCALE = 0.85;

// Collision radius each Milestone 5 figure is authored for (its models/ module builds it
// at this size, so the instance scale is r / this). The snowball is a unit sphere.
export const GIANT_RADIUS = 0.8; // models/giant.ts
export const SNOWMAN_RADIUS = 0.42; // models/snowman.ts
export const PENGUIN_RADIUS = 0.24; // models/penguin.ts

// The variant byte picks the figure first for the enemy-only types (whatever the kind,
// a snowman is drawn as a snowman), then mobs and champions as in Milestone 4: variant 1
// on a champion is a knight, 4 is the Giant, anything else the loadout's champion (sarge,
// tank or drummer: setChampion decides which meshes it uses).
export function crowdSlot(kind: number, variant: number): CrowdSlot {
  if (variant === VARIANT.snowman) return SLOT.snowman;
  if (variant === VARIANT.penguin) return SLOT.penguin;
  if (variant === VARIANT.giant) return SLOT.giant;
  if (kind === UnitKind.Champion) return variant === VARIANT.knight ? SLOT.knight : SLOT.champion;
  if (variant === VARIANT.snowball) return SLOT.snowball;
  if (variant === VARIANT.sprinter) return SLOT.sprinter;
  if (variant === VARIANT.bomber) return SLOT.bomber;
  if (variant === VARIANT.knight) return SLOT.knight;
  return SLOT.rifleman;
}

// Instance scale for a unit of collision radius r drawn in `slot` (the meshes are authored
// at mob size, 1.3 tall, at champion size, radius ~1, and at the radii above).
export function crowdScale(slot: CrowdSlot, r: number): number {
  switch (slot) {
    case SLOT.champion:
      return r > 0 ? r / LAYOUT.championRadius : 1;
    case SLOT.knight:
      return r > 0 ? (r / LAYOUT.mobRadius) * KNIGHT_SCALE : 2 * KNIGHT_SCALE;
    case SLOT.giant:
      return r > 0 ? r / GIANT_RADIUS : 1;
    case SLOT.snowball:
      return snowballScale(r);
    case SLOT.snowman:
      return r > 0 ? r / SNOWMAN_RADIUS : 1;
    case SLOT.penguin:
      return r > 0 ? r / PENGUIN_RADIUS : 1;
    default:
      return r > 0 ? r / LAYOUT.mobRadius : 1;
  }
}

// How a figure hops along (multipliers on crowd.ts's base hop): sprinters bound quicker
// and lower, bombers plod under their pack, knights stomp, the tank only rumbles. The
// Giant takes slow, heavy hops; the snowman slides along with a wide sway; the wind-up
// penguin waddles in quick little hops; the snowball does not hop at all (it rolls).
export interface HopStyle {
  speed: number;
  height: number;
  lean: number;
  waddle: number;
}

export type HopKey =
  | 'rifleman'
  | 'knight'
  | 'sprinter'
  | 'bomber'
  | 'giant'
  | 'snowball'
  | 'snowman'
  | 'penguin'
  | ChampionId;

export const HOP_STYLE: Record<HopKey, HopStyle> = {
  rifleman: { speed: 1, height: 1, lean: 1, waddle: 1 },
  knight: { speed: 0.8, height: 0.7, lean: 0.5, waddle: 0.8 },
  sprinter: { speed: 1.35, height: 0.8, lean: 1.2, waddle: 0.6 },
  bomber: { speed: 0.8, height: 0.75, lean: 0.6, waddle: 1.2 },
  giant: { speed: 0.45, height: 1.1, lean: 0.4, waddle: 0.7 },
  snowball: { speed: 0, height: 0, lean: 0, waddle: 0 },
  snowman: { speed: 0.6, height: 0.45, lean: 0.25, waddle: 1.5 },
  penguin: { speed: 1.7, height: 0.85, lean: 0.35, waddle: 2.2 },
  sarge: { speed: 1, height: 0.6, lean: 0.4, waddle: 0.5 },
  tank: { speed: 2.2, height: 0.08, lean: 0.12, waddle: 0.12 },
  drummer: { speed: 1, height: 0.5, lean: 0.25, waddle: 0.7 },
};

export function slotStyle(slot: CrowdSlot, champion: ChampionId): HopStyle {
  switch (slot) {
    case SLOT.knight:
      return HOP_STYLE.knight;
    case SLOT.sprinter:
      return HOP_STYLE.sprinter;
    case SLOT.bomber:
      return HOP_STYLE.bomber;
    case SLOT.champion:
      return HOP_STYLE[champion];
    case SLOT.giant:
      return HOP_STYLE.giant;
    case SLOT.snowball:
      return HOP_STYLE.snowball;
    case SLOT.snowman:
      return HOP_STYLE.snowman;
    case SLOT.penguin:
      return HOP_STYLE.penguin;
    default:
      return HOP_STYLE.rifleman;
  }
}

export function parseChampion(id: string | undefined): ChampionId {
  return id === 'tank' || id === 'drummer' ? id : 'sarge';
}

export function parseCannon(id: string | undefined): CannonId {
  return id === 'repeater' || id === 'blunderbuss' || id === 'snowball-launcher' ? id : 'popgun';
}

// ---------- Rolling snowballs ----------
// models/snowball.ts is a unit sphere, so the instance scale is the collision radius and
// the ball's centre sits one radius above the floor.
export function snowballScale(r: number): number {
  return r > 0 ? r : LAYOUT.mobRadius;
}

// Rolling without slipping: a ball of radius r turns distance / r radians.
export function snowballRoll(distance: number, r: number): number {
  return distance / (r > 0 ? r : LAYOUT.mobRadius);
}

// Further than this between frames and the sim slot holds another unit (the sim swaps
// the last unit into a removed one's slot), so the roll starts afresh.
export const ROLL_JUMP = 1.5;

// Roll angles of the snowballs, keyed by sim index and integrated from the distance each
// ball travels between frames (so a ball that grows keeps turning smoothly instead of
// jumping, as an angle computed from its absolute z would). pitch turns it about x (up
// the lane), roll about z (sideways drift). step() never allocates.
export class RollTracker {
  private lastX = new Float32Array(0);
  private lastZ = new Float32Array(0);
  private pitchA = new Float32Array(0);
  private rollA = new Float32Array(0);
  private seen = new Uint8Array(0);
  pitch = 0;
  roll = 0;

  ensureCapacity(n: number): void {
    if (n <= this.seen.length) return;
    let cap = Math.max(64, this.seen.length);
    while (cap < n) cap *= 2;
    const grow = <T extends Float32Array | Uint8Array>(a: T, make: (n: number) => T): T => {
      const b = make(cap);
      b.set(a);
      return b;
    };
    this.lastX = grow(this.lastX, (k) => new Float32Array(k));
    this.lastZ = grow(this.lastZ, (k) => new Float32Array(k));
    this.pitchA = grow(this.pitchA, (k) => new Float32Array(k));
    this.rollA = grow(this.rollA, (k) => new Float32Array(k));
    this.seen = grow(this.seen, (k) => new Uint8Array(k));
  }

  // Slot i is a snowball at (x, z) with radius r this frame: updates and returns this.pitch
  // / this.roll. A first sighting starts from an angle derived from its position, so
  // neighbouring balls do not all show the same face.
  step(i: number, x: number, z: number, r: number): void {
    this.ensureCapacity(i + 1);
    const dx = x - this.lastX[i];
    const dz = z - this.lastZ[i];
    if (!this.seen[i] || Math.abs(dx) > ROLL_JUMP || Math.abs(dz) > ROLL_JUMP) {
      this.pitchA[i] = (x * 7.3 + z * 0.37) % (Math.PI * 2);
      this.rollA[i] = 0;
      this.seen[i] = 1;
    } else {
      this.pitchA[i] = (this.pitchA[i] + snowballRoll(dz, r)) % (Math.PI * 2);
      this.rollA[i] = (this.rollA[i] - snowballRoll(dx, r)) % (Math.PI * 2);
    }
    this.lastX[i] = x;
    this.lastZ[i] = z;
    this.pitch = this.pitchA[i];
    this.roll = this.rollA[i];
  }

  // Slot i holds no snowball this frame.
  clear(i: number): void {
    if (i < this.seen.length) this.seen[i] = 0;
  }
}

// ---------- Blizzard frost on the enemy crowd ----------
// While BattleState.enemyFrozen > 0 the enemy figures stand still and take an ice-blue
// tint; in the last FROST_FADE seconds the tint eases off, ending exactly on the team
// colour at 0.
export const FROST_FADE = 0.5;
export const FROST_TINT = 0.6; // share of ice blue at full frost
export const FROST_ICE = { r: 0.5, g: 0.78, b: 0.95 }; // linear ice blue (~#bce5f9)

// 0 (thawed) .. 1 (fully frozen) from the seconds of freeze left.
export function frostAmount(enemyFrozen: number | undefined): number {
  const s = enemyFrozen ?? 0;
  if (!(s > 0)) return 0;
  return s >= FROST_FADE ? 1 : s / FROST_FADE;
}

// Linear colour (r, g, b) tinted by frost amount k into out[0..2].
export function frostColor(r: number, g: number, b: number, k: number, out: Float32Array | number[]): void {
  const t = k * FROST_TINT;
  out[0] = r + (FROST_ICE.r - r) * t;
  out[1] = g + (FROST_ICE.g - g) * t;
  out[2] = b + (FROST_ICE.b - b) * t;
}

// ---------- Enemy crowd footprint ----------
export interface CrowdBounds {
  count: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

// Footprint (unit centres, padded by each unit's radius) of one team in the view, e.g. for
// the Blizzard's frost sheet. count 0 leaves the bounds at zero.
export function teamBounds(view: SimView, team: Team, out: CrowdBounds): CrowdBounds {
  let n = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < view.count; i++) {
    if (view.team[i] !== team) continue;
    const r = view.radius[i];
    const x = view.posX[i];
    const z = view.posZ[i];
    if (x - r < minX) minX = x - r;
    if (x + r > maxX) maxX = x + r;
    if (z - r < minZ) minZ = z - r;
    if (z + r > maxZ) maxZ = z + r;
    n++;
  }
  out.count = n;
  out.minX = n ? minX : 0;
  out.maxX = n ? maxX : 0;
  out.minZ = n ? minZ : 0;
  out.maxZ = n ? maxZ : 0;
  return out;
}
