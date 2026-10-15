// Pure render-side bookkeeping (no Babylon, so it is unit-tested under Node): HP bar
// fractions, one-use gate label text, pop/fade curves, the preallocated particle and
// tracer pools the effects draw from, and deterministic scenery placement.
// Milestone 6 adds the World 3 hazard clocks (toggling gates, gliding gates, belts,
// turntables, saws) as pure functions of the battle time, so render and sim agree.
import type { ConveyorDef, CycleDef, GateDef, GateToggleDef, TurntableDef } from '../contracts.ts';
import { cycleOn, gateGlide, gateLabel, turntableSpin } from '../contracts.ts';

// ---------- Small curves and labels ----------

export function hpFraction(hp: number, maxHp: number): number {
  if (!(maxHp > 0) || !(hp > 0)) return 0;
  return hp >= maxHp ? 1 : hp / maxHp;
}

// Defender HP bars only show once the defender is damaged and still standing.
export function showHpBar(hp: number, maxHp: number): boolean {
  const f = hpFraction(hp, maxHp);
  return f > 0 && f < 1;
}

// Second line under a one-use gate's op, e.g. '12 left'.
export function usesLeftText(usesLeft: number): string {
  return `${Math.max(0, Math.floor(usesLeft))} left`;
}

// Scale pop: jumps to 1 + amount and eases back to 1 as k goes 1 → 0 (k = time left / duration).
export function popScale(k: number, amount: number): number {
  const c = k <= 0 ? 0 : k >= 1 ? 1 : k;
  return 1 + amount * c * c;
}

export const GATE_BREAK_TIME = 0.3;

// A breaking gate pops up (first 25%), then shrinks and fades to nothing.
// Writes into `out` so the per-frame call never allocates.
export function gateBreakAt(elapsed: number, out: { scale: number; alpha: number; done: boolean }): void {
  const t = elapsed / GATE_BREAK_TIME;
  if (t >= 1) {
    out.scale = 0;
    out.alpha = 0;
    out.done = true;
    return;
  }
  const u = t < 0 ? 0 : t;
  out.done = false;
  if (u < 0.25) {
    out.scale = 1 + 0.25 * (u / 0.25);
    out.alpha = 1;
  } else {
    const v = (u - 0.25) / 0.75; // 0 → 1
    out.scale = 1.25 * (1 - v);
    out.alpha = 1 - v;
  }
}

// ---------- Particle pool ----------

// Ground behaviour of a pool. The defaults (no bounce, rest at y = 0.05, no drag) are the
// original pool's: particles that reach the floor stop there and slide to a halt.
export interface ParticleOptions {
  bounce?: number; // 0..1 restitution when a particle hits the floor fast enough (0 = stop)
  groundY?: number; // floor height particles rest at (default 0.05)
  drag?: number; // air drag per second on every axis (confetti flutters, puffs slow down)
}

// Fixed-capacity particles in flat typed arrays. spawn() takes a free slot or
// overwrites the oldest one, so bursts never allocate and never grow the pool.
export class ParticlePool {
  readonly capacity: number;
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly pz: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vz: Float32Array;
  readonly life: Float32Array; // seconds left; <= 0 is free
  readonly maxLife: Float32Array;
  readonly size: Float32Array;
  readonly r: Float32Array;
  readonly g: Float32Array;
  readonly b: Float32Array;
  readonly gravity: Float32Array; // per particle: debris falls, puffs drift
  readonly bounce: number;
  readonly groundY: number;
  readonly drag: number;
  private cursor = 0;

  constructor(capacity: number, opts: ParticleOptions = {}) {
    this.capacity = capacity;
    this.bounce = opts.bounce ?? 0;
    this.groundY = opts.groundY ?? 0.05;
    this.drag = opts.drag ?? 0;
    this.px = new Float32Array(capacity);
    this.py = new Float32Array(capacity);
    this.pz = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.vz = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.r = new Float32Array(capacity);
    this.g = new Float32Array(capacity);
    this.b = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
  }

  // Returns the slot used. Prefers a free slot after the cursor, else the one with the least life.
  spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size: number,
    r: number,
    g: number,
    b: number,
    gravity: number,
  ): number {
    const n = this.capacity;
    let slot = -1;
    let weakest = 0;
    let weakestLife = Infinity;
    for (let k = 0; k < n; k++) {
      const i = (this.cursor + k) % n;
      const l = this.life[i];
      if (l <= 0) {
        slot = i;
        break;
      }
      if (l < weakestLife) {
        weakestLife = l;
        weakest = i;
      }
    }
    if (slot < 0) slot = weakest;
    this.cursor = (slot + 1) % n;
    this.px[slot] = x;
    this.py[slot] = y;
    this.pz[slot] = z;
    this.vx[slot] = vx;
    this.vy[slot] = vy;
    this.vz[slot] = vz;
    this.life[slot] = life;
    this.maxLife[slot] = life;
    this.size[slot] = size;
    this.r[slot] = r;
    this.g[slot] = g;
    this.b[slot] = b;
    this.gravity[slot] = gravity;
    return slot;
  }

  // Advances every live particle. Particles that hit the ground bounce (when the pool has
  // a restitution and they land fast enough) or stop there and slide to a halt.
  step(dt: number): void {
    const g0 = this.groundY;
    const keep = this.drag > 0 ? Math.max(0, 1 - this.drag * dt) : 1;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.vy[i] -= this.gravity[i] * dt;
      if (keep !== 1) {
        this.vx[i] *= keep;
        this.vy[i] *= keep;
        this.vz[i] *= keep;
      }
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      if (this.py[i] < g0) {
        this.py[i] = g0;
        if (this.bounce > 0 && this.vy[i] < -1.5) {
          this.vy[i] = -this.vy[i] * this.bounce;
          this.vx[i] *= 0.7;
          this.vz[i] *= 0.7;
        } else {
          this.vy[i] = 0;
          this.vx[i] *= 0.8;
          this.vz[i] *= 0.8;
        }
      }
    }
  }

  // True once a particle lies on the floor (it stopped bouncing).
  grounded(i: number): boolean {
    return this.py[i] <= this.groundY && this.vy[i] === 0;
  }

  isLive(i: number): boolean {
    return this.life[i] > 0;
  }

  // 1 at spawn → 0 at death.
  remaining(i: number): number {
    const m = this.maxLife[i];
    return m > 0 && this.life[i] > 0 ? this.life[i] / m : 0;
  }

  liveCount(): number {
    let c = 0;
    for (let i = 0; i < this.capacity; i++) if (this.life[i] > 0) c++;
    return c;
  }

  clear(): void {
    this.life.fill(0);
    this.cursor = 0;
  }
}

