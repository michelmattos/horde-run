// Progression → screen view models (src/meta/views.ts): what the loadout, collection and
// home base screens are told about items, prices and buildings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectionView, homeView, itemCards, loadoutView } from '../src/meta/views.ts';
import { ITEMS, emptyProfile, unlockHint } from '../src/progression/index.ts';
import type { Profile, ProgressFacts } from '../src/progression/index.ts';
import type { SaveData } from '../src/contracts.ts';

const won = { stars: [true, false, false] as [boolean, boolean, boolean] };
const facts = (profile: Profile = emptyProfile(), levels: SaveData['levels'] = {}): ProgressFacts => ({
  levels,
  profile,
});

test('item cards: every catalog item, starters unlocked, the rest locked with a hint', () => {
  const cards = itemCards(facts());
  assert.equal(cards.length, ITEMS.length);
  const by = Object.fromEntries(cards.map((c) => [c.id, c]));
  // The World 2 items unlock on Freezer levels.
  assert.equal(by['snowball-launcher'].hint, 'Clear level 2-3');
  assert.equal(by.giant.hint, 'Clear level 2-5');
  assert.equal(by.blizzard.hint, 'Clear level 2-7');
  // The World 3 items are locked at first and say what the catalog asks for.
  for (const id of ['gear-gun', 'archer', 'windup']) {
    assert.equal(by[id].locked, true, id);
    assert.equal(by[id].hint, unlockHint(id), id);
    assert.match(by[id].hint, /^Clear level 3-\d+$/, id);
  }
  for (const id of ['popgun', 'rifleman', 'knight', 'sarge', 'barrage']) assert.equal(by[id].locked, false, id);
  assert.equal(by.sprinter.locked, true);
  assert.equal(by.sprinter.hint, 'Clear level 1-3');
  // A coin item that cannot be bought yet says what gates the sale.
  assert.equal(by.drummer.hint, 'Clear level 1-2 first');
  assert.equal(by.tank.maxTier, 3);
});

test('item cards: new unlocks wear isNew until seen', () => {
  const f = facts(emptyProfile(), { '1-3': { ...won } });
  const sprinter = itemCards(f).find((c) => c.id === 'sprinter');
  assert.equal(sprinter?.locked, false);
  assert.equal(sprinter?.isNew, true);
  const seen = itemCards(facts({ ...emptyProfile(), seen: ['sprinter'] }, { '1-3': { ...won } }));
  assert.equal(seen.find((c) => c.id === 'sprinter')?.isNew, undefined);
});

test('loadout view: level header, coins and a copy of the saved loadout', () => {
  const p = { ...emptyProfile(), coins: 42 };
  const v = loadoutView({ id: '1-10', name: 'Tin Fort', boss: { name: 'the Tin General' } }, facts(p));
  assert.deepEqual(v.level, { code: '1-10', name: 'Tin Fort', boss: 'the Tin General' });
  assert.equal(v.coins, 42);
  assert.deepEqual(v.selected, {
    cannon: 'popgun',
    mobs: ['rifleman', 'knight'],
    champion: 'sarge',
    ultimate: 'barrage',
  });
  assert.notEqual(v.selected.mobs, p.loadout.mobs);
});

test('collection view: upgrade cost, next stats, buy price and affordability', () => {
  const p = { ...emptyProfile(), coins: 50, tiers: { knight: 3 } };
  const v = collectionView(facts(p, { '1-2': { ...won } }));
  const by = Object.fromEntries(v.items.map((i) => [i.id, i]));
  assert.equal(by.rifleman.upgradeCost, 40);
  assert.equal(by.rifleman.canAfford, true);
  assert.ok(by.rifleman.stats.some((s) => s.next !== undefined));
  assert.equal(by.knight.upgradeCost, null, 'maxed');
  assert.ok(by.knight.stats.every((s) => s.next === undefined));
  assert.equal(by.drummer.buyPrice, 300);
  assert.equal(by.drummer.canAfford, false);
  assert.equal(by.sprinter.upgradeCost, null, 'locked items are not upgraded');
  assert.equal(by.sprinter.buyPrice, null, 'level unlocks are not for sale');
  // Before 1-2 the drummer is not for sale yet.
  assert.equal(collectionView(facts(p)).items.find((i) => i.id === 'drummer')?.buyPrice, null);
});

test('home view: five buildings with costs, perks and gates', () => {
  const v = homeView(facts({ ...emptyProfile(), coins: 100, village: { garden: 3 } }));
  assert.equal(v.buildings.length, 5);
  const by = Object.fromEntries(v.buildings.map((b) => [b.id, b]));
  assert.equal(by.barracks.tier, 0);
  assert.equal(by.barracks.nextCost, 60);
  assert.equal(by.barracks.nextPerk, '+2 starting troops');
  assert.equal(by.garden.nextCost, null);
  assert.equal(by.garden.canAfford, false);
  assert.equal(by.garden.nextPerk, undefined);
  for (const b of v.buildings) if (b.lockedReason) assert.equal(b.canAfford, false, b.id);
});
