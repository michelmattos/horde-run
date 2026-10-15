// Expedition BattleMods in the battle layer: each field against a fake sim (spawns are
// recorded with their time), mobHp through a real gate clone, validateLevel accepting
// and rejecting mods, and a level without mods playing exactly as it did before mods.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, DEFAULT_KNIGHT } from '../src/game/battle.ts';
import type { BattleSim } from '../src/game/battle.ts';
import { getLevelById, validateLevel } from '../src/game/levels.ts';
import { createSim } from '../src/sim/index.ts';
import { LAYOUT, SIM_DT, SIM_HZ, Team, UnitKind } from '../src/contracts.ts';
import type { BattleMods, GateDef, InputState, LevelDef, SimEvent, SimView } from '../src/contracts.ts';
import { play } from './balance-play.ts';

interface SpawnRec {
  team: Team;
  kind: UnitKind;
  z: number;
  count: number;
  time: number;
  opts?: { hp?: number; damage?: number; radius?: number; spread?: number };
}

const emptyView: SimView = {
  count: 0,
  posX: new Float32Array(0),
  posZ: new Float32Array(0),
  team: new Uint8Array(0),
  kind: new Uint8Array(0),
  weight: new Uint16Array(0),
  radius: new Float32Array(0),
  hp: new Float32Array(0),
};

function fakeSim(): { sim: BattleSim; spawns: SpawnRec[] } {
  const spawns: SpawnRec[] = [];
  let time = 0;
  const sim: BattleSim = {
    view: emptyView,
    get time() {
      return time;
    },
    spawn(team, kind, _x, z, count, opts) {
      spawns.push({ team, kind, z, count, time, opts });
    },
    step(dt) {
      time += dt;
    },
    totals: () => ({ player: 0, enemy: 0 }),
  };
  return { sim, spawns };
}

function level(mods?: BattleMods, over: Partial<LevelDef> = {}): LevelDef {
  return {
    id: 'mods',
    name: 'Mods',
    lane: { width: 10, length: 60 },
    cannon: { fireRate: 8, unitsPerShot: 1, aimLimit: 4 },
    playerBase: { hp: 100 },
    enemyBase: { hp: 150, x: 0, width: 6 },
    gates: [],
    enemyWaves: [],
    champion: { chargeNeeded: 10, hp: 50, damage: 30 },
    ...(mods ? { mods } : {}),
    ...over,
  };
}

const input = (over: Partial<InputState> = {}): InputState => ({
  aimX: 0,
  firing: false,
  championPressed: false,
  paused: false,
  ...over,
});
const rand = () => 0.5;
const player = (s: SpawnRec[], kind: UnitKind) => s.filter((r) => r.team === Team.Player && r.kind === kind);
const total = (s: SpawnRec[]) => s.reduce((n, r) => n + r.count, 0);

test('knightEvery: every Nth mob fired is a knight, a small champion, counted in mobsFired', () => {
  const knight = { hp: 18, damage: 12, radius: 0.6 };
  const f = fakeSim();
  const b = createBattle(level({ knightEvery: 4, knight }), f.sim, rand);
  for (let i = 0; i < 2 * SIM_HZ; i++) b.step(input({ firing: true }), []); // 16 shots of 1
  const knights = player(f.spawns, UnitKind.Champion);
  assert.equal(knights.length, 4);
  assert.equal(total(player(f.spawns, UnitKind.Mob)), 12);
  assert.deepEqual(knights[0].opts, { ...knight, variant: 1 }, 'drawn as knights (variant 1)');
  assert.ok(knight.radius < LAYOUT.championRadius);
  assert.equal(b.stats.mobsFired, 16);
  assert.ok(Math.abs(b.state.championCharge - 1) < 1e-9, 'knights charge the meter like mobs');

  // Three mobs a shot: mobs 10, 20 and 30 of the battle are knights.
  const g = fakeSim();
  const c = createBattle(
    level({ knightEvery: 10 }, { cannon: { fireRate: 8, unitsPerShot: 3, aimLimit: 4 } }),
    g.sim,
    rand,
  );
  while (c.stats.mobsFired < 30) c.step(input({ firing: true }), []);
  assert.equal(c.stats.mobsFired, 30);
  assert.equal(total(player(g.spawns, UnitKind.Champion)), 3);
  assert.equal(total(player(g.spawns, UnitKind.Mob)), 27);
  assert.deepEqual(player(g.spawns, UnitKind.Champion)[0].opts, { ...DEFAULT_KNIGHT, variant: 1 });
});

test('burst: one shot becomes 3 shots spaced by the gap, even after the thumb lifts', () => {
  const f = fakeSim();
  const b = createBattle(
    level({ burst: { shots: 3, gap: 0.1 } }, { cannon: { fireRate: 1, unitsPerShot: 2, aimLimit: 4 } }),
    f.sim,
    rand,
  );
  b.step(input({ firing: true, aimX: 1.5 }), []); // the first press fires at once
  for (let i = 0; i < SIM_HZ / 2; i++) b.step(input(), []); // thumb up
  const shots = player(f.spawns, UnitKind.Mob);
  assert.equal(shots.length, 3);
  assert.equal(shots[0].time, 0);
  assert.ok(Math.abs(shots[1].time - 0.1) < SIM_DT / 2, `second shot at ${shots[1].time}`);
  assert.ok(Math.abs(shots[2].time - 0.2) < SIM_DT / 2, `third shot at ${shots[2].time}`);
  assert.equal(b.stats.mobsFired, 6);
});

