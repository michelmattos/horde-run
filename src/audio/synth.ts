// Every Horde Run sound, synthesized from oscillators, one shared noise buffer,
// biquad filters and gain envelopes (no samples, no packages). The character is a
// toy box: plastic pops for the cannon, marimba blips for good gates, wooden thocks
// for base hits, tin pings for towers, a wind-up ratchet for the tank and a soft
// brass fanfare for victory. Nothing harsh: no square waves without a lowpass, short
// attacks but never clicks, and every peak sits well under 1.
//
// Recipes write into any BaseAudioContext, so the same code pre-renders a sound once
// into an AudioBuffer (OfflineAudioContext) and, as a fallback, plays it live.
// Recipes keyed 'id:variant' are the per-champion and per-ultimate versions.

export interface Kit {
  ctx: BaseAudioContext;
  out: AudioNode;
  noise: AudioBuffer;
}

export interface Recipe {
  dur: number; // seconds rendered (covers the whole tail)
  play(k: Kit, t: number): void;
}

const QUIET = 0.0001;

// Gain envelope: silent, linear rise to `peak`, hold, then an exponential tail.
function env(g: AudioParam, t: number, attack: number, peak: number, decay: number, hold = 0): number {
  g.setValueAtTime(QUIET, t);
  g.linearRampToValueAtTime(peak, t + attack);
  if (hold > 0) g.setValueAtTime(peak, t + attack + hold);
  const end = t + attack + hold + decay;
  g.exponentialRampToValueAtTime(QUIET, end);
  return end;
}

interface FilterOpts {
  type: BiquadFilterType;
  freq: number;
  freq1?: number; // swept to this by the end of the sound
  q?: number;
}

function filtered(k: Kit, src: AudioNode, f: FilterOpts | undefined, t: number, end: number): AudioNode {
  if (!f) return src;
  const b = k.ctx.createBiquadFilter();
  b.type = f.type;
  b.frequency.setValueAtTime(f.freq, t);
  if (f.freq1) b.frequency.exponentialRampToValueAtTime(f.freq1, end);
  if (f.q !== undefined) b.Q.value = f.q;
  src.connect(b);
  return b;
}

interface ToneOpts {
  type?: OscillatorType;
  f0: number;
  f1?: number; // glide target
  glide?: number; // glide time (default: the whole sound)
  attack?: number;
  hold?: number;
  decay: number;
  peak: number;
  filter?: FilterOpts;
  vibrato?: { rate: number; depth: number }; // Hz, Hz
}

function tone(k: Kit, t: number, o: ToneOpts): void {
  const attack = o.attack ?? 0.004;
  const osc = k.ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.f0, t);
  const g = k.ctx.createGain();
  const end = env(g.gain, t, attack, o.peak, o.decay, o.hold);
  if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t + (o.glide ?? end - t));
  if (o.vibrato) {
    const lfo = k.ctx.createOscillator();
    lfo.frequency.value = o.vibrato.rate;
    const depth = k.ctx.createGain();
    depth.gain.value = o.vibrato.depth;
    lfo.connect(depth);
    depth.connect(osc.frequency);
    lfo.start(t);
    lfo.stop(end + 0.02);
  }
  filtered(k, osc, o.filter, t, end).connect(g);
  g.connect(k.out);
  osc.start(t);
  osc.stop(end + 0.02);
}

interface NoiseOpts {
  attack?: number;
  hold?: number;
  decay: number;
  peak: number;
  filter: FilterOpts;
  tremolo?: { rate: number; depth: number }; // Hz, 0..1
}

function noise(k: Kit, t: number, o: NoiseOpts): void {
  const src = k.ctx.createBufferSource();
  src.buffer = k.noise;
  src.loop = true; // long rumbles outlast the one-second buffer
  const g = k.ctx.createGain();
  const end = env(g.gain, t, o.attack ?? 0.002, o.peak, o.decay, o.hold);
  let tail: AudioNode = filtered(k, src, o.filter, t, end);
  if (o.tremolo) {
    const trem = k.ctx.createGain();
    trem.gain.value = 1 - o.tremolo.depth / 2;
    const lfo = k.ctx.createOscillator();
    lfo.frequency.value = o.tremolo.rate;
    const depth = k.ctx.createGain();
    depth.gain.value = o.tremolo.depth / 2;
    lfo.connect(depth);
    depth.connect(trem.gain);
    lfo.start(t);
    lfo.stop(end + 0.02);
    tail.connect(trem);
    tail = trem;
  }
  tail.connect(g);
  g.connect(k.out);
  // A random offset so repeated bursts never share the same grain.
  src.start(t, Math.random() * k.noise.duration * 0.9);
  src.stop(end + 0.02);
}

