// Balance check for World 3 (Clockwork Workshop, concept §9.1) with the starter gear a
// new player owns: 3-1 is won every time and 3-2 and 3-3 are easy too; 3-8, 3-9 and the
// Jack-in-the-Box (3-10) take a retry or two. Tuned over 16 human attempts each (see
// TUNING below). Prints one line per level for tuning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLevelById } from '../src/game/levels.ts';
import { HUMAN_ATTEMPTS, W3_EASY, W3_HARD, humanRuns, median, runLine } from './balance-play.ts';

test('balance: the opening of World 3 is easy for a phone player', () => {
  for (const id of W3_EASY) {
    const level = getLevelById(id)!;
    // 3-1 must never be lost; the next two get half the attempts to keep the file quick.
    const runs = humanRuns(level, id === '3-1' ? HUMAN_ATTEMPTS : HUMAN_ATTEMPTS / 2);
    console.log(runLine(id, runs));
    for (const [a, r] of runs.entries()) assert.equal(r.outcome, 'victory', `${id} attempt ${a} lost`);
    const t = median(runs.map((r) => r.seconds));
    assert.ok(t >= 60 && t <= 120, `${id}: median battle ${t.toFixed(0)} s`);
    assert.ok(
      runs.some((r) => r.stars.every(Boolean)),
      `${id}: no attempt took all three stars`,
    );
  }
});

for (const id of W3_HARD) {
  test(`balance: ${id} takes a phone player a retry or two`, () => {
    const level = getLevelById(id)!;
    const runs = humanRuns(level);
    const wins = runs.filter((r) => r.outcome === 'victory');
    console.log(runLine(id, runs));
    assert.ok(wins.length >= 2, `${id}: only ${wins.length}/${runs.length} human attempts won (a wall)`);
    assert.ok(wins.length <= 6, `${id}: ${wins.length}/${runs.length} human attempts won (no retry needed)`);
    const t = median(wins.map((r) => r.seconds));
    assert.ok(t >= 60 && t <= 120, `${id}: median win took ${t.toFixed(0)} s`);
    assert.ok(
      wins.some((r) => r.stars[2]),
      `${id}: no winning run beat the ${level.targetTime} s target`,
    );
  });
}
