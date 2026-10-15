// Milestone 4 HUD and overlay math: the ultimate tag fits its corner, sliders and the coin tally.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COIN_TALLY,
  ULT_TAG_MAX,
  coinTallyAt,
  formatCoinDelta,
  rangeValueAt,
  ultimateTagText,
} from '../src/ui/uiLogic.ts';

test('ultimate tag: short labels as given, long ones shortened per ultimate', () => {
  assert.equal(ultimateTagText('barrage', 'Barrage'), 'BARRAGE');
  assert.equal(ultimateTagText('paratroopers', 'Paratroopers'), 'PARAS');
  assert.equal(ultimateTagText('marble', 'Giant Marble'), 'MARBLE');
  assert.equal(ultimateTagText('marble', ''), 'MARBLE');
  for (const id of ['barrage', 'paratroopers', 'marble']) {
    for (const label of ['', 'X', 'A very long ultimate name']) {
      const t = ultimateTagText(id, label);
      assert.ok(t.length > 0 && t.length <= ULT_TAG_MAX, `${id} ${label}`);
    }
  }
});

test('rangeValueAt maps the finger to a snapped, clamped value', () => {
  // A 236 px track at x=100 with a 36 px thumb: the thumb centre travels 118..318.
  assert.equal(rangeValueAt(118, 100, 236, 36, 0, 1, 0.05), 0);
  assert.equal(rangeValueAt(318, 100, 236, 36, 0, 1, 0.05), 1);
  assert.equal(rangeValueAt(218, 100, 236, 36, 0, 1, 0.05), 0.5);
  assert.equal(rangeValueAt(-50, 100, 236, 36, 0, 1, 0.05), 0);
  assert.equal(rangeValueAt(9999, 100, 236, 36, 0.5, 2, 0.05), 2);
  assert.equal(rangeValueAt(219, 100, 236, 36, 0, 1, 0.05), 0.5); // snaps
  assert.equal(rangeValueAt(150, 100, 20, 36, 0, 1, 0.05), 0); // degenerate width
});

test('coin tally counts up to the exact values', () => {
  assert.deepEqual(coinTallyAt(120, 500, 0), { earned: 0, total: 380 });
  const mid = coinTallyAt(120, 500, COIN_TALLY.durationMs / 2);
  assert.ok(mid.earned > 60 && mid.earned < 120); // ease-out: past half at half time
  assert.equal(mid.total - mid.earned, 380);
  assert.deepEqual(coinTallyAt(120, 500, COIN_TALLY.durationMs), { earned: 120, total: 500 });
  assert.deepEqual(coinTallyAt(120, 500, 0, 0), { earned: 120, total: 500 });
  assert.deepEqual(coinTallyAt(50, 20, 0), { earned: 0, total: 0 }); // never below 0
  assert.equal(formatCoinDelta(50), '+50');
  assert.equal(formatCoinDelta(-5), '-5');
  assert.equal(formatCoinDelta(0), '0');
  assert.equal(formatCoinDelta(12345), '+12.3k');
});
