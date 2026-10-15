// Pure core logic: RNG, fixed-step loop, relative aim, the input state machine and settings parsing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng, seedFromString } from '../src/core/rng.ts';
import { createFixedStep, createFrameCap } from '../src/core/loop.ts';
import { AIM_GAIN, createInputCore, relativeAim } from '../src/core/input.ts';
import { SIM_DT } from '../src/contracts.ts';
import { clampVolume, defaultSettings, parseSettings } from '../src/core/settings.ts';

test('rng is deterministic per seed and stays in range', () => {
  const a = createRng(42);
  const b = createRng(42);
  const c = createRng(43);
  let differs = false;
  for (let i = 0; i < 1000; i++) {
    const x = a.next();
    assert.equal(x, b.next());
    assert.ok(x >= 0 && x < 1);
    if (x !== c.next()) differs = true;
  }
  assert.ok(differs);
  const r = createRng(7);
  for (let i = 0; i < 1000; i++) {
    const n = r.int(5);
    assert.ok(Number.isInteger(n) && n >= 0 && n < 5);
    const f = r.range(-2, 3);
    assert.ok(f >= -2 && f < 3);
  }
  assert.equal(createRng(42).seed, 42);
  assert.equal(seedFromString('daily-2026-10-14'), seedFromString('daily-2026-10-14'));
  assert.notEqual(seedFromString('a'), seedFromString('b'));
});

test('rng mean is roughly uniform', () => {
  const r = createRng(seedFromString('uniform'));
  let sum = 0;
  for (let i = 0; i < 20000; i++) sum += r.next();
  assert.ok(Math.abs(sum / 20000 - 0.5) < 0.02);
});

test('fixed step: 1/30 s at 60 Hz runs exactly 2 steps of SIM_DT', () => {
  const loop = createFixedStep();
  const dts: number[] = [];
  assert.equal(
    loop.advance(1 / 30, (dt) => dts.push(dt)),
    2,
  );
  assert.deepEqual(dts, [SIM_DT, SIM_DT]);
});

test('fixed step: remainder carries over between frames', () => {
  const loop = createFixedStep(60);
  const noop = (): void => {};
  assert.equal(loop.advance(0.01, noop), 0);
  assert.equal(loop.advance(0.01, noop), 1); // 0.02 accumulated
  assert.equal(loop.advance(0.0134, noop), 1); // ~0.0167 + 0.0033 left over
  loop.reset();
  assert.equal(loop.advance(0.01, noop), 0);
});

test('fixed step: a huge frame is capped and the backlog dropped', () => {
  const loop = createFixedStep(60, 5);
  const noop = (): void => {};
  assert.equal(loop.advance(10, noop), 5);
  // Backlog beyond the cap is gone: a normal frame afterwards runs ~1 step, not a burst.
  assert.ok(loop.advance(1 / 60, noop) <= 2);
  assert.equal(loop.advance(Number.NaN, noop), 0);
  assert.equal(loop.advance(-1, noop), 0);
});

test('relativeAim follows finger travel scaled by lane width and sensitivity', () => {
  const anchor = { aimAtDown: 0, downX: 100 };
  // Move a tenth of a 400 px screen on a 10-wide lane.
  const x = relativeAim(anchor, 140, 400, 10, 1, 100);
  assert.ok(Math.abs(x - 0.1 * 10 * AIM_GAIN) < 1e-9);
  const anchor2 = { aimAtDown: 0, downX: 100 };
  const x2 = relativeAim(anchor2, 140, 400, 10, 2, 100);
  assert.ok(Math.abs(x2 - 2 * x) < 1e-9);
  const anchor3 = { aimAtDown: 1, downX: 100 };
  assert.ok(Math.abs(relativeAim(anchor3, 60, 400, 10, 1, 100) - (1 - x)) < 1e-9);
});

