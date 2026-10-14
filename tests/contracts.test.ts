import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateLabel, gateX, starGoalLabel } from '../src/contracts.ts';
import type { LevelDef } from '../src/contracts.ts';

test('gate labels', () => {
  assert.equal(gateLabel({ id: 'a', op: 'mul', value: 3, x: 0, z: 0, width: 2 }), 'x3');
  assert.equal(gateLabel({ id: 'a', op: 'add', value: 10, x: 0, z: 0, width: 2 }), '+10');
});

test('static gate does not move', () => {
  assert.equal(gateX({ id: 'a', op: 'mul', value: 2, x: 1.5, z: 0, width: 2 }, 12.3), 1.5);
});

test('star goal labels', () => {
  const level = { gates: [{ id: 'trap', op: 'div', value: 2, x: 0, z: 10, width: 3 }] } as unknown as LevelDef;
  assert.equal(starGoalLabel({ type: 'time', seconds: 90 }), 'Win in under 90 s');
  assert.equal(starGoalLabel({ type: 'baseHp', minFraction: 0.75 }), 'Keep 75% base HP');
  assert.equal(starGoalLabel({ type: 'noChampion' }), 'Win without the champion');
  assert.equal(starGoalLabel({ type: 'avoidGate', gateId: 'trap' }, level), 'Never touch the ÷2 gate');
  assert.equal(starGoalLabel({ type: 'avoidGate', gateId: 'trap' }), 'Avoid the trap gate');
  assert.equal(starGoalLabel({ type: 'avoidGate', gateId: 'ghost' }, level), 'Avoid the trap gate');
  assert.equal(starGoalLabel({ type: 'maxMobs', mobs: 1200 }), 'Fire at most 1200 mobs');
});
