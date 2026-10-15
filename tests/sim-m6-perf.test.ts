// World 3 load: 1,500 units on a workshop lane with two conveyors, a turntable, two saws,
// four toggling gates and a shield wall; the step must stay well inside a frame.
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
  id: 'perf-w3',
  name: 'Perf W3',
  lane: { width: 10, length: 60 },
  cannon: { fireRate: 8, unitsPerShot: 1, aimLimit: 4 },
  playerBase: { hp: 100 },
  enemyBase: { hp: 100, x: 0, width: 4 },
  gates: [
    { id: 'a', op: 'mul', value: 2, x: -2.5, z: 12, width: 4, toggle: { on: 2, off: 1 } },
    { id: 'b', op: 'add', value: 10, x: 2.5, z: 12, width: 4, toggle: { on: 1, off: 1, alt: { op: 'sub', value: 3 } } },
    { id: 'c', op: 'div', value: 2, x: 0, z: 35, width: 3, toggle: { on: 1.5, off: 1.5 } },
    {
      id: 'd',
      op: 'mul',
      value: 2,
      x: 0,
      z: 42,
      width: 4,
      toggle: { on: 2, off: 2 },
      move: { amplitude: 1.5, period: 3 },
    },
  ],
  conveyors: [
    { id: 'c1', x: -2.5, z: 16, width: 5, length: 8, vx: 1.5, vz: 0, flip: 2 },
    { id: 'c2', x: 2.5, z: 28, width: 5, length: 6, vx: 0, vz: -2 },
  ],
  turntables: [{ id: 't', x: 0, z: 22, radius: 3, spin: 1.2, flip: 3 }],
  saws: [
    { id: 's1', x: -3, z: 20, radius: 0.8, path: { dx: 6, dz: 0, period: 3 } },
    { id: 's2', x: 3, z: 45, radius: 0.8, cycle: { on: 1, off: 1 } },
  ],
  defenders: [{ id: 'sh', kind: 'shield', x: 0, z: 50, hp: 1e6 }],
  enemyWaves: [],
  champion: { chargeNeeded: 30, hp: 60, damage: 20 },
};

test('1,500 units on a workshop lane: average step time', () => {
  const sim = createSim(LEVEL, mulberry32(99));
  const events: SimEvent[] = [];
  const rand = mulberry32(7);
  const archer = { range: 6, every: 1, damage: 1 };
  const robot = { run: 1, pause: 0.6 };
  for (let k = 0; k < 150; k++) {
    const enemy = (k & 1) === 1;
    const z = enemy ? 31 + rand() * 27 : 1.5 + rand() * 28;
    if (enemy) sim.spawn(Team.Enemy, UnitKind.Mob, 0, z, 10, { spread: 4.5, windup: robot });
    else sim.spawn(Team.Player, UnitKind.Mob, 0, z, 10, { spread: 4.5, ranged: k % 4 === 0 ? archer : undefined });
  }
  let flip = 0;
  const topUp = () => {
    while (sim.view.count < 1495) {
      flip ^= 1;
      if (flip) sim.spawn(Team.Enemy, UnitKind.Mob, (rand() * 2 - 1) * 4, 58.5, 5, { spread: 0.8, windup: robot });
      else
        sim.spawn(Team.Player, UnitKind.Mob, (rand() * 2 - 1) * 4, 1.5, 5, {
          spread: 0.8,
          bounce: { vx: 3, bounces: 2 },
        });
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
  console.log(`workshop sim step: ${avg.toFixed(3)} ms avg over ${steps} steps, ${sim.view.count} units`);
  assert.ok(avg < 8, `average step ${avg.toFixed(3)} ms`);
});
