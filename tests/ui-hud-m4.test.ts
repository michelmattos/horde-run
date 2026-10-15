// Milestone 4 HUD and overlay math: the bottom row (ultimate, army block, CHAMP) never
// overlaps on phone widths, the ultimate tag fits its corner, sliders and the coin tally.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COIN_TALLY,
  HUD_METRICS as M,
  ULT_TAG_MAX,
  coinTallyAt,
  formatCoinDelta,
  hudBottomHeight,
  hudBottomSpans,
  hudReserveFor,
  hudRowWidth,
  rangeValueAt,
  tagWidthEstimate,
  ultimateTagText,
} from '../src/ui/uiLogic.ts';

test('bottom row: ultimate, army block and CHAMP never overlap from 360 to 430 px', () => {
  for (let vw = 360; vw <= 430; vw++) {
    // Phones in portrait have no side safe-area insets (the notch is at the top).
    for (const ins of [0]) {
      const w = hudRowWidth(vw, ins, ins);
      for (const hasUlt of [true, false]) {
        const { ult, army, champ } = hudBottomSpans(w, hasUlt);
        assert.ok(champ.left >= 0 && champ.right <= w);
        assert.ok(army.left >= 0);
        assert.ok(army.right + M.cornerGap <= champ.left, `army hits CHAMP at ${vw}`);
        assert.ok(army.right - army.left >= M.armyMin, `army too narrow at ${vw}`);
        if (hasUlt) {
          assert.ok(ult);
          assert.ok(ult.left >= 0);
          assert.ok(ult.right + M.cornerGap <= army.left, `ultimate hits army at ${vw}`);
          // Its hanging tag stays out of the army block too.
          const tagHalf = tagWidthEstimate('PARAS'.padEnd(ULT_TAG_MAX, 'W')) / 2;
          assert.ok(M.ultRing / 2 + tagHalf <= army.left, `tag hits army at ${vw}`);
        } else {
          assert.equal(ult, null);
          assert.equal(army.left, 0);
        }
      }
    }
  }
});

test('corner buttons are big enough and the reserve covers the tallest one', () => {
  assert.ok(M.ultFace >= 56);
  assert.ok(M.champFace >= 56);
  assert.ok(M.ultRing <= M.champRing);
  assert.ok(hudBottomHeight() >= M.ultRing + M.champTagOver);
  const r = hudReserveFor({ top: 47, bottom: 34 });
  assert.ok(r.bottom >= 34 + M.bottomPad + M.ultRing + M.champTagOver);
});

test('ultimate tag: short labels as given, long ones shortened per ultimate', () => {
  assert.equal(ultimateTagText('barrage', 'Barrage'), 'BARRAGE');
  assert.equal(ultimateTagText('paratroopers', 'Paratroopers'), 'PARAS');
  assert.equal(ultimateTagText('marble', 'Giant Marble'), 'MARBLE');
  assert.equal(ultimateTagText('marble', ''), 'MARBLE');
  for (const id of ['barrage', 'paratroopers', 'marble']) {
    for (const label of ['', 'X', 'A very long ultimate name']) {
      const t = ultimateTagText(id, label);
      assert.ok(t.length > 0 && t.length <= ULT_TAG_MAX, `${id} ${label}`);
      assert.ok(tagWidthEstimate(t) <= M.ultRing + M.cornerGap);
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
