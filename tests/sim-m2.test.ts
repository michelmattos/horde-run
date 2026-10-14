// Milestone 2 sim mechanics: towers, walls, champions vs walls, one-use gates and the
// movable (boss) enemy base.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/index.ts';
import { SIM_DT, Team, UnitKind } from '../src/contracts.ts';
import type { DefenderDef, GateDef, LevelDef, SimEvent } from '../src/contracts.ts';

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

function level(over: Partial<LevelDef> = {}): LevelDef {
  return {
    id: 'm2',
    name: 'M2',
    lane: { width: 10, length: 60 },
    cannon: { fireRate: 8, unitsPerShot: 1, aimLimit: 4 },
    playerBase: { hp: 100 },
    enemyBase: { hp: 100, x: 0, width: 4 },
    gates: [],
    enemyWaves: [],
    champion: { chargeNeeded: 30, hp: 60, damage: 20 },
    ...over,
  };
}

function run(sim: ReturnType<typeof createSim>, steps: number, events: SimEvent[] = []): SimEvent[] {
  for (let i = 0; i < steps; i++) sim.step(SIM_DT, events);
  return events;
}

const of = <T extends SimEvent['type']>(ev: SimEvent[], type: T) => ev.filter((e) => e.type === type) as Extract<SimEvent, { type: T }>[];

test('defenders are exposed with defaults filled in, and more than 16 is rejected', () => {
  const sim = createSim(level({ defenders: [{ id: 't', kind: 'tower', x: 1, z: 30, hp: 40 }, { id: 'w', kind: 'wall', x: 0, z: 20, hp: 80 }] }), mulberry32(1));
  assert.deepEqual(
    sim.defenders.map((d) => ({ ...d })),
    [
      { id: 't', kind: 'tower', x: 1, z: 30, width: 1.6, depth: 1.6, hp: 40, maxHp: 40 },
      { id: 'w', kind: 'wall', x: 0, z: 20, width: 4, depth: 1, hp: 80, maxHp: 80 },
    ],
  );
  assert.deepEqual(createSim(level(), mulberry32(1)).defenders, []);
  const many: DefenderDef[] = Array.from({ length: 17 }, (_, i) => ({ id: `d${i}`, kind: 'wall', x: 0, z: 10 + i, hp: 5 }));
  assert.throws(() => createSim(level({ defenders: many }), mulberry32(1)), /at most 16/);
});

test('a tower shoots the nearest player unit in range and respects its fire rate', () => {
  const sim = createSim(level({ defenders: [{ id: 't', kind: 'tower', x: 4, z: 30, hp: 50, range: 6, fireRate: 2, damage: 1 }] }), mulberry32(2));
  // Parked targets: SIM_TUNING moves them, so spawn far and check the first shot only.
  sim.spawn(Team.Player, UnitKind.Mob, -4, 26, 1); // distance ~8.9: out of range
  sim.spawn(Team.Player, UnitKind.Mob, 2, 27, 1); // distance ~3.6 now, nearest
  sim.spawn(Team.Enemy, UnitKind.Mob, 4, 31, 1); // enemies are never targeted
  const ev = run(sim, 1);
  const shots = of(ev, 'defenderShot');
  assert.equal(shots.length, 1);
  assert.equal(shots[0].id, 't');
  assert.ok(Math.abs(shots[0].tx - 2) < 0.2, `shot at x=${shots[0].tx}`);
  assert.equal(sim.totals().player, 1);

  // A steady supply of targets: 2 shots/s over 3 s.
  const s2 = createSim(level({ defenders: [{ id: 't', kind: 'tower', x: 4, z: 30, hp: 50, range: 8, fireRate: 2, damage: 1 }] }), mulberry32(3));
  const all: SimEvent[] = [];
  for (let k = 0; k < 180; k++) {
    if (k % 6 === 0) s2.spawn(Team.Player, UnitKind.Mob, 2, 24, 1);
    s2.step(SIM_DT, all);
  }
  const n = of(all, 'defenderShot').length;
  assert.ok(n >= 5 && n <= 7, `${n} shots in 3 s`);
});

