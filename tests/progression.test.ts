// Progression rules: catalog shape, unlocks, buying/upgrading, village, loadout
// validation and resolveLoadout (the level transform plus BattleLoadout).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BATTLE_LOADOUT } from '../src/game/loadout.ts';
import { TIER0 } from './balance-play.ts';
import {
  BUILDINGS,
  ITEMS,
  MAX_TIER,
  STARTER_LOADOUT,
  build,
  buildCost,
  buildingLocked,
  buyItem,
  buyLocked,
  emptyProfile,
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
} from '../src/progression/index.ts';
import type { ItemDef, Profile, ProgressFacts } from '../src/progression/index.ts';
import type { LevelDef, LevelProgress } from '../src/contracts.ts';

const W: LevelProgress = { stars: [true, false, false] };
const W3: LevelProgress = { stars: [true, true, true] };

function cleared(n: number, p: LevelProgress = W): Record<string, LevelProgress> {
  const out: Record<string, LevelProgress> = {};
  for (let i = 1; i <= n; i++) out[`1-${i}`] = p;
  return out;
}
function facts(levels: Record<string, LevelProgress> = {}, profile: Profile = emptyProfile()): ProgressFacts {
  return { levels, profile };
}
function rich(coins = 10_000): Profile {
  return { ...emptyProfile(), coins };
}

const level: LevelDef = {
  id: '1-4',
  name: 'Fixture',
  lane: { width: 10, length: 55 },
  cannon: { fireRate: 6, unitsPerShot: 3, aimLimit: 4 },
  playerBase: { hp: 320 },
  enemyBase: { hp: 1500, x: 0, width: 6 },
  gates: [{ id: 'g', op: 'mul', value: 2, x: 0, z: 18, width: 4 }],
  enemyWaves: [{ at: 8, count: 60, x: 0, spread: 3.5 }],
  champion: { chargeNeeded: 280, hp: 110, damage: 80 },
  targetTime: 90,
  mods: { mobHp: 1.2 },
};

test('unlock rules', () => {
  const f0 = facts();
  const unlocked = (f: ProgressFacts) => ITEMS.filter((it) => isItemUnlocked(it.id, f)).map((it) => it.id);
  assert.deepEqual(unlocked(f0), ['popgun', 'rifleman', 'knight', 'sarge', 'barrage']);
  assert.equal(isItemUnlocked('sprinter', facts(cleared(2))), false);
  assert.equal(isItemUnlocked('sprinter', facts(cleared(3))), true);
  assert.equal(isItemUnlocked('repeater', facts(cleared(4))), true);
  assert.equal(isItemUnlocked('paratroopers', facts(cleared(6))), true);
  assert.equal(isItemUnlocked('bomber', facts(cleared(8))), true);
  assert.equal(isItemUnlocked('tank', facts(cleared(9))), false);
  assert.equal(isItemUnlocked('tank', facts(cleared(10))), true);
  // A level with progress but no win star doesn't count as cleared.
  assert.equal(isItemUnlocked('sprinter', facts({ ...cleared(2), '1-3': { stars: [false, false, false] } })), false);
  assert.equal(isItemUnlocked('marble', facts(cleared(6, W3))), false, '18 stars');
  assert.equal(isItemUnlocked('marble', facts(cleared(7, W3))), true, '21 stars');
  const exp = (n: number) => ({
    ...emptyProfile(),
    stats: { expeditionBattlesWon: n, expeditionRunsFinished: 0, expeditionRunsWon: 0 },
  });
  assert.equal(isItemUnlocked('blunderbuss', facts({}, exp(4))), false);
  assert.equal(isItemUnlocked('blunderbuss', facts({}, exp(5))), true);
  assert.equal(isItemUnlocked('drummer', facts(cleared(10))), false, 'must be bought');
  assert.equal(isItemUnlocked('drummer', facts({}, { ...emptyProfile(), owned: ['drummer'] })), true);
  assert.equal(isItemUnlocked('nope', f0), false);
});

