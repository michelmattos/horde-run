// World unlocks and the multi-world map's rules: World 2 opens at 15 World 1 stars (only
// World 1's stars count) and World 3 at 15 World 2 stars (with World 2 open: an imported
// save's stars never skip a world), a locked world's levels never start whatever the save holds,
// the padlock line counts down, the map reopens on the last world viewed and each
// world's title card shows once it is open and unseen. Uses the real world list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORLDS } from '../src/game/levels.ts';
import { emptySave, isWorldUnlocked, starsNeeded } from '../src/core/save.ts';
import { WORLD_PREFS_KEY, loadWorldPrefs, parseWorldPrefs, saveWorldPrefs } from '../src/core/worldPrefs.ts';
import type { KeyValueStore } from '../src/core/save.ts';
import {
  initialWorldIndex,
  levelTap,
  lockedWorldText,
  showsTitleCard,
  worldLabel,
  worldTabs,
} from '../src/meta/worldLogic.ts';
import type { LevelProgress, SaveData, WorldDef } from '../src/contracts.ts';

const [W1, W2, W3] = WORLDS;
const NEED = W2.unlock!.stars;

// A save with `n` stars spread over World 1 levels in order (3 per level, the rest on the next).
function withStars(n: number, extra: Record<string, LevelProgress> = {}): SaveData {
  const save = emptySave();
  for (let i = 0; n > 0; i++) {
    const k = Math.min(3, n);
    save.levels[W1.levels[i]] = { stars: [k >= 1, k >= 2, k >= 3] };
    n -= k;
  }
  Object.assign(save.levels, extra);
  return save;
}
const allStars: LevelProgress = { stars: [true, true, true] };

function memStore(init: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...init };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

test('World 2 asks for World 1 stars and opens exactly at the threshold', () => {
  assert.equal(W2.unlock?.world, W1.id);
  assert.equal(isWorldUnlocked(emptySave(), W1, WORLDS), true, 'World 1 is open from the start');
  assert.equal(isWorldUnlocked(withStars(NEED - 1), W2, WORLDS), false);
  assert.equal(starsNeeded(withStars(NEED - 1), W2, WORLDS), 1);
  assert.equal(isWorldUnlocked(withStars(NEED), W2, WORLDS), true);
  assert.equal(starsNeeded(withStars(NEED), W2, WORLDS), 0);
  assert.equal(starsNeeded(withStars(30), W2, WORLDS), 0, 'never negative');
  assert.equal(starsNeeded(emptySave(), W2, WORLDS), NEED);
});

test('only World 1 stars count toward World 2', () => {
  // Stars on World 2 levels (an imported save, say) and on unknown ids do not open it.
  const w2Stars = Object.fromEntries(W2.levels.map((id) => [id, allStars]));
  const save = withStars(NEED - 1, { ...w2Stars, 'x9-9': allStars });
  assert.equal(isWorldUnlocked(save, W2, WORLDS), false);
  assert.equal(starsNeeded(save, W2, WORLDS), 1);
  // A world unlocked by a world missing from the list can never be opened by stars elsewhere.
  const orphan: WorldDef = { ...W2, id: 'w9', unlock: { world: 'w8', stars: 3 } };
  assert.equal(starsNeeded(withStars(30), orphan, [...WORLDS, orphan]), 3);
});

test("a locked world's levels never play, whatever the save holds for them", () => {
  const w2Stars = Object.fromEntries(W2.levels.map((id) => [id, allStars]));
  for (const n of [0, 5, NEED - 1]) {
    const save = withStars(n, w2Stars);
    for (const id of W2.levels) {
      const tap = levelTap(save, W2, WORLDS, id);
      assert.equal(tap.play, false, `${id} at ${n} stars`);
      if (!tap.play) assert.equal(tap.nudge, lockedWorldText(save, W2, WORLDS));
    }
  }
  // Once open, World 2 plays in order like World 1.
  const open = withStars(NEED);
  assert.deepEqual(levelTap(open, W2, WORLDS, W2.levels[0]), { play: true });
  assert.equal(levelTap(open, W2, WORLDS, W2.levels[1]).play, false);
  assert.deepEqual(levelTap(open, W1, WORLDS, W1.levels[0]), { play: true });
});

