// Progression rules over the catalogs: unlocks, buying and upgrading items, building the
// village, loadout validation, and turning a loadout into battle inputs. All pure: every
// function returns new objects and never mutates its arguments.
import type { LevelDef } from '../contracts.ts';
import { BUILDINGS, ITEMS, STARTER_LOADOUT, UPGRADE_COSTS, getBuilding, getItem } from './catalog.ts';
import { buildingTier, itemTier, parseLoadout } from './profile.ts';
import { MAX_TIER } from './types.ts';
import type {
  BattleLoadout,
  ChampionSpec,
  ItemDef,
  ItemSlot,
  Loadout,
  MobSpec,
  Profile,
  ProgressFacts,
  UltimateSpec,
} from './types.ts';

// Every Nth cannon shot fires the second mob slot.
export const MIX_EVERY = 10;

// Boss levels get a named hint instead of "Clear level x-y".
const BOSS_NAMES: Record<string, string> = { '1-10': 'the Tin General', '2-10': 'the Snow Globe Giant' };

function cleared(facts: ProgressFacts, levelId: string): boolean {
  return facts.levels[levelId]?.stars[0] === true;
}
function totalStars(facts: ProgressFacts): number {
  let n = 0;
  for (const p of Object.values(facts.levels)) n += p.stars.filter(Boolean).length;
  return n;
}
function clearHint(levelId: string): string {
  const boss = BOSS_NAMES[levelId];
  return boss ? `Beat ${boss}` : `Clear level ${levelId}`;
}

// ---------- Unlocks ----------

export function isItemUnlocked(id: string, facts: ProgressFacts): boolean {
  const it = getItem(id);
  if (!it) return false;
  const r = it.unlock;
  switch (r.type) {
    case 'start':
      return true;
    case 'level':
      return cleared(facts, r.level);
    case 'stars':
      return totalStars(facts) >= r.count;
    case 'expeditionWins':
      return facts.profile.stats.expeditionBattlesWon >= r.count;
    case 'buy':
      return facts.profile.owned.includes(id);
  }
}

export function unlockHint(id: string): string {
  const r = getItem(id)?.unlock;
  if (!r) return '';
  switch (r.type) {
    case 'start':
      return 'Starter item';
    case 'level':
      return clearHint(r.level);
    case 'stars':
      return `Earn ${r.count} stars`;
    case 'expeditionWins':
      return `Win ${r.count} Expedition battles`;
    case 'buy':
      return `Buy for ${r.price} coins`;
  }
}

// Items unlocked in `after` that were locked in `before`, in catalog order.
export function newlyUnlocked(before: ProgressFacts, after: ProgressFacts): string[] {
  return ITEMS.filter((it) => !isItemUnlocked(it.id, before) && isItemUnlocked(it.id, after)).map((it) => it.id);
}

// Unlocked non-starter items the player hasn't been shown yet (see markSeen).
export function unannouncedUnlocks(facts: ProgressFacts): string[] {
  return ITEMS.filter(
    (it) => it.unlock.type !== 'start' && !facts.profile.seen.includes(it.id) && isItemUnlocked(it.id, facts),
  ).map((it) => it.id);
}

export function markSeen(profile: Profile, ids: readonly string[]): Profile {
  const add = ids.filter((id) => getItem(id) && !profile.seen.includes(id));
  return add.length ? { ...profile, seen: [...profile.seen, ...add] } : profile;
}

// ---------- Buying and upgrading items ----------

export function buyPrice(id: string): number | null {
  const r = getItem(id)?.unlock;
  return r?.type === 'buy' ? r.price : null;
}

// Why the item can't be bought right now (ignoring coins), or null when it can.
export function buyLocked(id: string, facts: ProgressFacts): string | null {
  const r = getItem(id)?.unlock;
  if (r?.type !== 'buy') return 'Not for sale';
  if (facts.profile.owned.includes(id)) return 'Already owned';
  if (r.after && !cleared(facts, r.after)) return `${clearHint(r.after)} first`;
  return null;
}

export function buyItem(profile: Profile, id: string, facts: ProgressFacts): Profile | null {
  const price = buyPrice(id);
  if (price === null || profile.coins < price) return null;
  if (buyLocked(id, { levels: facts.levels, profile }) !== null) return null;
  return { ...profile, coins: profile.coins - price, owned: [...profile.owned, id] };
}

// Coins to raise an item to `tier` (1..3); null for other tiers or unknown ids.
export function upgradeCost(id: string, tier: number): number | null {
  if (!getItem(id) || !Number.isInteger(tier) || tier < 1 || tier > MAX_TIER) return null;
  return UPGRADE_COSTS[tier - 1];
}

