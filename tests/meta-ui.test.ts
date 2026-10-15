// Loadout and collection rules: slot picking (locked items stay out, the two mob slots
// never hold the same mob), selection repair, tier pips, coin text, collection actions
// and sections, grid columns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SLOT_KEYS,
  assignSlot,
  collectionAction,
  collectionSections,
  formatCoins,
  gridColumns,
  pickerEntries,
  repairSelection,
  selectedId,
  selectionEquals,
  slotOf,
  tierLabel,
  tierPips,
} from '../src/meta/metaLogic.ts';
import type { Selection } from '../src/meta/metaLogic.ts';
import type { ItemCard, ItemSlot } from '../src/meta/types.ts';

function card(id: string, slot: ItemSlot, locked = false, tier = 0): ItemCard {
  return { id, slot, name: id, text: '', tier, maxTier: 3, locked, hint: locked ? `Unlock ${id}` : '' };
}

const ITEMS: ItemCard[] = [
  card('popgun', 'cannon'),
  card('repeater', 'cannon'),
  card('blunderbuss', 'cannon', true),
  card('rifleman', 'mob'),
  card('knight', 'mob'),
  card('sprinter', 'mob'),
  card('bomber', 'mob', true),
  card('sarge', 'champion'),
  card('tank', 'champion', true),
  card('drummer', 'champion', true),
  card('barrage', 'ultimate'),
  card('paratroopers', 'ultimate', true),
  card('marble', 'ultimate', true),
];

const START: Selection = { cannon: 'popgun', mobs: ['rifleman', 'knight'], champion: 'sarge', ultimate: 'barrage' };

test('five slots map onto the four item slots', () => {
  assert.deepEqual(SLOT_KEYS, ['cannon', 'mob0', 'mob1', 'champion', 'ultimate']);
  assert.equal(slotOf('mob0'), 'mob');
  assert.equal(slotOf('mob1'), 'mob');
  assert.equal(slotOf('ultimate'), 'ultimate');
  assert.equal(selectedId(START, 'mob1'), 'knight');
});

test('picking an unlocked item equips it without touching the input', () => {
  const r = assignSlot(START, 'cannon', 'repeater', ITEMS);
  assert.equal(r.result, 'ok');
  assert.equal(r.sel.cannon, 'repeater');
  assert.equal(START.cannon, 'popgun', 'input not mutated');
  const m = assignSlot(START, 'mob1', 'sprinter', ITEMS);
  assert.deepEqual(m.sel.mobs, ['rifleman', 'sprinter']);
});

test('locked, unknown and wrong-slot items are refused', () => {
  assert.equal(assignSlot(START, 'cannon', 'blunderbuss', ITEMS).result, 'locked');
  assert.equal(assignSlot(START, 'cannon', 'nope', ITEMS).result, 'unknown');
  assert.equal(assignSlot(START, 'cannon', 'knight', ITEMS).result, 'unknown');
  for (const r of [assignSlot(START, 'mob0', 'bomber', ITEMS), assignSlot(START, 'champion', 'tank', ITEMS)]) {
    assert.ok(selectionEquals(r.sel, START));
  }
});

test('the two mob slots never hold the same mob: picking the other one swaps', () => {
  const r = assignSlot(START, 'mob0', 'knight', ITEMS);
  assert.equal(r.result, 'swapped');
  assert.deepEqual(r.sel.mobs, ['knight', 'rifleman']);
  const back = assignSlot(r.sel, 'mob1', 'knight', ITEMS);
  assert.deepEqual(back.sel.mobs, ['rifleman', 'knight']);
  assert.equal(assignSlot(START, 'mob0', 'rifleman', ITEMS).result, 'same');
  // Every reachable state keeps the mobs different.
  for (const key of ['mob0', 'mob1'] as const)
    for (const id of ['rifleman', 'knight', 'sprinter', 'bomber']) {
      const s = assignSlot(START, key, id, ITEMS).sel;
      assert.notEqual(s.mobs[0], s.mobs[1], `${key} <- ${id}`);
    }
});

