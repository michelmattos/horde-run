// Pure sound rules: which sounds a battle frame asks for, and the throttle that keeps
// a thousand clashes from stacking into noise. No WebAudio, no DOM, so Node tests can
// drive it. Every SoundId has a rule: a minimum gap between starts, a cap on voices
// sounding at once, its length (to know when a voice is free again) and a base volume.
// Within one frame, events of the same sound collapse into one voice whose volume
// grows gently with the count and whose pan follows their mean world x.
import type { SimEvent } from '../contracts.ts';

export type SoundId =
  | 'shot'
  | 'gateGood'
  | 'gateTrap'
  | 'gateBreak'
  | 'clash'
  | 'hitEnemyBase'
  | 'hitPlayerBase'
  | 'towerShot'
  | 'defenderDown'
  | 'championLaunch'
  | 'ultimate'
  | 'blast'
  | 'bossPhase'
  | 'victory'
  | 'defeat'
  | 'tap'
  | 'coin'
  | 'unlock'
  | 'build'
  | 'upgrade';

export const SOUND_IDS: readonly SoundId[] = [
  'shot',
  'gateGood',
  'gateTrap',
  'gateBreak',
  'clash',
  'hitEnemyBase',
  'hitPlayerBase',
  'towerShot',
  'defenderDown',
  'championLaunch',
  'ultimate',
  'blast',
  'bossPhase',
  'victory',
  'defeat',
  'tap',
  'coin',
  'unlock',
  'build',
  'upgrade',
];

// The battle cue shape audio reads (a structural subset of the game's BattleCue).
export interface AudioCue {
  type: string;
  id?: string;
  count?: number;
  x?: number;
}

export interface SoundRule {
  gapMs: number; // minimum time between two starts of this sound
  voices: number; // most voices of this sound sounding at once
  durMs: number; // how long one voice sounds
  volume: number; // base volume 0..1 before the effects bus; set from measured loudness (scripts/render-audio.mjs)
}

export const SOUND_RULES: Readonly<Record<SoundId, SoundRule>> = {
  shot: { gapMs: 45, voices: 4, durMs: 90, volume: 0.75 },
  gateGood: { gapMs: 70, voices: 3, durMs: 300, volume: 0.5 },
  gateTrap: { gapMs: 90, voices: 2, durMs: 300, volume: 0.72 },
  gateBreak: { gapMs: 120, voices: 2, durMs: 700, volume: 0.65 },
  clash: { gapMs: 60, voices: 4, durMs: 140, volume: 0.7 },
  hitEnemyBase: { gapMs: 90, voices: 3, durMs: 300, volume: 0.5 },
  hitPlayerBase: { gapMs: 110, voices: 2, durMs: 300, volume: 0.55 },
  towerShot: { gapMs: 80, voices: 3, durMs: 120, volume: 1 },
  defenderDown: { gapMs: 150, voices: 2, durMs: 600, volume: 0.65 },
  championLaunch: { gapMs: 250, voices: 1, durMs: 900, volume: 1 },
  ultimate: { gapMs: 300, voices: 2, durMs: 1400, volume: 0.56 },
  blast: { gapMs: 70, voices: 4, durMs: 320, volume: 0.72 },
  bossPhase: { gapMs: 500, voices: 1, durMs: 1400, volume: 0.49 },
  victory: { gapMs: 1000, voices: 1, durMs: 1800, volume: 0.25 },
  defeat: { gapMs: 1000, voices: 1, durMs: 2000, volume: 0.42 },
  tap: { gapMs: 40, voices: 3, durMs: 60, volume: 0.9 },
  coin: { gapMs: 35, voices: 4, durMs: 260, volume: 0.34 },
  unlock: { gapMs: 300, voices: 1, durMs: 1000, volume: 0.44 },
  build: { gapMs: 200, voices: 2, durMs: 650, volume: 0.65 },
  upgrade: { gapMs: 200, voices: 2, durMs: 900, volume: 0.59 },
};

/** Per-sound throttle memory: last start time and the end time of each voice slot. */
export interface ThrottleState {
  last: Record<SoundId, number>;
  ends: Record<SoundId, Float64Array>;
}

export function createThrottleState(): ThrottleState {
  const last = {} as Record<SoundId, number>;
  const ends = {} as Record<SoundId, Float64Array>;
  for (const id of SOUND_IDS) {
    last[id] = -Infinity;
    ends[id] = new Float64Array(SOUND_RULES[id].voices).fill(-Infinity);
  }
  return { last, ends };
}

/**
 * Claims a voice of `id` at `now` (ms) when the gap has passed and a slot is free.
 * Returns false (and changes nothing) when the sound must be dropped.
 */
export function admitSound(state: ThrottleState, id: SoundId, now: number): boolean {
  const rule = SOUND_RULES[id];
  if (now - state.last[id] < rule.gapMs) return false;
  const slots = state.ends[id];
  for (let i = 0; i < slots.length; i++) {
    if (slots[i] <= now) {
      slots[i] = now + rule.durMs;
      state.last[id] = now;
      return true;
    }
  }
  return false;
}

