// Seeded, deterministic RNG (sfc32 seeded through splitmix32). The sim and game
// only ever see `() => rng.next()`, so a battle replays exactly from its seed.

export interface Rng {
  readonly seed: number;
  next(): number; // [0, 1)
  int(maxExclusive: number): number;
  range(min: number, max: number): number;
}

function splitmix32(state: number): () => number {
  let s = state >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export function createRng(seed: number): Rng {
  const s32 = seed >>> 0;
  const mix = splitmix32(s32);
  let a = mix();
  let b = mix();
  let c = mix();
  let d = mix();
  const next = (): number => {
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) >>> 0;
    return t / 4294967296;
  };
  // Warm up so nearby seeds diverge immediately.
  for (let i = 0; i < 12; i++) next();
  return {
    seed: s32,
    next,
    int: (maxExclusive) => Math.floor(next() * maxExclusive),
    range: (min, max) => min + (max - min) * next(),
  };
}

// FNV-1a hash of a string, for named/daily seeds.
export function seedFromString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
