// Expedition battle generator (concept §4.2): turns a RunBattleSpec into a LevelDef
// built from World 1 pieces in src/data/expedition/templates.json. The spec's seed
// picks a lane length, a gate layout, a defender set, a wave pattern and a name, and
// may mirror the lane in x; the battle index (0..3) scales the enemy base, the waves,
// the trickle and the defenders. Each gate layout carries its own enemy-base and wave
// factors, because a x2-x2 lane and a x2-x3 lane need very different opposition.
// Elites are a fragile fort under much heavier waves plus one extra defender (about a
// coin toss at every index); the boss (index 4) is the Tin General of 1-10 with the
// same phases, tuned for a run: it expects a few upgrades and crushes a bare cannon.
//
// Every template keeps two z-bands of the player's half free of gates and defenders
// (RUN_FREE_BANDS) so the gates that run upgrades add always have room.
//
// Pure and deterministic: the same spec always gives the same level. No Babylon.

import type {
  DefenderDef,
  DefenderKind,
  EnemyWaveDef,
  GateDef,
  GateOp,
  LevelDef,
  RunBattleSpec,
} from '../contracts.ts';
import { createRng } from '../core/rng.ts';
import type { Rng } from '../core/rng.ts';
import data from '../data/expedition/templates.json' with { type: 'json' };
import { getLevelById, validateLevel } from './levels.ts';

interface GateTemplate {
  op: GateOp;
  value: number;
  x: number;
  z: number;
  width: number;
  move?: { amplitude: number; period: number };
  uses?: number;
}

interface DefenderTemplate {
  kind: DefenderKind;
  x: number;
  z: number;
  hp: number;
  width?: number;
  range?: number;
  fireRate?: number;
  damage?: number;
}

interface WavePattern {
  name: string;
  first: number; // seconds to the first wave
  every: number; // seconds between waves
  waves: number;
  count: number; // first wave size
  ramp: number; // added per wave over the first four waves
  step: number; // added per wave after that
  trickle: number; // enemy trickle per second
  trickleAt: number;
}

interface Templates {
  lanes: number[];
  // baseHp scales the enemy base, waves the waves and trickle: strong gate chains face more.
  gateLayouts: { name: string; baseHp: number; waves: number; gates: GateTemplate[] }[];
  defenderSets: { name: string; baseHp: number; defenders: DefenderTemplate[]; extras: DefenderTemplate[] }[];
  wavePatterns: WavePattern[];
  scale: {
    baseHp: number[];
    waves: number[];
    trickle: number[];
    defenderHp: number[];
    extraDefenders: number[];
  };
  elite: { baseHp: number[]; waves: number[]; trickle: number[]; playerBaseHp: number[] }; // per index, on top of scale
  base: {
    cannon: LevelDef['cannon'];
    playerBaseHp: number;
    enemyBaseWidth: number;
    champion: LevelDef['champion'];
    targetTime: number;
  };
  boss: {
    enemyBaseHp: number;
    waves: number;
    trickle: number;
    playerBaseHp: number;
    gates: GateTemplate[];
    targetTime: number;
    intro: string;
  };
  names: string[];
  eliteNames: string[];
  eliteIntros: string[];
}

const T = data as Templates;

// Bands of z on the player's half (z 8 to 30) that no generated gate or defender
// touches, kept for the gates run upgrades add. Each is [from, to], 6 units deep.
export const RUN_FREE_BANDS: readonly (readonly [number, number])[] = [
  [8, 14],
  [24, 30],
];