test('newlyUnlocked and announcement bookkeeping', () => {
  const before = facts(cleared(2));
  const after = facts(cleared(4, W3));
  assert.deepEqual(newlyUnlocked(before, after), ['repeater', 'sprinter']);
  assert.deepEqual(newlyUnlocked(after, after), []);
  assert.deepEqual(unannouncedUnlocks(after), ['repeater', 'sprinter']);
  const p = markSeen(after.profile, ['sprinter', 'ghost']);
  assert.deepEqual(p.seen, ['sprinter']);
  assert.deepEqual(unannouncedUnlocks(facts(after.levels, p)), ['repeater']);
  assert.deepEqual(after.profile.seen, [], 'not mutated');
});

test('buying the drummer', () => {
  const p = rich(500);
  assert.equal(buyLocked('drummer', facts(cleared(1), p)), 'Clear level 1-2 first');
  assert.equal(buyItem(p, 'drummer', facts(cleared(1))), null);
  assert.equal(buyLocked('drummer', facts(cleared(2), p)), null);
  assert.equal(buyItem(rich(299), 'drummer', facts(cleared(2))), null, 'too poor');
  const bought = buyItem(p, 'drummer', facts(cleared(2)));
  assert.ok(bought);
  assert.equal(bought.coins, 200);
  assert.deepEqual(bought.owned, ['drummer']);
  assert.equal(p.coins, 500, 'not mutated');
  assert.equal(buyItem(bought, 'drummer', facts(cleared(2))), null, 'only once');
  assert.equal(buyLocked('drummer', facts(cleared(2), bought)), 'Already owned');
  assert.equal(buyItem(p, 'rifleman', facts(cleared(2))), null, 'not for sale');
  assert.equal(isItemUnlocked('drummer', facts(cleared(2), bought)), true);
});

test('upgrading items: costs, gating and max tier', () => {
  assert.equal(upgradeCost('rifleman', 0), null);
  assert.equal(upgradeCost('rifleman', 4), null);
  assert.equal(upgradeCost('ghost', 1), null);
  const c = [1, 2, 3].map((t) => upgradeCost('rifleman', t) ?? 0);
  assert.ok(c[0] > 0 && c[0] < c[1] && c[1] < c[2]);

  let p: Profile | null = rich(1000);
  for (let t = 1; t <= 3; t++) {
    p = upgradeItem(p!, 'rifleman', facts());
    assert.ok(p);
    assert.equal(p.tiers.rifleman, t);
  }
  assert.equal(p!.coins, 1000 - c[0] - c[1] - c[2]);
  assert.equal(upgradeItem(p!, 'rifleman', facts()), null, 'max tier');
  assert.equal(upgradeItem(rich(1000), 'sprinter', facts()), null, 'locked');
  assert.ok(upgradeItem(rich(1000), 'sprinter', facts(cleared(3))));
  assert.equal(upgradeItem(rich(c[0] - 1), 'rifleman', facts()), null, 'too poor');
});

test('village: costs, progress gates, perks text', () => {
  for (const b of BUILDINGS) {
    const costs = [1, 2, 3].map((t) => buildCost(b.id, t) ?? 0);
    assert.ok(costs[0] > 0 && costs[0] < costs[1] && costs[1] < costs[2], b.id);
    assert.equal(buildCost(b.id, 4), null);
  }
  assert.equal(buildingLocked('walls', 1, facts()), null);
  assert.equal(buildingLocked('walls', 2, facts(cleared(4))), 'Clear level 1-5');
  assert.equal(buildingLocked('walls', 2, facts(cleared(5))), null);
  assert.equal(buildingLocked('walls', 3, facts(cleared(9))), 'Beat the Tin General');
  assert.equal(buildingLocked('walls', 4, facts(cleared(10))), 'Fully built');

  let p: Profile | null = rich(5000);
  p = build(p, 'barracks', facts(cleared(4)));
  assert.equal(p?.village.barracks, 1);
  assert.equal(build(p!, 'barracks', facts(cleared(4))), null, 'tier 2 needs 1-5');
  p = build(p!, 'barracks', facts(cleared(5)));
  assert.equal(p?.village.barracks, 2);
  p = build(p!, 'barracks', facts(cleared(10)));
  assert.equal(p?.village.barracks, 3);
  assert.equal(build(p!, 'barracks', facts(cleared(10))), null, 'max');
  assert.equal(build(rich(0), 'garden', facts()), null, 'too poor');
});

