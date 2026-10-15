// Sound rules: which sounds a battle frame plays, and the throttle that keeps big crowds quiet;
// the music: the scheduler's loop seam and the songs' notes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SimEvent } from '../src/contracts.ts';
import {
  PAN_MAX,
  SOUND_IDS,
  SOUND_RULES,
  admitSound,
  countGain,
  createThrottleState,
  masterGain,
  panForX,
  soundsForFrame,
} from '../src/audio/mapping.ts';
import type { AudioCue, SoundId } from '../src/audio/mapping.ts';
import { RECIPES, recipeKey } from '../src/audio/synth.ts';
import { SONGS, melody, noteMidi } from '../src/audio/songs.ts';
import { notesBetween, timeline } from '../src/audio/music.ts';
import { pickTake } from '../src/audio/samples.ts';

const ids = (reqs: { id: SoundId }[]): SoundId[] => reqs.map((r) => r.id).sort();

test('sim events map to their sounds', () => {
  const events: SimEvent[] = [
    { type: 'gate', gateId: 'a', x: 1, z: 5, added: 12 },
    { type: 'gate', gateId: 'b', x: -1, z: 5, added: -4 },
    { type: 'gateBroken', gateId: 'c', x: 0, z: 8 },
    { type: 'unitsClash', x: 0, z: 20 },
    { type: 'baseHit', team: 1, damage: 1, x: 0, z: 40 },
    { type: 'baseHit', team: 0, damage: 1, x: 0, z: 0 },
    { type: 'defenderShot', id: 't', x: 2, z: 30, tx: 0, tz: 10 },
    { type: 'defenderDestroyed', id: 't', kind: 'tower', x: 2, z: 30 },
    { type: 'championLaunched', x: 0 },
    { type: 'bossPhase', phase: 1, x: 0, z: 40 },
    { type: 'victory' },
  ];
  const out = soundsForFrame(events, [], 1000, createThrottleState());
  assert.deepEqual(
    ids(out),
    (
      [
        'bossPhase',
        'championLaunch',
        'clash',
        'defenderDown',
        'gateBreak',
        'gateGood',
        'gateTrap',
        'hitEnemyBase',
        'hitPlayerBase',
        'towerShot',
        'victory',
      ] as SoundId[]
    ).sort(),
  );
  // Big moments come first so they win a voice.
  assert.equal(out[0].id, 'victory');
  assert.deepEqual(ids(soundsForFrame([{ type: 'defeat' }], [], 0, createThrottleState())), ['defeat']);
  assert.deepEqual(soundsForFrame([{ type: 'baseMiss', x: 0, z: 0, count: 3 }], [], 0, createThrottleState()), []);
});

test('cues map to shot, ultimate by id and blast', () => {
  const cues: AudioCue[] = [
    { type: 'shot', x: 1, count: 3 },
    { type: 'ultimate', id: 'marble', x: 0 },
    { type: 'blast', x: -2 },
    { type: 'somethingElse' },
  ];
  const out = soundsForFrame([], cues, 0, createThrottleState());
  assert.deepEqual(ids(out), ['blast', 'shot', 'ultimate']);
  const ult = out.find((r) => r.id === 'ultimate');
  assert.equal(ult?.variant, 'marble');
  assert.equal(out.find((r) => r.id === 'blast')?.x, -2);
  assert.equal(out.find((r) => r.id === 'shot')?.variant, undefined);
});

test('a frame of a thousand clashes is one quiet-ish voice at the mean x', () => {
  const events: SimEvent[] = [];
  for (let i = 0; i < 1000; i++) events.push({ type: 'unitsClash', x: i % 2 === 0 ? 2 : 4, z: 10 });
  const out = soundsForFrame(events, [], 0, createThrottleState());
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'clash');
  assert.equal(out[0].x, 3);
  assert.ok(out[0].volume <= SOUND_RULES.clash.volume * 1.5 + 1e-9);
  assert.ok(out[0].volume > SOUND_RULES.clash.volume);
});

test('throttle: minimum gap, then a voice cap until voices end', () => {
  const st = createThrottleState();
  const rule = SOUND_RULES.clash;
  assert.equal(admitSound(st, 'clash', 0), true);
  assert.equal(admitSound(st, 'clash', rule.gapMs - 1), false); // inside the gap
  let t = 0;
  let admitted = 1;
  // Hammer it every gap: never more than `voices` at once.
  for (let i = 0; i < 50; i++) {
    t += rule.gapMs;
    if (admitSound(st, 'clash', t)) admitted++;
    const live = Array.from(st.ends.clash).filter((e) => e > t).length;
    assert.ok(live <= rule.voices);
  }
  assert.ok(admitted > 1);
  // Separate sounds never block each other.
  assert.equal(admitSound(st, 'victory', t), true);
  assert.equal(admitSound(st, 'victory', t + 10), false);
});

