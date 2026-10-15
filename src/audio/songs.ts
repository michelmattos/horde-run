// The game's background music, written as data: a chord progression per song, a
// melody in note names, and parts generated from the chords (bass, oom-pah, broken
// chords) and from 16th-note drum grids. Pure, so the scheduler and tests can read it
// in Node. One loop per kind of screen, and World 2 has its own battle and boss songs:
//  - menu: a calm music-box tune in F major over marimba and pizzicato bass (92 bpm);
//  - battle: a tin-soldier march in C major, toy trumpet over tuba and snare (120 bpm);
//  - boss: the same band in A minor, faster, with timpani and a driving bass (132 bpm);
//  - battle2: World 2's freezer, a glockenspiel and music-box tune in E minor over sleigh
//    bells and marimba (116 bpm);
//  - boss2: the Snow Globe Giant, D minor with sleigh bells driving the timpani (132 bpm);
//  - battle3: World 3's clockwork workshop, a celesta tune in G major over a tick-tock
//    woodblock, winding ratchets, off-beat marimba and a bouncy pizzicato bass (126 bpm);
//  - boss3: the Jack-in-the-Box, C minor and faster: a hook that winds up note by note,
//    stops dead, then pops an octave up with a spring 'boing' and a cymbal (138 bpm).
// Every bar of a melody must add up to a full bar; that is checked when the module loads,
// so a typo fails loudly.
import type { InstrumentId } from './instruments.ts';

export type MusicId = 'menu' | 'battle' | 'boss' | 'battle2' | 'boss2' | 'battle3' | 'boss3';

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

// ---------- World 2 battle: 'Frost on the Glass' (E minor, 116 bpm) ----------

function freezerSong(): Song {
  const bpb = 4;
  const bars = 16;
  const chords = progression('Em | C | G | D | Em | Am | B7 | Em | C | G | D | Em | C | D | B7 | Em', bpb);
  const a =
    'E5:2 G5:2 B5:3 A5:1 | G5:2 E5:2 C5:4 | D5:2 G5:2 B5:2 D6:2 | C6:2 A5:2 F#5:4 |' +
    ' E5:1 F#5:1 G5:2 B5:2 E6:2 | C6:2 B5:1 A5:1 E5:4 | D#5:2 F#5:2 A5:2 F#5:2 | E5:6 r:2';
  const b =
    'G5:1 A5:1 G5:1 E5:1 C5:4 | B4:1 D5:1 G5:2 B5:4 | A5:1 B5:1 A5:1 F#5:1 D5:4 | E5:2 G5:2 B5:4 |' +
    ' C6:3 B5:1 G5:2 E5:2 | D6:3 C6:1 A5:2 F#5:2 | B5:2 A5:2 F#5:2 D#5:2 | E5:4 r:4';
  const tune = melody(`${a} | ${b}`, bpb);
  // The music box doubles the tune an octave down in the second half.
  const under = shift(melody(b, bpb, 0.5, -12), 8 * bpb);
  // Broken chords on the marimba: root, third, fifth, third, up and down every half bar.
  const arp: Step[] = [0, 1, 2, 1, 0, 1, 2, 1].map((idx, i) => ({
    at: i * 0.5,
    dur: 0.5,
    vel: i % 4 === 0 ? 0.75 : 0.5,
    pick: (c: Chord) => [voicing(c, 52)[idx]],
  }));
  const bass: Step[] = [
    { at: 0, dur: 1, vel: 1, pick: (c) => [lift(c.root, 36)] },
    { at: 1.5, dur: 0.5, vel: 0.6, pick: (c) => [lift(c.root, 36) + 7] },
    { at: 2, dur: 1, vel: 0.7, pick: (c) => [lift(c.root, 36) + 12] },
  ];
  return {
    id: 'battle2',
    bpm: 116,
    beatsPerBar: bpb,
    bars,
    parts: [
      { inst: 'glock', gain: 0.9, pan: 0.1, send: 0.35, notes: tune },
      { inst: 'musicBox', gain: 0.55, pan: -0.1, send: 0.35, notes: under },
      { inst: 'marimba', gain: 0.75, pan: -0.25, send: 0.2, notes: perBar(chords, bars, bpb, arp) },
      { inst: 'pizz', gain: 0.4, send: 0.08, notes: perBar(chords, bars, bpb, bass) },
      {
        inst: 'sleighBells',
        gain: 0.45,
        pan: 0.3,
        send: 0.2,
        notes: drums(bars, (bar) => (bar % 4 === 3 ? 'X.x.X.x.XxXxXxXx' : 'X.x.X.x.X.x.X.x.')),
      },
      { inst: 'snare', gain: 0.3, pan: -0.1, send: 0.12, notes: drums(bars, () => '....X.......X...') },
      { inst: 'kick', gain: 0.22, notes: drums(bars, () => 'X.......x.......') },
      { inst: 'cymbal', gain: 0.45, pan: 0.2, send: 0.25, notes: drums(bars, (bar) => (bar % 8 === 0 ? 'X' : '')) },
    ],
  };
}

