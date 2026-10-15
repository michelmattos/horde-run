// Every Horde Run sound effect, synthesized from oscillators, one shared noise buffer,
// biquad filters and gain envelopes (no samples, no packages). The character is a
// toy box: a cork pop for the cannon, marimba notes for good gates, tin pings for
// towers, a wind-up ratchet for the tank; the stings (victory, defeat, boss phase, coins,
// unlocks) are played by the music's own band (instruments.ts) so they sit with it.
// Recorded impacts (samples.ts) replace the recipes for knocks and crashes once loaded. Nothing harsh: no square waves without a lowpass, short
// attacks but never clicks, and every peak sits well under 1.
//
// Recipes write into any BaseAudioContext, so the same code pre-renders a sound once
// into an AudioBuffer (OfflineAudioContext) and, as a fallback, plays it live.
// Recipes keyed 'id:variant' are the per-champion and per-ultimate versions.

import { noise, tone } from './dsp.ts';
import type { FilterOpts, Kit } from './dsp.ts';
import { INSTRUMENTS } from './instruments.ts';

export type { Kit } from './dsp.ts';

export interface Recipe {
  dur: number; // seconds rendered (covers the whole tail)
  play(k: Kit, t: number): void;
}

// Wooden thock: a falling sine knock and a band of noise for the wood.
function thock(k: Kit, t: number, f: number, peak: number): void {
  tone(k, t, { f0: f, f1: f * 0.5, glide: 0.1, attack: 0.002, decay: 0.09, peak });
  noise(k, t, { decay: 0.06, peak: peak * 0.9, filter: { type: 'bandpass', freq: f * 2.2, q: 3 } });
}

// A soft boom for cannonballs and the tank: low sine drop plus a lowpassed rush.
function boom(k: Kit, t: number, peak: number): void {
  tone(k, t, { f0: 125, f1: 42, glide: 0.25, attack: 0.004, decay: 0.34, peak });
  noise(k, t, { decay: 0.28, peak: peak * 0.6, filter: { type: 'lowpass', freq: 900, freq1: 200 } });
  noise(k, t, { decay: 0.04, peak: peak * 0.3, filter: { type: 'bandpass', freq: 1700, q: 1.5 } });
}

const C6 = 1046.5;

