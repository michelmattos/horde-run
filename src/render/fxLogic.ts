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
  private cursor = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
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

  // Advances every live particle; particles that hit the ground stop there.
  step(dt: number): void {
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.vy[i] -= this.gravity[i] * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      if (this.py[i] < 0.05) {
        this.py[i] = 0.05;
        this.vy[i] = 0;
        this.vx[i] *= 0.8;
        this.vz[i] *= 0.8;
      }
    }
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

// ---------- Scenery placement ----------

// Bedroom props on the floor beside the rug (World 1 'Bedroom Floor').
export type PropKind = 'block' | 'book' | 'crayon';

export interface SceneryProp {
  kind: PropKind;
  x: number;
  z: number;
  scale: number;
  yaw: number; // radians about +Y
  shade: number; // 0..1, picks a toy colour
  stack: number; // blocks: 1..3 cubes high; books: 1..2 books; crayons: 1
}

// Footprint radius of a prop at scale 1 (world units), so props never reach the rug.
export const PROP_RADIUS: Record<PropKind, number> = { block: 0.75, book: 1.55, crayon: 1.35 };

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

// Building blocks, books and crayons scattered on both sides of the lane, never inside
// it (nor its border). Rows run from zMin to zMax; props reach out to `reach` units
// beyond the lane edge so wide screens see more of the bedroom floor.
export function scatterScenery(seed: number, laneWidth: number, zMin: number, zMax: number, count: number, reach = 22): SceneryProp[] {
  const rand = mulberry32(seed);
  const props: SceneryProp[] = [];
  const edge = laneWidth / 2 + SCENERY_CLEARANCE;
  for (let i = 0; i < count; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const roll = rand();
    const kind: PropKind = roll < 0.55 ? 'block' : roll < 0.78 ? 'book' : 'crayon';
    const scale = kind === 'block' ? 0.8 + rand() * 0.5 : 0.85 + rand() * 0.35;
    // Bias towards the lane so the props frame it; the footprint keeps them off the rug.
    const out = edge + PROP_RADIUS[kind] * scale + Math.pow(rand(), 1.6) * reach;
    const z = zMin + rand() * (zMax - zMin);
    const yaw = rand() * Math.PI * 2;
    const shade = rand();
    const stack = kind === 'block' ? 1 + Math.floor(rand() * 3) : kind === 'book' ? 1 + Math.floor(rand() * 2) : 1;
    props.push({ kind, x: side * out, z, scale, yaw, shade, stack });
  }
  return props;
}
