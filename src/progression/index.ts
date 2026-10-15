// Public API of the progression layer (concept §7): item and village catalogs, unlocks,
// coins, upgrades, loadouts and the BattleLoadout handed to the battle layer. Pure: no
// Babylon, no DOM, no storage (persistence lives in src/core/save.ts).
export { BUILDINGS, ITEMS, STARTER_LOADOUT, UPGRADE_COSTS, getBuilding, getItem } from './catalog.ts';
export { buildingTier, emptyProfile, itemTier, parseProfile, starterLoadout } from './profile.ts';
export {
  MIX_EVERY,
  build,
  buildCost,
  buildingLocked,
  buildingPerkText,
  buyItem,
  buyLocked,
  buyPrice,
  isItemUnlocked,
  itemStats,
  markSeen,
  newlyUnlocked,
  resolveLoadout,
  setLoadout,
  unannouncedUnlocks,
  unlockHint,
  upgradeCost,
  upgradeItem,
  validateLoadout,
} from './rules.ts';
export {
  REWARDS,
  addCoins,
  applyCampaignResult,
  campaignReward,
  expeditionBattleReward,
  expeditionRunReward,
  recordExpeditionBattle,
  recordExpeditionRun,
  retroactiveCoins,
} from './economy.ts';
export type { RewardLine } from './economy.ts';
export { MAX_TIER } from './types.ts';
export type {
  BattleLoadout,
  BuildingDef,
  BuildingPerk,
  ChampionSpec,
  ItemDef,
  ItemSlot,
  Loadout,
  MobSpec,
  Profile,
  ProgressFacts,
  UltimateSpec,
  UnlockRule,
} from './types.ts';
