// Milestone 5 (World 2) game rules: level and world validation of the freezer fields,
// enemy unit types, igloos, gusts, the Snow Globe Giant, the Blizzard, Giant riders, the
// Snowball Launcher, championFreeze, and the bot's World 2 habits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENEMY_UNIT_STATS, createBattle } from '../src/game/battle.ts';
import type { BattleCue, BattleInput, BattleSim, BattleSpawnOpts } from '../src/game/battle.ts';
import {
  LEVELS,
  MIN_GUST_WARN,
  WORLDS,
  getLevel,
  levelIndexById,
  validateLevel,
  validateWorld,
} from '../src/game/levels.ts';
import { createAutoplay } from '../src/game/autoplay.ts';
import { DEFAULT_BATTLE_LOADOUT } from '../src/game/loadout.ts';
import type { BattleLoadout } from '../src/game/loadout.ts';
import { createSim } from '../src/sim/index.ts';
import { SIM_DT, SIM_HZ, Team, UNIT_VARIANT, UnitKind } from '../src/contracts.ts';
import type { BattleState, DefenderView, GustDef, LevelDef, SimEvent, SimView } from '../src/contracts.ts';

function view(units: { x: number; z: number; team: Team; w?: number }[] = []): SimView {
  const n = units.length;
  const v = {
    count: n,
    posX: new Float32Array(units.map((u) => u.x)),
    posZ: new Float32Array(units.map((u) => u.z)),
    team: new Uint8Array(units.map((u) => u.team)),
    kind: new Uint8Array(n),
    weight: new Uint16Array(units.map((u) => u.w ?? 1)),
    radius: new Float32Array(n).fill(0.28),
    hp: new Float32Array(units.map((u) => u.w ?? 1)),
  };
  return v;
}

interface Spawn {
  team: Team;
  kind: UnitKind;
  x: number;
  z: number;
  count: number;
  opts?: BattleSpawnOpts;
}

// Fake sim recording spawns and every Milestone 5 call; scripted events play on the next step.
function fakeSim(defenders?: DefenderView[], v: SimView = view()) {
  const spawns: Spawn[] = [];
  const winds: number[] = [];
  const frozenGates: { index: number; seconds: number; hp: number }[] = [];
  const freezes: { team: Team; x: number; z: number; radius: number; seconds: number }[] = [];
  const areas: { team: Team; x: number; z: number; radius: number; max: number }[] = [];
  const pending: SimEvent[] = [];
  let time = 0;
  const sim: BattleSim = {
    view: v,
    get time() {
      return time;
    },
    spawn(team, kind, x, z, count, opts) {
      spawns.push({ team, kind, x, z, count, opts });
    },
    step(dt, events) {
      time += dt;
      for (const e of pending) events.push(e);
      pending.length = 0;
    },
    totals: () => ({ player: 0, enemy: 0 }),
    defenders,
    setWind: (vx) => winds.push(vx),
    freezeGate: (index, seconds, hp) => frozenGates.push({ index, seconds, hp }),
    gateIce: () => 0,
    freezeUnits: (team, x, z, radius, seconds) => {
      freezes.push({ team, x, z, radius, seconds });
      return 0;
    },
    damageArea: (team, x, z, radius, max) => {
      areas.push({ team, x, z, radius, max });
      return 0;
    },
  };
  return { sim, spawns, winds, frozenGates, freezes, areas, push: (e: SimEvent) => pending.push(e) };
}

function level(over: Partial<LevelDef> = {}): LevelDef {
  return {
    id: 'test',
    name: 'Test',
    theme: 'freezer',
    lane: { width: 10, length: 60 },
    cannon: { fireRate: 6, unitsPerShot: 3, aimLimit: 4 },
    playerBase: { hp: 100 },
    enemyBase: { hp: 1000, x: 0, width: 5 },
    gates: [],
    enemyWaves: [],
    champion: { chargeNeeded: 30, hp: 100, damage: 80 },
    ...over,
  };
}