test('world tabs: labels, star tallies, locks, and a fresh dot until the title card is seen', () => {
  const save = withStars(NEED, { [W2.levels[0]]: { stars: [true, true, false] } });
  const [t1, t2] = worldTabs(save, WORLDS, [W1.id]);
  assert.equal(t1.label, 'World 1');
  assert.equal(t2.label, 'World 2');
  assert.equal(worldLabel({ id: 'snow' }), 'World snow');
  assert.deepEqual([t1.stars, t1.maxStars, t1.locked, t1.fresh], [NEED, W1.levels.length * 3, false, false]);
  assert.deepEqual([t2.stars, t2.locked, t2.fresh], [2, false, true]);
  assert.equal(worldTabs(save, WORLDS, [W1.id, W2.id])[1].fresh, false);
  const locked = worldTabs(withStars(3), WORLDS, [])[1];
  assert.equal(locked.locked, true);
  assert.equal(locked.fresh, false, 'a locked world has nothing new to see');
});

test('the map opens on the last world viewed, if it still exists', () => {
  assert.equal(initialWorldIndex(WORLDS, undefined), 0);
  assert.equal(initialWorldIndex(WORLDS, W2.id), 1);
  assert.equal(initialWorldIndex(WORLDS, 'w7'), 0);
});

test("a world's title card: on the first look of a session, and the first time ever it is open", () => {
  const open = { id: W2.id, locked: false };
  assert.equal(showsTitleCard(open, false, []), true, 'never seen');
  assert.equal(showsTitleCard(open, false, [W2.id]), false, 'seen before');
  assert.equal(showsTitleCard(open, true, [W2.id]), true, 'first look this session');
  assert.equal(showsTitleCard({ id: W2.id, locked: true }, true, []), false, 'never while locked');
});

test('world prefs remember the last world and seen title cards, and survive bad storage', () => {
  const store = memStore();
  assert.deepEqual(loadWorldPrefs(store), { seen: [] });
  saveWorldPrefs({ lastWorld: W2.id, seen: [W1.id, W2.id] }, store);
  assert.ok(store.data[WORLD_PREFS_KEY]);
  assert.deepEqual(loadWorldPrefs(store), { lastWorld: W2.id, seen: [W1.id, W2.id] });

  for (const raw of ['nope', '[]', 'null', '7', '{"seen":"w2"}', '{"lastWorld":5}']) {
    assert.deepEqual(loadWorldPrefs(memStore({ [WORLD_PREFS_KEY]: raw })), { seen: [] }, raw);
  }
  assert.deepEqual(parseWorldPrefs({ lastWorld: '', seen: ['w1', 3, 'w1', 'w2'] }), { seen: ['w1', 'w2'] });
  const throwing: KeyValueStore = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('full');
    },
  };
  assert.deepEqual(loadWorldPrefs(throwing), { seen: [] });
  assert.doesNotThrow(() => saveWorldPrefs({ seen: ['w1'] }, throwing));
  assert.deepEqual(loadWorldPrefs(null), { seen: [] });
});

// A save with every World 1 star and `n` World 2 stars, 3 per level in order.
function withW2Stars(n: number, w1 = 30): SaveData {
  const save = withStars(w1);
  for (let i = 0; n > 0; i++) {
    const k = Math.min(3, n);
    save.levels[W2.levels[i]] = { stars: [k >= 1, k >= 2, k >= 3] };
    n -= k;
  }
  return save;
}

