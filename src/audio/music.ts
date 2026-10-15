// Background music: a look-ahead sequencer that plays the songs in songs.ts live with
// the instruments in instruments.ts. Nothing is pre-rendered, so music costs no memory
// and no download, and a track starts the moment it is asked for.
//
// Every SCHEDULE_MS (and whenever the game calls pump()) the player schedules the notes
// that fall in the next LOOKAHEAD seconds on the AudioContext clock, so a main thread
// that stalls for less than that never makes the music stumble. A longer stall (a shader
// compile) skips the missed notes instead of playing them all at once. Songs loop
// forever; switching songs crossfades. notesBetween is pure so tests can check that
// back-to-back windows play every note exactly once across the loop seam.
import type { Kit } from './dsp.ts';
import { INSTRUMENTS } from './instruments.ts';
import { SONGS, songSeconds } from './songs.ts';
import type { MusicId, Song } from './songs.ts';

const LOOKAHEAD = 0.6; // seconds scheduled ahead of the audio clock
const SCHEDULE_MS = 120;
const START_DELAY = 0.08;

/** One note of a song in seconds from the start of its loop. */
export interface TimedNote {
  part: number;
  time: number;
  dur: number;
  midi: number;
  vel: number;
}

/** A song's notes in seconds, sorted by time, plus its loop length. */
export interface Timeline {
  length: number;
  notes: TimedNote[];
}

export function timeline(song: Song): Timeline {
  const spb = 60 / song.bpm;
  const notes: TimedNote[] = [];
  song.parts.forEach((p, part) => {
    for (const n of p.notes) notes.push({ part, time: n.at * spb, dur: n.dur * spb, midi: n.midi, vel: n.vel });
  });
  notes.sort((a, b) => a.time - b.time || a.part - b.part);
  return { length: songSeconds(song), notes };
}

/**
 * The notes starting in [from, to) seconds after the song began, the loop repeating
 * forever; each comes back with `time` on that same unwrapped clock.
 */
export function notesBetween(tl: Timeline, from: number, to: number): TimedNote[] {
  const out: TimedNote[] = [];
  if (!(to > from) || tl.notes.length === 0) return out;
  const L = tl.length;
  for (let loop = Math.floor(from / L); loop * L < to; loop++) {
    const base = loop * L;
    for (const n of tl.notes) {
      const t = base + n.time;
      if (t < from) continue;
      if (t >= to) break;
      out.push({ ...n, time: t });
    }
  }
  return out;
}

export interface MusicPlayer {
  /** Crossfades to `id` (null = silence). Asking for the song already playing does nothing. */
  play(id: MusicId | null, opts?: { fadeIn?: number; fadeOut?: number; delay?: number }): void;
  readonly current: MusicId | null;
  /** Schedules what is due (the next `ahead` seconds); also runs on its own timer while a song plays. */
  pump(ahead?: number): void;
  dispose(): void;
}

interface Playing {
  id: MusicId;
  tl: Timeline;
  start: number; // context time of the song's beat 0
  cursor: number; // song seconds scheduled so far
  buses: GainNode[]; // dry, then the reverb send when there is one
  kits: Kit[]; // one per part: its gain, pan and reverb send
}

/**
 * A player writing into `out` (the music bus) and `reverb` (the shared reverb input).
 * Works on a live AudioContext or, with `manual`, an OfflineAudioContext.
 */
export function createMusicPlayer(
  ctx: BaseAudioContext,
  out: AudioNode,
  reverb: AudioNode | null,
  noise: AudioBuffer,
  manual = false, // true: no timer; the caller pumps (offline renders schedule everything at once)
): MusicPlayer {
  let playing: Playing | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const startTimer = (): void => {
    if (timer === null && !manual) timer = setInterval(() => pump(), SCHEDULE_MS);
  };
  const stopTimer = (): void => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };

  function begin(id: MusicId, at: number, fadeIn: number): Playing {
    const song = SONGS[id];
    // The dry bus and the reverb send bus fade together.
    const fade = (g: GainNode): void => {
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(1, at + Math.max(0.01, fadeIn));
    };
    const bus = ctx.createGain();
    fade(bus);
    bus.connect(out);
    const wet = reverb ? ctx.createGain() : null;
    if (wet && reverb) {
      fade(wet);
      wet.connect(reverb);
    }
    const kits = song.parts.map((p): Kit => {
      const g = ctx.createGain();
      g.gain.value = p.gain;
      let tail: AudioNode = g;
      if (p.pan && typeof ctx.createStereoPanner === 'function') {
        const pan = ctx.createStereoPanner();
        pan.pan.value = p.pan;
        g.connect(pan);
        tail = pan;
      }
      tail.connect(bus);
      if (wet && p.send) {
        const s = ctx.createGain();
        s.gain.value = p.send;
        tail.connect(s);
        s.connect(wet);
      }
      return { ctx, out: g, noise };
    });
    return { id, tl: timeline(song), start: at, cursor: 0, buses: wet ? [bus, wet] : [bus], kits };
  }

  function end(p: Playing, fadeOut: number): void {
    const now = ctx.currentTime;
    for (const g of p.buses) {
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), now);
      g.gain.linearRampToValueAtTime(0.0001, now + Math.max(0.01, fadeOut));
    }
    // Notes already scheduled ring out under the fade; then the nodes go.
    setTimeout(
      () => {
        for (const k of p.kits) k.out.disconnect();
        for (const g of p.buses) g.disconnect();
      },
      (fadeOut + LOOKAHEAD + 2) * 1000,
    );
  }

  function pump(ahead = LOOKAHEAD): void {
    const p = playing;
    if (!p) return;
    const now = ctx.currentTime - p.start;
    // After a long stall, drop what was missed rather than playing it in a heap.
    if (p.cursor < now) p.cursor = Math.max(p.cursor, now);
    const to = now + ahead;
    if (to <= p.cursor) return;
    const song = SONGS[p.id];
    for (const n of notesBetween(p.tl, p.cursor, to)) {
      const inst = INSTRUMENTS[song.parts[n.part].inst];
      inst(p.kits[n.part], p.start + n.time, n.midi, n.vel, n.dur);
    }
    p.cursor = to;
  }

  return {
    play(id, o = {}) {
      if ((playing?.id ?? null) === id) return;
      if (playing) end(playing, o.fadeOut ?? 0.8);
      playing = null;
      if (id === null) {
        stopTimer();
        return;
      }
      const at = ctx.currentTime + START_DELAY + (o.delay ?? 0);
      playing = begin(id, at, o.fadeIn ?? 1.2);
      pump();
      startTimer();
    },
    get current() {
      return playing?.id ?? null;
    },
    pump,
    dispose() {
      stopTimer();
      if (playing) end(playing, 0.05);
      playing = null;
    },
  };
}
