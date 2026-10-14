import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/index.ts';
import { LAYOUT, SIM_DT, Team, UnitKind, gateX } from '../src/contracts.ts';
import type { GateDef, LevelDef, SimEvent } from '../src/contracts.ts';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function level(gates: GateDef[] = [], width = 10, length = 300): LevelDef {
  return {
    id: 'test',
    name: 'Test',
    lane: { width, length },
    cannon: { fireRate: 8, unitsPerShot: 1, aimLimit: 4 },
    playerBase: { hp: 100 },
    enemyBase: { hp: 100, x: 0, width },
    gates,
    enemyWaves: [],
    champion: { chargeNeeded: 30, hp: 60, damage: 20 },
  };
}

function gate(op: GateDef['op'], value: number, z = 10, extra: Partial<GateDef> = {}): GateDef {
  return { id: `${op}${value}`, op, value, x: 0, z, width: 10, ...extra };
}

function run(sim: ReturnType<typeof createSim>, steps: number, events: SimEvent[] = []): SimEvent[] {
  for (let i = 0; i < steps; i++) sim.step(SIM_DT, events);
  return events;
}

test('x3 gate triples weight, clones inherit the mask and burst apart', () => {
  const sim = createSim(level([gate('mul', 3)]), mulberry32(1));
  sim.spawn(Team.Player, UnitKind.Mob, 0, 9, 1);
  const ev = run(sim, 30);
  assert.equal(sim.totals().player, 3);
  assert.equal(sim.view.count, 3);
  const gateEvents = ev.filter((e) => e.type === 'gate');
  assert.equal(gateEvents.length, 1);
  assert.equal(gateEvents[0].type === 'gate' && gateEvents[0].added, 2);
  const keys = new Set<string>();
  for (let i = 0; i < sim.view.count; i++) keys.add(`${sim.view.posX[i]},${sim.view.posZ[i]}`);
  assert.equal(keys.size, 3, 'units must not share one exact point');
  run(sim, 120, ev);
  assert.equal(sim.totals().player, 3, 'clones must not retrigger the gate');
  assert.equal(ev.filter((e) => e.type === 'gate').length, 1);
});

test('+N adds N, -N kills a single unit', () => {
  const add = createSim(level([gate('add', 10)]), mulberry32(2));
  add.spawn(Team.Player, UnitKind.Mob, 0, 9, 1);
  run(add, 30);
  assert.equal(add.totals().player, 11);

  const sub = createSim(level([gate('sub', 5)]), mulberry32(3));
  sub.spawn(Team.Player, UnitKind.Mob, 0, 9, 1);
  const ev = run(sub, 30);
  assert.equal(sub.totals().player, 0);
  assert.equal(sub.view.count, 0);
  const g = ev.find((e) => e.type === 'gate');
  assert.ok(g && g.type === 'gate' && g.added === -1);
});

test('÷2 over 1000 single units leaves about half', () => {
  const sim = createSim(level([gate('div', 2, 20)]), mulberry32(4));
  sim.spawn(Team.Player, UnitKind.Mob, 0, 5, 1000, { spread: 4.5 });
  run(sim, 600);
  const p = sim.totals().player;
  assert.ok(p >= 450 && p <= 550, `expected ~500, got ${p}`);
});

test('a moving gate is hit only at its current x', () => {
  const g = gate('add', 5, 7, { width: 1, move: { amplitude: 3, period: 4 } });
  // A unit spawned 7 units before the gate crosses it at t ~= 1s, when gateX = +3.
  const crossAt = (x: number): number => {
    const sim = createSim(level([g]), mulberry32(5));
    sim.spawn(Team.Player, UnitKind.Mob, x, 0, 1);
    run(sim, 90);
    return sim.totals().player;
  };
  assert.ok(Math.abs(gateX(g, 1) - 3) < 1e-9);
  assert.equal(crossAt(3), 6);
  assert.equal(crossAt(0), 1, 'static position must not trigger a moving gate');
  assert.equal(crossAt(-3), 1);
});

test('stacked player mob cancels 1:1 by weight against singles', () => {
  const sim = createSim(level([], 1.2, 100), mulberry32(6), { unitBudget: 21 });
  sim.spawn(Team.Enemy, UnitKind.Mob, 0, 30, 20);
  sim.spawn(Team.Player, UnitKind.Mob, 0, 5, 20); // budget leaves room for one stacked unit
  assert.equal(sim.view.count, 21);
  let maxW = 0;
  for (let i = 0; i < sim.view.count; i++) maxW = Math.max(maxW, sim.view.weight[i]);
  assert.equal(maxW, 20);
  const ev = run(sim, 600);
  assert.deepEqual(sim.totals(), { player: 0, enemy: 0 });
  assert.ok(!ev.some((e) => e.type === 'baseHit'));
  assert.ok(ev.some((e) => e.type === 'unitsClash'));
});

test('single mobs cancel 1:1 and the larger side keeps the difference', () => {
  const sim = createSim(level([], 4, 200), mulberry32(7));
  sim.spawn(Team.Player, UnitKind.Mob, 0, 5, 30, { spread: 1.5 });
  sim.spawn(Team.Enemy, UnitKind.Mob, 0, 60, 18, { spread: 1.5 });
  run(sim, 400);
  const t = sim.totals();
  assert.equal(t.enemy, 0);
  assert.equal(t.player, 12);
});