// ---------- World 2 boss: 'The Snow Globe Giant' (D minor, 132 bpm) ----------

function snowGiantSong(): Song {
  const bpb = 4;
  const bars = 16;
  const chords = progression('Dm | Dm | Bb | A | Dm | Gm | A | A | Bb | C | F | Dm | Gm | Dm | A | A', bpb);
  const a =
    'D5:3 F5:1 A5:2 D6:2 | C6:1 A5:1 F5:2 D5:2 A4:2 | Bb4:3 D5:1 F5:2 Bb5:2 | A5:2 C#5:2 E5:4 |' +
    ' D6:3 C6:1 A5:2 F5:2 | G5:3 A5:1 Bb5:2 D6:2 | C#6:2 A5:2 E5:2 C#5:2 | A5:4 r:2 A4:1 C#5:1';
  const b =
    'D6:2 F6:2 D6:2 Bb5:2 | E6:2 G6:2 E6:2 C6:2 | C6:2 A5:2 F6:4 | D6:3 E6:1 F6:2 D6:2 |' +
    ' G6:2 F6:1 E6:1 D6:2 Bb5:2 | A5:2 D6:2 F6:2 D6:2 | E6:2 C#6:2 A5:2 C#6:2 | E6:2 D6:1 C#6:1 A5:4';
  // The trumpet takes the first half as written and the second two octaves down, under the
  // glockenspiel's high line.
  const lead = [...melody(a, bpb), ...shift(melody(b, bpb, 0.5, -24), 8 * bpb)];
  const bell = shift(melody(b, bpb, 0.5, -12), 8 * bpb);
  const drive: Step[] = [0, 0, 12, 0, 0, 0, 12, 0].map((up, i) => ({
    at: i * 0.5,
    dur: 0.45,
    vel: i % 2 === 0 ? 1 : 0.7,
    pick: (c: Chord) => [lift(c.root, 38) + up],
  }));
  const boom: Step[] = [
    { at: 0, dur: 1, vel: 1, pick: (c) => [lift(c.root, 38)] },
    { at: 2.5, dur: 1, vel: 0.7, pick: (c) => [lift(c.root, 38) + 7] },
  ];
  const stabs: Step[] = [1, 3].map((at) => ({ at, dur: 0.4, vel: 0.8, pick: (c: Chord) => voicing(c, 62) }));
  return {
    id: 'boss2',
    bpm: 132,
    beatsPerBar: bpb,
    bars,
    parts: [
      { inst: 'trumpet', gain: 0.85, pan: 0.05, send: 0.25, notes: lead },
      { inst: 'glock', gain: 0.5, pan: 0.25, send: 0.35, notes: bell },
      { inst: 'pizz', gain: 0.7, send: 0.05, notes: perBar(chords, bars, bpb, drive) },
      { inst: 'marimba', gain: 0.35, pan: -0.25, send: 0.15, notes: perBar(chords, bars, bpb, stabs) },
      { inst: 'timpani', gain: 0.8, send: 0.15, notes: perBar(chords, bars, bpb, boom) },
      { inst: 'sleighBells', gain: 0.65, pan: 0.3, send: 0.2, notes: drums(bars, () => 'XxXxXxXxXxXxXxXx', 0, 0.45) },
      {
        inst: 'snare',
        gain: 0.4,
        pan: -0.1,
        send: 0.12,
        notes: drums(bars, (bar) => (bar % 8 === 7 ? '....X...xxxxXxxx' : '....X.......X..x')),
      },
      { inst: 'cymbal', gain: 0.5, pan: 0.2, send: 0.2, notes: drums(bars, (bar) => (bar % 8 === 0 ? 'X' : '')) },
    ],
  };
}

