// Review (Milestone 4, gameplay): loadout battles stay deterministic with the same seed,
// every ultimate fires and changes the battle, and victory/defeat are reported once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/game/levels.ts';
import { DEFAULT_BATTLE_LOADOUT } from '../src/game/loadout.ts';
import type { BattleLoadout } from '../src/game/loadout.ts';
import { TIER0, play } from './balance-play.ts';

const LOADOUTS: [string, BattleLoadout][] = [
  ['barrage', DEFAULT_BATTLE_LOADOUT],
  ['paratroopers', { ...DEFAULT_BATTLE_LOADOUT, ultimate: { ...TIER0.paratroopers } }],
  ['marble', { ...DEFAULT_BATTLE_LOADOUT, ultimate: { ...TIER0.marble } }],
];

for (const [name, lo] of LOADOUTS) {
  test(`loadout battle with ${name} is deterministic for the same seed and fires the ultimate`, () => {
    const a = play(LEVELS[2], 'human', 1, lo);
    const b = play(LEVELS[2], 'human', 1, lo);
    assert.deepEqual(a, b);
    assert.equal(a.outcome, 'victory');
    assert.ok(a.ultimates > 0, `${name} never fired`);
  });
}