// ---------- Tracer pool ----------

// Tower darts in flight from (x0,z0) to (x1,z1). Slots are reused round-robin; darts that
// land during step() are listed in endedX/endedZ (endedCount of them) so the caller
// can spawn an impact puff without callbacks or allocation.
export class TracerPool {
  readonly capacity: number;
  readonly x0: Float32Array;
  readonly z0: Float32Array;
  readonly x1: Float32Array;
  readonly z1: Float32Array;
  readonly life: Float32Array;
  readonly maxLife: Float32Array;
  readonly endedX: Float32Array;
  readonly endedZ: Float32Array;
  readonly endedSlot: Int32Array; // slot of each landed dart (its x0/z0 stay readable until respawned)
  endedCount = 0;
  private cursor = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.x0 = new Float32Array(capacity);
    this.z0 = new Float32Array(capacity);
    this.x1 = new Float32Array(capacity);
    this.z1 = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.endedX = new Float32Array(capacity);
    this.endedZ = new Float32Array(capacity);
    this.endedSlot = new Int32Array(capacity);
  }

  spawn(x0: number, z0: number, x1: number, z1: number, life: number): number {
    const i = this.cursor;
    this.cursor = (i + 1) % this.capacity;
    this.x0[i] = x0;
    this.z0[i] = z0;
    this.x1[i] = x1;
    this.z1[i] = z1;
    this.life[i] = life;
    this.maxLife[i] = life;
    return i;
  }

  step(dt: number): void {
    this.endedCount = 0;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.endedX[this.endedCount] = this.x1[i];
        this.endedZ[this.endedCount] = this.z1[i];
        this.endedSlot[this.endedCount] = i;
        this.endedCount++;
      }
    }
  }

  isLive(i: number): boolean {
    return this.life[i] > 0;
  }

  // Flight progress 0 → 1.
  progress(i: number): number {
    const m = this.maxLife[i];
    return m > 0 ? 1 - Math.max(0, this.life[i]) / m : 1;
  }

  clear(): void {
    this.life.fill(0);
    this.endedCount = 0;
    this.cursor = 0;
  }
}

// ---------- Effect curves and instance matrices ----------

// 0 → 1 → 0 envelope over a particle's life: rises over the first `fadeIn` fraction and
// falls over the last `fadeOut` fraction. k = remaining life (1 at spawn → 0 at death).
export function fxEnvelope(k: number, fadeIn: number, fadeOut: number): number {
  if (!(k > 0)) return 0;
  const age = 1 - (k > 1 ? 1 : k);
  const a = fadeIn > 0 && age < fadeIn ? age / fadeIn : 1;
  const b = fadeOut > 0 && k < fadeOut ? k / fadeOut : 1;
  return a < b ? a : b;
}

// A foam dart's lob: straight from y0 to y1 plus a parabolic lift peaking mid-flight.
export function dartHeight(k: number, y0: number, y1: number, lift: number): number {
  return y0 + (y1 - y0) * k + 4 * lift * k * (1 - k);
}

// Nose-down pitch (radians) along that lob for a flight covering `dist` across the floor.
export function dartPitch(k: number, y0: number, y1: number, lift: number, dist: number): number {
  const dy = y1 - y0 + 4 * lift * (1 - 2 * k);
  return Math.atan2(-dy, Math.max(1e-3, dist));
}

// Writes a Babylon (row-vector) world matrix into m at offset o: scale, then roll about Z,
// pitch about X, yaw about Y (the order of Babylon's RotationYawPitchRoll), then
// translate. yaw 0 keeps local +Z up the lane; positive pitch tips +Z down.
export function writeTRS(
  m: Float32Array,
  o: number,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  yaw: number,
  pitch: number,
  roll: number,
): void {
  const cy = Math.cos(yaw),
    sny = Math.sin(yaw);
  const cx = Math.cos(pitch),
    snx = Math.sin(pitch);
  const cz = Math.cos(roll),
    snz = Math.sin(roll);
  // Rows of Rz * Rx, then times Ry: row = [a0*cy + a2*sy, a1, -a0*sy + a2*cy].
  const a00 = cz,
    a01 = snz * cx,
    a02 = snz * snx;
  const a10 = -snz,
    a11 = cz * cx,
    a12 = cz * snx;
  const a20 = 0,
    a21 = -snx,
    a22 = cx;
  m[o] = (a00 * cy + a02 * sny) * sx;
  m[o + 1] = a01 * sx;
  m[o + 2] = (-a00 * sny + a02 * cy) * sx;
  m[o + 3] = 0;
  m[o + 4] = (a10 * cy + a12 * sny) * sy;
  m[o + 5] = a11 * sy;
  m[o + 6] = (-a10 * sny + a12 * cy) * sy;
  m[o + 7] = 0;
  m[o + 8] = (a20 * cy + a22 * sny) * sz;
  m[o + 9] = a21 * sz;
  m[o + 10] = (-a20 * sny + a22 * cy) * sz;
  m[o + 11] = 0;
  m[o + 12] = x;
  m[o + 13] = y;
  m[o + 14] = z;
  m[o + 15] = 1;
}

