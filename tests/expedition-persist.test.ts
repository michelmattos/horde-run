// Expedition persistence: its own key, round trips, garbage tolerance and best scores.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPEDITION_KEY,
  emptyExpedition,
  loadExpedition,
  recordRunEnd,
  saveExpedition,
} from '../src/expedition/persist.ts';
import { chooseNode, finishBattle, leaveShop, newRun, pickUpgrade, restHeal, runScore } from '../src/expedition/run.ts';
import { availableNodes } from '../src/expedition/map.ts';
import { SAVE_KEY } from '../src/core/save.ts';
import type { KeyValueStore } from '../src/core/save.ts';
import type { RunState } from '../src/contracts.ts';

function memStore(init: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...init };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

const midRun = (): RunState =>
  finishBattle(chooseNode(newRun(31, { daily: '2026-10-14' }), 'r0c0'), {
    victory: true,
    baseHpFraction: 0.4,
    seconds: 70,
  });

test('round trip keeps the run and bests, under its own key', () => {
  const store = memStore({ [SAVE_KEY]: '{"version":1,"levels":{}}' });
  const s = { ...emptyExpedition(), run: midRun() };
  s.best.daily['2026-10-13'] = 900;
  saveExpedition(s, store);
  assert.notEqual(EXPEDITION_KEY, SAVE_KEY);
  assert.equal(store.data[SAVE_KEY], '{"version":1,"levels":{}}');
  const back = loadExpedition(store);
  assert.deepEqual(back, s);
  assert.equal(back.run!.phase, 'pick');
});

test('every phase of a run survives a round trip', () => {
  const store = memStore();
  let run = newRun(4);
  const phases = new Set<string>();
  for (let i = 0; i < 40 && run.phase !== 'over'; i++) {
    saveExpedition({ ...emptyExpedition(), run }, store);
    assert.deepEqual(loadExpedition(store).run, run);
    phases.add(run.phase);
    if (run.phase === 'map') run = chooseNode(run, availableNodes(run)[0]);
    else if (run.phase === 'battle') run = finishBattle(run, { victory: true, baseHpFraction: 0.9, seconds: 10 });
    else if (run.phase === 'pick') run = pickUpgrade(run, run.offer![0]);
    else if (run.phase === 'shop') run = leaveShop(run);
    else run = restHeal(run);
  }
  saveExpedition({ ...emptyExpedition(), run }, store);
  assert.deepEqual(loadExpedition(store).run, run);
  assert.equal(run.outcome, 'won');
  assert.ok(['map', 'battle', 'pick'].every((p) => phases.has(p)));
  assert.ok(phases.has('shop') || phases.has('rest'));
});

test('garbage input never throws; a bad run is dropped but bests survive', () => {
  const best = { daily: { '2026-10-01': 1200 }, bestScore: 1500, runsPlayed: 4, runsWon: 1 };
  assert.deepEqual(loadExpedition(memStore()), emptyExpedition());
  assert.deepEqual(loadExpedition(null), emptyExpedition());
  for (const raw of ['not json', '[]', 'null', '42', '{"version":2}', '{}']) {
    assert.deepEqual(loadExpedition(memStore({ [EXPEDITION_KEY]: raw })), emptyExpedition(), raw);
  }
  const throwing: KeyValueStore = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('full');
    },
  };
  assert.deepEqual(loadExpedition(throwing), emptyExpedition());
  assert.doesNotThrow(() => saveExpedition(emptyExpedition(), throwing));

  const good = midRun();
  const broken: ((r: Record<string, unknown>) => void)[] = [
    (r) => delete r.map,
    (r) => ((r.map as { rows: number }).rows = 5),
    (r) => ((r.map as { nodes: unknown[] }).nodes = []),
    (r) => ((r.map as { nodes: { next: string[] }[] }).nodes[0].next = ['r5c0']),
    (r) => ((r.map as { nodes: { kind: string }[] }).nodes[0].kind = 'casino'),
    (r) => (r.hp = 'lots'),
    (r) => (r.hp = 500),
    (r) => (r.phase = 'dancing'),
    (r) => (r.at = 'r9c9'),
    (r) => (r.visited = [1, 2]),
    (r) => (r.offer = ['nope']),
    (r) => (r.outcome = 'won'), // won while still active
    (r) => delete r.stats,
    (r) => (r.upgrades = { tough: -1 }),
    (r) => (r.version = 2),
  ];
  for (const breakIt of broken) {
    const r = JSON.parse(JSON.stringify(good)) as Record<string, unknown>;
    breakIt(r);
    const out = loadExpedition(memStore({ [EXPEDITION_KEY]: JSON.stringify({ version: 1, run: r, best }) }));
    assert.equal(out.run, undefined, breakIt.toString());
    assert.deepEqual(out.best, best);
  }
  // Bad best fields fall back individually.
  const odd = loadExpedition(
    memStore({
      [EXPEDITION_KEY]: JSON.stringify({ version: 1, best: { daily: { a: 'x', b: 5 }, bestScore: -3, runsPlayed: 2 } }),
    }),
  );
  assert.deepEqual(odd.best, { daily: { b: 5 }, bestScore: 0, runsPlayed: 2, runsWon: 0 });
  // Upgrade ids no longer in the pool are dropped, not fatal.
  const r = JSON.parse(JSON.stringify(good)) as RunState;
  r.upgrades = { tough: 2, retired: 1 };
  const kept = loadExpedition(memStore({ [EXPEDITION_KEY]: JSON.stringify({ version: 1, run: r, best }) }));
  assert.deepEqual(kept.run!.upgrades, { tough: 2 });
});

test('recordRunEnd updates bests, the daily best only for daily runs, and clears the run', () => {
  const won: RunState = { ...newRun(1), phase: 'over', outcome: 'won', stats: { ...newRun(1).stats, battlesWon: 5 } };
  const score = runScore(won);
  let s = recordRunEnd({ ...emptyExpedition(), run: won }, won);
  assert.equal(s.run, undefined);
  assert.deepEqual(s.best, { daily: {}, bestScore: score, runsPlayed: 1, runsWon: 1 });

  const daily: RunState = { ...newRun(2, { daily: '2026-10-14' }), phase: 'over', outcome: 'lost', hp: 0 };
  s = recordRunEnd(s, daily);
  assert.deepEqual(s.best, { daily: { '2026-10-14': runScore(daily) }, bestScore: score, runsPlayed: 2, runsWon: 1 });
  const better: RunState = { ...won, daily: '2026-10-14' };
  const before = structuredClone(s);
  s = recordRunEnd(s, better);
  assert.equal(s.best.daily['2026-10-14'], score);
  s = recordRunEnd(s, daily);
  assert.equal(s.best.daily['2026-10-14'], score); // keeps the best
  assert.equal(before.best.runsPlayed, 2); // input untouched
});
