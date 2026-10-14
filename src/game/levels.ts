// Level loading: the shipped levels are JSON files (src/data/levels) validated once at
// module load, so a typo in level data fails loudly with the file and field named
// instead of producing a silently broken battle. Worlds (src/data/worlds) list their
// level ids in play order and are checked against the shipped levels the same way.

import type {
  BossDef,
  DefenderDef,
  DefenderKind,
  EnemyWaveDef,
  GateDef,
  GateOp,
  LevelDef,
  WorldDef,
} from '../contracts.ts';
import { DEFENDER_DEFAULTS, LAYOUT } from '../contracts.ts';
import l01 from '../data/levels/1-01.json' with { type: 'json' };
import l02 from '../data/levels/1-02.json' with { type: 'json' };
import l03 from '../data/levels/1-03.json' with { type: 'json' };
import l04 from '../data/levels/1-04.json' with { type: 'json' };
import l05 from '../data/levels/1-05.json' with { type: 'json' };
import l06 from '../data/levels/1-06.json' with { type: 'json' };
import l07 from '../data/levels/1-07.json' with { type: 'json' };
import l08 from '../data/levels/1-08.json' with { type: 'json' };
import l09 from '../data/levels/1-09.json' with { type: 'json' };
import l10 from '../data/levels/1-10.json' with { type: 'json' };
import w1 from '../data/worlds/world-1.json' with { type: 'json' };

const MAX_GATES = 32; // the sim tracks gates crossed in a 32-bit mask
const MAX_DEFENDERS = 16; // the sim's fixed defender capacity
const GATE_OPS: readonly GateOp[] = ['mul', 'add', 'sub', 'div'];
const DEFENDER_KINDS: readonly DefenderKind[] = ['tower', 'wall'];

type Obj = Record<string, unknown>;

function fail(source: string, field: string, msg: string): never {
  throw new Error(`Invalid level ${source}: ${field} ${msg}`);
}

function obj(v: unknown, source: string, field: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(source, field, 'must be an object');
  return v as Obj;
}

function str(o: Obj, key: string, source: string, path: string): string {
  const v = o[key];
  if (typeof v !== 'string' || v.length === 0) fail(source, `${path}${key}`, 'must be a non-empty string');
  return v;
}

function num(o: Obj, key: string, source: string, path: string): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v))
    fail(source, `${path}${key}`, `must be a finite number (got ${JSON.stringify(v)})`);
  return v;
}

function pos(o: Obj, key: string, source: string, path: string): number {
  const v = num(o, key, source, path);
  if (v <= 0) fail(source, `${path}${key}`, `must be > 0 (got ${v})`);
  return v;
}

function nonNeg(o: Obj, key: string, source: string, path: string): number {
  const v = num(o, key, source, path);
  if (v < 0) fail(source, `${path}${key}`, `must be >= 0 (got ${v})`);
  return v;
}

function arr(o: Obj, key: string, source: string): unknown[] {
  const v = o[key];
  if (!Array.isArray(v)) fail(source, key, 'must be an array');
  return v;
}

function posInt(o: Obj, key: string, source: string, path: string): number {
  const v = pos(o, key, source, path);
  if (!Number.isInteger(v)) fail(source, `${path}${key}`, `must be an integer (got ${v})`);
  return v;
}

function validateGate(raw: unknown, i: number, lane: LevelDef['lane'], source: string): GateDef {
  const p = `gates[${i}].`;
  const o = obj(raw, source, `gates[${i}]`);
  const id = str(o, 'id', source, p);
  const op = o.op as GateOp;
  if (!GATE_OPS.includes(op))
    fail(source, `${p}op`, `must be one of ${GATE_OPS.join('/')} (got ${JSON.stringify(o.op)})`);
  const value = num(o, 'value', source, p);
  if (value < 1) fail(source, `${p}value`, `must be >= 1 (got ${value})`);
  const x = num(o, 'x', source, p);
  const z = num(o, 'z', source, p);
  const width = pos(o, 'width', source, p);
  if (!(z > LAYOUT.cannonZ && z < lane.length)) {
    fail(source, `${p}z`, `must be inside (${LAYOUT.cannonZ}, ${lane.length}) (got ${z})`);
  }
  const gate: GateDef = { id, op, value, x, z, width };
  if (o.uses !== undefined) gate.uses = posInt(o, 'uses', source, p);
  let reach = 0;
  if (o.move !== undefined) {
    const m = obj(o.move, source, `${p}move`);
    const amplitude = pos(m, 'amplitude', source, `${p}move.`);
    const period = pos(m, 'period', source, `${p}move.`);
    gate.move = { amplitude, period };
    reach = amplitude;
  }
  const hw = lane.width / 2;
  if (Math.abs(x) + reach + width / 2 > hw + 1e-9) {
    fail(
      source,
      `${p}x`,
      `puts the gate (width ${width}${reach ? `, swing ${reach}` : ''}) outside the lane of width ${lane.width}`,
    );
  }
  return gate;
}

