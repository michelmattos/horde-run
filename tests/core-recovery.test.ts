import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RECOVERY_WINDOW_MS, planRecovery } from '../src/core/recovery.ts';

test('a context loss reloads, a quick repeat reloads on low, a third gives up', () => {
  const t0 = 1_000_000;
  const first = planRecovery(null, t0);
  assert.deepEqual(first, { plan: 'reload', count: 1 });
  const second = planRecovery({ at: t0, count: 1, target: null }, t0 + 5000);
  assert.deepEqual(second, { plan: 'reload-low', count: 2 });
  const third = planRecovery({ at: t0 + 5000, count: 2, target: null }, t0 + 9000);
  assert.deepEqual(third, { plan: 'give-up', count: 3 });
});

test('a loss long after the last recovery starts over', () => {
  const t0 = 1_000_000;
  assert.deepEqual(planRecovery({ at: t0, count: 3, target: null }, t0 + RECOVERY_WINDOW_MS + 1), {
    plan: 'reload',
    count: 1,
  });
  // A clock that went backwards never counts as a repeat.
  assert.equal(planRecovery({ at: t0, count: 1, target: null }, t0 - 10).plan, 'reload');
});