export interface SoundRequest {
  id: SoundId;
  x?: number; // world x for stereo pan; absent = centred
  volume: number; // 0..1
  variant?: string; // the ultimate's id ('barrage' | 'paratroopers' | 'marble')
}

// Volume boost for `count` same-frame events of one sound: 1 for one, ~1.5x at most.
export function countGain(count: number): number {
  if (!(count > 1)) return 1;
  return Math.min(1.5, 1 + 0.18 * Math.log2(count));
}

// World x to stereo pan: the lane spans about ±PAN_RANGE, kept to ±PAN_MAX so
// nothing sits fully in one ear.
export const PAN_RANGE = 6;
export const PAN_MAX = 0.65;
export function panForX(x: number | undefined): number {
  if (x === undefined || !Number.isFinite(x)) return 0;
  return Math.max(-1, Math.min(1, x / PAN_RANGE)) * PAN_MAX;
}

// One frame's tally per (sound, variant): count, x sum and how many had an x.
interface Tally {
  id: SoundId;
  variant?: string;
  count: number;
  weight: number; // shots: mobs in the shot; otherwise 1 per event
  xSum: number;
  xN: number;
}

// Order requests come out in: big moments first so they win a voice in the same frame.
const PRIORITY: readonly SoundId[] = [
  'victory',
  'defeat',
  'bossPhase',
  'ultimate',
  'championLaunch',
  'defenderDown',
  'gateBreak',
  'blast',
  'hitPlayerBase',
  'hitEnemyBase',
  'gateGood',
  'gateTrap',
  'towerShot',
  'shot',
  'clash',
];

function eventSound(e: SimEvent): SoundId | null {
  switch (e.type) {
    case 'gate':
      return e.added > 0 ? 'gateGood' : 'gateTrap';
    case 'gateBroken':
      return 'gateBreak';
    case 'unitsClash':
      return 'clash';
    case 'baseHit':
      // team is the owner of the base that was hit (Team.Player = 0, Team.Enemy = 1).
      return e.team === 1 ? 'hitEnemyBase' : 'hitPlayerBase';
    case 'defenderShot':
      return 'towerShot';
    case 'defenderDestroyed':
      return 'defenderDown';
    case 'championLaunched':
      return 'championLaunch';
    case 'bossPhase':
      return 'bossPhase';
    case 'victory':
      return 'victory';
    case 'defeat':
      return 'defeat';
    default:
      return null;
  }
}

function cueSound(c: AudioCue): SoundId | null {
  if (c.type === 'shot') return 'shot';
  if (c.type === 'ultimate') return 'ultimate';
  if (c.type === 'blast') return 'blast';
  return null;
}

function eventX(e: SimEvent): number | undefined {
  return 'x' in e ? e.x : undefined;
}

/**
 * The sounds one battle frame should play, already throttled against `state` at
 * `now` (ms). Same-sound events collapse into one request; the ultimate keeps one
 * request per ultimate id so each plays its own sound.
 */
export function soundsForFrame(
  events: readonly SimEvent[],
  cues: readonly AudioCue[],
  now: number,
  state: ThrottleState,
): SoundRequest[] {
  const tallies: Tally[] = [];
  const add = (id: SoundId, x: number | undefined, weight: number, variant?: string): void => {
    let t: Tally | undefined;
    for (let i = 0; i < tallies.length; i++) {
      if (tallies[i].id === id && tallies[i].variant === variant) {
        t = tallies[i];
        break;
      }
    }
    if (!t) {
      t = { id, variant, count: 0, weight: 0, xSum: 0, xN: 0 };
      tallies.push(t);
    }
    t.count++;
    t.weight += weight;
    if (x !== undefined && Number.isFinite(x)) {
      t.xSum += x;
      t.xN++;
    }
  };
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const id = eventSound(e);
    if (id) add(id, eventX(e), 1);
  }
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    const id = cueSound(c);
    if (!id) continue;
    const weight = id === 'shot' ? Math.max(1, c.count ?? 1) : 1;
    add(id, c.x, weight, id === 'ultimate' ? c.id : undefined);
  }
  if (tallies.length === 0) return [];
  tallies.sort((a, b) => PRIORITY.indexOf(a.id) - PRIORITY.indexOf(b.id));
  const out: SoundRequest[] = [];
  for (const t of tallies) {
    if (!admitSound(state, t.id, now)) continue;
    const req: SoundRequest = { id: t.id, volume: Math.min(1, SOUND_RULES[t.id].volume * countGain(t.weight)) };
    if (t.xN > 0) req.x = t.xSum / t.xN;
    if (t.variant !== undefined) req.variant = t.variant;
    out.push(req);
  }
  return out;
}

// Master gain for the settings: silent when sound is off or muted; the volume slider
// is squared so its lower half still feels like a smooth fade.
export function masterGain(sound: boolean, muted: boolean, volume: number): number {
  if (!sound || muted) return 0;
  const v = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0.8;
  return v * v;
}