function validateDefender(raw: unknown, i: number, lane: LevelDef['lane'], source: string): DefenderDef {
  const p = `defenders[${i}].`;
  const o = obj(raw, source, `defenders[${i}]`);
  const id = str(o, 'id', source, p);
  const kind = o.kind as DefenderKind;
  if (!DEFENDER_KINDS.includes(kind))
    fail(source, `${p}kind`, `must be one of ${DEFENDER_KINDS.join('/')} (got ${JSON.stringify(o.kind)})`);
  const d: DefenderDef = {
    id,
    kind,
    x: num(o, 'x', source, p),
    z: num(o, 'z', source, p),
    hp: pos(o, 'hp', source, p),
  };
  if (o.width !== undefined) d.width = pos(o, 'width', source, p);
  for (const key of ['range', 'fireRate', 'damage'] as const) {
    if (o[key] === undefined) continue;
    if (kind !== 'tower') fail(source, `${p}${key}`, 'is only allowed on towers');
    d[key] = pos(o, key, source, p);
  }
  const width = d.width ?? (kind === 'tower' ? DEFENDER_DEFAULTS.towerWidth : DEFENDER_DEFAULTS.wallWidth);
  const depth = kind === 'tower' ? width : DEFENDER_DEFAULTS.wallDepth;
  if (Math.abs(d.x) + width / 2 > lane.width / 2 + 1e-9)
    fail(source, `${p}x`, `puts the ${kind} (width ${width}) outside the lane of width ${lane.width}`);
  const zMin = LAYOUT.cannonZ + 2;
  const zMax = lane.length - LAYOUT.enemySpawnInset;
  if (d.z - depth / 2 < zMin || d.z + depth / 2 > zMax)
    fail(source, `${p}z`, `must keep the ${kind} inside [${zMin}, ${zMax}] (got ${d.z})`);
  return d;
}

function validateBoss(raw: unknown, source: string): BossDef {
  const o = obj(raw, source, 'boss');
  const name = str(o, 'name', source, 'boss.');
  if (!Array.isArray(o.phases) || o.phases.length === 0) fail(source, 'boss.phases', 'must be a non-empty array');
  const phases = (o.phases as unknown[]).map((r, i) => {
    const p = `boss.phases[${i}].`;
    const ph = obj(r, source, `boss.phases[${i}]`);
    const belowHp = pos(ph, 'belowHp', source, p);
    if (belowHp > 1) fail(source, `${p}belowHp`, `must be <= 1 (got ${belowHp})`);
    const st = obj(ph.strafe, source, `${p}strafe`);
    const phase: BossDef['phases'][number] = {
      belowHp,
      strafe: {
        amplitude: nonNeg(st, 'amplitude', source, `${p}strafe.`),
        period: pos(st, 'period', source, `${p}strafe.`),
      },
    };
    if (ph.trickle !== undefined) phase.trickle = pos(ph, 'trickle', source, p);
    if (ph.summon !== undefined) phase.summon = posInt(ph, 'summon', source, p);
    return phase;
  });
  if (phases[0].belowHp !== 1) fail(source, 'boss.phases[0].belowHp', `must be 1 (got ${phases[0].belowHp})`);
  for (let i = 1; i < phases.length; i++) {
    if (!(phases[i].belowHp < phases[i - 1].belowHp))
      fail(source, `boss.phases[${i}].belowHp`, 'must be strictly below the previous phase');
  }
  return { name, phases };
}

