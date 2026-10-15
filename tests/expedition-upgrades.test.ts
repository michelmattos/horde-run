// Upgrade pool and the modifiers layer: every upgrade's documented effect on campaign
// levels, stacking, the Overcharge synergy, gate placement rules and purity, plus the
// five World 2 upgrades (Frost Gate, Ice Rink, Ice Skates, Hot Cocoa, Avalanche).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RARITY_PRICE, UPGRADES, drawOffer, getUpgrade } from '../src/expedition/upgrades.ts';
import { applyUpgrades } from '../src/expedition/modifiers.ts';
import { createRng } from '../src/core/rng.ts';
import { LEVELS, getLevelById, validateLevel } from '../src/game/levels.ts';
import { cardsClash } from '../src/game/gateSpacing.ts';
import type { LevelDef, UpgradeIcon, UpgradeIconW2 } from '../src/contracts.ts';

type Build = Readonly<Record<string, number>>;

const ICONS: UpgradeIcon[] = [
  'gate-x2',
  'gate-plus',
  'gate-fork',
  'gate-x3',
  'mob-tough',
  'mob-sharp',
  'mob-knight',
  'mob-reinforce',
  'cannon-rapid',
  'cannon-scatter',
  'cannon-burst',
  'cannon-swivel',
  'champ-charge',
  'champ-rally',
  'champ-big',
  'relic-overcharge',
  'relic-glass',
  'relic-chest',
  'relic-sapper',
  'relic-fort',
];

const lvl = (id: string): LevelDef => getLevelById(id)!;
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const added = (l: LevelDef) => l.gates.filter((g) => g.id.startsWith('up-'));

// Validates with `mods` stripped too, in case validateLevel rejects unknown keys.
function assertValid(l: LevelDef): void {
  validateLevel(l, 'test');
  const { mods: _mods, ...rest } = l;
  validateLevel(rest, 'test');
}

const W2: Record<string, UpgradeIconW2> = {
  'frost-gate': 'gate-frost',
  rink: 'gate-rink',
  skates: 'mob-skates',
  cocoa: 'relic-cocoa',
  avalanche: 'champ-avalanche',
};
const W3: Record<string, string> = {
  clockwork: 'gate-clock',
  boots: 'mob-boots',
  sawguard: 'relic-sawguard',
  crowbar: 'champ-crowbar',
  bankshot: 'cannon-bank',
};

test('pool: 30 unique ids, every icon used, World 2 and 3 art on exactly their five each, short text', () => {
  assert.equal(UPGRADES.length, 30);
  assert.equal(new Set(UPGRADES.map((u) => u.id)).size, 30);
  assert.deepEqual(new Set(UPGRADES.map((u) => u.icon)), new Set(ICONS));
  // World 1 upgrades keep one icon each; a World 2 upgrade borrows its nearest one.
  const w1 = UPGRADES.filter((u) => u.iconW2 === undefined && u.iconW3 === undefined);
  assert.equal(new Set(w1.map((u) => u.icon)).size, w1.length);
  assert.deepEqual(Object.fromEntries(UPGRADES.filter((u) => u.iconW2).map((u) => [u.id, u.iconW2])), W2);
  assert.deepEqual(Object.fromEntries(UPGRADES.filter((u) => u.iconW3).map((u) => [u.id, u.iconW3])), W3);
  for (const u of UPGRADES) {
    assert.equal(getUpgrade(u.id), u);
    assert.ok(u.text.length <= 48, `${u.id}: ${u.text}`);
    assert.ok((u.drawback ?? '').length <= 48);
    assert.ok(u.maxStacks >= 1);
    assert.ok(RARITY_PRICE[u.rarity] > 0);
    assert.equal(u.drawback !== undefined, ['overcharge', 'glass', 'chest', 'cocoa', 'sawguard'].includes(u.id));
  }
  assert.equal(getUpgrade('nope'), undefined);
  const perCategory = (cat: string) => UPGRADES.filter((u) => u.category === cat).length;
  assert.deepEqual(['gate', 'mob', 'cannon', 'champion', 'relic'].map(perCategory), [7, 6, 5, 5, 7]);
});

