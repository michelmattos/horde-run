import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aliveStep, readGpuLog, startAliveTrail } from '../src/core/gpuLog.ts';

// A fake page: storage that outlives "pages", its document visibility and its listeners.
const store = new Map<string, string>();
const g = globalThis as Record<string, unknown>;
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
};
let listeners: Record<string, () => void> = {};
const doc = { hidden: false, addEventListener: (t: string, f: () => void) => (listeners[t] = f) };
g.document = doc;
g.addEventListener = (t: string, f: () => void) => (listeners[t] = f);
g.setInterval = () => 0; // no heartbeat: the steps alone mark signs of life

function newPage(now: number): void {
  listeners = {};
  doc.hidden = false;
  startAliveTrail(now);
}
const ended = (): string[] => readGpuLog().flatMap((e) => (e.event === 'ended' ? [e.detail] : []));

test('a page that dies without closing is reported by the next start, with what it was doing', () => {
  store.clear();
  newPage(Date.now() - 30_000);
  aliveStep('in battle 3-4');
  newPage(Date.now());
  assert.equal(ended().length, 1);
  assert.match(ended()[0], /while in battle 3-4, \d+ s after it started/);
  assert.doesNotMatch(ended()[0], /background/);
});

test('a page that closed normally is not reported; one killed in the background says so', () => {
  store.clear();
  newPage(Date.now());
  aliveStep('on the map');
  listeners.pagehide();
  newPage(Date.now());
  assert.deepEqual(ended(), []);
  aliveStep('on the map');
  doc.hidden = true;
  listeners.visibilitychange();
  newPage(Date.now());
  assert.equal(ended().length, 1);
  assert.match(ended()[0], /while on the map in the background/);
});
