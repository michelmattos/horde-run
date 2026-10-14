// Expedition run state machine: scripted runs to victory and defeat, boss retries,
// shop and rest rules, immutability, and determinism across a JSON round trip (resume).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RUN_RULES,
  abandonRun,
  battleSpec,
  buyHeal,
  buyItem,
  chooseNode,
  dailySeed,
  finishBattle,
  leaveShop,
  newRun,
  pickUpgrade,
  randomRunSeed,
  restHeal,
  runScore,
} from '../src/expedition/run.ts';
import { availableNodes, getNode } from '../src/expedition/map.ts';
import { RARITY_PRICE, getUpgrade } from '../src/expedition/upgrades.ts';
import type { RunState } from '../src/contracts.ts';

const WIN = { victory: true, baseHpFraction: 1, seconds: 60 };
const LOSS = { victory: false, baseHpFraction: 0, seconds: 40 };
const json = (r: RunState): RunState => JSON.parse(JSON.stringify(r)) as RunState;

// Walks to the first node of a given kind reachable from the map phase, preferring `kind`.
function enterNext(run: RunState, prefer?: string): RunState {
  const ids = availableNodes(run);
  const pick = ids.find((id) => getNode(run.map, id)!.kind === prefer) ?? ids[0];
  return chooseNode(run, pick);
}

// Plays the current non-battle stop the simplest way.
function passStop(run: RunState): RunState {
  if (run.phase === 'shop') return leaveShop(run);
  if (run.phase === 'rest') return restHeal(run);
  throw new Error(`passStop: unexpected phase ${run.phase}`);
}

// Plays flawless wins (skipping picks) until `until` holds; null if the run ends first.
function advance(run: RunState, until: (r: RunState) => boolean, prefer?: string): RunState | null {
  for (let step = 0; step < 100; step++) {
    if (until(run)) return run;
    if (run.phase === 'over') return null;
    if (run.phase === 'map') run = enterNext(run, prefer);
    else if (run.phase === 'battle') run = finishBattle(run, WIN);
    else if (run.phase === 'pick') run = pickUpgrade(run, null);
    else run = passStop(run);
  }
  throw new Error('advance: run did not progress');
}

// First seed (from `from`) whose run reaches `until`.
function reach(from: number, until: (r: RunState) => boolean, prefer?: string): RunState {
  for (let seed = from; seed < from + 200; seed++) {
    const r = advance(newRun(seed), until, prefer);
    if (r) return r;
  }
  throw new Error('reach: no seed found');
}

const atBoss = (r: RunState) => r.phase === 'battle' && battleSpec(r).kind === 'boss';

test('newRun starts on the map with full HP and starting gold', () => {
  const run = newRun(7);
  assert.equal(run.phase, 'map');
  assert.equal(run.outcome, 'active');
  assert.equal(run.hp, 100);
  assert.equal(run.maxHp, 100);
  assert.equal(run.gold, RUN_RULES.startGold);
  assert.equal(run.at, undefined);
  assert.deepEqual(run.visited, []);
  assert.equal(newRun(7, { daily: '2026-10-14' }).daily, '2026-10-14');
  assert.equal('daily' in run, false);
});

test('a scripted run to victory: 5 battles, 4 picks, boss win ends the run', () => {
  let run = newRun(2026);
  const indices: number[] = [];
  while (run.phase !== 'over') {
    assert.equal(run.phase, 'map');
    run = enterNext(run);
    if (run.phase === 'battle') {
      const spec = battleSpec(run);
      indices.push(spec.index);
      assert.equal(spec.kind, getNode(run.map, run.at!)!.kind);
      const before = run;
      run = finishBattle(run, { victory: true, baseHpFraction: 0.5, seconds: 50 });
      const cost = Math.round(RUN_RULES.winHpCost[spec.kind] * 0.5);
      assert.equal(run.hp, before.hp - cost);
      assert.equal(run.lastBattle!.hpLost, cost);
      assert.equal(run.gold, before.gold + run.lastBattle!.gold);
      if (spec.kind === 'battle') assert.ok(run.lastBattle!.gold >= 20 + 5 * spec.index);
      if (spec.kind === 'elite') assert.ok(run.lastBattle!.gold >= 45 + 5 * spec.index);
      if (run.phase === 'pick') {
        assert.equal(run.offer!.length, 3);
        run = pickUpgrade(run, run.offer![0]);
        assert.equal(run.offer, undefined);
      }
    } else run = passStop(run);
  }
  assert.deepEqual(indices, [0, 1, 2, 3, 4]);
  assert.equal(run.outcome, 'won');
  assert.equal(run.stats.battlesWon, 5);
  assert.equal(run.stats.seconds, 250);
  assert.equal(Object.values(run.upgrades).reduce((a, b) => a + b, 0) >= 4, true);
  assert.equal(runScore(run), 500 + run.hp * 2 + run.gold + 1000);
  assert.deepEqual(availableNodes(run), []);
});

