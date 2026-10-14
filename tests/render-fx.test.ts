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
  KeyedThrottle,
  dartHeight,
  dartPitch,
  fxEnvelope,
  writeBillboard,
  writeStreak,
  writeTRS,
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

test('scattered props never overlap each other', () => {
  const a = scatterScenery(11, 10, -8, 72, 90, 10);
  assert.ok(a.length > 40, `placed ${a.length}`);
  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j < a.length; j++) {
      const p = a[i];
      const q = a[j];
      const d = Math.hypot(p.x - q.x, p.z - q.z);
      assert.ok(d >= PROP_RADIUS[p.kind] * p.scale + PROP_RADIUS[q.kind] * q.scale - 1e-9, `${p.kind} and ${q.kind} overlap`);
    }
  }
});

test('pools with restitution bounce, then settle on their ground height', () => {
  const p = new ParticlePool(1, { bounce: 0.4, groundY: 0 });
  p.spawn(0, 1, 0, 0, 0, 0, 10, 1, 1, 1, 1, 16);
  let bounced = false;
  for (let i = 0; i < 240; i++) {
    p.step(1 / 60);
    if (p.vy[0] > 0) bounced = true;
  }
  assert.ok(bounced, 'bounces off the floor');
  assert.equal(p.py[0], 0);
  assert.ok(p.grounded(0));
  // Default pools keep the old behaviour: stop at 0.05, never bounce.
  const q = new ParticlePool(1);
  q.spawn(0, 1, 0, 0, 0, 0, 10, 1, 1, 1, 1, 16);
  for (let i = 0; i < 120; i++) {
    q.step(1 / 60);
    assert.ok(q.vy[0] <= 0);
  }
  assert.ok(Math.abs(q.py[0] - 0.05) < 1e-6);
});

test('drag gives confetti a slow terminal fall', () => {
  const p = new ParticlePool(1, { drag: 2.4, groundY: -100 });
  p.spawn(0, 0, 0, 0, 0, 0, 10, 1, 1, 1, 1, 9);
  for (let i = 0; i < 300; i++) p.step(1 / 60);
  assert.ok(p.vy[0] < 0 && p.vy[0] > -4.5, `terminal speed ${p.vy[0]}`);
});

test('fx envelope rises, holds and falls to zero', () => {
  assert.equal(fxEnvelope(1, 0.1, 0.5), 0);
  assert.equal(fxEnvelope(0.7, 0.1, 0.5), 1);
  assert.ok(Math.abs(fxEnvelope(0.25, 0.1, 0.5) - 0.5) < 1e-9);
  assert.equal(fxEnvelope(0, 0.1, 0.5), 0);
  assert.equal(fxEnvelope(-1, 0, 0), 0);
});

test('dart lob starts and ends at the right heights and pitches nose-down at the end', () => {
  assert.equal(dartHeight(0, 2.6, 0.5, 0.35), 2.6);
  assert.equal(dartHeight(1, 2.6, 0.5, 0.35), 0.5);
  assert.ok(dartHeight(0.5, 2.6, 0.5, 0.35) > (2.6 + 0.5) / 2, 'lifted mid-flight');
  assert.ok(dartPitch(1, 2.6, 0.5, 0.35, 5) > dartPitch(0, 2.6, 0.5, 0.35, 5));
  assert.ok(dartPitch(1, 2.6, 0.5, 0.35, 5) > 0);
});

test('writeTRS matches the yaw-only layout and pitches +Z down', () => {
  const m = new Float32Array(16);
  writeTRS(m, 0, 1, 2, 3, 1, 1, 1, Math.PI / 2, 0, 0);
  // local +Z (row 2) points along +X after a quarter yaw; translation in 12..14.
  assert.ok(Math.abs(m[8] - 1) < 1e-6 && Math.abs(m[10]) < 1e-6);
  assert.deepEqual([m[12], m[13], m[14], m[15]], [1, 2, 3, 1]);
  writeTRS(m, 0, 0, 0, 0, 2, 2, 2, 0, Math.PI / 2, 0);
  assert.ok(Math.abs(m[9] + 2) < 1e-6, 'positive pitch tips +Z down (scaled by 2)');
  // Rows stay orthogonal under a mixed rotation.
  writeTRS(m, 0, 0, 0, 0, 1, 1, 1, 0.7, -0.4, 1.9);
  const dot = (a: number, b: number) => m[a] * m[b] + m[a + 1] * m[b + 1] + m[a + 2] * m[b + 2];
  assert.ok(Math.abs(dot(0, 4)) < 1e-6 && Math.abs(dot(0, 8)) < 1e-6 && Math.abs(dot(4, 8)) < 1e-6);
  assert.ok(Math.abs(dot(0, 0) - 1) < 1e-6);
});

test('billboards and streaks span the camera axes', () => {
  const m = new Float32Array(16);
  writeBillboard(m, 0, 5, 1, 2, 0.5, 0.5, 0, 1, 0, 0, 0, 0.6, 0.8);
  assert.deepEqual([m[0], m[1], m[2]], [0.5, 0, 0]);
  assert.ok(Math.abs(m[5] - 0.3) < 1e-6 && Math.abs(m[6] - 0.4) < 1e-6);
  writeStreak(m, 0, 0, 0, 0, 0, 3, 0, 0.1, 0.8, 0, 0, 1);
  assert.ok(Math.abs(m[5] - 0.8) < 1e-6, 'length along the velocity');
  assert.ok(Math.abs(Math.hypot(m[0], m[1], m[2]) - 0.1) < 1e-6, 'width across it');
  writeStreak(m, 0, 0, 0, 0, 0, 0, 0, 0.1, 0.2, 0, 0, 1);
  assert.ok(Number.isFinite(m[0]) && Number.isFinite(m[4]), 'at rest it still writes a valid quad');
});

test('keyed throttle limits each key separately and evicts the stalest', () => {
  const t = new KeyedThrottle(2, 0.4);
  assert.ok(t.allow(1));
  assert.ok(!t.allow(1));
  assert.ok(t.allow(2));
  t.tick(0.5);
  assert.ok(t.allow(1));
  assert.ok(t.allow(3), 'a third key evicts key 2 (fired longest ago)');
  assert.ok(t.allow(2), 'key 2 was forgotten, so it fires again');
  t.clear();
  assert.ok(t.allow(1));
});

test('tracers report the slot of each landed dart', () => {
  const t = new TracerPool(3);
  t.spawn(1, 2, 3, 4, 0.1);
  t.spawn(5, 6, 7, 8, 0.3);
  t.step(0.2);
  assert.equal(t.endedCount, 1);
  assert.equal(t.endedSlot[0], 0);
  assert.equal(t.x0[t.endedSlot[0]], 1);
});

test('effects pools stay within the 400-particle budget', async () => {
  const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../src/render/effects.ts', import.meta.url), 'utf8'));
  const num = (name: string) => Number(new RegExp(`const ${name} = (\\d+)`).exec(src)![1]);
  const total = ['TRACERS', 'FALLEN', 'SOLIDS', 'CONFETTI', 'PUFFS', 'SPARKS', 'RINGS'].reduce((a, k) => a + num(k), 0);
  assert.ok(total <= 400, `pooled ${total}`);
  assert.ok(!/camera\.(position|rotation|target|alpha|beta|radius|fov)\s*[=+\-*]/.test(src), 'effects never move the camera');
});