export const RECIPES: Readonly<Record<string, Recipe>> = {
  // A soft cork pop for the toy cannon: it fires five times a second, so it stays low and short.
  shot: {
    dur: 0.09,
    play(k, t) {
      tone(k, t, { f0: 520, f1: 190, glide: 0.05, attack: 0.002, decay: 0.06, peak: 0.6 });
      noise(k, t, { attack: 0.001, decay: 0.025, peak: 0.22, filter: { type: 'bandpass', freq: 1300, q: 1.2 } });
    },
  },
  // Two rising marimba notes.
  gateGood: {
    dur: 0.45,
    play(k, t) {
      INSTRUMENTS.marimba(k, t, 79, 0.9, 0.1);
      INSTRUMENTS.marimba(k, t + 0.06, 84, 0.8, 0.1);
    },
  },
  // A droopy toy 'bwomp'.
  gateTrap: {
    dur: 0.34,
    play(k, t) {
      const filter: FilterOpts = { type: 'lowpass', freq: 1400, freq1: 500 };
      tone(k, t, { type: 'triangle', f0: 420, f1: 165, attack: 0.006, decay: 0.28, peak: 0.6, filter });
      tone(k, t, { type: 'square', f0: 210, f1: 82, attack: 0.006, decay: 0.26, peak: 0.1, filter });
    },
  },
  // A wooden gate cracking: a crack, two splinters and a low knock.
  gateBreak: {
    dur: 0.4,
    play(k, t) {
      noise(k, t, { decay: 0.12, peak: 0.85, filter: { type: 'bandpass', freq: 1700, q: 1.5 } });
      noise(k, t + 0.04, { decay: 0.06, peak: 0.45, filter: { type: 'bandpass', freq: 2800, q: 4 } });
      noise(k, t + 0.09, { decay: 0.05, peak: 0.35, filter: { type: 'bandpass', freq: 2200, q: 4 } });
      tone(k, t, { f0: 190, f1: 70, attack: 0.003, decay: 0.22, peak: 0.65 });
    },
  },
  // Plastic soldiers bumping: a woodblock double tick.
  clash: {
    dur: 0.09,
    play(k, t) {
      tone(k, t, { f0: 1150, f1: 900, attack: 0.001, decay: 0.04, peak: 0.45 });
      noise(k, t, { attack: 0.001, decay: 0.028, peak: 0.55, filter: { type: 'bandpass', freq: 2400, q: 6 } });
      noise(k, t + 0.018, { attack: 0.001, decay: 0.028, peak: 0.32, filter: { type: 'bandpass', freq: 1900, q: 6 } });
    },
  },
  // A satisfying wooden thock on the enemy fort.
  hitEnemyBase: {
    dur: 0.22,
    play(k, t) {
      tone(k, t, { f0: 240, f1: 105, glide: 0.12, attack: 0.002, decay: 0.17, peak: 0.85 });
      noise(k, t, { decay: 0.05, peak: 0.45, filter: { type: 'bandpass', freq: 900, q: 2 } });
      tone(k, t, { type: 'triangle', f0: 480, f1: 300, attack: 0.002, decay: 0.05, peak: 0.2 });
    },
  },
  // A duller, lower thud on our own fort.
  hitPlayerBase: {
    dur: 0.3,
    play(k, t) {
      tone(k, t, { f0: 150, f1: 55, glide: 0.2, attack: 0.003, decay: 0.24, peak: 0.95 });
      noise(k, t, { decay: 0.12, peak: 0.5, filter: { type: 'lowpass', freq: 520 } });
      tone(k, t, { type: 'triangle', f0: 300, f1: 140, attack: 0.003, decay: 0.1, peak: 0.2 });
    },
  },
  // A tin tower's little 'pew', lowpassed so a row of towers never whistles.
  towerShot: {
    dur: 0.12,
    play(k, t) {
      tone(k, t, {
        type: 'triangle',
        f0: 1100,
        f1: 480,
        glide: 0.08,
        attack: 0.002,
        decay: 0.09,
        peak: 0.32,
        filter: { type: 'lowpass', freq: 2000 },
      });
    },
  },
  // Tin clatter: inharmonic pings, a crash and a falling groan.
  defenderDown: {
    dur: 0.65,
    play(k, t) {
      [1480, 2290, 3170, 4020].forEach((f, i) =>
        tone(k, t + i * 0.012, { f0: f, attack: 0.001, decay: 0.5 - i * 0.08, peak: 0.16 }),
      );
      noise(k, t, { decay: 0.25, peak: 0.55, filter: { type: 'bandpass', freq: 1300, q: 1 } });
      noise(k, t + 0.12, { decay: 0.08, peak: 0.3, filter: { type: 'bandpass', freq: 2600, q: 2 } });
      tone(k, t, { type: 'triangle', f0: 500, f1: 120, glide: 0.4, attack: 0.004, decay: 0.45, peak: 0.32 });
    },
  },
  // Sarge's bazooka: a rushing 'fwoomp'.
  'championLaunch:sarge': {
    dur: 0.42,
    play(k, t) {
      noise(k, t, {
        attack: 0.02,
        decay: 0.3,
        peak: 0.65,
        filter: { type: 'bandpass', freq: 300, freq1: 2200, q: 1.2 },
      });
      tone(k, t, { f0: 170, f1: 60, attack: 0.005, decay: 0.3, peak: 0.75 });
      tone(k, t + 0.02, { type: 'triangle', f0: 900, f1: 400, attack: 0.002, decay: 0.06, peak: 0.22 });
    },
  },
  // The tank: a wind-up ratchet that speeds up and rises, then a soft boom.
  'championLaunch:tank': {
    dur: 0.95,
    play(k, t) {
      let at = t;
      for (let i = 0; i < 9; i++) {
        noise(k, at, {
          attack: 0.001,
          decay: 0.018,
          peak: 0.5,
          filter: { type: 'bandpass', freq: 2200 + i * 130, q: 8 },
        });
        tone(k, at, {
          type: 'square',
          f0: 300 + i * 40,
          attack: 0.001,
          decay: 0.015,
          peak: 0.07,
          filter: { type: 'lowpass', freq: 2000 },
        });
        at += 0.07 - i * 0.005;
      }
      boom(k, at + 0.03, 0.85);
    },
  },
  // The drummer: a snare roll that swells, a bass drum and a toy fife note.
  'championLaunch:drummer': {
    dur: 0.85,
    play(k, t) {
      for (let i = 0; i < 10; i++) {
        noise(k, t + i * 0.035, {
          attack: 0.001,
          decay: 0.05,
          peak: 0.2 + i * 0.035,
          filter: { type: 'bandpass', freq: 2100, q: 0.8 },
        });
      }
      const end = t + 0.37;
      tone(k, end, { f0: 110, f1: 48, glide: 0.2, attack: 0.003, decay: 0.3, peak: 0.95 });
      noise(k, end, { decay: 0.08, peak: 0.35, filter: { type: 'lowpass', freq: 700 } });
      tone(k, end + 0.02, { type: 'triangle', f0: C6, attack: 0.01, decay: 0.3, peak: 0.18 });
    },
  },
  // Barrage: a falling whistle, then three soft booms.
  'ultimate:barrage': {
    dur: 1.4,
    play(k, t) {
      tone(k, t, { f0: 1700, f1: 700, glide: 0.55, attack: 0.05, hold: 0.42, decay: 0.08, peak: 0.22 });
      boom(k, t + 0.56, 0.8);
      boom(k, t + 0.76, 0.65);
      boom(k, t + 0.96, 0.7);
    },
  },
  // Paratroopers: a toy plane's beating drone and parachutes popping open.
  'ultimate:paratroopers': {
    dur: 1.25,
    play(k, t) {
      const filter: FilterOpts = { type: 'lowpass', freq: 520, q: 2 };
      tone(k, t, { type: 'sawtooth', f0: 98, attack: 0.15, hold: 0.5, decay: 0.3, peak: 0.22, filter });
      tone(k, t, { type: 'sawtooth', f0: 101, attack: 0.15, hold: 0.5, decay: 0.3, peak: 0.18, filter });
      for (const at of [0.35, 0.52, 0.69]) {
        noise(k, t + at, {
          attack: 0.01,
          decay: 0.09,
          peak: 0.4,
          filter: { type: 'bandpass', freq: 600, freq1: 2400, q: 2 },
        });
        tone(k, t + at, { f0: 500, f1: 900, attack: 0.004, decay: 0.06, peak: 0.14 });
      }
    },
  },
  // The giant marble: a glassy clink, then a tumbling rumble down the lane.
  'ultimate:marble': {
    dur: 1.35,
    play(k, t) {
      tone(k, t, { f0: 2637, attack: 0.001, decay: 0.4, peak: 0.26 });
      tone(k, t, { f0: 3951, attack: 0.001, decay: 0.25, peak: 0.12 });
      noise(k, t + 0.05, {
        attack: 0.1,
        hold: 0.7,
        decay: 0.4,
        peak: 0.7,
        filter: { type: 'lowpass', freq: 260, q: 1 },
        tremolo: { rate: 14, depth: 0.7 },
      });
      tone(k, t + 0.05, { f0: 70, attack: 0.1, hold: 0.7, decay: 0.4, peak: 0.25 });
    },
  },
  // A paper-confetti pop with a soft thump.
  blast: {
    dur: 0.3,
    play(k, t) {
      noise(k, t, { decay: 0.14, peak: 0.75, filter: { type: 'bandpass', freq: 1100, q: 0.9 } });
      tone(k, t, { f0: 260, f1: 70, attack: 0.003, decay: 0.18, peak: 0.65 });
      noise(k, t, { attack: 0.001, decay: 0.03, peak: 0.28, filter: { type: 'highpass', freq: 3000 } });
    },
  },
  // A timpani roll into a diminished trumpet chord and a cymbal.
  bossPhase: {
    dur: 1.5,
    play(k, t) {
      [0, 0.09, 0.17, 0.24, 0.3].forEach((d, i) => INSTRUMENTS.timpani(k, t + d, 45, 0.45 + i * 0.1, 0.2));
      for (const m of [57, 60, 63]) INSTRUMENTS.trumpet(k, t + 0.36, m, 0.9, 0.7);
      INSTRUMENTS.cymbal(k, t + 0.36, 0, 0.8, 1);
    },
  },
  // The band's fanfare: G C E then a held G on the trumpet over a C chord, timpani,
  // a cymbal and a glockenspiel sparkle (the music's own instruments, so it fits).
  victory: {
    dur: 1.8,
    play(k, t) {
      const tr = INSTRUMENTS.trumpet;
      tr(k, t, 67, 0.9, 0.11);
      tr(k, t + 0.13, 72, 0.9, 0.11);
      tr(k, t + 0.26, 76, 0.9, 0.11);
      tr(k, t + 0.42, 79, 1, 0.9);
      for (const m of [60, 64, 67]) INSTRUMENTS.reed(k, t + 0.42, m, 1, 0.9);
      INSTRUMENTS.tuba(k, t + 0.42, 48, 1, 0.9);
      INSTRUMENTS.timpani(k, t + 0.42, 48, 1, 0.5);
      INSTRUMENTS.cymbal(k, t + 0.42, 0, 0.8, 1);
      [84, 88, 91, 96].forEach((m, i) => INSTRUMENTS.glock(k, t + 0.5 + i * 0.07, m, 0.6, 0.2));
    },
  },
  // A sad toy trumpet: three drooping notes, the last one held with a wobble, over a tuba.
  defeat: {
    dur: 2.1,
    play(k, t) {
      const tr = INSTRUMENTS.trumpet;
      tr(k, t, 67, 0.8, 0.25);
      tr(k, t + 0.32, 66, 0.8, 0.25);
      tr(k, t + 0.64, 65, 0.8, 0.25);
      tr(k, t + 0.96, 64, 0.85, 0.9);
      INSTRUMENTS.tuba(k, t + 0.96, 40, 0.8, 0.9);
      INSTRUMENTS.timpani(k, t + 0.96, 40, 0.5, 0.5);
    },
  },
  // A soft woodblock 'tok' for settings toggles: low and short, never a sharp click.
  tap: {
    dur: 0.06,
    play(k, t) {
      tone(k, t, { f0: 880, f1: 660, glide: 0.03, attack: 0.002, decay: 0.04, peak: 0.35 });
      noise(k, t, { attack: 0.001, decay: 0.012, peak: 0.08, filter: { type: 'bandpass', freq: 1600, q: 3 } });
    },
  },
  // Two glockenspiel notes, the classic coin interval.
  coin: {
    dur: 1,
    play(k, t) {
      INSTRUMENTS.glock(k, t, 83, 0.7, 0.1);
      INSTRUMENTS.glock(k, t + 0.07, 88, 0.8, 0.2);
    },
  },
  // A glockenspiel arpeggio topped by a music-box note and a soft shimmer.
  unlock: {
    dur: 1.3,
    play(k, t) {
      [84, 88, 91].forEach((m, i) => INSTRUMENTS.glock(k, t + i * 0.07, m, 0.75, 0.2));
      INSTRUMENTS.musicBox(k, t + 0.21, 96, 0.8, 0.5);
      noise(k, t + 0.2, { attack: 0.05, decay: 0.45, peak: 0.06, filter: { type: 'highpass', freq: 6000 } });
    },
  },
  // Three hammer knocks on wood.
  build: {
    dur: 0.55,
    play(k, t) {
      for (const at of [0, 0.15, 0.3]) thock(k, t + at, 320, 0.6);
    },
  },
  // Three rising marimba notes and a bright glockenspiel ding.
  upgrade: {
    dur: 1.2,
    play(k, t) {
      [72, 76, 79].forEach((m, i) => INSTRUMENTS.marimba(k, t + i * 0.07, m, 0.8, 0.1));
      INSTRUMENTS.glock(k, t + 0.24, 84, 1, 0.3);
    },
  },
};

// Default variant when none (or an unknown one) is given.
const DEFAULT_VARIANT: Readonly<Record<string, string>> = {
  championLaunch: 'sarge',
  ultimate: 'barrage',
};

/** Key into RECIPES for a sound and optional variant ('ultimate' + 'marble' -> 'ultimate:marble'). */
export function recipeKey(id: string, variant?: string): string {
  const def = DEFAULT_VARIANT[id];
  if (def === undefined) return id;
  const key = `${id}:${variant ?? def}`;
  return key in RECIPES ? key : `${id}:${def}`;
}

export { makeNoise } from './dsp.ts';