// Camera-facing quad (local XY plane) at (x, y, z): local X runs along `right` (rx, ry, rz)
// scaled by sx, local Y along `up` (ux, uy, uz) scaled by sy, rotated by `spin` in the
// view plane. The axes are unit vectors read from the camera's view matrix.
export function writeBillboard(
  m: Float32Array,
  o: number,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  spin: number,
  rx: number,
  ry: number,
  rz: number,
  ux: number,
  uy: number,
  uz: number,
): void {
  const c = Math.cos(spin),
    s = Math.sin(spin);
  m[o] = (rx * c + ux * s) * sx;
  m[o + 1] = (ry * c + uy * s) * sx;
  m[o + 2] = (rz * c + uz * s) * sx;
  m[o + 3] = 0;
  m[o + 4] = (ux * c - rx * s) * sy;
  m[o + 5] = (uy * c - ry * s) * sy;
  m[o + 6] = (uz * c - rz * s) * sy;
  m[o + 7] = 0;
  // Normal = right x up (towards or away from the camera; the quads are double-sided).
  m[o + 8] = ry * uz - rz * uy;
  m[o + 9] = rz * ux - rx * uz;
  m[o + 10] = rx * uy - ry * ux;
  m[o + 11] = 0;
  m[o + 12] = x;
  m[o + 13] = y;
  m[o + 14] = z;
  m[o + 15] = 1;
}

// A spark streak: a quad whose local Y runs along the velocity (vx, vy, vz), length
// `len`, width `w` across it, facing the camera as far as the streak allows (fwd = the
// camera's forward axis). Falls back to a plain billboard-ish orientation at rest.
export function writeStreak(
  m: Float32Array,
  o: number,
  x: number,
  y: number,
  z: number,
  vx: number,
  vy: number,
  vz: number,
  w: number,
  len: number,
  fx: number,
  fy: number,
  fz: number,
): void {
  let l = Math.hypot(vx, vy, vz);
  let ax = vx,
    ay = vy,
    az = vz;
  if (l < 1e-4) {
    ax = 0;
    ay = 1;
    az = 0;
    l = 1;
  }
  ax /= l;
  ay /= l;
  az /= l;
  // across = along x fwd, so the quad's face points at the camera.
  let cx = ay * fz - az * fy;
  let cy = az * fx - ax * fz;
  let cz = ax * fy - ay * fx;
  let cl = Math.hypot(cx, cy, cz);
  if (cl < 1e-4) {
    cx = 1;
    cy = 0;
    cz = 0;
    cl = 1;
  }
  cx /= cl;
  cy /= cl;
  cz /= cl;
  m[o] = cx * w;
  m[o + 1] = cy * w;
  m[o + 2] = cz * w;
  m[o + 3] = 0;
  m[o + 4] = ax * len;
  m[o + 5] = ay * len;
  m[o + 6] = az * len;
  m[o + 7] = 0;
  m[o + 8] = -fx;
  m[o + 9] = -fy;
  m[o + 10] = -fz;
  m[o + 11] = 0;
  m[o + 12] = x;
  m[o + 13] = y;
  m[o + 14] = z;
  m[o + 15] = 1;
}

// Rate limiter for bursty sim events (a gate fires an event every tick while units stream
// through it). Up to `slots` keys are tracked in fixed arrays; allow(key) is true when that
// key last fired at least `interval` seconds ago. The least recently fired key is evicted
// when the table is full. No allocation after construction.
export class KeyedThrottle {
  readonly interval: number;
  private readonly keys: Float64Array;
  private readonly last: Float64Array;
  private readonly used: Uint8Array;
  private now = 0;

  constructor(slots: number, interval: number) {
    this.interval = interval;
    this.keys = new Float64Array(slots);
    this.last = new Float64Array(slots);
    this.used = new Uint8Array(slots);
  }

  tick(dt: number): void {
    this.now += dt;
  }

  allow(key: number): boolean {
    let oldest = 0;
    let oldestT = Infinity;
    for (let i = 0; i < this.keys.length; i++) {
      if (this.used[i] && this.keys[i] === key) {
        if (this.now - this.last[i] < this.interval) return false;
        this.last[i] = this.now;
        return true;
      }
      const t = this.used[i] ? this.last[i] : -Infinity;
      if (t < oldestT) {
        oldestT = t;
        oldest = i;
      }
    }
    this.used[oldest] = 1;
    this.keys[oldest] = key;
    this.last[oldest] = this.now;
    return true;
  }

  clear(): void {
    this.used.fill(0);
    this.now = 0;
  }
}

// ---------- Scenery placement ----------

// Bedroom props on the floor beside the rug (World 1 'Bedroom Floor'); drawn by
// models/props.ts (which keeps the same radii and weights).
export type PropKind = 'block' | 'book' | 'crayon' | 'marble' | 'car' | 'sock' | 'brick';
export const SCENERY_KINDS: readonly PropKind[] = ['block', 'book', 'crayon', 'marble', 'car', 'sock', 'brick'];

export interface SceneryProp {
  kind: PropKind;
  x: number;
  z: number;
  scale: number;
  yaw: number; // radians about +Y
  shade: number; // 0..1, picks a toy colour
  stack: number; // blocks: 1..3 cubes high; books: 1..3 books; others 1
  variant: number; // layout variant (see models/props.ts PROP_VARIANTS)
}

