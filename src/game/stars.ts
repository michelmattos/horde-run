// Star rating (concept §4.1): the same three goals on every level.
//   Star 1: win the battle.
//   Star 2: win with the player base above half health (STAR_BASE_HP_FRACTION).
//   Star 3: win before the level's target time. A level without one awards it for any win.
// Stars 2 and 3 only count on a victory.
//
// goalStatus is live: the HUD shows each star as pending until it is decided. Star 2
// fails the moment the base drops to half health or below, star 3 the moment the clock
// reaches the target time; at the outcome every undecided star becomes met on a victory
// and failed on a defeat.

import type { BattleState, LevelDef } from '../contracts.ts';
import { STAR_BASE_HP_FRACTION } from '../contracts.ts';
import type { BattleStats } from './battle.ts';

export type GoalStatus = 'pending' | 'met' | 'failed';

function decide(lost: boolean, state: BattleState): GoalStatus {
  if (state.outcome === 'defeat' || lost) return 'failed';
  return state.outcome === 'victory' ? 'met' : 'pending';
}

// Three entries: [win, base above half health, beat the target time].
export function goalStatus(level: LevelDef, state: BattleState, stats: BattleStats): GoalStatus[] {
  const win: GoalStatus = state.outcome === 'victory' ? 'met' : state.outcome === 'defeat' ? 'failed' : 'pending';
  const baseLost = !(state.playerBaseHp > state.playerBaseMaxHp * STAR_BASE_HP_FRACTION);
  const t = stats.endTime ?? state.time;
  const timeLost = level.targetTime !== undefined && t >= level.targetTime;
  return [win, decide(baseLost, state), decide(timeLost, state)];
}

export function evaluateStars(level: LevelDef, state: BattleState, stats: BattleStats): [boolean, boolean, boolean] {
  const s = goalStatus(level, state, stats);
  return [s[0] === 'met', s[1] === 'met', s[2] === 'met'];
}
