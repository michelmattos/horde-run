// Star rating (concept §4.1): star 1 is winning, stars 2 and 3 are the level's two
// optional goals (LevelDef.goals[0..1]). Goals only count on a victory.
//
// A level without goals (or with only one) has its missing stars equal to star 1, so
// an unconfigured level awards 3 stars for a win and none for a loss.
//
// goalStatus is live: the HUD shows each goal as pending until it is decided. A goal
// fails the moment it can no longer be met (the clock passed, the champion launched,
// the gate was touched, too many mobs fired, base HP dropped too low); at the outcome
// every undecided goal becomes met on a victory and failed on a defeat.

import type { BattleState, LevelDef, StarGoal } from '../contracts.ts';
import type { BattleStats } from './battle.ts';

export type GoalStatus = 'pending' | 'met' | 'failed';

// Has this goal already been lost, whatever happens next?
function goalFailed(g: StarGoal, state: BattleState, stats: BattleStats): boolean {
  switch (g.type) {
    case 'time':
      return (stats.endTime ?? state.time) >= g.seconds;
    case 'baseHp':
      return state.playerBaseHp / state.playerBaseMaxHp < g.minFraction;
    case 'noChampion':
      return stats.championsLaunched > 0;
    case 'avoidGate':
      return stats.gatesTouched.has(g.gateId);
    case 'maxMobs':
      return stats.mobsFired > g.mobs;
  }
}

function status(g: StarGoal | undefined, state: BattleState, stats: BattleStats): GoalStatus {
  if (state.outcome === 'defeat') return 'failed';
  if (!g) return state.outcome === 'victory' ? 'met' : 'pending';
  if (goalFailed(g, state, stats)) return 'failed';
  return state.outcome === 'victory' ? 'met' : 'pending';
}

// Three entries: [win, goal 1, goal 2].
export function goalStatus(level: LevelDef, state: BattleState, stats: BattleStats): GoalStatus[] {
  const win: GoalStatus = state.outcome === 'victory' ? 'met' : state.outcome === 'defeat' ? 'failed' : 'pending';
  const goals = level.goals ?? [];
  return [win, status(goals[0], state, stats), status(goals[1], state, stats)];
}

export function evaluateStars(level: LevelDef, state: BattleState, stats: BattleStats): [boolean, boolean, boolean] {
  const s = goalStatus(level, state, stats);
  return [s[0] === 'met', s[1] === 'met', s[2] === 'met'];
}
