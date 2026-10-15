// Review guard for Milestone 3 gameplay feel: a single run upgrade must not collapse a
// generated battle (or the boss) into a few seconds. Supply Gate and Fork Gates once
// added +15 / +25 to every crossing soldier and ended battles in ~13 s; their add gates
// are now small and brittle, so every gate upgrade must keep a win above the floor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyUpgrades } from '../src/expedition/index.ts';
import { generateRunBattle } from '../src/game/expedition.ts';
import { play } from './balance-play.ts';

const MIN_WIN_SECONDS = 30; // well under the 60-120 s target; a single pick must not go below it

for (const id of ['supply', 'fork', 'doubler', 'tripler']) {
  test(`one ${id} upgrade keeps battle 2 and the boss above ${MIN_WIN_SECONDS} s (human profile)`, () => {
    for (const kind of ['battle', 'boss'] as const) {
      const level = applyUpgrades(generateRunBattle({ seed: 1000, kind, index: kind === 'boss' ? 4 : 2 }), {
        [id]: 1,
      });
      const r = play(level, 'human', 0);
      if (r.outcome === 'victory')
        assert.ok(r.seconds >= MIN_WIN_SECONDS, `${id} ${kind}: won in ${r.seconds.toFixed(0)} s, peak ${r.peak}`);
    }
  });
}
