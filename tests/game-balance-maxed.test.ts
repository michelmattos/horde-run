// Maxed gear (concept §9.2 step 3): every item at MAX_TIER and every village building at
// tier 3, resolved through progression's real resolveLoadout for a real Profile, with the
// starter loadout. Upgrades make the hard end of World 1 comfortable, not trivial: wins
// still take at least 45 s (before the rebalance they took about 30 s).
//
// Measured over 16 attempts: maxed wins every attempt on 1-8, 1-9 and 1-10 (median wins
// 51, 51 and 66 s). The starter wins these about 60% of the time, and that curve is
// steep: an attempt the starter loses needs 100+ base HP to survive, a maxed one at most
// 36, so no base HP gives both 60% starter wins and occasional maxed losses. The maxed
// test therefore pins the time floor, not a loss rate. World 3's hard end (8 attempts):
// maxed wins every attempt on 3-8, 3-9 and 3-10 (median wins 57, 80 and 58 s).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLevelById } from '../src/game/levels.ts';
import { BUILDINGS, ITEMS, MAX_TIER, emptyProfile, resolveLoadout } from '../src/progression/index.ts';
import type { Profile } from '../src/progression/index.ts';
import { HUMAN_ATTEMPTS, humanRuns, median, runLine } from './balance-play.ts';

const MAXED: Profile = {
  ...emptyProfile(),
  owned: ITEMS.filter((it) => it.unlock.type === 'buy').map((it) => it.id),
  tiers: Object.fromEntries(ITEMS.map((it) => [it.id, MAX_TIER])),
  village: Object.fromEntries(BUILDINGS.map((b) => [b.id, MAX_TIER])),
};

for (const id of ['1-8', '1-9', '1-10', '3-8', '3-9', '3-10']) {
  test(`maxed gear and village: ${id} is comfortable, not trivial`, () => {
    const r = resolveLoadout(getLevelById(id)!, MAXED);
    const runs = humanRuns(r.level, HUMAN_ATTEMPTS, r.battle);
    console.log(runLine(id, runs));
    const wins = runs.filter((x) => x.outcome === 'victory');
    assert.ok(wins.length > 0, `${id}: maxed gear never wins`);
    const t = median(wins.map((x) => x.seconds));
    assert.ok(t >= 45, `${id}: median maxed win ${t.toFixed(0)} s`);
  });
}
