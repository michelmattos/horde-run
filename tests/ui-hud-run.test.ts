// Expedition run strip in the battle HUD: camera reserve and the strip's pure helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HUD_METRICS as M,
  RUN_MAX_ICONS,
  formatRunHp,
  formatStacks,
  hpFraction,
  hudReserveFor,
  hudTopHeight,
  runIconSlots,
  runStatusLabel,
  runTagText,
  runUpgradesLabel,
  splitRunIcons,
} from '../src/ui/uiLogic.ts';

test('hudReserveFor grows by the run strip only while a run is set', () => {
  const ins = { top: 47, bottom: 34 };
  const plain = hudReserveFor(ins);
  assert.deepEqual(hudReserveFor(ins, false), plain, 'default is the campaign reserve');
  const run = hudReserveFor(ins, true);
  assert.equal(run.top - plain.top, M.runGap + M.runH);
  assert.equal(run.bottom, plain.bottom, 'bottom HUD unchanged');
  assert.equal(hudTopHeight(true) - hudTopHeight(), M.runGap + M.runH);
  // The strip spans the width, so tall far-end models must stay under it too.
  assert.equal(run.topBar, Math.round(ins.top + M.topPad + hudTopHeight(true)));
  assert.ok(run.topBar < run.top, 'the clear gap is still kept for the base');
  assert.ok(plain.topBar < run.topBar);
});

test('run strip sizes stay phone friendly', () => {
  assert.ok(M.runIcon >= 28 && M.runIcon <= 32, 'icons 28-32 px');
  assert.ok(M.runH >= M.runIcon, 'icons fit the strip');
  assert.ok(M.runH <= 36, 'compact');
});

test('icon slots from the row width', () => {
  assert.equal(runIconSlots(0), 1);
  assert.equal(runIconSlots(NaN), 1);
  assert.equal(runIconSlots(M.runIcon), 1);
  assert.equal(runIconSlots(2 * M.runIcon + M.runIconGap), 2);
  assert.equal(runIconSlots(7 * (M.runIcon + M.runIconGap) - M.runIconGap), 7);
});

test('icon overflow: up to 6 icons, then a +k chip', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
  assert.deepEqual(splitRunIcons([], 7), { shown: [], more: 0 });
  assert.deepEqual(splitRunIcons(items.slice(0, 6), 7), { shown: items.slice(0, 6), more: 0 });
  assert.deepEqual(splitRunIcons(items.slice(0, 6)), { shown: items.slice(0, 6), more: 0 });
  assert.deepEqual(splitRunIcons(items.slice(0, 7), 7), { shown: items.slice(0, 6), more: 1 });
  assert.deepEqual(splitRunIcons(items, 20), { shown: items.slice(0, RUN_MAX_ICONS), more: 3 });
  // Narrow row: one slot goes to the chip.
  assert.deepEqual(splitRunIcons(items.slice(0, 5), 4), { shown: items.slice(0, 3), more: 2 });
  assert.deepEqual(splitRunIcons(items.slice(0, 4), 4), { shown: items.slice(0, 4), more: 0 });
  assert.deepEqual(splitRunIcons(items.slice(0, 3), 1), { shown: [], more: 3 });
  for (let n = 0; n <= items.length; n++)
    for (let s = 1; s <= 8; s++) {
      const r = splitRunIcons(items.slice(0, n), s);
      assert.equal(r.shown.length + r.more, n, 'nothing lost');
      assert.ok(r.shown.length + (r.more > 0 ? 1 : 0) <= Math.max(1, s), 'fits the slots');
      assert.ok(r.shown.length <= RUN_MAX_ICONS);
    }
});

test('run HP bar fraction and labels', () => {
  assert.equal(hpFraction(70, 100), 0.7);
  assert.equal(hpFraction(0, 100), 0);
  assert.equal(hpFraction(130, 100), 1);
  assert.equal(formatRunHp(69.2), '70');
  assert.equal(formatRunHp(-4), '0');
  assert.equal(formatRunHp(NaN), '0');
  assert.equal(formatStacks(1), '');
  assert.equal(formatStacks(0), '');
  assert.equal(formatStacks(3), 'x3');
  assert.equal(runTagText('battle'), '');
  assert.equal(runTagText('elite'), 'ELITE');
  assert.equal(runTagText('boss'), 'BOSS');
});

test('screen-reader labels for the strip', () => {
  assert.equal(runUpgradesLabel([]), 'No upgrades yet');
  assert.equal(
    runUpgradesLabel([
      { label: 'Burst Fire', stacks: 2 },
      { label: 'Tough Mobs', stacks: 1 },
    ]),
    'Burst Fire x2, Tough Mobs',
  );
  assert.equal(runStatusLabel(64, 100, 125, 'battle'), 'Run health 64 of 100, 125 gold');
  assert.equal(runStatusLabel(64, 100, 125, 'elite'), 'Run health 64 of 100, 125 gold, elite battle');
});
