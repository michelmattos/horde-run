// Coin income. One currency earned in every mode (concept §7), tuned so a normal
// playthrough maxes the loadout you use plus a first village tier without a grind wall,
// while a thorough one stays well short of buying everything (see progression-economy tests).
import type { LevelProgress, RunState, SaveData } from '../contracts.ts';
import type { Profile } from './types.ts';

export const REWARDS = {
  firstClearBase: 50, // + firstClearPerLevel x the level number (1-3 -> 3)
  firstClearPerLevel: 10,
  replayWin: 10,
  newStar: 15,
  defeat: 3,
  expeditionBattle: { battle: 15, elite: 25, boss: 50 },
  expeditionDefeat: 3,
  runFinished: 10, // + runPerWin per battle won, + runWon for beating the boss
  runPerWin: 5,
  runWon: 60,
} as const;

export type RewardLine = { label: string; amount: number };
type Stars = [boolean, boolean, boolean];

// '1-3' -> 3; anything unparseable counts as level 1.
function levelNumber(levelId: string): number {
  const m = /^\d+-(\d+)$/.exec(levelId);
  return m ? Math.max(1, Number(m[1])) : 1;
}

function firstClearCoins(levelId: string): number {
  return REWARDS.firstClearBase + REWARDS.firstClearPerLevel * levelNumber(levelId);
}

// Credits coins and the lifetime total.
export function addCoins(profile: Profile, coins: number): Profile {
  const n = Math.max(0, Math.floor(coins));
  return n === 0 ? profile : { ...profile, coins: profile.coins + n, coinsEarned: profile.coinsEarned + n };
}

export function campaignReward(
  levelId: string,
  prev: LevelProgress | undefined,
  result: { victory: boolean; stars: Stars },
): { coins: number; lines: RewardLine[] } {
  const lines: RewardLine[] = [];
  if (!result.victory) {
    lines.push({ label: 'Battle fought', amount: REWARDS.defeat });
  } else {
    if (prev?.stars[0]) lines.push({ label: 'Victory', amount: REWARDS.replayWin });
    else lines.push({ label: 'First clear', amount: firstClearCoins(levelId) });
    const fresh = result.stars.filter((s, i) => s && !prev?.stars[i]).length;
    if (fresh > 0)
      lines.push({ label: fresh === 1 ? 'New star' : `${fresh} new stars`, amount: fresh * REWARDS.newStar });
  }
  return { coins: lines.reduce((sum, l) => sum + l.amount, 0), lines };
}

// `prev` is the level's progress before this battle (save.levels[levelId] before recordResult).
export function applyCampaignResult(
  profile: Profile,
  levelId: string,
  prev: LevelProgress | undefined,
  result: { victory: boolean; stars: Stars },
): { profile: Profile; coins: number; lines: RewardLine[] } {
  const r = campaignReward(levelId, prev, result);
  return { profile: addCoins(profile, r.coins), coins: r.coins, lines: r.lines };
}

export function expeditionBattleReward(kind: 'battle' | 'elite' | 'boss', victory: boolean): number {
  return victory ? REWARDS.expeditionBattle[kind] : REWARDS.expeditionDefeat;
}

// Paid once when a run ends (outcome 'won' or 'lost'); an active run earns nothing yet.
export function expeditionRunReward(run: RunState): number {
  if (run.outcome === 'active') return 0;
  return REWARDS.runFinished + REWARDS.runPerWin * run.stats.battlesWon + (run.outcome === 'won' ? REWARDS.runWon : 0);
}

export function recordExpeditionBattle(
  profile: Profile,
  kind: 'battle' | 'elite' | 'boss',
  victory: boolean,
): { profile: Profile; coins: number } {
  const coins = expeditionBattleReward(kind, victory);
  const p = addCoins(profile, coins);
  if (!victory) return { profile: p, coins };
  return { profile: { ...p, stats: { ...p.stats, expeditionBattlesWon: p.stats.expeditionBattlesWon + 1 } }, coins };
}

export function recordExpeditionRun(profile: Profile, run: RunState): { profile: Profile; coins: number } {
  if (run.outcome === 'active') return { profile, coins: 0 };
  const coins = expeditionRunReward(run);
  const p = addCoins(profile, coins);
  const s = p.stats;
  const stats = {
    ...s,
    expeditionRunsFinished: s.expeditionRunsFinished + 1,
    expeditionRunsWon: s.expeditionRunsWon + (run.outcome === 'won' ? 1 : 0),
  };
  return { profile: { ...p, stats }, coins };
}

// Coins a v1 save would have earned from its campaign progress: first clears plus stars.
export function retroactiveCoins(levels: SaveData['levels']): number {
  let coins = 0;
  for (const [id, p] of Object.entries(levels)) {
    if (p.stars[0]) coins += firstClearCoins(id);
    coins += p.stars.filter(Boolean).length * REWARDS.newStar;
  }
  return coins;
}
