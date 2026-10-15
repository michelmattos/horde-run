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
  | { type: 'bossPhase'; phase: number; x: number; z: number }
  | SimEventW2; // Milestone 5 (World 2) events, declared below

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
  cannonZ: 1.5, // where the cannon muzzle spawns player units
  playerBaseZ: 0, // enemy units reaching z <= this hit the player base
  playerBaseDepth: 3, // player base drawn over z in [-3, 0]
  enemyBaseDepth: 4, // enemy base drawn over z in [lane.length, lane.length + 4]; player units reaching z >= lane.length hit it
  enemySpawnInset: 1.5, // enemy units spawn at z = lane.length - 1.5
  mobRadius: 0.28,
  championRadius: 1.0,
} as const;

// ---------- Milestone 2 additions (append-only; declaration merging adds optional fields) ----------

export interface GateDef {
  uses?: number; // one-use gate: breaks after this much crossing weight; absent = unlimited
}

// Enemy structures on the lane. Towers shoot the nearest player unit in range; walls only soak.
export type DefenderKind = 'tower' | 'wall' | 'igloo'; // igloo: Milestone 5, see IglooSpawnDef
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

// Stars (concept §4.1): the same three goals on every level. Star 1 is winning, star 2
// is finishing with the player base above half health, star 3 is winning faster than
// the level's target time. All three need a victory.
export const STAR_BASE_HP_FRACTION = 0.5; // star 2 needs playerBaseHp / max strictly above this

export interface LevelDef {
  defenders?: DefenderDef[];
  boss?: BossDef;
  targetTime?: number; // seconds; star 3 is a victory before this (required on shipped levels)
  intro?: string; // one-line tip shown on the level card when the level introduces something
}

export interface BattleState {
  enemyBaseX?: number; // current enemy base centre x (moves on boss levels)
  bossPhase?: number; // 0-based, boss levels only
}

