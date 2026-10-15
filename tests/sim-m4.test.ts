// Milestone 4 sim features: per-unit speed and render variant (with the defaults leaving
// old behaviour alone), gate clones and stacks keeping them, death blasts with
// takeBlasts, damageArea's limits and damageDefender.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim, SIM_TUNING } from '../src/sim/index.ts';
import type { SimBlast } from '../src/sim/index.ts';
import { SIM_DT, Team, UnitKind } from '../src/contracts.ts';
import type { LevelDef, SimEvent } from '../src/contracts.ts';

const rand = () => 0.5;

function level(over: Partial<LevelDef> = {}): LevelDef {
  return {
    id: 'm4',
    name: 'M4',
    lane: { width: 10, length: 60 },
    cannon: { fireRate: 6, unitsPerShot: 3, aimLimit: 4 },
    playerBase: { hp: 100 },
    enemyBase: { hp: 100, x: 0, width: 6 },
    gates: [],
    enemyWaves: [],
    champion: { chargeNeeded: 100, hp: 50, damage: 30 },
    ...over,
  };
}

const BLAST = { radius: 1.4, damage: 4 };

test('sim m4: variant goes to the view; default speeds are unchanged, custom speeds are used', () => {
  const sim = createSim(level(), rand);
  sim.spawn(Team.Player, UnitKind.Mob, -3, 5, 1);
  sim.spawn(Team.Player, UnitKind.Mob, 3, 5, 1, { speed: 10, variant: 2 });
  sim.spawn(Team.Enemy, UnitKind.Mob, 0, 40, 1);
  sim.spawn(Team.Player, UnitKind.Champion, 0, 5, 1, { hp: 50, variant: 8, speed: 3.2 });
  const v = sim.view;
  assert.deepEqual(Array.from(v.variant.subarray(0, v.count)), [0, 2, 0, 8]);
  sim.step(SIM_DT, []);
  const close = (a: number, b: number) => Math.abs(a - b) < 1e-4;
  assert.ok(close(v.posZ[0], 5 + SIM_TUNING.mobSpeed * SIM_DT), 'default player mob speed');
  assert.ok(close(v.posZ[1], 5 + 10 * SIM_DT), 'custom mob speed');
  assert.ok(close(v.posZ[2], 40 - SIM_TUNING.enemySpeed * SIM_DT), 'enemy speed');
  assert.ok(close(v.posZ[3], 5 + 3.2 * SIM_DT), 'custom champion speed');
});

test('sim m4: gate clones inherit speed, variant and death blast', () => {
  const sim = createSim(
    level({ gates: [{ id: 'g', op: 'mul', value: 3, x: 0, z: 6, width: 4 }], lane: { width: 10, length: 200 } }),
    rand,
  );
  sim.spawn(Team.Player, UnitKind.Mob, 0, 5.9, 1, { speed: 10, variant: 3, hp: 2, deathBlast: BLAST });
  sim.step(SIM_DT, []);
  const v = sim.view;
  assert.equal(v.count, 3);
  assert.deepEqual(Array.from(v.variant.subarray(0, 3)), [3, 3, 3]);
  const z0 = Array.from(v.posZ.subarray(0, 3));
  for (let s = 0; s < 30; s++) sim.step(SIM_DT, []);
  // Same speed as the original: every clone moved 30 steps at 10 u/s (separation aside).
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(v.posZ[i] - z0[i] - 5) < 0.3, `clone ${i} moved ${v.posZ[i] - z0[i]}`);
  // All three carry the blast: killing them records three.
  assert.equal(sim.damageArea(Team.Player, 0, v.posZ[0], 5, 100), 3);
  const blasts: SimBlast[] = [];
  sim.takeBlasts(blasts);
  assert.equal(blasts.length, 3);
  assert.equal(v.count, 0);
});

test('sim m4: stacked units keep their variant', () => {
  const sim = createSim(level(), rand, { unitBudget: 4 });
  sim.spawn(Team.Player, UnitKind.Mob, 0, 5, 10, { variant: 2 });
  const v = sim.view;
  assert.equal(v.count, 4);
  assert.equal(sim.totals().player, 10);
  for (let i = 0; i < 4; i++) assert.equal(v.variant[i], 2);
  // Over budget, new weight joins a nearby stack of the same variant.
  sim.spawn(Team.Player, UnitKind.Mob, 0, 5, 5, { variant: 2 });
  assert.equal(v.count, 4);
  assert.equal(sim.totals().player, 15);
});