test('drawOffer: distinct, respects maxStacks, deterministic, runs short gracefully', () => {
  for (let s = 0; s < 200; s++) {
    const a = drawOffer(createRng(s).next, { tripler: 1, fork: 1, doubler: 3 });
    assert.deepEqual(a, drawOffer(createRng(s).next, { tripler: 1, fork: 1, doubler: 3 }));
    assert.equal(a.length, 3);
    assert.equal(new Set(a).size, 3);
    assert.ok(!a.some((id) => ['tripler', 'fork', 'doubler'].includes(id)));
  }
  const owned = Object.fromEntries(UPGRADES.map((u) => [u.id, u.maxStacks]));
  delete owned.tough;
  assert.deepEqual(drawOffer(Math.random, owned), ['tough']);
  owned.tough = 3;
  assert.deepEqual(drawOffer(Math.random, owned), []);
  assert.equal(drawOffer(createRng(1).next, {}, { count: 5 }).length, 5);
});

test('drawOffer: elites skew rarer', () => {
  const tally = (elite: boolean) => {
    const r = createRng(99);
    let epic = 0;
    for (let i = 0; i < 2000; i++) {
      const [first] = drawOffer(r.next, {}, { elite });
      if (getUpgrade(first)!.rarity === 'epic') epic++;
    }
    return epic / 2000;
  };
  const normal = tally(false);
  const elite = tally(true);
  assert.ok(Math.abs(normal - 0.1) < 0.03, `normal epic ${normal}`);
  assert.ok(Math.abs(elite - 0.25) < 0.04, `elite epic ${elite}`);
});

test('modifiers: gate upgrades add the documented gates', () => {
  const base = lvl('1-1');
  const supply = added(applyUpgrades(base, { supply: 1 }));
  assert.equal(supply.length, 1);
  assert.deepEqual(
    [supply[0].id, supply[0].op, supply[0].value, supply[0].uses, supply[0].z],
    ['up-supply-1', 'add', 2, 120, 6],
  );
  const twin = added(applyUpgrades(base, { supply: 2 }));
  assert.equal(twin.length, 2);
  assert.ok(twin[0].z === twin[1].z && twin[0].x < 0 && twin[1].x > 0, 'two Supply Gates share one line');

  const dbl = added(applyUpgrades(base, { doubler: 3 }));
  assert.deepEqual(
    dbl.map((g) => [g.id, g.op, g.value]),
    [
      ['up-doubler-1', 'mul', 2],
      ['up-doubler-2', 'mul', 2],
      ['up-doubler-3', 'mul', 2],
    ],
  );

  const fork = added(applyUpgrades(base, { fork: 1 }));
  assert.equal(fork.length, 2);
  assert.equal(fork[0].z, fork[1].z);
  assert.ok(fork[0].x < 0 && fork[0].op === 'mul' && fork[0].value === 2);
  assert.ok(fork[1].x > 0 && fork[1].op === 'add' && fork[1].value === 3 && fork[1].uses === 150);

  const [x3] = added(applyUpgrades(base, { tripler: 1 }));
  assert.deepEqual([x3.op, x3.value, x3.width], ['mul', 3, 2.4]);
  assert.ok(x3.move && x3.move.amplitude > 0 && x3.move.period >= 5);
});