// Footprint radius of a prop at scale 1 (world units, its largest variant), so props
// never reach the rug or each other. Same values as models/props.ts PROP_RADIUS.
export const PROP_RADIUS: Record<PropKind, number> = {
  block: 1.15,
  book: 1.55,
  crayon: 1.4,
  marble: 1.0,
  car: 1.3,
  sock: 1.75,
  brick: 0.95,
};
// Scatter mix (sums to 1): big hero toys (car, sock) are rare. Same as models/props.ts.
export const PROP_WEIGHTS: Record<PropKind, number> = {
  block: 0.18,
  book: 0.17,
  crayon: 0.19,
  marble: 0.12,
  car: 0.06,
  sock: 0.07,
  brick: 0.21,
};
export const PROP_VARIANT_COUNT: Record<PropKind, number> = {
  block: 4,
  book: 3,
  crayon: 3,
  marble: 3,
  car: 2,
  sock: 2,
  brick: 4,
};

// Small deterministic PRNG (mulberry32) so the bedroom looks the same on every retry.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SCENERY_CLEARANCE = 1.2; // world units kept free between the lane edge and any prop

// Toys scattered on both sides of the lane, never inside it (nor its border) and never
// overlapping each other. Rows run from zMin to zMax; props reach out to `reach` units
// beyond the lane edge so wide screens see more of the bedroom floor.
export function scatterScenery(
  seed: number,
  laneWidth: number,
  zMin: number,
  zMax: number,
  count: number,
  reach = 22,
): SceneryProp[] {
  const rand = mulberry32(seed);
  const props: SceneryProp[] = [];
  const edge = laneWidth / 2 + SCENERY_CLEARANCE;
  const pick = (r: number): PropKind => {
    let acc = 0;
    for (const k of SCENERY_KINDS) {
      acc += PROP_WEIGHTS[k];
      if (r < acc) return k;
    }
    return 'brick';
  };
  for (let i = 0; i < count; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const kind = pick(rand());
    const scale = kind === 'block' || kind === 'brick' ? 0.8 + rand() * 0.4 : 0.85 + rand() * 0.3;
    const yaw = rand() * Math.PI * 2;
    const shade = rand();
    const variant = Math.floor(rand() * PROP_VARIANT_COUNT[kind]);
    const stack = kind === 'block' ? Math.min(3, variant + 1) : kind === 'book' ? variant + 1 : 1;
    const r = PROP_RADIUS[kind] * scale;
    // A few tries for a spot clear of the props already placed; give up on this one otherwise.
    for (let attempt = 0; attempt < 6; attempt++) {
      // Bias towards the lane so the props frame it; the footprint keeps them off the rug.
      const x = side * (edge + r + Math.pow(rand(), 1.6) * reach);
      const z = zMin + rand() * (zMax - zMin);
      let clear = true;
      for (const o of props) {
        const d = PROP_RADIUS[o.kind] * o.scale + r;
        if ((o.x - x) * (o.x - x) + (o.z - z) * (o.z - z) < d * d) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;
      props.push({ kind, x, z, scale, yaw, shade, stack, variant });
      break;
    }
  }
  return props;
}

// ---------- Milestone 4: throttles, emitters and ultimate paths ----------

// One-key rate limiter: ready() passes at most once per `interval` seconds (cannon shot
// puffs arrive at the fire rate, up to ~10 a second).
export class Cooldown {
  readonly interval: number;
  private left = 0;

  constructor(interval: number) {
    this.interval = interval;
  }

  tick(dt: number): void {
    this.left = this.left > dt ? this.left - dt : 0;
  }

  ready(): boolean {
    if (this.left > 0) return false;
    this.left = this.interval;
    return true;
  }

  clear(): void {
    this.left = 0;
  }
}

// Continuous emission at `rate` per second: the whole particles due this frame, carrying
// the fraction over in acc[i] so a low rate still emits evenly at any frame rate.
export function emitCount(acc: Float32Array, i: number, rate: number, dt: number): number {
  if (!(rate > 0) || !(dt > 0)) return 0;
  const due = acc[i] + rate * dt;
  const n = Math.floor(due);
  acc[i] = due - n;
  return n;
}

// Long-running emitters (the victory shower, the defeat collapse): a few fixed slots with
// a kind, a centre, a width and a life. start() takes a free slot or the one closest to
// finishing, so a burst of events never allocates.
export class TimedEmitters {
  readonly capacity: number;
  readonly kind: Uint8Array;
  readonly x: Float32Array;
  readonly z: Float32Array;
  readonly width: Float32Array;
  readonly life: Float32Array; // seconds left; <= 0 is free
  readonly maxLife: Float32Array;
  readonly acc: Float32Array; // emitCount carry, one per slot

  constructor(capacity: number) {
    this.capacity = capacity;
    this.kind = new Uint8Array(capacity);
    this.x = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.width = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.acc = new Float32Array(capacity);
  }

  start(kind: number, x: number, z: number, width: number, life: number): number {
    let slot = 0;
    let least = Infinity;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) {
        slot = i;
        break;
      }
      if (this.life[i] < least) {
        least = this.life[i];
        slot = i;
      }
    }
    this.kind[slot] = kind;
    this.x[slot] = x;
    this.z[slot] = z;
    this.width[slot] = width;
    this.life[slot] = life;
    this.maxLife[slot] = life;
    this.acc[slot] = 0;
    return slot;
  }

  step(dt: number): void {
    for (let i = 0; i < this.capacity; i++) if (this.life[i] > 0) this.life[i] -= dt;
  }

  isLive(i: number): boolean {
    return this.life[i] > 0;
  }

  // 0 at start → 1 at the end.
  progress(i: number): number {
    const m = this.maxLife[i];
    return m > 0 ? 1 - Math.max(0, this.life[i]) / m : 1;
  }

  clear(): void {
    this.life.fill(0);
  }
}

