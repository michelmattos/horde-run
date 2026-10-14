// Pure render bookkeeping for milestone 2: HP bar fractions, one-use gate labels,
// pop/break curves, the particle and tracer pools, and scenery placement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GATE_BREAK_TIME,
  ParticlePool,
  SCENERY_CLEARANCE,
  TracerPool,
  gateBreakAt,
  hpFraction,
  popScale,
  scatterScenery,
  PROP_RADIUS,
  showHpBar,
  usesLeftText,
} from '../src/render/fxLogic.ts';

test('hp fraction clamps and the bar hides at full and zero HP', () => {
  assert.equal(hpFraction(50, 100), 0.5);
  assert.equal(hpFraction(120, 100), 1);
  assert.equal(hpFraction(-3, 100), 0);
  assert.equal(hpFraction(5, 0), 0);
  assert.equal(showHpBar(100, 100), false);
  assert.equal(showHpBar(0, 100), false);
  assert.equal(showHpBar(99, 100), true);
});

test('one-use gate count line', () => {
  assert.equal(usesLeftText(12), '12 left');
  assert.equal(usesLeftText(0), '0 left');
  assert.equal(usesLeftText(-4), '0 left');
  assert.equal(usesLeftText(3.7), '3 left');
});

test('pop scale eases back to 1', () => {
  assert.equal(popScale(1, 0.2), 1.2);
  assert.equal(popScale(0, 0.2), 1);
  assert.ok(popScale(0.5, 0.2) > 1 && popScale(0.5, 0.2) < 1.2);
});

test('gate break pops, then shrinks and fades to nothing', () => {
  const out = { scale: 1, alpha: 1, done: false };
  gateBreakAt(0, out);
  assert.deepEqual(out, { scale: 1, alpha: 1, done: false });
  gateBreakAt(GATE_BREAK_TIME * 0.25, out);
  assert.ok(Math.abs(out.scale - 1.25) < 1e-9);
  gateBreakAt(GATE_BREAK_TIME * 0.7, out);
  assert.ok(out.scale < 1.25 && out.alpha < 1 && !out.done);
  gateBreakAt(GATE_BREAK_TIME, out);
  assert.deepEqual(out, { scale: 0, alpha: 0, done: true });
});

test('particle pool reuses free slots, then overwrites the weakest when full', () => {
  const p = new ParticlePool(3);
  const a = p.spawn(0, 1, 0, 0, 0, 0, 1.0, 1, 1, 0, 0, 0);
  const b = p.spawn(0, 1, 0, 0, 0, 0, 0.2, 1, 1, 0, 0, 0);
  const c = p.spawn(0, 1, 0, 0, 0, 0, 0.5, 1, 1, 0, 0, 0);
  assert.deepEqual([a, b, c], [0, 1, 2]);
  assert.equal(p.liveCount(), 3);
  const d = p.spawn(0, 1, 0, 0, 0, 0, 0.9, 1, 1, 0, 0, 0);
  assert.equal(d, b, 'full pool overwrites the particle with the least life left');
  p.step(0.6);
  assert.equal(p.liveCount(), 2);
  const e = p.spawn(0, 1, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0);
  assert.equal(e, c, 'a dead slot is reused before overwriting');
  p.clear();
  assert.equal(p.liveCount(), 0);
});

test('particles move, fall with gravity and stop at the ground', () => {
  const p = new ParticlePool(1);
  p.spawn(0, 1, 0, 2, 0, 0, 5, 1, 1, 1, 1, 20);
  for (let i = 0; i < 60; i++) p.step(1 / 60);
  assert.ok(p.px[0] > 0.5);
  assert.ok(Math.abs(p.py[0] - 0.05) < 1e-6, 'rests on the ground');
  assert.ok(p.remaining(0) > 0 && p.remaining(0) < 1);
});

test('tracers report where they land exactly once', () => {
  const t = new TracerPool(2);
  t.spawn(0, 0, 3, 4, 0.15);
  t.step(0.1);
  assert.equal(t.endedCount, 0);
  assert.ok(t.progress(0) > 0.6 && t.progress(0) < 0.7);
  t.step(0.1);
  assert.equal(t.endedCount, 1);
  assert.equal(t.endedX[0], 3);
  assert.equal(t.endedZ[0], 4);
  t.step(0.1);
  assert.equal(t.endedCount, 0);
  // Round-robin reuse when more arrows fly than slots.
  t.spawn(0, 0, 1, 1, 1);
  t.spawn(0, 0, 2, 2, 1);
  const third = t.spawn(0, 0, 5, 5, 1);
  assert.ok(third === 0 || third === 1);
});

test('scenery stays outside the lane and is deterministic', () => {
  const laneWidth = 10;
  const a = scatterScenery(7, laneWidth, -6, 70, 80);
  const b = scatterScenery(7, laneWidth, -6, 70, 80);
  assert.deepEqual(a, b);
  for (const p of a) {
    assert.ok(Math.abs(p.x) - PROP_RADIUS[p.kind] * p.scale >= laneWidth / 2 + SCENERY_CLEARANCE - 1e-9, `${p.kind} at x=${p.x} intrudes on the lane`);
    assert.ok(p.z >= -6 && p.z <= 70);
  }
  assert.ok(a.some((p) => p.x < 0) && a.some((p) => p.x > 0), 'both sides of the lane');
  for (const kind of ['block', 'book', 'crayon'] as const) assert.ok(a.some((p) => p.kind === kind), `some ${kind}s`);
});