test('three worlds: the Workshop is World 3, themed, ten levels ending on the Jack-in-the-Box', () => {
  assert.equal(WORLDS.length, 3);
  assert.equal(W3.id, 'w3');
  assert.equal(W3.theme, 'workshop');
  assert.deepEqual(W3.levels, ['3-1', '3-2', '3-3', '3-4', '3-5', '3-6', '3-7', '3-8', '3-9', '3-10']);
  assert.deepEqual(W3.unlock, { world: W2.id, stars: 15 });
  assert.equal(worldLabel(W3), 'World 3');
});

test('World 3 opens at 15 World 2 stars, counting only World 2', () => {
  const need = W3.unlock!.stars;
  assert.equal(isWorldUnlocked(withW2Stars(need - 1), W3, WORLDS), false);
  assert.equal(starsNeeded(withW2Stars(need - 1), W3, WORLDS), 1);
  assert.equal(lockedWorldText(withW2Stars(need - 1), W3, WORLDS), `Earn 1 more star in ${W2.name}`);
  assert.equal(isWorldUnlocked(withW2Stars(need), W3, WORLDS), true);
  assert.equal(lockedWorldText(withW2Stars(need), W3, WORLDS), '');
  assert.deepEqual(levelTap(withW2Stars(need), W3, WORLDS, '3-1'), { play: true });
  assert.equal(levelTap(withW2Stars(need), W3, WORLDS, '3-2').play, false);
  // World 1 stars (all 30 of them) never count toward World 3.
  assert.equal(starsNeeded(withStars(30), W3, WORLDS), need);
  const tabs = worldTabs(withW2Stars(need), WORLDS, [W1.id, W2.id]);
  assert.deepEqual(
    tabs.map((t) => [t.label, t.locked, t.fresh]),
    [
      ['World 1', false, false],
      ['World 2', false, false],
      ['World 3', false, true],
    ],
  );
});

test("an imported save's World 2 stars do not open World 3 while World 2 is locked", () => {
  const save = withW2Stars(30, NEED - 1); // all of World 2, but World 2 itself is shut
  assert.equal(isWorldUnlocked(save, W2, WORLDS), false);
  assert.equal(starsNeeded(save, W3, WORLDS), 0, 'the stars are there');
  assert.equal(isWorldUnlocked(save, W3, WORLDS), false, 'but the chain is not');
  assert.equal(lockedWorldText(save, W3, WORLDS), `Open ${W2.name} first`);
  const tap = levelTap(save, W3, WORLDS, '3-1');
  assert.equal(tap.play, false);
  if (!tap.play) assert.equal(tap.nudge, `Open ${W2.name} first`);
  assert.equal(worldTabs(save, WORLDS, [])[2].locked, true);
  // A world whose chain loops back on itself never opens; one naming an unknown world
  // asks only for the stars it names (none here).
  const a: WorldDef = { ...W2, id: 'wa', unlock: { world: 'wb', stars: 0 } };
  const b: WorldDef = { ...W2, id: 'wb', unlock: { world: 'wa', stars: 0 } };
  assert.equal(isWorldUnlocked(emptySave(), a, [a, b]), false);
  const free: WorldDef = { ...W2, id: 'wf', unlock: { world: 'nowhere', stars: 0 } };
  assert.equal(isWorldUnlocked(emptySave(), free, [free]), true);
});

test("World 3's title card shows once it is open and has not been seen, never while locked", () => {
  const need = W3.unlock!.stars;
  const lockedTab = worldTabs(withW2Stars(need - 1), WORLDS, [])[2];
  assert.equal(showsTitleCard(lockedTab, true, []), false);
  const openTab = worldTabs(withW2Stars(need), WORLDS, [W1.id, W2.id])[2];
  assert.equal(showsTitleCard(openTab, false, [W1.id, W2.id]), true, 'first visit after the unlock');
  assert.equal(showsTitleCard(openTab, false, [W1.id, W2.id, W3.id]), false, 'seen once already');
  assert.equal(initialWorldIndex(WORLDS, W3.id), 2);
});
