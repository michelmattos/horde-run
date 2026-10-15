// Expedition battle generator (concept §4.2): turns a RunBattleSpec into a LevelDef
// built from World 1, 2 and 3 pieces in src/data/expedition/templates.json. The spec's seed
// picks a lane length, a gate layout, a defender set, a wave pattern and a name, and
// may mirror the lane in x; the battle index (0..3) scales the enemy base, the waves,
// the trickle and the defenders. Each gate layout carries its own enemy-base and wave
// factors, because a x2-x2 lane and a x2-x3 lane need very different opposition.
// Elites are a fragile fort under much heavier waves plus one extra defender (about a
// coin toss at every index); the boss (index 4) is the Tin General of 1-10 with the
// same phases, tuned for a run: it expects a few upgrades and crushes a bare cannon.
//
// World 2 pieces: three gate layouts play in the freezer (theme 'freezer') with freezing
// gates, a fork split by an ice wall, an ice-wall chokepoint, ice patches and a penguin
// share of the trickle. The seed picks the run boss: the Tin General, or the Snow Globe
// Giant, a full boss of its own in templates.json (lobbed snowballs, then frozen gates,
// then gusts; boss.model 'snowGlobeGiant'), never derived from the campaign's 2-10.
//
// World 3 pieces: three workshop layouts (theme 'workshop') with timed gates (one turning
// into a ÷2 when its clock runs out), a conveyor belt, saws and wind-up robots in the
// trickle. A quarter of battles play one of them, picked by a hash of the seed of their
// own, so every other battle draws from the seed exactly as before. The third run boss is
// the Jack-in-the-Box (its own template, like the Snow Globe Giant): it shuffles the gates
// every few seconds, faster as it cracks, and its phase summons are wind-up robots.
//
// Every template keeps two z-bands of the player's half free of gates and defenders
// (RUN_FREE_BANDS) so the gates that run upgrades add always have room.
//
// Pure and deterministic: the same spec always gives the same level. No Babylon.

import type {
  BossPhaseDef,
  ConveyorDef,
  DefenderDef,
  DefenderKind,
  EnemyUnit,
  EnemyWaveDef,
  GateDef,
  GateFreezeDef,
  GateOp,
  GateToggleDef,
  IcePatchDef,
  IceWallDef,
  LevelDef,
  RunBattleSpec,
  SawDef,
  TurntableDef,
  WorldTheme,
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
  freeze?: GateFreezeDef;
  fork?: string; // gates sharing a fork id stand on one z line, side by side
  toggle?: GateToggleDef;
}

type IceWallTemplate = Omit<IceWallDef, 'id'>;