// Win-rate targets for the 'human' autoplay profile with no upgrades (out of 6 seeds),
// and for the boss with a mid-run build of 3-4 non-gate upgrades. Asserted (reduced) in
// tests/game-expedition.test.ts. Tuned over 20 seeds (spec seed 1000 + 7919k, attempt k),
// wins and median win time:
//   battle 0: 20/20, 60 s    elite 0: 15/20, 95 s
//   battle 1: 20/20, 61 s    elite 1: 11/20, 88 s
//   battle 2: 20/20, 86 s    elite 2: 11/20, 97 s
//   battle 3: 14/20, 95 s    elite 3: 12/20, 98 s
// Boss (12 seeds each): bare cannon 0/12; non-gate builds such as rapid x2 + sharp + pep
// 7/12 (110 s), tough + rapid + knights 12/12 (100 s), tough + rapid + pep 0/12, so a
// run's build decides it about as often as not. A single Doubler, Supply or Fork Gate
// alone loses; Big Multiplier wins in about 46 s.
export const RUN_BATTLE_TARGETS = {
  seeds: 6,
  battle: [
    { index: 0, minWins: 5, maxWins: 6 },
    { index: 1, minWins: 4, maxWins: 6 },
    { index: 2, minWins: 4, maxWins: 6 },
    { index: 3, minWins: 3, maxWins: 5 },
  ],
  elite: { minWins: 2, maxWins: 4 }, // at each index 0..3
  bossWithMidRunMods: { minWins: 2, maxWins: 5 },
  winSeconds: { min: 50, max: 120 },
} as const;

const WAVE_XS = [0, -1.5, 1.5];
const WAVE_SPREAD = 3.5;
const BOSS_ID = '1-10';

const round1 = (v: number): number => Math.round(v * 10) / 10;
// x mirrored when flip is -1; `+ 0` keeps a centred x at 0 rather than -0.
const mirror = (x: number, flip: number): number => flip * x + 0;

function gates(list: readonly GateTemplate[], id: string, flip: number): GateDef[] {
  return list.map((g, i) => {
    const gate: GateDef = { id: `${id}-g${i}`, op: g.op, value: g.value, x: mirror(g.x, flip), z: g.z, width: g.width };
    if (g.move) gate.move = { ...g.move };
    if (g.uses !== undefined) gate.uses = g.uses;
    return gate;
  });
}

function waves(p: WavePattern, mul: number, flip: number): EnemyWaveDef[] {
  const out: EnemyWaveDef[] = [];
  for (let k = 0; k < p.waves; k++) {
    const count = p.count + p.ramp * Math.min(k, 4) + p.step * Math.max(0, k - 4);
    out.push({
      at: p.first + p.every * k,
      count: Math.round(count * mul),
      x: mirror(WAVE_XS[k % 3], flip),
      spread: WAVE_SPREAD,
    });
  }
  return out;
}

// Which template pieces a battle uses (indices into templates.json).
export interface RunBattlePicks {
  lane: number;
  gates: number;
  defenders: number;
  waves: number;
  mirror: boolean;
  name: number;
}

function drawPicks(rng: Rng, elite: boolean): RunBattlePicks {
  return {
    lane: rng.int(T.lanes.length),
    gates: rng.int(T.gateLayouts.length),
    defenders: rng.int(T.defenderSets.length),
    waves: rng.int(T.wavePatterns.length),
    mirror: rng.next() < 0.5,
    name: rng.int(elite ? T.eliteNames.length : T.names.length),
  };
}

// Number of templates of each kind, for tuning sweeps over every combination.
export const RUN_TEMPLATE_COUNTS = {
  lanes: T.lanes.length,
  gates: T.gateLayouts.length,
  defenders: T.defenderSets.length,
  waves: T.wavePatterns.length,
} as const;

// A normal or elite battle from explicit template picks (generateRunBattle draws them
// from the seed). Exposed for tuning sweeps and tests; the boss ignores picks.
export function composeRunBattle(spec: RunBattleSpec, picks: RunBattlePicks): LevelDef {
  const id = `x${spec.index}-${spec.kind}-${(spec.seed >>> 0) % 10000}`;
  return validateLevel(battleLevel(spec, id, picks), id);
}

