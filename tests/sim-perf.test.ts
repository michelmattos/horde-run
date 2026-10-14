import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/index.ts';
import { SIM_DT, Team, UnitKind } from '../src/contracts.ts';
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

const LEVEL: LevelDef = {
  id: 'perf',
  name: 'Perf',
  lane: { width: 10, length: 60 },
  cannon: { fireRate: 8, unitsPerShot: 1, aimLimit: 4 },
  playerBase: { hp: 100 },
  enemyBase: { hp: 100, x: 0, width: 4 },
  gates: [
    { id: 'a', op: 'mul', value: 2, x: -2.5, z: 15, width: 4 },
    { id: 'b', op: 'add', value: 10, x: 2.5, z: 15, width: 4, move: { amplitude: 1.5, period: 3 } },
    { id: 'c', op: 'div', value: 2, x: 0, z: 35, width: 3 },
  ],
  enemyWaves: [],
  champion: { chargeNeeded: 30, hp: 60, damage: 20 },
};

test('1,500 mixed units: average step time', () => {
  const sim = createSim(LEVEL, mulberry32(99));
  const events: SimEvent[] = [];
  // Seed both crowds spread along their half of the lane, then top up in small cannon-like
  // batches before each step so the load stays near 1,500 without one artificial pile.
  const rand = mulberry32(7);
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
  for (let s = 0; s < 30; s++) sim.step(SIM_DT, events); // warm up the JIT
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
  console.log(`sim step: ${avg.toFixed(3)} ms avg over ${steps} steps, ${sim.view.count} units`);
  assert.ok(avg < 8, `average step ${avg.toFixed(3)} ms`);
});
