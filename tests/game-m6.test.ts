// Milestone 6 (World 3, Clockwork Workshop) game rules: validation of the workshop fields,
// World 3 and its levels, wind-up robots, archers and the Wind-up Robot champion, Gear Gun
// and Bank Shot ricochets, the Jack-in-the-Box's telegraphed gate shuffles, the World 3
// gear in the catalog, and the bot's World 3 habits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENEMY_UNIT_STATS, WORLD3, createBattle } from '../src/game/battle.ts';
import type { BattleCue, BattleInput, BattleSim, BattleSpawnOpts } from '../src/game/battle.ts';
import {
  LEVELS,
  WORLDS,
  getLevel,
  getLevelById,
  levelIndexById,
  validateLevel,
  validateWorld,
} from '../src/game/levels.ts';
import { createAutoplay } from '../src/game/autoplay.ts';
import { cardsClash } from '../src/game/gateSpacing.ts';
import { DEFAULT_BATTLE_LOADOUT } from '../src/game/loadout.ts';
import type { BattleLoadout } from '../src/game/loadout.ts';
import { createSim } from '../src/sim/index.ts';
import {
  getItem,
  itemStats,
  resolveLoadout,
  emptyProfile,
  STARTER_LOADOUT,
  unlockHint,
} from '../src/progression/index.ts';
import { SIM_DT, SIM_HZ, Team, UNIT_VARIANT, UnitKind } from '../src/contracts.ts';
import type { BattleState, DefenderView, LevelDef, SimEvent, SimView } from '../src/contracts.ts';

function view(units: { x: number; z: number; team: Team; w?: number }[] = []): SimView {
  const n = units.length;
  return {
    count: n,
    posX: new Float32Array(units.map((u) => u.x)),
    posZ: new Float32Array(units.map((u) => u.z)),
    team: new Uint8Array(units.map((u) => u.team)),
    kind: new Uint8Array(n),
    weight: new Uint16Array(units.map((u) => u.w ?? 1)),
    radius: new Float32Array(n).fill(0.28),
    hp: new Float32Array(units.map((u) => u.w ?? 1)),
  };
}

interface Spawn {
  team: Team;
  kind: UnitKind;
  x: number;
  z: number;
  count: number;
  opts?: BattleSpawnOpts;
}

// Fake sim recording spawns and the Milestone 6 gate calls; gateSpot follows moveGate.
function fakeSim(gateCount = 0, defenders?: DefenderView[]) {
  const spawns: Spawn[] = [];
  const moves: { index: number; x: number; z: number; seconds: number }[] = [];
  const spots = Array.from({ length: gateCount }, () => ({ x: 0, z: 0 }));
  let time = 0;
  const sim: BattleSim = {
    view: view(),
    get time() {
      return time;
    },
    spawn(team, kind, x, z, count, opts) {
      spawns.push({ team, kind, x, z, count, opts });
    },
    step(dt) {
      time += dt;
    },
    totals: () => ({ player: 0, enemy: 0 }),
    defenders,
    moveGate(index, x, z, seconds) {
      moves.push({ index, x, z, seconds });
      spots[index] = { x, z };
    },
    gateSpot(index, out) {
      out.x = spots[index].x;
      out.z = spots[index].z;
    },
    gateLifted: () => false,
  };
  return { sim, spawns, moves, spots };
}

