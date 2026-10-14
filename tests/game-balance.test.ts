// Balance check, part 1: every World 1 level played headless with the real sim and the
// autoplay bot. The curve itself is asserted against the 'human' profile (a thumb on a
// phone; see autoplay.ts), here for the opening levels and in game-balance-middle,
// -hard and -boss for the rest, so the four files run in parallel. The precise bot
// (skill 1) is kept as a sanity check: every level is beatable with all three stars.
// Prints one line per level so the difficulty ramp is visible when tuning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/game/levels.ts';
import { createAutoplay } from '../src/game/autoplay.ts';
import { SIM_DT, SIM_HZ } from '../src/contracts.ts';
import type { InputState, SimView } from '../src/contracts.ts';
import { EASY, humanRuns, median, play, runLine, starText } from './balance-play.ts';

for (const level of LEVELS) {
  test(`balance: ${level.id} "${level.name}" precise play takes all three stars`, () => {
    const r = play(level, 1);
    console.log(
      `  ${level.id.padEnd(5)} ${level.name.padEnd(16)} skill 1: ${r.outcome} in ${r.seconds.toFixed(1)} s (target ${level.targetTime} s), ` +
        `peak ${r.peak}, base ${(r.playerBase * 100).toFixed(0)}%, stars ${starText(r.stars)}, defenders broken ${r.destroyed}, misses ${r.missed}`,
    );
    assert.equal(r.outcome, 'victory', 'precise play should win');
    assert.deepEqual(r.stars, [true, true, true], 'precise play takes all 3 stars');
  });
}

test('balance: the opening levels are easy for a phone player', () => {
  for (const id of EASY) {
    const level = LEVELS.find((l) => l.id === id)!;
    const runs = humanRuns(level);
    console.log(runLine(id, runs));
    for (const [a, r] of runs.entries()) assert.equal(r.outcome, 'victory', `${id} attempt ${a} lost`);
    assert.ok(
      runs.filter((r) => r.playerBase > 0.5).length >= runs.length - 1,
      `${id}: the base often ends below half`,
    );
    const t = median(runs.map((r) => r.seconds));
    assert.ok(t >= 60 && t <= 120, `${id}: median battle ${t.toFixed(0)} s`);
    // Plenty of runs beat the target time too (1-2 is the tightest, about half).
    assert.ok(
      runs.filter((r) => r.stars[2]).length >= runs.length / 4,
      `${id}: the target time ${level.targetTime} s is too tight`,
    );
  }
});

test('balance: the human profile is deterministic and clearly weaker than the precise bot', () => {
  const level = LEVELS.find((l) => l.id === '1-5')!;
  assert.deepEqual(play(level, 'human', 3), play(level, 'human', 3), 'deterministic');
  const human = humanRuns(level, 4);
  const precise = play(level, 1);
  assert.ok(
    median(human.map((r) => r.seconds)) > precise.seconds + 15,
    'the human is clearly slower than the precise bot',
  );
});

test('autoplay human profile: late reactions, thumb lifts and a late champion', () => {
  const level = LEVELS.find((l) => l.id === '1-1')!; // one static x2 gate at x = 0
  const view: SimView = {
    count: 0,
    posX: new Float32Array(0),
    posZ: new Float32Array(0),
    team: new Uint8Array(0),
    kind: new Uint8Array(0),
    weight: new Uint16Array(0),
    radius: new Float32Array(0),
    hp: new Float32Array(0),
  };
  const state = {
    time: 0,
    playerBaseHp: 1,
    playerBaseMaxHp: 1,
    enemyBaseHp: 1,
    enemyBaseMaxHp: 1,
    championCharge: 0,
    playerUnits: 0,
    enemyUnits: 0,
    outcome: 'playing' as const,
  };
  const trace = (profile: 'human' | 'precise', charge: number): InputState[] => {
    state.championCharge = charge;
    const bot = createAutoplay(level, { profile, skill: 1 });
    const out: InputState[] = [];
    for (let s = 0; s < 20 * SIM_HZ; s++) out.push(bot(state, { view }, s * SIM_DT));
    return out;
  };
  const human = trace('human', 0);
  assert.deepEqual(human, trace('human', 0), 'deterministic');
  assert.ok(
    human.slice(0, Math.round(0.35 * SIM_HZ)).every((i) => i.aimX === 0),
    'holds still before its first reaction',
  );
  const lifted = human.filter((i) => !i.firing).length / human.length;
  assert.ok(lifted > 0.04 && lifted < 0.15, `thumb up ${(lifted * 100).toFixed(1)}% of the time`);
  const drift = Math.max(...human.map((i) => Math.abs(i.aimX)));
  assert.ok(drift > 0.3 && drift < 1, `aim drifts by up to ${drift.toFixed(2)} around the gate`);
  assert.ok(
    trace('precise', 0).every((i) => i.firing),
    'the precise bot never lifts its thumb',
  );

  const pressedAt = (t: InputState[]) => t.findIndex((i) => i.championPressed) * SIM_DT;
  assert.equal(pressedAt(trace('precise', 1)), 0, 'the precise bot launches at once');
  const late = pressedAt(trace('human', 1));
  assert.ok(late >= 1.5 && late <= 2.6, `the human launches after ${late.toFixed(2)} s`);
});