function battleLevel(spec: RunBattleSpec, id: string, p: RunBattlePicks): LevelDef {
  const elite = spec.kind === 'elite';
  const i = Math.min(3, Math.max(0, Math.trunc(spec.index)));
  const length = T.lanes[p.lane];
  const layout = T.gateLayouts[p.gates];
  const set = T.defenderSets[p.defenders];
  const pattern = T.wavePatterns[p.waves];
  const flip = p.mirror ? -1 : 1;
  const name = (elite ? T.eliteNames : T.names)[p.name];
  const intro = elite ? T.eliteIntros[p.name % T.eliteIntros.length] : undefined;

  const s = T.scale;
  const e = elite
    ? { baseHp: T.elite.baseHp[i], waves: T.elite.waves[i], trickle: T.elite.trickle[i], fort: T.elite.playerBaseHp[i] }
    : { baseHp: 1, waves: 1, trickle: 1, fort: 1 };
  const extras = s.extraDefenders[i] + (elite ? 1 : 0);
  const defenders: DefenderDef[] = [...set.defenders, ...set.extras.slice(0, extras)].map((d, k) => ({
    ...d,
    id: `${id}-d${k}`,
    x: mirror(d.x, flip),
    hp: Math.round(d.hp * s.defenderHp[i]),
  }));

  const level: LevelDef = {
    id,
    name,
    lane: { width: 10, length },
    cannon: { ...T.base.cannon },
    playerBase: { hp: Math.round(T.base.playerBaseHp * e.fort) },
    enemyBase: {
      hp: Math.round(s.baseHp[i] * e.baseHp * layout.baseHp * set.baseHp),
      x: 0,
      width: T.base.enemyBaseWidth,
    },
    gates: gates(layout.gates, id, flip),
    defenders,
    enemyWaves: waves(pattern, s.waves[i] * e.waves * layout.waves, flip),
    enemySpawnRate: {
      perSecond: round1(pattern.trickle * s.trickle[i] * e.trickle * layout.waves),
      startAt: pattern.trickleAt,
    },
    champion: { ...T.base.champion },
    targetTime: T.base.targetTime,
  };
  if (intro) level.intro = intro;
  return level;
}

function bossLevel(id: string, rng: Rng): LevelDef {
  const src = getLevelById(BOSS_ID);
  if (!src?.boss) throw new Error(`Expedition boss needs shipped level ${BOSS_ID} with a boss`);
  const b = T.boss;
  const flip = rng.next() < 0.5 ? -1 : 1;
  const level: LevelDef = {
    id,
    name: src.boss.name,
    lane: { ...src.lane },
    cannon: { ...src.cannon },
    playerBase: { hp: b.playerBaseHp },
    enemyBase: { ...src.enemyBase, hp: b.enemyBaseHp },
    gates: gates(b.gates, id, flip),
    enemyWaves: src.enemyWaves.map((w) => ({ ...w, x: mirror(w.x, flip), count: Math.round(w.count * b.waves) })),
    champion: { ...src.champion },
    boss: {
      name: src.boss.name,
      phases: src.boss.phases.map((ph) => ({
        ...ph,
        strafe: { ...ph.strafe },
        ...(ph.trickle !== undefined ? { trickle: round1(ph.trickle * b.trickle) } : {}),
      })),
    },
    targetTime: b.targetTime,
    intro: b.intro,
  };
  const trickle = src.enemySpawnRate;
  if (trickle) level.enemySpawnRate = { perSecond: round1(trickle.perSecond * b.trickle), startAt: trickle.startAt };
  return level;
}

// The battle for one node of a run. Deterministic per spec; always passes validateLevel.
export function generateRunBattle(spec: RunBattleSpec): LevelDef {
  const seed = spec.seed >>> 0;
  const id = `x${spec.index}-${spec.kind}-${seed % 10000}`;
  const rng = createRng(seed);
  const level =
    spec.kind === 'boss' ? bossLevel(id, rng) : battleLevel(spec, id, drawPicks(rng, spec.kind === 'elite'));
  return validateLevel(level, id);
}