test('relativeAim clamps and rebases the anchor so reversing responds at once', () => {
  const anchor = { aimAtDown: 0, downX: 0 };
  assert.equal(relativeAim(anchor, 400, 400, 10, 1, 3), 3);
  assert.equal(relativeAim(anchor, 1000, 400, 10, 1, 3), 3);
  assert.deepEqual(anchor, { aimAtDown: 3, downX: 1000 });
  // Moving back 40 px immediately leaves the clamp.
  const back = relativeAim(anchor, 960, 400, 10, 1, 3);
  assert.ok(back < 3 && Math.abs(back - (3 - 0.1 * 10 * AIM_GAIN)) < 1e-9);
  assert.equal(relativeAim({ aimAtDown: 0, downX: 400 }, 0, 400, 10, 1, 3), -3);
});

function core(sensitivity = 1) {
  const c = createInputCore({ ...defaultSettings(), sensitivity });
  c.configure(10, 4);
  return c;
}

test('input: aim pointer fires only from the lower 70% (touch), anywhere (mouse)', () => {
  const c = core();
  assert.equal(c.down(1, 200, 100, 400, 800, 'touch', false), false); // top 30%
  assert.equal(c.sample().firing, false);
  c.up(1);
  assert.equal(c.down(2, 200, 600, 400, 800, 'touch', false), true);
  assert.equal(c.sample().firing, true);
  c.up(2);
  assert.equal(c.sample().firing, false);
  assert.equal(c.down(3, 200, 10, 400, 800, 'mouse', false), true);
  assert.equal(c.sample().firing, true);
});

test('input: blocked regions never aim; a second pointer never steals aim', () => {
  const c = core();
  assert.equal(c.down(1, 380, 780, 400, 800, 'touch', true), false);
  assert.equal(c.sample().firing, false);
  assert.equal(c.down(2, 200, 600, 400, 800, 'touch', false), true);
  assert.equal(c.down(3, 100, 600, 400, 800, 'touch', false), false);
  c.move(3, 0, 400);
  assert.equal(c.sample().aimX, 0);
  c.move(2, 240, 400);
  assert.ok(c.sample().aimX > 0);
  // Releasing the second finger keeps firing; releasing the aim finger stops it, with no promotion.
  c.up(3);
  assert.equal(c.sample().firing, true);
  c.up(2);
  assert.equal(c.sample().firing, false);
  assert.equal(c.aimPointerId, -1);
});

test('input: aim persists between touches and new drags are relative to it', () => {
  const c = core();
  c.down(1, 200, 600, 400, 800, 'touch', false);
  c.move(1, 240, 400);
  const a = c.sample().aimX;
  c.up(1);
  c.down(2, 50, 600, 400, 800, 'touch', false);
  assert.equal(c.sample().aimX, a);
  c.move(2, 90, 400);
  assert.ok(Math.abs(c.sample().aimX - 2 * a) < 1e-9);
  c.configure(10, 4);
  assert.equal(c.sample().aimX, 0);
  assert.equal(c.sample().firing, false);
});

test('input: championPressed is true for exactly one sample per press', () => {
  const c = core();
  assert.equal(c.sample().championPressed, false);
  c.pressChampion();
  c.pressChampion(); // two presses before a step collapse into one
  assert.equal(c.sample().championPressed, true);
  assert.equal(c.sample().championPressed, false);
  c.pressChampion();
  assert.equal(c.sample().championPressed, true);
  assert.equal(c.sample().championPressed, false);
});

test('input: pausing releases pointers and drops presses', () => {
  const c = core();
  c.down(1, 200, 600, 400, 800, 'touch', false);
  c.pressChampion();
  c.setPaused(true);
  const s = c.sample();
  assert.equal(s.paused, true);
  assert.equal(s.firing, false);
  assert.equal(s.championPressed, false);
  c.pressChampion();
  assert.equal(c.down(2, 200, 600, 400, 800, 'touch', false), false);
  c.setPaused(false);
  assert.equal(c.sample().championPressed, false);
  assert.equal(c.sample().firing, false);
  assert.equal(c.down(3, 200, 600, 400, 800, 'touch', false), true);
});

test('input: sensitivity is read live from settings', () => {
  const settings = defaultSettings();
  const c = createInputCore(settings);
  c.configure(10, 100);
  c.down(1, 0, 600, 400, 800, 'touch', false);
  c.move(1, 40, 400);
  const a = c.aimX;
  c.up(1);
  settings.sensitivity = 2;
  c.down(2, 0, 600, 400, 800, 'touch', false);
  c.move(2, 40, 400);
  assert.ok(Math.abs(c.aimX - 3 * a) < 1e-9);
});