test('picker entries mark the current item, the other mob slot and locks', () => {
  const e = pickerEntries(START, 'mob1', ITEMS);
  assert.deepEqual(
    e.map((x) => x.item.id),
    ['rifleman', 'knight', 'sprinter', 'bomber'],
  );
  assert.equal(e.find((x) => x.item.id === 'knight')?.current, true);
  assert.equal(e.find((x) => x.item.id === 'rifleman')?.inOtherSlot, true);
  assert.equal(e.find((x) => x.item.id === 'bomber')?.usable, false);
  assert.equal(pickerEntries(START, 'cannon', ITEMS).length, 3);
});

test('repairSelection keeps a valid selection as passed in', () => {
  assert.deepEqual(repairSelection(START, ITEMS), START);
  const odd: Selection = { cannon: 'repeater', mobs: ['sprinter', 'rifleman'], champion: 'sarge', ultimate: 'barrage' };
  assert.deepEqual(repairSelection(odd, ITEMS), odd);
});

test('repairSelection replaces locked, unknown and duplicate picks', () => {
  const bad: Selection = { cannon: 'blunderbuss', mobs: ['knight', 'knight'], champion: 'ghost', ultimate: 'marble' };
  const r = repairSelection(bad, ITEMS);
  assert.equal(r.cannon, 'popgun');
  assert.equal(r.mobs[0], 'knight');
  assert.notEqual(r.mobs[1], 'knight');
  assert.equal(r.mobs[1], 'rifleman');
  assert.equal(r.champion, 'sarge');
  assert.equal(r.ultimate, 'barrage');
});

test('tier pips and labels', () => {
  assert.deepEqual(tierPips(0, 3), [false, false, false]);
  assert.deepEqual(tierPips(2, 3), [true, true, false]);
  assert.deepEqual(tierPips(9, 3), [true, true, true]);
  assert.deepEqual(tierPips(-1, 3), [false, false, false]);
  assert.equal(tierLabel(1, 3), 'Tier 1/3');
  assert.equal(tierLabel(3, 3), 'Max');
});

test('coins format with thousands separators', () => {
  assert.equal(formatCoins(0), '0');
  assert.equal(formatCoins(999), '999');
  assert.equal(formatCoins(1340), '1,340');
  assert.equal(formatCoins(1234567.8), '1,234,567');
  assert.equal(formatCoins(-5), '0');
});

test('collection action per item state', () => {
  const base = { locked: false, tier: 1, maxTier: 3, upgradeCost: 75, buyPrice: null, canAfford: true };
  assert.deepEqual(collectionAction(base), { kind: 'upgrade', cost: 75, enabled: true });
  assert.deepEqual(collectionAction({ ...base, canAfford: false }), { kind: 'upgrade', cost: 75, enabled: false });
  assert.deepEqual(collectionAction({ ...base, tier: 3, upgradeCost: null }), { kind: 'max' });
  assert.deepEqual(collectionAction({ ...base, locked: true, upgradeCost: null }), { kind: 'locked' });
  assert.deepEqual(collectionAction({ ...base, locked: true, buyPrice: 300, canAfford: false }), {
    kind: 'buy',
    cost: 300,
    enabled: false,
  });
});

test('collection sections follow slot order with counts', () => {
  const items = ITEMS.map((i) => (i.id === 'sprinter' ? { ...i, isNew: true } : i));
  const s = collectionSections(items);
  assert.deepEqual(
    s.map((x) => x.slot),
    ['cannon', 'mob', 'champion', 'ultimate'],
  );
  const mob = s.find((x) => x.slot === 'mob');
  assert.equal(mob?.unlocked, 3);
  assert.equal(mob?.items.length, 4);
  assert.equal(mob?.isNew, 1);
  assert.equal(collectionSections([]).length, 0);
});

test('grid columns fit the width', () => {
  assert.equal(gridColumns(358, 132, 12), 2);
  assert.equal(gridColumns(100, 132, 12), 1);
  assert.equal(gridColumns(2000, 132, 12), 4);
  assert.equal(gridColumns(0, 132, 12), 1);
});
