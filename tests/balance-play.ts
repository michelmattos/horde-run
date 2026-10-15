// Shared by the balance tests: plays one World 1 level headless with the real sim and
// the autoplay bot. `attempt` shifts the bot's aim noise in time (a separate try by the
// same player); the sim seed is attempt + 1 so every attempt also sees different spawns.
// An optional BattleLoadout (Milestone 4) is handed to the battle and the bot, which then
// also uses the ultimate.
import { createSim } from '../src/sim/index.ts';
import { createBattle } from '../src/game/battle.ts';
import { createAutoplay } from '../src/game/autoplay.ts';
import { evaluateStars } from '../src/game/stars.ts';
import { SIM_HZ } from '../src/contracts.ts';
import type { LevelDef, SimEvent } from '../src/contracts.ts';
import type { BattleLoadout, ChampionSpec, MobSpec, UltimateSpec } from '../src/game/loadout.ts';
import { STARTER_LOADOUT, emptyProfile, resolveLoadout } from '../src/progression/index.ts';
import type { Loadout } from '../src/progression/index.ts';

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
  enemyBase: number; // fraction of the enemy base HP left
  fired: number; // mobs fired
  stars: [boolean, boolean, boolean];
  destroyed: number;
  missed: number;
  ultimates: number; // ultimates fired (loadout battles)
}

// `who` is a precise-bot skill (0..1) or 'human', the phone-player stand-in the
// campaign is tuned against.
export function play(level: LevelDef, who: number | 'human', attempt = 0, loadout?: BattleLoadout): PlayResult {
  const rand = mulberry32(attempt + 1);
  const sim = createSim(level, rand);
  const battle = createBattle(level, sim, rand, loadout);
  const bot = createAutoplay(
    level,
    who === 'human' ? { profile: 'human', attempt, loadout } : { skill: who, attempt, loadout },
  );
  const events: SimEvent[] = [];
  let peak = 0;
  let destroyed = 0;
  let missed = 0;
  for (let s = 0; s < MAX_SECONDS * SIM_HZ && battle.state.outcome === 'playing'; s++) {
    const input = bot(battle.state, sim, sim.time, events, battle.ultimateCharge); // the bot sees last step's events
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
    enemyBase: st.enemyBaseHp / st.enemyBaseMaxHp,
    fired: battle.stats.mobsFired,
    stars: evaluateStars(level, st, battle.stats),
    destroyed,
    missed,
    ultimates: battle.stats.ultimatesFired ?? 0,
  };
}

export const starText = (s: readonly boolean[]): string => s.map((x) => (x ? '*' : '.')).join('');

// The difficulty curve (concept §4.1 "moderate"), as Michel set it after play-testing
// on a phone: 1-1..1-4 easy, 1-5..1-7 won on a first or second try, the last two
// levels and the boss take a retry or two, never a wall. It is asserted against the
// 'human' autoplay profile (a thumb on a phone), not the precise bot, which reacts at
// once and reads the whole lane.
export const EASY = ['1-1', '1-2', '1-3', '1-4'];
export const MIDDLE = ['1-5', '1-6', '1-7'];
export const HARD = ['1-8', '1-9'];
export const BOSS = ['1-10'];

// Human attempts per level in the tests. Tuning used 16 (attempts 0..15) with these
// win rates: easy 100%, 1-5..1-7 81-88%, 1-8 and 1-9 63%, the boss 56%.
export const HUMAN_ATTEMPTS = 8;

export function humanRuns(level: LevelDef, n = HUMAN_ATTEMPTS, loadout?: BattleLoadout): PlayResult[] {
  return Array.from({ length: n }, (_, a) => play(level, 'human', a, loadout));
}

