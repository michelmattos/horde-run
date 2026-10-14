// Milestone 2 game rules: validation of the new level fields, the Tin General's
// strafing tank and phases, battle stats, the three fixed stars, and the bot's new habits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOSS_AMP_EASE, createBattle } from '../src/game/battle.ts';
import type { BattleSim, BattleStats } from '../src/game/battle.ts';
import { LEVELS, validateLevel } from '../src/game/levels.ts';
import { evaluateStars, goalStatus } from '../src/game/stars.ts';
import { createAutoplay } from '../src/game/autoplay.ts';
import { createSim } from '../src/sim/index.ts';
import { LAYOUT, SIM_DT, SIM_HZ, Team } from '../src/contracts.ts';
import type { BattleState, BossDef, InputState, LevelDef, SimEvent, SimView, UnitKind } from '../src/contracts.ts';

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

interface SpawnRec {
  team: Team;
  kind: UnitKind;
  x: number;
  count: number;
}

// Fake sim that records spawns and base x, and plays scripted events on the next step.
function fakeSim() {
  const spawns: SpawnRec[] = [];
  const baseXs: number[] = [];
  const pending: SimEvent[] = [];
  let time = 0;
  const sim: BattleSim = {
    view: emptyView,
    get time() {
      return time;
    },
    spawn(team, kind, x, _z, count) {
      spawns.push({ team, kind, x, count });
    },
    step(dt, events) {
      time += dt;
      for (const e of pending) events.push(e);
      pending.length = 0;
    },
    totals() {
      return { player: 0, enemy: 0 };
    },
    setEnemyBaseX(x) {
      baseXs.push(x);
    },
  };
  const push = (e: SimEvent) => pending.push(e);
  return { sim, spawns, baseXs, push };
}

const BOSS: BossDef = {
  name: 'Tin General',
  phases: [
    { belowHp: 0.25, strafe: { amplitude: 2, period: 3 }, summon: 7, trickle: 20 },
    { belowHp: 1, strafe: { amplitude: 1, period: 6 } },
    { belowHp: 0.6, strafe: { amplitude: 1.5, period: 4 }, summon: 5 },
  ], // deliberately unsorted: the battle sorts by threshold
};

function level(over: Partial<LevelDef> = {}): LevelDef {
  return {
    id: 'test',
    name: 'Test',
    lane: { width: 10, length: 60 },
    cannon: { fireRate: 6, unitsPerShot: 3, aimLimit: 4 },
    playerBase: { hp: 100 },
    enemyBase: { hp: 1000, x: 0, width: 5 },
    gates: [],
    enemyWaves: [],
    champion: { chargeNeeded: 30, hp: 60, damage: 20 },
    ...over,
  };
}

const rand = () => 0.5;
const input = (over: Partial<InputState> = {}): InputState => ({
  aimX: 0,
  firing: false,
  championPressed: false,
  paused: false,
  ...over,
});
const hit = (damage: number): SimEvent => ({ type: 'baseHit', team: Team.Enemy, damage, x: 0, z: 60 });

// ---------- Validation ----------

