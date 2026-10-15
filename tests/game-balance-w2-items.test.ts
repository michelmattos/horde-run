// World 2 gear fairness (concept §9.1): the Snowball Launcher, the Giant and the Blizzard
// change how you play, never how strong you are. Each is swapped into the starter on its
// own and played over World 2 (the cannon and the ultimate also over 1-5..1-10): like
// game-balance-items-late, no swap may beat the starter on win time and base HP on every
// level at once (a strict upgrade is a must-pick), and none may be much slower overall
// (total time >= 0.85 x the starter's). The starter alone still wins every World 2 level
// some of the time, so none of them is required. One attempt per level over 16 levels
// keeps the file quick; the hard levels' coin flips even out over the set.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/game/levels.ts';
import type { LevelDef } from '../src/contracts.ts';
import type { ItemCase } from './balance-play.ts';
import { MAX_SECONDS, STARTER_CASE, median, play, resolveCase } from './balance-play.ts';

const ATTEMPTS = 1;
const TRIES = 4; // the starter's attempts per World 2 level until one wins
const W2 = LEVELS.filter((l) => l.id.startsWith('2-'));
const W1_LATE = LEVELS.filter((l) => ['1-5', '1-6', '1-7', '1-8', '1-9', '1-10'].includes(l.id));

interface Row {
  id: string;
  wins: number;
  time: number; // median over the attempts, a loss counted as the 180 s cap
  hp: number; // median base HP fraction left
}

function summary(c: ItemCase, levels: readonly LevelDef[]): Row[] {
  return levels.map((l) => {
    const r = resolveCase(l, c);
    const rs = Array.from({ length: ATTEMPTS }, (_, a) => play(r.level, 'human', a, r.loadout));
    return {
      id: l.id,
      wins: rs.filter((x) => x.outcome === 'victory').length,
      time: median(rs.map((x) => (x.outcome === 'victory' ? x.seconds : MAX_SECONDS))),
      hp: median(rs.map((x) => x.playerBase)),
    };
  });
}

const starterW2 = summary(STARTER_CASE, W2);
const starterW1 = summary(STARTER_CASE, W1_LATE);

test('the starter alone wins every World 2 level some of the time', () => {
  for (const [i, l] of W2.entries()) {
    if (starterW2[i].wins > 0) continue; // attempt 0 already won
    const r = resolveCase(l, STARTER_CASE);
    const won = Array.from({ length: TRIES - 1 }, (_, a) => a + 1).some(
      (a) => play(r.level, 'human', a, r.loadout).outcome === 'victory',
    );
    assert.ok(won, `${l.id}: the starter lost ${TRIES} attempts in a row`);
  }
});

const CASES: { c: ItemCase; alsoW1: boolean }[] = [
  { c: { name: 'snowball launcher', ids: { cannon: 'snowball-launcher' } }, alsoW1: true },
  { c: { name: 'giant (slot 2)', ids: { mobs: ['rifleman', 'giant'] } }, alsoW1: false },
  { c: { name: 'blizzard', ids: { ultimate: 'blizzard' } }, alsoW1: true },
];

for (const { c, alsoW1 } of CASES) {
  test(`World 2 gear: ${c.name} is no strict upgrade over the starter`, () => {
    const s = [...summary(c, W2), ...(alsoW1 ? summary(c, W1_LATE) : [])];
    const base = [...starterW2, ...(alsoW1 ? starterW1 : [])];
    console.log(
      `  ${c.name.padEnd(18)} ` +
        s
          .map((r, i) => `${r.id} ${r.time.toFixed(0)}s/${base[i].time.toFixed(0)}s ${(r.hp * 100).toFixed(0)}%`)
          .join('  '),
    );
    const better = s.filter((r, i) => r.time < base[i].time && r.hp > base[i].hp).length;
    assert.ok(better < s.length, `${c.name} beats the starter on time and base HP on every level`);
    const total = (xs: readonly Row[]) => xs.reduce((n, r) => n + r.time, 0);
    assert.ok(
      total(s) >= 0.85 * total(base),
      `${c.name}: ${total(s).toFixed(0)} s in all vs starter ${total(base).toFixed(0)} s`,
    );
  });
}
