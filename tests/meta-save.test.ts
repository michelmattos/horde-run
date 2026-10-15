// Save system: persistence, merging results, unlocks, export/import validation and the
// v2 format that adds the progression profile (with migration from v1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SAVE_KEY,
  emptySave,
  exportGame,
  exportSave,
  importGame,
  importSave,
  loadGame,
  writeGame,
  isUnlocked,
  loadSave,
  recordResult,
  starCount,
  writeSave,
} from '../src/core/save.ts';
import type { KeyValueStore } from '../src/core/save.ts';
import type { SaveData, WorldDef } from '../src/contracts.ts';
import { emptyProfile, retroactiveCoins } from '../src/progression/index.ts';
import type { Profile } from '../src/progression/index.ts';

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

const world: WorldDef = { id: 'w1', name: 'Bedroom Floor', faction: 'Tan Army', levels: ['1-1', '1-2', '1-3'] };
const win = (stars: [boolean, boolean, boolean], time: number) => ({ victory: true, stars, time });

test('load/write roundtrip', () => {
  const store = memStore();
  const s = recordResult(emptySave(), '1-1', win([true, false, true], 42.5)).save;
  writeSave(s, store);
  assert.ok(store.data[SAVE_KEY]);
  assert.deepEqual(loadSave(store), s);
});

test('missing, corrupt or blocked storage gives an empty save', () => {
  assert.deepEqual(loadSave(memStore()), emptySave());
  assert.deepEqual(loadSave(null), emptySave());
  assert.deepEqual(loadSave(memStore({ [SAVE_KEY]: '{nope' })), emptySave());
  assert.deepEqual(loadSave(memStore({ [SAVE_KEY]: '{"version":3,"levels":{}}' })), emptySave());
  assert.deepEqual(loadSave(memStore({ [SAVE_KEY]: '{"version":1,"levels":{"1-1":{"stars":"x"}}}' })), emptySave());
  const throwing: KeyValueStore = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };
  assert.deepEqual(loadSave(throwing), emptySave());
  assert.doesNotThrow(() => writeSave(emptySave(), throwing));
});

test('recordResult OR-merges stars and returns a new object', () => {
  const s0 = emptySave();
  const r1 = recordResult(s0, '1-1', win([true, true, false], 50));
  assert.equal(r1.newStars, 2);
  assert.deepEqual(s0.levels, {}, 'input not mutated');
  const r2 = recordResult(r1.save, '1-1', win([true, false, true], 60));
  assert.deepEqual(r2.save.levels['1-1'].stars, [true, true, true]);
  assert.equal(r2.newStars, 1);
  assert.equal(r1.save.levels['1-1'].stars[2], false, 'previous save not mutated');
  const r3 = recordResult(r2.save, '1-1', win([true, true, true], 70));
  assert.equal(r3.newStars, 0);
});

test('best time only from victories; newBest flags improvements', () => {
  const lose = recordResult(emptySave(), '1-1', { victory: false, stars: [true, true, true], time: 10 });
  assert.equal(lose.save.levels['1-1'].bestTime, undefined);
  assert.deepEqual(lose.save.levels['1-1'].stars, [false, false, false], 'a defeat earns no stars');
  assert.equal(lose.newBest, false);
  assert.equal(lose.newStars, 0);
  const a = recordResult(lose.save, '1-1', win([true, false, false], 40));
  assert.equal(a.newBest, true);
  assert.equal(a.save.levels['1-1'].bestTime, 40);
  const b = recordResult(a.save, '1-1', win([true, false, false], 55));
  assert.equal(b.newBest, false);
  assert.equal(b.save.levels['1-1'].bestTime, 40);
  const c = recordResult(b.save, '1-1', { victory: false, stars: [false, false, false], time: 5 });
  assert.equal(c.save.levels['1-1'].bestTime, 40);
  const d = recordResult(c.save, '1-1', win([true, false, false], 31.2));
  assert.equal(d.newBest, true);
  assert.equal(d.save.levels['1-1'].bestTime, 31.2);
});

test('unlock chain follows the previous level win star', () => {
  let s = emptySave();
  assert.equal(isUnlocked(s, world, '1-1'), true);
  assert.equal(isUnlocked(s, world, '1-2'), false);
  assert.equal(isUnlocked(s, world, 'nope'), false);
  s = recordResult(s, '1-1', { victory: false, stars: [false, false, false], time: 9 }).save;
  assert.equal(isUnlocked(s, world, '1-2'), false);
  s = recordResult(s, '1-1', win([true, false, false], 30)).save;
  assert.equal(isUnlocked(s, world, '1-2'), true);
  assert.equal(isUnlocked(s, world, '1-3'), false);
});

