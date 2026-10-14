// Shared by the balance tests: plays one World 1 level headless with the real sim and
// the autoplay bot. `attempt` shifts the bot's aim noise in time (a separate try by the
// same player); the sim seed is attempt + 1 so every attempt also sees different spawns.
import { createSim } from '../src/sim/index.ts';
import { createBattle } from '../src/game/battle.ts';
import { createAutoplay } from '../src/game/autoplay.ts';
import { evaluateStars } from '../src/game/stars.ts';
import { SIM_HZ } from '../src/contracts.ts';
import type { LevelDef, SimEvent } from '../src/contracts.ts';

export const MAX_SECONDS = 180;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PlayResult {
  outcome: 'playing' | 'victory' | 'defeat';
  seconds: number;
  peak: number;
  playerBase: number; // fraction of the player base HP left
  stars: [boolean, boolean, boolean];
  destroyed: number;
  missed: number;
}

export function play(level: LevelDef, skill: number, attempt = 0): PlayResult {
  const rand = mulberry32(attempt + 1);
  const sim = createSim(level, rand);
  const battle = createBattle(level, sim, rand);
  const bot = createAutoplay(level, { skill, attempt });
  const events: SimEvent[] = [];
  let peak = 0;
  let destroyed = 0;
  let missed = 0;
  for (let s = 0; s < MAX_SECONDS * SIM_HZ && battle.state.outcome === 'playing'; s++) {
    const input = bot(battle.state, sim, sim.time, events); // the bot sees last step's events
    events.length = 0;
    battle.step(input, events);
    for (const e of events) {
      if (e.type === 'defenderDestroyed') destroyed++;
      else if (e.type === 'baseMiss') missed += e.count;
    }
    if (battle.state.playerUnits > peak) peak = battle.state.playerUnits;
  }
  const st = battle.state;
  return {
    outcome: st.outcome,
    seconds: battle.stats.endTime ?? st.time,
    peak,
    playerBase: st.playerBaseHp / st.playerBaseMaxHp,
    stars: evaluateStars(level, st, battle.stats),
    destroyed,
    missed,
  };
}

export const starText = (s: readonly boolean[]): string => s.map((x) => (x ? '*' : '.')).join('');

// The difficulty curve (concept §4.1 "moderate"): 1-1..1-4 easy, 1-5..1-7 in between,
// the last two levels and the boss take a decent player a retry or two.
export const EASY = ['1-1', '1-2', '1-3', '1-4'];
export const MIDDLE = ['1-5', '1-6', '1-7'];
export const HARD = ['1-8', '1-9', '1-10'];