test('itemStats gives display lines for every item and tier', () => {
  for (const it of ITEMS)
    for (let t = 0; t <= MAX_TIER; t++) {
      const lines = itemStats(it.id, t);
      assert.ok(lines.length >= 2, it.id);
      for (const l of lines) assert.ok(l.label && l.value && !l.value.includes('NaN'), `${it.id} ${l.label}`);
    }
  assert.deepEqual(itemStats('ghost', 0), []);
});

test('validateLoadout falls back to starters and keeps mobs distinct', () => {
  const f = facts(cleared(4));
  const ok = {
    cannon: 'repeater',
    mobs: ['sprinter', 'rifleman'] as [string, string],
    champion: 'sarge',
    ultimate: 'barrage',
  };
  assert.deepEqual(validateLoadout(ok, f), ok);
  // Locked picks fall back.
  assert.deepEqual(
    validateLoadout({ cannon: 'blunderbuss', mobs: ['bomber', 'sprinter'], champion: 'tank', ultimate: 'marble' }, f),
    { cannon: 'popgun', mobs: ['rifleman', 'sprinter'], champion: 'sarge', ultimate: 'barrage' },
  );
  // Wrong slots and unknown ids fall back.
  assert.deepEqual(
    validateLoadout({ cannon: 'rifleman', mobs: ['ghost', 'popgun'], champion: 'barrage', ultimate: 'sarge' }, f),
    STARTER_LOADOUT,
  );
  // Duplicates: the second slot changes, avoiding the first.
  assert.deepEqual(validateLoadout({ ...ok, mobs: ['sprinter', 'sprinter'] }, f).mobs, ['sprinter', 'rifleman']);
  assert.deepEqual(validateLoadout({ ...ok, mobs: ['rifleman', 'rifleman'] }, f).mobs, ['rifleman', 'knight']);
  assert.deepEqual(validateLoadout({ ...ok, mobs: ['ghost', 'rifleman'] }, f).mobs, ['knight', 'rifleman']);
  assert.deepEqual(validateLoadout({ ...ok, mobs: ['knight', 'knight'] }, f).mobs, ['knight', 'rifleman']);

  const p = setLoadout(emptyProfile(), { ...ok, champion: 'drummer' }, f);
  assert.deepEqual(p.loadout, { ...ok, champion: 'sarge' });
});

test('starter loadout with no upgrades leaves the level untouched and matches the default battle loadout', () => {
  const before = structuredClone(level);
  const r = resolveLoadout(level, emptyProfile());
  assert.deepEqual(level, before, 'input not mutated');
  assert.notEqual(r.level, level);
  assert.deepEqual(r.level, level);
  assert.deepEqual(r.level.cannon, level.cannon);
  assert.deepEqual(r.level.playerBase, level.playerBase);
  assert.deepEqual(r.level.champion, level.champion);
  // Contract: the starter loadout is exactly what the battle layer was tuned with.
  assert.deepEqual(r.battle, DEFAULT_BATTLE_LOADOUT);
});

test('tier-0 values for the other items match the balance-tested fixtures', () => {
  const p: Profile = {
    ...emptyProfile(),
    owned: ['drummer'],
    loadout: { cannon: 'popgun', mobs: ['sprinter', 'bomber'], champion: 'tank', ultimate: 'paratroopers' },
  };
  const b = resolveLoadout(level, p).battle;
  assert.deepEqual(b.mobs, [TIER0.sprinter, TIER0.bomber]);
  assert.deepEqual(b.champion, TIER0.tank);
  assert.deepEqual(b.ultimate, TIER0.paratroopers);
  const d = resolveLoadout(level, { ...p, loadout: { ...p.loadout, champion: 'drummer', ultimate: 'marble' } }).battle;
  assert.deepEqual(d.champion, TIER0.drummer);
  assert.deepEqual(d.ultimate, TIER0.marble);
});

