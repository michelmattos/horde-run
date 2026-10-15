// Level loading: the shipped levels are JSON files (src/data/levels) validated once at
// module load, so a typo in level data fails loudly with the file and field named
// instead of producing a silently broken battle. Worlds (src/data/worlds) list their
// level ids in play order and are checked against the shipped levels the same way.
//
// Milestone 5 (World 2): the optional freezer fields are validated and copied too (theme,
// ice patches, ice walls, gusts, the trickle mix, freezing and fork gates, igloos, wave
// units and the Snow Globe Giant's phases), and worlds may carry a theme and a star unlock.
// LEVELS lists World 1 then World 2, so getLevel's "next" after 1-10 is 2-1.

import type {
  BattleMods,
  BossDef,
  DefenderDef,
  DefenderKind,
  EnemyUnit,
  EnemyWaveDef,
  GateDef,
  GateOp,
  GustDef,
  IcePatchDef,
  IceWallDef,
  LevelDef,
  WorldDef,
  WorldTheme,
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
import l201 from '../data/levels/2-01.json' with { type: 'json' };
import l202 from '../data/levels/2-02.json' with { type: 'json' };
import l203 from '../data/levels/2-03.json' with { type: 'json' };
import l204 from '../data/levels/2-04.json' with { type: 'json' };
import l205 from '../data/levels/2-05.json' with { type: 'json' };
import l206 from '../data/levels/2-06.json' with { type: 'json' };
import l207 from '../data/levels/2-07.json' with { type: 'json' };
import l208 from '../data/levels/2-08.json' with { type: 'json' };
import l209 from '../data/levels/2-09.json' with { type: 'json' };
import l210 from '../data/levels/2-10.json' with { type: 'json' };
import w1 from '../data/worlds/world-1.json' with { type: 'json' };
import w2 from '../data/worlds/world-2.json' with { type: 'json' };

const MAX_GATES = 32; // the sim tracks gates crossed in a 32-bit mask
const MAX_DEFENDERS = 16; // the sim's fixed defender capacity
const GATE_OPS: readonly GateOp[] = ['mul', 'add', 'sub', 'div'];
const DEFENDER_KINDS: readonly DefenderKind[] = ['tower', 'wall', 'igloo'];
const ENEMY_UNITS: readonly EnemyUnit[] = ['mob', 'snowman', 'penguin'];
const THEMES: readonly WorldTheme[] = ['bedroom', 'freezer'];
const BOSS_MODELS: readonly NonNullable<BossDef['model']>[] = ['tinGeneral', 'snowGlobeGiant'];
// Igloo footprint when the level gives no width (mirrors the sim: 0.75 of a wall, 1.6 deep).
export const IGLOO_DEFAULTS = { width: DEFENDER_DEFAULTS.wallWidth * 0.75, depth: 1.6 } as const;
export const MIN_GUST_WARN = 1.2; // seconds of telegraph every gust gets at least

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

function oneOf<T extends string>(o: Obj, key: string, list: readonly T[], source: string, path: string): T {
  const v = o[key] as T;
  if (!list.includes(v))
    fail(source, `${path}${key}`, `must be one of ${list.join('/')} (got ${JSON.stringify(o[key])})`);
  return v;
}

function bool(o: Obj, key: string, source: string, path: string): boolean {
  const v = o[key];
  if (typeof v !== 'boolean') fail(source, `${path}${key}`, `must be true or false (got ${JSON.stringify(v)})`);
  return v;
}

// A rectangle centred on x must fit the lane's width.
function inLaneX(x: number, width: number, lane: LevelDef['lane'], source: string, field: string, what: string): void {
  if (Math.abs(x) + width / 2 > lane.width / 2 + 1e-9)
    fail(source, field, `puts the ${what} (width ${width}) outside the lane of width ${lane.width}`);
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
  if (o.freeze !== undefined) {
    const f = obj(o.freeze, source, `${p}freeze`);
    const fp = `${p}freeze.`;
    gate.freeze = {
      after: pos(f, 'after', source, fp),
      duration: pos(f, 'duration', source, fp),
      hp: pos(f, 'hp', source, fp),
    };
  }
  if (o.fork !== undefined) gate.fork = str(o, 'fork', source, p);
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
  const kind = oneOf(o, 'kind', DEFENDER_KINDS, source, p);
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
  if (kind === 'igloo') {
    const sp = obj(o.spawn, source, `${p}spawn`);
    const spp = `${p}spawn.`;
    d.spawn = {
      unit: oneOf(sp, 'unit', ENEMY_UNITS, source, spp),
      every: pos(sp, 'every', source, spp),
      count: posInt(sp, 'count', source, spp),
    };
    if (sp.startAt !== undefined) d.spawn.startAt = nonNeg(sp, 'startAt', source, spp);
  } else if (o.spawn !== undefined) fail(source, `${p}spawn`, 'is only allowed on igloos');
  const width =
    d.width ??
    (kind === 'tower'
      ? DEFENDER_DEFAULTS.towerWidth
      : kind === 'igloo'
        ? IGLOO_DEFAULTS.width
        : DEFENDER_DEFAULTS.wallWidth);
  const depth = kind === 'tower' ? width : kind === 'igloo' ? IGLOO_DEFAULTS.depth : DEFENDER_DEFAULTS.wallDepth;
  inLaneX(d.x, width, lane, source, `${p}x`, kind);
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
    if (ph.lob !== undefined) {
      const l = obj(ph.lob, source, `${p}lob`);
      const lp = `${p}lob.`;
      phase.lob = {
        every: pos(l, 'every', source, lp),
        warn: pos(l, 'warn', source, lp),
        radius: pos(l, 'radius', source, lp),
        damage: pos(l, 'damage', source, lp),
      };
    }
    if (ph.freezeGates !== undefined) {
      const f = obj(ph.freezeGates, source, `${p}freezeGates`);
      const fp = `${p}freezeGates.`;
      phase.freezeGates = { duration: pos(f, 'duration', source, fp), hp: pos(f, 'hp', source, fp) };
    }
    if (ph.gusts !== undefined) phase.gusts = validateGust(ph.gusts, source, `${p}gusts`);
    return phase;
  });
  if (phases[0].belowHp !== 1) fail(source, 'boss.phases[0].belowHp', `must be 1 (got ${phases[0].belowHp})`);
  for (let i = 1; i < phases.length; i++) {
    if (!(phases[i].belowHp < phases[i - 1].belowHp))
      fail(source, `boss.phases[${i}].belowHp`, 'must be strictly below the previous phase');
  }
  const boss: BossDef = { name, phases };
  if (o.model !== undefined) boss.model = oneOf(o, 'model', BOSS_MODELS, source, 'boss.');
  return boss;
}