test('starCount totals all or selected levels', () => {
  let s = recordResult(emptySave(), '1-1', win([true, true, true], 30)).save;
  s = recordResult(s, '1-2', win([true, false, true], 30)).save;
  s = recordResult(s, '9-9', win([true, false, false], 30)).save;
  assert.equal(starCount(s), 6);
  assert.equal(starCount(s, world.levels), 5);
  assert.equal(starCount(emptySave(), world.levels), 0);
});

test('export -> import roundtrip', () => {
  let s = recordResult(emptySave(), '1-1', win([true, true, false], 33.3)).save;
  s = recordResult(s, '1-2', win([true, false, false], 70)).save;
  const text = exportSave(s);
  const p = JSON.parse(text);
  assert.equal(p.game, 'horde-run');
  assert.equal(p.version, 1);
  assert.equal(typeof p.exportedAt, 'string');
  assert.ok(text.includes('\n'), 'pretty printed');
  assert.deepEqual(importSave(text), s);
});

test('import rejects garbage with readable messages', () => {
  const bad = (text: string, re: RegExp) => assert.throws(() => importSave(text), re);
  bad('not json', /not valid JSON/);
  bad('[]', /not a Horde Run save/);
  bad('{"game":"other","version":1,"levels":{}}', /not a Horde Run save/);
  bad('{"game":"horde-run","version":3,"levels":{}}', /Unsupported save version: 3/);
  bad('{"game":"horde-run","version":1}', /no level list/);
  bad('{"game":"horde-run","version":1,"levels":{"1-1":{"stars":[true,false]}}}', /Level "1-1"/);
  bad('{"game":"horde-run","version":1,"levels":{"1-1":{"stars":[1,0,0]}}}', /Level "1-1"/);
  bad('{"game":"horde-run","version":1,"levels":{"1-1":null}}', /Level "1-1"/);
});

test('import drops unknown keys and ignores bad best times', () => {
  const s = importSave(
    JSON.stringify({
      game: 'horde-run',
      version: 1,
      extra: 1,
      levels: {
        '1-1': { stars: [true, false, false], bestTime: -3, junk: 'x' },
        '1-2': { stars: [true, true, false], bestTime: 'fast' },
        '1-3': { stars: [true, true, true], bestTime: 1e12 },
        '1-4': { stars: [true, true, true], bestTime: 45 },
      },
    }),
  );
  assert.deepEqual(s, {
    version: 1,
    levels: {
      '1-1': { stars: [true, false, false] },
      '1-2': { stars: [true, true, false] },
      '1-3': { stars: [true, true, true] },
      '1-4': { stars: [true, true, true], bestTime: 45 },
    },
  });
});

// ---------- v2: progression profile ----------

const v1Levels: SaveData['levels'] = {
  '1-1': { stars: [true, true, true], bestTime: 41.5 },
  '1-2': { stars: [true, false, false] },
  '1-3': { stars: [false, false, false] },
};
const v1File = JSON.stringify({ version: 1, levels: v1Levels });

function richProfile(): Profile {
  return {
    ...emptyProfile(),
    coins: 420,
    coinsEarned: 900,
    owned: ['drummer'],
    tiers: { rifleman: 2, popgun: 1 },
    loadout: { cannon: 'popgun', mobs: ['knight', 'rifleman'], champion: 'drummer', ultimate: 'barrage' },
    village: { barracks: 1 },
    stats: { expeditionBattlesWon: 6, expeditionRunsFinished: 2, expeditionRunsWon: 0 },
    seen: ['sprinter'],
  };
}

test('a v1 file migrates: stars and best times kept, coins credited', () => {
  const g = loadGame(memStore({ [SAVE_KEY]: v1File }));
  assert.equal(g.migrated, true);
  assert.deepEqual(g.save, { version: 1, levels: v1Levels });
  const coins = retroactiveCoins(g.save.levels);
  assert.ok(coins > 0);
  assert.equal(g.profile.coins, coins);
  assert.equal(g.profile.coinsEarned, coins);
  assert.deepEqual(g.profile.loadout, emptyProfile().loadout);
  assert.deepEqual(loadSave(memStore({ [SAVE_KEY]: v1File })), g.save, 'loadSave still reads v1');
});

