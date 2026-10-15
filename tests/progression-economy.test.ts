// Coin economy: rewards per mode and the playthrough bounds from concept §7 ("a normal
// playthrough maxes the gear you use, no grind wall") without coins becoming meaningless.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILDINGS,
  ITEMS,
  MAX_TIER,
  REWARDS,
  STARTER_LOADOUT,
  applyCampaignResult,
  buildCost,
  buyPrice,
  campaignReward,
  emptyProfile,
  expeditionBattleReward,
  expeditionRunReward,
  recordExpeditionBattle,
  recordExpeditionRun,
  retroactiveCoins,
  upgradeCost,
} from '../src/progression/index.ts';
import type { Profile } from '../src/progression/index.ts';
import type { LevelProgress, RunState } from '../src/contracts.ts';

type Stars = [boolean, boolean, boolean];
const STARS: Record<number, Stars> = {
  1: [true, false, false],
  2: [true, true, false],
  3: [true, true, true],
};

function run(outcome: RunState['outcome'], battlesWon: number): RunState {
  return {
    version: 1,
    seed: 1,
    map: { seed: 1, rows: 7, nodes: [] },
    visited: [],
    hp: 0,
    maxHp: 100,
    gold: 0,
    upgrades: {},
    phase: 'over',
    stats: { battlesWon, battlesLost: 1, goldEarned: 0, hpLost: 0, seconds: 0 },
    outcome,
  };
}

// Plays a scripted career and returns the final profile.
function career(opts: {
  starsPerLevel: number[]; // first-clear stars for 1-1..1-10
  defeats: number;
  replays: number;
  runs: { kinds: ('battle' | 'elite' | 'boss')[]; losses: number; won: boolean }[];
}): Profile {
  let profile = emptyProfile();
  const levels: Record<string, LevelProgress> = {};
  for (let i = 0; i < opts.defeats; i++)
    profile = applyCampaignResult(profile, '1-9', levels['1-9'], {
      victory: false,
      stars: [false, false, false],
    }).profile;
  opts.starsPerLevel.forEach((n, i) => {
    const id = `1-${i + 1}`;
    const r = applyCampaignResult(profile, id, levels[id], { victory: true, stars: STARS[n] });
    profile = r.profile;
    levels[id] = { stars: STARS[n] };
  });
  for (let i = 0; i < opts.replays; i++) {
    const id = `1-${(i % 10) + 1}`;
    profile = applyCampaignResult(profile, id, levels[id], { victory: true, stars: [true, false, false] }).profile;
  }
  for (const r of opts.runs) {
    for (const k of r.kinds) profile = recordExpeditionBattle(profile, k, true).profile;
    for (let i = 0; i < r.losses; i++) profile = recordExpeditionBattle(profile, 'battle', false).profile;
    profile = recordExpeditionRun(profile, run(r.won ? 'won' : 'lost', r.kinds.length)).profile;
  }
  return profile;
}

const loadoutIds = [
  STARTER_LOADOUT.cannon,
  ...STARTER_LOADOUT.mobs,
  STARTER_LOADOUT.champion,
  STARTER_LOADOUT.ultimate,
];
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const maxItem = (id: string) => sum([1, 2, 3].map((t) => upgradeCost(id, t) ?? 0));
const target = sum(loadoutIds.map(maxItem)) + sum(BUILDINGS.map((b) => buildCost(b.id, 1) ?? 0));

test('campaign rewards: first clear, replay, new stars, defeat', () => {
  const first = campaignReward('1-3', undefined, { victory: true, stars: [true, true, false] });
  assert.deepEqual(first.lines, [
    { label: 'First clear', amount: 80 },
    { label: '2 new stars', amount: 30 },
  ]);
  assert.equal(first.coins, 110);
  const prev: LevelProgress = { stars: [true, true, false] };
  const replay = campaignReward('1-3', prev, { victory: true, stars: [true, false, true] });
  assert.deepEqual(replay.lines, [
    { label: 'Victory', amount: REWARDS.replayWin },
    { label: 'New star', amount: REWARDS.newStar },
  ]);
  assert.equal(campaignReward('1-3', prev, { victory: true, stars: [true, true, false] }).coins, REWARDS.replayWin);
  const lose = campaignReward('1-3', prev, { victory: false, stars: [true, true, true] });
  assert.equal(lose.coins, REWARDS.defeat, 'defeats earn no stars');
  // A level once played and lost still pays the first-clear bonus on its first win.
  assert.equal(
    campaignReward('1-1', { stars: [false, false, false] }, { victory: true, stars: [true, false, false] }).lines[0]
      .label,
    'First clear',
  );
});

