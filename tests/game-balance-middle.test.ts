// Balance check, part 2: the middle of World 1 (1-5..1-7). After the phone play-test
// these are won on a first or second try by an average player: the 'human' autoplay
// profile wins most attempts on each (tuned at 81-88% over 16 attempts), and battles
// last about 60-120 s. Three stars stay within reach of a good run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/game/levels.ts';
import { MIDDLE, humanRuns, median, runLine } from './balance-play.ts';

test('balance: the middle levels are won on a first or second try', () => {
  let total = 0;
  let won = 0;
  for (const id of MIDDLE) {
    const level = LEVELS.find((l) => l.id === id)!;
    const runs = humanRuns(level);
    const wins = runs.filter((r) => r.outcome === 'victory');
    console.log(runLine(id, runs));
    total += runs.length;
    won += wins.length;
    assert.ok(wins.length >= 5, `${id}: only ${wins.length}/${runs.length} human attempts won`);
    for (let a = 0; a + 1 < runs.length; a++) {
      const two = runs[a].outcome === 'victory' || runs[a + 1].outcome === 'victory';
      assert.ok(two, `${id}: attempts ${a} and ${a + 1} both lost`);
    }
    const t = median(wins.map((r) => r.seconds));
    assert.ok(t >= 60 && t <= 120, `${id}: median win took ${t.toFixed(0)} s`);
    assert.ok(
      wins.some((r) => r.stars.every(Boolean)),
      `${id}: no human win took all 3 stars`,
    );
  }
  // 75-90% intended; 8 attempts a level is noisy, so the bounds are pooled and loose.
  assert.ok(won >= 0.67 * total && won <= 0.96 * total, `middle levels: ${won}/${total} human wins`);
});
