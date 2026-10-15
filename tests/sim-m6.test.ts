// Milestone 6 sim features (World 3, Clockwork Workshop): timed toggling gates, gliding
// gates, conveyors and turntables, saws, shield walls, wind-up robots, archers, Gear Gun
// ricochets and the Wind-up Robot's gate walk, plus determinism and a recorded checksum
// proving a World 1 level still plays bit for bit as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSim, SIM_W3 } from '../src/sim/index.ts';
import type { Sim } from '../src/sim/index.ts';
import { SIM_DT, Team, UnitKind, gateX } from '../src/contracts.ts';
import type { GateDef, LevelDef, SimEvent } from '../src/contracts.ts';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = () => 0.5;

function level(over: Partial<LevelDef> = {}): LevelDef {
  return {
    id: 'm6',
    name: 'M6',
    lane: { width: 10, length: 100 },
    cannon: { fireRate: 6, unitsPerShot: 3, aimLimit: 4 },
    playerBase: { hp: 100 },
    enemyBase: { hp: 100, x: 0, width: 6 },
    gates: [],
    enemyWaves: [],
    champion: { chargeNeeded: 100, hp: 50, damage: 30 },
    ...over,
  };
}

function run(sim: Sim, steps: number, events: SimEvent[] = []): SimEvent[] {
  for (let s = 0; s < steps; s++) sim.step(SIM_DT, events);
  return events;
}

const of = <T extends SimEvent['type']>(events: SimEvent[], type: T) =>
  events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);

// Runs until sim.time reaches t (within one step).
function runTo(sim: Sim, t: number, events: SimEvent[] = []): SimEvent[] {
  while (sim.time < t - 1e-9) sim.step(SIM_DT, events);
  return events;
}