test('a scripted run to defeat: losses cost a fixed chunk until HP hits 0', () => {
  let run = newRun(5);
  let losses = 0;
  let healed = 0;
  while (run.phase !== 'over') {
    if (run.phase === 'map') run = enterNext(run, 'elite');
    else if (run.phase === 'battle') {
      const kind = battleSpec(run).kind;
      const hp = run.hp;
      run = finishBattle(run, LOSS);
      losses++;
      assert.equal(run.hp, Math.max(0, hp - RUN_RULES.lossHpCost[kind]));
      assert.equal(run.lastBattle!.gold, 0);
    } else {
      const hp = run.hp;
      run = passStop(run);
      healed += run.hp - hp;
    }
  }
  assert.equal(run.outcome, 'lost');
  assert.equal(run.hp, 0);
  assert.equal(run.stats.battlesLost, losses);
  assert.equal(run.stats.hpLost, 100 + healed); // the last loss is capped at the HP that was left
  assert.equal(runScore(run), run.gold); // no wins, no HP: only the unspent gold
});

test('a lost boss is retried while HP remains; a win costs HP by fort damage', () => {
  let run = advance(newRun(11), atBoss)!;
  assert.equal(run.hp, 100); // flawless wins cost nothing
  const spec = battleSpec(run);
  run = finishBattle(run, LOSS);
  assert.equal(run.phase, 'battle');
  assert.equal(run.hp, 70);
  assert.deepEqual(battleSpec(run), spec); // same boss, same battle
  run = finishBattle(run, { victory: true, baseHpFraction: 0, seconds: 90 });
  assert.equal(run.hp, 40);
  assert.equal(run.outcome, 'won');
  assert.equal(run.phase, 'over');
  // Lose the boss with too little HP left: the run ends.
  let low = advance(newRun(11), atBoss)!;
  low = finishBattle(finishBattle(finishBattle(low, LOSS), LOSS), LOSS);
  assert.equal(low.phase, 'battle');
  low = finishBattle(low, LOSS);
  assert.deepEqual([low.hp, low.outcome, low.phase], [0, 'lost', 'over']);
});

test('chooseNode rejects unavailable nodes and transitions throw from the wrong phase', () => {
  const run = newRun(3);
  assert.throws(() => chooseNode(run, 'r1c0'));
  assert.throws(() => chooseNode(run, 'nope'));
  assert.throws(() => battleSpec(run));
  assert.throws(() => finishBattle(run, WIN));
  assert.throws(() => pickUpgrade(run, null));
  assert.throws(() => leaveShop(run));
  assert.throws(() => restHeal(run));
  const b = chooseNode(run, 'r0c1');
  assert.deepEqual([b.phase, b.at, b.visited], ['battle', 'r0c1', ['r0c1']]);
  assert.throws(() => chooseNode(b, 'r0c0'));
  const p = finishBattle(b, WIN);
  assert.equal(p.phase, 'pick');
  assert.throws(() => pickUpgrade(p, 'not-offered'));
  const skipped = pickUpgrade(p, null);
  assert.deepEqual(skipped.upgrades, {});
  assert.equal(skipped.phase, 'map');
  // Inputs are never mutated.
  assert.deepEqual(run, newRun(3));
  assert.equal(b.phase, 'battle');
});

// Reaches the first shop of a run with plenty of gold.
function atShop(seed: number, gold = 500): RunState {
  return { ...reach(seed, (r) => r.phase === 'shop', 'shop'), gold };
}

test('shop: 3 distinct items priced by rarity, purchases and heal rules', () => {
  const run = atShop(21);
  const shop = run.shop!;
  assert.equal(shop.items.length, 3);
  assert.equal(new Set(shop.items.map((i) => i.upgradeId)).size, 3);
  for (const it of shop.items) {
    const base = RARITY_PRICE[getUpgrade(it.upgradeId)!.rarity];
    assert.equal(it.price % 5, 0);
    assert.ok(it.price >= base * 0.9 - 2.5 && it.price <= base * 1.1 + 2.5, `${it.upgradeId} ${it.price}`);
    assert.equal(it.sold, false);
  }
  assert.deepEqual([shop.healPrice, shop.healAmount, shop.healed], [35, 25, false]);

  const bought = buyItem(run, 1);
  assert.equal(bought.gold, 500 - shop.items[1].price);
  assert.equal(bought.shop!.items[1].sold, true);
  assert.equal(bought.upgrades[shop.items[1].upgradeId], 1);
  assert.equal(buyItem(bought, 1), bought); // sold
  const poor = { ...run, gold: shop.items[0].price - 1 };
  assert.equal(buyItem(poor, 0), poor);
  assert.equal(buyItem(run, 7), run);
  assert.equal(run.shop!.items[1].sold, false); // input untouched

  const full = { ...run, hp: run.maxHp };
  assert.equal(buyHeal(full), full); // nothing to heal
  const hurt = { ...run, hp: 50 };
  const healed = buyHeal(hurt);
  assert.deepEqual([healed.hp, healed.gold, healed.shop!.healed], [75, 465, true]);
  assert.equal(buyHeal(healed), healed);
  const broke = { ...hurt, gold: 34 };
  assert.equal(buyHeal(broke), broke);
  assert.equal(buyHeal({ ...run, hp: 90 }).hp, 100); // capped

  const left = leaveShop(bought);
  assert.deepEqual([left.phase, left.shop], ['map', undefined]);
  assert.ok(availableNodes(left).length >= 1);
});

