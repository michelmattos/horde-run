// Level loading: the shipped levels are JSON files (src/data/levels) validated once at
// module load, so a typo in level data fails loudly with the file and field named
// instead of producing a silently broken battle.

import type { EnemyWaveDef, GateDef, GateOp, LevelDef } from '../contracts.ts';
import { LAYOUT } from '../contracts.ts';
import l1 from '../data/levels/level-01.json' with { type: 'json' };
import l2 from '../data/levels/level-02.json' with { type: 'json' };
import l3 from '../data/levels/level-03.json' with { type: 'json' };

const MAX_GATES = 32; // the sim tracks gates crossed in a 32-bit mask
const GATE_OPS: readonly GateOp[] = ['mul', 'add', 'sub', 'div'];

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
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(source, `${path}${key}`, `must be a finite number (got ${JSON.stringify(v)})`);
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

function validateGate(raw: unknown, i: number, lane: LevelDef['lane'], source: string): GateDef {
  const p = `gates[${i}].`;
  const o = obj(raw, source, `gates[${i}]`);
  const id = str(o, 'id', source, p);
  const op = o.op as GateOp;
  if (!GATE_OPS.includes(op)) fail(source, `${p}op`, `must be one of ${GATE_OPS.join('/')} (got ${JSON.stringify(o.op)})`);
  const value = num(o, 'value', source, p);
  if (value < 1) fail(source, `${p}value`, `must be >= 1 (got ${value})`);
  const x = num(o, 'x', source, p);
  const z = num(o, 'z', source, p);
  const width = pos(o, 'width', source, p);
  if (!(z > LAYOUT.cannonZ && z < lane.length)) {
    fail(source, `${p}z`, `must be inside (${LAYOUT.cannonZ}, ${lane.length}) (got ${z})`);
  }
  const gate: GateDef = { id, op, value, x, z, width };
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
    fail(source, `${p}x`, `puts the gate (width ${width}${reach ? `, swing ${reach}` : ''}) outside the lane of width ${lane.width}`);
  }
  return gate;
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
  if (lane.length <= LAYOUT.cannonZ + LAYOUT.enemySpawnInset) fail(source, 'lane.length', `is too short (got ${lane.length})`);

  const c = obj(o.cannon, source, 'cannon');
  const cannon = {
    fireRate: pos(c, 'fireRate', source, 'cannon.'),
    unitsPerShot: pos(c, 'unitsPerShot', source, 'cannon.'),
    aimLimit: pos(c, 'aimLimit', source, 'cannon.'),
  };
  if (!Number.isInteger(cannon.unitsPerShot)) fail(source, 'cannon.unitsPerShot', 'must be an integer');
  if (cannon.aimLimit > lane.width / 2) fail(source, 'cannon.aimLimit', `must be <= half the lane width (${lane.width / 2})`);

  const pb = obj(o.playerBase, source, 'playerBase');
  const playerBase = { hp: pos(pb, 'hp', source, 'playerBase.') };
  const eb = obj(o.enemyBase, source, 'enemyBase');
  const enemyBase = {
    hp: pos(eb, 'hp', source, 'enemyBase.'),
    x: num(eb, 'x', source, 'enemyBase.'),
    width: pos(eb, 'width', source, 'enemyBase.'),
  };
  if (Math.abs(enemyBase.x) + enemyBase.width / 2 > lane.width / 2 + 1e-9) fail(source, 'enemyBase.width', 'puts the base outside the lane');

  const gatesRaw = arr(o, 'gates', source);
  if (gatesRaw.length > MAX_GATES) fail(source, 'gates', `has ${gatesRaw.length} entries; at most ${MAX_GATES} allowed`);
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
    level.enemySpawnRate = { perSecond: pos(r, 'perSecond', source, 'enemySpawnRate.'), startAt: nonNeg(r, 'startAt', source, 'enemySpawnRate.') };
  }
  return level;
}

export const LEVELS: readonly LevelDef[] = Object.freeze([
  validateLevel(l1, 'level-01.json'),
  validateLevel(l2, 'level-02.json'),
  validateLevel(l3, 'level-03.json'),
]);

export function levelCount(): number {
  return LEVELS.length;
}

// Wraps past the end (and below zero) so "next level" after the last one loops back.
export function getLevel(index: number): LevelDef {
  const n = LEVELS.length;
  const i = Number.isFinite(index) ? Math.trunc(index) : 0;
  return LEVELS[((i % n) + n) % n];
}
