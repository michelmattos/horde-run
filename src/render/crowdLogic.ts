// Pure crowd bookkeeping (no Babylon, unit-tested under Node): which thin-instance batch a
// unit is drawn with, how big, and how it hops. The sim's render variant byte (Milestone 4)
// picks the model; a view without it draws today's look (riflemen and the champion).
import { LAYOUT, UnitKind } from '../contracts.ts';

// Unit variant bytes on the sim view (shared with the battle and progression tasks).
export const VARIANT = {
  rifleman: 0, // and every enemy mob
  knight: 1,
  sprinter: 2,
  bomber: 3,
  sarge: 8,
  tank: 9,
  drummer: 10,
} as const;

// Crowd batches, one thin-instanced mesh each (both armies share it: team is a colour).
export const SLOT = { rifleman: 0, knight: 1, sprinter: 2, bomber: 3, champion: 4 } as const;
export type CrowdSlot = (typeof SLOT)[keyof typeof SLOT];
export const SLOT_COUNT = 5;

export type ChampionId = 'sarge' | 'tank' | 'drummer';
export type CannonId = 'popgun' | 'repeater' | 'blunderbuss';

// Knights are 'heavy' units (UnitKind.Champion with a ~0.55 radius) drawn as a figure on
// the mob scale, a little under their collision size so packed knights do not overlap.
export const KNIGHT_SCALE = 0.85;

// Mobs: variant picks the figure. Champions: variant 1 is a knight; anything else is the
// loadout's champion (sarge, tank or drummer: setLoadout decides which meshes it uses).
export function crowdSlot(kind: number, variant: number): CrowdSlot {
  if (kind === UnitKind.Champion) return variant === VARIANT.knight ? SLOT.knight : SLOT.champion;
  if (variant === VARIANT.sprinter) return SLOT.sprinter;
  if (variant === VARIANT.bomber) return SLOT.bomber;
  if (variant === VARIANT.knight) return SLOT.knight;
  return SLOT.rifleman;
}

// Instance scale for a unit of collision radius r drawn in `slot` (the meshes are authored
// at mob size, 1.3 tall, and at champion size, radius ~1).
export function crowdScale(slot: CrowdSlot, r: number): number {
  if (slot === SLOT.champion) return r > 0 ? r / LAYOUT.championRadius : 1;
  if (slot === SLOT.knight) return r > 0 ? (r / LAYOUT.mobRadius) * KNIGHT_SCALE : 2 * KNIGHT_SCALE;
  return r > 0 ? r / LAYOUT.mobRadius : 1;
}

// How a figure hops along (multipliers on crowd.ts's base hop): sprinters bound quicker
// and lower, bombers plod under their pack, knights stomp, the tank only rumbles.
export interface HopStyle {
  speed: number;
  height: number;
  lean: number;
  waddle: number;
}

export const HOP_STYLE: Record<'rifleman' | 'knight' | 'sprinter' | 'bomber' | ChampionId, HopStyle> = {
  rifleman: { speed: 1, height: 1, lean: 1, waddle: 1 },
  knight: { speed: 0.8, height: 0.7, lean: 0.5, waddle: 0.8 },
  sprinter: { speed: 1.35, height: 0.8, lean: 1.2, waddle: 0.6 },
  bomber: { speed: 0.8, height: 0.75, lean: 0.6, waddle: 1.2 },
  sarge: { speed: 1, height: 0.6, lean: 0.4, waddle: 0.5 },
  tank: { speed: 2.2, height: 0.08, lean: 0.12, waddle: 0.12 },
  drummer: { speed: 1, height: 0.5, lean: 0.25, waddle: 0.7 },
};

export function slotStyle(slot: CrowdSlot, champion: ChampionId): HopStyle {
  switch (slot) {
    case SLOT.knight:
      return HOP_STYLE.knight;
    case SLOT.sprinter:
      return HOP_STYLE.sprinter;
    case SLOT.bomber:
      return HOP_STYLE.bomber;
    case SLOT.champion:
      return HOP_STYLE[champion];
    default:
      return HOP_STYLE.rifleman;
  }
}

export function parseChampion(id: string | undefined): ChampionId {
  return id === 'tank' || id === 'drummer' ? id : 'sarge';
}

export function parseCannon(id: string | undefined): CannonId {
  return id === 'repeater' || id === 'blunderbuss' ? id : 'popgun';
}