// World 2 and 3 hazards a gate layout (or a run boss) brings along.
interface HazardTemplate {
  theme?: WorldTheme;
  ice?: IcePatchDef[];
  iceWalls?: IceWallTemplate[];
  trickleMix?: { unit: EnemyUnit; every: number };
  conveyors?: Omit<ConveyorDef, 'id'>[];
  turntables?: Omit<TurntableDef, 'id'>[];
  saws?: Omit<SawDef, 'id'>[];
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
  gateLayouts: ({ name: string; baseHp: number; waves: number; gates: GateTemplate[] } & HazardTemplate)[];
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
  snowBoss: {
    name: string;
    lane: LevelDef['lane'];
    enemyBase: { hp: number; width: number };
    playerBaseHp: number;
    gates: GateTemplate[];
    waves: WavePattern;
    snowmanEvery: number; // every Nth wave is snowmen,
    snowmanShare: number; // that many of them (snowmen are tanky)
    phases: BossPhaseDef[];
    targetTime: number;
    intro: string;
  } & HazardTemplate;
  jackBoss: {
    name: string;
    lane: LevelDef['lane'];
    enemyBase: { hp: number; width: number };
    playerBaseHp: number;
    gates: GateTemplate[];
    waves: WavePattern;
    robotEvery: number; // every Nth wave is wind-up robots,
    robotShare: number; // that many of them (robots are tough)
    phases: BossPhaseDef[];
    targetTime: number;
    intro: string;
  } & HazardTemplate;
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
// Since the cannon fires on its own (no thumb lifts) the base cannon fires 5.6/s instead
// of 6, re-measured: battle 0 20/20, battle 3 16/20, elite 1 9/20, boss rapid x2 + sharp
// + pep 5/12.
// With the three freezer layouts in the draw (9 layouts, so seeds remap), re-measured:
//   battle 0: 20/20, 57 s    elite 0: 16/20, 87 s
//   battle 1: 20/20, 58 s    elite 1: 11/20, 85 s
//   battle 2: 19/20, 83 s    elite 2: 11/20, 90 s
//   battle 3: 16/20, 101 s   elite 3: 12/20, 95 s
// Boss, rapid x2 + sharp + pep over 12 seeds (spec seed 5000 + 7919k): Tin General 5/12
// (99 s), Snow Globe Giant 6/12 (90 s; over 10 attempts: bare cannon 0, tripler 10 in
// 79 s, Big Multiplier 10 in 33 s, a lone Frost Gate 1, a lone Doubler 9).
// With the ice skid (soldiers stepping onto ice slide sideways) and the Snow Globe Giant's
// phase-2 gate ice at hp 60 (was 30, chipped open almost at once), re-measured: battle 3
// 16/20, elite 1 9/20, Snow Globe Giant with rapid x2 + sharp + pep 5/12.
// World 3: a quarter of battle seeds play a workshop layout (workshopLayout), measured on
// their own over 8 seeds (battle 0 / battle 3 / elite 1, wins and median win time):
// clockwork doubles 8/8 57 s, 5/8 106 s, 2/8 60 s; conveyor run 8/8 ~42 s, 2-5/8 ~65 s,
// 3-4/8 ~55 s; saw alley 8/8 49 s, 6/8 159 s, 2/8 113 s (saws thin the crowd, so its wins
// run long). Jack-in-the-Box with rapid x2 + sharp + pep: 8/12 (79 s).
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

// The three run bosses; the battle seed picks one (runBossModel).
export type RunBossModel = 'tinGeneral' | 'snowGlobeGiant' | 'jackInTheBox';

// Gate layouts before the first workshop one are drawn from the seed's rng as before;
// the workshop ones (the rest of the list) by workshopLayout.
const CLASSIC_LAYOUTS = ((): number => {
  const i = T.gateLayouts.findIndex((l) => l.theme === 'workshop');
  if (i >= 0 && T.gateLayouts.slice(i).some((l) => l.theme !== 'workshop'))
    throw new Error('templates.json: the workshop gate layouts must come last');
  return i < 0 ? T.gateLayouts.length : i;
})();
const WORKSHOP_LAYOUTS = T.gateLayouts.length - CLASSIC_LAYOUTS;

const round1 = (v: number): number => Math.round(v * 10) / 10;
// x mirrored when flip is -1; `+ 0` keeps a centred x at 0 rather than -0.
const mirror = (x: number, flip: number): number => flip * x + 0;

function gates(list: readonly GateTemplate[], id: string, flip: number): GateDef[] {
  return list.map((g, i) => {
    const gate: GateDef = { id: `${id}-g${i}`, op: g.op, value: g.value, x: mirror(g.x, flip), z: g.z, width: g.width };
    if (g.move) gate.move = { ...g.move };
    if (g.uses !== undefined) gate.uses = g.uses;
    if (g.freeze) gate.freeze = { ...g.freeze };
    if (g.fork !== undefined) gate.fork = `${id}-${g.fork}`;
    if (g.toggle) gate.toggle = structuredClone(g.toggle);
    return gate;
  });
}

// Copies a template's World 2 and 3 hazards onto the level, mirrored with the gates (a
// mirrored belt runs the other way, a mirrored turntable spins the other way).
function addHazards(level: LevelDef, h: HazardTemplate, id: string, flip: number): void {
  if (h.theme) level.theme = h.theme;
  if (h.ice?.length) level.ice = h.ice.map((p) => ({ ...p, x: mirror(p.x, flip) }));
  if (h.iceWalls?.length)
    level.iceWalls = h.iceWalls.map((w, i) => ({ id: `${id}-iw${i}`, ...w, x: mirror(w.x, flip) }));
  if (h.trickleMix) level.trickleMix = { ...h.trickleMix };
  if (h.conveyors?.length)
    level.conveyors = h.conveyors.map((c, i) => ({
      id: `${id}-cv${i}`,
      ...c,
      x: mirror(c.x, flip),
      vx: mirror(c.vx, flip),
    }));
  if (h.turntables?.length)
    level.turntables = h.turntables.map((t, i) => ({
      id: `${id}-tt${i}`,
      ...t,
      x: mirror(t.x, flip),
      spin: mirror(t.spin, flip),
    }));
  if (h.saws?.length)
    level.saws = h.saws.map((sw, i) => {
      const saw: SawDef = { id: `${id}-saw${i}`, ...structuredClone(sw), x: mirror(sw.x, flip) };
      if (saw.path) saw.path.dx = mirror(saw.path.dx, flip);
      return saw;
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

function drawPicks(rng: Rng, elite: boolean, seed: number): RunBattlePicks {
  const picks = {
    lane: rng.int(T.lanes.length),
    gates: rng.int(CLASSIC_LAYOUTS),
    defenders: rng.int(T.defenderSets.length),
    waves: rng.int(T.wavePatterns.length),
    mirror: rng.next() < 0.5,
    name: rng.int(elite ? T.eliteNames.length : T.names.length),
  };
  const w = workshopLayout(seed);
  if (w >= 0) picks.gates = CLASSIC_LAYOUTS + w;
  return picks;
}

// Index of the workshop layout a battle seed plays (a quarter of seeds), or -1.
export function workshopLayout(seed: number): number {
  if (WORKSHOP_LAYOUTS === 0) return -1;
  const h = Math.imul((seed >>> 0) ^ 0x27d4eb2d, 0x165667b1) >>> 0;
  return h >>> 30 === 0 ? (h & 0xffff) % WORKSHOP_LAYOUTS : -1;
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
  addHazards(level, layout, id, flip);
  return level;
}

function tinGeneralLevel(id: string, rng: Rng): LevelDef {
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

// The Snow Globe Giant, built from its own template: every snowmanEvery-th wave is a
// smaller wave of snowmen, the trickle mixes in penguins.
function snowGlobeLevel(id: string, rng: Rng): LevelDef {
  const b = T.snowBoss;
  const flip = rng.next() < 0.5 ? -1 : 1;
  const enemyWaves = waves(b.waves, 1, flip).map((w, k) =>
    (k + 1) % b.snowmanEvery === 0
      ? { ...w, count: Math.max(1, Math.round(w.count * b.snowmanShare)), unit: 'snowman' as const }
      : w,
  );
  const level: LevelDef = {
    id,
    name: b.name,
    lane: { ...b.lane },
    cannon: { ...T.base.cannon },
    playerBase: { hp: b.playerBaseHp },
    enemyBase: { hp: b.enemyBase.hp, x: 0, width: b.enemyBase.width },
    gates: gates(b.gates, id, flip),
    enemyWaves,
    enemySpawnRate: { perSecond: b.waves.trickle, startAt: b.waves.trickleAt },
    champion: { ...T.base.champion },
    boss: { name: b.name, model: 'snowGlobeGiant', phases: structuredClone(b.phases) },
    targetTime: b.targetTime,
    intro: b.intro,
  };
  addHazards(level, b, id, flip);
  return level;
}

// The Jack-in-the-Box, built from its own template: every robotEvery-th wave is a smaller
// wave of wind-up robots; the boss shuffles the gates (all one width, so their sign
// cards never cover each other wherever they land) and its phase summons are robots.
function jackLevel(id: string, rng: Rng): LevelDef {
  const b = T.jackBoss;
  const flip = rng.next() < 0.5 ? -1 : 1;
  const enemyWaves = waves(b.waves, 1, flip).map((w, k) =>
    (k + 1) % b.robotEvery === 0
      ? { ...w, count: Math.max(1, Math.round(w.count * b.robotShare)), unit: 'robot' as const }
      : w,
  );
  const level: LevelDef = {
    id,
    name: b.name,
    lane: { ...b.lane },
    cannon: { ...T.base.cannon },
    playerBase: { hp: b.playerBaseHp },
    enemyBase: { hp: b.enemyBase.hp, x: 0, width: b.enemyBase.width },
    gates: gates(b.gates, id, flip),
    enemyWaves,
    enemySpawnRate: { perSecond: b.waves.trickle, startAt: b.waves.trickleAt },
    champion: { ...T.base.champion },
    boss: { name: b.name, model: 'jackInTheBox', phases: structuredClone(b.phases) },
    targetTime: b.targetTime,
    intro: b.intro,
  };
  addHazards(level, b, id, flip);
  return level;
}

// Which boss a boss spec fights. Hashes of the seed of their own, so the rest of the boss
// battle (its mirror) draws from the seed exactly as before: a third of seeds fight the
// Jack-in-the-Box, the rest the boss they fought before it joined the pool.
export function runBossModel(seed: number): RunBossModel {
  const s = seed >>> 0;
  if ((Math.imul(s ^ 0x3c6ef372, 0x9e3779b1) >>> 0) % 3 === 0) return 'jackInTheBox';
  return Math.imul(s ^ 0x5bd1e995, 0x2545f491) >>> 31 === 0 ? 'tinGeneral' : 'snowGlobeGiant';
}

// A boss battle for an explicit boss (generateRunBattle picks it from the seed). Exposed
// for tuning sweeps and tests.
export function composeRunBoss(spec: RunBattleSpec, model: RunBossModel): LevelDef {
  const seed = spec.seed >>> 0;
  const id = `x${spec.index}-boss-${seed % 10000}`;
  const rng = createRng(seed);
  const level =
    model === 'snowGlobeGiant'
      ? snowGlobeLevel(id, rng)
      : model === 'jackInTheBox'
        ? jackLevel(id, rng)
        : tinGeneralLevel(id, rng);
  return validateLevel(level, id);
}

// The battle for one node of a run. Deterministic per spec; always passes validateLevel.
export function generateRunBattle(spec: RunBattleSpec): LevelDef {
  if (spec.kind === 'boss') return composeRunBoss(spec, runBossModel(spec.seed));
  const seed = spec.seed >>> 0;
  const id = `x${spec.index}-${spec.kind}-${seed % 10000}`;
  return validateLevel(battleLevel(spec, id, drawPicks(createRng(seed), spec.kind === 'elite', seed)), id);
}