test('validateLevel rejects bad M2 fields with the file and field named', () => {
  const good = () => JSON.parse(JSON.stringify(LEVELS[8])); // 1-9: walls, towers, moving gate
  const bad = (mutate: (l: any) => void, pattern: RegExp, base = good) => {
    const l = base();
    mutate(l);
    assert.throws(
      () => validateLevel(l, 'bad.json'),
      (e: Error) => /bad\.json/.test(e.message) && pattern.test(e.message),
      String(pattern),
    );
  };
  bad((l) => (l.defenders[1].id = l.defenders[0].id), /defenders\[1\]\.id.*not unique/);
  bad((l) => (l.defenders[0].kind = 'moat'), /defenders\[0\]\.kind/);
  bad((l) => (l.defenders[0].x = 4.5), /defenders\[0\]\.x.*outside the lane/);
  bad((l) => (l.defenders[0].z = 1), /defenders\[0\]\.z/);
  bad((l) => (l.defenders[0].z = l.lane.length), /defenders\[0\]\.z/);
  bad((l) => (l.defenders[0].hp = 0), /defenders\[0\]\.hp/);
  bad((l) => (l.defenders[1].fireRate = -1), /defenders\[1\]\.fireRate/);
  bad((l) => (l.defenders[1].range = 0), /defenders\[1\]\.range/);
  bad((l) => (l.defenders[1].damage = 'lots'), /defenders\[1\]\.damage/);
  bad((l) => (l.defenders[0].range = 5), /defenders\[0\]\.range.*only allowed on towers/);
  bad(
    (l) => (l.defenders = Array.from({ length: 17 }, (_, i) => ({ id: `d${i}`, kind: 'wall', x: 0, z: 20, hp: 5 }))),
    /defenders.*at most 16/,
  );
  bad((l) => (l.gates[0].uses = 0), /gates\[0\]\.uses/);
  bad((l) => (l.gates[0].uses = 2.5), /gates\[0\]\.uses.*integer/);
  bad((l) => (l.targetTime = 0), /targetTime/);
  bad((l) => (l.targetTime = '90'), /targetTime/);
  bad((l) => (l.goals = [{ type: 'noChampion' }]), /goals.*no longer supported/);
  bad((l) => (l.intro = ''), /intro/);

  const boss = () => JSON.parse(JSON.stringify(LEVELS[9]));
  bad((l) => (l.boss.phases = []), /boss\.phases/, boss);
  bad((l) => delete l.boss.name, /boss\.name/, boss);
  bad((l) => (l.boss.phases[0].belowHp = 0.9), /boss\.phases\[0\]\.belowHp.*must be 1/, boss);
  bad((l) => (l.boss.phases[2].belowHp = 0.7), /boss\.phases\[2\]\.belowHp.*strictly below/, boss);
  bad((l) => (l.boss.phases[1].strafe.period = 0), /boss\.phases\[1\]\.strafe\.period/, boss);
  bad((l) => (l.boss.phases[1].summon = 2.5), /boss\.phases\[1\]\.summon/, boss);
  bad((l) => (l.boss.phases[2].strafe.amplitude = 3), /boss\.phases.*outside the lane/, boss);
  bad((l) => (l.enemyBase.x = 1), /boss\.phases.*outside the lane/, boss);
});

test('validateLevel: targetTime is optional on a non-shipped level', () => {
  const l = JSON.parse(JSON.stringify(LEVELS[0]));
  delete l.targetTime;
  assert.equal(validateLevel(l, 'custom.json').targetTime, undefined);
});

// ---------- Boss ----------

test('boss phases switch by base HP, emit bossPhase once each and summon at the base', () => {
  const f = fakeSim();
  const b = createBattle(level({ boss: BOSS }), f.sim, rand);
  const events: SimEvent[] = [];
  b.step(input(), events);
  assert.equal(b.state.bossPhase, 0);
  f.push(hit(399)); // 60.1 %
  b.step(input(), events);
  assert.equal(b.state.bossPhase, 0);
  f.push(hit(2)); // 59.9 %
  b.step(input(), events);
  assert.equal(b.state.bossPhase, 1);
  let phaseEv = events.filter((e) => e.type === 'bossPhase');
  assert.equal(phaseEv.length, 1);
  assert.equal(phaseEv[0].type === 'bossPhase' && phaseEv[0].phase, 1);
  assert.equal(phaseEv[0].type === 'bossPhase' && phaseEv[0].z, 60);
  const summoned = f.spawns.filter((s) => s.team === Team.Enemy);
  assert.equal(summoned.length, 5);
  const bx = b.state.enemyBaseX!;
  for (const s of summoned) assert.ok(Math.abs(s.x - bx) <= 2.5 + 1e-9);

  f.push(hit(500)); // 9.9 %
  b.step(input(), events);
  assert.equal(b.state.bossPhase, 2);
  phaseEv = events.filter((e) => e.type === 'bossPhase');
  assert.deepEqual(
    phaseEv.map((e) => e.type === 'bossPhase' && e.phase),
    [1, 2],
  );
  assert.equal(f.spawns.filter((s) => s.team === Team.Enemy).length, 12);
  f.push(hit(10));
  b.step(input(), events);
  assert.equal(events.filter((e) => e.type === 'bossPhase').length, 2, 'no repeat events');
});

