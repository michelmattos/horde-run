// Progression → screen view models. The loadout, collection and home base screens only
// see the plain shapes of src/meta/types.ts; this maps the player's profile and campaign
// stars (ProgressFacts) onto them: names, tiers, lock hints, prices and what the player
// can afford. Pure (no DOM, no Babylon) so it is tested in Node.
import {
  BUILDINGS,
  ITEMS,
  MAX_TIER,
  buildCost,
  buildingLocked,
  buildingPerkText,
  buildingTier,
  buyLocked,
  buyPrice,
  isItemUnlocked,
  itemStats,
  itemTier,
  unannouncedUnlocks,
  unlockHint,
  upgradeCost,
} from '../progression/index.ts';
import type { ProgressFacts } from '../progression/index.ts';
import type { CollectionItem, CollectionView, HomeView, ItemCard, LoadoutView } from './types.ts';

export function itemCards(facts: ProgressFacts): ItemCard[] {
  const fresh = new Set(unannouncedUnlocks(facts));
  return ITEMS.map((it) => {
    const locked = !isItemUnlocked(it.id, facts);
    // A coin item that cannot be bought yet says what gates the sale instead of its price.
    const gate = locked && buyPrice(it.id) !== null ? buyLocked(it.id, facts) : null;
    return {
      id: it.id,
      slot: it.slot,
      name: it.name,
      text: it.text,
      tier: itemTier(facts.profile, it.id),
      maxTier: MAX_TIER,
      locked,
      hint: gate ?? unlockHint(it.id),
      ...(fresh.has(it.id) ? { isNew: true } : {}),
    };
  });
}

export function loadoutView(
  level: { id: string; name: string; boss?: { name: string } },
  facts: ProgressFacts,
): LoadoutView {
  const lo = facts.profile.loadout;
  return {
    level: { code: level.id, name: level.name, ...(level.boss ? { boss: level.boss.name } : {}) },
    coins: facts.profile.coins,
    selected: { cannon: lo.cannon, mobs: [lo.mobs[0], lo.mobs[1]], champion: lo.champion, ultimate: lo.ultimate },
    items: itemCards(facts),
  };
}

export function collectionView(facts: ProgressFacts): CollectionView {
  const coins = facts.profile.coins;
  const items: CollectionItem[] = itemCards(facts).map((card) => {
    const now = itemStats(card.id, card.tier);
    const next = card.tier < card.maxTier && !card.locked ? itemStats(card.id, card.tier + 1) : [];
    const stats = now.map((s, i) => {
      const n = next[i]?.value;
      return n !== undefined && n !== s.value ? { ...s, next: n } : s;
    });
    const up = card.locked ? null : upgradeCost(card.id, card.tier + 1);
    const price = card.locked && buyLocked(card.id, facts) === null ? buyPrice(card.id) : null;
    const cost = up ?? price;
    return { ...card, stats, upgradeCost: up, buyPrice: price, canAfford: cost !== null && coins >= cost };
  });
  return { coins, items };
}

export function homeView(facts: ProgressFacts): HomeView {
  const coins = facts.profile.coins;
  return {
    coins,
    buildings: BUILDINGS.map((b) => {
      const tier = buildingTier(facts.profile, b.id);
      const full = tier >= MAX_TIER;
      const nextCost = full ? null : buildCost(b.id, tier + 1);
      const lock = full ? null : buildingLocked(b.id, tier + 1, facts);
      return {
        id: b.id,
        name: b.name,
        tier,
        maxTier: MAX_TIER,
        perkNow: tier > 0 ? buildingPerkText(b.id, tier) : b.text,
        ...(full ? {} : { nextPerk: buildingPerkText(b.id, tier + 1) }),
        nextCost,
        ...(lock ? { lockedReason: `${lock} first` } : {}),
        canAfford: nextCost !== null && lock === null && coins >= nextCost,
      };
    }),
  };
}