// The marble ultimate: it rolls from (x0, z0) straight up the lane at MARBLE_SPEED for
// `duration` seconds, then pops away (a quick swell and shrink) where it stopped.
export const MARBLE_SPEED = 12;
export const MARBLE_POP = 0.3; // seconds of the pop at the end
const MARBLE_DROP = 0.15; // seconds it takes to settle in at the start

export interface MarblePose {
  x: number;
  z: number;
  roll: number; // radians about +X, distance / radius
  scale: number; // 1 while rolling
  done: boolean; // finished popping: hide it
}

// Writes the pose at `t` seconds after the cue into out (no allocation).
export function marbleAt(t: number, x0: number, z0: number, duration: number, radius: number, out: MarblePose): void {
  const d = Math.max(0, duration);
  const r = radius > 0 ? radius : 1;
  const tt = t < 0 ? 0 : t;
  const rollT = tt < d ? tt : d;
  out.x = x0;
  out.z = z0 + MARBLE_SPEED * rollT;
  out.roll = (MARBLE_SPEED * rollT) / r;
  out.done = tt >= d + MARBLE_POP;
  if (out.done) out.scale = 0;
  else if (tt < d) out.scale = tt < MARBLE_DROP ? 0.7 + 0.3 * (tt / MARBLE_DROP) : 1;
  else {
    const k = (tt - d) / MARBLE_POP; // 0 → 1
    out.scale = k < 0.35 ? 1 + 0.25 * (k / 0.35) : 1.25 * (1 - (k - 0.35) / 0.65);
  }
}

// A paper parachute drifting down: canopy pops open over the first OPEN share of the
// fall, then sinks with a gentle ease and sway, lands at y = 0 when k = 1 and crumples
// away over the next PARA_CRUMPLE seconds' share (k > 1).
export const PARA_OPEN = 0.15;

export interface ParachutePose {
  y: number; // height of the trooper's feet
  open: number; // canopy scale 0..1 (with a little overshoot)
  sway: number; // x offset
  tilt: number; // roll radians, follows the sway
  crumple: number; // 0 flying → 1 collapsed on the floor
}

// k: 0 → 1 over the fall (beyond 1 while crumpling, up to 1 + crumpleShare).
export function parachuteAt(k: number, startY: number, phase: number, crumpleShare: number, out: ParachutePose): void {
  const f = k < 0 ? 0 : k > 1 ? 1 : k;
  // Ease-out fall: quick drop while the canopy opens, then a slow float onto the floor.
  const fall = 1 - (1 - f) * (1 - f * 0.35);
  out.y = startY * (1 - fall);
  const o = f / PARA_OPEN;
  out.open = o >= 1 ? 1 : o < 0.7 ? 0.35 + (o / 0.7) * 0.75 : 1.1 - ((o - 0.7) / 0.3) * 0.1;
  const s = Math.sin(phase + f * 7);
  out.sway = s * 0.25 * (1 - f);
  out.tilt = Math.cos(phase + f * 7) * 0.22 * (1 - f);
  out.crumple = k <= 1 || !(crumpleShare > 0) ? 0 : Math.min(1, (k - 1) / crumpleShare);
}

// ---------- Milestone 5: World 2 (Freezer / Snow Globe) bookkeeping ----------

// The room a level is played in (contracts LevelDef.theme; absent = the bedroom).
// Milestone 6 adds World 3's 'workshop'.
export type RoomTheme = 'bedroom' | 'freezer' | 'workshop';
export function roomThemeOf(level: { theme?: RoomTheme }): RoomTheme {
  return level.theme === 'freezer' || level.theme === 'workshop' ? level.theme : 'bedroom';
}

// Holds the assets of exactly one room theme. use(theme) keeps the current assets when
// the theme is unchanged, else disposes them first and builds the new theme's, so only
// the current room ever sits in GPU memory. build / release are the caller's.
export class RoomSlot<T> {
  private current: RoomTheme | null = null;
  private assets: T | null = null;
  private readonly build: (theme: RoomTheme) => T;
  private readonly release: (theme: RoomTheme, assets: T) => void;

  constructor(build: (theme: RoomTheme) => T, release: (theme: RoomTheme, assets: T) => void) {
    this.build = build;
    this.release = release;
  }

  get theme(): RoomTheme | null {
    return this.current;
  }

  use(theme: RoomTheme): T {
    if (this.current === theme && this.assets !== null) return this.assets;
    this.clear();
    this.assets = this.build(theme);
    this.current = theme;
    return this.assets;
  }

  clear(): void {
    if (this.current !== null && this.assets !== null) this.release(this.current, this.assets);
    this.current = null;
    this.assets = null;
  }
}

// A frozen gate's ice cracks in stages as units chip it: 0 clear ice, 1-3 more and more
// cracked. Never decreases as hp falls (ice does not heal while it is chipped).
export function iceCrackStage(hp: number, maxHp: number): 0 | 1 | 2 | 3 {
  if (!(maxHp > 0)) return 0;
  const f = hp >= maxHp ? 1 : hp > 0 ? hp / maxHp : 0;
  if (f > 0.75) return 0;
  if (f > 0.5) return 1;
  if (f > 0.25) return 2;
  return 3;
}

// How a frozen gate lets go: units broke it open (shatter into ice chips) or its time ran
// out (it melts away in drips).
export function thawStyle(chipped: boolean): 'shatter' | 'melt' {
  return chipped ? 'shatter' : 'melt';
}

export const ICE_GROW_TIME = 0.35; // seconds for the ice sheet to grow over a gate
export const ICE_MELT_TIME = 0.8; // seconds for it to melt away

// Ice sheet growing up over a gate (0 → 1, eased, with a small overshoot at the end).
export function iceGrowAt(t: number): number {
  const u = t <= 0 ? 0 : t >= ICE_GROW_TIME ? 1 : t / ICE_GROW_TIME;
  const e = 1 - (1 - u) * (1 - u);
  return e + Math.sin(u * Math.PI) * 0.06;
}

