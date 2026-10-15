import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUALITY_SETTINGS,
  QualityGovernor,
  higherQuality,
  lowerQuality,
  nextPostFallback,
  parsePostFallback,
  parseQuality,
  withDeviceLimits,
  withPostFallback,
  PHONE_SHADOW_MAP_MAX,
} from '../src/render/look/quality.ts';
import { BLANK_LIMIT, BlankWatch, isBlankSample } from '../src/render/look/blankWatch.ts';

test('quality tiers order and parse', () => {
  assert.equal(lowerQuality('high'), 'medium');
  assert.equal(lowerQuality('low'), 'low');
  assert.equal(higherQuality('medium'), 'high');
  assert.equal(parseQuality('medium'), 'medium');
  assert.equal(parseQuality('ultra'), null);
  assert.equal(QUALITY_SETTINGS.low.crowdShadows, false);
  assert.equal(QUALITY_SETTINGS.high.postProcess, true);
});

test('governor drops a tier after sustained long frames, never below low', () => {
  const g = new QualityGovernor('high');
  let changes = 0;
  for (let i = 0; i < 60 * 20; i++) if (g.sample(1 / 30)) changes++;
  assert.equal(g.level, 'low');
  assert.equal(changes, 2);
});

test('governor ignores short hitches and warm-up', () => {
  const g = new QualityGovernor('high');
  g.warmUp(2);
  for (let i = 0; i < 36; i++) g.sample(1 / 20); // 1.8 s, all inside warm-up
  assert.equal(g.level, 'high');
  for (let i = 0; i < 600; i++) g.sample(i % 100 === 0 ? 0.2 : 1 / 60);
  assert.equal(g.level, 'high');
});

test('governor retries upward once after long headroom, and a forced level never moves', () => {
  const g = new QualityGovernor('high');
  for (let i = 0; i < 30 * 3; i++) g.sample(1 / 30);
  assert.equal(g.level, 'medium');
  for (let i = 0; i < 60 * 40; i++) g.sample(1 / 60);
  assert.equal(g.level, 'high');
  for (let i = 0; i < 30 * 3; i++) g.sample(1 / 30);
  for (let i = 0; i < 60 * 60; i++) g.sample(1 / 60);
  assert.equal(g.level, 'medium'); // no second retry
  const locked = new QualityGovernor('low', true);
  for (let i = 0; i < 60 * 60; i++) locked.sample(1 / 60);
  assert.equal(locked.level, 'low');
});

test('a remembered lower start tier can still retry up to the ceiling once', () => {
  const g = new QualityGovernor('medium', false, 'high');
  assert.equal(g.level, 'medium');
  for (let i = 0; i < 60 * 40; i++) g.sample(1 / 60);
  assert.equal(g.level, 'high');
});

test('a big overload steps down faster than a mild one', () => {
  const heavy = new QualityGovernor('high');
  let t = 0;
  while (heavy.level === 'high' && t < 5) {
    heavy.sample(1 / 25);
    t += 1 / 25;
  } // 40 ms frames
  const mild = new QualityGovernor('high');
  let u = 0;
  while (mild.level === 'high' && u < 5) {
    mild.sample(0.021);
    u += 0.021;
  } // 21 ms frames
  assert.ok(t < u, `heavy ${t.toFixed(2)} s should beat mild ${u.toFixed(2)} s`);
  assert.ok(t < 1.6);
});

test('saved render settings are safe without storage', async () => {
  const { readSavedRender, writeSavedRender } = await import('../src/render/look/quality.ts');
  writeSavedRender({ quality: 'low', ratio: 1 }); // no localStorage under Node: a no-op
  assert.deepEqual(readSavedRender(), {});
});

test('post fallback drops MSAA first, then the pipeline, then nothing', () => {
  const high = QUALITY_SETTINGS.high;
  assert.equal(nextPostFallback(high, null), 'no-msaa');
  const noMsaa = withPostFallback(high, 'no-msaa');
  assert.equal(noMsaa.postProcess, true);
  assert.equal(noMsaa.msaa, 1);
  assert.equal(noMsaa.fxaa, true);
  assert.equal(nextPostFallback(high, 'no-msaa'), 'off');
  assert.equal(nextPostFallback(QUALITY_SETTINGS.medium, null), 'off');
  const off = withPostFallback(high, 'off');
  assert.equal(off.postProcess, false);
  assert.equal(off.shadowMapSize, high.shadowMapSize); // the rest of the tier stays
  assert.equal(nextPostFallback(high, 'off'), null);
  assert.equal(nextPostFallback(QUALITY_SETTINGS.low, null), null);
  assert.equal(withPostFallback(QUALITY_SETTINGS.medium, 'no-msaa'), QUALITY_SETTINGS.medium);
  assert.equal(parsePostFallback('off'), 'off');
  assert.equal(parsePostFallback('msaa'), null);
});

test('blank watch probes while watching and gives up only after the blank limit', () => {
  const w = new BlankWatch();
  assert.equal(w.tick(1 / 60), false); // not started
  w.start();
  assert.equal(w.tick(0), true); // first drawn frame is probed
  assert.equal(w.report(true), false);
  let fellBack = false;
  for (let i = 0; i < 60 * BLANK_LIMIT + 30 && !fellBack; i++) if (w.tick(1 / 60)) fellBack = w.report(true);
  assert.equal(fellBack, true);
  assert.equal(w.active, false);

  w.start();
  assert.equal(w.tick(0), true);
  assert.equal(w.report(false), false); // an opaque frame ends the watch
  assert.equal(w.active, false);
  for (let i = 0; i < 600; i++) assert.equal(w.tick(1 / 60), false);
});

test('a sample is blank only when no pixel has alpha', () => {
  assert.equal(isBlankSample(new Uint8Array(12)), true);
  assert.equal(isBlankSample(new Uint8Array([0, 0, 0, 0, 10, 20, 30, 255, 0, 0, 0, 0])), false);
  assert.equal(isBlankSample(new Uint8Array([0, 0, 0, 1])), false);
});

test('phones keep the shadow map at 1024, swap MSAA for FXAA and drop half-float targets', () => {
  const high = withDeviceLimits(QUALITY_SETTINGS.high, true);
  assert.equal(high.shadowMapSize, PHONE_SHADOW_MAP_MAX);
  assert.equal(high.msaa, 1);
  assert.equal(high.fxaa, true);
  assert.equal(high.hdr, false);
  assert.equal(high.bloom, QUALITY_SETTINGS.high.bloom); // the rest of the tier stays
  assert.equal(withDeviceLimits(QUALITY_SETTINGS.low, true).fxaa, false); // no pipeline, no FXAA
  assert.deepEqual(withDeviceLimits(QUALITY_SETTINGS.medium, true), { ...QUALITY_SETTINGS.medium, hdr: false });
  assert.equal(withDeviceLimits(QUALITY_SETTINGS.low, true), QUALITY_SETTINGS.low); // already within limits
  assert.equal(withDeviceLimits(QUALITY_SETTINGS.high, false), QUALITY_SETTINGS.high);
  // On a phone the first post fallback skips straight to 'off' (there is no MSAA to drop).
  assert.equal(nextPostFallback(high, null), 'off');
});