function validateWave(raw: unknown, i: number, source: string): EnemyWaveDef {
  const p = `enemyWaves[${i}].`;
  const o = obj(raw, source, `enemyWaves[${i}]`);
  const wave: EnemyWaveDef = {
    at: nonNeg(o, 'at', source, p),
    count: pos(o, 'count', source, p),
    x: num(o, 'x', source, p),
    spread: nonNeg(o, 'spread', source, p),
  };
  if (!Number.isInteger(wave.count)) fail(source, `${p}count`, `must be an integer (got ${wave.count})`);
  if (o.interval !== undefined) wave.interval = nonNeg(o, 'interval', source, p);
  return wave;
}

export function validateLevel(raw: unknown, source: string): LevelDef {
  const o = obj(raw, source, 'level');
  const id = str(o, 'id', source, '');
  const name = str(o, 'name', source, '');

  const laneO = obj(o.lane, source, 'lane');
  const lane = { width: pos(laneO, 'width', source, 'lane.'), length: pos(laneO, 'length', source, 'lane.') };
  if (lane.length <= LAYOUT.cannonZ + LAYOUT.enemySpawnInset)
    fail(source, 'lane.length', `is too short (got ${lane.length})`);

  const c = obj(o.cannon, source, 'cannon');
  const cannon = {
    fireRate: pos(c, 'fireRate', source, 'cannon.'),
    unitsPerShot: pos(c, 'unitsPerShot', source, 'cannon.'),
    aimLimit: pos(c, 'aimLimit', source, 'cannon.'),
  };
  if (!Number.isInteger(cannon.unitsPerShot)) fail(source, 'cannon.unitsPerShot', 'must be an integer');
  if (cannon.aimLimit > lane.width / 2)
    fail(source, 'cannon.aimLimit', `must be <= half the lane width (${lane.width / 2})`);

  const pb = obj(o.playerBase, source, 'playerBase');
  const playerBase = { hp: pos(pb, 'hp', source, 'playerBase.') };
  const eb = obj(o.enemyBase, source, 'enemyBase');
  const enemyBase = {
    hp: pos(eb, 'hp', source, 'enemyBase.'),
    x: num(eb, 'x', source, 'enemyBase.'),
    width: pos(eb, 'width', source, 'enemyBase.'),
  };
  if (Math.abs(enemyBase.x) + enemyBase.width / 2 > lane.width / 2 + 1e-9)
    fail(source, 'enemyBase.width', 'puts the base outside the lane');

  const gatesRaw = arr(o, 'gates', source);
  if (gatesRaw.length > MAX_GATES)
    fail(source, 'gates', `has ${gatesRaw.length} entries; at most ${MAX_GATES} allowed`);
  const gates = gatesRaw.map((g, i) => validateGate(g, i, lane, source));
  const seen = new Set<string>();
  for (let i = 0; i < gates.length; i++) {
    if (seen.has(gates[i].id)) fail(source, `gates[${i}].id`, `"${gates[i].id}" is not unique`);
    seen.add(gates[i].id);
  }

  const enemyWaves = arr(o, 'enemyWaves', source).map((w, i) => validateWave(w, i, source));

  const ch = obj(o.champion, source, 'champion');
  const champion = {
    chargeNeeded: pos(ch, 'chargeNeeded', source, 'champion.'),
    hp: pos(ch, 'hp', source, 'champion.'),
    damage: pos(ch, 'damage', source, 'champion.'),
  };

  const level: LevelDef = { id, name, lane, cannon, playerBase, enemyBase, gates, enemyWaves, champion };
  if (o.enemySpawnRate !== undefined) {
    const r = obj(o.enemySpawnRate, source, 'enemySpawnRate');
    level.enemySpawnRate = {
      perSecond: pos(r, 'perSecond', source, 'enemySpawnRate.'),
      startAt: nonNeg(r, 'startAt', source, 'enemySpawnRate.'),
    };
  }

  if (o.defenders !== undefined) {
    const raw = arr(o, 'defenders', source);
    if (raw.length > MAX_DEFENDERS)
      fail(source, 'defenders', `has ${raw.length} entries; at most ${MAX_DEFENDERS} allowed`);
    const defenders = raw.map((d, i) => validateDefender(d, i, lane, source));
    const ids = new Set<string>();
    defenders.forEach((d, i) => {
      if (ids.has(d.id)) fail(source, `defenders[${i}].id`, `"${d.id}" is not unique`);
      ids.add(d.id);
    });
    level.defenders = defenders;
  }

  if (o.boss !== undefined) {
    const boss = validateBoss(o.boss, source);
    const maxAmp = Math.max(...boss.phases.map((ph) => ph.strafe.amplitude));
    if (Math.abs(enemyBase.x) + maxAmp + enemyBase.width / 2 > lane.width / 2 + 1e-9) {
      fail(
        source,
        'boss.phases',
        `strafe amplitude ${maxAmp} swings the base (width ${enemyBase.width}) outside the lane of width ${lane.width}`,
      );
    }
    level.boss = boss;
  }

  if (o.goals !== undefined)
    fail(source, 'goals', 'is no longer supported: every level uses the same three stars; set targetTime instead');
  if (o.targetTime !== undefined) level.targetTime = pos(o, 'targetTime', source, '');
  if (o.intro !== undefined) level.intro = str(o, 'intro', source, '');
  return level;
}

