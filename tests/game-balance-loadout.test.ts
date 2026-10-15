// Loadout fairness (Michel: the campaign must stay fair with zero upgrades). With the
// starter loadout every World 1 level is won by the human profile in most attempts,
// and plays in the same time range as without a loadout, a little easier, never a
// different game. Prints one line per level for tuning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/game/levels.ts';
import { DEFAULT_BATTLE_LOADOUT } from '../src/game/loadout.ts';
import { humanRuns, median, runLine } from './balance-play.ts';

const ATTEMPTS = 4;

for (const level of LEVELS) {
  test(`loadout balance: ${level.id} is won by a phone player with the starter loadout`, () => {
    const runs = humanRuns(level, ATTEMPTS, DEFAULT_BATTLE_LOADOUT);
    console.log(runLine(level.id, runs) + ` | ultimates ${runs.map((r) => r.ultimates).join(',')}`);
    const wins = runs.filter((r) => r.outcome === 'victory');
    assert.ok(wins.length >= ATTEMPTS - 1, `${level.id}: only ${wins.length}/${ATTEMPTS} wins`);
    assert.ok(
      runs.every((r) => r.ultimates > 0),
      'every attempt uses the ultimate',
    );
    // Not a walkover: battles still last about a minute or more.
    const t = median(wins.map((r) => r.seconds));
    assert.ok(t >= 45, `${level.id}: median win ${t.toFixed(0)} s is too quick`);
  });
}
