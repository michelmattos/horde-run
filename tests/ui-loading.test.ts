import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settle } from '../src/ui/loading.ts';

test('settle resolves when the load finishes', async () => {
  let done = false;
  await settle(Promise.resolve('ok'), 10_000).then(() => (done = true));
  assert.equal(done, true);
});

test('settle never rejects: a failed load still lifts the loading screen', async () => {
  await settle(Promise.reject(new Error('texture 404')), 10_000);
});

test('settle gives up waiting after the timeout', async () => {
  const start = Date.now();
  await settle(new Promise(() => {}), 30);
  assert.ok(Date.now() - start >= 25);
});
