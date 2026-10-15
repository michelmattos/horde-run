// Every tier-0 alternative to the starter loadout (another mob type, champion, ultimate
// or cannon, swapped in on its own) still wins the four easy World 1 levels with the
// human profile, and plays in the same ballpark as the starter: never a must-have, never
// a trap. (Since the Milestone 5 rebalance 1-5 already takes a retry now and then, so it
// is no longer part of this always-win set.) Prints one line per item for tuning. All
// ten levels: game-balance-items-late.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/game/levels.ts';
import type { ItemCase, PlayResult } from './balance-play.ts';
import { EASY, ITEM_CASES, STARTER_CASE, median, play, resolveCase } from './balance-play.ts';

const OPENING = LEVELS.filter((l) => EASY.includes(l.id));
const ATTEMPTS = 2;

function runs(c: ItemCase) {
  return OPENING.map((l) => {
    const r = resolveCase(l, c);
    return { id: l.id, runs: Array.from({ length: ATTEMPTS }, (_, a) => play(r.level, 'human', a, r.loadout)) };
  });
}
const winTimes = (rs: { runs: PlayResult[] }[]) =>
  rs.flatMap((r) => r.runs.filter((x) => x.outcome === 'victory').map((x) => x.seconds));

const starter = median(winTimes(runs(STARTER_CASE)));

for (const c of ITEM_CASES) {
  test(`item balance: ${c.name} wins the easy levels, in the starter's ballpark`, () => {
    const rs = runs(c);
    const t = median(winTimes(rs));
    console.log(
      `  ${c.name.padEnd(18)} ` +
        rs.map((r) => `${r.id} ${r.runs.filter((x) => x.outcome === 'victory').length}/${ATTEMPTS}`).join('  ') +
        ` | median win ${t.toFixed(0)} s (starter ${starter.toFixed(0)} s)`,
    );
    for (const r of rs) {
      const wins = r.runs.filter((x) => x.outcome === 'victory').length;
      assert.ok(wins === ATTEMPTS, `${c.name}: ${r.id} won ${wins}/${ATTEMPTS}`);
    }
    assert.ok(
      t >= 0.6 * starter && t <= 1.5 * starter,
      `${c.name}: median win ${t.toFixed(0)} s vs starter ${starter.toFixed(0)} s`,
    );
  });
}