test('cannon transforms', () => {
  const withCannon = (cannon: string, tiers: Record<string, number> = {}) =>
    resolveLoadout(level, {
      ...emptyProfile(),
      tiers,
      loadout: { ...STARTER_LOADOUT, mobs: ['rifleman', 'knight'], cannon },
    }).level;
  const rep = withCannon('repeater');
  assert.deepEqual(rep.cannon, { fireRate: 8.4, unitsPerShot: 2, aimLimit: 4 });
  assert.equal(rep.mods?.shotSpread, undefined);
  const bb = withCannon('blunderbuss');
  assert.deepEqual(bb.cannon, { fireRate: 2.58, unitsPerShot: 7, aimLimit: 4 });
  assert.deepEqual(bb.mods, { mobHp: 1.2, shotSpread: 0.9 });
  const one = resolveLoadout(
    { ...level, cannon: { ...level.cannon, unitsPerShot: 1 } },
    {
      ...emptyProfile(),
      loadout: { ...STARTER_LOADOUT, mobs: ['rifleman', 'knight'], cannon: 'repeater' },
    },
  ).level;
  assert.equal(one.cannon.unitsPerShot, 1, 'min 1');
  assert.equal(withCannon('popgun', { popgun: 3 }).cannon.fireRate, 6.36);
  // Fixed-count mobs follow the cannon's mobs per shot (2 of 3, 7 of 3); crowd mobs stay null.
  const mobsWith = (cannon: string) =>
    resolveLoadout(level, { ...emptyProfile(), loadout: { ...STARTER_LOADOUT, mobs: ['rifleman', 'knight'], cannon } })
      .battle.mobs;
  assert.deepEqual(
    ['popgun', 'repeater', 'blunderbuss'].map((c) => mobsWith(c).map((m) => m.perShot)),
    [
      [null, 1],
      [null, 0.667],
      [null, 2.333],
    ],
  );
  assert.deepEqual(level.mods, { mobHp: 1.2 }, 'input mods not mutated');
});

test('village perks feed startCrowd, base HP and champion charge', () => {
  const p: Profile = { ...emptyProfile(), village: { barracks: 2, walls: 3, workshop: 1, garden: 3, flagpole: 2 } };
  const r = resolveLoadout(level, p);
  assert.equal(r.level.mods?.startCrowd, 4);
  assert.equal(r.level.mods?.mobHp, 1.2);
  assert.equal(r.level.playerBase.hp, Math.round(320 * 1.09));
  assert.equal(r.level.champion.chargeNeeded, Math.round(280 * 0.98));
  const off = resolveLoadout(level, p, { useVillage: false });
  assert.deepEqual(off.level, level);
  const stacked = resolveLoadout({ ...level, mods: { startCrowd: 10 } }, p);
  assert.equal(stacked.level.mods?.startCrowd, 14);
});

test('resolveLoadout is deterministic and honours useUpgrades', () => {
  const p: Profile = {
    ...emptyProfile(),
    tiers: { rifleman: 3, knight: 1, sarge: 2, barrage: 3 },
    village: { walls: 1 },
  };
  const a = resolveLoadout(level, p);
  const b = resolveLoadout(level, p);
  assert.deepEqual(a, b);
  assert.notEqual(a.battle.mobs[0], b.battle.mobs[0]);
  assert.equal(a.battle.mobs[0].hp, 1, 'crowd mobs keep 1 hp: a fraction over 1 survives a 1:1 trade');
  assert.equal(a.battle.mobs[0].damage, 1.12);
  assert.equal(a.battle.ultimate.power, 22.4);
  const flat = resolveLoadout(level, p, { useUpgrades: false });
  assert.deepEqual(flat.battle, resolveLoadout(level, emptyProfile()).battle);
});