test('throttle across frames: per-frame mapping respects the gap', () => {
  const st = createThrottleState();
  const frame = (now: number): number =>
    soundsForFrame([{ type: 'unitsClash', x: 0, z: 0 }], [{ type: 'shot', x: 0, count: 1 }], now, st).length;
  assert.equal(frame(0), 2);
  assert.equal(frame(16), 0);
  assert.equal(frame(33), 0);
  assert.equal(frame(66), 2); // past both gaps (45 ms and 60 ms)
});

test('shot volume grows with mobs per shot, capped', () => {
  const one = soundsForFrame([], [{ type: 'shot', x: 0, count: 1 }], 0, createThrottleState())[0];
  const many = soundsForFrame([], [{ type: 'shot', x: 0, count: 64 }], 0, createThrottleState())[0];
  assert.ok(many.volume > one.volume);
  assert.ok(many.volume <= 1);
  assert.equal(countGain(1), 1);
  assert.equal(countGain(0), 1);
  assert.ok(countGain(1e9) <= 1.5);
});

test('pan follows world x, clamped and never fully one-sided', () => {
  assert.equal(panForX(undefined), 0);
  assert.equal(panForX(0), 0);
  assert.ok(panForX(3) > 0);
  assert.ok(panForX(-3) < 0);
  assert.equal(panForX(1000), PAN_MAX);
  assert.equal(panForX(-1000), -PAN_MAX);
  assert.equal(panForX(Number.NaN), 0);
});

test('master gain follows sound, mute and volume', () => {
  assert.equal(masterGain(false, false, 1), 0);
  assert.equal(masterGain(true, true, 1), 0);
  assert.equal(masterGain(true, false, 1), 1);
  assert.equal(masterGain(true, false, 0), 0);
  assert.ok(masterGain(true, false, 0.5) < 0.5);
  assert.equal(masterGain(true, false, 7), 1);
});

test('every sound and variant has a recipe', () => {
  for (const id of SOUND_IDS) assert.ok(RECIPES[recipeKey(id)], id);
  for (const v of ['barrage', 'paratroopers', 'marble', 'blizzard'])
    assert.equal(recipeKey('ultimate', v), `ultimate:${v}`);
  for (const v of ['sarge', 'tank', 'drummer', 'windup'])
    assert.equal(recipeKey('championLaunch', v), `championLaunch:${v}`);
  assert.equal(recipeKey('ultimate', 'nope'), 'ultimate:barrage');
  assert.equal(recipeKey('shot', 'ignored'), 'shot');
  for (const r of Object.values(RECIPES)) assert.ok(r.dur > 0 && r.dur <= 2.5);
});

test('World 2 sim events map to their sounds', () => {
  const events: SimEvent[] = [
    { type: 'gateFrozen', gateId: 'a', x: 1, z: 5, duration: 3 },
    { type: 'gateChipped', gateId: 'a', x: 1, z: 5, hp: 20, maxHp: 30 },
    { type: 'gateThawed', gateId: 'b', x: -1, z: 5, chipped: true },
    { type: 'giantFell', x: 0, z: 30, riders: 2 },
    { type: 'snowballBurst', x: 2, z: 20, count: 4 },
    { type: 'unitsFrozen', team: 1, x: 0, z: 25, radius: 3, seconds: 2 },
    { type: 'iceWallHit', id: 'w', x: 0, z: 18 },
  ];
  const out = soundsForFrame(events, [], 0, createThrottleState());
  assert.deepEqual(
    ids(out),
    (['freeze', 'gateFreeze', 'gateThaw', 'giantFall', 'iceChip', 'snowballBurst'] as SoundId[]).sort(),
  );
  assert.equal(out[0].id, 'freeze', 'a freeze outranks the gate sounds');
});

test('World 2 cues: lob whistle and hit, gust rise and whoosh, igloo release, Blizzard', () => {
  const cues: AudioCue[] = [
    { type: 'lob', x: 1 },
    { type: 'lobHit', x: 1 },
    { type: 'gustWarn', dir: 1 },
    { type: 'gust', dir: 1 },
    { type: 'iglooRelease', id: 'ig1', x: -2, count: 3 },
    { type: 'ultimate', id: 'blizzard', x: 0 },
  ];
  const out = soundsForFrame([], cues, 0, createThrottleState());
  assert.deepEqual(ids(out), (['gustRise', 'gustWhoosh', 'igloo', 'lob', 'lobHit', 'ultimate'] as SoundId[]).sort());
  assert.equal(out.find((r) => r.id === 'ultimate')?.variant, 'blizzard');
  assert.equal(out.find((r) => r.id === 'igloo')?.variant, undefined, "the igloo's id is not a variant");
});