export function median(xs: readonly number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  return s.length ? (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2 : NaN;
}

// One line per level so the ramp is visible when tuning.
export function runLine(id: string, runs: readonly PlayResult[]): string {
  const wins = runs.filter((r) => r.outcome === 'victory');
  return (
    `  ${id.padEnd(5)} human: ${wins.length}/${runs.length} wins, median win ${median(wins.map((r) => r.seconds)).toFixed(0)} s | ` +
    runs
      .map((r) => `${r.outcome[0]} ${r.seconds.toFixed(0)}s ${(r.playerBase * 100).toFixed(0)}% ${starText(r.stars)}`)
      .join(' | ')
  );
}

// ---------- Milestone 4: loadout fairness ----------
// Tier-0 alternatives to the starter loadout (progression's catalog), each swapped into
// DEFAULT_BATTLE_LOADOUT on its own. Values are the ones recommended to progression
// after tuning against the human profile: the sprinter at hp 1 (at 0.7 a sprinter
// trades worse than 1:1 because an enemy left with 0.3 hp still counts as a whole mob,
// so it lost most of 1-5..1-10), the bomber at 1.5 per shot (one bomber in place of a
// knight lost 1-5 now and then, two outplayed the knight on 1-6..1-10), and the paratrooper and marble meters scaled with the
// starter's barrage (120 -> 360 mobs) so neither becomes a must-have.
export const TIER0 = {
  sprinter: { id: 'sprinter', variant: 2, kind: 'mob', perShot: null, hp: 1, damage: 0.8, radius: 0.24, speed: 10 },
  bomber: {
    id: 'bomber',
    variant: 3,
    kind: 'mob',
    perShot: 1.5,
    hp: 2,
    damage: 1,
    radius: 0.32,
    speed: 6,
    deathBlast: { radius: 1.4, damage: 4 },
  },
  tank: { id: 'tank', variant: 9, hpMul: 1.6, damageMul: 1.25, radius: 1.2, speed: 3.2, chargeMul: 1.3, echo: 0 },
  drummer: {
    id: 'drummer',
    variant: 10,
    hpMul: 0.75,
    damageMul: 0.8,
    radius: 0.9,
    speed: 5,
    chargeMul: 0.85,
    echo: 24,
  },
  paratroopers: { id: 'paratroopers', chargeNeeded: 450, power: 27 },
  marble: { id: 'marble', chargeNeeded: 420, power: 40 },
} as const satisfies {
  sprinter: MobSpec;
  bomber: MobSpec;
  tank: ChampionSpec;
  drummer: ChampionSpec;
  paratroopers: UltimateSpec;
  marble: UltimateSpec;
};

// The starter with items swapped in, by catalog id, resolved through progression's real
// resolveLoadout (cannon transform included), so slot order and the cannon's scaling of
// fixed-count mobs are exercised exactly as in the game.
export interface ItemCase {
  name: string;
  ids: Partial<Omit<Loadout, 'mobs'>> & { mobs?: [string, string] };
}
export function resolveCase(level: LevelDef, c: ItemCase): { level: LevelDef; loadout: BattleLoadout } {
  const r = resolveLoadout(level, { ...emptyProfile(), loadout: { ...STARTER_LOADOUT, ...c.ids } });
  return { level: r.level, loadout: r.battle };
}
export const STARTER_CASE: ItemCase = { name: 'starter', ids: {} };
export const ITEM_CASES: ItemCase[] = [
  { name: 'sprinter (slot 1)', ids: { mobs: ['sprinter', 'knight'] } },
  { name: 'bomber (slot 2)', ids: { mobs: ['rifleman', 'bomber'] } },
  { name: 'knight + bomber', ids: { mobs: ['knight', 'bomber'] } },
  { name: 'tank', ids: { champion: 'tank' } },
  { name: 'drummer', ids: { champion: 'drummer' } },
  { name: 'paratroopers', ids: { ultimate: 'paratroopers' } },
  { name: 'marble', ids: { ultimate: 'marble' } },
  { name: 'repeater', ids: { cannon: 'repeater' } },
  { name: 'blunderbuss', ids: { cannon: 'blunderbuss' } },
];
