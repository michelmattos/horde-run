// Every Horde Run sound effect, synthesized from oscillators, one shared noise buffer,
// biquad filters and gain envelopes (no samples, no packages). The character is a
// toy box: a cork pop for the cannon, marimba notes for good gates, tin pings for
// towers, a wind-up ratchet for the tank; the stings (victory, defeat, boss phase, coins,
// unlocks) are played by the music's own band (instruments.ts) so they sit with it.
// Recorded impacts (samples.ts) replace the recipes for knocks and crashes once loaded. Nothing harsh: no square waves without a lowpass, short
// attacks but never clicks, and every peak sits well under 1. World 2's freezer adds
// glassy ice: crystal pings and crackles, soft snow thumps, wind made of swept noise.
// World 3's workshop adds tin and clockwork: shutter clacks, saw whirrs, tin clangs and
// pings, a bow's twang, wind-up ticking, a crank's ratchet and a spring's boing.
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

// A crackle of ice crystals: short high pings at fixed, irregular offsets (recipes are
// pre-rendered once, so the pattern is fixed rather than random), rising if `rise`.
function crystals(k: Kit, t: number, n: number, span: number, f0: number, peak: number, rise = 1.0): void {
  const offs = [0, 0.37, 0.11, 0.83, 0.58, 0.24, 0.69, 0.95, 0.46, 0.15, 0.77, 0.31];
  for (let i = 0; i < n; i++) {
    const o = offs[i % offs.length];
    const f = f0 * (1 + 0.6 * o) * (1 + (rise - 1) * (i / Math.max(1, n - 1)));
    tone(k, t + o * span, { f0: f, attack: 0.001, decay: 0.05 + 0.04 * (1 - o), peak: peak * (0.7 + 0.3 * o) });
  }
}

// A soft snow thump: a low sine drop and a muffled, lowpassed crunch.
function snowThump(k: Kit, t: number, peak: number, f = 140): void {
  tone(k, t, { f0: f, f1: f * 0.38, glide: 0.18, attack: 0.004, decay: 0.24, peak });
  noise(k, t, { attack: 0.003, decay: 0.2, peak: peak * 0.75, filter: { type: 'lowpass', freq: 1300, freq1: 300 } });
  noise(k, t, { attack: 0.001, decay: 0.05, peak: peak * 0.25, filter: { type: 'highpass', freq: 3500 } });
}

// A struck tin plate: a dull knock plus a few short inharmonic partials (a tin can, not a bell).
function tinHit(k: Kit, t: number, f: number, peak: number, ring = 0.18): void {
  [1, 1.58, 2.31, 3.07].forEach((m, i) =>
    tone(k, t, { f0: f * m, attack: 0.001, decay: ring * (1 - i * 0.18), peak: peak * (0.5 - i * 0.09) }),
  );
  noise(k, t, { attack: 0.001, decay: 0.04, peak: peak * 0.6, filter: { type: 'bandpass', freq: f * 2, q: 2 } });
}

// Clockwork ticks: `n` tight clicks `gap` seconds apart, alternating two pitches.
function ticks(k: Kit, t: number, n: number, gap: number, peak: number): void {
  for (let i = 0; i < n; i++) {
    const f = i % 2 === 0 ? 2300 : 1750;
    noise(k, t + i * gap, { attack: 0.001, decay: 0.012, peak, filter: { type: 'bandpass', freq: f, q: 9 } });
    tone(k, t + i * gap, { f0: f * 0.5, attack: 0.001, decay: 0.01, peak: peak * 0.3 });
  }
}

