// Gameplay checks through the real battle + sim (no rendering): a held stream of shots
// through each shipped gate is multiplied exactly once per unit, and a launched
// champion walks the lane and hits the enemy base.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/index.ts';
import { createBattle } from '../src/game/battle.ts';
import { LEVELS } from '../src/game/levels.ts';
import { Team, UnitKind } from '../src/contracts.ts';
import type { LevelDef, SimEvent } from '../src/contracts.ts';

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

// The level with no enemies and an unbreakable enemy base, so every fired unit arrives.
function quiet(level: LevelDef): LevelDef {
  return { ...level, enemyWaves: [], enemySpawnRate: undefined, enemyBase: { ...level.enemyBase, hp: 1e9 } };
}

// Fires for `fireSeconds` at a fixed aim, then lets the lane drain.
function stream(level: LevelDef, aimX: number, fireSeconds: number) {
  const rand = mulberry32(7);
  const sim = createSim(level, rand);
  const battle = createBattle(level, sim, rand);
  const events: SimEvent[] = [];
  let baseDamage = 0;
  const added: Record<string, number> = {};
  for (let s = 0; s < 60 * (fireSeconds + 20); s++) {
    events.length = 0;
    battle.step({ aimX, firing: s < 60 * fireSeconds, championPressed: false, paused: false }, events);
    for (const e of events) {
      if (e.type === 'baseHit' && e.team === Team.Enemy) baseDamage += e.damage;
      if (e.type === 'gate') added[e.gateId] = (added[e.gateId] ?? 0) + e.added;
    }
  }
  return { baseDamage, added, left: sim.view.count };
}

test('a held stream through a x2 gate doubles exactly (each unit triggers it once)', () => {
  const level = quiet(LEVELS[0]);
  const gate = level.gates.find((g) => g.id === '1-1-x2');
  assert.ok(gate && gate.op === 'mul' && gate.value === 2 && !gate.move);
  const r = stream(level, gate.x, 10); // aim through the middle of the x2 gate
  const fired = 10 * level.cannon.fireRate * level.cannon.unitsPerShot;
  assert.equal(r.left, 0);
  assert.deepEqual(r.added, { '1-1-x2': fired });
  assert.equal(r.baseDamage, 2 * fired);
});

test('chained gates multiply in order: x3 then x2 gives x6 for every mob', () => {
  const lv = quiet(LEVELS[0]);
  lv.gates = [
    { id: 'a', op: 'mul', value: 3, x: 0, z: 15, width: 4 },
    { id: 'b', op: 'mul', value: 2, x: 0, z: 30, width: 8 },
  ];
  const fired = 2 * lv.cannon.fireRate * lv.cannon.unitsPerShot; // 2 s of fire
  const r = stream(lv, 0, 2);
  assert.deepEqual(r.added, { a: 2 * fired, b: 3 * fired });
  assert.equal(r.baseDamage, 6 * fired);
});

test('a launched champion walks the lane and hits the enemy base for its damage', () => {
  const level = quiet(LEVELS[0]);
  const rand = mulberry32(3);
  const sim = createSim(level, rand);
  const battle = createBattle(level, sim, rand);
  const events: SimEvent[] = [];
  let launched = 0;
  let champDamage = 0;
  // Charge the meter, stop firing so the lane clears, then launch.
  for (let s = 0; s < 60 * 40; s++) {
    events.length = 0;
    const firing = launched === 0 && battle.state.championCharge < 1 - 1e-9;
    battle.step({ aimX: 3.5, firing, championPressed: s === 60 * 25, paused: false }, events);
    for (const e of events) {
      if (e.type === 'championLaunched') launched++;
      if (e.type === 'baseHit' && e.team === Team.Enemy && s > 60 * 25 + 60) champDamage += e.damage;
    }
  }
  assert.equal(launched, 1);
  assert.equal(battle.state.championCharge, 0);
  assert.equal(champDamage, level.champion.damage);
  for (let i = 0; i < sim.view.count; i++) assert.notEqual(sim.view.kind[i], UnitKind.Champion);
});
