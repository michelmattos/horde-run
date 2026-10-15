// Pure crowd bookkeeping (no Babylon, unit-tested under Node): which thin-instance batch a
// unit is drawn with, how big, how it hops, how a snowball rolls and how a Blizzard frosts
// the enemy crowd. The sim's render variant byte (Milestone 4) picks the model; a view
// without it draws today's look (riflemen and the champion). Milestone 6 adds the World 3
// figures (archer, Wind-up Robot champion, enemy wind-up robot), the robots' stop-and-go
// gait and turning keys, and the flight of an archer's arrow (unitFx.ts).
import { LAYOUT, UNIT_VARIANT, UnitKind } from '../contracts.ts';
import type { SimView, Team } from '../contracts.ts';

// Unit variant bytes on the sim view (shared with the battle and progression tasks).
export const VARIANT = UNIT_VARIANT;

// Crowd batches, one thin-instanced mesh each (both armies share it: team is a colour).
// Milestone 5: the Giant and the rolling snowball (player), the snowman and the wind-up
// penguin (enemy). Milestone 6: the archer and the Wind-up Robot champion (player), the
// wind-up tin robot (enemy). A batch with no units this frame is hidden and costs no draw
// call.
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
  archer: 9,
  windup: 10,
  robot: 11,
} as const;
export type CrowdSlot = (typeof SLOT)[keyof typeof SLOT];
export const SLOT_COUNT = 12;

// The figures of the enemy-only units (never used for a player army slot).
export const ENEMY_SLOTS: readonly CrowdSlot[] = [SLOT.snowman, SLOT.penguin, SLOT.robot];

export type ChampionId = 'sarge' | 'tank' | 'drummer' | 'windup';
export type CannonId = 'popgun' | 'repeater' | 'blunderbuss' | 'snowball-launcher' | 'gear-gun';

// Knights are 'heavy' units (UnitKind.Champion with a ~0.55 radius) drawn as a figure on
// the mob scale, a little under their collision size so packed knights do not overlap.
export const KNIGHT_SCALE = 0.85;

// Collision radius each Milestone 5 figure is authored for (its models/ module builds it
// at this size, so the instance scale is r / this). The snowball is a unit sphere.
export const GIANT_RADIUS = 0.8; // models/giant.ts
export const SNOWMAN_RADIUS = 0.42; // models/snowman.ts
export const PENGUIN_RADIUS = 0.24; // models/penguin.ts
export const ROBOT_RADIUS = 0.36; // models/windupRobot.ts (Milestone 6)

// The variant byte picks the figure first for the enemy-only types (whatever the kind,
// a snowman is drawn as a snowman), then mobs and champions as in Milestone 4: variant 1
// on a champion is a knight, 4 is the Giant, 11 the Wind-up Robot (its own batch, so it
// shows whatever the loadout says), anything else the loadout's champion (sarge, tank,
// drummer or windup: setChampion decides which meshes it uses).
export function crowdSlot(kind: number, variant: number): CrowdSlot {
  if (variant === VARIANT.snowman) return SLOT.snowman;
  if (variant === VARIANT.penguin) return SLOT.penguin;
  if (variant === VARIANT.robot) return SLOT.robot;
  if (variant === VARIANT.giant) return SLOT.giant;
  if (variant === VARIANT.windup) return SLOT.windup;
  if (kind === UnitKind.Champion) return variant === VARIANT.knight ? SLOT.knight : SLOT.champion;
  if (variant === VARIANT.snowball) return SLOT.snowball;
  if (variant === VARIANT.archer) return SLOT.archer;
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
    case SLOT.windup:
      return r > 0 ? r / LAYOUT.championRadius : 1;
    case SLOT.robot:
      return r > 0 ? r / ROBOT_RADIUS : 1;
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
// World 3: the archer hops like a rifleman; the tin robot barely lifts its feet and rocks
// stiffly side to side (and stands still in its pauses, see GaitTracker); the Wind-up
// Robot champion clanks along in heavy, rocking strides.
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
  | 'archer'
  | 'robot'
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
  archer: { speed: 1, height: 0.9, lean: 0.8, waddle: 0.9 },
  robot: { speed: 1.45, height: 0.22, lean: 0.08, waddle: 1.9 },
  sarge: { speed: 1, height: 0.6, lean: 0.4, waddle: 0.5 },
  tank: { speed: 2.2, height: 0.08, lean: 0.12, waddle: 0.12 },
  drummer: { speed: 1, height: 0.5, lean: 0.25, waddle: 0.7 },
  windup: { speed: 0.75, height: 0.28, lean: 0.12, waddle: 1.1 },
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
    case SLOT.archer:
      return HOP_STYLE.archer;
    case SLOT.robot:
      return HOP_STYLE.robot;
    case SLOT.windup:
      return HOP_STYLE.windup;
    default:
      return HOP_STYLE.rifleman;
  }
}