test('tower damage reduces a stacked mob by weight', () => {
  const sim = createSim(level({ lane: { width: 2, length: 60 }, enemyBase: { hp: 100, x: 0, width: 2 }, defenders: [{ id: 't', kind: 'tower', x: 0, z: 35, hp: 50, range: 8, fireRate: 1, damage: 3 }] }), mulberry32(4), { unitBudget: 1 });
  sim.spawn(Team.Player, UnitKind.Mob, 0, 29, 10);
  assert.equal(sim.view.count, 1);
  run(sim, 1);
  assert.equal(sim.totals().player, 7);
  assert.equal(sim.view.weight[0], 7);
});

test('mobs die on a wall and damage it; defenderHit is one per step and defenderDestroyed fires once', () => {
  const sim = createSim(level({ defenders: [{ id: 'w', kind: 'wall', x: 0, z: 20, hp: 30, width: 6 }] }), mulberry32(5));
  sim.spawn(Team.Player, UnitKind.Mob, 0, 15, 20, { spread: 2 });
  const ev = run(sim, 120);
  assert.equal(sim.totals().player, 0);
  assert.equal(sim.defenders[0].hp, 10);
  const hits = of(ev, 'defenderHit');
  assert.equal(hits.reduce((s, e) => s + e.damage, 0), 20);
  assert.equal(of(ev, 'defenderDestroyed').length, 0);

  sim.spawn(Team.Player, UnitKind.Mob, 0, 15, 25, { spread: 2 });
  const ev2 = run(sim, 600);
  assert.equal(sim.defenders[0].hp, 0);
  assert.equal(sim.totals().player, 0, 'survivors walk on and hit the base');
  const destroyed = of(ev2, 'defenderDestroyed');
  assert.equal(destroyed.length, 1);
  assert.deepEqual(destroyed[0], { type: 'defenderDestroyed', id: 'w', kind: 'wall', x: 0, z: 20 });
  const dmg = of(ev2, 'baseHit').reduce((s, e) => s + e.damage, 0);
  assert.equal(dmg, 15, '25 mobs minus the 10 hp the wall had left');

  // A dense crowd hitting the wall in one step still yields a single aggregated defenderHit.
  const s3 = createSim(level({ defenders: [{ id: 'w', kind: 'wall', x: 0, z: 20, hp: 500, width: 10 }] }), mulberry32(5));
  s3.spawn(Team.Player, UnitKind.Mob, 0, 15, 200, { spread: 2.5 });
  for (let k = 0; k < 300; k++) {
    const e: SimEvent[] = [];
    s3.step(SIM_DT, e);
    assert.ok(of(e, 'defenderHit').length <= 1);
  }
  assert.equal(s3.defenders[0].hp, 300);
});

test('enemy units ignore defenders', () => {
  const sim = createSim(level({ defenders: [{ id: 'w', kind: 'wall', x: 0, z: 20, hp: 30, width: 10 }] }), mulberry32(6));
  sim.spawn(Team.Enemy, UnitKind.Mob, 0, 40, 5, { spread: 2 });
  const ev = run(sim, 600);
  assert.equal(sim.defenders[0].hp, 30);
  assert.equal(of(ev, 'baseHit').reduce((s, e) => s + e.damage, 0), 5);
});

