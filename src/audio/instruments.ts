// The toy-box band that plays the music (and the musical stings): a music box, a
// glockenspiel, a marimba, a pizzicato bass, a tuba, a toy trumpet, a reed organ and a
// marching kit, plus sleigh bells for World 2's freezer and, for World 3's workshop, a
// celesta, a tick-tock woodblock, a winding ratchet and a spring 'boing' for the
// Jack-in-the-Box. Each is a few sines, a filtered saw or square, or filtered noise under
// gain envelopes; no samples. Brightness stays low on purpose: lowpassed saws, no bare
// squares, and bell partials kept short so long loops never tire the ear.
import { midiHz, noise, tone } from './dsp.ts';
import type { Kit } from './dsp.ts';

export type InstrumentId =
  | 'musicBox'
  | 'glock'
  | 'marimba'
  | 'pizz'
  | 'tuba'
  | 'trumpet'
  | 'reed'
  | 'snare'
  | 'kick'
  | 'timpani'
  | 'shaker'
  | 'cymbal'
  | 'sleighBells'
  | 'celesta'
  | 'woodblock'
  | 'ratchet'
  | 'boing';

/** Plays one note: `midi` pitch at time `t` for `dur` seconds, velocity 0..1. */
export type Instrument = (k: Kit, t: number, midi: number, vel: number, dur: number) => void;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

// Music box tine: a long sine, a soft octave and the tine's very short 6.27x mode that
// gives the 'ting'. Higher notes ring shorter, as real tines do.
const musicBox: Instrument = (k, t, m, v) => {
  const f = midiHz(m);
  const ring = 0.5 + 1.1 * clamp01(700 / f);
  tone(k, t, { f0: f, attack: 0.002, decay: ring, peak: 0.42 * v });
  tone(k, t, { f0: f * 2, attack: 0.002, decay: ring * 0.3, peak: 0.08 * v });
  if (f * 6.27 < 12000) tone(k, t, { f0: f * 6.27, attack: 0.001, decay: 0.05, peak: 0.07 * v });
};

// Glockenspiel bar: fundamental plus the bar's inharmonic 2.76x and 5.4x modes.
const glock: Instrument = (k, t, m, v) => {
  const f = midiHz(m);
  tone(k, t, { f0: f, attack: 0.001, decay: 0.9, peak: 0.36 * v });
  tone(k, t, { f0: f * 2.76, attack: 0.001, decay: 0.22, peak: 0.08 * v });
  if (f * 5.4 < 12000) tone(k, t, { f0: f * 5.4, attack: 0.001, decay: 0.06, peak: 0.04 * v });
};

// Marimba: a warm sine with the bar's tuned double-octave overtone and a felt-mallet tap.
const marimba: Instrument = (k, t, m, v) => {
  const f = midiHz(m);
  const ring = 0.22 + 0.4 * clamp01(260 / f);
  tone(k, t, { f0: f, attack: 0.003, decay: ring, peak: 0.45 * v });
  tone(k, t, { f0: f * 4, attack: 0.001, decay: 0.05, peak: 0.1 * v });
  noise(k, t, { attack: 0.001, decay: 0.012, peak: 0.04 * v, filter: { type: 'bandpass', freq: 1800, q: 1 } });
};

// Pizzicato bass: a plucked triangle whose lowpass closes as it rings, over a round sine.
const pizz: Instrument = (k, t, m, v) => {
  const f = midiHz(m);
  tone(k, t, {
    type: 'triangle',
    f0: f,
    attack: 0.004,
    decay: 0.42,
    peak: 0.5 * v,
    filter: { type: 'lowpass', freq: Math.min(4000, f * 8), freq1: f * 1.5, q: 1.5 },
  });
  tone(k, t, { f0: f, attack: 0.004, decay: 0.5, peak: 0.35 * v });
};

// Tuba: a soft saw through a low lowpass, sustained for the note, over a sine body.
const tuba: Instrument = (k, t, m, v, dur) => {
  const f = midiHz(m);
  const hold = Math.max(0, dur - 0.08);
  const filter = { type: 'lowpass' as const, freq: 520, q: 0.7 };
  tone(k, t, { type: 'sawtooth', f0: f, attack: 0.03, hold, decay: 0.1, peak: 0.2 * v, filter });
  tone(k, t, { f0: f, attack: 0.03, hold, decay: 0.12, peak: 0.35 * v });
};

