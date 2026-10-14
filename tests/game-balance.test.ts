// Balance check, part 1: every World 1 level played headless with the real sim and the
// autoplay bot. Precise play (skill 1) wins every level in 55-150 s, the opening levels
// are easy for a decent player (skill 0.8) and the middle ones nearly so. The hard end
// of the curve lives in game-balance-hard.test.ts so the two files run in parallel.
// Prints one line per level so the difficulty ramp is visible when tuning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/game/levels.ts';
import { EASY, MIDDLE, play, starText } from './balance-play.ts';

for (const level of LEVELS) {
  test(`balance: ${level.id} "${level.name}" precise play`, () => {
    const r = play(level, 1);
    console.log(
      `  ${level.id.padEnd(5)} ${level.name.padEnd(16)} skill 1: ${r.outcome} in ${r.seconds.toFixed(1)} s (target ${level.targetTime} s), ` +
        `peak ${r.peak}, base ${(r.playerBase * 100).toFixed(0)}%, stars ${starText(r.stars)}, defenders broken ${r.destroyed}, misses ${r.missed}`,
    );
    assert.equal(r.outcome, 'victory', 'precise play should win');
    assert.ok(r.seconds >= 55 && r.seconds <= 150, `battle lasted ${r.seconds.toFixed(1)} s`);
    if (EASY.includes(level.id)) assert.deepEqual(r.stars, [true, true, true], 'precise play takes all 3 stars on an easy level');
    assert.deepEqual(play(level, 1), r, 'deterministic');
  });
}

test('balance: the opening levels are easy', () => {
  for (const id of EASY) {
    const level = LEVELS.find((l) => l.id === id)!;
    const runs = [0, 1, 2, 3].map((a) => play(level, 0.8, a));
    console.log(`  ${id.padEnd(5)} skill 0.8: ${runs.map((r) => `${r.outcome[0]} ${r.seconds.toFixed(0)}s ${(r.playerBase * 100).toFixed(0)}% ${starText(r.stars)}`).join(' | ')}`);
    for (const [a, r] of runs.entries()) {
      assert.equal(r.outcome, 'victory', `${id} attempt ${a} lost at skill 0.8`);
      assert.ok(r.playerBase > 0.5, `${id} attempt ${a} ended with the base at ${(r.playerBase * 100).toFixed(0)}%`);
    }
    // Most decent runs beat the target time too.
    assert.ok(runs.filter((r) => r.stars[2]).length >= 2, `${id}: the target time ${level.targetTime} s is too tight`);
  }
  const casual = play(LEVELS[0], 0.6);
  console.log(`  1-1   skill 0.6: ${casual.outcome} in ${casual.seconds.toFixed(1)} s`);
  assert.equal(casual.outcome, 'victory', 'the first level should be won by a sloppy player too');
});

test('balance: the middle levels are won by a decent player almost every time', () => {
  for (const id of MIDDLE) {
    const level = LEVELS.find((l) => l.id === id)!;
    const runs = [0, 1, 2, 3].map((a) => play(level, 0.8, a));
    const wins = runs.filter((r) => r.outcome === 'victory');
    console.log(`  ${id.padEnd(5)} skill 0.8: ${runs.map((r) => `${r.outcome[0]} ${r.seconds.toFixed(0)}s ${(r.playerBase * 100).toFixed(0)}% ${starText(r.stars)}`).join(' | ')}`);
    assert.ok(wins.length >= 3, `${id}: only ${wins.length}/4 wins at skill 0.8`);
    assert.ok(runs.some((r) => r.stars.every(Boolean)), `${id}: no decent run took all 3 stars`);
  }
});