test('burst: held fire keeps the fire rate, each release a full burst', () => {
  const f = fakeSim();
  const b = createBattle(
    level({ burst: { shots: 3, gap: 0.05 } }, { cannon: { fireRate: 2, unitsPerShot: 1, aimLimit: 4 } }),
    f.sim,
    rand,
  );
  for (let i = 0; i < 2 * SIM_HZ; i++) b.step(input({ firing: true }), []);
  assert.equal(player(f.spawns, UnitKind.Mob).length, 12); // 4 releases x 3
});

test('startCrowd: the crowd stands in front of the cannon at t = 0', () => {
  const f = fakeSim();
  const b = createBattle(level({ startCrowd: 23, mobHp: 1.5 }), f.sim, rand);
  b.step(input(), []);
  const crowd = player(f.spawns, UnitKind.Mob);
  assert.equal(total(crowd), 23);
  for (const r of crowd) {
    assert.equal(r.time, 0);
    assert.ok(r.z >= LAYOUT.cannonZ + 1 && r.z <= LAYOUT.cannonZ + 5, `z ${r.z}`);
    assert.equal(r.opts?.hp, 1.5);
  }
  for (let i = 0; i < SIM_HZ; i++) b.step(input(), []);
  assert.equal(total(player(f.spawns, UnitKind.Mob)), 23, 'only once');
  assert.equal(b.stats.mobsFired, 0);
});

test('championEcho: a champion launch releases mobs behind it', () => {
  const f = fakeSim();
  const b = createBattle(level({ championEcho: 6 }), f.sim, rand);
  for (let i = 0; i < 2 * SIM_HZ; i++) b.step(input({ firing: true }), []);
  const before = total(player(f.spawns, UnitKind.Mob));
  const events: SimEvent[] = [];
  b.step(input({ championPressed: true }), events);
  assert.equal(events.filter((e) => e.type === 'championLaunched').length, 1);
  const after = player(f.spawns, UnitKind.Mob);
  assert.equal(total(after) - before, 6);
  const echo = after[after.length - 1];
  assert.ok(echo.z < LAYOUT.cannonZ);
  assert.equal(echo.time, player(f.spawns, UnitKind.Champion)[0].time);
});

test('mobHp, mobDamage and shotSpread reach the cannon spawn options', () => {
  const f = fakeSim();
  const b = createBattle(level({ mobHp: 1.25, mobDamage: 2, shotSpread: 0.8 }), f.sim, rand);
  b.step(input({ firing: true }), []);
  assert.deepEqual(player(f.spawns, UnitKind.Mob)[0].opts, { spread: 0.8, hp: 1.25, damage: 2 });
});

test('mobHp survives a gate clone in the real sim', () => {
  const x2: GateDef = { id: 'x2', op: 'mul', value: 2, x: 0, z: 6, width: 8 };
  const lv = level({ mobHp: 2 }, { gates: [x2], lane: { width: 10, length: 200 } });
  let seed = 1;
  const r = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const sim = createSim(lv, r);
  const b = createBattle(lv, sim, r);
  const events: SimEvent[] = [];
  b.step(input({ firing: true }), events);
  for (let i = 0; i < SIM_HZ; i++) b.step(input(), events);
  assert.ok(
    events.some((e) => e.type === 'gate' && e.added === 1),
    'the mob crossed the x2 gate',
  );
  const v = sim.view;
  assert.equal(v.count, 2);
  for (let i = 0; i < v.count; i++) assert.equal(v.hp[i], 2 * v.weight[i]);
});

test('validateLevel accepts mods and rejects bad ones', () => {
  const mods: BattleMods = {
    mobHp: 1.25,
    mobDamage: 1.1,
    knightEvery: 10,
    knight: { hp: 18, damage: 12, radius: 0.6 },
    burst: { shots: 3, gap: 0.12 },
    shotSpread: 0.5,
    startCrowd: 30,
    championEcho: 8,
  };
  assert.deepEqual(validateLevel(level(mods), 'ok').mods, mods);
  assert.equal(validateLevel(level(), 'none').mods, undefined);
  const bad: [BattleMods, RegExp][] = [
    [{ knightEvery: 1 }, /knightEvery/],
    [{ knightEvery: 2.5 }, /knightEvery/],
    [{ burst: { shots: 1.5, gap: 0.1 } }, /burst\.shots/],
    [{ burst: { shots: 0, gap: 0.1 } }, /burst\.shots/],
    [{ mobHp: 0 }, /mobHp/],
    [{ knight: { hp: 5, damage: -1, radius: 0.5 } }, /knight\.damage/],
  ];
  for (const [m, re] of bad) assert.throws(() => validateLevel(level(m), 'bad'), re);
});

test('validateLevel takes up to 32 gates', () => {
  const gates: GateDef[] = Array.from({ length: 32 }, (_, i) => ({
    id: `g${i}`,
    op: 'add',
    value: 1,
    x: 0,
    z: 3 + i * 1.5,
    width: 2,
  }));
  assert.equal(validateLevel(level(undefined, { gates }), 'many').gates.length, 32);
  const tooMany = [...gates, { ...gates[0], id: 'g32' }];
  assert.throws(() => validateLevel(level(undefined, { gates: tooMany }), 'too many'), /at most 32/);
});

test('no mods plays exactly as before mods existed', () => {
  // Recorded from the battle layer before BattleMods (1-6, human attempt 2).
  const lv = getLevelById('1-6')!;
  const r = play(lv, 'human', 2);
  assert.equal(r.outcome, 'victory');
  assert.equal(r.seconds, 92.66666666666269);
  assert.equal(r.fired, 1548);
  assert.equal(r.peak, 459);
  assert.equal(r.playerBase, 157 / 330);
  assert.equal(r.destroyed, 2);
  // An empty mods object is the same as none.
  assert.deepEqual(play({ ...lv, mods: {} }, 'human', 2), r);
});