test('Sturdy Fort raises max HP and heals, from a pick or the shop', () => {
  const p: RunState = { ...newRun(1), phase: 'pick', offer: ['fort', 'tough', 'rapid'], hp: 50 };
  const r = pickUpgrade(p, 'fort');
  assert.deepEqual([r.maxHp, r.hp, r.upgrades.fort], [120, 70, 1]);
  const full = pickUpgrade({ ...p, hp: 100 }, 'fort');
  assert.deepEqual([full.maxHp, full.hp], [120, 120]);
  const shop = atShop(21);
  const withFort: RunState = {
    ...shop,
    hp: 40,
    shop: { ...shop.shop!, items: [{ upgradeId: 'fort', price: 45, sold: false }] },
  };
  const bought = buyItem(withFort, 0);
  assert.deepEqual([bought.maxHp, bought.hp], [120, 60]);
  // At max stacks the item cannot be bought.
  const maxed = { ...withFort, upgrades: { fort: 2 } };
  assert.equal(buyItem(maxed, 0), maxed);
});

test('rest heals 30% of max HP, capped at max', () => {
  const run = reach(8, (r) => r.phase === 'rest', 'rest');
  assert.equal(restHeal({ ...run, hp: 40 }).hp, 70);
  assert.equal(restHeal({ ...run, hp: 90 }).hp, 100);
  assert.equal(restHeal({ ...run, hp: 40, maxHp: 140 }).hp, 82);
  assert.equal(restHeal(run).phase, 'map');
});

test('elites pay more and offer rarer upgrades', () => {
  let eliteGold = 0;
  let battleGold = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const run = newRun(seed);
    const b = finishBattle(chooseNode(run, 'r0c0'), WIN);
    battleGold += b.lastBattle!.gold;
    let m = pickUpgrade(b, null);
    const eliteId = availableNodes(m).find((id) => getNode(m.map, id)!.kind === 'elite');
    if (!eliteId) continue;
    m = finishBattle(chooseNode(m, eliteId), WIN);
    eliteGold += m.lastBattle!.gold;
    assert.ok(m.lastBattle!.gold >= 50);
  }
  assert.ok(eliteGold > battleGold * 0.5);
  // War Chest: +50% gold, rounded.
  const r = chooseNode(newRun(4), 'r0c0');
  const plain = finishBattle(r, WIN).lastBattle!.gold;
  const chest = finishBattle({ ...r, upgrades: { chest: 1 } }, WIN).lastBattle!.gold;
  assert.equal(chest, Math.round(plain * 1.5));
});

test('resume: offers, stock and battle seeds survive a JSON round trip', () => {
  let a = newRun(777);
  let b = json(a);
  for (let step = 0; step < 40 && a.phase !== 'over'; step++) {
    if (a.phase === 'battle') assert.deepEqual(battleSpec(a), battleSpec(b));
    if (a.phase === 'map') {
      a = enterNext(a, 'shop');
      b = enterNext(json(b), 'shop');
    } else if (a.phase === 'battle') {
      a = finishBattle(a, { victory: true, baseHpFraction: 0.8, seconds: 30 });
      b = finishBattle(json(b), { victory: true, baseHpFraction: 0.8, seconds: 30 });
    } else if (a.phase === 'pick') {
      assert.deepEqual(a.offer, b.offer);
      a = pickUpgrade(a, a.offer![1]);
      b = pickUpgrade(json(b), b.offer![1]);
    } else if (a.phase === 'shop') {
      assert.deepEqual(a.shop, b.shop);
      a = leaveShop(buyItem(a, 0));
      b = leaveShop(buyItem(json(b), 0));
    } else {
      a = restHeal(a);
      b = restHeal(json(b));
    }
    assert.deepEqual(a, b);
  }
  assert.equal(a.outcome, 'won');
});

test('abandon, score, daily seed and random seed', () => {
  const run = chooseNode(newRun(9), 'r0c2');
  const gone = abandonRun(run);
  assert.deepEqual([gone.outcome, gone.phase], ['lost', 'over']);
  assert.equal(abandonRun(gone), gone);
  assert.equal(run.phase, 'battle');
  assert.equal(runScore(newRun(1)), 200 + 30);

  const d = dailySeed(new Date(2026, 9, 4, 23, 30));
  assert.equal(d.daily, '2026-10-04');
  assert.deepEqual(dailySeed(new Date(2026, 9, 4, 0, 5)), d);
  assert.notEqual(dailySeed(new Date(2026, 9, 5)).seed, d.seed);

  for (let i = 0; i < 100; i++) {
    const s = randomRunSeed();
    assert.ok(Number.isInteger(s) && s > 0 && s < 2 ** 31);
  }
});