test('a champion is held by a wall, strikes every 0.5 s, then breaks it and walks on', () => {
  const sim = createSim(level({ defenders: [{ id: 'w', kind: 'wall', x: 0, z: 20, hp: 100, width: 10 }] }), mulberry32(7));
  sim.spawn(Team.Player, UnitKind.Champion, 0, 10, 1, { hp: 60, damage: 20 });
  const ev = run(sim, 150); // reaches the wall at ~1.9 s, held from there
  const z = sim.view.posZ[0];
  assert.ok(z < 20, `held before the wall at z=${z}`);
  const hits = of(ev, 'defenderHit');
  assert.ok(hits.length >= 1 && hits.every((h) => h.damage === 20));
  run(sim, 30, ev);
  assert.ok(Math.abs(sim.view.posZ[0] - z) < 0.05, 'still held');
  const ev2 = run(sim, 900, ev);
  assert.equal(sim.defenders[0].hp, 0);
  assert.equal(of(ev2, 'defenderHit').length, 5, '100 hp / 20 per blow');
  assert.equal(of(ev2, 'defenderDestroyed').length, 1);
  const base = of(ev2, 'baseHit');
  assert.equal(base.length, 1);
  assert.equal(base[0].damage, 20);
  // Blows are 0.5 s apart.
  const times: number[] = [];
  const s2 = createSim(level({ defenders: [{ id: 'w', kind: 'wall', x: 0, z: 20, hp: 100, width: 10 }] }), mulberry32(7));
  s2.spawn(Team.Player, UnitKind.Champion, 0, 10, 1, { hp: 60, damage: 20 });
  for (let k = 0; k < 600; k++) {
    const e: SimEvent[] = [];
    s2.step(SIM_DT, e);
    if (e.some((x) => x.type === 'defenderHit')) times.push(s2.time);
  }
  assert.equal(times.length, 5);
  for (let k = 1; k < times.length; k++) assert.ok(Math.abs(times[k] - times[k - 1] - 0.5) < SIM_DT + 1e-9);
});

test('a champion held at a wall is not pushed into it by mobs streaming behind', () => {
  // Wall at z=20, depth 1: front face at 19.5. Champion radius comes from the sim view.
  const sim = createSim(level({ defenders: [{ id: 'w', kind: 'wall', x: 0, z: 20, hp: 100000, width: 10 }] }), mulberry32(3));
  sim.spawn(Team.Player, UnitKind.Champion, 0, 10, 1, { hp: 60, damage: 1 });
  const face = 20 - sim.defenders[0].depth / 2;
  let worst = -Infinity;
  for (let s = 0; s < 60 * 20; s++) {
    if (s % 10 === 0) sim.spawn(Team.Player, UnitKind.Mob, 0, 2, 3, { spread: 0.3 });
    sim.step(SIM_DT, []);
    const v = sim.view;
    for (let i = 0; i < v.count; i++) {
      if (v.kind[i] === UnitKind.Champion) worst = Math.max(worst, v.posZ[i] + v.radius[i]);
    }
  }
  assert.ok(worst <= face + 1e-3, `champion front ${worst.toFixed(3)} past the wall face ${face}`);
});

test('a one-use gate breaks at its budget and stops applying', () => {
  const gate: GateDef = { id: 'g', op: 'mul', value: 2, x: 0, z: 10, width: 10, uses: 5 };
  const sim = createSim(level({ gates: [gate] }), mulberry32(8));
  const ev: SimEvent[] = [];
  for (let k = 0; k < 8; k++) {
    sim.spawn(Team.Player, UnitKind.Mob, 0, 5, 1);
    run(sim, 20, ev);
  }
  run(sim, 60, ev);
  const gateEv = of(ev, 'gate');
  assert.equal(gateEv.length, 5);
  assert.deepEqual(gateEv.map((e) => e.usesLeft), [4, 3, 2, 1, 0]);
  assert.ok(gateEv.every((e) => e.added === 1));
  const broken = of(ev, 'gateBroken');
  assert.equal(broken.length, 1);
  assert.deepEqual(broken[0], { type: 'gateBroken', gateId: 'g', x: 0, z: 10 });
  assert.ok(ev.indexOf(broken[0]) > ev.indexOf(gateEv[4]));
  assert.equal(sim.totals().player, 5 * 2 + 3);

  // Unlimited gates carry no usesLeft.
  const s2 = createSim(level({ gates: [{ ...gate, uses: undefined }] }), mulberry32(8));
  s2.spawn(Team.Player, UnitKind.Mob, 0, 5, 1);
  const e2 = of(run(s2, 60), 'gate');
  assert.equal(e2.length, 1);
  assert.ok(!('usesLeft' in e2[0]) || e2[0].usesLeft === undefined);
});

