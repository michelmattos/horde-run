// Expedition map: row kinds, non-crossing neighbour edges, reachability and fixed path shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RUN_ROWS, availableNodes, generateRunMap } from '../src/expedition/map.ts';
import { newRun } from '../src/expedition/run.ts';
import type { RunMap, RunNode } from '../src/contracts.ts';

const SEEDS = Array.from({ length: 200 }, (_, i) => i * 7919 + 1);
const combat = (n: RunNode) => n.kind === 'battle' || n.kind === 'elite' || n.kind === 'boss';

function rows(map: RunMap): RunNode[][] {
  const out: RunNode[][] = Array.from({ length: map.rows }, () => []);
  for (const n of map.nodes) out[n.row].push(n);
  return out;
}

test('map structure and row kinds hold for 200 seeds', () => {
  for (const seed of SEEDS) {
    const map = generateRunMap(seed);
    assert.equal(map.rows, RUN_ROWS);
    assert.equal(map.seed, seed);
    const r = rows(map);
    assert.equal(r[0].length, 3);
    assert.ok(r[0].every((n) => n.kind === 'battle'));
    let elites = 0;
    for (const row of [1, 3, 4]) {
      assert.ok(r[row].length >= 2 && r[row].length <= 3);
      assert.ok(r[row].every((n) => n.kind === 'battle' || n.kind === 'elite'));
      assert.ok(r[row].some((n) => n.kind === 'battle'));
      const e = r[row].filter((n) => n.kind === 'elite').length;
      assert.ok(e <= 1);
      elites += e;
    }
    assert.ok(elites >= 2, `seed ${seed}: ${elites} elites`);
    for (const row of [2, 5]) {
      assert.ok(r[row].length >= 2 && r[row].length <= 3);
      assert.ok(r[row].some((n) => n.kind === 'shop') && r[row].some((n) => n.kind === 'rest'));
      assert.ok(r[row].every((n) => n.kind === 'shop' || n.kind === 'rest'));
    }
    assert.deepEqual(
      r[6].map((n) => n.kind),
      ['boss'],
    );
    // Order, ids and layout.
    let i = 0;
    for (const row of r) {
      row.forEach((n, col) => {
        assert.equal(map.nodes[i++], n);
        assert.equal(n.col, col);
        assert.equal(n.id, `r${n.row}c${col}`);
        const even = (col + 0.5) / row.length;
        assert.ok(Math.abs(n.x - even) <= 0.06 + 1e-12);
        assert.ok(n.x >= 0 && n.x <= 1);
      });
    }
  }
});

test('edges join neighbouring rows, never cross, and reach every node', () => {
  for (const seed of SEEDS) {
    const map = generateRunMap(seed);
    const r = rows(map);
    const byId = new Map(map.nodes.map((n) => [n.id, n]));
    const incoming = new Map<string, number>();
    for (let row = 0; row < RUN_ROWS - 1; row++) {
      const edges: [number, number][] = [];
      for (const n of r[row]) {
        assert.ok(n.next.length >= 1 && n.next.length <= 2, `${seed} ${n.id} has ${n.next.length} edges`);
        // Targets are the 1 or 2 nearest columns by x.
        const order = r[row + 1]
          .map((t) => ({ id: t.id, d: Math.abs(t.x - n.x) }))
          .sort((a, b) => a.d - b.d)
          .map((t) => t.id);
        assert.deepEqual(new Set(n.next), new Set(order.slice(0, n.next.length)));
        for (const id of n.next) {
          const t = byId.get(id);
          assert.ok(t && t.row === row + 1);
          edges.push([n.col, t.col]);
          incoming.set(id, (incoming.get(id) ?? 0) + 1);
        }
      }
      for (const [a, b] of edges)
        for (const [c, d] of edges) if (a < c) assert.ok(b <= d, `seed ${seed}: crossing edges in row ${row}`);
    }
    assert.deepEqual(r[6][0].next, []);
    for (const n of map.nodes) if (n.row > 0) assert.ok((incoming.get(n.id) ?? 0) >= 1, `${seed} ${n.id} unreachable`);
  }
});

test('every root-to-boss path has exactly 5 combat nodes and 2 stops', () => {
  for (const seed of SEEDS.slice(0, 60)) {
    const map = generateRunMap(seed);
    const byId = new Map(map.nodes.map((n) => [n.id, n]));
    const walk = (n: RunNode, fights: number, stops: number): void => {
      const f = fights + (combat(n) ? 1 : 0);
      const s = stops + (combat(n) ? 0 : 1);
      if (n.kind === 'boss') {
        assert.equal(f, 5);
        assert.equal(s, 2);
        return;
      }
      for (const id of n.next) walk(byId.get(id)!, f, s);
    };
    for (const root of map.nodes.filter((n) => n.row === 0)) walk(root, 0, 0);
  }
});

test('same seed gives a deep-equal map; seeds differ', () => {
  assert.deepEqual(generateRunMap(1234), generateRunMap(1234));
  const shapes = new Set(SEEDS.map((s) => JSON.stringify(generateRunMap(s).nodes.map((n) => [n.kind, n.next]))));
  assert.ok(shapes.size > 50);
});

test('availableNodes: row 0 first, then the current node links, nothing outside the map phase', () => {
  const run = newRun(42);
  assert.deepEqual(availableNodes(run), ['r0c0', 'r0c1', 'r0c2']);
  const at = run.map.nodes[1];
  assert.deepEqual(availableNodes({ ...run, at: at.id, visited: [at.id] }), at.next);
  assert.deepEqual(availableNodes({ ...run, at: at.id, phase: 'battle' }), []);
  assert.deepEqual(availableNodes({ ...run, phase: 'over', outcome: 'lost' }), []);
});