test('modifiers: gate placement keeps spacing, fits the lane, and caps at 32', () => {
  const all = { supply: 2, doubler: 3, fork: 1, tripler: 1 };
  for (const base of LEVELS) {
    const out = applyUpgrades(base, all);
    const hw = out.lane.width / 2;
    const original = base.gates.map((g) => g.id);
    assert.deepEqual(
      out.gates.slice(0, original.length).map((g) => g.id),
      original,
    );
    for (const g of added(out)) {
      assert.ok(g.z >= 6 && g.z <= out.lane.length * 0.5, `${base.id} ${g.id} z ${g.z}`);
      assert.ok(Math.abs(g.x) + (g.move?.amplitude ?? 0) + g.width / 2 <= hw - 0.3 + 1e-9);
      for (const o of out.gates) {
        if (o === g) continue;
        const sideBySide = o.z === g.z && Math.abs(o.x - g.x) >= (o.width + g.width) / 2 + 0.3;
        assert.ok(sideBySide || Math.abs(o.z - g.z) >= 3, `${base.id}: ${g.id} too close to ${o.id}`);
        assert.ok(!cardsClash(o, g), `${base.id}: ${g.id} and ${o.id} cover each other's sign`);
      }
      for (const d of out.defenders ?? []) assert.ok(Math.abs(d.z - g.z) >= 2.5);
    }
    assert.equal(new Set(out.gates.map((g) => g.id)).size, out.gates.length);
    assertValid(out);
  }
  // A lane already holding 31 gates only has room for a single-gate upgrade.
  const crowded: LevelDef = structuredClone(lvl('1-1'));
  crowded.gates = Array.from({ length: 31 }, (_, i) => ({
    id: `g${i}`,
    op: 'add' as const,
    value: 1,
    x: 0,
    z: 30 + i * 0.5,
    width: 2,
  }));
  const out = applyUpgrades(crowded, { fork: 1, supply: 1, doubler: 1 });
  assert.equal(out.gates.length, 32);
  assert.deepEqual(
    added(out).map((g) => g.id),
    ['up-supply-1'],
  );
});

test('modifiers: Overcharge boosts every multiplier, including upgrade gates (synergy)', () => {
  const base = lvl('1-5');
  const out = applyUpgrades(base, { overcharge: 1, doubler: 1, fork: 1, tripler: 1 });
  for (const g of out.gates) {
    const orig = base.gates.find((o) => o.id === g.id);
    if (orig) assert.equal(g.value, orig.op === 'mul' ? orig.value + 1 : orig.value);
  }
  const byId = Object.fromEntries(out.gates.map((g) => [g.id, g]));
  assert.equal(byId['up-doubler-1'].value, 3);
  assert.equal(byId['up-fork-1'].value, 3);
  assert.equal(byId['up-fork-2'].value, 3);
  assert.equal(byId['up-tripler-1'].value, 4);
  assert.equal(added(applyUpgrades(base, { overcharge: 1, supply: 1 }))[0].value, 2); // add gates stay
  for (let i = 0; i < base.defenders!.length; i++)
    assert.equal(out.defenders![i].hp, Math.round(base.defenders![i].hp * 1.2));
});

test('modifiers: mob, cannon, champion and relic numbers', () => {
  const base = lvl('1-4');
  const one = (ups: Record<string, number>) => applyUpgrades(base, ups);

  near(one({ tough: 2 }).mods!.mobHp!, 1.25 ** 2);
  near(one({ sharp: 3 }).mods!.mobDamage!, 1.3 ** 3);
  assert.deepEqual(
    [1, 2, 3].map((n) => one({ knights: n }).mods!.knightEvery),
    [10, 7, 5].map((shots) => shots * base.cannon.unitsPerShot), // the card counts shots, battle.ts mobs
  );
  assert.equal(one({ knights: 1, scatter: 1 }).mods!.knightEvery, 10 * (base.cannon.unitsPerShot + 1));
  assert.deepEqual(one({ knights: 1 }).mods!.knight, { hp: 18, damage: 12, radius: 0.6 });
  assert.equal(one({ reinforce: 3 }).mods!.startCrowd, 75);

  near(one({ rapid: 2 }).cannon.fireRate, base.cannon.fireRate * 1.44);
  const sc = one({ scatter: 2 });
  assert.equal(sc.cannon.unitsPerShot, base.cannon.unitsPerShot + 2);
  assert.equal(sc.mods!.shotSpread, 0.6);
  const burst = one({ burst: 1 });
  assert.deepEqual(burst.mods!.burst, { shots: 3, gap: 0.08 });
  near(burst.cannon.fireRate, base.cannon.fireRate * 0.45);
  assert.equal(one({ swivel: 1 }).cannon.aimLimit, Math.min(base.cannon.aimLimit + 1, base.lane.width / 2 - 0.6));

  assert.equal(one({ pep: 1 }).champion.chargeNeeded, Math.round(base.champion.chargeNeeded * 0.8));
  assert.equal(one({ pep: 3 }).champion.chargeNeeded, Math.max(20, Math.round(base.champion.chargeNeeded * 0.512)));
  assert.equal(one({ rally: 2 }).mods!.championEcho, 60);
  const big = one({ bigchamp: 2, knights: 1 });
  near(big.champion.hp, base.champion.hp * 2.25);
  near(big.champion.damage, base.champion.damage * 2.25);
  near(big.mods!.knight!.hp, 18 * 1.5625);
  near(big.mods!.knight!.damage, 12 * 1.5625);
  assert.equal(one({ bigchamp: 1 }).mods, undefined); // no knights, no knight mod

  const glass = one({ glass: 1 });
  near(glass.cannon.fireRate, base.cannon.fireRate * 1.4);
  assert.equal(glass.playerBase.hp, Math.round(base.playerBase.hp * 0.7));
  const chest = one({ chest: 1 });
  chest.enemyWaves.forEach((w, i) => assert.equal(w.count, Math.round(base.enemyWaves[i].count * 1.1)));
  if (base.enemySpawnRate) near(chest.enemySpawnRate!.perSecond, base.enemySpawnRate.perSecond * 1.1);
  const sap = one({ sapper: 1 });
  sap.defenders!.forEach((d, i) => assert.equal(d.hp, Math.round(base.defenders![i].hp * 0.7)));
  assert.deepEqual(one({ fort: 2 }), structuredClone(base)); // run-level only
});