test('a one-use gate crossed by a heavy unit applies fully, then breaks', () => {
  const sim = createSim(level({ lane: { width: 2, length: 60 }, enemyBase: { hp: 1, x: 0, width: 2 }, gates: [{ id: 'g', op: 'add', value: 3, x: 0, z: 10, width: 2, uses: 4 }] }), mulberry32(9), { unitBudget: 1, capacity: 20 });
  sim.spawn(Team.Player, UnitKind.Mob, 0, 5, 6);
  const ev = run(sim, 60);
  assert.deepEqual(of(ev, 'gate').map((e) => e.usesLeft), [0]);
  assert.equal(of(ev, 'gateBroken').length, 1);
  assert.equal(sim.totals().player, 9);
});

test('setEnemyBaseX moves the hit span on boss levels; misses give baseMiss', () => {
  const boss = { name: 'Test King', phases: [{ belowHp: 1, strafe: { amplitude: 2, period: 8 } }] };
  const make = () => createSim(level({ lane: { width: 10, length: 30 }, boss }), mulberry32(10));
  const sim = make();
  sim.setEnemyBaseX(3); // base spans x 1..5
  sim.spawn(Team.Player, UnitKind.Mob, 3, 29.95, 1);
  sim.spawn(Team.Player, UnitKind.Mob, -3, 29.95, 1);
  sim.spawn(Team.Player, UnitKind.Mob, -2.5, 29.95, 1);
  const ev = run(sim, 1);
  const hit = of(ev, 'baseHit');
  assert.equal(hit.length, 1);
  assert.equal(hit[0].damage, 1);
  assert.ok(Math.abs(hit[0].x - 3) < 0.01);
  const miss = of(ev, 'baseMiss');
  assert.equal(miss.length, 1);
  assert.equal(miss[0].count, 2);
  assert.ok(Math.abs(miss[0].x + 2.75) < 0.01);
  assert.equal(miss[0].z, 30);
  assert.equal(sim.view.count, 0);

  // No funnel on boss levels: a unit fired far from the base keeps its x and misses.
  const s2 = make();
  s2.setEnemyBaseX(3);
  s2.spawn(Team.Player, UnitKind.Mob, -4, 2, 1);
  const e2 = run(s2, 300);
  assert.equal(of(e2, 'baseHit').length, 0);
  assert.equal(of(e2, 'baseMiss').length, 1);
});

test('static-base levels still funnel every arrival into the base', () => {
  const sim = createSim(level({ lane: { width: 10, length: 30 } }), mulberry32(11));
  sim.setEnemyBaseX(2); // funnel follows the current base x
  sim.spawn(Team.Player, UnitKind.Mob, -4.5, 2, 1);
  const ev = run(sim, 300);
  const hit = of(ev, 'baseHit');
  assert.equal(hit.length, 1);
  assert.ok(hit[0].x >= 0, `funnelled toward x=2, arrived at ${hit[0].x}`);
  assert.equal(of(ev, 'baseMiss').length, 0);
});

