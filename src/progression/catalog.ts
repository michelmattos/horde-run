// Loads and validates the item and village catalogs from src/data/progression. A bad
// data file throws at import time with the offending id, so a typo never reaches play.
import itemsJson from '../data/progression/items.json' with { type: 'json' };
import villageJson from '../data/progression/village.json' with { type: 'json' };
import { MAX_TIER } from './types.ts';
import type { BuildingDef, BuildingPerk, ItemDef, ItemSlot, Loadout, UnlockRule } from './types.ts';

type Obj = Record<string, unknown>;

const SLOTS: readonly ItemSlot[] = ['cannon', 'mob', 'champion', 'ultimate'];
const ULTIMATE_IDS = ['barrage', 'paratroopers', 'marble'] as const;
const PERKS: readonly BuildingPerk['type'][] = ['startCrowd', 'baseHp', 'championCharge', 'decor'];

function isRecord(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function fail(where: string, what: string): never {
  throw new Error(`Progression data: ${where}: ${what}`);
}
function num(o: Obj, key: string, where: string, min = 0): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min) fail(where, `"${key}" must be a number >= ${min}`);
  return v;
}
function str(o: Obj, key: string, where: string): string {
  const v = o[key];
  if (typeof v !== 'string' || v === '') fail(where, `"${key}" must be a non-empty string`);
  return v;
}

function parseUnlock(v: unknown, where: string): UnlockRule {
  if (!isRecord(v)) fail(where, 'missing unlock rule');
  switch (v.type) {
    case 'start':
      return { type: 'start' };
    case 'level':
      return { type: 'level', level: str(v, 'level', where) };
    case 'stars':
      return { type: 'stars', count: num(v, 'count', where, 1) };
    case 'expeditionWins':
      return { type: 'expeditionWins', count: num(v, 'count', where, 1) };
    case 'buy': {
      const rule: UnlockRule = { type: 'buy', price: num(v, 'price', where, 1) };
      if (v.after !== undefined) rule.after = str(v, 'after', where);
      return rule;
    }
    default:
      return fail(where, `unknown unlock type ${String(v.type)}`);
  }
}

// Each tier object is checked against the slot's numeric keys and copied (no extra keys).
function parseTiers<T>(v: unknown, where: string, parseTier: (o: Obj, w: string) => T): T[] {
  if (!Array.isArray(v) || v.length !== MAX_TIER + 1) fail(where, `needs exactly ${MAX_TIER + 1} tiers`);
  return v.map((t, i) => {
    if (!isRecord(t)) fail(`${where} tier ${i}`, 'not an object');
    return parseTier(t, `${where} tier ${i}`);
  });
}

function parseItem(v: unknown, i: number): ItemDef {
  if (!isRecord(v)) fail(`item #${i}`, 'not an object');
  const id = str(v, 'id', `item #${i}`);
  const base = { id, name: str(v, 'name', id), text: str(v, 'text', id), unlock: parseUnlock(v.unlock, id) };
  switch (v.slot) {
    case 'cannon':
      return {
        ...base,
        slot: 'cannon',
        tiers: parseTiers(v.tiers, id, (t, w) => {
          const s = { fireRate: num(t, 'fireRate', w, 0.01), unitsPerShot: num(t, 'unitsPerShot', w, 0.01) };
          return t.shotSpread === undefined ? s : { ...s, shotSpread: num(t, 'shotSpread', w) };
        }),
      };
    case 'mob': {
      const kind = v.kind;
      if (kind !== 'mob' && kind !== 'heavy') fail(id, 'kind must be "mob" or "heavy"');
      return {
        ...base,
        slot: 'mob',
        variant: num(v, 'variant', id),
        kind,
        tiers: parseTiers(v.tiers, id, (t, w) => {
          const s = {
            perShot: t.perShot === null ? null : num(t, 'perShot', w, 1),
            hp: num(t, 'hp', w, 0.01),
            damage: num(t, 'damage', w, 0.01),
            radius: num(t, 'radius', w, 0.05),
            speed: num(t, 'speed', w, 0.1),
          };
          if (t.deathBlast === undefined) return s;
          if (!isRecord(t.deathBlast)) fail(w, 'deathBlast must be an object');
          const b = t.deathBlast;
          return { ...s, deathBlast: { radius: num(b, 'radius', w, 0.1), damage: num(b, 'damage', w, 0.01) } };
        }),
      };
    }
    case 'champion':
      return {
        ...base,
        slot: 'champion',
        variant: num(v, 'variant', id),
        tiers: parseTiers(v.tiers, id, (t, w) => ({
          hpMul: num(t, 'hpMul', w, 0.01),
          damageMul: num(t, 'damageMul', w, 0.01),
          radius: num(t, 'radius', w, 0.05),
          speed: num(t, 'speed', w, 0.1),
          chargeMul: num(t, 'chargeMul', w, 0.01),
          echo: num(t, 'echo', w),
        })),
      };
    case 'ultimate': {
      const uid = ULTIMATE_IDS.find((u) => u === id);
      if (!uid) fail(id, 'not a known ultimate id');
      return {
        ...base,
        id: uid,
        slot: 'ultimate',
        tiers: parseTiers(v.tiers, id, (t, w) => ({
          chargeNeeded: num(t, 'chargeNeeded', w, 1),
          power: num(t, 'power', w, 0.01),
        })),
      };
    }
    default:
      return fail(id, `unknown slot ${String(v.slot)}`);
  }
}

