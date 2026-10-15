// The player's progression profile: a fresh one, defensive parsing of stored or
// imported data (never throws, drops what it doesn't understand), and tier lookups.
import { STARTER_LOADOUT, getBuilding, getItem } from './catalog.ts';
import { MAX_TIER } from './types.ts';
import type { ItemSlot, Loadout, Profile } from './types.ts';

export function starterLoadout(): Loadout {
  const s = STARTER_LOADOUT;
  return { cannon: s.cannon, mobs: [s.mobs[0], s.mobs[1]], champion: s.champion, ultimate: s.ultimate };
}

export function emptyProfile(): Profile {
  return {
    coins: 0,
    coinsEarned: 0,
    owned: [],
    tiers: {},
    loadout: starterLoadout(),
    village: {},
    stats: { expeditionBattlesWon: 0, expeditionRunsFinished: 0, expeditionRunsWon: 0 },
    seen: [],
  };
}

export function itemTier(profile: Profile, id: string): number {
  return profile.tiers[id] ?? 0;
}
export function buildingTier(profile: Profile, id: string): number {
  return profile.village[id] ?? 0;
}

type Obj = Record<string, unknown>;
function isRecord(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function count(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}
function tier(v: unknown): number {
  return Math.min(MAX_TIER, count(v));
}
function idList(v: unknown, known: (id: string) => boolean): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x): x is string => typeof x === 'string' && known(x)))];
}
function tierMap(v: unknown, known: (id: string) => boolean): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isRecord(v)) return out;
  for (const [id, t] of Object.entries(v)) {
    const n = tier(t);
    if (known(id) && n > 0) out[id] = n;
  }
  return out;
}
function slotId(v: unknown, slot: ItemSlot, fallback: string): string {
  return typeof v === 'string' && getItem(v)?.slot === slot ? v : fallback;
}

// Slot-correct ids only; unlock checks need campaign facts and happen in validateLoadout.
export function parseLoadout(v: unknown): Loadout {
  const s = starterLoadout();
  if (!isRecord(v)) return s;
  const mobs = Array.isArray(v.mobs) ? v.mobs : [];
  let m0 = slotId(mobs[0], 'mob', s.mobs[0]);
  let m1 = slotId(mobs[1], 'mob', s.mobs[1]);
  if (m0 === m1) [m0, m1] = [s.mobs[0], s.mobs[1]];
  return {
    cannon: slotId(v.cannon, 'cannon', s.cannon),
    mobs: [m0, m1],
    champion: slotId(v.champion, 'champion', s.champion),
    ultimate: slotId(v.ultimate, 'ultimate', s.ultimate),
  };
}

const isItem = (id: string): boolean => getItem(id) !== undefined;
const isBuilding = (id: string): boolean => getBuilding(id) !== undefined;

// Returns null when v is not an object at all; otherwise repairs field by field:
// coins clamp to >= 0, unknown ids are dropped and tiers clamp to 0..3.
export function parseProfile(v: unknown): Profile | null {
  if (!isRecord(v)) return null;
  const st = isRecord(v.stats) ? v.stats : {};
  const coins = count(v.coins);
  return {
    coins,
    coinsEarned: Math.max(coins, count(v.coinsEarned)),
    owned: idList(v.owned, (id) => getItem(id)?.unlock.type === 'buy'),
    tiers: tierMap(v.tiers, isItem),
    loadout: parseLoadout(v.loadout),
    village: tierMap(v.village, isBuilding),
    stats: {
      expeditionBattlesWon: count(st.expeditionBattlesWon),
      expeditionRunsFinished: count(st.expeditionRunsFinished),
      expeditionRunsWon: count(st.expeditionRunsWon),
    },
    seen: idList(v.seen, isItem),
  };
}
