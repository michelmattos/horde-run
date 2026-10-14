import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUALITY_SETTINGS,
  QualityGovernor,
  higherQuality,
  lowerQuality,
  parseQuality,
} from '../src/render/look/quality.ts';

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