// ---------- World 3 battle: 'The Clockwork Workshop' (G major, 126 bpm) ----------

// One note per listed bar at beat `at` (a ratchet winding over the end of a phrase).
function perListedBar(bars: readonly number[], at: number, dur: number, vel: number, midi = 0): Note[] {
  return bars.map((b) => ({ at: b * 4 + at, dur, midi, vel }));
}

function workshopSong(): Song {
  const bpb = 4;
  const bars = 16;
  const chords = progression('G | D | Em | C | G | D | C D | G | C | G | Am | D | Em | C | Am D | G', bpb);
  const a =
    'D5:1 G5:1 B5:1 G5:1 D6:2 B5:2 | A5:1 F#5:1 D5:1 F#5:1 A5:2 D6:2 | G5:1 E5:1 B4:1 E5:1 G5:2 B5:2 |' +
    ' C6:1 B5:1 A5:1 G5:1 E5:2 C5:2 | D5:1 G5:1 B5:1 D6:1 G6:2 D6:2 | F#6:1 E6:1 D6:1 A5:1 F#5:2 A5:2 |' +
    ' E5:1 G5:1 C6:2 D5:1 F#5:1 A5:2 | G5:4 r:2 D5:1 D5:1';
  const b =
    'E5:2 G5:1 E5:1 C6:2 E5:2 | D5:2 G5:1 D5:1 B5:2 G5:2 | C6:1 B5:1 A5:1 G5:1 A5:1 E5:1 C5:2 |' +
    ' D5:1 E5:1 F#5:1 G5:1 A5:2 r:2 | B5:1 A5:1 G5:1 A5:1 B5:2 E6:2 | E6:1 D6:1 C6:1 B5:1 A5:2 G5:2 |' +
    ' A5:1 C6:1 E6:1 C6:1 D6:1 C6:1 B5:1 A5:1 | G5:2 D5:2 G5:2 r:2';
  const tune = melody(`${a} | ${b}`, bpb);
  // The music box answers the second half an octave down.
  const under = shift(melody(b, bpb, 0.5, -12), 8 * bpb);
  // Off-beat marimba chords: the toy factory's little hammers.
  const tink: Step[] = [0.5, 1.5, 2.5, 3.5].map((at, i) => ({
    at,
    dur: 0.25,
    vel: i % 2 === 0 ? 0.6 : 0.45,
    pick: (c: Chord) => voicing(c, 59),
  }));
  // A bouncy bass: root, octave and fifth hopping on the eighths.
  const bounce: Step[] = [
    { at: 0, dur: 0.4, vel: 1, pick: (c) => [lift(c.root, 38)] },
    { at: 1, dur: 0.35, vel: 0.7, pick: (c) => [lift(c.root, 38) + 12] },
    { at: 1.5, dur: 0.35, vel: 0.6, pick: (c) => [lift(c.root, 38) + 7] },
    { at: 2, dur: 0.4, vel: 0.9, pick: (c) => [lift(c.root, 38)] },
    { at: 3, dur: 0.35, vel: 0.7, pick: (c) => [lift(c.root, 38) + 12] },
    { at: 3.5, dur: 0.35, vel: 0.6, pick: (c) => [lift(c.root, 38) + 7] },
  ];
  return {
    id: 'battle3',
    bpm: 126,
    beatsPerBar: bpb,
    bars,
    parts: [
      { inst: 'celesta', gain: 0.85, pan: 0.1, send: 0.3, notes: tune },
      { inst: 'musicBox', gain: 0.42, pan: -0.15, send: 0.35, notes: under },
      { inst: 'marimba', gain: 0.4, pan: -0.25, send: 0.15, notes: perBar(chords, bars, bpb, tink) },
      { inst: 'pizz', gain: 0.55, send: 0.06, notes: perBar(chords, bars, bpb, bounce) },
      // Tick (D6) on the beat, tock (G5) on the off-beat: the workshop clock.
      {
        inst: 'woodblock',
        gain: 0.36,
        pan: 0.3,
        send: 0.1,
        notes: drums(bars, () => 'X.......x.......', noteMidi('D6')),
      },
      {
        inst: 'woodblock',
        gain: 0.3,
        pan: -0.3,
        send: 0.1,
        notes: drums(bars, (bar) => (bar % 4 === 3 ? '....x.......xxxx' : '....x.......x...'), noteMidi('G5')),
      },
      { inst: 'ratchet', gain: 0.36, pan: 0.2, send: 0.12, notes: perListedBar([3, 7, 11, 15], 3, 1, 0.8) },
      { inst: 'kick', gain: 0.25, notes: drums(bars, () => 'X.......X.......') },
      { inst: 'snare', gain: 0.16, pan: -0.1, send: 0.12, notes: drums(bars, () => '....x.......x...') },
      { inst: 'cymbal', gain: 0.32, pan: 0.2, send: 0.25, notes: drums(bars, (bar) => (bar % 8 === 0 ? 'X' : '')) },
    ],
  };
}