// Gust strength 0..1 for swaying scenery and snow: a gentle ramp during the telegraph
// (warn 0 → 1), full while the push is active.
export function gustStrength(warn: number, active: boolean): number {
  if (active) return 1;
  const w = warn > 0 ? (warn > 1 ? 1 : warn) : 0;
  return 0.35 * w * w;
}

// A lobbed snowball's height along its arc: straight from y0 to y1 plus a parabolic lift.
export function lobHeight(k: number, y0: number, y1: number, peak: number): number {
  const c = k < 0 ? 0 : k > 1 ? 1 : k;
  return y0 + (y1 - y0) * c + 4 * peak * c * (1 - c);
}

// Fork gates (same GateDef.fork id) get one signpost between each left / right pair.
export interface ForkSign {
  fork: string;
  x: number; // between the two gates' facing edges
  z: number; // the gates' line
  span: number; // free space between the two gates (signpost arms fit in it)
}
export function forkSigns(gates: readonly { fork?: string; x: number; z: number; width: number }[]): ForkSign[] {
  const groups = new Map<string, { x: number; z: number; width: number }[]>();
  for (const g of gates) {
    if (!g.fork) continue;
    let list = groups.get(g.fork);
    if (!list) groups.set(g.fork, (list = []));
    list.push(g);
  }
  const out: ForkSign[] = [];
  for (const [fork, list] of groups) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.x - b.x);
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      const left = a.x + a.width / 2;
      const right = b.x - b.width / 2;
      out.push({ fork, x: (left + right) / 2, z: (a.z + b.z) / 2, span: Math.max(0, right - left) });
    }
  }
  return out;
}

// Freezer props: the same scatter rules as the bedroom (outside the lane plus clearance,
// never overlapping), with their own kinds, radii and weights, and never touching an ice
// wall that pokes past the lane edge.
export type FreezerPropKind = 'cube' | 'peas' | 'popsicle' | 'fishbox' | 'tub' | 'flake';
export const FREEZER_KINDS: readonly FreezerPropKind[] = ['cube', 'peas', 'popsicle', 'fishbox', 'tub', 'flake'];
export const FREEZER_RADIUS: Record<FreezerPropKind, number> = {
  cube: 1.0,
  peas: 1.45,
  popsicle: 1.3,
  fishbox: 1.6,
  tub: 1.05,
  flake: 0.75,
};
export const FREEZER_WEIGHTS: Record<FreezerPropKind, number> = {
  cube: 0.26,
  peas: 0.16,
  popsicle: 0.16,
  fishbox: 0.08,
  tub: 0.14,
  flake: 0.2,
};
export const FREEZER_VARIANTS: Record<FreezerPropKind, number> = {
  cube: 3,
  peas: 2,
  popsicle: 3,
  fishbox: 2,
  tub: 3,
  flake: 3,
};

export interface FreezerProp {
  kind: FreezerPropKind;
  x: number;
  z: number;
  scale: number;
  yaw: number;
  color: number; // palette index
  variant: number;
}

export interface Rect {
  x: number; // centre
  z: number;
  width: number;
  depth: number;
}

export function scatterFreezerScenery(
  seed: number,
  laneWidth: number,
  zMin: number,
  zMax: number,
  count: number,
  reach: number,
  keepOut: readonly Rect[] = [],
): FreezerProp[] {
  const rand = mulberry32(seed);
  const props: FreezerProp[] = [];
  const edge = laneWidth / 2 + SCENERY_CLEARANCE;
  const pick = (r: number): FreezerPropKind => {
    let acc = 0;
    for (const k of FREEZER_KINDS) {
      acc += FREEZER_WEIGHTS[k];
      if (r < acc) return k;
    }
    return 'cube';
  };
  for (let i = 0; i < count; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const kind = pick(rand());
    const scale = 0.85 + rand() * 0.3;
    const yaw = rand() * Math.PI * 2;
    const color = Math.floor(rand() * 6);
    const variant = Math.floor(rand() * FREEZER_VARIANTS[kind]);
    const r = FREEZER_RADIUS[kind] * scale;
    for (let attempt = 0; attempt < 6; attempt++) {
      const x = side * (edge + r + Math.pow(rand(), 1.6) * reach);
      const z = zMin + rand() * (zMax - zMin);
      let clear = true;
      for (const o of props) {
        const d = FREEZER_RADIUS[o.kind] * o.scale + r;
        if ((o.x - x) * (o.x - x) + (o.z - z) * (o.z - z) < d * d) {
          clear = false;
          break;
        }
      }
      for (const w of keepOut) {
        if (!clear) break;
        const dx = Math.max(0, Math.abs(x - w.x) - w.width / 2);
        const dz = Math.max(0, Math.abs(z - w.z) - w.depth / 2);
        if (dx * dx + dz * dz < (r + SCENERY_CLEARANCE) * (r + SCENERY_CLEARANCE)) clear = false;
      }
      if (!clear) continue;
      props.push({ kind, x, z, scale, yaw, color, variant });
      break;
    }
  }
  return props;
}

// ---------- Milestone 6: World 3 (Clockwork Workshop) bookkeeping ----------
// Everything here is a pure function of the battle time (or integrates a value the caller
// keeps), allocation-free, so toggles, glides, belts, turntables and saws on screen follow
// the sim's own clocks (contracts cycleOn / gateGlide / conveyorDir / turntableSpin).

const TAU = Math.PI * 2;
const smooth01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

// A toggling gate's clock at time t, written into `out`.
export interface ToggleView {
  on: boolean; // the gate's own op applies (cycleOn)
  closed: boolean; // off without an alt: the shutter is down
  flipIn: number; // seconds until the next flip (cycleFlipIn)
  progress: number; // 0..1 share of the current phase gone (the clock hand)
  since: number; // seconds since the last flip; Infinity when it flipped at or before t = 0
}