const idle: BattleInput = { aimX: 0, firing: false, championPressed: false, paused: false };
const rand = () => 0.5;
const steps = (seconds: number) => Math.round(seconds * SIM_HZ);

// ---------- Validation ----------

const base = (): Record<string, unknown> => JSON.parse(JSON.stringify(level()));
const gate = (o: Record<string, unknown>) => ({ id: 'g', op: 'mul', value: 2, x: 0, z: 20, width: 3, ...o });

test('validation copies every World 2 field', () => {
  const raw = {
    ...base(),
    gates: [
      gate({ id: 'a', x: -2.5, fork: 'f', freeze: { after: 100, duration: 5, hp: 30 } }),
      gate({ id: 'b', x: 2.5, fork: 'f', op: 'add', value: 3, uses: 200 }),
    ],
    enemyWaves: [{ at: 1, count: 4, x: 0, spread: 1, unit: 'snowman' }],
    ice: [{ x: 0, z: 10, width: 6, length: 8 }],
    iceWalls: [{ id: 'w', x: 0, z: 20, width: 1.2, depth: 3 }],
    gusts: [{ at: 5, warn: 1.5, duration: 2, force: -1.5, every: 10, alternate: true }],
    trickleMix: { unit: 'penguin', every: 4 },
    defenders: [{ id: 'i', kind: 'igloo', x: 2, z: 40, hp: 100, spawn: { unit: 'penguin', every: 5, count: 3 } }],
    boss: {
      name: 'Giant',
      model: 'snowGlobeGiant',
      phases: [
        { belowHp: 1, strafe: { amplitude: 1, period: 8 }, lob: { every: 5, warn: 1.5, radius: 2, damage: 10 } },
        { belowHp: 0.5, strafe: { amplitude: 1, period: 8 }, freezeGates: { duration: 6, hp: 40 } },
        { belowHp: 0.2, strafe: { amplitude: 1, period: 8 }, gusts: { at: 1, warn: 1.2, duration: 2, force: 2 } },
      ],
    },
  };
  const l = validateLevel(raw, 't.json');
  assert.equal(l.theme, 'freezer');
  assert.deepEqual(l.gates[0].freeze, { after: 100, duration: 5, hp: 30 });
  assert.equal(l.gates[1].fork, 'f');
  assert.equal(l.enemyWaves[0].unit, 'snowman');
  assert.deepEqual(l.ice, raw.ice);
  assert.deepEqual(l.iceWalls, raw.iceWalls);
  assert.deepEqual(l.gusts, raw.gusts);
  assert.deepEqual(l.trickleMix, raw.trickleMix);
  assert.deepEqual(l.defenders?.[0].spawn, { unit: 'penguin', every: 5, count: 3 });
  assert.equal(l.boss?.model, 'snowGlobeGiant');
  assert.deepEqual(
    l.boss?.phases.map((p) => [p.lob, p.freezeGates, p.gusts]),
    [
      [{ every: 5, warn: 1.5, radius: 2, damage: 10 }, undefined, undefined],
      [undefined, { duration: 6, hp: 40 }, undefined],
      [undefined, undefined, { at: 1, warn: 1.2, duration: 2, force: 2 }],
    ],
  );
});