// A gust's telegraph is at least MIN_GUST_WARN long, and a repeating gust ends (warn and
// push) before the next one starts.
function validateGust(raw: unknown, source: string, field: string): GustDef {
  const o = obj(raw, source, field);
  const p = `${field}.`;
  const g: GustDef = {
    at: nonNeg(o, 'at', source, p),
    warn: pos(o, 'warn', source, p),
    duration: pos(o, 'duration', source, p),
    force: num(o, 'force', source, p),
  };
  if (g.force === 0) fail(source, `${p}force`, 'must not be 0 (its sign is the direction: + pushes right)');
  if (g.warn < MIN_GUST_WARN) fail(source, `${p}warn`, `must be at least ${MIN_GUST_WARN} s (got ${g.warn})`);
  if (o.every !== undefined) {
    g.every = pos(o, 'every', source, p);
    if (g.every <= g.warn + g.duration)
      fail(source, `${p}every`, `must be longer than warn + duration (${g.warn + g.duration} s)`);
  }
  if (o.alternate !== undefined) g.alternate = bool(o, 'alternate', source, p);
  return g;
}

function validateIce(raw: unknown, i: number, lane: LevelDef['lane'], source: string): IcePatchDef {
  const p = `ice[${i}].`;
  const o = obj(raw, source, `ice[${i}]`);
  const ice: IcePatchDef = {
    x: num(o, 'x', source, p),
    z: num(o, 'z', source, p),
    width: pos(o, 'width', source, p),
    length: pos(o, 'length', source, p),
  };
  inLaneX(ice.x, ice.width, lane, source, `${p}x`, 'ice patch');
  if (ice.z < 0 || ice.z + ice.length > lane.length)
    fail(source, `${p}z`, `must keep the patch inside [0, ${lane.length}] (got ${ice.z}..${ice.z + ice.length})`);
  return ice;
}

