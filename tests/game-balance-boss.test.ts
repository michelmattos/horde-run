// Balance check, part 4: the World 1 boss (1-10, the Tin General). The 'human' autoplay
// profile (a thumb on a phone) wins about half its attempts (tuned at 56% over 16):
// a retry or two, never a wall. Winning runs end in about 60-130 s, and a good run
// beats the target time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/game/levels.ts';
import { BOSS, humanRuns, median, runLine } from './balance-play.ts';

for (const id of BOSS) {
  test(`balance: the boss ${id} takes a phone player a retry or two`, () => {
    const level = LEVELS.find((l) => l.id === id)!;
    const runs = humanRuns(level);
    const wins = runs.filter((r) => r.outcome === 'victory');
    console.log(runLine(id, runs));
    assert.ok(wins.length >= 2, `${id}: only ${wins.length}/${runs.length} human attempts won (a wall)`);
    assert.ok(wins.length <= 6, `${id}: ${wins.length}/${runs.length} human attempts won (no retry needed)`);
    const t = median(wins.map((r) => r.seconds));
    assert.ok(t >= 60 && t <= 130, `${id}: median win took ${t.toFixed(0)} s`);
    assert.ok(
      wins.some((r) => r.stars[2]),
      `${id}: no winning run beat the ${level.targetTime} s target`,
    );
  });
}
