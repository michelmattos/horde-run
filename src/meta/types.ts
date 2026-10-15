// View models of the milestone 4 meta screens (loadout, collection, home base). The
// screens only ever see these plain shapes; integration maps the progression profile
// onto them, so the screens stay independent of how progress is stored.
//
// Fixed shared ids (identical in every module):
//   cannons    popgun, repeater, blunderbuss
//   mobs       rifleman, knight, sprinter, bomber
//   champions  sarge, tank, drummer
//   ultimates  barrage, paratroopers, marble
//   buildings  barracks, walls, workshop, garden, flagpole

export type ItemSlot = 'cannon' | 'mob' | 'champion' | 'ultimate';

export interface ItemCard {
  id: string;
  slot: ItemSlot;
  name: string;
  text: string;
  tier: number; // 0 = base, upgraded up to maxTier
  maxTier: number;
  locked: boolean;
  hint: string; // how to unlock (shown on a locked item)
  isNew?: boolean; // unlocked since the player last looked
}

export interface LoadoutView {
  level: { code: string; name: string; boss?: string };
  coins: number;
  selected: { cannon: string; mobs: [string, string]; champion: string; ultimate: string };
  items: ItemCard[];
}

export interface CollectionItem extends ItemCard {
  stats: { label: string; value: string; next?: string }[];
  upgradeCost: number | null; // null when maxed or locked
  buyPrice: number | null; // coin-unlock items that are still locked
  canAfford: boolean;
}

export interface CollectionView {
  coins: number;
  items: CollectionItem[];
}

export interface BuildingView {
  id: string;
  name: string;
  tier: number; // 0 = empty plot, up to maxTier
  maxTier: number;
  perkNow: string;
  nextPerk?: string;
  nextCost: number | null; // null when fully built
  lockedReason?: string; // e.g. 'Win 1-5 first'
  canAfford: boolean;
}

export interface HomeView {
  coins: number;
  buildings: BuildingView[];
}