// Soft toy brass: two slightly detuned saws under a lowpass that opens on the attack.
function brass(k: Kit, t: number, f: number, hold: number, peak: number): void {
  const g = k.ctx.createGain();
  const end = env(g.gain, t, 0.03, peak, 0.18, hold);
  const lp = k.ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 1.2;
  lp.frequency.setValueAtTime(350, t);
  lp.frequency.linearRampToValueAtTime(Math.min(3200, f * 3.2), t + 0.05);
  lp.frequency.exponentialRampToValueAtTime(Math.min(1800, f * 1.8), end);
  for (const d of [1, 1.004]) {
    const o = k.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f * d;
    o.connect(lp);
    o.start(t);
    o.stop(end + 0.02);
  }
  lp.connect(g);
  g.connect(k.out);
}

// Marimba-ish blip: a warm triangle body plus a quick mallet click four octaves up.
function mallet(k: Kit, t: number, f: number, peak: number, decay = 0.16): void {
  tone(k, t, { type: 'triangle', f0: f, attack: 0.003, decay, peak });
  tone(k, t, { f0: f * 4, attack: 0.001, decay: 0.035, peak: peak * 0.22 });
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

export const RECIPES: Readonly<Record<string, Recipe>> = {
  // Paper/plastic pop of the toy cannon.
  shot: {
    dur: 0.1,
    play(k, t) {
      tone(k, t, { f0: 820, f1: 240, attack: 0.002, decay: 0.065, peak: 0.7 });
      noise(k, t, { attack: 0.001, decay: 0.022, peak: 0.3, filter: { type: 'highpass', freq: 2600 } });
    },
  },
  // Two rising marimba blips.
  gateGood: {
    dur: 0.25,
    play(k, t) {
      mallet(k, t, 660, 0.55);
      mallet(k, t + 0.06, 990, 0.5);
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
  // A tin tower's little 'pew'.
  towerShot: {
    dur: 0.15,
    play(k, t) {
      tone(k, t, {
        type: 'square',
        f0: 1500,
        f1: 480,
        glide: 0.1,
        attack: 0.002,
        decay: 0.11,
        peak: 0.24,
        filter: { type: 'lowpass', freq: 2600 },
      });
      tone(k, t, { f0: 3000, f1: 2000, attack: 0.001, decay: 0.03, peak: 0.1 });
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
      tone(k, end + 0.02, { type: 'triangle', f0: NOTE.C6, attack: 0.01, decay: 0.3, peak: 0.18 });
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
  // A tin horn sting climbing three notes over a low gong.
  bossPhase: {
    dur: 1.3,
    play(k, t) {
      brass(k, t, NOTE.A3, 0.12, 0.3);
      brass(k, t + 0.2, NOTE.C4, 0.12, 0.3);
      brass(k, t + 0.4, NOTE.Ds4, 0.45, 0.34);
      tone(k, t, { f0: 98, attack: 0.005, decay: 1.1, peak: 0.32 });
      tone(k, t, { f0: 98 * 2.76, attack: 0.005, decay: 0.6, peak: 0.08 });
    },
  },
  // Soft brass fanfare: C E G, then a held high C over a warm chord and a sparkle.
  victory: {
    dur: 2.0,
    play(k, t) {
      brass(k, t, NOTE.C5, 0.08, 0.3);
      brass(k, t + 0.13, NOTE.E5, 0.08, 0.3);
      brass(k, t + 0.26, NOTE.G5, 0.1, 0.3);
      brass(k, t + 0.42, NOTE.C6, 0.75, 0.32);
      for (const f of [NOTE.C5, NOTE.E5, NOTE.G5]) {
        tone(k, t + 0.42, { type: 'triangle', f0: f, attack: 0.04, hold: 0.4, decay: 0.8, peak: 0.09 });
      }
      tone(k, t + 0.44, { f0: NOTE.C7, attack: 0.002, decay: 0.35, peak: 0.07 });
    },
  },
  // A sad toy trombone: four drooping notes, the last one wobbling.
  defeat: {
    dur: 1.9,
    play(k, t) {
      const filter: FilterOpts = { type: 'lowpass', freq: 950 };
      const notes = [NOTE.G4, NOTE.Fs4, NOTE.F4];
      notes.forEach((f, i) => {
        const at = t + i * 0.32;
        tone(k, at, { type: 'triangle', f0: f, attack: 0.03, hold: 0.18, decay: 0.1, peak: 0.4 });
        tone(k, at, { type: 'sawtooth', f0: f, attack: 0.03, hold: 0.18, decay: 0.1, peak: 0.12, filter });
      });
      const last = t + 0.96;
      const vibrato = { rate: 6, depth: 7 };
      tone(k, last, {
        type: 'triangle',
        f0: NOTE.E4,
        f1: NOTE.E4 * 0.94,
        attack: 0.03,
        hold: 0.55,
        decay: 0.3,
        peak: 0.42,
        vibrato,
      });
      tone(k, last, {
        type: 'sawtooth',
        f0: NOTE.E4,
        f1: NOTE.E4 * 0.94,
        attack: 0.03,
        hold: 0.55,
        decay: 0.3,
        peak: 0.12,
        filter,
        vibrato,
      });
    },
  },
  // Plastic button click.
  tap: {
    dur: 0.06,
    play(k, t) {
      tone(k, t, { f0: 1900, f1: 1300, attack: 0.001, decay: 0.028, peak: 0.45 });
      noise(k, t, { attack: 0.001, decay: 0.012, peak: 0.22, filter: { type: 'highpass', freq: 4000 } });
    },
  },
  // Two-note coin chime, softened by a lowpass.
  coin: {
    dur: 0.3,
    play(k, t) {
      const filter: FilterOpts = { type: 'lowpass', freq: 4000 };
      tone(k, t, { type: 'square', f0: NOTE.B5, attack: 0.002, decay: 0.07, peak: 0.15, filter });
      tone(k, t, { f0: NOTE.B5, attack: 0.002, decay: 0.07, peak: 0.22 });
      tone(k, t + 0.07, { type: 'square', f0: NOTE.E6, attack: 0.002, decay: 0.2, peak: 0.15, filter });
      tone(k, t + 0.07, { f0: NOTE.E6, attack: 0.002, decay: 0.2, peak: 0.22 });
    },
  },
  // A sparkling arpeggio with a shimmer on top.
  unlock: {
    dur: 0.95,
    play(k, t) {
      [NOTE.C6, NOTE.E6, NOTE.G6, NOTE.C7].forEach((f, i) => {
        tone(k, t + i * 0.07, { type: 'triangle', f0: f, attack: 0.003, decay: 0.3 + i * 0.05, peak: 0.28 });
        tone(k, t + i * 0.07, { f0: f * 2, attack: 0.002, decay: 0.15, peak: 0.06 });
      });
      noise(k, t + 0.2, { attack: 0.05, decay: 0.45, peak: 0.1, filter: { type: 'highpass', freq: 6000 } });
    },
  },
  // Three hammer knocks on wood.
  build: {
    dur: 0.55,
    play(k, t) {
      for (const at of [0, 0.15, 0.3]) thock(k, t + at, 320, 0.6);
    },
  },
  // A rising sweep and a bright ding.
  upgrade: {
    dur: 0.75,
    play(k, t) {
      tone(k, t, {
        type: 'triangle',
        f0: 440,
        f1: 880,
        glide: 0.25,
        attack: 0.01,
        hold: 0.18,
        decay: 0.08,
        peak: 0.28,
      });
      tone(k, t + 0.3, { f0: NOTE.E6, attack: 0.002, decay: 0.4, peak: 0.32 });
      tone(k, t + 0.3, { f0: NOTE.E6 * 1.5, attack: 0.002, decay: 0.3, peak: 0.1 });
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

/** One second of white noise, made once and shared by every recipe. */
export function makeNoise(ctx: BaseAudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}