// ---------- World 3 boss: 'Pop Goes the Jack' (C minor, 138 bpm) ----------
// The hook winds up a scale like a turning crank, holds its breath on a rest, then pops an
// octave up (the jester springing out), with a 'boing', a glockenspiel and a cymbal on
// every pop. Written for this game; only the idea of a wind-up and a pop is borrowed.

function jackSong(): Song {
  const bpb = 4;
  const bars = 16;
  const chords = progression('Cm | Cm | Ab | G | Cm | Fm | G | G | Ab | Bb | Eb | Cm | Fm | Cm | G | G', bpb);
  const a =
    'C5:1 D5:1 Eb5:1 F5:1 G5:1 F5:1 Eb5:1 D5:1 | C5:1 D5:1 Eb5:1 F5:1 G5:3 r:1 | C6:2 r:2 Ab5:1 G5:1 F5:1 Eb5:1 |' +
    ' D5:2 F5:2 G5:2 B4:2 | C5:1 D5:1 Eb5:1 F5:1 G5:1 F5:1 Eb5:1 D5:1 | C5:1 D5:1 Eb5:1 F5:1 Ab5:3 r:1 |' +
    ' D6:2 r:2 B5:1 G5:1 F5:1 D5:1 | G5:4 r:2 G4:1 B4:1';
  const b =
    'C6:2 Ab5:2 Eb5:2 C5:2 | D6:2 Bb5:2 F5:2 D5:2 | Eb6:3 D6:1 Bb5:2 G5:2 | C6:2 G5:1 Eb5:1 C5:4 |' +
    ' F5:1 G5:1 Ab5:1 C6:1 F6:2 C6:2 | Eb6:1 D6:1 C6:1 G5:1 Eb5:2 C5:2 |' +
    ' B4:1 C5:1 D5:1 Eb5:1 F5:1 G5:1 Ab5:1 B5:1 | D6:3 r:1 G5:2 r:2';
  const tune = melody(`${a} | ${b}`, bpb);
  // The trumpet doubles the second half an octave down: the brass gets in on the chase.
  const brass = shift(melody(b, bpb, 0.5, -12), 8 * bpb);
  // The pops: bar 3 (C6), bar 7 (D6) and bar 16 (D6), each on the downbeat.
  const pops = [
    { bar: 2, midi: noteMidi('C5') },
    { bar: 6, midi: noteMidi('D5') },
    { bar: 15, midi: noteMidi('D5') },
  ];
  const boing: Note[] = pops.map((p) => ({ at: p.bar * bpb, dur: 1, midi: p.midi, vel: 1 }));
  const sparkle: Note[] = pops.flatMap((p) => [
    { at: p.bar * bpb, dur: 1, midi: p.midi + 24, vel: 1 },
    { at: p.bar * bpb + 0.25, dur: 1, midi: p.midi + 29, vel: 0.7 },
  ]);
  // The crank turns through the rest before each pop (and through the climb into the last).
  const crank: Note[] = [
    { at: 1 * bpb + 2, dur: 2, midi: 0, vel: 0.9 },
    { at: 5 * bpb + 2, dur: 2, midi: 0, vel: 0.9 },
    { at: 14 * bpb, dur: 4, midi: 0, vel: 0.8 },
  ];
  const drive: Step[] = [0, 0, 12, 0, 0, 0, 12, 7].map((up, i) => ({
    at: i * 0.5,
    dur: 0.42,
    vel: i % 2 === 0 ? 1 : 0.7,
    pick: (c: Chord) => [lift(c.root, 36) + up],
  }));
  const stabs: Step[] = [1.5, 3.5].map((at) => ({ at, dur: 0.3, vel: 0.8, pick: (c: Chord) => voicing(c, 60) }));
  const boom: Step[] = [
    { at: 0, dur: 1, vel: 1, pick: (c) => [lift(c.root, 36)] },
    { at: 2, dur: 1, vel: 0.7, pick: (c) => [lift(c.root, 36) + 7] },
  ];
  const popBars = new Set(pops.map((p) => p.bar));
  return {
    id: 'boss3',
    bpm: 138,
    beatsPerBar: bpb,
    bars,
    parts: [
      { inst: 'celesta', gain: 1, pan: 0.1, send: 0.28, notes: tune },
      { inst: 'trumpet', gain: 0.7, pan: -0.05, send: 0.25, notes: brass },
      { inst: 'glock', gain: 0.5, pan: 0.25, send: 0.35, notes: sparkle },
      { inst: 'boing', gain: 0.8, send: 0.2, notes: boing },
      { inst: 'pizz', gain: 0.62, send: 0.05, notes: perBar(chords, bars, bpb, drive) },
      { inst: 'reed', gain: 0.5, pan: -0.25, send: 0.15, notes: perBar(chords, bars, bpb, stabs) },
      { inst: 'timpani', gain: 0.66, send: 0.15, notes: perBar(chords, bars, bpb, boom) },
      // A faster clock: tick (C6) and tock (G5) on every eighth.
      {
        inst: 'woodblock',
        gain: 0.37,
        pan: 0.3,
        send: 0.08,
        notes: drums(bars, () => 'X...x...X...x...', noteMidi('C6')),
      },
      {
        inst: 'woodblock',
        gain: 0.32,
        pan: -0.3,
        send: 0.08,
        notes: drums(bars, () => '..x...x...x...x.', noteMidi('G5')),
      },
      { inst: 'ratchet', gain: 0.55, pan: 0.2, send: 0.12, notes: crank },
      {
        inst: 'snare',
        gain: 0.38,
        pan: -0.1,
        send: 0.12,
        notes: drums(bars, (bar) => (bar % 8 === 7 ? '....X...xxxxXxxx' : '....X.......X..x')),
      },
      {
        inst: 'cymbal',
        gain: 0.55,
        pan: 0.2,
        send: 0.2,
        notes: drums(bars, (bar) => (bar % 8 === 0 || popBars.has(bar) ? 'X' : '')),
      },
    ],
  };
}

export const SONGS: Readonly<Record<MusicId, Song>> = {
  menu: menuSong(),
  battle: battleSong(),
  boss: bossSong(),
  battle2: freezerSong(),
  boss2: snowGiantSong(),
  battle3: workshopSong(),
  boss3: jackSong(),
};

/** Loop length in seconds. */
export function songSeconds(s: Song): number {
  return (s.bars * s.beatsPerBar * 60) / s.bpm;
}
