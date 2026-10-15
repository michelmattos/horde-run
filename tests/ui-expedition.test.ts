// Expedition screens: pure map layout (thumb-sized, apart, on screen, boss on top,
// deterministic) and the HP, gold, price and date formatting helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RunMap, RunNode, RunNodeKind } from '../src/contracts.ts';
import {
  EDGE_MARGIN,
  NODE_INFO,
  countUp,
  formatDailyDate,
  formatGold,
  formatHp,
  healPreview,
  hpPercent,
  hpTone,
  priceState,
  runMapLayout,
} from '../src/ui/expedition/layout.ts';

// Small local LCG so the fixtures do not depend on the run-core module.
function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// A run-shaped map: 7 rows (3 / 2-3 ... / boss), x jittered like the real generator
// (or pushed to the extremes), edges to the neighbouring columns of the next row.
function fixtureMap(seed: number, jitter = 0.06): RunMap {
  const rnd = lcg(seed);
  const kinds: RunNodeKind[][] = [];
  const rows: RunNode[][] = [];
  for (let row = 0; row < 7; row++) {
    const width = row === 0 ? 3 : row === 6 ? 1 : 2 + Math.floor(rnd() * 2);
    const k: RunNodeKind[] = Array.from({ length: width }, (): RunNodeKind => {
      if (row === 6) return 'boss';
      if (row === 2 || row === 5) return rnd() < 0.5 ? 'shop' : 'rest';
      return row > 0 && rnd() < 0.3 ? 'elite' : 'battle';
    });
    kinds.push(k);
    rows.push(
      k.map((kind, col) => ({
        id: `r${row}c${col}`,
        row,
        col,
        x: (col + 0.5) / width + (width === 1 ? 0 : (rnd() * 2 - 1) * jitter),
        kind,
        next: [],
      })),
    );
  }
  for (let row = 0; row < 6; row++) {
    const to = rows[row + 1];
    for (const n of rows[row]) {
      const near = to
        .map((t, i) => ({ i, d: Math.abs(t.x - n.x) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 2);
      n.next = near.map((e) => to[e.i].id);
    }
  }
  return { seed, rows: 7, nodes: rows.flat() };
}

const SEEDS = Array.from({ length: 60 }, (_, i) => i * 104729 + 3);

for (const width of [320, 360, 375, 390, 414, 430]) {
  test(`runMapLayout keeps nodes thumb-sized, apart and on a ${width}px board`, () => {
    for (const seed of SEEDS) {
      for (const jitter of [0.06, 0.16]) {
        const map = fixtureMap(seed, jitter);
        const lay = runMapLayout(map, width);
        assert.equal(lay.nodes.length, map.nodes.length);
        for (const n of lay.nodes) {
          assert.ok(n.size >= 48, `${n.id} size ${n.size}`);
          assert.ok(n.x - n.size / 2 >= EDGE_MARGIN - 1e-6, `seed ${seed} ${n.id} left ${n.x}`);
          assert.ok(n.x + n.size / 2 <= width - EDGE_MARGIN + 1e-6, `seed ${seed} ${n.id} right ${n.x}`);
          assert.ok(n.y - n.size / 2 >= 0 && n.y + n.size / 2 <= lay.height, `${n.id} inside height`);
        }
        for (let i = 0; i < lay.nodes.length; i++)
          for (let j = i + 1; j < lay.nodes.length; j++) {
            const a = lay.nodes[i];
            const b = lay.nodes[j];
            const gap = Math.hypot(a.x - b.x, a.y - b.y) - (a.size + b.size) / 2;
            assert.ok(gap >= 8, `seed ${seed} ${a.id}/${b.id} overlap (gap ${gap.toFixed(1)})`);
          }
      }
    }
  });
}

test('runMapLayout puts row 0 at the bottom and the bigger boss alone on top', () => {
  const map = fixtureMap(42);
  const lay = runMapLayout(map, 390);
  const byId = new Map(lay.nodes.map((n) => [n.id, n]));
  const boss = lay.nodes.find((n) => map.nodes.find((m) => m.id === n.id)?.kind === 'boss');
  assert.ok(boss);
  assert.ok(boss.size >= 88);
  for (const n of lay.nodes) if (n !== boss) assert.ok(n.y > boss.y, `${n.id} below the boss`);
  for (const n of map.nodes) {
    const p = byId.get(n.id);
    assert.ok(p);
    for (const id of n.next) assert.ok(byId.get(id)!.y < p.y, `${n.id} -> ${id} climbs`);
  }
  // Columns keep their left-to-right order within a row.
  for (let row = 0; row < 7; row++) {
    const xs = map.nodes.filter((n) => n.row === row).map((n) => byId.get(n.id)!.x);
    for (let i = 1; i < xs.length; i++) assert.ok(xs[i] > xs[i - 1]);
  }
});

test('runMapLayout draws one edge per link and is deterministic', () => {
  const map = fixtureMap(7);
  const a = runMapLayout(map, 375);
  const b = runMapLayout(structuredClone(map), 375);
  assert.deepEqual(a, b);
  const links = map.nodes.reduce((s, n) => s + n.next.length, 0);
  assert.equal(a.edges.length, links);
  for (const e of a.edges) assert.match(e.d, /^M[\d.]+,[\d.]+ C/);
});

test('HP helpers clamp, tone and preview heals', () => {
  assert.equal(hpPercent(50, 100), 50);
  assert.equal(hpPercent(-5, 100), 0);
  assert.equal(hpPercent(150, 100), 100);
  assert.equal(hpPercent(10, 0), 0);
  assert.equal(hpTone(80, 100), 'good');
  assert.equal(hpTone(40, 100), 'warn');
  assert.equal(hpTone(20, 100), 'low');
  assert.equal(formatHp(72.4, 100), '72/100');
  assert.deepEqual(healPreview(80, 100, 30), { to: 100, gained: 20 });
  assert.deepEqual(healPreview(40, 100, 30), { to: 70, gained: 30 });
});

test('gold, price, date and count-up formatting', () => {
  assert.equal(formatGold(0), '0');
  assert.equal(formatGold(999), '999');
  assert.equal(formatGold(1250), '1,250');
  assert.equal(formatGold(1234567), '1,234,567');
  assert.equal(priceState(40, 50, false), 'afford');
  assert.equal(priceState(40, 39, false), 'poor');
  assert.equal(priceState(40, 99, true), 'sold');
  assert.equal(formatDailyDate('2026-10-14'), 'Oct 14');
  assert.equal(formatDailyDate('2026-01-02'), 'Jan 2');
  assert.equal(formatDailyDate('bad'), 'bad');
  assert.equal(countUp(40, 0, 150), 0);
  assert.equal(countUp(40, 150, 150), 40);
  assert.equal(countUp(40, 999, 0), 40);
  const mid = countUp(40, 75, 150);
  assert.ok(mid > 20 && mid < 40);
  for (const k of ['battle', 'elite', 'shop', 'rest', 'boss'] as const) assert.ok(NODE_INFO[k].label.length > 0);
});
