// Sound rules: which sounds a battle frame plays, and the throttle that keeps big crowds quiet.
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
  for (const v of ['sarge', 'tank', 'drummer']) assert.equal(recipeKey('championLaunch', v), `championLaunch:${v}`);
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