test('writeGame/loadGame roundtrip writes version 2', () => {
  const store = memStore();
  const save = recordResult(emptySave(), '1-1', win([true, false, true], 30)).save;
  writeGame(save, richProfile(), store);
  assert.equal(JSON.parse(store.data[SAVE_KEY]).version, 2);
  const g = loadGame(store);
  assert.equal(g.migrated, false);
  assert.deepEqual(g.save, save);
  assert.deepEqual(g.profile, richProfile());
  assert.deepEqual(loadSave(store), save, 'loadSave reads v2 levels');
});

test('writeSave keeps the profile already on disk', () => {
  const store = memStore();
  writeGame(emptySave(), richProfile(), store);
  const save = recordResult(emptySave(), '1-2', win([true, true, false], 50)).save;
  writeSave(save, store);
  const g = loadGame(store);
  assert.deepEqual(g.save, save);
  assert.deepEqual(g.profile, richProfile());

  // Over a v1 file, writeSave migrates the old progress's coins instead of dropping them.
  const old = memStore({ [SAVE_KEY]: v1File });
  writeSave(save, old);
  const m = loadGame(old);
  assert.equal(m.migrated, false);
  assert.equal(m.profile.coins, retroactiveCoins(v1Levels));
  assert.deepEqual(m.save, save);
});

test('corrupt profile data falls back without losing levels', () => {
  const levels = { '1-1': { stars: [true, false, false] } };
  const at = (profile: unknown) => loadGame(memStore({ [SAVE_KEY]: JSON.stringify({ version: 2, levels, profile }) }));
  for (const bad of [null, 'x', 7, [1, 2]]) {
    const g = at(bad);
    assert.deepEqual(g.save.levels, levels);
    assert.deepEqual(g.profile, emptyProfile());
  }
  const g = at({
    coins: -50,
    coinsEarned: 'lots',
    owned: ['drummer', 'nope', 'rifleman', 3],
    tiers: { rifleman: 9, knight: -1, ghost: 2, sarge: 1.7 },
    loadout: { cannon: 'rifleman', mobs: ['sprinter', 'sprinter'], champion: 'tank', ultimate: 42 },
    village: { barracks: 5, castle: 2 },
    stats: { expeditionBattlesWon: Number.NaN, expeditionRunsWon: 2 },
    seen: 'all',
  });
  assert.deepEqual(g.profile, {
    coins: 0,
    coinsEarned: 0,
    owned: ['drummer'],
    tiers: { rifleman: 3, sarge: 1 },
    loadout: { cannon: 'popgun', mobs: ['rifleman', 'knight'], champion: 'tank', ultimate: 'barrage' },
    village: { barracks: 3 },
    stats: { expeditionBattlesWon: 0, expeditionRunsFinished: 0, expeditionRunsWon: 2 },
    seen: [],
  });
  // Bad levels in a v2 file keep the profile.
  const bl = loadGame(memStore({ [SAVE_KEY]: JSON.stringify({ version: 2, levels: 5, profile: richProfile() }) }));
  assert.deepEqual(bl.save, emptySave());
  assert.deepEqual(bl.profile, richProfile());
  assert.deepEqual(loadGame(memStore({ [SAVE_KEY]: '{bad' })).profile, emptyProfile());
});

test('exportGame -> importGame roundtrip (v2)', () => {
  const save = recordResult(emptySave(), '1-1', win([true, true, false], 33.3)).save;
  const text = exportGame(save, richProfile());
  const p = JSON.parse(text);
  assert.equal(p.game, 'horde-run');
  assert.equal(p.version, 2);
  assert.deepEqual(importGame(text), { save, profile: richProfile() });
  assert.deepEqual(importSave(text), save, 'importSave reads v2 exports too');
});

test('importGame migrates v1 exports and rejects v2 without a profile', () => {
  const save = recordResult(emptySave(), '1-3', win([true, true, true], 70)).save;
  const g = importGame(exportSave(save));
  assert.deepEqual(g.save, save);
  assert.equal(g.profile.coins, retroactiveCoins(save.levels));
  assert.throws(() => importGame('{"game":"horde-run","version":2,"levels":{}}'), /coins or collection/);
  assert.throws(() => importGame('{"game":"horde-run","version":9,"levels":{}}'), /Unsupported save version: 9/);
});