// Raises the item one tier when it is unlocked, below max and affordable.
export function upgradeItem(profile: Profile, id: string, facts: ProgressFacts): Profile | null {
  const next = itemTier(profile, id) + 1;
  const cost = upgradeCost(id, next);
  if (cost === null || profile.coins < cost) return null;
  if (!isItemUnlocked(id, { levels: facts.levels, profile })) return null;
  return { ...profile, coins: profile.coins - cost, tiers: { ...profile.tiers, [id]: next } };
}

// ---------- Village ----------

// Coins to build `tier` (1..3) of a building; null for other tiers or unknown ids.
export function buildCost(id: string, tier: number): number | null {
  const b = getBuilding(id);
  if (!b || !Number.isInteger(tier) || tier < 1 || tier > MAX_TIER) return null;
  return b.tiers[tier - 1].cost;
}

// Why `tier` of the building can't be built yet (progress, not coins), or null.
export function buildingLocked(id: string, tier: number, facts: ProgressFacts): string | null {
  const b = getBuilding(id);
  if (!b) return 'Unknown building';
  if (tier > MAX_TIER) return 'Fully built';
  const after = tier >= 1 ? b.tiers[tier - 1]?.after : undefined;
  return after && !cleared(facts, after) ? clearHint(after) : null;
}

export function build(profile: Profile, id: string, facts: ProgressFacts): Profile | null {
  const next = buildingTier(profile, id) + 1;
  const cost = buildCost(id, next);
  if (cost === null || profile.coins < cost) return null;
  if (buildingLocked(id, next, { levels: facts.levels, profile }) !== null) return null;
  return { ...profile, coins: profile.coins - cost, village: { ...profile.village, [id]: next } };
}

// One short line describing a building's perk at `tier` (0 = not built yet).
export function buildingPerkText(id: string, tier: number): string {
  const p = getBuilding(id)?.perk;
  if (!p) return '';
  switch (p.type) {
    case 'startCrowd':
      return `+${p.perTier * tier} starting troops`;
    case 'baseHp':
      return `+${Math.round(p.perTier * tier * 100)}% base health`;
    case 'championCharge':
      return `Champion charges ${Math.round((1 - p.perTier ** tier) * 100)}% faster`;
    case 'decor':
      return 'Decoration';
  }
}

// ---------- Display ----------

function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

export function itemStats(id: string, tier: number): { label: string; value: string }[] {
  const it = getItem(id);
  if (!it) return [];
  const t = Math.max(0, Math.min(MAX_TIER, Math.floor(tier)));
  switch (it.slot) {
    case 'cannon': {
      const s = it.tiers[t];
      const lines = [
        { label: 'Fire rate', value: `x${fmt(s.fireRate)}` },
        { label: 'Troops per shot', value: `x${fmt(s.unitsPerShot)}` },
      ];
      if (s.shotSpread !== undefined) lines.push({ label: 'Spread', value: 'Wide' });
      if (s.shot) lines.push({ label: 'Snowball', value: `Bursts at ${fmt(s.shot.burstWeight)} troops` });
      return lines;
    }
    case 'mob': {
      const s = it.tiers[t];
      const lines = [
        { label: 'Health', value: fmt(s.hp) },
        { label: 'Damage', value: fmt(s.damage) },
        { label: 'Speed', value: fmt(s.speed) },
        { label: 'Per shot', value: s.perShot === null ? 'Full shot' : fmt(s.perShot) },
      ];
      if (s.deathBlast) lines.push({ label: 'Blast damage', value: fmt(s.deathBlast.damage) });
      if (s.riders) lines.push({ label: 'Riders', value: `${fmt(s.riders)} troops` });
      return lines;
    }
    case 'champion': {
      const s = it.tiers[t];
      const lines = [
        { label: 'Health', value: `x${fmt(s.hpMul)}` },
        { label: 'Damage', value: `x${fmt(s.damageMul)}` },
        { label: 'Speed', value: fmt(s.speed) },
        { label: 'Charge time', value: `x${fmt(s.chargeMul)}` },
      ];
      if (s.echo > 0) lines.push({ label: 'Rallies', value: `+${fmt(s.echo)} troops` });
      return lines;
    }
    case 'ultimate': {
      const s = it.tiers[t];
      return [
        { label: 'Charge', value: `${fmt(s.chargeNeeded)} troops` },
        it.id === 'blizzard'
          ? { label: 'Freeze', value: `${fmt(s.power)} s` }
          : { label: 'Power', value: fmt(s.power) },
      ];
    }
  }
}

// ---------- Loadouts ----------

function pick(id: string, slot: ItemSlot, facts: ProgressFacts): string | null {
  return getItem(id)?.slot === slot && isItemUnlocked(id, facts) ? id : null;
}

