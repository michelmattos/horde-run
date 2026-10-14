// Balance check, part 3: the hard end of World 1 before the boss (concept §4.1
// "moderate"). On 1-8 and 1-9 the 'human' autoplay profile (a thumb on a phone) wins
// some attempts and loses others (tuned at 63% each over 16 attempts): a retry or two,
// never a wall and never a walk. Winning runs end in about 60-120 s, and a good run
// beats the target time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/game/levels.ts';
import { HARD, humanRuns, median, runLine } from './balance-play.ts';

for (const id of HARD) {
  test(`balance: ${id} takes a phone player a retry or two`, () => {
    const level = LEVELS.find((l) => l.id === id)!;
    const runs = humanRuns(level);
    const wins = runs.filter((r) => r.outcome === 'victory');
    console.log(runLine(id, runs));
    assert.ok(wins.length >= 2, `${id}: only ${wins.length}/${runs.length} human attempts won (a wall)`);
    assert.ok(wins.length <= 6, `${id}: ${wins.length}/${runs.length} human attempts won (no retry needed)`);
    const t = median(wins.map((r) => r.seconds));
    assert.ok(t >= 60 && t <= 125, `${id}: median win took ${t.toFixed(0)} s`);
    assert.ok(wins.some((r) => r.stars[2]), `${id}: no winning run beat the ${level.targetTime} s target`);
  });
}
