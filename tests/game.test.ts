// Battle rules against a fake sim: spawns are recorded and base hits are scripted,
// so every rule (fire rate, charge, waves, outcomes) is checked in isolation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattle } from '../src/game/battle.ts';
import type { BattleSim } from '../src/game/battle.ts';
import { LEVELS, WORLDS, getLevel, getLevelById, getWorld, levelCount, levelIndexById, validateLevel, validateWorld } from '../src/game/levels.ts';
import { createAutoplay } from '../src/game/autoplay.ts';
import { LAYOUT, SIM_DT, SIM_HZ, Team, UnitKind } from '../src/contracts.ts';
import type { InputState, LevelDef, SimEvent, SimView } from '../src/contracts.ts';

interface SpawnRec {
  team: Team;
  kind: UnitKind;
  x: number;
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

function fakeSim() {
  const spawns: SpawnRec[] = [];
  const pending: SimEvent[] = []; // pushed on the next step
  let time = 0;
  const sim: BattleSim = {
    view: emptyView,
    get time() {
      return time;
    },
    spawn(team, kind, x, z, count, opts) {
      spawns.push({ team, kind, x, z, count, time, opts });
    },
    step(dt, events) {
      time += dt;
      for (const e of pending) events.push(e);
      pending.length = 0;
    },
    totals() {
      return { player: 7, enemy: 3 };
    },
  };
  const hitBase = (team: Team, damage: number) => pending.push({ type: 'baseHit', team, damage, x: 0, z: 0 });
  return { sim, spawns, hitBase };
}

function baseLevel(over: Partial<LevelDef> = {}): LevelDef {
  return {
    id: 'test',
    name: 'Test',
    lane: { width: 10, length: 60 },
    cannon: { fireRate: 8, unitsPerShot: 1, aimLimit: 4 },
    playerBase: { hp: 100 },
    enemyBase: { hp: 150, x: 0, width: 6 },
    gates: [],
    enemyWaves: [],
    champion: { chargeNeeded: 10, hp: 50, damage: 30 },
    ...over,
  };
}

const rand = () => 0.5;
const input = (over: Partial<InputState> = {}): InputState => ({ aimX: 0, firing: false, championPressed: false, paused: false, ...over });

function run(b: ReturnType<typeof createBattle>, steps: number, inp: InputState, events: SimEvent[] = []): SimEvent[] {
  for (let i = 0; i < steps; i++) b.step(inp, events);
  return events;
}

const playerMobs = (s: SpawnRec[]) => s.filter((r) => r.team === Team.Player && r.kind === UnitKind.Mob);
const enemyMobs = (s: SpawnRec[]) => s.filter((r) => r.team === Team.Enemy);

test('fire rate is exact: 2 s held at 8 shots/s gives 16 shots', () => {
  const f = fakeSim();
  const b = createBattle(baseLevel(), f.sim, rand);
  run(b, 2 * SIM_HZ, input({ firing: true }));
  const shots = playerMobs(f.spawns);
  assert.equal(shots.length, 16);
  for (const s of shots) {
    assert.equal(s.z, LAYOUT.cannonZ);
    assert.equal(s.count, 1);
  }
});

test('fire rate holds over a long hold and tap-spam cannot beat it', () => {
  const f = fakeSim();
  const b = createBattle(baseLevel({ cannon: { fireRate: 7, unitsPerShot: 3, aimLimit: 4 } }), f.sim, rand);
  run(b, 60 * SIM_HZ, input({ firing: true }));
  assert.equal(playerMobs(f.spawns).length, 7 * 60);
  assert.equal(playerMobs(f.spawns)[0].count, 3);

  const g = fakeSim();
  const c = createBattle(baseLevel(), g.sim, rand);
  for (let i = 0; i < 2 * SIM_HZ; i++) c.step(input({ firing: i % 2 === 0 }), []);
  assert.ok(playerMobs(g.spawns).length <= 16);
});

test('not firing gives no spawns', () => {
  const f = fakeSim();
  const b = createBattle(baseLevel(), f.sim, rand);
  run(b, 3 * SIM_HZ, input());
  assert.equal(playerMobs(f.spawns).length, 0);
});

test('aim clamps to the cannon aim limit', () => {
  const f = fakeSim();
  const b = createBattle(baseLevel(), f.sim, rand);
  b.step(input({ aimX: 9, firing: true }), []);
  assert.equal(b.cannonX, 4);
  assert.equal(f.spawns[0].x, 4);
  b.step(input({ aimX: -12 }), []);
  assert.equal(b.cannonX, -4);
  b.step(input({ aimX: 1.25 }), []);
  assert.equal(b.cannonX, 1.25);
});

test('champion charge fills, launches only when full, then resets', () => {
  const f = fakeSim();
  const b = createBattle(baseLevel(), f.sim, rand); // 10 mobs to charge, 8 shots/s
  const events: SimEvent[] = [];
  // 1 s of firing = 8 mobs: not full yet, so a press does nothing.
  run(b, SIM_HZ, input({ firing: true }), events);
  assert.ok(Math.abs(b.state.championCharge - 0.8) < 1e-9);
  b.step(input({ championPressed: true }), events);
  assert.equal(f.spawns.filter((s) => s.kind === UnitKind.Champion).length, 0);

  run(b, SIM_HZ, input({ firing: true }), events);
  assert.equal(b.state.championCharge, 1); // capped
  b.step(input({ aimX: 2, championPressed: true }), events);
  const champs = f.spawns.filter((s) => s.kind === UnitKind.Champion);
  assert.equal(champs.length, 1);
  assert.equal(champs[0].team, Team.Player);
  assert.equal(champs[0].x, 2);
  assert.equal(champs[0].z, LAYOUT.cannonZ);
  assert.deepEqual([champs[0].opts?.hp, champs[0].opts?.damage], [50, 30]);
  assert.equal(b.state.championCharge, 0);

  b.step(input({ championPressed: true }), events);
  const launched = events.filter((e) => e.type === 'championLaunched');
  assert.equal(launched.length, 1);
  assert.deepEqual(launched[0], { type: 'championLaunched', x: 2 });
});

test('waves spawn the right count at the right times', () => {
  const f = fakeSim();
  const level = baseLevel({
    enemyWaves: [
      { at: 1, count: 10, x: 2, spread: 1 },
      { at: 2, count: 5, x: -2, spread: 0, interval: 0.5 },
    ],
  });
  const b = createBattle(level, f.sim, () => 0.99);
  run(b, Math.round(0.9 * SIM_HZ), input());
  assert.equal(enemyMobs(f.spawns).length, 0);
  run(b, Math.round(0.6 * SIM_HZ), input()); // t = 1.5: wave 1 done (10 x 0.05 s)
  assert.equal(enemyMobs(f.spawns).length, 10);
  for (const s of enemyMobs(f.spawns)) {
    assert.equal(s.z, level.lane.length - LAYOUT.enemySpawnInset);
    assert.ok(Math.abs(s.x - 2) <= 1);
  }
  run(b, Math.round(1.1 * SIM_HZ), input()); // t = 2.6: wave 2 spawned at 2.0 and 2.5
  assert.equal(enemyMobs(f.spawns).length, 12);
  run(b, 3 * SIM_HZ, input());
  const w2 = enemyMobs(f.spawns).slice(10);
  assert.equal(w2.length, 5);
  assert.ok(w2.every((s) => s.x === -2));
  for (let i = 1; i < w2.length; i++) assert.ok(Math.abs(w2[i].time - w2[i - 1].time - 0.5) < 1e-6);
});

test('trickle spawns perSecond enemies from startAt across the base width', () => {
  const f = fakeSim();
  let r = 0;
  const level = baseLevel({ enemySpawnRate: { perSecond: 3, startAt: 2 }, enemyBase: { hp: 150, x: 1, width: 4 } });
  const b = createBattle(level, f.sim, () => (r = (r + 0.37) % 1));
  run(b, 2 * SIM_HZ - 1, input());
  assert.equal(enemyMobs(f.spawns).length, 0);
  run(b, 10 * SIM_HZ + 1, input());
  assert.equal(enemyMobs(f.spawns).length, 30);
  for (const s of enemyMobs(f.spawns)) assert.ok(s.x >= -1 && s.x <= 3);
});

test('baseHit reduces the base of the team that owns it, clamped at 0', () => {
  const f = fakeSim();
  const b = createBattle(baseLevel(), f.sim, rand);
  f.hitBase(Team.Enemy, 40);
  b.step(input(), []);
  assert.equal(b.state.enemyBaseHp, 110);
  assert.equal(b.state.playerBaseHp, 100);
  f.hitBase(Team.Player, 25);
  f.hitBase(Team.Player, 5);
  b.step(input(), []);
  assert.equal(b.state.playerBaseHp, 70);
  assert.equal(b.state.time, f.sim.time);
  assert.deepEqual([b.state.playerUnits, b.state.enemyUnits], [7, 3]);
});

test('only events pushed this step count', () => {
  const f = fakeSim();
  const b = createBattle(baseLevel(), f.sim, rand);
  const events: SimEvent[] = [{ type: 'baseHit', team: Team.Enemy, damage: 99, x: 0, z: 0 }];
  b.step(input(), events);
  assert.equal(b.state.enemyBaseHp, 150);
});

test('victory is emitted once, sticky, and stops firing and spawning', () => {
  const f = fakeSim();
  const b = createBattle(baseLevel({ enemySpawnRate: { perSecond: 5, startAt: 0 } }), f.sim, rand);
  const events: SimEvent[] = [];
  f.hitBase(Team.Enemy, 500);
  b.step(input({ firing: true }), events);
  assert.equal(b.state.enemyBaseHp, 0);
  assert.equal(b.state.outcome, 'victory');
  const spawnsAtEnd = f.spawns.length;
  const timeAtEnd = b.state.time;
  f.hitBase(Team.Player, 500);
  run(b, 2 * SIM_HZ, input({ firing: true }), events);
  assert.equal(b.state.outcome, 'victory');
  assert.equal(b.state.playerBaseHp, 100); // base HP frozen after the outcome
  assert.equal(f.spawns.length, spawnsAtEnd);
  assert.ok(b.state.time > timeAtEnd); // sim keeps stepping so the crowd settles
  assert.equal(events.filter((e) => e.type === 'victory').length, 1);
  assert.equal(events.filter((e) => e.type === 'defeat').length, 0);
});

test('defeat is emitted once and sticky', () => {
  const f = fakeSim();
  const b = createBattle(baseLevel(), f.sim, rand);
  const events: SimEvent[] = [];
  f.hitBase(Team.Player, 100);
  b.step(input(), events);
  f.hitBase(Team.Enemy, 1000);
  run(b, 10, input(), events);
  assert.equal(b.state.outcome, 'defeat');
  assert.equal(events.filter((e) => e.type === 'defeat').length, 1);
  assert.equal(events.filter((e) => e.type === 'victory').length, 0);
});

test('paused does nothing', () => {
  const f = fakeSim();
  const b = createBattle(baseLevel({ enemyWaves: [{ at: 0, count: 5, x: 0, spread: 1 }] }), f.sim, rand);
  f.hitBase(Team.Enemy, 10);
  const events = run(b, SIM_HZ, input({ paused: true, firing: true, aimX: 3, championPressed: true }));
  assert.equal(f.spawns.length, 0);
  assert.equal(events.length, 0);
  assert.equal(f.sim.time, 0);
  assert.equal(b.cannonX, 0);
  assert.equal(b.state.enemyBaseHp, 150);
});

test('battles are independent (no module-level state)', () => {
  const a = fakeSim();
  const b = fakeSim();
  const one = createBattle(baseLevel(), a.sim, rand);
  run(one, SIM_HZ, input({ firing: true }));
  const two = createBattle(baseLevel(), b.sim, rand);
  assert.equal(two.state.championCharge, 0);
  assert.notEqual(one.state, two.state);
});

// ---------- Levels ----------

test('all shipped levels validate and form World 1', () => {
  assert.equal(levelCount(), 10);
  assert.deepEqual(
    LEVELS.map((l) => l.id),
    ['1-1', '1-2', '1-3', '1-4', '1-5', '1-6', '1-7', '1-8', '1-9', '1-10'],
  );
  assert.equal(LEVELS[0].name, 'First Charge');
  for (const l of LEVELS) {
    assert.deepEqual(validateLevel(JSON.parse(JSON.stringify(l)), l.id), l);
    assert.equal(l.lane.width, 10);
    assert.equal(l.goals?.length, 2, `${l.id} goals`);
  }
  const gates = LEVELS.flatMap((l) => l.gates);
  assert.ok(gates.some((g) => g.op === 'mul' && g.value === 2));
  assert.ok(gates.some((g) => g.op === 'mul' && g.value === 3));
  assert.ok(gates.some((g) => g.op === 'add'));
  assert.ok(gates.some((g) => g.op === 'sub' || g.op === 'div'));
  assert.ok(gates.some((g) => g.move));
  assert.ok(gates.some((g) => g.uses));
  for (const g of gates) assert.ok(g.width >= 2.5 && g.width <= 4, `${g.id} width`);
  const defenders = LEVELS.flatMap((l) => l.defenders ?? []);
  assert.ok(defenders.some((d) => d.kind === 'tower') && defenders.some((d) => d.kind === 'wall'));
  // Goal variety across the world.
  assert.equal(new Set(LEVELS.flatMap((l) => l.goals!.map((g) => g.type))).size, 5);
  const boss = LEVELS[9].boss;
  assert.ok(boss && boss.name === 'Goblin King' && boss.phases.length === 3);
  assert.ok(LEVELS.slice(0, 9).every((l) => !l.boss));
});

test('the World 1 file lists every level in order and validates', () => {
  assert.equal(WORLDS.length, 1);
  const w = getWorld('w1');
  assert.ok(w);
  assert.deepEqual({ ...w, levels: undefined }, { id: 'w1', name: 'Green Valley', faction: 'Goblins', levels: undefined });
  assert.deepEqual(w.levels, LEVELS.map((l) => l.id));
  assert.equal(getWorld('w9'), undefined);
  const bad = (mutate: (o: any) => void, pattern: RegExp) => {
    const o = JSON.parse(JSON.stringify(w));
    mutate(o);
    assert.throws(() => validateWorld(o, 'w.json'), (e: Error) => /w\.json/.test(e.message) && pattern.test(e.message));
  };
  bad((o) => delete o.faction, /faction/);
  bad((o) => (o.levels = []), /levels/);
  bad((o) => o.levels.push('9-9'), /levels\[10\].*not a shipped level/);
  bad((o) => o.levels.push('1-1'), /levels\[10\].*twice/);
});

test('levels by id', () => {
  assert.equal(getLevelById('1-4'), LEVELS[3]);
  assert.equal(getLevelById('nope'), undefined);
  assert.equal(levelIndexById('1-10'), 9);
  assert.equal(levelIndexById('1-1'), 0);
  assert.equal(levelIndexById('level-01'), -1);
});

test('getLevel wraps safely', () => {
  assert.equal(getLevel(0), LEVELS[0]);
  assert.equal(getLevel(10), LEVELS[0]);
  assert.equal(getLevel(-1), LEVELS[9]);
  assert.equal(getLevel(1.7), LEVELS[1]);
  assert.equal(getLevel(Number.NaN), LEVELS[0]);
});

test('validateLevel rejects bad input with a message naming source and field', () => {
  const good = () => JSON.parse(JSON.stringify(LEVELS[2]));
  const bad = (mutate: (l: any) => void, pattern: RegExp) => {
    const l = good();
    mutate(l);
    assert.throws(() => validateLevel(l, 'bad.json'), (e: Error) => /bad\.json/.test(e.message) && pattern.test(e.message));
  };
  assert.throws(() => validateLevel(null, 'x.json'), /x\.json/);
  bad((l) => delete l.name, /name/);
  bad((l) => (l.lane.width = -3), /lane\.width/);
  bad((l) => (l.cannon.fireRate = 0), /cannon\.fireRate/);
  bad((l) => (l.enemyBase.hp = 'lots'), /enemyBase\.hp/);
  bad((l) => (l.gates[0].op = 'pow'), /gates\[0\]\.op/);
  bad((l) => (l.gates[0].value = 0.5), /gates\[0\]\.value/);
  bad((l) => (l.gates[0].x = 4.5), /gates\[0\]\.x/);
  bad((l) => (l.gates[0].z = 1), /gates\[0\]\.z/);
  bad((l) => (l.gates[0].z = l.lane.length + 1), /gates\[0\]\.z/);
  bad((l) => (l.gates[1].id = l.gates[0].id), /gates\[1\]\.id.*not unique/);
  bad((l) => (l.gates[0].move = { amplitude: 3, period: 4 }), /gates\[0\]\.x/);
  bad((l) => (l.gates = Array.from({ length: 33 }, (_, i) => ({ ...l.gates[0], id: `g${i}`, x: 0 }))), /gates.*at most 32/);
  bad((l) => (l.enemyWaves[0].count = -1), /enemyWaves\[0\]\.count/);
  bad((l) => (l.champion = undefined), /champion/);
});

// ---------- Autoplay ----------

test('autoplay fires, aims at the good gate, avoids the trap and is deterministic', () => {
  const level = baseLevel({
    gates: [
      { id: 'good', op: 'mul', value: 3, x: -2.5, z: 20, width: 3 },
      { id: 'trap', op: 'div', value: 2, x: 2.5, z: 20, width: 3 },
    ],
  });
  const state = createBattle(level, fakeSim().sim, rand).state;
  const sim = { view: emptyView };
  const trace = (skill: number) => {
    const bot = createAutoplay(level, { skill });
    const out: InputState[] = [];
    for (let i = 0; i < 6 * SIM_HZ; i++) out.push(bot(state, sim, i * SIM_DT));
    return out;
  };
  const a = trace(1);
  assert.ok(a.every((i) => i.firing && !i.paused));
  const end = a[a.length - 1].aimX;
  assert.ok(end >= -4 && end <= -1.4, `aim ${end} should sit inside the x3 gate`); // and away from the ÷2
  assert.deepEqual(trace(0.7), trace(0.7));

  state.championCharge = 1;
  assert.equal(createAutoplay(level)(state, sim, 0).championPressed, true);
  state.championCharge = 0.5;
  assert.equal(createAutoplay(level)(state, sim, 0).championPressed, false);
});
