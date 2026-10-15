// Recorded impacts (Kenney's CC0 'Impact Sounds', see public/audio/CREDITS.md) for the
// sounds where a real knock beats a synthesized one: plastic soldiers bumping, wooden
// forts, the cracking gate, a tin tower falling and the village hammer. Each sound has
// a few takes, picked at random but never the same take twice in a row, played at a
// random rate within `rate` so a battle's thousand clashes never sound machine-gunned.
// The files are ~3 KB each and load after the first tap; until a sound's takes are in,
// its synthesized recipe plays instead.
import type { SoundId } from './mapping.ts';

export interface SampleSet {
  files: string[]; // paths under the site's base URL
  rate: readonly [number, number]; // playback rate range
  gain: number; // level match against the synthesized sounds (may exceed 1: quiet recordings)
  hits?: readonly number[]; // seconds: play several takes in a row (the hammer)
}

const takes = (name: string, n: number): string[] => Array.from({ length: n }, (_, i) => `audio/${name}-${i}.mp3`);

export const SAMPLES: Readonly<Partial<Record<SoundId, SampleSet>>> = {
  clash: { files: takes('clash', 5), rate: [1.15, 1.45], gain: 1 },
  hitEnemyBase: { files: takes('hit-enemy', 3), rate: [0.95, 1.1], gain: 1.65 },
  hitPlayerBase: { files: takes('hit-player', 3), rate: [0.8, 0.9], gain: 1.3 },
  gateBreak: { files: takes('gate-break', 3), rate: [0.95, 1.1], gain: 1 },
  defenderDown: { files: takes('tower-down', 3), rate: [0.95, 1.08], gain: 1.5 },
  build: { files: takes('build', 3), rate: [0.95, 1.05], gain: 0.6, hits: [0, 0.17, 0.34] },
};

/** A random take index in [0, count) that differs from `last` whenever count > 1. */
export function pickTake(count: number, last: number, rand: number): number {
  if (count <= 1) return 0;
  if (last < 0 || last >= count) return Math.min(count - 1, Math.floor(rand * count));
  const i = Math.min(count - 2, Math.floor(rand * (count - 1)));
  return i >= last ? i + 1 : i;
}