test('a gust sounds from the side the wind comes from', () => {
  const pan = (dir: -1 | 1): number => {
    const [r] = soundsForFrame([], [{ type: 'gustWarn', dir }], 0, createThrottleState());
    return panForX(r.x);
  };
  assert.ok(pan(1) < 0, 'blowing right: the wind comes from the left');
  assert.ok(pan(-1) > 0, 'blowing left: the wind comes from the right');
  assert.ok(Math.abs(pan(1)) <= PAN_MAX);
});

test('a storm of ice chips on a frozen gate stays a light tick, a few times a second', () => {
  const state = createThrottleState();
  let played = 0;
  // 2 s at 60 fps with 40 units hacking at the ice every frame.
  for (let f = 0; f < 120; f++) {
    const chips: SimEvent[] = Array.from({ length: 40 }, () => ({
      type: 'gateChipped' as const,
      gateId: 'a',
      x: 0,
      z: 16,
      hp: 10,
      maxHp: 30,
    }));
    for (const r of soundsForFrame(chips, [], f * (1000 / 60), state)) {
      played++;
      assert.ok(r.volume < 0.6, `chip volume ${r.volume}`);
    }
  }
  assert.ok(played >= 4 && played <= 20, `${played} chips in 2 s`);
  // The gust's rising wind is never doubled up.
  const g = createThrottleState();
  assert.equal(soundsForFrame([], [{ type: 'gustWarn', dir: 1 }], 0, g).length, 1);
  assert.equal(soundsForFrame([], [{ type: 'gustWarn', dir: 1 }], 300, g).length, 0);
});

test("World 3 sim events map to their sounds; a gliding gate is the cue's job", () => {
  const events: SimEvent[] = [
    { type: 'gateToggled', gateId: 'g', x: 1, z: 10, on: false },
    { type: 'sawHit', id: 's', x: -2, z: 14, weight: 3 },
    { type: 'shieldBlock', id: 'w', x: 0, z: 20 },
    { type: 'arrow', x: 1, z: 8, tx: 1, tz: 14 },
    { type: 'ricochet', x: 4, z: 6 },
    { type: 'gateWalk', gateId: 'g', x: 1, z: 10, seconds: 3 },
    { type: 'gateMoved', gateId: 'g', fromX: 1, fromZ: 10, x: -1, z: 12, seconds: 1 },
  ];
  const out = soundsForFrame(events, [], 0, createThrottleState());
  assert.deepEqual(
    ids(out),
    (['arrow', 'gateToggle', 'gateWalk', 'ricochet', 'saw', 'shieldClang'] as SoundId[]).sort(),
  );
  assert.equal(out[0].id, 'gateWalk', 'the champion at work outranks the hazards');
  assert.equal(out.find((r) => r.id === 'saw')?.x, -2, 'panned by x like the others');
  assert.ok(panForX(out.find((r) => r.id === 'ricochet')?.x) > 0);
});

test('World 3 cues: the crank winds on the shuffle warning, the jester pops on the shuffle', () => {
  const out = soundsForFrame([], [{ type: 'shuffleWarn' }, { type: 'shuffle' }], 0, createThrottleState());
  assert.deepEqual(ids(out), (['crank', 'jackPop'] as SoundId[]).sort());
  assert.equal(out[0].id, 'jackPop');
  for (const r of out) assert.equal(r.x, undefined, 'the whole box cranks: centred');
});

test('a volley of archers is one bow twang, a few times a second at most', () => {
  const state = createThrottleState();
  let played = 0;
  // 2 s at 60 fps with 30 archers loosing every frame, and the saws biting every frame.
  for (let f = 0; f < 120; f++) {
    const evs: SimEvent[] = Array.from({ length: 30 }, (_, i) => ({
      type: 'arrow' as const,
      x: i % 5,
      z: 5,
      tx: 0,
      tz: 9,
    }));
    evs.push(
      { type: 'sawHit', id: 's1', x: 0, z: 12, weight: 2 },
      { type: 'sawHit', id: 's2', x: 3, z: 16, weight: 1 },
    );
    const reqs = soundsForFrame(evs, [], f * (1000 / 60), state);
    for (const r of reqs) {
      if (r.id === 'arrow') {
        played++;
        assert.ok(r.volume <= SOUND_RULES.arrow.volume * 1.5 + 1e-9, `arrow volume ${r.volume}`);
      }
    }
  }
  assert.ok(played >= 6 && played <= 13, `${played} twangs in 2 s`);
  assert.ok(SOUND_RULES.arrow.gapMs >= 150 && SOUND_RULES.saw.gapMs >= 150);
});