export function toggleViewAt(c: GateToggleDef, t: number, out: ToggleView): ToggleView {
  if (!(c.on > 0 && c.off > 0)) {
    // A cycle with an empty phase never flips: it is always on (or always off).
    out.on = cycleOn(c, t);
    out.closed = !out.on && !c.alt;
    out.flipIn = Infinity;
    out.progress = 0;
    out.since = Infinity;
    return out;
  }
  const p = c.on + c.off;
  const u = (((t + (c.offset ?? 0)) % p) + p) % p;
  const on = u < c.on;
  const phase = on ? c.on : c.off;
  const elapsed = on ? u : u - c.on;
  out.on = on;
  out.closed = !on && !c.alt;
  out.flipIn = phase - elapsed;
  out.progress = phase > 0 ? elapsed / phase : 0;
  // A flip at the very start of the battle (or before it) is the initial state, not an event.
  out.since = t - elapsed > 1e-6 ? elapsed : Infinity;
  return out;
}

// The two faces of a toggling gate's card: its own label (on) and, while off, the alt
// label or '' (shutter down). Same strings as contracts gateLabelAt, computed once per gate.
export function toggleLabels(g: GateDef): { on: string; off: string } {
  const alt = g.toggle?.alt;
  return { on: gateLabel(g), off: alt ? gateLabel({ ...g, op: alt.op, value: alt.value }) : '' };
}

// The flip time is known in advance (flipIn), so both flip animations are timed around it
// rather than started by it: what is drawn changes exactly when the sim's effect does.

// Tin shutter of a toggling gate without an alt: 0 open (rolled up under the beam) .. 1 down.
// It drops like a weight (ease-in) over the SHUTTER_TIME before the gate closes, so it is
// down at the very instant the gate stops counting, and rolls up (ease-out) once it opens.
export const SHUTTER_TIME = 0.24;
export function shutterAt(v: ToggleView): number {
  if (v.closed) return 1;
  let k = 0;
  if (v.flipIn < SHUTTER_TIME) {
    const u = v.flipIn <= 0 ? 1 : 1 - v.flipIn / SHUTTER_TIME;
    k = u * u;
  }
  if (v.since < SHUTTER_TIME) {
    const u = v.since <= 0 ? 0 : v.since / SHUTTER_TIME;
    k = Math.max(k, (1 - u) * (1 - u));
  }
  return k;
}

// Split-flap card of a toggling gate with an alt value: the card flips about its middle
// over FLAP_TIME, centred on the flip. It folds away showing the current face, is edge-on
// at the flip, and unfolds showing the new one; so the face drawn is always the face of
// the gate's current state (gateLabelAt). Returns the card pitch: 0 flat, +-PI/2 edge-on.
export const FLAP_TIME = 0.32;
export function flapAt(v: ToggleView): number {
  const half = FLAP_TIME / 2;
  if (v.since < half) return (v.since <= 0 ? -0.5 : v.since / FLAP_TIME - 0.5) * Math.PI;
  if (v.flipIn < half) return (v.flipIn <= 0 ? 0.5 : 0.5 - v.flipIn / FLAP_TIME) * Math.PI;
  return 0;
}

// The clock pip warns before a flip: 0 until CLOCK_WARN seconds remain, then rises to 1.
export const CLOCK_WARN = 1.2;
export function clockWarn(flipIn: number): number {
  if (!(flipIn < CLOCK_WARN)) return 0;
  return flipIn <= 0 ? 1 : 1 - flipIn / CLOCK_WARN;
}

// A gliding gate (gateMoved): it lifts, glides from (fromX, fromZ) to (toX, toZ) with
// gateGlide exactly as the sim moves its spot (plus its own move sway on x), and drops.
export const GLIDE_LIFT = 0.9; // world units the gate rises while it glides
export interface GlidePose {
  x: number;
  z: number;
  lift: number; // height above the floor
  landed: boolean;
}
export function glidePoseAt(
  elapsed: number,
  seconds: number,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  sway: number,
  out: GlidePose,
): GlidePose {
  const k = gateGlide(elapsed, seconds);
  out.x = fromX + (toX - fromX) * k + sway;
  out.z = fromZ + (toZ - fromZ) * k;
  const u = seconds > 0 ? elapsed / seconds : 1;
  out.landed = u >= 1;
  out.lift = out.landed ? 0 : GLIDE_LIFT * smooth01(u / 0.18) * (1 - smooth01((u - 0.82) / 0.18));
  return out;
}

// Conveyor belt surface scroll. The belt mesh faces its current direction (it is turned
// by PI while conveyorDir is -1, so its chevrons always point the way it runs), so in the
// mesh's own frame the texture always runs forward: the v offset falls by speed * dt /
// repeat. Returns the new offset, wrapped to [0, 1).
export const BELT_REPEAT = 2; // world units per belt texture repeat (one chevron)
export function beltScroll(offset: number, c: ConveyorDef, dt: number, repeat = BELT_REPEAT): number {
  const speed = Math.hypot(c.vx, c.vz);
  const v = offset - (speed * (dt > 0 ? dt : 0)) / repeat;
  return v - Math.floor(v);
}
// Yaw (radians about +Y) that turns the belt's local +Z (its chevrons) to the way it runs:
// its velocity times conveyorDir(c, t) (dir is +1 or -1), snapped to the dominant axis so
// the belt stays square with its rectangle (0, PI/2, PI or -PI/2).
export function beltYaw(c: ConveyorDef, dir: number): number {
  const vx = c.vx * dir;
  const vz = c.vz * dir;
  if (Math.abs(vx) > Math.abs(vz)) return vx > 0 ? Math.PI / 2 : -Math.PI / 2;
  return vz < 0 ? Math.PI : 0;
}