export function parseChampion(id: string | undefined): ChampionId {
  return id === 'tank' || id === 'drummer' || id === 'windup' ? id : 'sarge';
}

export function parseCannon(id: string | undefined): CannonId {
  return id === 'repeater' || id === 'blunderbuss' || id === 'snowball-launcher' || id === 'gear-gun' ? id : 'popgun';
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

// ---------- World 3: wind-up gaits and keys ----------
// The sim walks wind-up robots in stop-and-go bursts with a hashed phase it does not
// export, so the renderer reads the gait off the motion: a unit that covers less than
// GAIT_STILL u/s between frames is standing. `move` eases toward 1 (walking) or 0
// (standing) so a stop settles instead of snapping, and the brass key on the robot's
// back unwinds fast while it walks and creeps while it stands (frozen: stops).
export const GAIT_STILL = 0.8; // u/s
export const GAIT_EASE = 12; // per second
export const KEY_RUN = 9; // rad/s of the key while walking
export const KEY_IDLE = 1.2; // rad/s while standing

// Per-unit gait state keyed by sim index (like RollTracker: a jump of more than
// ROLL_JUMP between frames means the slot holds another unit, so it starts afresh).
// step() never allocates.
export class GaitTracker {
  private lastX: Float32Array = new Float32Array(0);
  private lastZ: Float32Array = new Float32Array(0);
  private moveA: Float32Array = new Float32Array(0);
  private keyA: Float32Array = new Float32Array(0);
  private seen = new Uint8Array(0);
  move = 1; // 0 standing .. 1 walking, of the last step()
  key = 0; // key angle (rad) of the last step()

  ensureCapacity(n: number): void {
    if (n <= this.seen.length) return;
    let cap = Math.max(64, this.seen.length);
    while (cap < n) cap *= 2;
    const f = (a: Float32Array): Float32Array => {
      const b = new Float32Array(cap);
      b.set(a);
      return b;
    };
    this.lastX = f(this.lastX);
    this.lastZ = f(this.lastZ);
    this.moveA = f(this.moveA);
    this.keyA = f(this.keyA);
    const s = new Uint8Array(cap);
    s.set(this.seen);
    this.seen = s;
  }

  // Slot i is a wind-up unit at (x, z) this frame, dt seconds after the last one; `live`
  // scales the key (0 while a Blizzard holds the enemy). Sets this.move and this.key.
  step(i: number, x: number, z: number, dt: number, live = 1): void {
    this.ensureCapacity(i + 1);
    const dx = x - this.lastX[i];
    const dz = z - this.lastZ[i];
    if (!this.seen[i] || Math.abs(dx) > ROLL_JUMP || Math.abs(dz) > ROLL_JUMP) {
      this.seen[i] = 1;
      this.moveA[i] = 1;
      this.keyA[i] = (x * 5.1 + z * 2.3) % (Math.PI * 2);
    } else if (dt > 0) {
      const target = Math.hypot(dx, dz) > GAIT_STILL * dt ? 1 : 0;
      const m = this.moveA[i];
      this.moveA[i] = m + (target - m) * Math.min(1, dt * GAIT_EASE);
      const rate = KEY_IDLE + (KEY_RUN - KEY_IDLE) * this.moveA[i];
      this.keyA[i] = (this.keyA[i] + rate * live * dt) % (Math.PI * 2);
    }
    this.lastX[i] = x;
    this.lastZ[i] = z;
    this.move = this.moveA[i];
    this.key = this.keyA[i];
  }

  // Slot i holds no wind-up unit this frame.
  clear(i: number): void {
    if (i < this.seen.length) this.seen[i] = 0;
  }
}

// The stiff tin waddle: a clipped sine, so the robot rocks onto one foot, holds, and rocks
// over (a toy's cam-driven gait) instead of swaying smoothly. Returns -1..1.
export function tinRock(phase: number): number {
  const s = Math.sin(phase) * 1.8;
  return s > 1 ? 1 : s < -1 ? -1 : s;
}

// Rotates the local point (x, y, z) of an instance turned by (yaw, pitch, roll) exactly
// as fxLogic.writeTRS does (roll about Z, then pitch about X, then yaw about Y), into
// out. Used to hang a separately spinning part (a wind-up key) on a hopping figure.
export function rotateLocal(
  x: number,
  y: number,
  z: number,
  yaw: number,
  pitch: number,
  roll: number,
  out: { x: number; y: number; z: number },
): void {
  const cy = Math.cos(yaw),
    sy = Math.sin(yaw);
  const cx = Math.cos(pitch),
    sx = Math.sin(pitch);
  const cz = Math.cos(roll),
    sz = Math.sin(roll);
  // Rows of Rz * Rx (row-vector convention), then each row times Ry.
  const r0x = cz,
    r0y = sz * cx,
    r0z = sz * sx;
  const r1x = -sz,
    r1y = cz * cx,
    r1z = cz * sx;
  const r2y = -sx,
    r2z = cx;
  const ax = x * r0x + y * r1x;
  const ay = x * r0y + y * r1y + z * r2y;
  const az = x * r0z + y * r1z + z * r2z;
  out.x = ax * cy + az * sy;
  out.y = ay;
  out.z = -ax * sy + az * cy;
}

// ---------- World 3: archer arrows (unitFx.ts) ----------
// A short arcing flight from the archer's bow to the target's chest: ARROW_TIME seconds
// at most, quicker for close shots, with a lift that grows with the distance.
export const ARROW_TIME = 0.25;
export const ARROW_FROM_Y = 0.85; // bow height on a 1.3 figure
export const ARROW_TO_Y = 0.45;

export function arrowDuration(dist: number): number {
  const d = dist > 0 ? dist : 0;
  return Math.min(ARROW_TIME, 0.1 + d * 0.025);
}

export interface ArrowPose {
  x: number;
  y: number;
  z: number;
  yaw: number; // heading (rad) of the flight on the floor, 0 = +Z
  pitch: number; // nose-down pitch (rad) along the arc
}

// Position and orientation k (0..1) through the flight from (x0, z0) to (x1, z1).
export function arrowAt(k: number, x0: number, z0: number, x1: number, z1: number, out: ArrowPose): ArrowPose {
  const t = k <= 0 ? 0 : k >= 1 ? 1 : k;
  const dx = x1 - x0;
  const dz = z1 - z0;
  const dist = Math.hypot(dx, dz);
  const lift = 0.12 + dist * 0.035;
  out.x = x0 + dx * t;
  out.z = z0 + dz * t;
  out.y = ARROW_FROM_Y + (ARROW_TO_Y - ARROW_FROM_Y) * t + 4 * lift * t * (1 - t);
  out.yaw = dist > 1e-6 ? Math.atan2(dx, dz) : 0;
  const dy = ARROW_TO_Y - ARROW_FROM_Y + 4 * lift * (1 - 2 * t);
  out.pitch = Math.atan2(-dy, Math.max(1e-3, dist));
  return out;
}

// ---------- World 3: the Wind-up Robot's gate walk (unitFx.ts) ----------
// The event says where the walk starts and how long it lasts, not which way it goes, so
// the effect works the whole gate line: GLINTS brass gear glints spread over
// ±WALK_SPAN around the start pop up one after another from the middle out, tick round
// a tooth at a time while the walk lasts and drop away at the end.
export const WALK_GLINTS = 7;
export const WALK_SPAN = 2.2;
export const WALK_POP = 0.18; // seconds a glint takes to pop up or drop away
export const WALK_TICK = 0.25; // seconds per tick of the gears

// Lateral offset of glint j (0..WALK_GLINTS-1): the middle one first, then outward
// alternating sides.
export function walkGlintOffset(j: number): number {
  if (j <= 0) return 0;
  const ring = Math.ceil(j / 2);
  const side = j % 2 === 1 ? -1 : 1;
  return (side * ring * WALK_SPAN) / Math.ceil((WALK_GLINTS - 1) / 2);
}

// Scale 0..1 of glint j `t` seconds into a walk of `seconds`: each pops up in turn
// (staggered by its ring) and all drop away over the last WALK_POP seconds.
export function walkGlintScale(j: number, t: number, seconds: number): number {
  if (t < 0 || t >= seconds) return 0;
  const start = Math.ceil(j / 2) * 0.08;
  const up = (t - start) / WALK_POP;
  const down = (seconds - t) / WALK_POP;
  const k = Math.min(1, up, down);
  if (k <= 0) return 0;
  // A little overshoot on the way up (a springy toy pop).
  return k >= 1 ? 1 : k * k * (3 - 2 * k) * (1 + 0.25 * Math.sin(k * Math.PI));
}

// Ticking angle of the gears: one tooth per WALK_TICK, each tick a quick eased snap.
export function walkTickAngle(t: number, teeth: number): number {
  const ticks = t / WALK_TICK;
  const n = Math.floor(ticks);
  const f = ticks - n;
  const snap = f < 0.3 ? (f / 0.3) * (f / 0.3) * (3 - (2 * f) / 0.3) : 1;
  return ((n + snap) * Math.PI * 2) / teeth;
}

// ---------- World 3: the Gear Gun's ratchet (cannon.ts) ----------
// Its gears jump one tooth per shot: an eased snap right after each shot, then a hold.
// `shots` is time * fireRate while firing (its integer part counts the shots so far).
export function gearRatchet(shots: number, teeth: number): number {
  const n = Math.floor(shots);
  const f = shots - n;
  const snap = f < 0.35 ? 1 - (1 - f / 0.35) * (1 - f / 0.35) : 1;
  return ((n + snap) * Math.PI * 2) / teeth;
}