// ---------- Music ----------

test('back-to-back scheduling windows play every note once, across the loop seam', () => {
  for (const song of Object.values(SONGS)) {
    const tl = timeline(song);
    const loops = 3;
    const expected: number[] = [];
    for (let k = 0; k < loops; k++) for (const n of tl.notes) expected.push(n.time + k * tl.length);
    const got: number[] = [];
    // Uneven windows, like a timer that fires late; one ends exactly on the seam.
    const edges = [0, 0.37, 1.1, tl.length - 0.05, tl.length, tl.length + 0.61];
    for (let t = edges[edges.length - 1]; t < loops * tl.length; t += 0.43) edges.push(t);
    edges.push(loops * tl.length);
    for (let i = 1; i < edges.length; i++) {
      for (const n of notesBetween(tl, edges[i - 1], edges[i])) {
        assert.ok(n.time >= edges[i - 1] && n.time < edges[i], `${song.id} note outside its window`);
        got.push(n.time);
      }
    }
    assert.equal(got.length, expected.length, song.id);
    got.forEach((t, i) => assert.ok(Math.abs(t - expected[i]) < 1e-9, `${song.id} note ${i}`));
  }
});

test('every note of every song starts and ends inside its loop', () => {
  for (const song of Object.values(SONGS)) {
    const beats = song.bars * song.beatsPerBar;
    for (const p of song.parts) {
      assert.ok(p.notes.length > 0, `${song.id} ${p.inst} is empty`);
      for (const n of p.notes) {
        assert.ok(n.at >= 0 && n.at + n.dur <= beats + 1e-9, `${song.id} ${p.inst} note at beat ${n.at}`);
      }
    }
  }
});

test('songs stay in key: pitched notes use only their scale', () => {
  const scale = (root: string, steps: number[]): Set<number> => {
    const r = noteMidi(`${root}4`) % 12;
    return new Set(steps.map((s) => (r + s) % 12));
  };
  const major = [0, 2, 4, 5, 7, 9, 11];
  const keys: Record<string, Set<number>> = {
    menu: scale('F', major),
    battle: scale('C', major),
    boss: scale('A', [0, 2, 3, 5, 7, 8, 10, 11]), // A minor, with the raised G# of E major
    battle2: scale('E', [0, 2, 3, 5, 7, 8, 10, 11]), // E minor, with the D# of B7
    boss2: scale('D', [0, 2, 3, 5, 7, 8, 10, 11]), // D minor, with the C# of A major
    battle3: scale('G', major),
    boss3: scale('C', [0, 2, 3, 5, 7, 8, 10, 11]), // C minor, with the B of G major
  };
  for (const song of Object.values(SONGS)) {
    for (const p of song.parts) {
      for (const n of p.notes) {
        if (n.midi === 0) continue; // drums
        assert.ok(keys[song.id].has(n.midi % 12), `${song.id} ${p.inst}: midi ${n.midi} at beat ${n.at}`);
      }
    }
  }
});

test('a melody bar that does not add up to a full bar is rejected', () => {
  assert.throws(() => melody('C5:2 D5:2 | E5:8', 4), /bar 1/);
  assert.throws(() => melody('C5:8 | H5:8', 4), /bad note/);
  assert.equal(melody('C5:4 r:2 D5:2', 4).length, 2);
});

test('recorded takes never repeat back to back and all get used', () => {
  for (const count of [2, 3, 5]) {
    const seen = new Set<number>();
    let last = -1;
    for (let i = 0; i < 200; i++) {
      const k = pickTake(count, last, (i * 0.618034) % 1);
      assert.ok(k >= 0 && k < count);
      assert.notEqual(k, last);
      seen.add(k);
      last = k;
    }
    assert.equal(seen.size, count);
  }
  assert.equal(pickTake(1, 0, 0.9), 0);
});

test('World 3 songs: a workshop battle and a faster Jack-in-the-Box boss, the same loop shape', () => {
  for (const [id, base] of [
    ['battle3', 'battle2'],
    ['boss3', 'boss2'],
  ] as const) {
    const song = SONGS[id];
    assert.equal(song.id, id);
    assert.equal(song.bars, SONGS[base].bars);
    assert.equal(song.beatsPerBar, SONGS[base].beatsPerBar);
    const insts = song.parts.map((p) => p.inst);
    for (const inst of ['celesta', 'woodblock', 'ratchet', 'pizz'] as const)
      assert.ok(insts.includes(inst), `${id} ${inst}`);
  }
  assert.ok(SONGS.boss3.bpm > SONGS.battle3.bpm, 'the boss is tenser');
  assert.ok(
    SONGS.boss3.parts.some((p) => p.inst === 'boing'),
    'the jester pops',
  );
});