test('a big hit can skip phases; each skipped phase still fires its event', () => {
  const f = fakeSim();
  const b = createBattle(level({ boss: BOSS }), f.sim, rand);
  const events: SimEvent[] = [];
  f.push(hit(800));
  b.step(input(), events);
  assert.deepEqual(
    events.filter((e) => e.type === 'bossPhase').map((e) => e.type === 'bossPhase' && e.phase),
    [1, 2],
  );
});

test('the killing blow does not start a new phase', () => {
  const f = fakeSim();
  const b = createBattle(level({ boss: BOSS }), f.sim, rand);
  const events: SimEvent[] = [];
  f.push(hit(5000));
  b.step(input(), events);
  assert.equal(b.state.outcome, 'victory');
  assert.equal(events.filter((e) => e.type === 'bossPhase').length, 0);
});

test('the boss base strafes continuously: no jumps, even across phase changes', () => {
  const f = fakeSim();
  const b = createBattle(level({ boss: BOSS }), f.sim, rand);
  const maxAmp = 2;
  const maxSpeed = (2 * Math.PI * maxAmp) / 3; // fastest phase: amplitude 2, period 3
  const ampStep = (maxAmp / BOSS_AMP_EASE) * SIM_DT;
  let prev = b.state.enemyBaseX!;
  assert.equal(prev, 0);
  let minX = 0;
  let maxX = 0;
  for (let s = 0; s < 40 * SIM_HZ; s++) {
    if (s === 7 * SIM_HZ) f.push(hit(450));
    if (s === 13 * SIM_HZ) f.push(hit(400));
    b.step(input(), []);
    const x = b.state.enemyBaseX!;
    assert.ok(Math.abs(x - prev) <= maxSpeed * SIM_DT + ampStep + 1e-9, `jump ${Math.abs(x - prev)} at step ${s}`);
    assert.equal(f.baseXs[f.baseXs.length - 1], x, 'the sim is told the same x before it steps');
    prev = x;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
  }
  assert.ok(maxX > 1.9 && minX < -1.9, `late phase reaches its amplitude (${minX}..${maxX})`);
  assert.ok(maxX <= 2 + 1e-9 && minX >= -2 - 1e-9);
});

test('phase 1 strafes with its own amplitude and period', () => {
  const f = fakeSim();
  const b = createBattle(level({ boss: BOSS }), f.sim, rand);
  for (let s = 0; s < 1.5 * SIM_HZ; s++) b.step(input(), []); // a quarter of the 6 s period
  assert.ok(Math.abs(b.state.enemyBaseX! - 1) < 1e-6, `x=${b.state.enemyBaseX}`);
});

test('the trickle comes from the moving base and switches to the phase rate', () => {
  const f = fakeSim();
  const b = createBattle(level({ boss: BOSS, enemySpawnRate: { perSecond: 4, startAt: 0 } }), f.sim, () => 0.999);
  for (let s = 0; s < 5 * SIM_HZ; s++) b.step(input(), []);
  assert.equal(f.spawns.filter((s) => s.team === Team.Enemy).length, 20);
  f.push(hit(800)); // into phase 2: summons 5 + 7, then 20/s
  b.step(input(), []);
  const before = f.spawns.filter((s) => s.team === Team.Enemy).length;
  for (let s = 0; s < 2 * SIM_HZ; s++) b.step(input(), []);
  const after = f.spawns.filter((s) => s.team === Team.Enemy).length;
  assert.ok(Math.abs(after - before - 40) <= 1, `${after - before} in 2 s`);
});

test('normal levels keep a static base x and never call setEnemyBaseX', () => {
  const f = fakeSim();
  const b = createBattle(level({ enemyBase: { hp: 100, x: 1.5, width: 4 } }), f.sim, rand);
  for (let s = 0; s < 60; s++) b.step(input(), []);
  assert.equal(b.state.enemyBaseX, 1.5);
  assert.equal(b.state.bossPhase, undefined);
  assert.equal(f.baseXs.length, 0);
});