test('applyCampaignResult credits coins and lifetime total without mutating', () => {
  const p = emptyProfile();
  const r = applyCampaignResult(p, '1-1', undefined, { victory: true, stars: [true, true, true] });
  assert.equal(r.profile.coins, r.coins);
  assert.equal(r.profile.coinsEarned, r.coins);
  assert.equal(p.coins, 0);
});

test('expedition rewards and stats', () => {
  assert.ok(expeditionBattleReward('elite', true) > expeditionBattleReward('battle', true));
  assert.ok(expeditionBattleReward('boss', true) > expeditionBattleReward('elite', true));
  assert.equal(expeditionBattleReward('boss', false), REWARDS.expeditionDefeat);
  let p = recordExpeditionBattle(emptyProfile(), 'battle', true).profile;
  p = recordExpeditionBattle(p, 'elite', false).profile;
  assert.equal(p.stats.expeditionBattlesWon, 1);
  assert.equal(p.coins, REWARDS.expeditionBattle.battle + REWARDS.expeditionDefeat);

  assert.equal(expeditionRunReward(run('active', 3)), 0);
  const unchanged = recordExpeditionRun(p, run('active', 3));
  assert.equal(unchanged.profile, p);
  const lost = recordExpeditionRun(p, run('lost', 3));
  assert.equal(lost.coins, REWARDS.runFinished + 3 * REWARDS.runPerWin);
  assert.deepEqual(lost.profile.stats, { expeditionBattlesWon: 1, expeditionRunsFinished: 1, expeditionRunsWon: 0 });
  const won = recordExpeditionRun(lost.profile, run('won', 5));
  assert.equal(won.coins, REWARDS.runFinished + 5 * REWARDS.runPerWin + REWARDS.runWon);
  assert.deepEqual(won.profile.stats, { expeditionBattlesWon: 1, expeditionRunsFinished: 2, expeditionRunsWon: 1 });
});

test('retroactive coins equal what the campaign would have paid', () => {
  const levels: Record<string, LevelProgress> = {
    '1-1': { stars: [true, true, true], bestTime: 40 },
    '1-2': { stars: [true, false, false] },
    '1-3': { stars: [false, false, false] },
  };
  const paid = sum(
    Object.entries(levels)
      .filter(([, p]) => p.stars[0])
      .map(([id, p]) => campaignReward(id, undefined, { victory: true, stars: p.stars }).coins),
  );
  assert.equal(retroactiveCoins(levels), paid);
  assert.equal(retroactiveCoins({}), 0);
});

test('a normal playthrough maxes one loadout plus village tier 1', () => {
  const p = career({
    starsPerLevel: [3, 2, 2, 1, 2, 3, 2, 1, 2, 2], // 20 stars, 2 on average
    defeats: 3,
    replays: 5,
    runs: [0, 1, 2].map(() => ({ kinds: ['battle', 'battle', 'elite', 'battle'], losses: 1, won: false })),
  });
  assert.ok(p.coinsEarned >= target, `earned ${p.coinsEarned}, need ${target}`);
  assert.ok(p.coinsEarned <= target * 1.5, `earned ${p.coinsEarned}: upgrades should still feel earned`);
});

test('a thorough playthrough stays under 3x that and short of buying everything', () => {
  const p = career({
    starsPerLevel: Array<number>(10).fill(3),
    defeats: 15,
    replays: 20,
    runs: Array.from({ length: 6 }, () => ({
      kinds: ['battle', 'elite', 'battle', 'elite', 'boss'] as ('battle' | 'elite' | 'boss')[],
      losses: 1,
      won: true,
    })),
  });
  assert.ok(p.coinsEarned < target * 3, `earned ${p.coinsEarned}, cap ${target * 3}`);
  const everything =
    sum(ITEMS.map((it) => maxItem(it.id))) +
    sum(ITEMS.map((it) => buyPrice(it.id) ?? 0)) +
    sum(BUILDINGS.flatMap((b) => Array.from({ length: MAX_TIER }, (_, t) => buildCost(b.id, t + 1) ?? 0)));
  assert.ok(p.coinsEarned < everything, `earned ${p.coinsEarned}, everything costs ${everything}`);
});
