// Building blocks every synthesized sound and instrument shares: gain envelopes,
// filtered oscillators and filtered noise, written into any BaseAudioContext so the
// same code plays live or pre-renders into an AudioBuffer (OfflineAudioContext).

export interface Kit {
  ctx: BaseAudioContext;
  out: AudioNode;
  noise: AudioBuffer;
}

export const QUIET = 0.0001;

/** Frequency in Hz of a MIDI note number (69 = A4 = 440 Hz). */
export function midiHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

// Gain envelope: silent, linear rise to `peak`, hold, then an exponential tail.
export function env(g: AudioParam, t: number, attack: number, peak: number, decay: number, hold = 0): number {
  g.setValueAtTime(QUIET, t);
  g.linearRampToValueAtTime(Math.max(QUIET, peak), t + attack);
  if (hold > 0) g.setValueAtTime(Math.max(QUIET, peak), t + attack + hold);
  const end = t + attack + hold + decay;
  g.exponentialRampToValueAtTime(QUIET, end);
  return end;
}

export interface FilterOpts {
  type: BiquadFilterType;
  freq: number;
  freq1?: number; // swept to this by the end of the sound
  q?: number;
}

export function filtered(k: Kit, src: AudioNode, f: FilterOpts | undefined, t: number, end: number): AudioNode {
  if (!f) return src;
  const b = k.ctx.createBiquadFilter();
  b.type = f.type;
  b.frequency.setValueAtTime(f.freq, t);
  if (f.freq1) b.frequency.exponentialRampToValueAtTime(f.freq1, end);
  if (f.q !== undefined) b.Q.value = f.q;
  src.connect(b);
  return b;
}

export interface ToneOpts {
  type?: OscillatorType;
  f0: number;
  f1?: number; // glide target
  glide?: number; // glide time (default: the whole sound)
  attack?: number;
  hold?: number;
  decay: number;
  peak: number;
  filter?: FilterOpts;
  vibrato?: { rate: number; depth: number; delay?: number }; // Hz, Hz, seconds before it fades in
  detune?: number; // cents
}

export function tone(k: Kit, t: number, o: ToneOpts): void {
  const attack = o.attack ?? 0.004;
  const osc = k.ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.f0, t);
  if (o.detune) osc.detune.value = o.detune;
  const g = k.ctx.createGain();
  const end = env(g.gain, t, attack, o.peak, o.decay, o.hold);
  if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t + (o.glide ?? end - t));
  if (o.vibrato) {
    const lfo = k.ctx.createOscillator();
    lfo.frequency.value = o.vibrato.rate;
    const depth = k.ctx.createGain();
    const delay = o.vibrato.delay ?? 0;
    if (delay > 0) {
      depth.gain.setValueAtTime(0, t);
      depth.gain.linearRampToValueAtTime(o.vibrato.depth, t + delay);
    } else {
      depth.gain.value = o.vibrato.depth;
    }
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

export interface NoiseOpts {
  attack?: number;
  hold?: number;
  decay: number;
  peak: number;
  filter: FilterOpts;
  tremolo?: { rate: number; depth: number }; // Hz, 0..1
}

export function noise(k: Kit, t: number, o: NoiseOpts): void {
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

/** One second of white noise, made once and shared by every recipe and instrument. */
export function makeNoise(ctx: BaseAudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/**
 * A small-room reverb impulse: stereo noise under an exponential decay, darkening as it
 * fades (a one-pole lowpass whose cutoff falls with time), with a short pre-delay.
 * Generated, so it costs no download; `seconds` is the time to fall 60 dB.
 */
export function makeReverbImpulse(ctx: BaseAudioContext, seconds = 1.8): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.ceil(rate * seconds);
  const pre = Math.floor(rate * 0.012);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const x = (i - pre) / (len - pre);
      const decay = Math.pow(0.001, x); // -60 dB at the end
      const cut = 0.55 - 0.45 * x; // brighter early reflections, duller tail
      lp += cut * (Math.random() * 2 - 1 - lp);
      d[i] = lp * decay * 0.6;
    }
  }
  return buf;
}