test('validation rejects broken World 2 data, naming the file and field', () => {
  const bad = (over: Record<string, unknown>, field: RegExp) =>
    assert.throws(
      () => validateLevel({ ...base(), ...over }, 'bad.json'),
      (e: Error) => {
        assert.match(e.message, /bad\.json/);
        assert.match(e.message, field);
        return true;
      },
    );
  // Fork gates must stand side by side on one line without overlapping.
  bad({ gates: [gate({ id: 'a', x: -1, fork: 'f' }), gate({ id: 'b', x: 1, fork: 'f' })] }, /gates\[1\]\.x.*overlaps/);
  bad({ gates: [gate({ id: 'a', x: -2.5, fork: 'f' }), gate({ id: 'b', x: 2.5, z: 24, fork: 'f' })] }, /gates\[1\]\.z/);
  bad({ gates: [gate({ id: 'a', fork: 'lonely' })] }, /gates\[0\]\.fork/);
  bad({ gates: [gate({ freeze: { after: 0, duration: 5, hp: 30 } })] }, /gates\[0\]\.freeze\.after/);
  bad({ enemyWaves: [{ at: 0, count: 1, x: 0, spread: 0, unit: 'yeti' }] }, /enemyWaves\[0\]\.unit/);
  bad({ gusts: [{ at: 0, warn: 0.5, duration: 2, force: 1 }] }, /gusts\[0\]\.warn/);
  bad({ gusts: [{ at: 0, warn: 2, duration: 2, force: 1, every: 3 }] }, /gusts\[0\]\.every/);
  bad({ gusts: [{ at: 0, warn: 2, duration: 2, force: 0 }] }, /gusts\[0\]\.force/);
  bad({ ice: [{ x: 4, z: 10, width: 4, length: 5 }] }, /ice\[0\]\.x/);
  bad({ iceWalls: [{ id: 'w', x: 0, z: 20, width: 10, depth: 2 }] }, /iceWalls\[0\]\.width/);
  bad({ defenders: [{ id: 'i', kind: 'igloo', x: 0, z: 30, hp: 50 }] }, /defenders\[0\]\.spawn/);
  bad(
    { defenders: [{ id: 'w', kind: 'wall', x: 0, z: 30, hp: 50, spawn: { unit: 'mob', every: 3, count: 1 } }] },
    /defenders\[0\]\.spawn/,
  );
  bad({ trickleMix: { unit: 'penguin', every: 0 } }, /trickleMix\.every/);
  bad(
    { boss: { name: 'B', model: 'yeti', phases: [{ belowHp: 1, strafe: { amplitude: 0, period: 1 } }] } },
    /boss\.model/,
  );
});

test('World 2 ships after World 1: themed, unlocked by World 1 stars, 1-10 leads to 2-1', () => {
  const w2 = WORLDS.find((w) => w.id === 'w2');
  assert.ok(w2);
  assert.equal(w2.theme, 'freezer');
  assert.deepEqual(w2.unlock, { world: 'w1', stars: 15 });
  assert.equal(getLevel(levelIndexById('1-10') + 1).id, '2-1');
  for (const id of w2.levels) assert.equal(LEVELS.find((l) => l.id === id)?.theme, 'freezer', id);
  assert.equal(LEVELS.find((l) => l.id === '2-10')?.boss?.model, 'snowGlobeGiant');
  // A world's unlock must name an earlier world, and its levels must be in its room.
  const w = { id: 'w3', name: 'W', faction: 'F', theme: 'freezer', levels: ['2-1'] };
  assert.throws(() => validateWorld({ ...w, unlock: { world: 'w9', stars: 3 } }, 'w.json', LEVELS, WORLDS), /unlock/);
  assert.throws(() => validateWorld({ ...w, theme: 'bedroom' }, 'w.json'), /theme/);
});

// ---------- Enemy units ----------