export interface WorldDef {
  id: string; // 'w1'
  name: string; // 'Bedroom Floor'
  faction: string; // 'Tan Army'
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

// Labels for the three stars, in order. A level without a target time awards star 3 for any win.
export function starGoalLabels(level: LevelDef): [string, string, string] {
  return [
    'Win the battle',
    `Keep your base above ${Math.round(STAR_BASE_HP_FRACTION * 100)}% health`,
    level.targetTime !== undefined ? `Win in under ${level.targetTime} s` : 'Win the battle',
  ];
}

// ---------- Milestone 3 additions: Expedition (append-only) ----------
// A roguelite run (concept §4.2): a seeded branching map of nodes, run HP and gold that
// carry over between battles, and upgrades that change generated battles through
// LevelDef transforms plus the optional BattleMods below. All of it is plain data so the
// run serialises straight into localStorage and every rule stays pure and testable.

// Per-battle rule changes the battle layer (src/game/battle.ts) applies on top of the
// LevelDef. Absent fields mean "no change". Built by the upgrades layer (src/expedition).
export interface BattleMods {
  mobHp?: number; // hp per weight of cannon mobs (sim SpawnOpts.hp; default 1). Gate clones inherit it.
  mobDamage?: number; // damage per weight of cannon mobs (sim SpawnOpts.damage; default 1)
  knightEvery?: number; // every Nth cannon mob is fired as a knight instead (>= 2; absent = never)
  knight?: { hp: number; damage: number; radius: number }; // knight stats (a small UnitKind.Champion)
  burst?: { shots: number; gap: number }; // each cannon shot becomes `shots` shots `gap` seconds apart
  shotSpread?: number; // x jitter half-width of a multi-mob shot (default 0.3)
  startCrowd?: number; // player mobs placed in front of the cannon when the battle starts
  championEcho?: number; // extra player mobs released with every champion launch
}

export interface LevelDef {
  mods?: BattleMods;
}

export type RunNodeKind = 'battle' | 'elite' | 'rest' | 'shop' | 'boss';

export interface RunNode {
  id: string; // 'r3c1': row 3, column 1
  row: number; // 0 = first row (bottom of the map screen); the last row holds the boss
  col: number; // 0-based index within the row, left to right
  x: number; // horizontal layout position, 0 (left) .. 1 (right)
  kind: RunNodeKind;
  next: string[]; // ids of reachable nodes in row + 1 (empty for the boss)
}

export interface RunMap {
  seed: number;
  rows: number;
  nodes: RunNode[]; // ordered by row, then col
}

// What generates one battle of a run (src/game expedition generator input).
export interface RunBattleSpec {
  seed: number; // per-node battle seed, derived from the run seed and node id
  kind: 'battle' | 'elite' | 'boss';
  index: number; // 0-based battle number along the path: 0..3 for battles/elites, 4 for the boss
}

export type UpgradeRarity = 'common' | 'rare' | 'epic';
export type UpgradeCategory = 'gate' | 'mob' | 'cannon' | 'champion' | 'relic';
// One icon per upgrade, drawn by the UI as an inline SVG sticker.
export type UpgradeIcon =
  | 'gate-x2'
  | 'gate-plus'
  | 'gate-fork'
  | 'gate-x3'
  | 'mob-tough'
  | 'mob-sharp'
  | 'mob-knight'
  | 'mob-reinforce'
  | 'cannon-rapid'
  | 'cannon-scatter'
  | 'cannon-burst'
  | 'cannon-swivel'
  | 'champ-charge'
  | 'champ-rally'
  | 'champ-big'
  | 'relic-overcharge'
  | 'relic-glass'
  | 'relic-chest'
  | 'relic-sapper'
  | 'relic-fort';

export interface UpgradeDef {
  id: string;
  name: string; // 'Burst Fire'
  text: string; // one short rule line: 'Fires bursts of 3 shots, 45% fire rate.'
  drawback?: string; // trade-off line for relics: 'Enemy defenders +20% HP.'
  rarity: UpgradeRarity;
  category: UpgradeCategory;
  icon: UpgradeIcon;
  maxStacks: number; // 1 = unique
}

// Where the player is in the run. 'battle' means a battle on `at` is underway (resuming
// re-enters it from the start); 'pick' has `offer`; 'shop' has `shop`; 'rest' is at a rest node.
export type RunPhase = 'map' | 'battle' | 'pick' | 'shop' | 'rest' | 'over';

export interface ShopItem {
  upgradeId: string;
  price: number;
  sold: boolean;
}

export interface RunStats {
  battlesWon: number;
  battlesLost: number;
  goldEarned: number;
  hpLost: number;
  seconds: number; // battle time summed over the run
}

export interface RunState {
  version: 1;
  seed: number;
  daily?: string; // local date 'YYYY-MM-DD' for a Daily run
  map: RunMap;
  at?: string; // id of the current node; absent before the first node is chosen
  visited: string[]; // node ids entered, in order
  hp: number; // run base HP (0 ends the run)
  maxHp: number;
  gold: number;
  upgrades: Record<string, number>; // upgrade id -> stacks
  phase: RunPhase;
  offer?: string[]; // phase 'pick': three upgrade ids to choose from
  shop?: { items: ShopItem[]; healPrice: number; healAmount: number; healed: boolean }; // phase 'shop'
  lastBattle?: { victory: boolean; hpLost: number; gold: number }; // shown after a battle
  stats: RunStats;
  outcome: 'active' | 'won' | 'lost';
}

// ---------- Milestone 5 additions: World 2, Freezer / Snow Globe (append-only) ----------
// Concept §9.1 "World 2 in detail". Everything here is optional, so World 1 levels, saves
// and Expedition runs keep their exact behaviour when none of it is set.

// Which room a level is played in. Absent = 'bedroom' (World 1). The renderer loads only
// the current theme's assets and disposes them when the theme changes.
export type WorldTheme = 'bedroom' | 'freezer';

// Render variant bytes the sim carries per unit (SimViewM4.variant). 0-3 and 8-10 are the
// Milestone 4 values; the rest are new in World 2. Enemy mobs default to 0.
export const UNIT_VARIANT = {
  rifleman: 0, // also the plain enemy mob and the Giant's riders
  knight: 1,
  sprinter: 2,
  bomber: 3,
  giant: 4, // player heavy unit: slow, very tough, carries riders
  snowball: 5, // Snowball Launcher shot: a rolling, growing player unit
  sarge: 8,
  tank: 9,
  drummer: 10,
  snowman: 16, // enemy: tanky and slow
  penguin: 17, // enemy: wind-up penguin, fast and weak
} as const;

// Enemy unit types a wave, the trickle or an igloo can send. 'mob' is the World 1 soldier.
export type EnemyUnit = 'mob' | 'snowman' | 'penguin';

// Freezing gate: after `after` crossing weight it ices over for `duration` seconds. While
// frozen it gives no effect and blocks player units like a wall of `hp` ice: units that
// hit it cancel against the ice (min of both hp) and chip it; at 0 hp, or when the
// duration runs out, it thaws and works again (and counts `after` afresh).
export interface GateFreezeDef {
  after: number;
  duration: number;
  hp: number;
}
export interface GateDef {
  freeze?: GateFreezeDef;
  // Gates sharing a fork id stand side by side on one z line and offer a choice (e.g.
  // left x2 vs right +N); the renderer draws a fork sign, the bot picks one branch.
  fork?: string;
}

// Ice patch: a rectangle of the lane, x centre and width, from z to z + length. Units on
// it slide: they keep their sideways momentum (separation and gust pushes are not damped)
// and lose most of their own steering.
export interface IcePatchDef {
  x: number;
  z: number;
  width: number;
  length: number;
}

// Ice wall: an unbreakable block of ice that narrows the lane into a chokepoint (and can
// divide a fork). Units of both teams are pushed out of it; it never takes damage.
export interface IceWallDef {
  id: string;
  x: number; // centre x
  z: number; // centre z
  width: number;
  depth: number;
}

// Wind gust (the globe is shaken): `warn` seconds of telegraph, then for `duration`
// seconds every unit on the lane is pushed sideways at `force` world units/s (+x = right).
// Repeats every `every` seconds when set; `alternate` flips the direction each time.
export interface GustDef {
  at: number;
  warn: number;
  duration: number;
  force: number;
  every?: number;
  alternate?: boolean;
}

// Igloo: an enemy defender that releases `count` units every `every` seconds until it is
// destroyed (DefenderDef.kind 'igloo'; it soaks like a wall and never shoots).
export interface IglooSpawnDef {
  unit: EnemyUnit;
  every: number;
  count: number;
  startAt?: number; // seconds into the battle of the first release (default `every`)
}
export interface DefenderDef {
  spawn?: IglooSpawnDef;
}

export interface EnemyWaveDef {
  unit?: EnemyUnit; // default 'mob'
}

export interface LevelDef {
  theme?: WorldTheme;
  ice?: IcePatchDef[];
  iceWalls?: IceWallDef[];
  gusts?: GustDef[];
  trickleMix?: { unit: EnemyUnit; every: number }; // every Nth trickle unit is this type
}

// Snow Globe Giant phases: lob snowballs at the crowd (phase 1), freeze every gate until
// units chip it open (phase 2), add gusts (phase 3). Absent fields: nothing extra.
export interface BossPhaseDef {
  lob?: { every: number; warn: number; radius: number; damage: number }; // damage = weight removed per snowball
  freezeGates?: { duration: number; hp: number }; // applied on entering the phase
  gusts?: GustDef; // `at` counts from the phase start
}
export interface BossDef {
  model?: 'tinGeneral' | 'snowGlobeGiant'; // absent = 'tinGeneral'
}

// A world may be locked behind the stars earned in an earlier world.
export interface WorldDef {
  theme?: WorldTheme; // absent = 'bedroom'
  unlock?: { world: string; stars: number }; // absent = open from the start
}

// Battle state the HUD and renderer read for World 2 hazards.
export interface BattleState {
  // Current or coming gust: dir -1 (left) / 1 (right) / 0 (none); warn 0..1 telegraph
  // progress (1 = the push starts); active while the crowd is being pushed.
  gust?: { dir: -1 | 0 | 1; warn: number; active: boolean };
  enemyFrozen?: number; // seconds left of a Blizzard freeze on the enemy crowd (0 = none)
}

// Expedition rule changes for the World 2 upgrades (applied by the sim and battle layers).
export interface BattleMods {
  iceGrip?: number; // 0..1: share of normal steering your units keep on ice (default 0)
  thawRate?: number; // multiplier on frozen gates' thaw speed and on chip damage (default 1)
  freezeAfter?: number; // multiplier on every freezing gate's `after` budget (default 1)
  championFreeze?: { radius: number; seconds: number }; // champion launch freezes enemies near its landing
}

export type SimEventW2 =
  | { type: 'gateFrozen'; gateId: string; x: number; z: number; duration: number }
  | { type: 'gateChipped'; gateId: string; x: number; z: number; hp: number; maxHp: number }
  | { type: 'gateThawed'; gateId: string; x: number; z: number; chipped: boolean } // chipped: broken open by units
  | { type: 'iceWallHit'; id: string; x: number; z: number }
  | { type: 'giantFell'; x: number; z: number; riders: number }
  | { type: 'snowballBurst'; x: number; z: number; count: number }
  | { type: 'unitsFrozen'; team: Team; x: number; z: number; radius: number; seconds: number };

// Icons of the five World 2 Expedition upgrades. UpgradeIcon stays as it is (UI tables
// are keyed by it): a World 2 upgrade sets `icon` to its nearest World 1 icon and
// `iconW2` to its own art, which the UI draws instead when present.
export type UpgradeIconW2 = 'gate-frost' | 'gate-rink' | 'mob-skates' | 'relic-cocoa' | 'champ-avalanche';
export interface UpgradeDef {
  iconW2?: UpgradeIconW2;
}