test('champion with 60 hp absorbs 60 mobs', () => {
  const sim = createSim(level([], 2.2, 200), mulberry32(8));
  sim.spawn(Team.Player, UnitKind.Champion, 0, 5, 1, { hp: 60, damage: 20 });
  sim.spawn(Team.Enemy, UnitKind.Mob, 0, 60, 70, { spread: 0.8 });
  const ev = run(sim, 900);
  assert.equal(sim.totals().player, 0);
  assert.equal(sim.totals().enemy, 0);
  const hits = ev.filter((e) => e.type === 'baseHit');
  const dmg = hits.reduce((s, e) => s + (e.type === 'baseHit' ? e.damage : 0), 0);
  assert.equal(dmg, 10, '10 surviving enemies reach the player base');
});

test('base hits report the owner of the base, damage and remove the unit', () => {
  const L = level([], 10, 50);
  const sim = createSim(L, mulberry32(9));
  sim.spawn(Team.Player, UnitKind.Mob, 0, L.lane.length - 0.05, 1);
  sim.spawn(Team.Enemy, UnitKind.Mob, 0, LAYOUT.playerBaseZ + 0.05, 1, { damage: 4 });
  sim.spawn(Team.Player, UnitKind.Champion, 0, 25, 1, { hp: 60, damage: 20 });
  const ev = run(sim, 1);
  const hits = ev.filter((e) => e.type === 'baseHit');
  assert.equal(hits.length, 2);
  const enemyBase = hits.find((e) => e.type === 'baseHit' && e.team === Team.Enemy);
  const playerBase = hits.find((e) => e.type === 'baseHit' && e.team === Team.Player);
  assert.ok(enemyBase && enemyBase.type === 'baseHit' && enemyBase.damage === 1);
  assert.ok(playerBase && playerBase.type === 'baseHit' && playerBase.damage === 4);
  assert.equal(sim.view.count, 1);
  assert.equal(sim.view.kind[0], UnitKind.Champion);
  const champEv = run(sim, 600);
  const ch = champEv.find((e) => e.type === 'baseHit');
  assert.ok(ch && ch.type === 'baseHit' && ch.team === Team.Enemy && ch.damage === 20);
  assert.equal(sim.view.count, 0);
});

test('unit budget is respected while weight is preserved', () => {
  const sim = createSim(level(), mulberry32(10));
  sim.spawn(Team.Player, UnitKind.Mob, 0, 2, 5000);
  assert.ok(sim.view.count <= sim.unitBudget);
  assert.equal(sim.totals().player, 5000);

  const many = createSim(level(), mulberry32(11));
  for (let k = 0; k < 50; k++) {
    many.spawn(Team.Player, UnitKind.Mob, 0, 2, 100);
    many.step(SIM_DT, []);
  }
  assert.ok(many.view.count <= many.unitBudget, `count ${many.view.count}`);
  assert.equal(many.totals().player, 5000);
});

test('gate clones beyond the budget stack onto the crossing unit', () => {
  const sim = createSim(level([gate('mul', 3)]), mulberry32(12), { unitBudget: 100 });
  sim.spawn(Team.Player, UnitKind.Mob, 0, 9, 80, { spread: 4 });
  run(sim, 60);
  assert.ok(sim.view.count <= 100);
  assert.equal(sim.totals().player, 240);
});

test('determinism: same seed and calls give identical arrays', () => {
  const L = level([gate('mul', 2, 15), gate('div', 2, 30, { width: 4, move: { amplitude: 2, period: 3 } })], 10, 80);
  const make = () => {
    const sim = createSim(L, mulberry32(42));
    for (let s = 0; s < 600; s++) {
      if (s % 10 === 0) sim.spawn(Team.Player, UnitKind.Mob, Math.sin(s) * 3, LAYOUT.cannonZ, 3);
      if (s % 25 === 0) sim.spawn(Team.Enemy, UnitKind.Mob, 0, 78.5, 8, { spread: 3 });
      if (s === 300) sim.spawn(Team.Player, UnitKind.Champion, 0, LAYOUT.cannonZ, 1, { hp: 60, damage: 20 });
      sim.step(SIM_DT, []);
    }
    return sim;
  };
  const a = make();
  const b = make();
  assert.ok(a.view.count > 0);
  assert.equal(a.view.count, b.view.count);
  assert.deepEqual(a.view.posX.subarray(0, a.view.count), b.view.posX.subarray(0, b.view.count));
  assert.deepEqual(a.view.posZ.subarray(0, a.view.count), b.view.posZ.subarray(0, b.view.count));
});

test('units stay inside the lane', () => {
  const L = level([gate('mul', 3, 10, { x: 4, width: 3 })], 6, 60);
  const sim = createSim(L, mulberry32(13));
  sim.spawn(Team.Player, UnitKind.Mob, 2.9, 2, 300, { spread: 5 });
  sim.spawn(Team.Enemy, UnitKind.Mob, -2.9, 58, 200, { spread: 5 });
  sim.spawn(Team.Player, UnitKind.Champion, 3, 2, 1, { hp: 60 });
  for (let s = 0; s < 400; s++) {
    sim.step(SIM_DT, []);
    const v = sim.view;
    for (let i = 0; i < v.count; i++) {
      const lim = Math.max(0, L.lane.width / 2 - v.radius[i]) + 1e-5;
      assert.ok(Math.abs(v.posX[i]) <= lim, `unit ${i} at x=${v.posX[i]} r=${v.radius[i]}`);
    }
  }
});

test('more than 32 gates is rejected', () => {
  const gates: GateDef[] = [];
  for (let i = 0; i < 33; i++) gates.push(gate('add', 1, 5 + i));
  assert.throws(() => createSim(level(gates), mulberry32(1)), /at most 32/);
});