test('modifiers: stacking, scaling every field, mods merge, unknown ids and stacks clamp', () => {
  const base: LevelDef = { ...structuredClone(lvl('1-10')), mods: { mobHp: 2, startCrowd: 10 } };
  const out = applyUpgrades(base, { tough: 1, reinforce: 1, rapid: 1, glass: 1, burst: 1, chest: 1, mystery: 4 });
  near(out.mods!.mobHp!, 2.5);
  assert.equal(out.mods!.startCrowd, 35);
  near(out.cannon.fireRate, base.cannon.fireRate * 1.2 * 0.45 * 1.4);
  for (const [i, ph] of base.boss!.phases.entries())
    if (ph.trickle !== undefined) near(out.boss!.phases[i].trickle!, ph.trickle * 1.1);
  assertValid(out);
  // Stacks beyond the max count as the max.
  assert.deepEqual(applyUpgrades(base, { tough: 9 }).mods!.mobHp, 2 * 1.25 ** 3);
  assert.deepEqual(applyUpgrades(lvl('1-1'), { mystery: 1 }), structuredClone(lvl('1-1')));
});

test('modifiers: pure, deterministic and validateLevel-clean on every World 1 level', () => {
  const everything = Object.fromEntries(UPGRADES.map((u) => [u.id, u.maxStacks]));
  for (const base of LEVELS) {
    const before = JSON.stringify(base);
    const a = applyUpgrades(base, everything);
    assert.equal(JSON.stringify(base), before);
    assert.deepEqual(a, applyUpgrades(base, everything));
    assertValid(a);
    assert.ok(Number.isInteger(a.cannon.unitsPerShot));
    assert.ok(Number.isInteger(a.champion.chargeNeeded) && a.champion.chargeNeeded >= 20);
    assert.ok(a.enemyWaves.every((w) => Number.isInteger(w.count) && w.count >= 1));
    // Mutating the output never reaches the input.
    a.gates[0].value = 999;
    a.cannon.fireRate = 999;
    assert.equal(JSON.stringify(base), before);
  }
});

// ---------- World 2 upgrades ----------

test('Frost Gate adds one x3 freezing gate (about 40 weight, 3 s, 30 hp) that Overcharge boosts', () => {
  const base = lvl('1-4');
  const [g] = added(applyUpgrades(base, { 'frost-gate': 1 }));
  assert.equal(g.id, 'up-frost-gate-1');
  assert.deepEqual([g.op, g.value], ['mul', 3]);
  assert.deepEqual(g.freeze, { after: 40, duration: 3, hp: 30 });
  assert.ok(g.z >= 6 && g.z <= base.lane.length / 2);
  const boosted = added(applyUpgrades(base, { 'frost-gate': 1, overcharge: 1 }));
  assert.equal(boosted[0].value, 4);
  assertValid(applyUpgrades(base, { 'frost-gate': 1 }));
});

