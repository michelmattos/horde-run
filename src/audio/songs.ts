// The game's background music, written as data: a chord progression per song, a
// melody in note names, and parts generated from the chords (bass, oom-pah, broken
// chords) and from 16th-note drum grids. Pure, so the scheduler and tests can read it
// in Node. Three loops, one per kind of screen:
//  - menu: a calm music-box tune in F major over marimba and pizzicato bass (92 bpm);
//  - battle: a tin-soldier march in C major, toy trumpet over tuba and snare (120 bpm);
//  - boss: the same band in A minor, faster, with timpani and a driving bass (132 bpm).
// Every bar of a melody must add up to a full bar; that is checked when the module loads,
// so a typo fails loudly.
import type { InstrumentId } from './instruments.ts';

export type MusicId = 'menu' | 'battle' | 'boss';

export interface Note {
  at: number; // beats from the start of the loop
  dur: number; // beats
  midi: number; // 0 for unpitched drums
  vel: number; // 0..1
}

export interface Part {
  inst: InstrumentId;
  gain: number; // part level before the music volume
  pan?: number; // -1..1
  send?: number; // reverb send 0..1
  notes: Note[];
}

export interface Song {
  id: MusicId;
  bpm: number;
  beatsPerBar: number;
  bars: number;
  parts: Part[];
}