// Locked, unknown or wrong-slot picks fall back to the starter; the two mobs always differ.
export function validateLoadout(loadout: Loadout, facts: ProgressFacts): Loadout {
  const s = STARTER_LOADOUT;
  const v0 = pick(loadout.mobs[0], 'mob', facts);
  const v1 = pick(loadout.mobs[1], 'mob', facts);
  const m0 = v0 ?? (s.mobs[0] !== v1 ? s.mobs[0] : s.mobs[1]);
  const m1 = v1 !== null && v1 !== m0 ? v1 : s.mobs[0] !== m0 ? s.mobs[0] : s.mobs[1];
  return {
    cannon: pick(loadout.cannon, 'cannon', facts) ?? s.cannon,
    mobs: [m0, m1],
    champion: pick(loadout.champion, 'champion', facts) ?? s.champion,
    ultimate: pick(loadout.ultimate, 'ultimate', facts) ?? s.ultimate,
  };
}

export function setLoadout(profile: Profile, loadout: Loadout, facts: ProgressFacts): Profile {
  return { ...profile, loadout: validateLoadout(loadout, { levels: facts.levels, profile }) };
}

function itemOf<S extends ItemSlot>(id: string, slot: S): Extract<ItemDef, { slot: S }> {
  const it = getItem(id);
  if (it?.slot !== slot) throw new Error(`Not a ${slot}: ${id}`); // parseLoadout guarantees slots
  return it as Extract<ItemDef, { slot: S }>;
}

function mobSpec(id: string, tier: number): MobSpec {
  const it = itemOf(id, 'mob');
  const s = it.tiers[tier];
  const spec: MobSpec = {
    id,
    variant: it.variant,
    kind: it.kind,
    perShot: s.perShot,
    hp: s.hp,
    damage: s.damage,
    radius: s.radius,
    speed: s.speed,
  };
  if (s.deathBlast) spec.deathBlast = { ...s.deathBlast };
  if (s.riders) spec.riders = s.riders;
  return spec;
}

function championSpec(id: string, tier: number): ChampionSpec {
  const it = itemOf(id, 'champion');
  return { id, variant: it.variant, ...it.tiers[tier] };
}

function ultimateSpec(id: string, tier: number): UltimateSpec {
  const it = itemOf(id, 'ultimate');
  return { id: it.id, ...it.tiers[tier] };
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

// Turns the profile's loadout into a transformed copy of the level (cannon, village perks)
// plus the BattleLoadout. Never mutates `level`. Ids are slot-checked but not unlock-checked:
// keep profile.loadout validated with setLoadout. Options default to true; the Expedition
// can pass useUpgrades/useVillage false for a level playing field.
export function resolveLoadout(
  level: LevelDef,
  profile: Profile,
  opts?: { useUpgrades?: boolean; useVillage?: boolean },
): { level: LevelDef; battle: BattleLoadout } {
  const lo = parseLoadout(profile.loadout);
  const useUpgrades = opts?.useUpgrades ?? true;
  const useVillage = opts?.useVillage ?? true;
  const tierOf = (id: string): number => (useUpgrades ? itemTier(profile, id) : 0);
  const out = structuredClone(level);

  const c = itemOf(lo.cannon, 'cannon').tiers[tierOf(lo.cannon)];
  if (c.fireRate !== 1) out.cannon.fireRate = round3(level.cannon.fireRate * c.fireRate);
  if (c.unitsPerShot !== 1)
    out.cannon.unitsPerShot = Math.max(1, Math.round(level.cannon.unitsPerShot * c.unitsPerShot));
  if (c.shotSpread !== undefined) out.mods = { ...out.mods, shotSpread: c.shotSpread };
  // Fixed-count mobs (knight, bomber) follow the cannon's mobs per shot too, so a fast,
  // small-shot cannon does not fire them at its full rate; the battle carries fractions.
  const shotRatio = out.cannon.unitsPerShot / level.cannon.unitsPerShot;
  const scaled = (m: MobSpec): MobSpec =>
    m.perShot === null || shotRatio === 1 ? m : { ...m, perShot: round3(m.perShot * shotRatio) };

  if (useVillage) {
    for (const b of BUILDINGS) {
      const t = buildingTier(profile, b.id);
      if (t === 0) continue;
      const p = b.perk;
      if (p.type === 'startCrowd') out.mods = { ...out.mods, startCrowd: (out.mods?.startCrowd ?? 0) + p.perTier * t };
      else if (p.type === 'baseHp') out.playerBase.hp = Math.round(out.playerBase.hp * (1 + p.perTier * t));
      else if (p.type === 'championCharge')
        out.champion.chargeNeeded = Math.max(1, Math.round(out.champion.chargeNeeded * p.perTier ** t));
    }
  }

  const battle: BattleLoadout = {
    mobs: [scaled(mobSpec(lo.mobs[0], tierOf(lo.mobs[0]))), scaled(mobSpec(lo.mobs[1], tierOf(lo.mobs[1])))],
    mixEvery: MIX_EVERY,
    champion: championSpec(lo.champion, tierOf(lo.champion)),
    ultimate: ultimateSpec(lo.ultimate, tierOf(lo.ultimate)),
  };
  if (c.shot) battle.shot = { ...c.shot };
  return { level: out, battle };
}