test('snowman and penguin waves and the trickle mix spawn with their unit stats; mobs as before', () => {
  const f = fakeSim();
  const b = createBattle(
    level({
      enemyWaves: [
        { at: 0, count: 2, x: 0, spread: 0, interval: 0, unit: 'snowman' },
        { at: 0, count: 1, x: 0, spread: 0 },
      ],
      enemySpawnRate: { perSecond: 10, startAt: 0 },
      trickleMix: { unit: 'penguin', every: 3 },
    }),
    f.sim,
    rand,
  );
  for (let s = 0; s < steps(1); s++) b.step(idle, []);
  const enemy = f.spawns.filter((s) => s.team === Team.Enemy);
  const snow = ENEMY_UNIT_STATS.snowman;
  assert.deepEqual(
    enemy.slice(0, 2).map((s) => s.opts),
    [
      { hp: snow.hp, damage: snow.damage, speed: snow.speed, radius: snow.radius, variant: UNIT_VARIANT.snowman },
      { hp: snow.hp, damage: snow.damage, speed: snow.speed, radius: snow.radius, variant: UNIT_VARIANT.snowman },
    ],
  );
  assert.equal(enemy[2].opts, undefined, 'a plain mob is spawned with no options, exactly as in World 1');
  const trickle = enemy.slice(3).map((s) => s.opts?.variant ?? UNIT_VARIANT.rifleman);
  assert.equal(trickle.length, 10);
  assert.deepEqual(
    trickle,
    trickle.map((_, k) => ((k + 1) % 3 === 0 ? UNIT_VARIANT.penguin : UNIT_VARIANT.rifleman)),
    'every third trickle unit is a penguin',
  );
  assert.equal(ENEMY_UNIT_STATS.snowman.hp, 4, 'a snowman cancels 4 weight');
  assert.ok(ENEMY_UNIT_STATS.penguin.speed > ENEMY_UNIT_STATS.mob.speed);
});

// ---------- Igloos ----------

test('an igloo releases its units at its front until it is destroyed', () => {
  const igloo = { id: 'ig', kind: 'igloo' as const, x: 2, z: 40, width: 3, depth: 1.6, hp: 50, maxHp: 50 };
  const f = fakeSim([igloo]);
  const b = createBattle(
    level({
      defenders: [
        {
          id: 'ig',
          kind: 'igloo',
          x: 2,
          z: 40,
          hp: 50,
          width: 3,
          spawn: { unit: 'penguin', every: 2, count: 3, startAt: 1 },
        },
      ],
    }),
    f.sim,
    rand,
  );
  const cues: BattleCue[] = [];
  for (let s = 0; s < steps(5.5); s++) b.step(idle, [], cues);
  const releases = () => cues.filter((c) => c.type === 'iglooRelease');
  assert.equal(releases().length, 3, 'released at 1, 3 and 5 s');
  assert.deepEqual(releases()[0], { type: 'iglooRelease', id: 'ig', x: 2, z: 40 - 0.8 - 0.4, count: 3 });
  const pengs = f.spawns.filter((s) => s.opts?.variant === UNIT_VARIANT.penguin);
  assert.equal(pengs.length, 9);
  assert.ok(pengs.every((s) => s.z < igloo.z - 0.8 && Math.abs(s.x - igloo.x) <= 1.5));
  igloo.hp = 0; // knocked down
  for (let s = 0; s < steps(10); s++) b.step(idle, [], cues);
  assert.equal(releases().length, 3, 'no release after the igloo fell');
  assert.equal(f.spawns.filter((s) => s.opts?.variant === UNIT_VARIANT.penguin).length, 9);
});

// ---------- Gusts ----------

function gustRun(gusts: GustDef[], seconds: number) {
  const f = fakeSim();
  const b = createBattle(level({ gusts }), f.sim, rand);
  const cues: { t: number; c: BattleCue }[] = [];
  const states: { t: number; g: NonNullable<BattleState['gust']> }[] = [];
  const winds: { t: number; w: number }[] = [];
  for (let s = 0; s < steps(seconds); s++) {
    const out: BattleCue[] = [];
    const before = f.winds.length;
    b.step(idle, [], out);
    const t = s * SIM_DT;
    for (const c of out) cues.push({ t, c });
    for (const w of f.winds.slice(before)) winds.push({ t, w });
    states.push({ t, g: { ...b.state.gust! } });
  }
  return { cues, states, winds };
}

