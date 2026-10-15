// Loadout fairness (Michel: the campaign must stay fair with zero upgrades). The balance
// tests play the starter gear a new player owns, resolved through progression's real
// resolveLoadout over an empty profile: that must be the battle layer's
// DEFAULT_BATTLE_LOADOUT on an unchanged level, and on every World 1 level the bot gets
// to use the ultimate, so the curve in game-balance*.test.ts is measured with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/game/levels.ts';
import { DEFAULT_BATTLE_LOADOUT } from '../src/game/loadout.ts';
import { humanRuns, runLine, starterSetup } from './balance-play.ts';

test('the starter gear of a fresh profile is the default battle loadout on an unchanged level', () => {
  for (const level of LEVELS) {
    const s = starterSetup(level);
    assert.deepEqual(s.loadout, DEFAULT_BATTLE_LOADOUT, level.id);
    assert.deepEqual(s.level, level, `${level.id}: the popgun and an empty village change nothing`);
  }
});

for (const level of LEVELS.filter((l) => l.id.startsWith('1-'))) {
  test(`loadout balance: ${level.id} is played with the starter ultimate`, () => {
    const [run] = humanRuns(level, 1);
    console.log(runLine(level.id, [run]) + ` | ultimates ${run.ultimates}`);
    assert.ok(run.ultimates > 0, 'the attempt uses the ultimate');
  });
}