function validateIceWall(raw: unknown, i: number, lane: LevelDef['lane'], source: string): IceWallDef {
  const p = `iceWalls[${i}].`;
  const o = obj(raw, source, `iceWalls[${i}]`);
  const w: IceWallDef = {
    id: str(o, 'id', source, p),
    x: num(o, 'x', source, p),
    z: num(o, 'z', source, p),
    width: pos(o, 'width', source, p),
    depth: pos(o, 'depth', source, p),
  };
  inLaneX(w.x, w.width, lane, source, `${p}x`, 'ice wall');
  if (w.width >= lane.width) fail(source, `${p}width`, 'must leave a gap: the wall would close the lane');
  const zMin = LAYOUT.cannonZ + 2;
  const zMax = lane.length - LAYOUT.enemySpawnInset;
  if (w.z - w.depth / 2 < zMin || w.z + w.depth / 2 > zMax)
    fail(source, `${p}z`, `must keep the ice wall inside [${zMin}, ${zMax}] (got ${w.z})`);
  return w;
}

// Gates sharing a fork id: at least two, all on one z line, side by side without
// overlapping (moving gates count their whole swing).
function checkForks(gates: readonly GateDef[], source: string): void {
  const groups = new Map<string, number[]>();
  gates.forEach((g, i) => {
    if (g.fork !== undefined) groups.set(g.fork, [...(groups.get(g.fork) ?? []), i]);
  });
  for (const [fork, idx] of groups) {
    if (idx.length < 2) fail(source, `gates[${idx[0]}].fork`, `"${fork}" needs at least two gates`);
    for (let a = 0; a < idx.length; a++) {
      for (let b = a + 1; b < idx.length; b++) {
        const ga = gates[idx[a]];
        const gb = gates[idx[b]];
        if (ga.z !== gb.z) fail(source, `gates[${idx[b]}].z`, `must equal the z of fork "${fork}" (${ga.z})`);
        const reach = (g: GateDef) => g.width / 2 + (g.move?.amplitude ?? 0);
        if (Math.abs(ga.x - gb.x) < reach(ga) + reach(gb) - 1e-9)
          fail(source, `gates[${idx[b]}].x`, `overlaps gate "${ga.id}" of fork "${fork}"`);
      }
    }
  }
}

// Expedition per-battle modifiers (applyUpgrades output). Every number must be positive;
// knightEvery is a whole cadence of at least 2 and a burst holds at least one shot
// (its gap may be 0: the whole burst leaves at once). Crowd counts are floored in battle.
function validateMods(raw: unknown, source: string): BattleMods {
  const o = obj(raw, source, 'mods');
  const mods: BattleMods = {};
  for (const key of ['mobHp', 'mobDamage', 'shotSpread', 'startCrowd', 'championEcho'] as const) {
    if (o[key] !== undefined) mods[key] = pos(o, key, source, 'mods.');
  }
  if (o.knightEvery !== undefined) {
    const n = posInt(o, 'knightEvery', source, 'mods.');
    if (n < 2) fail(source, 'mods.knightEvery', `must be at least 2 (got ${n})`);
    mods.knightEvery = n;
  }
  if (o.knight !== undefined) {
    const k = obj(o.knight, source, 'mods.knight');
    mods.knight = {
      hp: pos(k, 'hp', source, 'mods.knight.'),
      damage: pos(k, 'damage', source, 'mods.knight.'),
      radius: pos(k, 'radius', source, 'mods.knight.'),
    };
  }
  if (o.burst !== undefined) {
    const b = obj(o.burst, source, 'mods.burst');
    mods.burst = { shots: posInt(b, 'shots', source, 'mods.burst.'), gap: nonNeg(b, 'gap', source, 'mods.burst.') };
  }
  // World 2 (Expedition upgrades Skates, Cocoa, Avalanche, Frost Gate).
  if (o.iceGrip !== undefined) {
    const g = nonNeg(o, 'iceGrip', source, 'mods.');
    if (g > 1) fail(source, 'mods.iceGrip', `must be at most 1 (got ${g})`);
    mods.iceGrip = g;
  }
  for (const key of ['thawRate', 'freezeAfter'] as const) {
    if (o[key] !== undefined) mods[key] = pos(o, key, source, 'mods.');
  }
  if (o.championFreeze !== undefined) {
    const f = obj(o.championFreeze, source, 'mods.championFreeze');
    mods.championFreeze = {
      radius: pos(f, 'radius', source, 'mods.championFreeze.'),
      seconds: pos(f, 'seconds', source, 'mods.championFreeze.'),
    };
  }
  return mods;
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
  if (o.unit !== undefined) wave.unit = oneOf(o, 'unit', ENEMY_UNITS, source, p);
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
  checkForks(gates, source);

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
  if (o.mods !== undefined) level.mods = validateMods(o.mods, source);
  if (o.theme !== undefined) level.theme = oneOf(o, 'theme', THEMES, source, '');
  if (o.ice !== undefined) level.ice = arr(o, 'ice', source).map((r, i) => validateIce(r, i, lane, source));
  if (o.iceWalls !== undefined) {
    const walls = arr(o, 'iceWalls', source).map((r, i) => validateIceWall(r, i, lane, source));
    const ids = new Set<string>();
    walls.forEach((w, i) => {
      if (ids.has(w.id)) fail(source, `iceWalls[${i}].id`, `"${w.id}" is not unique`);
      ids.add(w.id);
    });
    level.iceWalls = walls;
  }
  if (o.gusts !== undefined)
    level.gusts = arr(o, 'gusts', source).map((r, i) => validateGust(r, source, `gusts[${i}]`));
  if (o.trickleMix !== undefined) {
    const m = obj(o.trickleMix, source, 'trickleMix');
    level.trickleMix = {
      unit: oneOf(m, 'unit', ENEMY_UNITS, source, 'trickleMix.'),
      every: posInt(m, 'every', source, 'trickleMix.'),
    };
  }
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
  shippedLevel(l201, '2-01.json'),
  shippedLevel(l202, '2-02.json'),
  shippedLevel(l203, '2-03.json'),
  shippedLevel(l204, '2-04.json'),
  shippedLevel(l205, '2-05.json'),
  shippedLevel(l206, '2-06.json'),
  shippedLevel(l207, '2-07.json'),
  shippedLevel(l208, '2-08.json'),
  shippedLevel(l209, '2-09.json'),
  shippedLevel(l210, '2-10.json'),
]);