test('a gust is always telegraphed at least 1.2 s before it pushes, then pushes for its duration', () => {
  // warn 0.3 is below the floor (validation rejects it; the battle still enforces it).
  const r = gustRun([{ at: 2, warn: 0.3, duration: 1.5, force: 2, every: 6, alternate: true }], 17);
  const warns = r.cues.filter((x) => x.c.type === 'gustWarn');
  const pushes = r.cues.filter((x) => x.c.type === 'gust');
  assert.equal(warns.length, 3);
  assert.equal(pushes.length, 3);
  for (let k = 0; k < 3; k++) {
    assert.ok(pushes[k].t - warns[k].t >= MIN_GUST_WARN - 1e-9, `gust ${k} telegraphed ${pushes[k].t - warns[k].t} s`);
    const w = warns[k].c;
    const p = pushes[k].c;
    assert.ok(w.type === 'gustWarn' && p.type === 'gust');
    assert.equal(w.dir, p.dir);
    assert.equal(w.dir, k % 2 === 0 ? 1 : -1, 'alternating, starting with the sign of the force');
    assert.equal(p.duration, 1.5);
  }
  // The sim feels wind only while the state says the push is on, and it stops after it.
  assert.deepEqual(
    r.winds.map((x) => x.w),
    [2, 0, -2, 0, 2, 0],
  );
  const active = r.states.filter((x) => x.g.active);
  assert.ok(active.every((x) => x.g.warn === 1));
  const firstPush = r.winds[0].t;
  assert.ok(Math.abs(r.winds[1].t - firstPush - 1.5) < 2 * SIM_DT);
  const telegraph = r.states.filter((x) => !x.g.active && x.g.dir !== 0 && x.t < firstPush);
  assert.ok(telegraph.length >= steps(MIN_GUST_WARN) - 1);
  for (let k = 1; k < telegraph.length; k++) assert.ok(telegraph[k].g.warn >= telegraph[k - 1].g.warn);
  assert.deepEqual(r.states[0].g, { dir: 0, warn: 0, active: false }, 'calm before the first gust');
});

test('levels without gusts leave state.gust unset and never touch the wind', () => {
  const f = fakeSim();
  const b = createBattle(level(), f.sim, rand);
  for (let s = 0; s < steps(3); s++) b.step(idle, []);
  assert.equal(b.state.gust, undefined);
  assert.equal(f.winds.length, 0);
});

// ---------- Snow Globe Giant ----------

const GIANT_BOSS = {
  name: 'Snow Globe Giant',
  model: 'snowGlobeGiant' as const,
  phases: [
    { belowHp: 1, strafe: { amplitude: 1, period: 8 }, lob: { every: 2, warn: 1, radius: 1.5, damage: 12 } },
    { belowHp: 0.6, strafe: { amplitude: 1.5, period: 6 }, freezeGates: { duration: 7, hp: 33 } },
    {
      belowHp: 0.3,
      strafe: { amplitude: 2, period: 5 },
      gusts: { at: 0.5, warn: 1.5, duration: 2, force: 1.5, every: 8 },
    },
  ],
};
const THREE_GATES = [
  { id: 'a', op: 'mul' as const, value: 3, x: 0, z: 16, width: 3 },
  { id: 'b', op: 'mul' as const, value: 2, x: -2, z: 30, width: 3 },
  { id: 'c', op: 'mul' as const, value: 2, x: 2, z: 30, width: 3 },
];