test('a boss battle runs with the real sim (misses do no damage)', () => {
  const lv = level({ boss: { name: 'K', phases: [{ belowHp: 1, strafe: { amplitude: 2.5, period: 4 } }] } });
  const sim = createSim(lv, rand);
  const b = createBattle(lv, sim, rand);
  const events: SimEvent[] = [];
  for (let s = 0; s < 20 * SIM_HZ; s++) b.step(input({ aimX: -4, firing: true }), events);
  assert.ok(events.some((e) => e.type === 'baseMiss'));
  const dmg = events.reduce((t, e) => t + (e.type === 'baseHit' && e.team === Team.Enemy ? e.damage : 0), 0);
  assert.equal(b.state.enemyBaseHp, 1000 - dmg);
});

// ---------- Stats and stars ----------

test('battle stats count mobs fired, champions and the end time', () => {
  const f = fakeSim();
  const b = createBattle(level(), f.sim, rand);
  for (let s = 0; s < SIM_HZ; s++) b.step(input({ firing: true }), []);
  assert.equal(b.stats.mobsFired, 18);
  for (let s = 0; s < 2 * SIM_HZ; s++) b.step(input({ firing: true }), []);
  b.step(input({ championPressed: true }), []);
  assert.equal(b.stats.championsLaunched, 1);
  assert.equal(b.stats.endTime, undefined);
  f.push(hit(5000));
  b.step(input(), []);
  assert.equal(b.stats.endTime, b.state.time);
  const end = b.stats.endTime;
  for (let s = 0; s < 30; s++) b.step(input({ firing: true }), []);
  assert.equal(b.stats.endTime, end);
});

function st(over: Partial<BattleState> = {}): BattleState {
  return {
    time: 50,
    playerBaseHp: 80,
    playerBaseMaxHp: 100,
    enemyBaseHp: 0,
    enemyBaseMaxHp: 100,
    championCharge: 0,
    playerUnits: 0,
    enemyUnits: 0,
    outcome: 'victory',
    ...over,
  };
}
function stats(over: Partial<BattleStats> = {}): BattleStats {
  return { mobsFired: 500, championsLaunched: 0, ...over };
}

test('evaluateStars: win, base above half health, target time; only on a victory', () => {
  const lv = level({ targetTime: 60 });
  assert.deepEqual(evaluateStars(lv, st(), stats()), [true, true, true]);
  assert.deepEqual(evaluateStars(lv, st({ time: 61 }), stats()), [true, true, false]);
  assert.deepEqual(
    evaluateStars(lv, st({ time: 60 }), stats()),
    [true, true, false],
    'the target must be beaten, not matched',
  );
  assert.deepEqual(
    evaluateStars(lv, st({ time: 61 }), stats({ endTime: 59 })),
    [true, true, true],
    'the victory time counts, not the settle time',
  );
  assert.deepEqual(
    evaluateStars(lv, st({ playerBaseHp: 50 }), stats()),
    [true, false, true],
    'exactly half is not above half',
  );
  assert.deepEqual(evaluateStars(lv, st({ playerBaseHp: 51 }), stats()), [true, true, true]);
  assert.deepEqual(evaluateStars(lv, st({ outcome: 'defeat' }), stats()), [false, false, false]);
  assert.deepEqual(evaluateStars(lv, st({ outcome: 'playing' }), stats()), [false, false, false]);
  // The champion, mobs fired and gates touched no longer matter.
  assert.deepEqual(evaluateStars(lv, st(), stats({ championsLaunched: 3, mobsFired: 99999 })), [true, true, true]);
});

test('a level without a target time: star 3 follows star 1', () => {
  assert.deepEqual(evaluateStars(level(), st({ time: 999 }), stats()), [true, true, true]);
  assert.deepEqual(evaluateStars(level(), st({ outcome: 'defeat' }), stats()), [false, false, false]);
  assert.deepEqual(goalStatus(level(), st({ outcome: 'playing' }), stats()), ['pending', 'pending', 'pending']);
});

test('goalStatus is live: pending until decided, failing the moment a star is lost', () => {
  const lv = level({ targetTime: 60 });
  const playing = st({ outcome: 'playing', time: 30 });
  assert.deepEqual(goalStatus(lv, playing, stats()), ['pending', 'pending', 'pending']);
  assert.deepEqual(goalStatus(lv, { ...playing, time: 60 }, stats()), ['pending', 'pending', 'failed']);
  assert.deepEqual(goalStatus(lv, { ...playing, playerBaseHp: 50 }, stats()), ['pending', 'failed', 'pending']);
  assert.deepEqual(goalStatus(lv, st({ time: 40 }), stats()), ['met', 'met', 'met']);
  assert.deepEqual(goalStatus(lv, st({ outcome: 'defeat', time: 40 }), stats()), ['failed', 'failed', 'failed']);
});

