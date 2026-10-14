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
  | { type: 'gate'; gateId: string; x: number; z: number; added: number }
  | { type: 'unitsClash'; x: number; z: number }
  | { type: 'baseHit'; team: Team; damage: number; x: number; z: number }
  | { type: 'championLaunched'; x: number }
  | { type: 'victory' }
  | { type: 'defeat' };

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
