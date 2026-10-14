// Shared contracts between modules. Builders own their folders; this file is the
// only place cross-module shapes are defined, so change it deliberately.
//
// World space: the lane runs along +Z (away from the player). X is left/right.
// The player's cannon sits near z = 0, the enemy base near z = lane.length.
// Units are discs on the XZ plane; height is purely visual.

export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;

// Plain objects, not enums: tests run under Node's type stripping, which rejects enums.
export const Team = { Player: 0, Enemy: 1 } as const;
export type Team = (typeof Team)[keyof typeof Team];

// Mob: basic swarmer. Champion: big, tanky, launched from the charge meter.
export const UnitKind = { Mob: 0, Champion: 1 } as const;
export type UnitKind = (typeof UnitKind)[keyof typeof UnitKind];

// ---------- Level data (src/data/levels/*.json) ----------

export type GateOp = 'mul' | 'add' | 'sub' | 'div';

export interface GateDef {
  id: string;
  op: GateOp;
  value: number; // mul 2 → x2, add 10 → +10, sub 5 → -5, div 2 → ÷2
  x: number; // centre x
  z: number; // line the units cross
  width: number;
  // Optional side-to-side motion: x(t) = x + amplitude * sin(2π t / period)
  move?: { amplitude: number; period: number };
}

export interface EnemyWaveDef {
  at: number; // seconds after battle start
  count: number;
  x: number; // spawn centre x
  spread: number; // spawn half-width
  interval?: number; // seconds between units in this wave (default 0.05)
}

export interface LevelDef {
  id: string;
  name: string;
  lane: { width: number; length: number };
  cannon: { fireRate: number; unitsPerShot: number; aimLimit: number }; // shots/s; aimLimit = max |x|
  playerBase: { hp: number };
  enemyBase: { hp: number; x: number; width: number };
  gates: GateDef[];
  enemyWaves: EnemyWaveDef[];
  enemySpawnRate?: { perSecond: number; startAt: number }; // steady trickle from the enemy base
  champion: { chargeNeeded: number; hp: number; damage: number }; // charge = player mobs fired
}

// ---------- Simulation (src/sim) ----------

// Read-only view the renderer and HUD use every frame. Arrays are owned by the sim;
// only indices [0, count) are live. Never hold references across frames beyond these.
export interface SimView {
  readonly count: number;
  readonly posX: Float32Array;
  readonly posZ: Float32Array;
  readonly team: Uint8Array;
  readonly kind: Uint8Array;
  readonly weight: Uint16Array; // >1 means a "stacked" unit worth several mobs
  readonly radius: Float32Array;
  readonly hp: Float32Array;
}

export type SimEvent =
  | { type: 'gate'; gateId: string; x: number; z: number; added: number; usesLeft?: number }
  | { type: 'unitsClash'; x: number; z: number }
  | { type: 'baseHit'; team: Team; damage: number; x: number; z: number }
  | { type: 'championLaunched'; x: number }
  | { type: 'victory' }
  | { type: 'defeat' }
  | { type: 'gateBroken'; gateId: string; x: number; z: number }
  | { type: 'defenderShot'; id: string; x: number; z: number; tx: number; tz: number }
  | { type: 'defenderHit'; id: string; damage: number; x: number; z: number }
  | { type: 'defenderDestroyed'; id: string; kind: DefenderKind; x: number; z: number }
  | { type: 'baseMiss'; x: number; z: number; count: number }
  | { type: 'bossPhase'; phase: number; x: number; z: number };

export interface BattleState {
  time: number;
  playerBaseHp: number;
  playerBaseMaxHp: number;
  enemyBaseHp: number;
  enemyBaseMaxHp: number;
  championCharge: number; // 0..1
  playerUnits: number; // sum of weights
  enemyUnits: number;
  outcome: 'playing' | 'victory' | 'defeat';
}

// What the input layer hands the game each sim step.
export interface InputState {
  aimX: number; // world x the cannon should aim at, already clamped
  firing: boolean;
  championPressed: boolean; // edge-triggered: true for one step after a press
  paused: boolean;
}

// Moving gate x at time t (shared so render and sim agree exactly).
export function gateX(g: GateDef, t: number): number {
  return g.move ? g.x + g.move.amplitude * Math.sin((2 * Math.PI * t) / g.move.period) : g.x;
}