test('the Snow Globe Giant lobs at the densest crowd, then freezes every gate, then adds gusts', () => {
  // A dense knot of player units at (2, 20) and a few strays elsewhere.
  const knot = Array.from({ length: 20 }, (_, k) => ({
    x: 2 + (k % 3) * 0.2,
    z: 20 + (k % 4) * 0.2,
    team: Team.Player,
  }));
  const strays = [
    { x: -4, z: 10, team: Team.Player },
    { x: -3, z: 45, team: Team.Player },
    { x: 0, z: 25, team: Team.Enemy, w: 50 },
  ];
  const f = fakeSim(undefined, view([...knot, ...strays]));
  const b = createBattle(level({ gates: THREE_GATES, boss: GIANT_BOSS }), f.sim, rand);
  const cues: BattleCue[] = [];
  for (let s = 0; s < steps(3.5); s++) b.step(idle, [], cues);
  const lob = cues.find((c) => c.type === 'lob');
  assert.ok(lob && lob.type === 'lob');
  assert.ok(Math.abs(lob.x - 2.2) < 0.3 && Math.abs(lob.z - 20.3) < 0.3, `lob aimed at ${lob.x}, ${lob.z}`);
  assert.equal(lob.flight, 1);
  const hit = cues.find((c) => c.type === 'lobHit');
  assert.deepEqual(hit, { type: 'lobHit', x: lob.x, z: lob.z, radius: 1.5 });
  assert.deepEqual(f.areas[0], { team: Team.Player, x: lob.x, z: lob.z, radius: 1.5, max: 12 });
  assert.equal(f.frozenGates.length, 0, 'phase 1 freezes nothing');

  f.push({ type: 'baseHit', team: Team.Enemy, damage: 450, x: 0, z: 60 }); // to 55%: phase 2
  b.step(idle, [], cues);
  assert.equal(b.state.bossPhase, 1);
  assert.deepEqual(f.frozenGates, [
    { index: 0, seconds: 7, hp: 33 },
    { index: 1, seconds: 7, hp: 33 },
    { index: 2, seconds: 7, hp: 33 },
  ]);
  const lobs = cues.filter((c) => c.type === 'lob').length;
  for (let s = 0; s < steps(4); s++) b.step(idle, [], cues);
  assert.equal(cues.filter((c) => c.type === 'lob').length, lobs, 'phase 2 has no lob');

  f.push({ type: 'baseHit', team: Team.Enemy, damage: 300, x: 0, z: 60 }); // to 25%: phase 3
  b.step(idle, [], cues);
  assert.equal(b.state.bossPhase, 2);
  assert.ok(b.state.gust, 'boss gusts drive state.gust');
  for (let s = 0; s < steps(3.5); s++) b.step(idle, [], cues);
  assert.equal(cues.filter((c) => c.type === 'gustWarn').length, 1);
  assert.equal(cues.filter((c) => c.type === 'gust').length, 1);
  assert.deepEqual(f.winds, [1.5], 'pushing now, gust started 0.5 + 1.5 s into phase 3');
});

// ---------- New gear ----------

const BLIZZARD: BattleLoadout = {
  ...DEFAULT_BATTLE_LOADOUT,
  ultimate: { id: 'blizzard', chargeNeeded: 3, power: 4 },
};

test('Blizzard freezes the whole enemy crowd for its power in seconds and counts it down', () => {
  const f = fakeSim();
  const b = createBattle(level(), f.sim, rand, BLIZZARD);
  const cues: BattleCue[] = [];
  b.step({ ...idle, firing: true }, [], cues); // one shot of 3 fills the meter
  assert.equal(b.state.enemyFrozen, 0);
  b.step({ ...idle, ultimatePressed: true }, [], cues);
  assert.deepEqual(f.freezes, [{ team: Team.Enemy, x: 0, z: 0, radius: Infinity, seconds: 4 }]);
  assert.deepEqual(
    cues.find((c) => c.type === 'ultimate'),
    {
      type: 'ultimate',
      id: 'blizzard',
      x: 0,
      z: 30,
      radius: 10,
      duration: 4,
    },
  );
  assert.ok(Math.abs(b.state.enemyFrozen! - (4 - SIM_DT)) < 1e-9);
  for (let s = 0; s < steps(4); s++) b.step(idle, []);
  assert.equal(b.state.enemyFrozen, 0);
});

test('Blizzard stops enemy base damage for 4 s (real sim)', () => {
  const lv = level({ playerBase: { hp: 1000 } });
  const sim = createSim(lv, rand);
  const b = createBattle(lv, sim, rand, BLIZZARD);
  sim.spawn(Team.Enemy, UnitKind.Mob, 0, 6, 40, { spread: 3 }); // a crowd about to reach the base
  b.step({ ...idle, aimX: 4, firing: true }, []);
  b.step({ ...idle, aimX: 4, ultimatePressed: true }, []);
  const hp0 = b.state.playerBaseHp;
  for (let s = 0; s < steps(3.9); s++) b.step({ ...idle, aimX: 4 }, []);
  assert.equal(b.state.playerBaseHp, hp0, 'frozen enemies never hit the base');
  for (let s = 0; s < steps(3); s++) b.step({ ...idle, aimX: 4 }, []);
  assert.ok(b.state.playerBaseHp < hp0, 'after the thaw they march on and hit it');
});