// ---------- Autoplay ----------

function botTrace(
  lv: LevelDef,
  steps: number,
  view: { readonly view: SimView; readonly defenders?: any },
  events?: (s: number) => SimEvent[],
) {
  const state = createBattle(lv, fakeSim().sim, rand).state;
  const bot = createAutoplay(lv, { skill: 1 });
  const out: InputState[] = [];
  for (let s = 0; s < steps; s++) out.push(bot(state, view, s * SIM_DT, events?.(s)));
  return out;
}

test('autoplay drops a one-use gate once it breaks', () => {
  const lv = level({
    gates: [
      { id: 'brittle', op: 'mul', value: 3, x: -2.5, z: 20, width: 3, uses: 10 },
      { id: 'solid', op: 'mul', value: 2, x: 2.5, z: 20, width: 3 },
    ],
  });
  const trace = botTrace(lv, 8 * SIM_HZ, { view: emptyView }, (s) =>
    s === 4 * SIM_HZ ? [{ type: 'gateBroken', gateId: 'brittle', x: -2.5, z: 20 }] : [],
  );
  assert.ok(trace[4 * SIM_HZ - 1].aimX <= -1.4, 'aims at the x3 while it stands');
  assert.ok(trace[trace.length - 1].aimX >= 1.4, 'switches to the x2 after it breaks');
});

test('autoplay avoids a wall on the line and aims the champion at it', () => {
  const lv = level({
    gates: [
      { id: 'a', op: 'mul', value: 2, x: -2.5, z: 30, width: 3 },
      { id: 'b', op: 'mul', value: 2, x: 2.5, z: 30, width: 3 },
    ],
    defenders: [{ id: 'w', kind: 'wall', x: -2.5, z: 20, hp: 100, width: 4 }],
  });
  const trace = botTrace(lv, 4 * SIM_HZ, { view: emptyView });
  assert.ok(trace[trace.length - 1].aimX >= 1.4, 'goes round the wall');
  assert.ok(trace.every((i) => !i.championPressed));

  const state = createBattle(lv, fakeSim().sim, rand).state;
  state.championCharge = 1;
  const bot = createAutoplay(lv, { skill: 1 });
  let launchedAt = NaN;
  for (let s = 0; s < 4 * SIM_HZ && Number.isNaN(launchedAt); s++) {
    const i = bot(state, { view: emptyView }, s * SIM_DT);
    if (i.championPressed) launchedAt = i.aimX;
  }
  assert.ok(Math.abs(launchedAt + 2.5) <= 1.3, `champion launched at x=${launchedAt}`);
});

test('autoplay leads the strafing base', () => {
  const lv = level({ boss: { name: 'K', phases: [{ belowHp: 1, strafe: { amplitude: 2, period: 8 } }] } });
  const f = fakeSim();
  const b = createBattle(lv, f.sim, rand);
  const bot = createAutoplay(lv, { skill: 1 });
  // Base at x = 0 moving right; mobs need ~8.4 s to arrive, about a full period ahead.
  let aim = 0;
  for (let s = 0; s < 3 * SIM_HZ; s++) {
    b.step(input(), []);
    aim = bot(b.state, { view: emptyView }, s * SIM_DT).aimX;
  }
  const travel = (lv.lane.length - LAYOUT.cannonZ) / 7;
  const predicted = 2 * Math.sin((2 * Math.PI * (3 + travel)) / 8);
  assert.ok(Math.abs(aim - predicted) <= lv.enemyBase.width / 2 - 0.5, `aim ${aim} vs predicted ${predicted}`);
});

test('autoplay keeps its 3-argument call working and stays deterministic', () => {
  const lv = LEVELS[8];
  const a = botTrace(lv, 5 * SIM_HZ, { view: emptyView });
  const b = botTrace(lv, 5 * SIM_HZ, { view: emptyView });
  assert.deepEqual(a, b);
  assert.ok(a.every((i) => i.firing));
});