const PITCH: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** MIDI number of a note name like 'C4', 'Bb5' or 'G#3' (C4 = 60). */
export function noteMidi(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note '${name}'`);
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + PITCH[m[1]] + acc;
}

/**
 * A melody line: bars split by '|', tokens 'Name:count' or 'r:count' (rest), counts in
 * `unit` beats (0.5 = eighths). Notes on a beat get full velocity, the rest a little less.
 * Throws when a bar does not add up to `beatsPerBar`.
 */
export function melody(text: string, beatsPerBar: number, unit = 0.5, transpose = 0): Note[] {
  const notes: Note[] = [];
  const bars = text.split('|');
  bars.forEach((bar, b) => {
    let at = b * beatsPerBar;
    for (const tok of bar.trim().split(/\s+/)) {
      const [name, count] = tok.split(':');
      const dur = Number(count) * unit;
      if (!(dur > 0)) throw new Error(`bad length in '${tok}'`);
      if (name !== 'r') {
        const onBeat = Math.abs(at - Math.round(at)) < 1e-6;
        notes.push({ at, dur, midi: noteMidi(name) + transpose, vel: onBeat ? 1 : 0.85 });
      }
      at += dur;
    }
    const used = at - b * beatsPerBar;
    if (Math.abs(used - beatsPerBar) > 1e-6) throw new Error(`bar ${b + 1} of '${text}' has ${used} beats`);
  });
  return notes;
}

export interface Chord {
  at: number; // beats from the start of the loop
  dur: number;
  root: number; // pitch class 0..11
  tones: number[]; // pitch classes, root first
}

/** 'F', 'Dm', 'Bb', 'G7', 'E' as pitch classes. */
export function chordTones(name: string): number[] {
  const m = /^([A-G][#b]?)(m|7)?$/.exec(name);
  if (!m) throw new Error(`bad chord '${name}'`);
  const root = (((noteMidi(`${m[1]}4`) - 60) % 12) + 12) % 12;
  const third = m[2] === 'm' ? 3 : 4;
  const tones = [root, (root + third) % 12, (root + 7) % 12];
  if (m[2] === '7') tones.push((root + 10) % 12);
  return tones;
}

/** A progression: bars split by '|', one or more chords per bar sharing it evenly. */
export function progression(text: string, beatsPerBar: number): Chord[] {
  const out: Chord[] = [];
  text.split('|').forEach((bar, b) => {
    const names = bar.trim().split(/\s+/);
    const dur = beatsPerBar / names.length;
    names.forEach((n, i) => {
      const tones = chordTones(n);
      out.push({ at: b * beatsPerBar + i * dur, dur, root: tones[0], tones });
    });
  });
  return out;
}

/** The same notes `beats` later. */
function shift(notes: readonly Note[], beats: number): Note[] {
  return notes.map((n) => ({ ...n, at: n.at + beats }));
}

/** The chord sounding at `beat`. */
function chordAt(chords: readonly Chord[], beat: number): Chord {
  for (let i = chords.length - 1; i >= 0; i--) if (chords[i].at <= beat + 1e-6) return chords[i];
  return chords[0];
}

/** Lowest MIDI note at or above `low` with pitch class `pc`. */
export function lift(pc: number, low: number): number {
  return low + ((((pc - low) % 12) + 12) % 12);
}

/** The chord's tones as close-position MIDI notes from `low` upward (triads only). */
function voicing(c: Chord, low: number): number[] {
  return c.tones
    .slice(0, 3)
    .map((pc) => lift(pc, low))
    .sort((a, b) => a - b);
}

interface Step {
  at: number; // beat within the bar
  dur: number;
  vel: number;
  pick(c: Chord): number[]; // MIDI notes for the chord sounding then
}

/** Repeats `steps` in every bar, each step picking its notes from the chord sounding then. */
function perBar(chords: readonly Chord[], bars: number, beatsPerBar: number, steps: readonly Step[]): Note[] {
  const notes: Note[] = [];
  for (let b = 0; b < bars; b++) {
    for (const s of steps) {
      const at = b * beatsPerBar + s.at;
      for (const midi of s.pick(chordAt(chords, at))) notes.push({ at, dur: s.dur, midi, vel: s.vel });
    }
  }
  return notes;
}

/**
 * A drum line from 16th-note grids, one string per bar ('X' accent, 'x' soft, '.' rest);
 * `gridFor(bar)` picks the grid so fills can land on phrase ends.
 */
function drums(bars: number, gridFor: (bar: number) => string, midi = 0, soft = 0.55): Note[] {
  const notes: Note[] = [];
  for (let b = 0; b < bars; b++) {
    const grid = gridFor(b);
    for (let i = 0; i < grid.length; i++) {
      const ch = grid[i];
      if (ch === '.') continue;
      notes.push({ at: b * 4 + i * 0.25, dur: 0.25, midi, vel: ch === 'X' ? 1 : soft });
    }
  }
  return notes;
}

// ---------- Menu: 'Toy Box' (F major, 92 bpm) ----------

function menuSong(): Song {
  const bpb = 4;
  const bars = 16;
  const chords = progression('F | C | Dm | Bb | F | C | Bb C | F | Bb | F | Gm | C | Am | Dm | Gm C | F', bpb);
  const tune = melody(
    'C5:1 F5:1 A5:2 G5:1 F5:1 C5:2 | E5:1 G5:1 C6:2 Bb5:1 G5:1 E5:2 | F5:1 A5:1 D6:2 C6:1 A5:1 F5:2 |' +
      ' D5:2 F5:2 Bb5:3 r:1 | A5:1 G5:1 F5:1 A5:1 C6:2 A5:2 | G5:1 F5:1 E5:1 G5:1 C6:2 G5:2 |' +
      ' F5:1 G5:1 A5:1 Bb5:1 G5:2 E5:2 | F5:6 r:2 |' +
      ' D6:2 C6:1 Bb5:1 F5:4 | C6:2 A5:1 F5:1 C5:4 | Bb5:1 A5:1 G5:1 D5:1 G5:2 Bb5:2 | C6:3 Bb5:1 G5:2 E5:2 |' +
      ' E5:1 A5:1 C6:2 A5:2 E5:2 | F5:1 A5:1 D6:2 A5:2 F5:2 | G5:1 Bb5:1 D6:1 C6:1 Bb5:1 A5:1 G5:1 E5:1 | F5:4 r:4',
    bpb,
    0.5,
    -12,
  );
  // Rolling broken chords: root, fifth, octave, fifth, third, fifth, octave, fifth.
  const roll = [0, 2, 3, 2, 1, 2, 3, 2];
  const arp: Step[] = roll.map((idx, i) => ({
    at: i * 0.5,
    dur: 0.5,
    vel: i % 2 === 0 ? 0.7 : 0.5,
    pick: (c) => {
      const v = voicing(c, 53);
      return [[v[0], v[1], v[2], v[0] + 12][idx]];
    },
  }));
  const bass: Step[] = [
    { at: 0, dur: 1, vel: 1, pick: (c) => [lift(c.root, 36)] },
    { at: 2, dur: 1, vel: 0.8, pick: (c) => [lift(c.root, 36) + 7] },
  ];
  return {
    id: 'menu',
    bpm: 92,
    beatsPerBar: bpb,
    bars,
    parts: [
      { inst: 'musicBox', gain: 1.25, pan: 0.1, send: 0.35, notes: tune },
      { inst: 'marimba', gain: 0.7, pan: -0.2, send: 0.2, notes: perBar(chords, bars, bpb, arp) },
      { inst: 'pizz', gain: 1, send: 0.1, notes: perBar(chords, bars, bpb, bass) },
      {
        inst: 'shaker',
        gain: 0.5,
        pan: 0.3,
        send: 0.1,
        notes: drums(bars, (b) => (b < 8 ? '..x...x...x...x.' : 'x.X.x.X.x.X.x.X.')),
      },
    ],
  };
}

// ---------- Battle: 'Tin Soldier March' (C major, 120 bpm) ----------

function battleSong(): Song {
  const bpb = 4;
  const bars = 16;
  const chords = progression('C | F | G7 | C | C | F | G7 | C | F | C | G7 | C | Am | F | G7 | C', bpb);
  const a =
    'G4:1.5 G4:0.5 C5:2 E5:2 C5:2 | F5:2 E5:1 D5:1 C5:2 A4:2 | B4:1.5 B4:0.5 D5:2 G5:2 F5:1 E5:1 |' +
    ' E5:2 C5:2 G4:2 r:2 | G4:1.5 G4:0.5 C5:2 E5:2 G5:2 | A5:1.5 G5:0.5 F5:2 C5:2 A4:2 |' +
    ' G5:1 F5:1 E5:1 D5:1 B4:2 D5:2 | C5:4 r:4';
  const b =
    'A4:1 C5:1 F5:2 F5:1 E5:1 F5:2 | G5:2 E5:2 C5:2 E5:2 | D5:1 E5:1 F5:2 D5:2 B4:2 | C5:2 E5:2 G5:4 |' +
    ' A5:1.5 A5:0.5 G5:1 E5:1 C5:2 E5:2 | F5:1.5 F5:0.5 E5:1 C5:1 A4:2 C5:2 |' +
    ' B4:1 C5:1 D5:1 E5:1 F5:1 E5:1 D5:1 B4:1 | C5:2 G4:2 C5:2 r:2';
  const tune = melody(`${a} | ${b}`, bpb);
  // The glockenspiel doubles the second half an octave up.
  const sparkle = shift(melody(b, bpb, 0.5, 12), 8 * bpb);
  const oom: Step[] = [
    { at: 0, dur: 0.9, vel: 1, pick: (c) => [lift(c.root, 36)] },
    { at: 2, dur: 0.9, vel: 0.85, pick: (c) => [lift(c.root, 36) + 7] },
  ];
  const pah: Step[] = [1, 3].map((at) => ({ at, dur: 0.5, vel: 0.8, pick: (c: Chord) => voicing(c, 57) }));
  const fill = (bar: number): boolean => bar % 8 === 7;
  return {
    id: 'battle',
    bpm: 120,
    beatsPerBar: bpb,
    bars,
    parts: [
      { inst: 'trumpet', gain: 0.95, pan: 0.05, send: 0.25, notes: tune },
      { inst: 'glock', gain: 0.4, pan: 0.25, send: 0.3, notes: sparkle },
      { inst: 'tuba', gain: 0.8, send: 0.05, notes: perBar(chords, bars, bpb, oom) },
      { inst: 'reed', gain: 0.6, pan: -0.25, send: 0.15, notes: perBar(chords, bars, bpb, pah) },
      {
        inst: 'snare',
        gain: 0.45,
        pan: -0.1,
        send: 0.12,
        notes: drums(bars, (bar) => (fill(bar) ? 'X.x.X.x.xxxxxxxx' : 'X..xx.x.X..xx.x.')),
      },
      { inst: 'kick', gain: 0.6, notes: drums(bars, () => 'X.......x.......') },
      { inst: 'cymbal', gain: 0.5, pan: 0.2, send: 0.2, notes: drums(bars, (bar) => (bar % 8 === 0 ? 'X' : '')) },
    ],
  };
}

// ---------- Boss: 'The Tin General' (A minor, 132 bpm) ----------

function bossSong(): Song {
  const bpb = 4;
  const bars = 16;
  const chords = progression('Am | Am | F | E | Am | Dm | E | E | F | G | C | Am | Dm | Am | E | E', bpb);
  const a =
    'A4:3 C5:1 E5:2 A5:2 | G5:1 F5:1 E5:2 C5:2 A4:2 | F5:3 E5:1 D5:2 C5:2 | B4:2 E5:2 G#5:4 |' +
    ' A5:3 G#5:1 A5:2 E5:2 | F5:3 E5:1 D5:2 A4:2 | G#4:1 A4:1 B4:1 C5:1 D5:1 C5:1 B4:2 | E5:4 r:2 E4:1 G#4:1';
  const b =
    'A5:2 C6:2 A5:2 F5:2 | B5:2 D6:2 B5:2 G5:2 | G5:2 E5:2 C6:4 | A5:3 B5:1 C6:2 A5:2 |' +
    ' D6:2 C6:1 B5:1 A5:2 F5:2 | E5:2 A5:2 C6:2 A5:2 | B5:2 G#5:2 E5:2 G#5:2 | B5:2 A5:1 G#5:1 E5:4';
  // Trumpet takes the first half as written and the second an octave down, under the glockenspiel.
  const lead = [...melody(a, bpb), ...shift(melody(b, bpb, 0.5, -12), 8 * bpb)];
  const bell = shift(melody(b, bpb), 8 * bpb);
  // Driving eighth-note bass: root, root, octave, root.
  const drive: Step[] = [0, 0, 12, 0, 0, 0, 12, 0].map((up, i) => ({
    at: i * 0.5,
    dur: 0.45,
    vel: i % 2 === 0 ? 1 : 0.7,
    pick: (c: Chord) => [lift(c.root, 38) + up],
  }));
  const stabs: Step[] = [1.5, 3].map((at) => ({ at, dur: 0.4, vel: 0.85, pick: (c: Chord) => voicing(c, 57) }));
  const boom: Step[] = [
    { at: 0, dur: 1, vel: 1, pick: (c) => [lift(c.root, 38)] },
    { at: 2, dur: 1, vel: 0.75, pick: (c) => [lift(c.root, 38)] },
  ];
  const roll: Step[] = [2, 2.5, 3, 3.5].map((at, i) => ({
    at,
    dur: 0.5,
    vel: 0.6 + i * 0.12,
    pick: (c: Chord) => [lift(c.root, 38) + (i % 2 === 0 ? 0 : 7)],
  }));
  const timpani = [
    ...perBar(chords, bars, bpb, boom).filter((n) => Math.floor(n.at / bpb) % 8 !== 7 || n.at % bpb < 2),
    ...perBar(chords, bars, bpb, roll).filter((n) => Math.floor(n.at / bpb) % 8 === 7),
  ];
  return {
    id: 'boss',
    bpm: 132,
    beatsPerBar: bpb,
    bars,
    parts: [
      { inst: 'trumpet', gain: 0.9, pan: 0.05, send: 0.25, notes: lead },
      { inst: 'glock', gain: 0.4, pan: 0.25, send: 0.3, notes: bell },
      { inst: 'pizz', gain: 0.7, send: 0.05, notes: perBar(chords, bars, bpb, drive) },
      { inst: 'reed', gain: 0.55, pan: -0.25, send: 0.15, notes: perBar(chords, bars, bpb, stabs) },
      { inst: 'timpani', gain: 0.8, send: 0.15, notes: timpani },
      {
        inst: 'snare',
        gain: 0.42,
        pan: -0.1,
        send: 0.12,
        notes: drums(bars, (bar) => (bar % 8 === 7 ? '....X...xxxxXxxx' : '....X.......X..x')),
      },
      { inst: 'cymbal', gain: 0.5, pan: 0.2, send: 0.2, notes: drums(bars, (bar) => (bar % 8 === 0 ? 'X' : '')) },
    ],
  };
}

export const SONGS: Readonly<Record<MusicId, Song>> = {
  menu: menuSong(),
  battle: battleSong(),
  boss: bossSong(),
};

/** Loop length in seconds. */
export function songSeconds(s: Song): number {
  return (s.bars * s.beatsPerBar * 60) / s.bpm;
}
