// Review probes (milestone 2, gameplay lens): gate bursts spread out instead of
// stacking on one point, and a gate applies once per unit even when the unit budget
// forces new weight to stack.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/index.ts';
import { SIM_DT, Team, UnitKind } from '../src/contracts.ts';
import type { LevelDef, SimEvent } from '../src/contracts.ts';

function lcg(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

const base: LevelDef = {
  id: 't',
  name: 't',
  lane: { width: 10, length: 60 },
  cannon: { fireRate: 6, unitsPerShot: 3, aimLimit: 4 },
  playerBase: { hp: 100 },
  enemyBase: { hp: 99999, x: 0, width: 6 },
  gates: [],
  enemyWaves: [],
  champion: { chargeNeeded: 10, hp: 100, damage: 1 },
};

test('a gate burst spreads clones across the gate instead of stacking them', () => {
  const sim = createSim({ ...base, gates: [{ id: 'g', op: 'mul', value: 10, x: 0, z: 10, width: 4 }] }, lcg(2));
  const ev: SimEvent[] = [];
  sim.spawn(Team.Player, UnitKind.Mob, 0, 9, 1);
  for (let s = 0; s < 30; s++) sim.step(SIM_DT, ev);
  const v = sim.view;
  assert.equal(sim.totals().player, 10);
  assert.equal(v.count, 10, 'ten separate units, not one stack');
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < v.count; i++) {
    assert.equal(v.weight[i], 1);
    lo = Math.min(lo, v.posX[i]);
    hi = Math.max(hi, v.posX[i]);
  }
  assert.ok(hi - lo > 1, `clones spread ${(hi - lo).toFixed(2)} wide`);
});

test('over the unit budget a x2 gate still doubles every fired mob exactly once', () => {
  const sim = createSim({ ...base, gates: [{ id: 'g', op: 'mul', value: 2, x: 0, z: 3, width: 8 }] }, lcg(3), { unitBudget: 50 });
  const ev: SimEvent[] = [];
  let fired = 0;
  for (let s = 0; s < 180; s++) {
    if (s % 10 === 0) {
      sim.spawn(Team.Player, UnitKind.Mob, 0, 1.5, 3, { spread: 0.3 });
      fired += 3;
    }
    sim.step(SIM_DT, ev);
  }
  assert.equal(sim.totals().player, fired * 2);
});