test('added gates keep clear of ice walls they overlap in x', () => {
  const base: LevelDef = structuredClone(lvl('1-1'));
  // A wall across the middle of the player half, where the gates would like to go.
  base.iceWalls = [{ id: 'iw', x: 0, z: 14, width: 6, depth: 3 }];
  const out = applyUpgrades(base, { 'frost-gate': 1, doubler: 3, fork: 1, supply: 1 });
  assert.ok(added(out).length >= 4);
  for (const g of added(out)) {
    const apartX = Math.abs(g.x) - g.width / 2 - Math.abs(g.move?.amplitude ?? 0) - 3 >= 0.3;
    assert.ok(apartX || Math.abs(g.z - 14) >= 2.5, `${g.id} at x ${g.x} z ${g.z} runs into the ice wall`);
  }
});

test('Ice Rink lays ice in front of the cannon, most of the lane wide, adding to the level ice', () => {
  const base: LevelDef = structuredClone(lvl('1-2'));
  const out = applyUpgrades(base, { rink: 1 });
  assert.equal(out.ice?.length, 1);
  const [rink] = out.ice!;
  assert.ok(rink.z > 1.5 && rink.z < 6, 'starts just past the muzzle');
  assert.ok(rink.length >= 4 && rink.z + rink.length <= base.lane.length / 2);
  assert.ok(rink.width >= base.lane.width - 2 && Math.abs(rink.x) + rink.width / 2 <= base.lane.width / 2);
  base.ice = [{ x: 0, z: 30, width: 4, length: 5 }];
  assert.deepEqual(applyUpgrades(base, { rink: 1 }).ice?.[0], base.ice[0], 'the level ice stays');
  assert.equal(applyUpgrades(base, { rink: 1 }).ice?.length, 2);
  assertValid(out);
});

test('Ice Skates, Hot Cocoa and Avalanche reach the battle mods, stacking where they stack', () => {
  const base = lvl('1-3');
  near(applyUpgrades(base, { skates: 1 }).mods!.iceGrip!, 0.45);
  near(applyUpgrades(base, { skates: 2 }).mods!.iceGrip!, 0.9);
  near(applyUpgrades({ ...base, mods: { iceGrip: 0.3 } }, { skates: 2 }).mods!.iceGrip!, 0.9);
  const cocoa = applyUpgrades(base, { cocoa: 1 }).mods!;
  assert.deepEqual([cocoa.thawRate, cocoa.freezeAfter], [2, 1.5]);
  assert.deepEqual(applyUpgrades(base, { avalanche: 1 }).mods!.championFreeze, { radius: 3, seconds: 2 });
  assert.deepEqual(applyUpgrades(base, { avalanche: 2 }).mods!.championFreeze, { radius: 4, seconds: 3 });
  assert.deepEqual(applyUpgrades(base, { avalanche: 7 }).mods!.championFreeze, { radius: 4, seconds: 3 });
  for (const ups of [{ skates: 1 }, { cocoa: 1 }, { avalanche: 2 }] as Build[]) assertValid(applyUpgrades(base, ups));
});

test('Hot Cocoa costs: waves +10% (on top of War Chest), snowmen and penguins come more often', () => {
  const base: LevelDef = structuredClone(lvl('1-6'));
  base.trickleMix = { unit: 'penguin', every: 8 };
  base.defenders = [
    ...(base.defenders ?? []),
    { id: 'ig', kind: 'igloo', x: 0, z: 40, hp: 120, spawn: { unit: 'penguin', every: 6, count: 3 } },
  ];
  const out = applyUpgrades(base, { cocoa: 1 });
  out.enemyWaves.forEach((w, i) => assert.equal(w.count, Math.round(base.enemyWaves[i].count * 1.1)));
  if (base.enemySpawnRate) near(out.enemySpawnRate!.perSecond, base.enemySpawnRate.perSecond * 1.1);
  assert.ok(out.trickleMix!.every < 8 && out.trickleMix!.every >= 2);
  assert.ok(out.defenders!.find((d) => d.id === 'ig')!.spawn!.every < 6);
  const both = applyUpgrades(base, { cocoa: 1, chest: 1 });
  both.enemyWaves.forEach((w, i) => assert.equal(w.count, Math.round(base.enemyWaves[i].count * 1.21)));
});
