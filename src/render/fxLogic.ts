// Pure render-side bookkeeping (no Babylon, so it is unit-tested under Node): HP bar
// fractions, one-use gate label text, pop/fade curves, the preallocated particle and
// tracer pools the effects draw from, and deterministic scenery placement.

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
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    life: number, size: number,
    r: number, g: number, b: number,
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
  m: Float32Array, o: number,
  x: number, y: number, z: number,
  sx: number, sy: number, sz: number,
  yaw: number, pitch: number, roll: number,
): void {
  const cy = Math.cos(yaw), sny = Math.sin(yaw);
  const cx = Math.cos(pitch), snx = Math.sin(pitch);
  const cz = Math.cos(roll), snz = Math.sin(roll);
  // Rows of Rz * Rx, then times Ry: row = [a0*cy + a2*sy, a1, -a0*sy + a2*cy].
  const a00 = cz, a01 = snz * cx, a02 = snz * snx;
  const a10 = -snz, a11 = cz * cx, a12 = cz * snx;
  const a20 = 0, a21 = -snx, a22 = cx;
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
  m: Float32Array, o: number,
  x: number, y: number, z: number,
  sx: number, sy: number, spin: number,
  rx: number, ry: number, rz: number,
  ux: number, uy: number, uz: number,
): void {
  const c = Math.cos(spin), s = Math.sin(spin);
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
  m: Float32Array, o: number,
  x: number, y: number, z: number,
  vx: number, vy: number, vz: number,
  w: number, len: number,
  fx: number, fy: number, fz: number,
): void {
  let l = Math.hypot(vx, vy, vz);
  let ax = vx, ay = vy, az = vz;
  if (l < 1e-4) {
    ax = 0; ay = 1; az = 0; l = 1;
  }
  ax /= l; ay /= l; az /= l;
  // across = along x fwd, so the quad's face points at the camera.
  let cx = ay * fz - az * fy;
  let cy = az * fx - ax * fz;
  let cz = ax * fy - ay * fx;
  let cl = Math.hypot(cx, cy, cz);
  if (cl < 1e-4) {
    cx = 1; cy = 0; cz = 0; cl = 1;
  }
  cx /= cl; cy /= cl; cz /= cl;
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
export const PROP_RADIUS: Record<PropKind, number> = { block: 1.15, book: 1.55, crayon: 1.4, marble: 1.0, car: 1.3, sock: 1.75, brick: 0.95 };
// Scatter mix (sums to 1): big hero toys (car, sock) are rare. Same as models/props.ts.
export const PROP_WEIGHTS: Record<PropKind, number> = { block: 0.18, book: 0.17, crayon: 0.19, marble: 0.12, car: 0.06, sock: 0.07, brick: 0.21 };
export const PROP_VARIANT_COUNT: Record<PropKind, number> = { block: 4, book: 3, crayon: 3, marble: 3, car: 2, sock: 2, brick: 4 };

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
export function scatterScenery(seed: number, laneWidth: number, zMin: number, zMax: number, count: number, reach = 22): SceneryProp[] {
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
