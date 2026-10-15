// Pure rules behind the loadout and collection screens: the five loadout slots, the
// picker rules (locked items cannot be equipped, the two mob slots never hold the same
// mob: picking the other slot's mob swaps them), selection repair, tier pips, coin text
// and the collection's per-slot grouping. No DOM here so it is testable in Node.
import type { ItemCard, ItemSlot, LoadoutView } from './types.ts';

export type Selection = LoadoutView['selected'];
export type SlotKey = 'cannon' | 'mob0' | 'mob1' | 'champion' | 'ultimate';

export const SLOT_KEYS: readonly SlotKey[] = ['cannon', 'mob0', 'mob1', 'champion', 'ultimate'];
export const ITEM_SLOTS: readonly ItemSlot[] = ['cannon', 'mob', 'champion', 'ultimate'];

export const SLOT_LABEL: Record<SlotKey, string> = {
  cannon: 'Cannon',
  mob0: 'Mob 1',
  mob1: 'Mob 2',
  champion: 'Champion',
  ultimate: 'Ultimate',
};

export const SLOT_TITLE: Record<ItemSlot, string> = {
  cannon: 'Cannons',
  mob: 'Mobs',
  champion: 'Champions',
  ultimate: 'Ultimates',
};

export function slotOf(key: SlotKey): ItemSlot {
  return key === 'mob0' || key === 'mob1' ? 'mob' : key;
}

export function selectedId(sel: Selection, key: SlotKey): string {
  if (key === 'mob0') return sel.mobs[0];
  if (key === 'mob1') return sel.mobs[1];
  return sel[key];
}

function withId(sel: Selection, key: SlotKey, id: string): Selection {
  const next: Selection = { ...sel, mobs: [sel.mobs[0], sel.mobs[1]] };
  if (key === 'mob0') next.mobs[0] = id;
  else if (key === 'mob1') next.mobs[1] = id;
  else next[key] = id;
  return next;
}

export function itemsForSlot<T extends ItemCard>(items: readonly T[], slot: ItemSlot): T[] {
  return items.filter((i) => i.slot === slot);
}

export type AssignResult = 'ok' | 'same' | 'swapped' | 'locked' | 'unknown';

// Puts item `id` into slot `key`. Locked or unknown items (or an item of another slot)
// leave the selection alone. Picking the mob that already sits in the other mob slot
// swaps the two, so both mob slots always hold different mobs.
export function assignSlot(
  sel: Selection,
  key: SlotKey,
  id: string,
  items: readonly ItemCard[],
): { sel: Selection; result: AssignResult } {
  const item = items.find((i) => i.id === id);
  if (!item || item.slot !== slotOf(key)) return { sel, result: 'unknown' };
  if (item.locked) return { sel, result: 'locked' };
  if (selectedId(sel, key) === id) return { sel, result: 'same' };
  if (key === 'mob0' || key === 'mob1') {
    const other: SlotKey = key === 'mob0' ? 'mob1' : 'mob0';
    if (selectedId(sel, other) === id) {
      return { sel: withId(withId(sel, other, selectedId(sel, key)), key, id), result: 'swapped' };
    }
  }
  return { sel: withId(sel, key, id), result: 'ok' };
}

// Makes a selection playable: every slot holds an unlocked item of the right kind and the
// two mobs differ. Valid choices are kept; anything else falls back to the first unlocked
// item of that slot (in catalogue order). A slot with no unlocked item keeps its id.
export function repairSelection(sel: Selection, items: readonly ItemCard[]): Selection {
  const ok = (id: string, slot: ItemSlot): boolean => items.some((i) => i.id === id && i.slot === slot && !i.locked);
  const firstFree = (slot: ItemSlot, not: string[] = []): string | undefined =>
    items.find((i) => i.slot === slot && !i.locked && !not.includes(i.id))?.id;
  const pick = (id: string, slot: ItemSlot, not: string[] = []): string =>
    ok(id, slot) && !not.includes(id) ? id : (firstFree(slot, not) ?? id);
  const m0 = pick(sel.mobs[0], 'mob');
  const m1 = pick(sel.mobs[1], 'mob', [m0]);
  return {
    cannon: pick(sel.cannon, 'cannon'),
    mobs: [m0, m1],
    champion: pick(sel.champion, 'champion'),
    ultimate: pick(sel.ultimate, 'ultimate'),
  };
}