test('sim m4: a dying bomber blasts the other team once, up to its damage, and records it', () => {
  const sim = createSim(level(), rand);
  sim.spawn(Team.Player, UnitKind.Mob, 0, 20, 1, { hp: 2, deathBlast: BLAST, variant: 3 });
  sim.spawn(Team.Enemy, UnitKind.Mob, 0, 20.6, 6, { spread: 0 }); // inside the radius
  sim.spawn(Team.Enemy, UnitKind.Mob, 3.5, 20, 2, { spread: 0 }); // outside
  sim.spawn(Team.Player, UnitKind.Mob, 0.5, 20, 1); // own team: never hurt by the blast
  assert.equal(sim.damageArea(Team.Player, 0, 20, 0.1, 2), 1, 'the bomber (weight 1, hp 2) dies');
  assert.deepEqual(sim.totals(), { player: 1, enemy: 2 + 6 - BLAST.damage });
  const out: SimBlast[] = [];
  sim.takeBlasts(out);
  assert.equal(out.length, 1);
  assert.ok(Math.abs(out[0].x) < 1e-6 && Math.abs(out[0].z - 20) < 1e-6 && Math.abs(out[0].radius - 1.4) < 1e-6);
  sim.takeBlasts(out);
  assert.equal(out.length, 1, 'takeBlasts cleared its records');
  // Dying in a clash during step() blasts too.
  sim.spawn(Team.Player, UnitKind.Mob, -3, 30, 1, { deathBlast: BLAST });
  sim.spawn(Team.Enemy, UnitKind.Mob, -3, 30.1, 3, { spread: 0 });
  const before = sim.totals().enemy;
  sim.step(SIM_DT, []);
  assert.equal(sim.totals().enemy, before - 3, 'one cancelled by the clash, two by the blast');
  out.length = 0;
  sim.takeBlasts(out);
  assert.equal(out.length, 1);
});

test('sim m4: damageArea only hurts the given team inside the circle, up to maxWeight', () => {
  const sim = createSim(level(), rand);
  sim.spawn(Team.Enemy, UnitKind.Mob, 0, 30, 10, { spread: 0 });
  sim.spawn(Team.Enemy, UnitKind.Mob, 4, 30, 5, { spread: 0 });
  sim.spawn(Team.Player, UnitKind.Mob, 0, 30, 4, { spread: 0 });
  assert.equal(sim.damageArea(Team.Enemy, 0, 30, 1, 0), 0);
  assert.equal(sim.damageArea(Team.Enemy, 0, 30, 1, -1), 0);
  assert.equal(sim.damageArea(Team.Enemy, 0, 30, 1, 3.5), 3.5);
  // 3 dead, one at half hp (still weight 1), 6 untouched, 5 out of reach.
  assert.equal(sim.totals().enemy, 15 - 3);
  assert.equal(sim.totals().player, 4);
  assert.equal(sim.view.count, 4 + 7 + 5);
  assert.equal(sim.damageArea(Team.Enemy, 0, 30, 1, 100), 6.5, 'only what is inside the circle');
  assert.equal(sim.totals().enemy, 5);
  assert.equal(sim.damageArea(Team.Enemy, -4, 50, 1, 100), 0, 'nothing there');
  // A champion counts its hp as weight.
  sim.spawn(Team.Enemy, UnitKind.Champion, 0, 40, 1, { hp: 20 });
  assert.equal(sim.damageArea(Team.Enemy, 0, 40, 0.5, 8), 8);
  assert.equal(sim.damageArea(Team.Enemy, 0, 40, 0.5, 100), 12);
});

test('sim m4: damageDefender damages a defender, reported as defenderHit on the next step', () => {
  const sim = createSim(level({ defenders: [{ id: 'w', kind: 'wall', x: 0, z: 30, hp: 40 }] }), rand);
  sim.damageDefender(0, 15);
  sim.damageDefender(5, 15); // no such defender: ignored
  assert.equal(sim.defenders[0].hp, 25);
  const events: SimEvent[] = [];
  sim.step(SIM_DT, events);
  const hit = events.find((e) => e.type === 'defenderHit');
  assert.ok(hit && hit.type === 'defenderHit' && hit.damage === 15);
  events.length = 0;
  sim.damageDefender(0, 100);
  sim.step(SIM_DT, events);
  assert.ok(events.some((e) => e.type === 'defenderDestroyed'));
  assert.equal(sim.defenders[0].hp, 0);
});