const NOTE = {
  A3: 220,
  C4: 261.63,
  Ds4: 311.13,
  E4: 329.63,
  F4: 349.23,
  Fs4: 369.99,
  G4: 392,
  C5: 523.25,
  E5: 659.25,
  G5: 783.99,
  B5: 987.77,
  C6: 1046.5,
  E6: 1318.51,
  G6: 1567.98,
  C7: 2093,
} as const;
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
  // ----- World 2: the freezer -----
  // A gate icing over: a rising crackle of crystals, a glassy whoosh and a cold bell chord.
  gateFreeze: {
    dur: 0.65,
    play(k, t) {
      crystals(k, t, 10, 0.3, 2200, 0.16, 1.5);
      noise(k, t, {
        attack: 0.06,
        decay: 0.3,
        peak: 0.35,
        filter: { type: 'bandpass', freq: 1800, freq1: 6000, q: 1.5 },
      });
      for (const f of [NOTE.E6, NOTE.B5 * 2]) tone(k, t + 0.28, { f0: f, attack: 0.002, decay: 0.32, peak: 0.12 });
    },
  },
  // Units chipping frozen ice: a tiny tick and two glassy pings.
  iceChip: {
    dur: 0.12,
    play(k, t) {
      noise(k, t, { attack: 0.001, decay: 0.03, peak: 0.45, filter: { type: 'highpass', freq: 3000 } });
      tone(k, t, { f0: 2650, attack: 0.001, decay: 0.06, peak: 0.16 });
      tone(k, t + 0.012, { f0: 3970, attack: 0.001, decay: 0.04, peak: 0.08 });
    },
  },
  // The ice letting go: a falling glassy tone and two water plips.
  gateThaw: {
    dur: 0.55,
    play(k, t) {
      tone(k, t, { type: 'triangle', f0: 1760, f1: 660, glide: 0.3, attack: 0.004, decay: 0.32, peak: 0.22 });
      noise(k, t, {
        attack: 0.02,
        decay: 0.25,
        peak: 0.2,
        filter: { type: 'bandpass', freq: 3200, freq1: 900, q: 1.2 },
      });
      tone(k, t + 0.16, { f0: 900, f1: 1500, glide: 0.04, attack: 0.002, decay: 0.07, peak: 0.24 });
      tone(k, t + 0.3, { f0: 760, f1: 1300, glide: 0.04, attack: 0.002, decay: 0.07, peak: 0.18 });
    },
  },
  // The Giant toppling: a deep plastic thud, then his riders' feet clattering off.
  giantFall: {
    dur: 0.75,
    play(k, t) {
      tone(k, t, { f0: 95, f1: 34, glide: 0.3, attack: 0.004, decay: 0.42, peak: 0.95 });
      thock(k, t, 220, 0.5);
      noise(k, t, { decay: 0.3, peak: 0.45, filter: { type: 'lowpass', freq: 700, freq1: 180 } });
      for (const at of [0.22, 0.29, 0.34, 0.42]) thock(k, t + at, 640 + at * 400, 0.16);
    },
  },
  // A rolling snowball bursting into soldiers: a soft 'pfomf' and a sparkle of snow.
  snowballBurst: {
    dur: 0.35,
    play(k, t) {
      noise(k, t, { attack: 0.004, decay: 0.16, peak: 0.7, filter: { type: 'bandpass', freq: 650, q: 0.8 } });
      tone(k, t, { f0: 210, f1: 80, glide: 0.12, attack: 0.003, decay: 0.15, peak: 0.45 });
      noise(k, t + 0.03, { attack: 0.01, decay: 0.2, peak: 0.16, filter: { type: 'highpass', freq: 5000 } });
    },
  },
  // Units freezing solid: frost racing over them (a noise sweep upward), crackles, a bell.
  freeze: {
    dur: 0.95,
    play(k, t) {
      noise(k, t, {
        attack: 0.08,
        hold: 0.15,
        decay: 0.4,
        peak: 0.42,
        filter: { type: 'bandpass', freq: 500, freq1: 5200, q: 2 },
      });
      crystals(k, t + 0.05, 12, 0.55, 1900, 0.14, 1.8);
      tone(k, t + 0.5, { f0: NOTE.C7, attack: 0.002, decay: 0.4, peak: 0.08 });
      tone(k, t + 0.5, { f0: NOTE.G6, attack: 0.002, decay: 0.42, peak: 0.1 });
    },
  },
  // Blizzard: a howling gust over a field of ice crystals, settling on a frozen chord.
  'ultimate:blizzard': {
    dur: 1.45,
    play(k, t) {
      noise(k, t, {
        attack: 0.25,
        hold: 0.55,
        decay: 0.55,
        peak: 0.6,
        filter: { type: 'bandpass', freq: 380, freq1: 1500, q: 2.5 },
        tremolo: { rate: 5, depth: 0.4 },
      });
      tone(k, t, { f0: 420, f1: 760, attack: 0.3, hold: 0.4, decay: 0.5, peak: 0.07, vibrato: { rate: 5, depth: 18 } });
      crystals(k, t + 0.3, 12, 0.7, 2300, 0.12, 1.4);
      for (const f of [NOTE.E6, NOTE.G6, NOTE.C7]) tone(k, t + 0.85, { f0: f, attack: 0.003, decay: 0.5, peak: 0.07 });
    },
  },
  // The Snow Globe Giant's lob: a soft falling whistle while the snowball flies.
  lob: {
    dur: 1.1,
    play(k, t) {
      tone(k, t, {
        f0: 1350,
        f1: 520,
        attack: 0.08,
        hold: 0.75,
        decay: 0.15,
        peak: 0.2,
        vibrato: { rate: 9, depth: 12 },
      });
      noise(k, t, {
        attack: 0.3,
        hold: 0.45,
        decay: 0.2,
        peak: 0.12,
        filter: { type: 'bandpass', freq: 1600, freq1: 700, q: 3 },
      });
    },
  },
  // The snowball landing: a heavy snow thump with a crunchy spray.
  lobHit: {
    dur: 0.45,
    play(k, t) {
      snowThump(k, t, 0.9, 130);
      noise(k, t + 0.04, { attack: 0.01, decay: 0.22, peak: 0.25, filter: { type: 'bandpass', freq: 2400, q: 0.9 } });
    },
  },
  // The globe being shaken (gust telegraph): wind swelling and rising in pitch.
  gustRise: {
    dur: 1.7,
    play(k, t) {
      noise(k, t, {
        attack: 1.15,
        hold: 0.1,
        decay: 0.4,
        peak: 0.62,
        filter: { type: 'bandpass', freq: 280, freq1: 1500, q: 2.2 },
      });
      noise(k, t + 0.2, {
        attack: 0.95,
        decay: 0.45,
        peak: 0.25,
        filter: { type: 'bandpass', freq: 600, freq1: 2600, q: 5 },
      });
      tone(k, t, { f0: 300, f1: 640, attack: 1.1, decay: 0.45, peak: 0.05, vibrato: { rate: 4, depth: 10 } });
    },
  },
  // The gust blowing: a broad whoosh that sweeps down and fades.
  gustWhoosh: {
    dur: 1.5,
    play(k, t) {
      noise(k, t, {
        attack: 0.08,
        hold: 0.5,
        decay: 0.8,
        peak: 0.6,
        filter: { type: 'bandpass', freq: 1500, freq1: 380, q: 1.4 },
        tremolo: { rate: 3, depth: 0.3 },
      });
      noise(k, t, { attack: 0.03, decay: 0.3, peak: 0.2, filter: { type: 'highpass', freq: 4000 } });
    },
  },
  // An igloo letting penguins out: a snowy door thump and two squeaky wind-up chirps.
  igloo: {
    dur: 0.55,
    play(k, t) {
      snowThump(k, t, 0.5, 200);
      tone(k, t + 0.14, { f0: 1700, f1: 2500, glide: 0.07, attack: 0.003, decay: 0.08, peak: 0.16 });
      tone(k, t + 0.26, { f0: 1900, f1: 2800, glide: 0.07, attack: 0.003, decay: 0.09, peak: 0.14 });
      noise(k, t + 0.12, { attack: 0.001, decay: 0.02, peak: 0.2, filter: { type: 'bandpass', freq: 2600, q: 6 } });
    },
  },
  // ----- World 3: the workshop -----
  // A timed gate's tin shutter dropping or lifting: a sliding rattle and a dusty clack.
  gateToggle: {
    dur: 0.26,
    play(k, t) {
      noise(k, t, {
        attack: 0.01,
        decay: 0.06,
        peak: 0.18,
        filter: { type: 'bandpass', freq: 3200, freq1: 1800, q: 3 },
      });
      tinHit(k, t + 0.05, 420, 0.55, 0.12);
      tone(k, t + 0.05, { f0: 180, f1: 90, attack: 0.002, decay: 0.08, peak: 0.4 });
    },
  },
  // A saw blade biting: a whirring buzz (a lowpassed saw wave with a fast flutter) and a grind.
  saw: {
    dur: 0.38,
    play(k, t) {
      tone(k, t, {
        type: 'sawtooth',
        f0: 210,
        f1: 170,
        attack: 0.02,
        hold: 0.12,
        decay: 0.2,
        peak: 0.2,
        filter: { type: 'lowpass', freq: 1800, freq1: 900, q: 2 },
        vibrato: { rate: 38, depth: 18 },
      });
      noise(k, t, {
        attack: 0.01,
        hold: 0.1,
        decay: 0.2,
        peak: 0.3,
        filter: { type: 'bandpass', freq: 3800, freq1: 2400, q: 3 },
        tremolo: { rate: 32, depth: 0.6 },
      });
    },
  },
  // Mobs bouncing off a riveted shield wall: a hollow tin clang and a low thud.
  shieldClang: {
    dur: 0.45,
    play(k, t) {
      tinHit(k, t, 330, 0.6, 0.35);
      tone(k, t, { f0: 140, f1: 80, attack: 0.002, decay: 0.15, peak: 0.45 });
    },
  },
  // An archer's bow: a short plucked twang (a quick pitch drop) and the arrow's swish.
  arrow: {
    dur: 0.2,
    play(k, t) {
      tone(k, t, {
        type: 'triangle',
        f0: 330,
        f1: 250,
        glide: 0.06,
        attack: 0.002,
        decay: 0.12,
        peak: 0.8,
        filter: { type: 'lowpass', freq: 1800 },
        vibrato: { rate: 30, depth: 8 },
      });
      noise(k, t + 0.02, {
        attack: 0.01,
        decay: 0.1,
        peak: 0.3,
        filter: { type: 'bandpass', freq: 2500, freq1: 5500, q: 2 },
      });
    },
  },
  // A Gear Gun shot glancing off the lane wall: a bright metal ping that drops a little.
  ricochet: {
    dur: 0.26,
    play(k, t) {
      tone(k, t, { f0: 2600, f1: 1900, glide: 0.2, attack: 0.001, decay: 0.22, peak: 0.42 });
      tone(k, t, { f0: 3900, f1: 3100, glide: 0.15, attack: 0.001, decay: 0.1, peak: 0.16 });
      noise(k, t, { attack: 0.001, decay: 0.02, peak: 0.5, filter: { type: 'highpass', freq: 3000 } });
    },
  },
  // The Wind-up Robot setting off along a gate: a key's clockwork ticking, slowing as it runs.
  gateWalk: {
    dur: 1.1,
    play(k, t) {
      let at = 0;
      for (let i = 0; i < 12; i++) {
        ticks(k, t + at, 1, 0, 0.75 - i * 0.03);
        if (i % 3 === 0) tinHit(k, t + at, 520, 0.22 - i * 0.012, 0.08);
        at += 0.06 + i * 0.006;
      }
      tone(k, t, { f0: 520, f1: 780, glide: 0.12, attack: 0.004, decay: 0.12, peak: 0.2 });
    },
  },
  // The Jack-in-the-Box cranking (the shuffle telegraph): a ratchet winding faster and faster
  // under a rising music-box arpeggio.
  crank: {
    dur: 1.5,
    play(k, t) {
      let at = 0;
      for (let i = 0; i < 18; i++) {
        noise(k, t + at, {
          attack: 0.001,
          decay: 0.016,
          peak: 0.34,
          filter: { type: 'bandpass', freq: 2400 + (i % 3) * 260, q: 8 },
        });
        tone(k, t + at, { f0: 800 + (i % 2) * 120, attack: 0.001, decay: 0.012, peak: 0.06 });
        at += Math.max(0.045, 0.11 - i * 0.005);
      }
      [72, 75, 79, 84].forEach((m, i) => INSTRUMENTS.musicBox(k, t + 0.2 + i * 0.26, m, 0.55, 0.2));
    },
  },
  // The jester popping up (the gates start to move): a lid thock, then a big spring boing.
  jackPop: {
    dur: 0.9,
    play(k, t) {
      thock(k, t, 300, 0.5);
      INSTRUMENTS.boing(k, t + 0.03, 60, 1, 0.6);
      noise(k, t + 0.03, {
        attack: 0.005,
        decay: 0.12,
        peak: 0.25,
        filter: { type: 'bandpass', freq: 700, freq1: 2400, q: 1.5 },
      });
      INSTRUMENTS.glock(k, t + 0.08, 84, 0.5, 0.2);
    },
  },
  // The Wind-up Robot champion: a key wound tight (quick ratchet), then clanking tin steps.
  'championLaunch:windup': {
    dur: 0.9,
    play(k, t) {
      ticks(k, t, 8, 0.035, 0.36);
      for (const [at, f] of [
        [0.36, 260],
        [0.54, 300],
        [0.72, 260],
      ] as const) {
        tinHit(k, t + at, f, 0.42, 0.14);
        tone(k, t + at, { f0: 120, f1: 70, attack: 0.002, decay: 0.1, peak: 0.5 });
      }
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
