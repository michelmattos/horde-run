// Shapes for the progression layer: the item and village catalogs, the player's profile
// (coins, tiers, loadout, village) and the per-battle loadout handed to the battle layer.
// BattleLoadout and its specs are the battle layer's own (src/game/loadout.ts).
import type { SaveData } from '../contracts.ts';

// ---------- Battle loadout (shared with the battle task) ----------

import type { BattleLoadout, ChampionSpec, MobSpec, ShotSpec, UltimateSpec } from '../game/loadout.ts';
export type { BattleLoadout, ChampionSpec, MobSpec, ShotSpec, UltimateSpec };

// ---------- Catalog ----------

export type ItemSlot = 'cannon' | 'mob' | 'champion' | 'ultimate';
export const MAX_TIER = 3;

export type UnlockRule =
  | { type: 'start' }
  | { type: 'level'; level: string }
  | { type: 'stars'; count: number }
  | { type: 'expeditionWins'; count: number }
  | { type: 'buy'; price: number; after?: string };

// Cannon stats are multipliers on LevelDef.cannon; shotSpread sets mods.shotSpread; shot
// (the Snowball Launcher, the Gear Gun) goes to BattleLoadout.shot.
export interface CannonStats {
  fireRate: number;
  unitsPerShot: number;
  shotSpread?: number;
  shot?: ShotSpec;
}
export type MobStats = Omit<MobSpec, 'id' | 'variant' | 'kind'>;
export type ChampionStats = Omit<ChampionSpec, 'id' | 'variant'>;
export type UltimateStats = Omit<UltimateSpec, 'id'>;

interface ItemBase {
  id: string;
  name: string;
  text: string; // one line for the collection card
  unlock: UnlockRule;
}
export interface CannonItem extends ItemBase {
  slot: 'cannon';
  tiers: CannonStats[]; // index = tier 0..3
}
export interface MobItem extends ItemBase {
  slot: 'mob';
  variant: number;
  kind: 'mob' | 'heavy';
  tiers: MobStats[];
}
export interface ChampionItem extends ItemBase {
  slot: 'champion';
  variant: number;
  tiers: ChampionStats[];
}
export interface UltimateItem extends ItemBase {
  slot: 'ultimate';
  id: UltimateSpec['id'];
  tiers: UltimateStats[];
}
export type ItemDef = CannonItem | MobItem | ChampionItem | UltimateItem;

export type BuildingPerk =
  | { type: 'startCrowd'; perTier: number } // + starting mobs per tier
  | { type: 'baseHp'; perTier: number } // + fraction of player base HP per tier
  | { type: 'championCharge'; perTier: number } // chargeNeeded multiplied by this per tier
  | { type: 'decor' };

export interface BuildingDef {
  id: string;
  name: string;
  text: string;
  perk: BuildingPerk;
  tiers: { cost: number; after?: string }[]; // index 0 = tier 1 .. index 2 = tier 3
}

// ---------- Player state ----------

export interface Loadout {
  cannon: string;
  mobs: [string, string];
  champion: string;
  ultimate: string;
}

export interface Profile {
  coins: number;
  coinsEarned: number; // lifetime total, never decreases
  owned: string[]; // items bought with coins
  tiers: Record<string, number>; // item id -> upgrade tier 1..3 (absent = 0)
  loadout: Loadout;
  village: Record<string, number>; // building id -> tier 1..3 (absent = 0)
  stats: { expeditionBattlesWon: number; expeditionRunsFinished: number; expeditionRunsWon: number };
  seen: string[]; // unlocks already announced to the player
}

// Everything unlock rules look at.
export interface ProgressFacts {
  levels: SaveData['levels'];
  profile: Profile;
}