// Shipped levels must also carry a target time for star 3.
function shippedLevel(raw: unknown, source: string): LevelDef {
  const level = validateLevel(raw, source);
  if (level.targetTime === undefined) fail(source, 'targetTime', 'is required on a shipped level');
  return level;
}

export const LEVELS: readonly LevelDef[] = Object.freeze([
  shippedLevel(l01, '1-01.json'),
  shippedLevel(l02, '1-02.json'),
  shippedLevel(l03, '1-03.json'),
  shippedLevel(l04, '1-04.json'),
  shippedLevel(l05, '1-05.json'),
  shippedLevel(l06, '1-06.json'),
  shippedLevel(l07, '1-07.json'),
  shippedLevel(l08, '1-08.json'),
  shippedLevel(l09, '1-09.json'),
  shippedLevel(l10, '1-10.json'),
]);

{
  const seen = new Set<string>();
  for (const l of LEVELS) {
    if (seen.has(l.id)) fail(`${l.id}`, 'id', 'is used by more than one shipped level');
    seen.add(l.id);
  }
}

// A world: id, name, faction and its level ids in play order. With `knownLevels`,
// every listed id must name one of them.
export function validateWorld(raw: unknown, source: string, knownLevels: readonly LevelDef[] = LEVELS): WorldDef {
  const o = obj(raw, source, 'world');
  const world: WorldDef = {
    id: str(o, 'id', source, ''),
    name: str(o, 'name', source, ''),
    faction: str(o, 'faction', source, ''),
    levels: [],
  };
  const list = arr(o, 'levels', source);
  if (list.length === 0) fail(source, 'levels', 'must not be empty');
  const seen = new Set<string>();
  list.forEach((v, i) => {
    if (typeof v !== 'string' || v.length === 0) fail(source, `levels[${i}]`, 'must be a non-empty string');
    if (seen.has(v)) fail(source, `levels[${i}]`, `"${v}" is listed twice`);
    if (!knownLevels.some((l) => l.id === v)) fail(source, `levels[${i}]`, `"${v}" is not a shipped level`);
    seen.add(v);
    world.levels.push(v);
  });
  return world;
}

export const WORLDS: readonly WorldDef[] = Object.freeze([validateWorld(w1, 'world-1.json')]);

export function getWorld(id: string): WorldDef | undefined {
  return WORLDS.find((w) => w.id === id);
}

export function getLevelById(id: string): LevelDef | undefined {
  return LEVELS.find((l) => l.id === id);
}

// Index into LEVELS (as used by getLevel), or -1 for an unknown id.
export function levelIndexById(id: string): number {
  return LEVELS.findIndex((l) => l.id === id);
}

export function levelCount(): number {
  return LEVELS.length;
}

// Wraps past the end (and below zero) so "next level" after the last one loops back.
export function getLevel(index: number): LevelDef {
  const n = LEVELS.length;
  const i = Number.isFinite(index) ? Math.trunc(index) : 0;
  return LEVELS[((i % n) + n) % n];
}