// Turntable angle after another frame: integrates turntableSpin (a positive spin turns +x
// toward +z, contracts), wrapped to [0, 2 PI). Draw it as rotation.y = -angle (Babylon's
// positive yaw turns +x toward -z).
export function turntableAngle(angle: number, p: TurntableDef, t: number, dt: number): number {
  const a = angle + turntableSpin(p, t) * (dt > 0 ? dt : 0);
  return a - Math.floor(a / TAU) * TAU;
}

// How far a saw blade stands out of its slot (0 sunk .. 1 up) at time t. It never shows
// less than the danger: it rises SAW_RAISE_TIME before its cycle turns on, stays up while
// on, and sinks over SAW_RAISE_TIME after it turns off. No cycle = always up.
export const SAW_RAISE_TIME = 0.28;
export function sawRaiseAt(cycle: CycleDef | undefined, t: number): number {
  if (!cycle) return 1;
  const p = cycle.on + cycle.off;
  if (!(p > 0)) return 1;
  const u = (((t + (cycle.offset ?? 0)) % p) + p) % p;
  if (u < cycle.on) return 1;
  const off = u - cycle.on; // seconds since it turned off
  const left = p - u; // seconds until it turns on
  const sink = 1 - smooth01(off / SAW_RAISE_TIME);
  const rise = smooth01(1 - left / SAW_RAISE_TIME);
  return sink > rise ? sink : rise;
}

// Jack-in-the-Box telegraph: gates tremble a few cm in place while the shuffle winds up
// (the camera never moves). Writes the offset for one gate (phase decorrelates gates).
export const SHUFFLE_JITTER = 0.05; // world units at full warn
export function shuffleJitter(warn: number, time: number, phase: number, out: { x: number; z: number }): void {
  const w = warn > 0 ? (warn > 1 ? 1 : warn) : 0;
  const a = SHUFFLE_JITTER * w * w;
  out.x = a * Math.sin(time * 37 + phase * 2.1) * (0.6 + 0.4 * Math.sin(time * 11 + phase));
  out.z = a * 0.5 * Math.sin(time * 29 + phase * 3.7);
}

// Shield wall dents by damage share: 0 smooth, 1-3 more and more dented (never undents).
export function dentStage(hp: number, maxHp: number): 0 | 1 | 2 | 3 {
  return iceCrackStage(hp, maxHp);
}

// Workshop props: the same scatter rules as the bedroom and the freezer (outside the lane
// plus clearance, never overlapping, clear of any rectangle that pokes past the lane edge).
export type WorkshopPropKind = 'gears' | 'spring' | 'jar' | 'screwdriver' | 'key' | 'toy';
export const WORKSHOP_KINDS: readonly WorkshopPropKind[] = ['gears', 'spring', 'jar', 'screwdriver', 'key', 'toy'];
export const WORKSHOP_RADIUS: Record<WorkshopPropKind, number> = {
  gears: 1.2,
  spring: 1.1,
  jar: 0.85,
  screwdriver: 1.6,
  key: 0.9,
  toy: 1.5,
};
export const WORKSHOP_WEIGHTS: Record<WorkshopPropKind, number> = {
  gears: 0.26,
  spring: 0.15,
  jar: 0.14,
  screwdriver: 0.17,
  key: 0.18,
  toy: 0.1,
};
export const WORKSHOP_VARIANTS: Record<WorkshopPropKind, number> = {
  gears: 3,
  spring: 2,
  jar: 2,
  screwdriver: 2,
  key: 3,
  toy: 2,
};

export function scatterWorkshopScenery(
  seed: number,
  laneWidth: number,
  zMin: number,
  zMax: number,
  count: number,
  reach: number,
  keepOut: readonly Rect[] = [],
): WorkshopProp[] {
  const rand = mulberry32(seed);
  const props: WorkshopProp[] = [];
  const edge = laneWidth / 2 + SCENERY_CLEARANCE;
  const pick = (r: number): WorkshopPropKind => {
    let acc = 0;
    for (const k of WORKSHOP_KINDS) {
      acc += WORKSHOP_WEIGHTS[k];
      if (r < acc) return k;
    }
    return 'gears';
  };
  for (let i = 0; i < count; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const kind = pick(rand());
    const scale = 0.85 + rand() * 0.3;
    const yaw = rand() * Math.PI * 2;
    const color = Math.floor(rand() * 6);
    const variant = Math.floor(rand() * WORKSHOP_VARIANTS[kind]);
    const r = WORKSHOP_RADIUS[kind] * scale;
    for (let attempt = 0; attempt < 6; attempt++) {
      const x = side * (edge + r + Math.pow(rand(), 1.6) * reach);
      const z = zMin + rand() * (zMax - zMin);
      let clear = true;
      for (const o of props) {
        const d = WORKSHOP_RADIUS[o.kind] * o.scale + r;
        if ((o.x - x) * (o.x - x) + (o.z - z) * (o.z - z) < d * d) {
          clear = false;
          break;
        }
      }
      for (const w of keepOut) {
        if (!clear) break;
        const dx = Math.max(0, Math.abs(x - w.x) - w.width / 2);
        const dz = Math.max(0, Math.abs(z - w.z) - w.depth / 2);
        if (dx * dx + dz * dz < (r + SCENERY_CLEARANCE) * (r + SCENERY_CLEARANCE)) clear = false;
      }
      if (!clear) continue;
      props.push({ kind, x, z, scale, yaw, color, variant });
      break;
    }
  }
  return props;
}

export interface WorkshopProp {
  kind: WorkshopPropKind;
  x: number;
  z: number;
  scale: number;
  yaw: number;
  color: number; // palette index
  variant: number;
}
