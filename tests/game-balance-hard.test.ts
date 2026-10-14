// Balance check, part 2: the hard end of World 1 (concept §4.1 "moderate"). On 1-8, 1-9
// and the boss a decent player (skill 0.8 or 0.9, four attempts each) wins some tries
// and loses others: at least 2 and at most 6 of 8. That is "a retry or two", never a
// wall and never a walk. Three stars stay within reach of a good run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/game/levels.ts';
import { HARD, play, starText } from './balance-play.ts';

for (const id of HARD) {
  test(`balance: ${id} takes a decent player a retry or two`, () => {
    const level = LEVELS.find((l) => l.id === id)!;
    const runs = [0.9, 0.8].flatMap((skill) => [0, 1, 2, 3].map((a) => ({ skill, ...play(level, skill, a) })));
    const wins = runs.filter((r) => r.outcome === 'victory');
    console.log(
      `  ${id.padEnd(5)} decent: ${wins.length}/${runs.length} wins | ` +
        runs.map((r) => `${r.skill} ${r.outcome[0]} ${r.seconds.toFixed(0)}s ${(r.playerBase * 100).toFixed(0)}% ${starText(r.stars)}`).join(' | '),
    );
    assert.ok(wins.length >= 2, `${id}: only ${wins.length}/8 decent attempts won (a wall)`);
    assert.ok(wins.length <= 6, `${id}: ${wins.length}/8 decent attempts won (no retry needed)`);
    assert.ok(wins.some((r) => r.stars[2]), `${id}: no winning run beat the ${level.targetTime} s target`);
    for (const r of wins) assert.ok(r.seconds <= 175, `${id}: a win took ${r.seconds.toFixed(0)} s`);
  });
}