test('frame cap: 120 Hz rAF draws every other frame, 60 Hz draws every frame', () => {
  const at120 = (cap: ReturnType<typeof createFrameCap>, frames: number) => {
    let drawn = 0;
    for (let i = 0; i <= frames; i++) if (cap.tick(i * (1000 / 120)) >= 0) drawn++;
    return drawn;
  };
  assert.equal(at120(createFrameCap(), 240), 121); // 2 s at 120 Hz → ~60 fps (plus the first frame)

  const cap = createFrameCap();
  let drawn = 0;
  for (let i = 0; i <= 120; i++) if (cap.tick(i * (1000 / 60) + (i % 2 ? 0.8 : -0.8)) >= 0) drawn++; // jittery 60 Hz
  assert.equal(drawn, 121);

  // dt spans the skipped frame, so the sim does not run in slow motion.
  const c = createFrameCap();
  assert.equal(c.tick(1000), 0);
  assert.equal(c.tick(1008.3), -1);
  assert.ok(Math.abs(c.tick(1016.7) - 0.0167) < 1e-6);
  c.reset();
  assert.equal(c.tick(1020), 0, 'after a reset the next frame draws at once');
});

test('input: ultimatePressed is true for exactly one sample per press', () => {
  const c = createInputCore(defaultSettings());
  c.configure(10, 4);
  assert.equal(c.sample().ultimatePressed, false);
  c.pressUltimate();
  c.pressUltimate(); // two presses before a step collapse into one
  const s = c.sample();
  assert.equal(s.ultimatePressed, true);
  assert.equal(s.championPressed, false);
  assert.equal(c.sample().ultimatePressed, false);
  c.pressUltimate();
  c.pressChampion();
  const both = c.sample();
  assert.equal(both.ultimatePressed, true);
  assert.equal(both.championPressed, true);
  assert.equal(c.sample().ultimatePressed, false);
});

test('input: pausing drops a pending ultimate and ignores presses while paused', () => {
  const c = createInputCore(defaultSettings());
  c.configure(10, 4);
  c.pressUltimate();
  c.setPaused(true);
  assert.equal(c.sample().ultimatePressed, false);
  c.pressUltimate();
  c.setPaused(false);
  assert.equal(c.sample().ultimatePressed, false);
  c.pressUltimate();
  c.reset();
  assert.equal(c.sample().ultimatePressed, false);
});

test('input: a second finger can press the ultimate while the first keeps firing', () => {
  const c = createInputCore(defaultSettings());
  c.configure(10, 4);
  assert.equal(c.down(1, 200, 700, 400, 800, 'touch', false), true);
  c.move(1, 260, 400);
  const aim = c.aimX;
  // The HUD button is a blocked region: the second finger never aims, the HUD presses.
  assert.equal(c.down(2, 30, 760, 400, 800, 'touch', true), false);
  c.pressUltimate();
  const s = c.sample();
  assert.equal(s.firing, true);
  assert.equal(s.ultimatePressed, true);
  assert.equal(s.aimX, aim);
  c.up(2);
  assert.equal(c.sample().firing, true);
  assert.equal(c.aimPointerId, 1);
});

test('settings: defaults, old saves without sound, and bad values', () => {
  assert.deepEqual(defaultSettings(), { sensitivity: 1, haptics: true, sound: true, volume: 0.8 });
  assert.deepEqual(parseSettings({ sensitivity: 1.5, haptics: false }), {
    sensitivity: 1.5,
    haptics: false,
    sound: true,
    volume: 0.8,
  });
  assert.deepEqual(parseSettings({ sensitivity: 9, haptics: 'yes', sound: false, volume: 3 }), {
    sensitivity: 2,
    haptics: true,
    sound: false,
    volume: 1,
  });
  assert.deepEqual(parseSettings(null), defaultSettings());
  assert.deepEqual(parseSettings('junk'), defaultSettings());
  assert.equal(parseSettings({ volume: -1 }).volume, 0);
  assert.equal(parseSettings({ volume: Number.NaN }).volume, 0.8);
  assert.equal(clampVolume(0.25), 0.25);
});
