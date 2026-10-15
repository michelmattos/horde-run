// Tier-0 items over all ten World 1 levels: no swap may beat the starter on win time and
// base HP on every level at once (a strict upgrade is a must-pick), and the mob slot
// order cannot be gamed: a knight or bomber in Mob 1 plays exactly as in Mob 2 (it is
// fired as the every-10th mix, scaled by the cannon's mobs per shot).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/game/levels.ts';
import type { ItemCase } from './balance-play.ts';
import { STARTER_CASE, median, play, resolveCase } from './balance-play.ts';

const ATTEMPTS = 2;

function summary(c: ItemCase) {
  return LEVELS.map((l) => {
    const r = resolveCase(l, c);
    const rs = Array.from({ length: ATTEMPTS }, (_, a) => play(r.level, 'human', a, r.loadout));
    const wins = rs.filter((x) => x.outcome === 'victory');
    // A lost attempt counts as the 180 s cap, so losing is never "faster".
    const time = median(rs.map((x) => (x.outcome === 'victory' ? x.seconds : 180)));
    return { id: l.id, wins: wins.length, time, hp: median(rs.map((x) => x.playerBase)) };
  });
}

test('mob slot order: a fixed-count mob in Mob 1 fires as the mix, with any cannon', () => {
  const level = LEVELS[0];
  for (const cannon of ['popgun', 'repeater', 'blunderbuss']) {
    for (const mob of ['knight', 'bomber']) {
      const a = resolveCase(level, { name: '', ids: { cannon, mobs: [mob, 'rifleman'] } });
      const b = resolveCase(level, { name: '', ids: { cannon, mobs: ['rifleman', mob] } });
      assert.deepEqual(play(a.level, 'human', 0, a.loadout), play(b.level, 'human', 0, b.loadout), `${cannon} ${mob}`);
    }
  }
});

const starter = summary(STARTER_CASE);
const CASES: ItemCase[] = [
  { name: 'bomber (slot 1)', ids: { mobs: ['bomber', 'rifleman'] } },
  { name: 'repeater, knight 1', ids: { cannon: 'repeater', mobs: ['knight', 'rifleman'] } },
  { name: 'blunderbuss', ids: { cannon: 'blunderbuss' } },
];

for (const c of CASES) {
  test(`item balance: ${c.name} is no strict upgrade over the starter on all ten levels`, () => {
    const s = summary(c);
    console.log(
      `  ${c.name.padEnd(18)} ` +
        s
          .map((r, i) => `${r.id} ${r.time.toFixed(0)}s/${starter[i].time.toFixed(0)}s ${(r.hp * 100).toFixed(0)}%`)
          .join('  '),
    );
    const better = s.filter((r, i) => r.time < starter[i].time && r.hp > starter[i].hp).length;
    assert.ok(better < s.length, `${c.name} beats the starter on time and base HP on every level`);
    const total = (xs: { time: number }[]) => xs.reduce((n, r) => n + r.time, 0);
    assert.ok(
      total(s) >= 0.85 * total(starter),
      `${c.name}: ${total(s).toFixed(0)} s over ten levels vs starter ${total(starter).toFixed(0)} s`,
    );
  });
}
