// World map Expedition button: badge state from the show() flags.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expeditionEntryLook } from '../src/meta/expeditionEntry.ts';

test('no flags: no badge, no dot', () => {
  const l = expeditionEntryLook();
  assert.equal(l.progress, false);
  assert.equal(l.daily, false);
  assert.equal(l.aria, 'Expedition');
  assert.ok(l.sub.length > 0);
});

test('a saved run shows the in-progress badge and says resume', () => {
  const l = expeditionEntryLook({ active: true, dailyDone: true });
  assert.equal(l.progress, true);
  assert.equal(l.daily, false);
  assert.match(l.sub, /resume/i);
  assert.match(l.aria, /run in progress/);
});

test('an unplayed Daily lights the dot', () => {
  const l = expeditionEntryLook({ active: false, dailyDone: false });
  assert.equal(l.progress, false);
  assert.equal(l.daily, true);
  assert.match(l.sub, /daily/i);
  assert.match(l.aria, /daily run ready/);
});

test('both flags together', () => {
  const l = expeditionEntryLook({ active: true, dailyDone: false });
  assert.equal(l.progress, true);
  assert.equal(l.daily, true);
  assert.equal(l.aria, 'Expedition, run in progress, daily run ready');
});

test('a played Daily and no run: plain button', () => {
  const l = expeditionEntryLook({ active: false, dailyDone: true });
  assert.equal(l.progress, false);
  assert.equal(l.daily, false);
});
