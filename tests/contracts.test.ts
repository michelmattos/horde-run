import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateLabel, gateX } from '../src/contracts.ts';

test('gate labels', () => {
  assert.equal(gateLabel({ id: 'a', op: 'mul', value: 3, x: 0, z: 0, width: 2 }), 'x3');
  assert.equal(gateLabel({ id: 'a', op: 'add', value: 10, x: 0, z: 0, width: 2 }), '+10');
});

test('static gate does not move', () => {
  assert.equal(gateX({ id: 'a', op: 'mul', value: 2, x: 1.5, z: 0, width: 2 }, 12.3), 1.5);
});