const near = (a: number, b: number, eps: number, what: string) =>
  assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} vs ${b}`);

// ---------- Timed toggling gates ----------

const TOGGLE: GateDef = { id: 't', op: 'add', value: 5, x: 0, z: 10, width: 10, toggle: { on: 1, off: 1 } };

test('sim m6: a toggling gate applies only while open; closed it gives nothing and stays unpassed', () => {
  const open = createSim(level({ gates: [TOGGLE] }), rand);
  open.spawn(Team.Player, UnitKind.Mob, 0, 9.95, 1);
  const ev = run(open, 2);
  assert.equal(open.totals().player, 6, 'open: +5');
  assert.equal(of(ev, 'gate').length, 1);

  const closed = createSim(level({ gates: [TOGGLE] }), rand);
  runTo(closed, 1.2);
  closed.spawn(Team.Player, UnitKind.Mob, 0, 9.95, 1);
  const ev2 = run(closed, 30);
  assert.equal(closed.totals().player, 1, 'closed: nothing');
  assert.equal(of(ev2, 'gate').length, 0);
});

test('sim m6: a closed toggling gate with alt applies the alt, and closed crossings spend no uses', () => {
  const alt: GateDef = { ...TOGGLE, toggle: { on: 1, off: 1, alt: { op: 'mul', value: 3 } } };
  const sim = createSim(level({ gates: [alt] }), rand);
  runTo(sim, 1.2);
  sim.spawn(Team.Player, UnitKind.Mob, 0, 9.95, 1);
  run(sim, 2);
  assert.equal(sim.totals().player, 3, 'alt x3');

  // One-use gate (1 weight): a closed crossing must not break it.
  const oneUse = createSim(level({ gates: [{ ...TOGGLE, uses: 1 }] }), rand);
  runTo(oneUse, 1.2);
  oneUse.spawn(Team.Player, UnitKind.Mob, 0, 9.95, 1);
  const ev = runTo(oneUse, 2.1);
  oneUse.spawn(Team.Player, UnitKind.Mob, 0, 9.95, 1);
  run(oneUse, 2, ev);
  assert.equal(of(ev, 'gateBroken').length, 1, 'broken only by the open crossing');
  assert.equal(oneUse.totals().player, 1 + 6);
});

test('sim m6: gateToggled fires on each flip with the new state, never at t = 0', () => {
  const sim = createSim(level({ gates: [TOGGLE] }), rand);
  const ev = runTo(sim, 3.05);
  const flips = of(ev, 'gateToggled');
  assert.deepEqual(
    flips.map((e) => e.on),
    [false, true, false],
  );
  assert.ok(flips.every((e) => e.gateId === 't' && e.x === 0 && e.z === 10));
  const offset = createSim(level({ gates: [{ ...TOGGLE, toggle: { on: 1, off: 1, offset: 1 } }] }), rand);
  const ev2 = run(offset, 1);
  assert.equal(of(ev2, 'gateToggled').length, 0, 'starting closed is not a flip');
});

// ---------- Gliding gates ----------

test('sim m6: moveGate lifts the gate, glides it and lands it at the new spot', () => {
  const gate: GateDef = { id: 'g', op: 'add', value: 5, x: -2, z: 10, width: 2 };
  const sim = createSim(level({ gates: [gate] }), rand);
  sim.moveGate(0, 2, 20, 1);
  const ev = run(sim, 1);
  const moved = of(ev, 'gateMoved');
  assert.deepEqual(moved, [{ type: 'gateMoved', gateId: 'g', fromX: -2, fromZ: 10, x: 2, z: 20, seconds: 1 }]);
  assert.equal(sim.gateLifted(0), true);
  runTo(sim, 0.5);
  const spot = { x: 0, z: 0 };
  sim.gateSpot(0, spot);
  near(spot.x, 0, 1e-6, 'halfway x');
  near(spot.z, 15, 1e-6, 'halfway z');
  // Lifted: a mob crossing the glided line gets nothing.
  sim.spawn(Team.Player, UnitKind.Mob, 0, 14.95, 1);
  run(sim, 3);
  assert.equal(sim.totals().player, 1, 'no effect while gliding');
  runTo(sim, 1.05);
  assert.equal(sim.gateLifted(0), false);
  sim.gateSpot(0, spot);
  assert.deepEqual(spot, { x: 2, z: 20 });
  // Landed: the new spot works, the old one is empty.
  sim.spawn(Team.Player, UnitKind.Mob, -2, 9.95, 1);
  run(sim, 3);
  assert.equal(sim.totals().player, 2, 'old spot does nothing');
  sim.spawn(Team.Player, UnitKind.Mob, 2, 19.95, 1);
  const ev2 = run(sim, 3);
  assert.equal(sim.totals().player, 2 + 6, 'new spot adds 5');
  const g = of(ev2, 'gate');
  assert.equal(g.length, 1);
  assert.equal(g[0].z, 20);
});

test('sim m6: a moved swaying gate keeps its sway around the new base', () => {
  const gate: GateDef = {
    id: 's',
    op: 'add',
    value: 1,
    x: 0,
    z: 10,
    width: 2,
    move: { amplitude: 1, period: 4 },
    toggle: { on: 1.5, off: 1.5 },
  };
  const sim = createSim(level({ gates: [gate] }), rand);
  sim.moveGate(0, 3, 30, 0.5);
  const ev = runTo(sim, 1.6);
  const flip = of(ev, 'gateToggled')[0];
  assert.ok(flip, 'flipped at 1.5 s');
  near(flip.x, 3 + (gateX(gate, 1.5) - gate.x), 0.02, 'sway on the new base (flip at t = 1.5)');
  assert.equal(flip.z, 30);
});

test('sim m6: an instant move (seconds 0) never lifts the gate', () => {
  const sim = createSim(level({ gates: [{ id: 'g', op: 'add', value: 5, x: 0, z: 10, width: 4 }] }), rand);
  sim.moveGate(0, 1, 12, 0);
  assert.equal(sim.gateLifted(0), false);
  run(sim, 1);
  sim.spawn(Team.Player, UnitKind.Mob, 1, 11.95, 1);
  run(sim, 2);
  assert.equal(sim.totals().player, 6);
});

// ---------- Conveyors ----------

const BELT = { id: 'b', x: 0, z: 0, width: 10, length: 100, vx: 2, vz: 0 };

// x moved by a frozen unit of `team`/`kind` on BELT after `steps` steps.
function beltDrift(over: Partial<LevelDef>, team: Team, kind: UnitKind, steps = 60): number {
  const sim = createSim(level({ conveyors: [BELT], ...over }), rand);
  sim.spawn(team, kind, -3, 30, 1, kind === UnitKind.Champion ? { hp: 100, radius: 0.5 } : undefined);
  sim.freezeUnits(team, 0, 0, Infinity, 100);
  run(sim, steps);
  return sim.view.posX[0] + 3;
}

test('sim m6: a conveyor carries frozen units; champions at half, beltGrip shields player units', () => {
  near(beltDrift({}, Team.Player, UnitKind.Mob), 2, 1e-3, 'player mob');
  near(beltDrift({}, Team.Enemy, UnitKind.Mob), 2, 1e-3, 'enemy mob');
  near(beltDrift({}, Team.Player, UnitKind.Champion), 1, 1e-3, 'champion');
  near(beltDrift({ mods: { beltGrip: 0.5 } }, Team.Player, UnitKind.Mob), 1, 1e-3, 'grip');
  near(beltDrift({ mods: { beltGrip: 0.5 } }, Team.Enemy, UnitKind.Mob), 2, 1e-3, 'grip is player only');
  near(beltDrift({ mods: { beltGrip: 0.5 } }, Team.Player, UnitKind.Champion), 0.5, 1e-3, 'grip x heavy');
  // Flip every second: out and back.
  near(beltDrift({ conveyors: [{ ...BELT, flip: 1 }] }, Team.Player, UnitKind.Mob, 120), 0, 0.07, 'flip');
  // Off the lane edge: clamped.
  const edge = beltDrift({}, Team.Player, UnitKind.Mob, 600);
  near(edge, 3 + 5 - 0.28, 1e-3, 'clamped at the lane edge');
});

test('sim m6: a belt running backward cannot make a unit re-trigger a gate it passed', () => {
  // Forward for 0.5 s, backward for 0.5 s: a slow mob crosses the gate, is carried back
  // over its line, then crosses it again.
  const lvl = level({
    gates: [{ id: 'g', op: 'add', value: 5, x: 0, z: 5, width: 10 }],
    conveyors: [{ id: 'b', x: 0, z: 0, width: 10, length: 40, vx: 0, vz: 10, flip: 0.5 }],
  });
  const sim = createSim(lvl, rand);
  sim.spawn(Team.Player, UnitKind.Mob, 0, 2, 1, { speed: 2 });
  let minZ = Infinity;
  let crossedBack = false;
  const ev: SimEvent[] = [];
  for (let s = 0; s < 90; s++) {
    sim.step(SIM_DT, ev);
    if (sim.time > 0.5) minZ = Math.min(minZ, sim.view.posZ[0]);
    if (sim.time > 0.5 && sim.view.posZ[0] < 5) crossedBack = true;
  }
  assert.ok(crossedBack, `carried back over the line (min z ${minZ})`);
  assert.ok(sim.view.posZ[0] > 5, 'and forward again');
  const added = of(ev, 'gate').reduce((a, e) => a + e.added, 0);
  assert.equal(added, 5, 'the gate applied once');
  assert.equal(sim.totals().player, 6);
});

test('sim m6: a backward belt stops player units at their own base line without hurting it', () => {
  const sim = createSim(level({ conveyors: [{ id: 'b', x: 0, z: 0, width: 10, length: 10, vx: 0, vz: -30 }] }), rand);
  sim.spawn(Team.Player, UnitKind.Mob, 0, 3, 5);
  const ev = run(sim, 60);
  assert.equal(of(ev, 'baseHit').length, 0);
  assert.equal(sim.totals().player, 5);
  for (let i = 0; i < sim.view.count; i++) assert.ok(sim.view.posZ[i] >= 0);
});

// ---------- Turntables ----------

test('sim m6: a turntable turns +x toward +z for positive spin; heavies and grip at half', () => {
  const T = { id: 'p', x: 0, z: 10, radius: 3, spin: 1 };
  const spin = (over: Partial<LevelDef>, team: Team, kind: UnitKind): [number, number] => {
    const sim = createSim(level({ turntables: [T], ...over }), rand);
    sim.spawn(team, kind, 1, 10, 1, kind === UnitKind.Champion ? { hp: 100, radius: 0.5 } : undefined);
    sim.freezeUnits(team, 0, 0, Infinity, 100);
    run(sim, 30);
    return [sim.view.posX[0], sim.view.posZ[0] - 10];
  };
  const [x, z] = spin({}, Team.Enemy, UnitKind.Mob);
  near(x, Math.cos(0.5), 1e-3, 'x');
  near(z, Math.sin(0.5), 1e-3, 'z');
  const [hx, hz] = spin({}, Team.Player, UnitKind.Champion);
  near(Math.atan2(hz, hx), 0.25, 1e-3, 'champion at half');
  const [gx, gz] = spin({ mods: { beltGrip: 0.5 } }, Team.Player, UnitKind.Mob);
  near(Math.atan2(gz, gx), 0.25, 1e-3, 'grip at half');
  const [fx, fz] = spin({ turntables: [{ ...T, spin: -1 }] }, Team.Enemy, UnitKind.Mob);
  near(Math.atan2(fz, fx), -0.5, 1e-3, 'negative spin');
  near(Math.hypot(fx, fz), 1, 1e-3, 'radius kept');
});

// ---------- Saws ----------

test('sim m6: a saw bites both teams, at most bite * dt weight per step, nearest first', () => {
  const saw = { id: 's', x: 0, z: 10, radius: 1, bite: 60 }; // 1 weight per step
  for (const team of [Team.Player, Team.Enemy]) {
    const sim = createSim(level({ saws: [saw] }), rand);
    sim.spawn(team, UnitKind.Mob, 0.8, 10, 1);
    sim.spawn(team, UnitKind.Mob, 0, 10, 1); // nearest
    sim.spawn(team, UnitKind.Mob, -0.6, 10.3, 1);
    sim.freezeUnits(team, 0, 0, Infinity, 100);
    const ev = run(sim, 1);
    assert.equal(sim.view.count, 2, 'one weight removed');
    for (let i = 0; i < sim.view.count; i++) assert.notEqual(sim.view.posX[i], 0, 'the nearest went first');
    const hits = of(ev, 'sawHit');
    assert.equal(hits.length, 1);
    near(hits[0].weight, 1, 1e-9, 'event weight');
    run(sim, 1);
    assert.equal(sim.view.count, 1);
  }
  // A bigger bite spreads over several units in one step but never more than bite * dt.
  const big = createSim(level({ saws: [{ ...saw, bite: 150 }] }), rand);
  big.spawn(Team.Enemy, UnitKind.Mob, 0, 10, 6, { spread: 0.3 });
  big.freezeUnits(Team.Enemy, 0, 0, Infinity, 100);
  const ev = run(big, 1);
  near(of(ev, 'sawHit')[0].weight, 2.5, 1e-9, 'capped');
  assert.equal(big.totals().enemy, 4, '2.5 removed: two dead, one hurt');
});

test('sim m6: sawGuard spares player units; a sunk saw is harmless; riders drop from saw kills', () => {
  const saw = { id: 's', x: 0, z: 10, radius: 1, bite: 60 };
  const champ = (team: Team, mods?: LevelDef['mods']): number => {
    const sim = createSim(level({ saws: [saw], mods }), rand);
    sim.spawn(team, UnitKind.Champion, 0, 10, 1, { hp: 10 });
    sim.freezeUnits(team, 0, 0, Infinity, 100);
    run(sim, 6);
    return sim.view.hp[0];
  };
  near(champ(Team.Player), 4, 1e-4, 'champion loses 1 hp per step');
  near(champ(Team.Player, { sawGuard: 0.5 }), 7, 1e-4, 'guard halves it');
  near(champ(Team.Enemy, { sawGuard: 0.5 }), 4, 1e-4, 'guard is player only');

  const sunk = createSim(level({ saws: [{ ...saw, cycle: { on: 1, off: 1, offset: 1 } }] }), rand);
  sunk.spawn(Team.Enemy, UnitKind.Champion, 0, 10, 1, { hp: 10 });
  sunk.freezeUnits(Team.Enemy, 0, 0, Infinity, 100);
  const ev = runTo(sunk, 0.95);
  assert.equal(of(ev, 'sawHit').length, 0);
  runTo(sunk, 1.5, ev);
  assert.ok(of(ev, 'sawHit').length > 0, 'up after a second');

  const giant = createSim(level({ saws: [{ ...saw, bite: 600 }] }), rand);
  giant.spawn(Team.Player, UnitKind.Champion, 0, 10, 1, { hp: 5, riders: 3 });
  giant.freezeUnits(Team.Player, 0, 0, Infinity, 0.01);
  const ev2 = run(giant, 1);
  assert.equal(of(ev2, 'giantFell').length, 1);
});

test('sim m6: a moving saw follows sawPos', () => {
  const saw = { id: 's', x: -3, z: 10, radius: 0.5, bite: 600, path: { dx: 6, dz: 0, period: 2 } };
  const sim = createSim(level({ saws: [saw] }), rand);
  const ev = runTo(sim, 1.01);
  sim.spawn(Team.Enemy, UnitKind.Champion, 3, 10, 1, { hp: 1000 });
  sim.freezeUnits(Team.Enemy, 0, 0, Infinity, 100);
  run(sim, 1, ev);
  const hit = of(ev, 'sawHit');
  assert.equal(hit.length, 1, 'hit at the far end of its path');
  near(hit[0].x, 3, 0.05, 'saw x');
});

// ---------- Shield walls ----------

const SHIELD = { id: 'sh', kind: 'shield' as const, x: 0, z: 20, hp: 50 };

test('sim m6: shield walls deflect player mobs and take no damage from them', () => {
  const sim = createSim(level({ defenders: [SHIELD] }), mulberry32(4));
  assert.equal(sim.defenders[0].width, 4);
  assert.equal(sim.defenders[0].depth, 0.8);
  const ev: SimEvent[] = [];
  for (let s = 0; s < 240; s++) {
    if (s < 60 && s % 6 === 0) sim.spawn(Team.Player, UnitKind.Mob, 0, 15, 3, { spread: 0.5 });
    const before = ev.length;
    sim.step(SIM_DT, ev);
    assert.ok(of(ev.slice(before), 'shieldBlock').length <= SIM_W3.maxShieldEvents);
  }
  assert.equal(sim.defenders[0].hp, 50);
  assert.ok(of(ev, 'shieldBlock').length > 0);
  assert.equal(sim.totals().player, 30, 'nobody lost');
  let past = 0;
  for (let i = 0; i < sim.view.count; i++) if (sim.view.posZ[i] > 21) past++;
  assert.equal(past, 30, 'all made it round');
  // Ultimates and arrows cannot hurt it either.
  sim.damageDefender(0, 100);
  run(sim, 1);
  assert.equal(sim.defenders[0].hp, 50);
});

test('sim m6: champions break shield walls; shieldBreak lets mobs dent them; enemies walk through', () => {
  const sim = createSim(level({ defenders: [SHIELD] }), rand);
  sim.spawn(Team.Player, UnitKind.Champion, 0, 17, 1, { hp: 100, damage: 20 });
  const ev = runTo(sim, 3);
  assert.equal(sim.defenders[0].hp, 0);
  assert.equal(of(ev, 'defenderDestroyed').length, 1);

  const dent = createSim(level({ defenders: [SHIELD], mods: { shieldBreak: 2 } }), rand);
  dent.spawn(Team.Player, UnitKind.Mob, 0, 19, 5, { spread: 0.5 });
  run(dent, 30);
  assert.equal(dent.defenders[0].hp, 40, '5 mobs x 2 damage');
  assert.equal(dent.totals().player, 0, 'they cancel at it');

  const enemy = createSim(level({ defenders: [SHIELD] }), rand);
  enemy.spawn(Team.Enemy, UnitKind.Mob, 0, 22, 1);
  run(enemy, 60);
  assert.ok(enemy.view.posZ[0] < 18, 'enemy walked through its own wall');
});

// ---------- Wind-up robots ----------

test('sim m6: wind-up robots walk and stop in turns with a hashed phase, no rand() draws', () => {
  let calls = 0;
  const counted = () => {
    calls++;
    return 0.5;
  };
  const sim = createSim(level(), counted);
  sim.spawn(Team.Enemy, UnitKind.Mob, 0, 90, 1, { windup: { run: 1, pause: 1 } });
  sim.spawn(Team.Enemy, UnitKind.Mob, 3, 90, 1, { windup: { run: 1, pause: 1 } });
  assert.equal(calls, 0);
  let still = 0;
  let prev = 90;
  let apart = false;
  for (let s = 0; s < 240; s++) {
    sim.step(SIM_DT, []);
    if (sim.view.posZ[0] === prev) still++;
    prev = sim.view.posZ[0];
    if (sim.view.posZ[0] !== sim.view.posZ[1]) apart = true;
  }
  assert.equal(calls, 0, 'no rand() in step');
  near(90 - sim.view.posZ[0], 10, 5 * SIM_DT * 1.01, 'walked 2 of 4 s');
  near(still, 120, 1, 'stood 2 of 4 s');
  assert.ok(apart, 'the two robots are out of step');
});

test('sim m6: a standing robot still cancels against player units', () => {
  const sim = createSim(level(), rand);
  sim.spawn(Team.Enemy, UnitKind.Mob, 0, 20, 3, { windup: { run: 0.01, pause: 100 }, spread: 0 });
  sim.spawn(Team.Player, UnitKind.Mob, 0, 15, 1);
  run(sim, 60);
  assert.equal(sim.totals().enemy, 2);
});

// ---------- Archers ----------

test('sim m6: archers shoot the nearest enemy ahead, once per cooldown', () => {
  const sim = createSim(level(), rand);
  sim.spawn(Team.Player, UnitKind.Mob, 0, 5, 1, { speed: 0.001, ranged: { range: 6, every: 1, damage: 1 } });
  for (let k = 0; k < 6; k++) sim.spawn(Team.Enemy, UnitKind.Mob, -2 + k * 0.8, 9 + k * 0.1, 1);
  sim.spawn(Team.Enemy, UnitKind.Mob, 0, 2, 1); // behind: never a target
  sim.freezeUnits(Team.Enemy, 0, 0, Infinity, 100);
  const shots: number[] = [];
  const ev: SimEvent[] = [];
  for (let s = 0; s < 190; s++) {
    const before = ev.length;
    sim.step(SIM_DT, ev);
    if (of(ev.slice(before), 'arrow').length > 0) shots.push(s);
  }
  assert.ok(shots.length === 3 || shots.length === 4, `${shots.length} shots`);
  for (let k = 1; k < shots.length; k++) near(shots[k] - shots[k - 1], 60, 1, 'cooldown');
  assert.equal(sim.totals().enemy, 7 - shots.length, 'one kill per arrow');
  const a = of(ev, 'arrow')[0];
  assert.equal(a.tz >= 9, true, 'aimed ahead');
  near(a.tx, -0.4, 1e-6, 'nearest first');
});

test('sim m6: arrows hit towers but not shield walls, and arrow events are capped', () => {
  const sim = createSim(
    level({ defenders: [SHIELD, { id: 'tw', kind: 'tower', x: 3, z: 22, hp: 100, range: 0.1 }] }),
    rand,
  );
  sim.spawn(Team.Player, UnitKind.Mob, 0, 18, 1, { speed: 0.001, ranged: { range: 6, every: 0.5, damage: 2 } });
  const ev = runTo(sim, 1.1);
  assert.equal(sim.defenders[0].hp, 50, 'shield untouched');
  assert.ok(sim.defenders[1].hp < 100, 'tower hit');

  const many = createSim(level(), rand);
  many.spawn(Team.Player, UnitKind.Mob, 0, 5, 40, {
    speed: 0.001,
    spread: 4,
    ranged: { range: 8, every: 0.02, damage: 1 },
  });
  many.spawn(Team.Enemy, UnitKind.Mob, 0, 9, 400, { spread: 4 });
  many.freezeUnits(Team.Enemy, 0, 0, Infinity, 100);
  const enemyBefore = many.totals().enemy;
  let maxPerStep = 0;
  let arrows = 0;
  for (let s = 0; s < 12; s++) {
    const e: SimEvent[] = [];
    many.step(SIM_DT, e);
    const n = of(e, 'arrow').length;
    maxPerStep = Math.max(maxPerStep, n);
    arrows += n;
  }
  assert.equal(maxPerStep, SIM_W3.maxArrowEvents);
  assert.ok(enemyBefore - many.totals().enemy > arrows, 'more shots than events');
  assert.ok(of(ev, 'defenderHit').length > 0);
});

test('sim m6: gate clones inherit the bow', () => {
  const sim = createSim(level({ gates: [{ id: 'g', op: 'add', value: 4, x: 0, z: 5.5, width: 6 }] }), rand);
  sim.spawn(Team.Player, UnitKind.Mob, 0, 5, 1, { speed: 1, ranged: { range: 6, every: 0.5, damage: 1 } });
  run(sim, 40);
  assert.equal(sim.totals().player, 5);
  sim.spawn(Team.Enemy, UnitKind.Mob, 0, 9, 100, { spread: 3 });
  sim.freezeUnits(Team.Enemy, 0, 0, Infinity, 100);
  const enemy = sim.totals().enemy;
  run(sim, 33);
  // One archer alone could kill at most 2 in 0.55 s.
  assert.ok(enemy - sim.totals().enemy >= 5, `5 archers over 0.55 s: ${enemy - sim.totals().enemy}`);
});

// ---------- Ricochet ----------

test('sim m6: a ricochet shot bounces off the lane walls `bounces` times, then walks straight', () => {
  const sim = createSim(level(), rand);
  sim.spawn(Team.Player, UnitKind.Mob, 0, 2, 1, { bounce: { vx: 6, bounces: 2 } });
  const ev = runTo(sim, 4);
  const r = of(ev, 'ricochet');
  assert.equal(r.length, 2);
  near(r[0].x, 4.72, 1e-6, 'right wall first');
  near(r[1].x, -4.72, 1e-6, 'then left');
  near(sim.view.posX[0], -4.72, 1e-6, 'stays by the wall');
  const z = sim.view.posZ[0];
  run(sim, 30);
  near(sim.view.posZ[0] - z, 3.5, 1e-3, 'walks straight on');
});

test('sim m6: gate clones inherit the ricochet', () => {
  const sim = createSim(level({ gates: [{ id: 'g', op: 'add', value: 3, x: 0, z: 2.2, width: 8 }] }), rand);
  sim.spawn(Team.Player, UnitKind.Mob, 0, 2, 1, { bounce: { vx: 4, bounces: 2 } });
  run(sim, 6);
  assert.equal(sim.view.count, 4);
  runTo(sim, 6);
  for (let i = 0; i < sim.view.count; i++) near(sim.view.posX[i], -4.72, 0.15, `unit ${i} ends on the left wall`);
});

// ---------- Gate walk ----------

test('sim m6: the Wind-up Robot walks a good gate once and re-triggers it once per mob', () => {
  const lvl = level({
    gates: [
      { id: 'g', op: 'mul', value: 2, x: 0, z: 10, width: 6 },
      { id: 'h', op: 'add', value: 5, x: 0, z: 20, width: 10 },
    ],
  });
  const sim = createSim(lvl, rand);
  sim.spawn(Team.Player, UnitKind.Mob, 0, 9.9, 5, { speed: 0.3, spread: 1 });
  const ev = run(sim, 60);
  assert.equal(sim.totals().player, 10, 'x2 once');
  sim.spawn(Team.Player, UnitKind.Champion, 0, 9.5, 1, { hp: 50, gateWalk: { seconds: 2, radius: 3 } });
  const champZ = () => {
    for (let i = 0; i < sim.view.count; i++) if (sim.view.kind[i] === UnitKind.Champion) return sim.view.posZ[i];
    return NaN;
  };
  runTo(sim, 2, ev);
  const walks = of(ev, 'gateWalk');
  assert.equal(walks.length, 1);
  assert.equal(walks[0].gateId, 'g');
  assert.equal(walks[0].seconds, 2);
  near(champZ(), 10, 0.1, 'stands on the line');
  assert.equal(sim.totals().player, 1 + 20, 'every mob doubled once more');
  runTo(sim, 2.9, ev);
  assert.equal(sim.totals().player, 1 + 20, 'never twice');
  runTo(sim, 6, ev);
  assert.ok(champZ() > 13, `walked on after the walk (z ${champZ()})`);
  assert.equal(of(ev, 'gateWalk').length, 1, 'one walk per launch');
  const added = of(ev, 'gate')
    .filter((e) => e.gateId === 'g')
    .reduce((a, e) => a + e.added, 0);
  assert.equal(added, 15, '5 + 10');
});

test('sim m6: the Wind-up Robot ignores bad and closed gates', () => {
  const lvl = level({
    gates: [
      { id: 'bad', op: 'sub', value: 2, x: 0, z: 8, width: 6 },
      { id: 'shut', op: 'mul', value: 2, x: 0, z: 12, width: 6, toggle: { on: 1, off: 100, offset: 1 } },
      { id: 'good', op: 'add', value: 3, x: 0, z: 16, width: 6 },
    ],
  });
  const sim = createSim(lvl, rand);
  sim.spawn(Team.Player, UnitKind.Champion, 0, 5, 1, { hp: 50, gateWalk: { seconds: 1, radius: 2 } });
  const ev = runTo(sim, 4);
  const walks = of(ev, 'gateWalk');
  assert.equal(walks.length, 1);
  assert.equal(walks[0].gateId, 'good');
});

// ---------- Determinism and World 1 ----------

const WORKSHOP = level({
  lane: { width: 10, length: 60 },
  gates: [
    { id: 'a', op: 'mul', value: 2, x: -2.5, z: 12, width: 4, toggle: { on: 2, off: 1.5 } },
    {
      id: 'b',
      op: 'add',
      value: 8,
      x: 2.5,
      z: 12,
      width: 4,
      toggle: { on: 1.5, off: 1.5, alt: { op: 'sub', value: 4 } },
    },
    { id: 'c', op: 'mul', value: 3, x: 0, z: 30, width: 4, toggle: { on: 1, off: 2, offset: 1 } },
    {
      id: 'd',
      op: 'div',
      value: 2,
      x: 0,
      z: 40,
      width: 3,
      toggle: { on: 2, off: 2 },
      move: { amplitude: 2, period: 3 },
    },
  ],
  conveyors: [
    { id: 'c1', x: -2.5, z: 16, width: 5, length: 6, vx: 1.5, vz: 0, flip: 3 },
    { id: 'c2', x: 2.5, z: 34, width: 5, length: 5, vx: 0, vz: -2 },
  ],
  turntables: [{ id: 't', x: 0, z: 24, radius: 3, spin: 1.2, flip: 4 }],
  saws: [
    { id: 's1', x: -3, z: 20, radius: 0.8, path: { dx: 6, dz: 0, period: 3 } },
    { id: 's2', x: 3, z: 45, radius: 0.8, cycle: { on: 1, off: 1 } },
  ],
  defenders: [{ id: 'sh', kind: 'shield', x: 0, z: 50, hp: 80 }],
});

function playWorkshop(seed: number): string {
  const sim = createSim(WORKSHOP, mulberry32(seed));
  const ev: SimEvent[] = [];
  for (let s = 0; s < 600; s++) {
    if (s % 6 === 0) {
      sim.spawn(Team.Player, UnitKind.Mob, Math.sin(s * 0.05) * 3, 1.5, 3, {
        ranged: s % 12 === 0 ? { range: 6, every: 1, damage: 1 } : undefined,
        bounce: s % 18 === 0 ? { vx: 3, bounces: 2 } : undefined,
      });
    }
    if (s % 20 === 0) sim.spawn(Team.Enemy, UnitKind.Mob, 0, 58, 4, { windup: { run: 1, pause: 0.6 } });
    if (s === 120)
      sim.spawn(Team.Player, UnitKind.Champion, -2.5, 1.5, 1, { hp: 60, gateWalk: { seconds: 2, radius: 2.5 } });
    if (s === 300) sim.moveGate(0, 2.5, 14, 1);
    sim.step(SIM_DT, ev);
  }
  const v = sim.view;
  let h = 0;
  for (let i = 0; i < v.count; i++) h = (h * 31 + v.posX[i] * 1000 + v.posZ[i] * 7 + v.weight[i]) % 1e9;
  return `${v.count}:${h}:${JSON.stringify(ev)}`;
}

test('sim m6: a workshop battle is deterministic for a seed', () => {
  const a = playWorkshop(3);
  assert.equal(a, playWorkshop(3));
  assert.notEqual(a, playWorkshop(4));
  for (const type of ['gateToggled', 'gateMoved', 'gateWalk', 'sawHit', 'arrow', 'ricochet']) {
    assert.ok(a.includes(`"type":"${type}"`), `${type} happened`);
  }
});

// Scripted World 1 battle; the checksum was recorded with the Milestone 5 sim, so any
// drift in World 1 behaviour (or an extra rand() call) fails here.
function playWorld1(level: LevelDef): string {
  const sim = createSim(level, mulberry32(42));
  const ev: SimEvent[] = [];
  const r = mulberry32(5);
  for (let s = 0; s < 60 * 30; s++) {
    if (s % 8 === 0) sim.spawn(Team.Player, UnitKind.Mob, Math.sin(s * SIM_DT) * 3, 1.5, 3, { variant: s % 3 });
    if (s % 300 === 50) sim.spawn(Team.Player, UnitKind.Champion, 0, 1.5, 1, { hp: 40, damage: 20 });
    if (s % 30 === 0) sim.spawn(Team.Enemy, UnitKind.Mob, (r() * 2 - 1) * 3, level.lane.length - 1.5, 4);
    sim.step(SIM_DT, ev);
  }
  const v = sim.view;
  let h = 0;
  for (let i = 0; i < v.count; i++) h = (h * 31 + v.posX[i] * 1000 + v.posZ[i] * 7 + v.weight[i]) % 1e9;
  let e = 0;
  for (const x of JSON.stringify(ev)) e = (e * 33 + x.charCodeAt(0)) % 1e9;
  return `${v.count}:${h.toFixed(3)}:${ev.length}:${e}`;
}

test('sim m6: a World 1 level plays exactly as before', () => {
  const w1 = JSON.parse(readFileSync(new URL('../src/data/levels/1-07.json', import.meta.url), 'utf8')) as LevelDef;
  assert.equal(playWorld1(w1), '382:-879756581.059:1774:106083228');
});
