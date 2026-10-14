import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateLabel, gateX, starGoalLabels } from '../src/contracts.ts';
import type { LevelDef } from '../src/contracts.ts';

test('gate labels', () => {
  assert.equal(gateLabel({ id: 'a', op: 'mul', value: 3, x: 0, z: 0, width: 2 }), 'x3');
  assert.equal(gateLabel({ id: 'a', op: 'add', value: 10, x: 0, z: 0, width: 2 }), '+10');
});

test('static gate does not move', () => {
  assert.equal(gateX({ id: 'a', op: 'mul', value: 2, x: 1.5, z: 0, width: 2 }, 12.3), 1.5);
});

test('star goal labels: the same three goals on every level', () => {
  const level = { targetTime: 90 } as unknown as LevelDef;
  assert.deepEqual(starGoalLabels(level), ['Win the battle', 'Keep your base above 50% health', 'Win in under 90 s']);
  assert.equal(starGoalLabels({} as LevelDef)[2], 'Win the battle');
});