test('a snowball loadout fires one rolling unit per shot that carries the whole shot', () => {
  const lo: BattleLoadout = { ...DEFAULT_BATTLE_LOADOUT, shot: { kind: 'snowball', burstWeight: 30, maxRadius: 1.2 } };
  const f = fakeSim();
  const b = createBattle(level(), f.sim, rand, lo);
  b.step({ ...idle, firing: true }, []);
  const rolls = f.spawns.filter((s) => s.opts?.roll);
  assert.equal(rolls.length, 1);
  assert.equal(rolls[0].count, 1);
  assert.deepEqual(rolls[0].opts?.roll, { burstWeight: 30, maxRadius: 1.2 });
  assert.equal(rolls[0].opts?.variant, UNIT_VARIANT.snowball);

  // With the real sim the rest of the shot rolls into the ball at once: one unit of weight 3.
  const lv = level();
  const sim = createSim(lv, rand);
  const real = createBattle(lv, sim, rand, lo);
  real.step({ ...idle, firing: true }, []);
  real.step(idle, []);
  const units = [];
  for (let i = 0; i < sim.view.count; i++) if (sim.view.team[i] === Team.Player) units.push(i);
  assert.equal(units.length, 1);
  assert.equal(sim.view.weight[units[0]], 3);
  assert.equal(sim.view.variant[units[0]], UNIT_VARIANT.snowball);
});

test('a Giant in the mix slot carries its riders; championFreeze freezes where the champion meets the enemy', () => {
  const giant = {
    id: 'giant',
    variant: UNIT_VARIANT.giant,
    kind: 'heavy' as const,
    perShot: 1,
    hp: 20,
    damage: 8,
    radius: 0.8,
    speed: 3,
    riders: 6,
  };
  const lo: BattleLoadout = { ...DEFAULT_BATTLE_LOADOUT, mobs: [DEFAULT_BATTLE_LOADOUT.mobs[0], giant], mixEvery: 2 };
  const enemy = [
    { x: 1, z: 30, team: Team.Enemy },
    { x: 1.5, z: 22, team: Team.Enemy },
    { x: -3, z: 12, team: Team.Enemy },
  ];
  const f = fakeSim(undefined, view(enemy));
  const b = createBattle(
    level({ mods: { championFreeze: { radius: 2, seconds: 3 } }, champion: { chargeNeeded: 3, hp: 100, damage: 80 } }),
    f.sim,
    rand,
    lo,
  );
  for (let s = 0; s < steps(1); s++) b.step({ ...idle, aimX: 1, firing: true }, []);
  const giants = f.spawns.filter((s) => s.opts?.variant === UNIT_VARIANT.giant);
  assert.ok(giants.length > 0);
  assert.ok(giants.every((s) => s.kind === UnitKind.Champion && s.opts?.riders === 6));
  b.step({ ...idle, aimX: 1, championPressed: true }, []);
  assert.deepEqual(f.freezes, [{ team: Team.Enemy, x: 1, z: 22, radius: 2, seconds: 3 }]);
});

// ---------- Autoplay ----------