function level(over: Partial<LevelDef> = {}): LevelDef {
  return {
    id: 'test',
    name: 'Test',
    theme: 'workshop',
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
const playing = (): BattleState => ({
  time: 0,
  playerBaseHp: 1,
  playerBaseMaxHp: 1,
  enemyBaseHp: 1,
  enemyBaseMaxHp: 1,
  championCharge: 0,
  playerUnits: 0,
  enemyUnits: 0,
  outcome: 'playing',
});

// ---------- Validation ----------

const base = (): Record<string, unknown> => JSON.parse(JSON.stringify(level()));
const gate = (o: Record<string, unknown>) => ({ id: 'g', op: 'mul', value: 2, x: 0, z: 20, width: 3, ...o });

test('validation copies every World 3 field', () => {
  const raw = {
    ...base(),
    gates: [gate({ toggle: { on: 3, off: 1.5, offset: 1, alt: { op: 'sub', value: 8 } } })],
    enemyWaves: [{ at: 1, count: 4, x: 0, spread: 1, unit: 'robot' }],
    conveyors: [{ id: 'c', x: 0, z: 8, width: 10, length: 5, vx: 2, vz: 0, flip: 5 }],
    turntables: [{ id: 't', x: 0, z: 30, radius: 3, spin: -0.8, flip: 6 }],
    saws: [
      { id: 's', x: -3, z: 40, radius: 1, bite: 30, path: { dx: 6, dz: 0, period: 7 } },
      { id: 's2', x: 0, z: 45, radius: 1, cycle: { on: 2, off: 2 } },
    ],
    defenders: [{ id: 'sh', kind: 'shield', x: 2, z: 25, hp: 150 }],
    trickleMix: { unit: 'robot', every: 8 },
    mods: { beltGrip: 0.5, sawGuard: 0.75, shieldBreak: 0.5, ricochetEvery: 4 },
    boss: {
      name: 'Jack',
      model: 'jackInTheBox',
      phases: [{ belowHp: 1, strafe: { amplitude: 1, period: 8 }, shuffle: { every: 15, warn: 2, glide: 1 } }],
    },
  };
  const l = validateLevel(raw, 'w3.json');
  assert.deepEqual(validateLevel(JSON.parse(JSON.stringify(l)), 'again'), l);
  assert.equal(l.theme, 'workshop');
  assert.deepEqual(l.gates[0].toggle, { on: 3, off: 1.5, offset: 1, alt: { op: 'sub', value: 8 } });
  assert.equal(l.enemyWaves[0].unit, 'robot');
  assert.deepEqual(l.conveyors, raw.conveyors);
  assert.deepEqual(l.turntables, raw.turntables);
  assert.deepEqual(l.saws, raw.saws);
  assert.equal(l.defenders?.[0].kind, 'shield');
  assert.deepEqual(l.mods, raw.mods);
  assert.equal(l.boss?.model, 'jackInTheBox');
  assert.deepEqual(l.boss?.phases[0].shuffle, { every: 15, warn: 2, glide: 1 });
});

test('validation rejects broken World 3 data, naming the file and field', () => {
  const bad = (over: Record<string, unknown>, pattern: RegExp) =>
    assert.throws(
      () => validateLevel({ ...base(), ...over }, 'w3.json'),
      (e: Error) => /w3\.json/.test(e.message) && pattern.test(e.message),
      JSON.stringify(over),
    );
  bad({ gates: [gate({ toggle: { on: 0, off: 1 } })] }, /toggle\.on/);
  bad({ gates: [gate({ toggle: { on: 1, off: 1, alt: { op: 'pow', value: 2 } } })] }, /toggle\.alt\.op/);
  bad({ gates: [gate({ toggle: { on: 1, off: 1, alt: { op: 'sub', value: 0 } } })] }, /toggle\.alt\.value/);
  bad({ conveyors: [{ id: 'c', x: 2, z: 8, width: 10, length: 5, vx: 2, vz: 0 }] }, /conveyors\[0\]\.x/);
  bad({ conveyors: [{ id: 'c', x: 0, z: 8, width: 4, length: 5, vx: 0, vz: 0 }] }, /conveyors\[0\]\.vx/);
  bad({ turntables: [{ id: 't', x: 0, z: 30, radius: 3, spin: 0 }] }, /turntables\[0\]\.spin/);
  bad({ saws: [{ id: 's', x: 0, z: 30, radius: 1, path: { dx: 6, dz: 0, period: 0 } }] }, /saws\[0\]\.path\.period/);
  bad({ saws: [{ id: 's', x: 0, z: 30, radius: 1, path: { dx: 6, dz: 0, period: 4 } }] }, /saws\[0\]\.x.*saw/);
  bad({ saws: [{ id: 's', x: 0, z: 30, radius: 1, cycle: { on: 1, off: -1 } }] }, /saws\[0\]\.cycle\.off/);
  bad(
    {
      saws: [
        { id: 's', x: 0, z: 30, radius: 1 },
        { id: 's', x: 0, z: 40, radius: 1 },
      ],
    },
    /saws\[1\]\.id/,
  );
  bad({ defenders: [{ id: 'd', kind: 'shield', x: 0, z: 25, hp: 100, range: 3 }] }, /range.*towers/);
  bad({ enemyWaves: [{ at: 1, count: 4, x: 0, spread: 1, unit: 'gear' }] }, /unit/);
  bad({ mods: { beltGrip: 1.5 } }, /beltGrip/);
  bad({ mods: { ricochetEvery: 1 } }, /ricochetEvery/);
  bad(
    {
      boss: {
        name: 'J',
        phases: [{ belowHp: 1, strafe: { amplitude: 1, period: 8 }, shuffle: { every: 3, warn: 2, glide: 1 } }],
      },
    },
    /shuffle\.every/,
  );
});

test('World 3 ships after World 2: the Workshop, unlocked by 15 World 2 stars, 2-10 leads to 3-1', () => {
  const w = WORLDS[2];
  assert.deepEqual(
    { id: w.id, name: w.name, theme: w.theme, unlock: w.unlock },
    { id: 'w3', name: 'Workshop', theme: 'workshop', unlock: { world: 'w2', stars: 15 } },
  );
  assert.ok(w.faction.length > 0);
  assert.deepEqual(
    w.levels,
    Array.from({ length: 10 }, (_, i) => `3-${i + 1}`),
  );
  for (const id of w.levels) assert.equal(getLevelById(id)?.theme, 'workshop', id);
  assert.equal(getLevel(levelIndexById('2-10') + 1).id, '3-1');
  assert.throws(() => validateWorld({ ...w, theme: 'freezer' }, 'w.json', LEVELS, WORLDS), /theme/);
});

test('World 3 levels introduce one idea at a time, then remix them', () => {
  const lv = (id: string) => getLevelById(id)!;
  const toggles = (l: LevelDef) => l.gates.some((g) => g.toggle);
  const robots = (l: LevelDef) => l.enemyWaves.some((w) => w.unit === 'robot') || l.trickleMix?.unit === 'robot';
  const shields = (l: LevelDef) => (l.defenders ?? []).some((d) => d.kind === 'shield');
  assert.ok(toggles(lv('3-1')) && !lv('3-1').conveyors && !lv('3-1').saws && !robots(lv('3-1')), '3-1: timed gates');
  assert.ok(lv('3-2').conveyors?.length, '3-2: belts');
  assert.ok(robots(lv('3-3')), '3-3: wind-up robots');
  assert.ok(lv('3-4').saws?.length, '3-4: saws');
  assert.ok(lv('3-5').turntables?.length, '3-5: a turntable');
  assert.ok(shields(lv('3-6')), '3-6: shield walls');
  for (const id of ['3-1', '3-2', '3-3', '3-4', '3-5', '3-6']) assert.ok(lv(id).intro, `${id} explains its idea`);
  assert.ok(
    lv('3-7').gates.some((g) => g.toggle?.alt),
    '3-7: timed gates that turn into traps',
  );
  assert.ok(lv('3-8').conveyors?.some((c) => c.flip) && lv('3-8').saws?.some((s) => s.path), '3-8: flips and tracks');
  assert.ok(shields(lv('3-9')) && robots(lv('3-9')), '3-9: shields with robots');
  for (const l of LEVELS.filter((x) => x.id.startsWith('3-'))) {
    assert.ok(l.targetTime && l.intro, `${l.id}: target time and intro`);
    for (const a of l.gates)
      for (const b of l.gates) assert.ok(a === b || !cardsClash(a, b), `${l.id}: ${a.id}/${b.id}`);
  }
});

test('the Jack-in-the-Box: three phases that shuffle faster and faster, one gate width, no forks', () => {
  const l = getLevelById('3-10')!;
  const boss = l.boss!;
  assert.equal(boss.model, 'jackInTheBox');
  assert.equal(boss.phases.length, 3);
  const every = boss.phases.map((ph) => ph.shuffle?.every ?? Infinity);
  assert.ok(every[0] >= 13 && every[0] <= 17, `about every 15 s first (${every[0]})`);
  assert.ok(every[1] < every[0] && every[2] < every[1], 'faster as it cracks');
  assert.ok(
    boss.phases.slice(1).every((ph) => ph.summon),
    'later phases summon',
  );
  assert.equal(new Set(l.gates.map((g) => g.width)).size, 1, 'one width: shuffled cards never cover each other');
  assert.ok(l.gates.every((g) => g.fork === undefined && !g.move));
});

// ---------- Battle rules ----------

test('robots come with their stats and a stop-and-go walk; World 1 mobs as before', () => {
  const f = fakeSim();
  const lv = level({
    enemyWaves: [
      { at: 0, count: 2, x: 0, spread: 0, unit: 'robot', interval: 0 },
      { at: 0, count: 1, x: 0, spread: 0 },
    ],
  });
  const b = createBattle(lv, f.sim, rand);
  b.step(idle, []);
  const robots = f.spawns.filter((s) => s.opts?.variant === UNIT_VARIANT.robot);
  assert.equal(robots.length, 2);
  const r = ENEMY_UNIT_STATS.robot;
  assert.deepEqual(robots[0].opts, {
    hp: r.hp,
    damage: r.damage,
    speed: r.speed,
    radius: r.radius,
    variant: UNIT_VARIANT.robot,
    windup: { run: WORLD3.robotRun, pause: WORLD3.robotPause },
  });
  assert.ok(r.hp >= 2 && r.hp <= 4 && r.damage === 2);
  assert.equal(f.spawns.filter((s) => s.opts === undefined).length, 1, 'the plain mob is spawned without options');
  assert.equal(b.state.shuffle, undefined);
});

const ARCHER = {
  ...DEFAULT_BATTLE_LOADOUT.mobs[0],
  id: 'archer',
  variant: UNIT_VARIANT.archer,
  ranged: { range: 5, every: 1.2, damage: 0.5 },
};
const WINDUP = {
  ...DEFAULT_BATTLE_LOADOUT.champion,
  id: 'windup',
  variant: UNIT_VARIANT.windup,
  gateWalk: { seconds: 4, radius: 1.5 },
};

test('archers shoot (ranged) and the Wind-up Robot walks gates (gateWalk), from the loadout', () => {
  const f = fakeSim();
  const lo: BattleLoadout = {
    ...DEFAULT_BATTLE_LOADOUT,
    mobs: [ARCHER, DEFAULT_BATTLE_LOADOUT.mobs[1]],
    champion: WINDUP,
  };
  const b = createBattle(level(), f.sim, rand, lo);
  b.step({ ...idle, firing: true }, []);
  assert.deepEqual(f.spawns[0].opts?.ranged, ARCHER.ranged);
  assert.equal(f.spawns[0].opts?.variant, UNIT_VARIANT.archer);
  for (let s = 0; s < steps(3); s++) b.step({ ...idle, firing: true }, []);
  b.step({ ...idle, championPressed: true }, []);
  const champ = f.spawns.find((s) => s.opts?.gateWalk);
  assert.ok(champ && champ.kind === UnitKind.Champion);
  assert.equal(champ.opts?.variant, UNIT_VARIANT.windup);
  assert.deepEqual(champ.opts?.gateWalk, WINDUP.gateWalk);
});

test('the Gear Gun ricochets every crowd shot, first toward the far side, then alternating', () => {
  const f = fakeSim();
  const lo: BattleLoadout = { ...DEFAULT_BATTLE_LOADOUT, shot: { kind: 'ricochet', angle: 0.5, bounces: 2 } };
  const b = createBattle(level(), f.sim, rand, lo);
  for (let s = 0; s < steps(1); s++) b.step({ ...idle, aimX: 2, firing: true }, []);
  const mobs = f.spawns.filter((s) => s.kind === UnitKind.Mob);
  assert.ok(mobs.length >= 4);
  const speed = DEFAULT_BATTLE_LOADOUT.mobs[0].speed;
  mobs.forEach((m, k) => {
    assert.deepEqual(m.opts?.bounce, { vx: (k % 2 === 0 ? -1 : 1) * 0.5 * speed, bounces: 2 }, `shot ${k}`);
  });
  // Knights (the mix shot) never ricochet.
  for (let s = 0; s < steps(2); s++) b.step({ ...idle, aimX: 2, firing: true }, []);
  assert.ok(f.spawns.filter((s) => s.kind === UnitKind.Champion).every((s) => s.opts?.bounce === undefined));
});

test('mods.ricochetEvery makes every Nth cannon shot a ricochet, with or without a loadout', () => {
  for (const lo of [undefined, DEFAULT_BATTLE_LOADOUT]) {
    const f = fakeSim();
    const b = createBattle(level({ mods: { ricochetEvery: 3 } }), f.sim, rand, lo);
    for (let s = 0; s < steps(1.5); s++) b.step({ ...idle, aimX: -3, firing: true }, []);
    const shots = f.spawns.filter((s) => s.kind === UnitKind.Mob);
    const rico = shots.map((s) => s.opts?.bounce);
    assert.ok(shots.length >= 6);
    assert.equal(rico[0], undefined);
    assert.equal(rico[1], undefined);
    assert.equal(rico[2]?.bounces, WORLD3.ricochet.bounces);
    assert.ok(rico[2]!.vx > 0, 'the cannon is left: the first ricochet flies right');
    assert.ok(rico[5]!.vx < 0, 'then left');
    assert.equal(rico.filter(Boolean).length, Math.floor(shots.length / 3));
  }
});

test('the Jack-in-the-Box telegraphs, then glides every gate to another gate spot', () => {
  const gates = [
    { id: 'a', op: 'mul' as const, value: 3, x: 0, z: 16, width: 3.2 },
    { id: 'b', op: 'mul' as const, value: 2, x: -2.4, z: 28, width: 3.2 },
    { id: 'c', op: 'add' as const, value: 2, x: 2.4, z: 28, width: 3.2 },
    { id: 'd', op: 'sub' as const, value: 5, x: 0, z: 40, width: 3.2 },
  ];
  const lv = level({
    gates,
    boss: {
      name: 'Jack',
      model: 'jackInTheBox',
      phases: [
        { belowHp: 1, strafe: { amplitude: 0, period: 8 }, shuffle: { every: 10, warn: 2, glide: 1 } },
        { belowHp: 0.5, strafe: { amplitude: 0, period: 8 }, summon: 4, shuffle: { every: 6, warn: 1.5, glide: 1 } },
      ],
    },
  });
  const f = fakeSim(gates.length);
  gates.forEach((g, i) => (f.spots[i] = { x: g.x, z: g.z }));
  let r = 0.37;
  const b = createBattle(lv, f.sim, () => (r = (r * 9301 + 0.49297) % 1));
  const cues: BattleCue[] = [];
  const warnAt: number[] = [];
  for (let s = 0; s < steps(10.5); s++) {
    cues.length = 0;
    b.step(idle, [], cues);
    if (cues.some((c) => c.type === 'shuffleWarn')) warnAt.push(s * SIM_DT);
    if (s === steps(9)) assert.ok(b.state.shuffle!.warn > 0.4 && b.state.shuffle!.warn < 0.6, 'halfway telegraph');
    if (cues.some((c) => c.type === 'shuffle')) {
      assert.ok(Math.abs(s * SIM_DT - 10) < 0.02, 'moves after `every` s');
      assert.deepEqual(
        cues.find((c) => c.type === 'shuffle'),
        { type: 'shuffle', glide: 1 },
      );
    }
  }
  assert.equal(warnAt.length, 1);
  assert.ok(Math.abs(warnAt[0] - 8) < 0.02, `telegraph starts warn s early (${warnAt[0]})`);
  assert.equal(f.moves.length, 4);
  const before = gates.map((g) => `${g.x},${g.z}`);
  const after = f.moves.map((m) => `${m.x},${m.z}`);
  assert.deepEqual(after.slice().sort(), before.slice().sort(), 'a permutation of the spots');
  assert.ok(
    f.moves.every((m, i) => after[i] !== before[m.index]),
    'no gate stays put',
  );
  assert.ok(f.moves.every((m) => m.seconds === 1));
  assert.equal(b.state.shuffle!.active, true, 'gliding');
  for (let s = 0; s < steps(1); s++) b.step(idle, []);
  assert.equal(b.state.shuffle!.active, false);
  assert.equal(b.state.shuffle!.warn, 0);
});

test('a Jack-in-the-Box phase summons wind-up robots and restarts the shuffle clock', () => {
  const lv = level({
    gates: [
      { id: 'a', op: 'mul', value: 2, x: -2, z: 20, width: 3 },
      { id: 'b', op: 'mul', value: 3, x: 2, z: 20, width: 3 },
    ],
    boss: {
      name: 'Jack',
      model: 'jackInTheBox',
      phases: [
        { belowHp: 1, strafe: { amplitude: 0, period: 8 }, shuffle: { every: 10, warn: 2, glide: 1 } },
        { belowHp: 0.5, strafe: { amplitude: 0, period: 8 }, summon: 4, shuffle: { every: 6, warn: 1.5, glide: 1 } },
      ],
    },
  });
  const f = fakeSim(2);
  const sim: BattleSim = {
    ...f.sim,
    get time() {
      return 0;
    },
    step(_dt, events) {
      if (hit) events.push({ type: 'baseHit', team: Team.Enemy, damage: 600, x: 0, z: 60 });
      hit = false;
    },
  };
  let hit = false;
  const b = createBattle(lv, sim, rand);
  for (let s = 0; s < steps(5); s++) b.step(idle, []);
  hit = true;
  b.step(idle, []);
  assert.equal(b.state.bossPhase, 1);
  const summoned = f.spawns.filter((s) => s.team === Team.Enemy);
  assert.equal(summoned.length, 4);
  assert.ok(summoned.every((s) => s.opts?.variant === UNIT_VARIANT.robot));
  // The first phase would have moved the gates at 10 s; the new phase moves them 6 s in.
  for (let s = 0; s < steps(5.9); s++) b.step(idle, []);
  assert.equal(f.moves.length, 0);
  for (let s = 0; s < steps(0.2); s++) b.step(idle, []);
  assert.equal(f.moves.length, 2);
});

test('a phase change during the shuffle telegraph still moves the gates on cue', () => {
  const lv = level({
    gates: [
      { id: 'a', op: 'mul', value: 2, x: -2, z: 20, width: 3 },
      { id: 'b', op: 'mul', value: 3, x: 2, z: 20, width: 3 },
    ],
    boss: {
      name: 'Jack',
      model: 'jackInTheBox',
      phases: [
        { belowHp: 1, strafe: { amplitude: 0, period: 8 }, shuffle: { every: 10, warn: 2, glide: 1 } },
        { belowHp: 0.5, strafe: { amplitude: 0, period: 8 }, shuffle: { every: 6, warn: 1.5, glide: 1 } },
      ],
    },
  });
  const f = fakeSim(2);
  let hit = false;
  const sim: BattleSim = {
    ...f.sim,
    get time() {
      return 0;
    },
    step(_dt, events) {
      if (hit) events.push({ type: 'baseHit', team: Team.Enemy, damage: 600, x: 0, z: 60 });
      hit = false;
    },
  };
  const b = createBattle(lv, sim, rand);
  for (let s = 0; s < steps(9); s++) b.step(idle, []); // the crank started at 8 s
  hit = true;
  b.step(idle, []);
  assert.equal(b.state.bossPhase, 1);
  for (let s = 0; s < steps(0.9); s++) b.step(idle, []);
  assert.equal(f.moves.length, 0);
  for (let s = 0; s < steps(0.2); s++) b.step(idle, []);
  assert.equal(f.moves.length, 2, 'the telegraphed shuffle lands at 10 s, not 6 s after the phase change');
});

test('a shuffled gate that would not fit a spot is kept inside the lane', () => {
  const gates = [
    { id: 'wide', op: 'mul' as const, value: 3, x: 0, z: 16, width: 4, move: { amplitude: 1, period: 5 } },
    { id: 'side', op: 'mul' as const, value: 2, x: -3.5, z: 30, width: 3 },
  ];
  const lv = level({
    gates,
    boss: {
      name: 'Jack',
      model: 'jackInTheBox',
      phases: [{ belowHp: 1, strafe: { amplitude: 0, period: 8 }, shuffle: { every: 5, warn: 1, glide: 1 } }],
    },
  });
  const f = fakeSim(2);
  gates.forEach((g, i) => (f.spots[i] = { x: g.x, z: g.z }));
  const b = createBattle(lv, f.sim, rand);
  for (let s = 0; s < steps(5.1); s++) b.step(idle, []);
  const wide = f.moves.find((m) => m.index === 0)!;
  assert.equal(wide.z, 30);
  assert.equal(wide.x, -2, 'half lane 5 - half width 2 - sway 1');
});

test('a World 1 level runs exactly as before: same spawns and rand() calls', () => {
  const lv = getLevelById('1-5')!;
  const run = () => {
    let calls = 0;
    const r = () => {
      calls++;
      return 0.31;
    };
    const f = fakeSim();
    const b = createBattle(lv, f.sim, r, DEFAULT_BATTLE_LOADOUT);
    for (let s = 0; s < steps(20); s++) b.step({ ...idle, firing: true }, []);
    return { calls, spawns: f.spawns, shuffle: b.state.shuffle };
  };
  const a = run();
  assert.equal(a.shuffle, undefined);
  assert.ok(a.spawns.every((s) => !s.opts?.bounce && !s.opts?.windup && !s.opts?.gateWalk && !s.opts?.ranged));
  assert.deepEqual(run(), a);
});

// ---------- World 3 gear ----------

test('the World 3 gear is in the catalog with its unlocks and battle stats', () => {
  const gear = getItem('gear-gun');
  assert.ok(gear?.slot === 'cannon');
  assert.deepEqual(gear.unlock, { type: 'level', level: '3-3' });
  assert.ok(gear.tiers.every((t) => t.shot?.kind === 'ricochet' && t.shot.bounces >= 1));
  const archer = getItem('archer');
  assert.ok(archer?.slot === 'mob' && archer.variant === UNIT_VARIANT.archer);
  assert.deepEqual(archer.unlock, { type: 'level', level: '3-5' });
  assert.ok(archer.tiers.every((t) => t.ranged));
  const windup = getItem('windup');
  assert.ok(windup?.slot === 'champion' && windup.variant === UNIT_VARIANT.windup);
  assert.deepEqual(windup.unlock, { type: 'level', level: '3-7' });
  assert.ok(windup.tiers.every((t) => t.gateWalk));
  assert.equal(unlockHint('windup'), 'Clear level 3-7');
  assert.ok(itemStats('gear-gun', 0).some((s) => s.label === 'Ricochet'));
  assert.ok(itemStats('archer', 0).some((s) => s.label === 'Arrows'));
  assert.ok(itemStats('windup', 0).some((s) => s.label === 'Gate walk'));
  // Tier steps stay small (about +4% a tier, like the Milestone 5 rebalance).
  for (const it of [gear, archer, windup]) {
    const a = JSON.stringify(it.tiers[0]);
    assert.notEqual(JSON.stringify(it.tiers[3]), a, `${it.id} improves with tiers`);
  }
  const r = resolveLoadout(getLevelById('3-1')!, {
    ...emptyProfile(),
    loadout: { ...STARTER_LOADOUT, cannon: 'gear-gun', mobs: ['archer', 'knight'], champion: 'windup' },
  });
  assert.deepEqual(r.battle.shot, gear.tiers[0].shot);
  assert.deepEqual(r.battle.mobs[0].ranged, archer.tiers[0].ranged);
  assert.deepEqual(r.battle.champion.gateWalk, windup.tiers[0].gateWalk);
  assert.equal(unlockHint('nope'), '');
});

// ---------- Autoplay ----------

function settle(
  lv: LevelDef,
  seconds = 3,
  sim: Parameters<ReturnType<typeof createAutoplay>>[1] = { view: view() },
  t0 = 0,
) {
  const bot = createAutoplay(lv, { skill: 1 });
  const state = playing();
  let x = 0;
  for (let s = 0; s < steps(seconds); s++) x = bot(state, sim, t0 + s * SIM_DT).aimX;
  return x;
}

test('the bot fires at timed gates that will be open when its stream arrives', () => {
  // Two x2 gates side by side; the left one is shut while the stream would arrive.
  const travel = (30 - 1.5) / 7;
  const lv = (offset: number) =>
    level({
      gates: [
        { id: 'l', op: 'mul', value: 3, x: -2.5, z: 30, width: 3, toggle: { on: 2, off: 2, offset } },
        { id: 'r', op: 'mul', value: 2, x: 2.5, z: 30, width: 3 },
      ],
    });
  // At t = 3 the stream lands at 3 + travel; pick offsets so the left gate is open / shut then.
  const openThen = (((1 - (3 + travel)) % 4) + 4) % 4; // mid-way through its 2 s open
  const shutThen = (openThen + 2) % 4;
  assert.ok(settle(lv(openThen), 3) < -1, 'the x3 will be open: goes left');
  assert.ok(settle(lv(shutThen), 3) > 1, 'the x3 will be shut: takes the x2');
});

test('the bot steers its stream off a saw and rides a belt into a gate', () => {
  const gates = [{ id: 'x3', op: 'mul' as const, value: 3, x: 0, z: 30, width: 2.4 }];
  const sawed = level({ gates, saws: [{ id: 's', x: -1, z: 20, radius: 1 }] });
  const x = settle(sawed);
  assert.ok(x > 0.4, `keeps right of the saw (${x})`);
  // A belt pushing right at 3 u/s for 6 units of lane: aim left of the gate.
  const belted = level({ gates, conveyors: [{ id: 'c', x: 0, z: 10, width: 10, length: 6, vx: 3, vz: 0 }] });
  const y = settle(belted);
  assert.ok(y < -1.5 && y > -3.5, `aims upstream (${y})`);
});

test('the bot re-targets after a shuffle and launches the champion at a shield wall', () => {
  const gates = [
    { id: 'x3', op: 'mul' as const, value: 3, x: -2.5, z: 20, width: 3 },
    { id: 'x2', op: 'mul' as const, value: 2, x: 2.5, z: 20, width: 3 },
  ];
  const lv = level({
    gates,
    boss: {
      name: 'Jack',
      model: 'jackInTheBox',
      phases: [{ belowHp: 1, strafe: { amplitude: 0, period: 8 }, shuffle: { every: 10, warn: 2, glide: 1 } }],
    },
  });
  const spots = gates.map((g) => ({ x: g.x, z: g.z }));
  const sim = {
    view: view(),
    gateSpot: (i: number, out: { x: number; z: number }) => Object.assign(out, spots[i]),
    gateLifted: () => false,
  };
  assert.ok(settle(lv, 3, sim) < -1, 'takes the x3 on the left');
  [spots[0], spots[1]] = [spots[1], spots[0]];
  assert.ok(settle(lv, 3, sim) > 1, 'the x3 moved right: follows it');

  const walled = level({
    gates: [{ id: 'x2', op: 'mul', value: 2, x: 0, z: 15, width: 3 }],
    defenders: [{ id: 'sh', kind: 'shield', x: -2.5, z: 30, hp: 150 }],
  });
  const defenders: DefenderView[] = [
    { id: 'sh', kind: 'shield', x: -2.5, z: 30, width: 4, depth: 0.8, hp: 150, maxHp: 150 },
  ];
  const bot = createAutoplay(walled, { skill: 1 });
  const state = { ...playing(), championCharge: 1 };
  let pressedAt = NaN;
  for (let s = 0; s < steps(3) && Number.isNaN(pressedAt); s++) {
    const input = bot(state, { view: view(), defenders }, s * SIM_DT);
    if (input.championPressed) pressedAt = input.aimX;
  }
  assert.ok(Math.abs(pressedAt + 2.5) <= 1.25, `champion launched at the shield (${pressedAt})`);
});

test('every shipped World 3 level is played by the bot with its hazards live (smoke)', () => {
  for (const lv of LEVELS.filter((l) => l.id.startsWith('3-'))) {
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