export function selectionEquals(a: Selection, b: Selection): boolean {
  return (
    a.cannon === b.cannon &&
    a.mobs[0] === b.mobs[0] &&
    a.mobs[1] === b.mobs[1] &&
    a.champion === b.champion &&
    a.ultimate === b.ultimate
  );
}

// Which picker entries are usable for slot `key`: locked items are inspect-only, and
// the other mob slot's mob is marked so the picker can say 'swap'.
export interface PickerEntry {
  item: ItemCard;
  current: boolean;
  inOtherSlot: boolean;
  usable: boolean;
}

export function pickerEntries(sel: Selection, key: SlotKey, items: readonly ItemCard[]): PickerEntry[] {
  const other = key === 'mob0' ? 'mob1' : key === 'mob1' ? 'mob0' : null;
  return itemsForSlot(items, slotOf(key)).map((item) => ({
    item,
    current: selectedId(sel, key) === item.id,
    inOtherSlot: other !== null && selectedId(sel, other) === item.id,
    usable: !item.locked,
  }));
}

// Tier pips: one pip per upgrade step, `tier` of them filled.
export function tierPips(tier: number, maxTier: number): boolean[] {
  const n = Math.max(0, Math.floor(maxTier));
  const t = Math.max(0, Math.min(n, Math.floor(tier)));
  return Array.from({ length: n }, (_, i) => i < t);
}

export function tierLabel(tier: number, maxTier: number): string {
  return tier >= maxTier ? 'Max' : `Tier ${tier}/${maxTier}`;
}

// 1234 → '1,234' (narrow, no locale surprises).
export function formatCoins(n: number): string {
  const v = Math.max(0, Math.floor(n));
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// What the collection's action button shows for an item.
export type CollectionAction =
  | { kind: 'upgrade'; cost: number; enabled: boolean }
  | { kind: 'buy'; cost: number; enabled: boolean }
  | { kind: 'max' }
  | { kind: 'locked' };

export function collectionAction(item: {
  locked: boolean;
  tier: number;
  maxTier: number;
  upgradeCost: number | null;
  buyPrice: number | null;
  canAfford: boolean;
}): CollectionAction {
  if (item.locked) {
    return item.buyPrice !== null ? { kind: 'buy', cost: item.buyPrice, enabled: item.canAfford } : { kind: 'locked' };
  }
  if (item.tier >= item.maxTier || item.upgradeCost === null) return { kind: 'max' };
  return { kind: 'upgrade', cost: item.upgradeCost, enabled: item.canAfford };
}

// Collection sections in slot order with per-section counts ('2/3 unlocked').
export function collectionSections<T extends ItemCard>(
  items: readonly T[],
): { slot: ItemSlot; title: string; items: T[]; unlocked: number; isNew: number }[] {
  return ITEM_SLOTS.map((slot) => {
    const list = itemsForSlot(items, slot);
    return {
      slot,
      title: SLOT_TITLE[slot],
      items: list,
      unlocked: list.filter((i) => !i.locked).length,
      isNew: list.filter((i) => i.isNew && !i.locked).length,
    };
  }).filter((s) => s.items.length > 0);
}

// Grid columns for item cards: as many as fit at `minCard` px with `gap` between.
export function gridColumns(width: number, minCard: number, gap: number, max = 4): number {
  if (width <= 0) return 1;
  return Math.max(1, Math.min(max, Math.floor((width + gap) / (minCard + gap))));
}