test('determinism with defenders, one-use gates and a moving base', () => {
  const L = level({
    lane: { width: 10, length: 80 },
    gates: [{ id: 'a', op: 'mul', value: 2, x: -2, z: 15, width: 4, uses: 60 }],
    defenders: [
      { id: 't1', kind: 'tower', x: 3, z: 40, hp: 60 },
      { id: 'w1', kind: 'wall', x: -2, z: 50, hp: 90 },
    ],
    boss: { name: 'K', phases: [{ belowHp: 1, strafe: { amplitude: 2, period: 6 } }] },
  });
  const make = () => {
    const sim = createSim(L, mulberry32(42));
    const ev: SimEvent[] = [];
    for (let s = 0; s < 900; s++) {
      sim.setEnemyBaseX(2 * Math.sin(s / 60));
      if (s % 10 === 0) sim.spawn(Team.Player, UnitKind.Mob, Math.sin(s) * 3, 1.5, 3);
      if (s % 25 === 0) sim.spawn(Team.Enemy, UnitKind.Mob, 0, 78.5, 6, { spread: 3 });
      if (s === 300) sim.spawn(Team.Player, UnitKind.Champion, -2, 1.5, 1, { hp: 60, damage: 20 });
      sim.step(SIM_DT, ev);
    }
    return { sim, ev };
  };
  const a = make();
  const b = make();
  assert.ok(a.sim.view.count > 0);
  assert.equal(a.sim.view.count, b.sim.view.count);
  assert.deepEqual(a.sim.view.posX.subarray(0, a.sim.view.count), b.sim.view.posX.subarray(0, b.sim.view.count));
  assert.deepEqual(a.sim.defenders.map((d) => d.hp), b.sim.defenders.map((d) => d.hp));
  assert.deepEqual(a.ev, b.ev);
  assert.ok(a.ev.some((e) => e.type === 'defenderShot'));
});

test('perf: 1,500 units and 16 defenders step under budget', () => {
  const defenders: DefenderDef[] = [];
  for (let k = 0; k < 16; k++) {
    defenders.push(
      k % 2 === 0
        ? { id: `t${k}`, kind: 'tower', x: k % 4 === 0 ? -3.5 : 3.5, z: 10 + k * 2.5, hp: 1e9, fireRate: 4 }
        : { id: `w${k}`, kind: 'wall', x: k % 4 === 1 ? -3 : 3, z: 10 + k * 2.5, hp: 1e9, width: 3 },
    );
  }
  const L = level({
    gates: [
      { id: 'a', op: 'mul', value: 2, x: -2.5, z: 15, width: 4 },
      { id: 'b', op: 'add', value: 10, x: 2.5, z: 15, width: 4, move: { amplitude: 1.5, period: 3 } },
    ],
    defenders,
  });
  const sim = createSim(L, mulberry32(99));
  const rand = mulberry32(7);
  const events: SimEvent[] = [];
  for (let k = 0; k < 150; k++) {
    const enemy = (k & 1) === 1;
    const z = enemy ? 31 + rand() * 27 : 1.5 + rand() * 28;
    sim.spawn(enemy ? Team.Enemy : Team.Player, UnitKind.Mob, 0, z, 10, { spread: 4.5 });
  }
  let flip = 0;
  const topUp = () => {
    while (sim.view.count < 1495) {
      flip ^= 1;
      if (flip) sim.spawn(Team.Enemy, UnitKind.Mob, (rand() * 2 - 1) * 4, 58.5, 5, { spread: 0.8 });
      else sim.spawn(Team.Player, UnitKind.Mob, (rand() * 2 - 1) * 4, 1.5, 5, { spread: 0.8 });
    }
  };
  for (let s = 0; s < 30; s++) sim.step(SIM_DT, events);
  let total = 0;
  const steps = 300;
  for (let s = 0; s < steps; s++) {
    topUp();
    events.length = 0;
    const t0 = performance.now();
    sim.step(SIM_DT, events);
    total += performance.now() - t0;
  }
  const avg = total / steps;
  console.log(`sim step with 16 defenders: ${avg.toFixed(3)} ms avg over ${steps} steps, ${sim.view.count} units`);
  assert.ok(avg < 8, `average step ${avg.toFixed(3)} ms`);
});
