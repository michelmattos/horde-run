// UI helper math: time format, pop curves, star timing and result button choice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatTime,
  hudStarStyle,
  mixHex,
  pipLit,
  popScale,
  resultActions,
  starPopDelays,
  STAR_POP,
} from '../src/ui/uiLogic.ts';

test('formatTime pads seconds and clamps negatives', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(65.9), '1:05');
  assert.equal(formatTime(-3), '0:00');
});

test('popScale peaks mid-way and rests at 1 outside the pop', () => {
  assert.equal(popScale(-1, 300, 1.5), 1);
  assert.equal(popScale(300, 300, 1.5), 1);
  assert.ok(Math.abs(popScale(150, 300, 1.5) - 1.5) < 1e-9);
  assert.equal(popScale(NaN, 300, 1.5), 1);
});

test('mixHex blends and clamps', () => {
  assert.equal(mixHex('#000000', '#ffffff', 0), '#000000');
  assert.equal(mixHex('#000000', '#ffffff', 1), '#ffffff');
  assert.equal(mixHex('#ff0000', '#0000ff', 2), '#0000ff');
  assert.equal(mixHex('#000000', '#ffffff', 0.5), '#808080');
});

test('failed stars are grey and dimmed, others gold', () => {
  assert.equal(hudStarStyle('pending').alpha, 1);
  assert.equal(hudStarStyle('met').color, hudStarStyle('pending').color);
  assert.ok(hudStarStyle('failed').alpha < 1);
  assert.notEqual(hudStarStyle('failed').color, hudStarStyle('met').color);
});

test('result stars finish popping in under 0.8 s', () => {
  const d = starPopDelays(3);
  assert.equal(d.length, 3);
  for (let i = 1; i < d.length; i++) assert.ok(d[i] > d[i - 1]);
  assert.ok(d[2] + STAR_POP.durationMs <= 800);
});

test('result buttons: Next first on a win, Retry first on a defeat', () => {
  assert.deepEqual(resultActions(true, true, true), { primary: 'next', secondary: ['retry', 'map'] });
  assert.deepEqual(resultActions(true, true, false), { primary: 'next', secondary: ['retry'] });
  assert.deepEqual(resultActions(true, false, true), { primary: 'map', secondary: ['retry'] });
  assert.deepEqual(resultActions(true, false, false), { primary: 'retry', secondary: [] });
  assert.deepEqual(resultActions(false, true, true), { primary: 'retry', secondary: ['map'] });
  assert.deepEqual(resultActions(false, true, false), { primary: 'retry', secondary: [] });
});

test('boss pips light up to the current phase', () => {
  assert.deepEqual(
    [0, 1, 2].map((i) => pipLit(i, 1)),
    [true, true, false],
  );
});