export function gateLabel(g: GateDef): string {
  switch (g.op) {
    case 'mul':
      return `x${g.value}`;
    case 'add':
      return `+${g.value}`;
    case 'sub':
      return `-${g.value}`;
    case 'div':
      return `÷${g.value}`;
  }
}

// Shared lane layout (world units). Sim, game and render all use these so the cannon, bases and spawn lines line up.
export const LAYOUT = {
  cannonZ: 1.5,        // where the cannon muzzle spawns player units
  playerBaseZ: 0,      // enemy units reaching z <= this hit the player base
  playerBaseDepth: 3,  // player base drawn over z in [-3, 0]
  enemyBaseDepth: 4,   // enemy base drawn over z in [lane.length, lane.length + 4]; player units reaching z >= lane.length hit it
  enemySpawnInset: 1.5,// enemy units spawn at z = lane.length - 1.5
  mobRadius: 0.28,
  championRadius: 1.0,
} as const;

// ---------- Milestone 2 additions (append-only; declaration merging adds optional fields) ----------

export interface GateDef {
  uses?: number; // one-use gate: breaks after this much crossing weight; absent = unlimited
}

// Enemy structures on the lane. Towers shoot the nearest player unit in range; walls only soak.
export type DefenderKind = 'tower' | 'wall';
export interface DefenderDef {
  id: string;
  kind: DefenderKind;
  x: number;
  z: number;
  hp: number;
  width?: number; // wall: x extent; tower: footprint diameter
  range?: number; // tower only: shooting radius (world units)
  fireRate?: number; // tower only: shots per second
  damage?: number; // tower only: hp removed from the target per shot
}
export const DEFENDER_DEFAULTS = {
  towerWidth: 1.6,
  wallWidth: 4,
  wallDepth: 1,
  range: 7,
  fireRate: 2,
  damage: 3,
} as const;
// Live defender state, owned by the sim and mutated in place; destroyed ones stay with hp 0.
export interface DefenderView {
  readonly id: string;
  readonly kind: DefenderKind;
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
  readonly hp: number;
  readonly maxHp: number;
}

// Boss: the enemy base strafes across the lane; phases switch as its HP falls.
export interface BossPhaseDef {
  belowHp: number; // phase starts when enemyBaseHp / max drops below this (first phase uses 1)
  strafe: { amplitude: number; period: number }; // base x = enemyBase.x + amplitude * sin(phase angle)
  trickle?: number; // enemy trickle perSecond while in this phase (overrides enemySpawnRate.perSecond)
  summon?: number; // enemy mobs spawned from the base on entering this phase
}
export interface BossDef {
  name: string;
  phases: BossPhaseDef[];
}

// Optional star goals; star 1 is always "win", stars 2 and 3 are LevelDef.goals[0..1].
export type StarGoal =
  | { type: 'time'; seconds: number }
  | { type: 'baseHp'; minFraction: number }
  | { type: 'noChampion' }
  | { type: 'avoidGate'; gateId: string }
  | { type: 'maxMobs'; mobs: number };

export interface LevelDef {
  defenders?: DefenderDef[];
  boss?: BossDef;
  goals?: StarGoal[]; // exactly 2 on shipped levels
  intro?: string; // one-line tip shown on the level card when the level introduces something
}

export interface BattleState {
  enemyBaseX?: number; // current enemy base centre x (moves on boss levels)
  bossPhase?: number; // 0-based, boss levels only
}

export interface WorldDef {
  id: string; // 'w1'
  name: string; // 'Green Valley'
  faction: string; // 'Goblins'
  levels: string[]; // level ids in play order, e.g. '1-1'..'1-10'
}

export interface LevelProgress {
  stars: [boolean, boolean, boolean];
  bestTime?: number; // seconds of the fastest victory
}
export interface SaveData {
  version: 1;
  levels: Record<string, LevelProgress>;
}

export function starGoalLabel(g: StarGoal, level?: LevelDef): string {
  switch (g.type) {
    case 'time':
      return `Win in under ${g.seconds} s`;
    case 'baseHp':
      return `Keep ${Math.round(g.minFraction * 100)}% base HP`;
    case 'noChampion':
      return 'Win without the champion';
    case 'avoidGate': {
      const gate = level?.gates.find((x) => x.id === g.gateId);
      return gate ? `Never touch the ${gateLabel(gate)} gate` : 'Avoid the trap gate';
    }
    case 'maxMobs':
      return `Fire at most ${g.mobs} mobs`;
  }
}