function parseBuilding(v: unknown, i: number): BuildingDef {
  if (!isRecord(v)) fail(`building #${i}`, 'not an object');
  const id = str(v, 'id', `building #${i}`);
  const p = v.perk;
  if (!isRecord(p) || !PERKS.includes(p.type as BuildingPerk['type'])) fail(id, 'bad perk');
  const perk: BuildingPerk =
    p.type === 'decor' ? { type: 'decor' } : { type: p.type as 'startCrowd', perTier: num(p, 'perTier', id, 0.01) };
  if (!Array.isArray(v.tiers) || v.tiers.length !== MAX_TIER) fail(id, `needs exactly ${MAX_TIER} build tiers`);
  const tiers = (v.tiers as unknown[]).map((t, k) => {
    if (!isRecord(t)) fail(`${id} tier ${k + 1}`, 'not an object');
    const cost = num(t, 'cost', `${id} tier ${k + 1}`, 1);
    return t.after === undefined ? { cost } : { cost, after: str(t, 'after', `${id} tier ${k + 1}`) };
  });
  return { id, name: str(v, 'name', id), text: str(v, 'text', id), perk, tiers };
}

function uniqueIds<T extends { id: string }>(list: T[], what: string): T[] {
  const seen = new Set<string>();
  for (const x of list) {
    if (seen.has(x.id)) fail(x.id, `duplicate ${what} id`);
    seen.add(x.id);
  }
  return list;
}

export function parseItemCatalog(v: unknown): { items: ItemDef[]; upgradeCosts: number[] } {
  if (!isRecord(v) || !Array.isArray(v.items)) fail('items.json', 'missing items list');
  const costs = v.upgradeCosts;
  if (!Array.isArray(costs) || costs.length !== MAX_TIER || !costs.every((c) => typeof c === 'number' && c > 0))
    fail('items.json', `upgradeCosts needs ${MAX_TIER} positive numbers`);
  const items = uniqueIds((v.items as unknown[]).map(parseItem), 'item');
  for (const slot of SLOTS) if (!items.some((it) => it.slot === slot)) fail('items.json', `no ${slot} items`);
  return { items, upgradeCosts: costs as number[] };
}

export function parseVillage(v: unknown): BuildingDef[] {
  if (!isRecord(v) || !Array.isArray(v.buildings)) fail('village.json', 'missing buildings list');
  return uniqueIds((v.buildings as unknown[]).map(parseBuilding), 'building');
}

const catalog = parseItemCatalog(itemsJson as unknown);

export const ITEMS: readonly ItemDef[] = catalog.items;
export const UPGRADE_COSTS: readonly number[] = catalog.upgradeCosts; // index 0 = cost of tier 1
export const BUILDINGS: readonly BuildingDef[] = parseVillage(villageJson as unknown);

// Treat as read-only: copy it (see starterLoadout in profile.ts) before handing it out.
export const STARTER_LOADOUT: Readonly<Loadout> = {
  cannon: 'popgun',
  mobs: ['rifleman', 'knight'],
  champion: 'sarge',
  ultimate: 'barrage',
};

const itemById = new Map<string, ItemDef>(ITEMS.map((it) => [it.id, it]));
const buildingById = new Map<string, BuildingDef>(BUILDINGS.map((b) => [b.id, b]));

export function getItem(id: string): ItemDef | undefined {
  return itemById.get(id);
}
export function getBuilding(id: string): BuildingDef | undefined {
  return buildingById.get(id);
}

// Every starter id must exist in the right slot; checked once at load.
for (const [slot, id] of [
  ['cannon', STARTER_LOADOUT.cannon],
  ['mob', STARTER_LOADOUT.mobs[0]],
  ['mob', STARTER_LOADOUT.mobs[1]],
  ['champion', STARTER_LOADOUT.champion],
  ['ultimate', STARTER_LOADOUT.ultimate],
] as const) {
  if (getItem(id)?.slot !== slot) fail('starter loadout', `${id} is not a ${slot}`);
}