test('the bot avoids a frozen gate unless chipping one is the only way through', () => {
  const state: BattleState = {
    time: 0,
    playerBaseHp: 1,
    playerBaseMaxHp: 1,
    enemyBaseHp: 1,
    enemyBaseMaxHp: 1,
    championCharge: 0,
    playerUnits: 0,
    enemyUnits: 0,
    outcome: 'playing',
  };
  const settle = (lv: LevelDef, ice: number[]) => {
    const bot = createAutoplay(lv, { skill: 1 });
    let x = 0;
    for (let s = 0; s < steps(3); s++) x = bot(state, { view: view(), gateIce: (i) => ice[i] }, s * SIM_DT).aimX;
    return x;
  };
  const apart = level({
    gates: [
      { id: 'x3', op: 'mul', value: 3, x: -2.5, z: 20, width: 3 },
      { id: 'x2', op: 'mul', value: 2, x: 2.5, z: 20, width: 3 },
    ],
  });
  assert.ok(settle(apart, [0, 0]) <= -1.4, 'goes for the x3');
  assert.ok(settle(apart, [30, 0]) >= 1.4, 'the x3 is frozen: takes the x2');
  assert.ok(Math.abs(settle(apart, [30, 30])) < 1, 'both frozen: the open middle beats chipping');
  // Two wide gates close the whole aim range: chipping is the only way, so it chips the x3.
  const wall = level({
    gates: [
      { id: 'x3', op: 'mul', value: 3, x: -2.5, z: 20, width: 5 },
      { id: 'x2', op: 'mul', value: 2, x: 2.5, z: 20, width: 5 },
    ],
  });
  assert.ok(settle(wall, [30, 30]) < -0.1, 'chips the frozen x3 rather than the frozen x2');
  assert.ok(settle(wall, [0, 30]) < -0.4, 'and takes the open x3 when only the x2 is frozen');
});

test('the human bot counter-steers against a gust, late', () => {
  const gates = [{ id: 'x3', op: 'mul' as const, value: 3, x: 0, z: 30, width: 2.4 }];
  const lv = level({ gates, gusts: [{ at: 0, warn: 1.5, duration: 3, force: 1 }] });
  const state: BattleState = {
    time: 0,
    playerBaseHp: 1,
    playerBaseMaxHp: 1,
    enemyBaseHp: 1,
    enemyBaseMaxHp: 1,
    championCharge: 0,
    playerUnits: 0,
    enemyUnits: 0,
    outcome: 'playing',
  };
  // Calm for 1 s, then a 3 s push to the right.
  const trace = (profile: 'human' | 'precise') => {
    const bot = createAutoplay(lv, { profile, skill: 1 });
    const out: number[] = [];
    for (let s = 0; s < steps(4); s++) {
      const on = s >= steps(1);
      state.gust = { dir: on ? 1 : 0, warn: on ? 1 : 0, active: on };
      out.push(bot(state, { view: view() }, s * SIM_DT).aimX);
    }
    return out;
  };
  const precise = trace('precise');
  const human = trace('human');
  // The wind pushes right, so both lean left of the gate...
  assert.ok(precise[steps(2)] < -1, `precise aims ${precise[steps(2)]}`);
  assert.ok(Math.min(...human.slice(steps(1))) < -1, 'the human leans left too');
  // ...but the human only starts its counter-steer a reaction time after the push.
  const start = (xs: number[]) => xs.findIndex((x, s) => s >= steps(1) && x < -0.3);
  assert.ok(start(human) - start(precise) >= steps(0.3), `human starts ${start(human)}, precise ${start(precise)}`);
});

test('every shipped World 2 level is played by the bot with its hazards live (smoke)', () => {
  // One short look at each level: hazards cue, the bot never stops firing, no exceptions.
  for (const lv of LEVELS.filter((l) => l.id.startsWith('2-'))) {
    const sim = createSim(lv, rand);
    const b = createBattle(lv, sim, rand, DEFAULT_BATTLE_LOADOUT);
    const bot = createAutoplay(lv, { profile: 'human', loadout: DEFAULT_BATTLE_LOADOUT });
    const ev: SimEvent[] = [];
    for (let s = 0; s < steps(20); s++) {
      const input = bot(b.state, sim, sim.time, ev, b.ultimateCharge);
      assert.ok(input.firing);
      ev.length = 0;
      b.step(input, ev);
    }
    assert.ok(b.stats.mobsFired > 0, lv.id);
    assert.ok(b.state.time > 19, lv.id);
    assert.ok(Math.abs(b.cannonX) <= lv.cannon.aimLimit, lv.id);
  }
});