// Toy trumpet: two slightly detuned saws, a lowpass that opens on the attack and a
// gentle vibrato that only comes in on held notes.
const trumpet: Instrument = (k, t, m, v, dur) => {
  const f = midiHz(m);
  const hold = Math.max(0, dur - 0.06);
  const end = t + 0.025 + hold + 0.12;
  const g = k.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.15 * v, t + 0.025);
  g.gain.setValueAtTime(0.13 * v, t + 0.025 + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  const lp = k.ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.9;
  const bright = Math.min(3200, f * 4.5);
  lp.frequency.setValueAtTime(400, t);
  lp.frequency.linearRampToValueAtTime(bright, t + 0.03);
  lp.frequency.exponentialRampToValueAtTime(Math.min(2200, f * 2.6), t + 0.2);
  const vib = k.ctx.createOscillator();
  vib.frequency.value = 5.5;
  const depth = k.ctx.createGain();
  depth.gain.setValueAtTime(0, t);
  depth.gain.setValueAtTime(0, t + 0.18);
  depth.gain.linearRampToValueAtTime(f * 0.007, t + 0.4);
  vib.connect(depth);
  for (const d of [-4, 4]) {
    const o = k.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    o.detune.value = d;
    depth.connect(o.frequency);
    o.connect(lp);
    o.start(t);
    o.stop(end + 0.02);
  }
  vib.start(t);
  vib.stop(end + 0.02);
  lp.connect(g);
  g.connect(k.out);
};

// Reed organ (the 'pah' of the oom-pah): two detuned squares, heavily lowpassed, short.
const reed: Instrument = (k, t, m, v, dur) => {
  const f = midiHz(m);
  const hold = Math.max(0, dur * 0.6);
  const filter = { type: 'lowpass' as const, freq: 1500, q: 0.5 };
  tone(k, t, { type: 'square', f0: f, detune: -6, attack: 0.012, hold, decay: 0.08, peak: 0.05 * v, filter });
  tone(k, t, { type: 'square', f0: f, detune: 6, attack: 0.012, hold, decay: 0.08, peak: 0.05 * v, filter });
  tone(k, t, { type: 'triangle', f0: f, attack: 0.012, hold, decay: 0.1, peak: 0.08 * v });
};

// Marching snare: a band of noise for the wires, a little sizzle and a short shell tone.
const snare: Instrument = (k, t, _m, v) => {
  noise(k, t, { decay: 0.11, peak: 0.42 * v, filter: { type: 'bandpass', freq: 1900, q: 0.8 } });
  noise(k, t, { decay: 0.05, peak: 0.12 * v, filter: { type: 'highpass', freq: 5200 } });
  tone(k, t, { type: 'triangle', f0: 210, f1: 175, attack: 0.001, decay: 0.05, peak: 0.22 * v });
};

// Felt bass drum: a falling sine and a muffled thump.
const kick: Instrument = (k, t, _m, v) => {
  tone(k, t, { f0: 110, f1: 46, glide: 0.12, attack: 0.002, decay: 0.3, peak: 0.75 * v });
  noise(k, t, { decay: 0.025, peak: 0.16 * v, filter: { type: 'lowpass', freq: 500 } });
};

// Timpani: a pitched sine that sags a touch, its 1.5x and 2x modes, and a soft skin thump.
const timpani: Instrument = (k, t, m, v) => {
  const f = midiHz(m);
  tone(k, t, { f0: f, f1: f * 0.97, attack: 0.004, decay: 0.9, peak: 0.5 * v });
  tone(k, t, { f0: f * 1.5, attack: 0.004, decay: 0.4, peak: 0.13 * v });
  tone(k, t, { f0: f * 2, attack: 0.004, decay: 0.25, peak: 0.07 * v });
  noise(k, t, { decay: 0.05, peak: 0.2 * v, filter: { type: 'lowpass', freq: 320 } });
};

// Egg shaker: a soft, short band of high noise.
const shaker: Instrument = (k, t, _m, v) => {
  noise(k, t, { attack: 0.008, decay: 0.045, peak: 0.14 * v, filter: { type: 'bandpass', freq: 6500, q: 1.2 } });
};

// A soft toy cymbal: a long, quiet hiss with a short shimmer on top.
const cymbal: Instrument = (k, t, _m, v) => {
  noise(k, t, { attack: 0.002, decay: 1.1, peak: 0.07 * v, filter: { type: 'highpass', freq: 6500 } });
  noise(k, t, { attack: 0.002, decay: 0.3, peak: 0.05 * v, filter: { type: 'bandpass', freq: 3600, q: 1 } });
};