{
  const seen = new Set<string>();
  for (const l of LEVELS) {
    if (seen.has(l.id)) fail(`${l.id}`, 'id', 'is used by more than one shipped level');
    seen.add(l.id);
  }
}

// A world: id, name, faction and its level ids in play order, plus an optional theme and
// star unlock. With `knownLevels`, every listed id must name one of them; with
// `knownWorlds`, an unlock must name one of those (an earlier world).
export function validateWorld(
  raw: unknown,
  source: string,
  knownLevels: readonly LevelDef[] = LEVELS,
  knownWorlds?: readonly WorldDef[],
): WorldDef {
  const o = obj(raw, source, 'world');
  const world: WorldDef = {
    id: str(o, 'id', source, ''),
    name: str(o, 'name', source, ''),
    faction: str(o, 'faction', source, ''),
    levels: [],
  };
  if (o.theme !== undefined) world.theme = oneOf(o, 'theme', THEMES, source, '');
  if (o.unlock !== undefined) {
    const u = obj(o.unlock, source, 'unlock');
    world.unlock = { world: str(u, 'world', source, 'unlock.'), stars: posInt(u, 'stars', source, 'unlock.') };
    if (world.unlock.world === world.id) fail(source, 'unlock.world', 'cannot be the world itself');
    if (knownWorlds && !knownWorlds.some((w) => w.id === world.unlock?.world))
      fail(source, 'unlock.world', `"${world.unlock.world}" is not an earlier world`);
  }
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
  // Every level of a themed world is played in that room.
  const theme = world.theme ?? 'bedroom';
  for (const id of world.levels) {
    const l = knownLevels.find((x) => x.id === id);
    if (l && (l.theme ?? 'bedroom') !== theme)
      fail(source, 'theme', `is "${theme}" but level ${id} is "${l.theme ?? 'bedroom'}"`);
  }
  return world;
}

const world1 = validateWorld(w1, 'world-1.json');
export const WORLDS: readonly WorldDef[] = Object.freeze([world1, validateWorld(w2, 'world-2.json', LEVELS, [world1])]);

// The world a level belongs to (undefined for generated Expedition levels).
export function worldOfLevel(id: string): WorldDef | undefined {
  return WORLDS.find((w) => w.levels.includes(id));
}

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