// Direction of "better" per stat; radius is neither (bigger is tougher but blocks more).
const LOWER_IS_BETTER = new Set(['chargeNeeded', 'chargeMul']);
const NEUTRAL = new Set(['radius']);
function numericStats(it: ItemDef, tier: number): Record<string, number> {
  const s = it.tiers[tier] as unknown as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(s)) {
    if (NEUTRAL.has(k)) continue;
    if (typeof v === 'number') out[k] = v;
    else if (v === null) out[k] = 3; // perShot null = the level's full shot (3 on every campaign level)
    else if (k === 'deathBlast') out.blastDamage = (v as { damage: number }).damage;
  }
  return out;
}
const better = (k: string, a: number, b: number) => (LOWER_IS_BETTER.has(k) ? a < b : a > b);

test('every upgrade tier improves stats monotonically, about +4% each and +12% at max (cannons +2% and +6%)', () => {
  for (const it of ITEMS) {
    let improvedTotal = 0;
    for (let t = 1; t <= MAX_TIER; t++) {
      const prev = numericStats(it, t - 1);
      const cur = numericStats(it, t);
      let improved = false;
      let step = 1;
      for (const k of Object.keys(cur)) {
        assert.ok(!better(k, prev[k], cur[k]), `${it.id} tier ${t} ${k} got worse`);
        if (better(k, cur[k], prev[k])) improved = true;
        if (!LOWER_IS_BETTER.has(k) && prev[k] > 0) step = Math.max(step, cur[k] / prev[k]);
      }
      // Concept §9.2: upgrades make a level comfortable, not trivial.
      assert.ok(step <= 1.06, `${it.id} tier ${t} gains ${((step - 1) * 100).toFixed(1)}%`);
      assert.ok(improved, `${it.id} tier ${t} improves something`);
      improvedTotal++;
    }
    assert.equal(improvedTotal, MAX_TIER);
    // The headline stat grows roughly +12% by tier 3, never more than +15%. Cannons only
    // raise the fire rate, about +2% a tier: the battle is far more sensitive to it.
    const s0 = numericStats(it, 0);
    const s3 = numericStats(it, MAX_TIER);
    const gains = Object.keys(s0)
      .filter((k) => !LOWER_IS_BETTER.has(k) && s0[k] > 0)
      .map((k) => s3[k] / s0[k]);
    const best = Math.max(...gains);
    const [lo, hi] = it.slot === 'cannon' ? [1.05, 1.08] : [1.1, 1.15];
    assert.ok(best >= lo && best <= hi, `${it.id} max gain ${best}`);
  }
});

test('tier-0 non-starter items are sidegrades, never strictly better than every starter', () => {
  const starters = ITEMS.filter((it) => it.unlock.type === 'start');
  for (const it of ITEMS) {
    if (it.unlock.type === 'start') continue;
    const s = numericStats(it, 0);
    for (const st of starters.filter((x) => x.slot === it.slot)) {
      const base = numericStats(st, 0);
      const worseSomewhere = Object.keys(base).some((k) => k in s && better(k, base[k], s[k]));
      assert.ok(worseSomewhere, `${it.id} strictly dominates ${st.id}`);
    }
  }
});

test('World 2 items: snowball shot, giant riders and the blizzard resolve and describe themselves', () => {
  assert.equal(unlockHint('snowball-launcher'), 'Clear level 2-3');
  assert.equal(unlockHint('giant'), 'Clear level 2-5');
  assert.equal(unlockHint('blizzard'), 'Clear level 2-7');
  const p: Profile = {
    ...emptyProfile(),
    loadout: { cannon: 'snowball-launcher', mobs: ['rifleman', 'giant'], champion: 'sarge', ultimate: 'blizzard' },
  };
  const b = resolveLoadout(level, p).battle;
  assert.deepEqual(b.shot, { kind: 'snowball', burstWeight: 40, maxRadius: 1.3 });
  assert.equal(b.mobs[1].riders, 6);
  assert.equal(b.ultimate.id, 'blizzard');
  assert.equal(resolveLoadout(level, emptyProfile()).battle.shot, undefined, 'the popgun fires plain shots');
  const has = (id: string, label: string) => itemStats(id, 0).some((l) => l.label === label);
  assert.ok(has('snowball-launcher', 'Snowball'));
  assert.ok(has('giant', 'Riders'));
  assert.ok(has('blizzard', 'Freeze') && !has('blizzard', 'Power'));
});