// Sleigh bells: a jingle of small bells, each a short pair of high inharmonic partials
// a few milliseconds apart, over a whisper of bright noise. Accents ring a little longer.
const sleighBells: Instrument = (k, t, _m, v) => {
  const ring = 0.08 + 0.1 * v;
  for (const [at, f] of [
    [0, 4200],
    [0.006, 5300],
    [0.013, 4750],
    [0.021, 6100],
  ]) {
    tone(k, t + at, { f0: f, attack: 0.001, decay: ring, peak: 0.035 * v });
    tone(k, t + at, { f0: f * 1.48, attack: 0.001, decay: ring * 0.5, peak: 0.015 * v });
  }
  noise(k, t, { attack: 0.002, decay: 0.06, peak: 0.06 * v, filter: { type: 'highpass', freq: 7000 } });
};

// Celesta: a struck steel plate over a wooden resonator. A round sine with a soft
// octave, a quick metallic 4x 'ping' on the attack and a gentle tremolo-free ring that
// shortens up the keyboard; brighter and rounder than the music box.
const celesta: Instrument = (k, t, m, v) => {
  const f = midiHz(m);
  const ring = 0.45 + 0.8 * clamp01(800 / f);
  tone(k, t, { f0: f, attack: 0.003, decay: ring, peak: 0.36 * v });
  tone(k, t, { f0: f * 2, attack: 0.002, decay: ring * 0.35, peak: 0.1 * v });
  if (f * 4.02 < 12000) tone(k, t, { f0: f * 4.02, attack: 0.001, decay: 0.07, peak: 0.05 * v });
  noise(k, t, { attack: 0.001, decay: 0.01, peak: 0.03 * v, filter: { type: 'bandpass', freq: 3000, q: 2 } });
};

// Woodblock (the workshop's clock ticking): a short pitched knock and a hollow click.
const woodblock: Instrument = (k, t, m, v) => {
  const f = m > 0 ? midiHz(m) : 1200;
  tone(k, t, { f0: f, f1: f * 0.92, attack: 0.001, decay: 0.045, peak: 0.34 * v });
  noise(k, t, { attack: 0.001, decay: 0.018, peak: 0.22 * v, filter: { type: 'bandpass', freq: f * 1.6, q: 5 } });
};

// Ratchet (a key being wound): a run of tight clicks over the note's length, each a
// narrow band of noise and a tiny knock, the clicks speeding up a little as it winds.
const ratchet: Instrument = (k, t, _m, v, dur) => {
  const span = Math.max(0.1, dur);
  let at = 0;
  for (let i = 0; i < 24 && at < span; i++) {
    noise(k, t + at, {
      attack: 0.001,
      decay: 0.014,
      peak: (0.22 + 0.06 * (i % 2)) * v,
      filter: { type: 'bandpass', freq: 2600 + (i % 3) * 300, q: 7 },
    });
    tone(k, t + at, { f0: 900 + (i % 2) * 140, attack: 0.001, decay: 0.012, peak: 0.05 * v });
    at += Math.max(0.035, 0.07 - i * 0.003);
  }
};

// Spring 'boing' (the jester popping up): a sine that leaps a fifth up and wobbles there
// with a fast vibrato as it dies away, over a soft wooden knock.
const boing: Instrument = (k, t, m, v) => {
  const f = midiHz(m);
  tone(k, t, {
    f0: f,
    f1: f * 1.5,
    glide: 0.05,
    attack: 0.004,
    decay: 0.5,
    peak: 0.3 * v,
    vibrato: { rate: 14, depth: f * 0.06 },
  });
  tone(k, t, { type: 'triangle', f0: f * 2, f1: f * 1.4, glide: 0.35, attack: 0.004, decay: 0.3, peak: 0.06 * v });
  noise(k, t, { attack: 0.001, decay: 0.03, peak: 0.12 * v, filter: { type: 'bandpass', freq: 900, q: 2 } });
};

export const INSTRUMENTS: Readonly<Record<InstrumentId, Instrument>> = {
  musicBox,
  glock,
  marimba,
  pizz,
  tuba,
  trumpet,
  reed,
  snare,
  kick,
  timpani,
  shaker,
  cymbal,
  sleighBells,
  celesta,
  woodblock,
  ratchet,
  boing,
};
