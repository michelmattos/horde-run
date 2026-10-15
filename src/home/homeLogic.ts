// Pure rules of the home base screen: what a building card's tier line and Build button
// say, which buildings to animate when a fresh view arrives, and the tier map the 3D
// village is built from. No DOM, no Babylon: unit tested in Node.
import type { BuildingView } from '../meta/types.ts';
import { BUILDING_IDS, clampTier, isBuildingId } from './villagePieces.ts';
import type { BuildingId } from './villagePieces.ts';

export interface BuildingCardLook {
  tierText: string; // 'Empty plot', 'Tier 2/3'
  label: string; // 'Build' on an empty plot, else 'Upgrade'
  action: 'build' | 'locked' | 'poor' | 'built';
  why: string; // short reason the button is disabled ('' when it is not)
}

export function buildingCardLook(b: BuildingView): BuildingCardLook {
  const tierText = b.tier <= 0 ? 'Empty plot' : `Tier ${b.tier}/${b.maxTier}`;
  const label = b.tier <= 0 ? 'Build' : 'Upgrade';
  if (b.nextCost === null || b.tier >= b.maxTier) return { tierText, label, action: 'built', why: '' };
  if (b.lockedReason) return { tierText, label, action: 'locked', why: b.lockedReason };
  if (!b.canAfford) return { tierText, label, action: 'poor', why: 'not enough coins' };
  return { tierText, label, action: 'build', why: '' };
}

export type TierMap = Record<BuildingId, number>;

// Tier per known building (unknown ids ignored, missing ones at 0).
export function tiersOf(buildings: readonly { id: string; tier: number }[]): TierMap {
  const t: TierMap = { barracks: 0, walls: 0, workshop: 0, garden: 0, flagpole: 0 };
  for (const b of buildings) if (isBuildingId(b.id)) t[b.id] = clampTier(b.tier);
  return t;
}

// Buildings that went up since the last view the player saw (these get the build
// animation); none on the very first view.
export function grownBuildings(prev: TierMap | null, next: TierMap): BuildingId[] {
  if (!prev) return [];
  return BUILDING_IDS.filter((id) => next[id] > prev[id]);
}
