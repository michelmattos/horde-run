// Milestone 5 sim features (World 2): ice slide and grip, freezing gates and freezeGate,
// ice walls, wind determinism, unit freeze, Giant riders and rolling snowballs, plus a
// recorded checksum proving a World 1 style level still plays bit for bit as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/index.ts';
import type { Sim } from '../src/sim/index.ts';
import { SIM_DT, Team, UnitKind } from '../src/contracts.ts';
import type { LevelDef, SimEvent } from '../src/contracts.ts';

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
    id: 'm5',
    name: 'M5',
    lane: { width: 10, length: 60 },
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

// One player mob crossing the lane under a 1 s gust; returns its x after the gust, 1 s
// later and 1.5 s later.
function gustDrift(over: Partial<LevelDef>): [number, number, number] {
  const sim = createSim(level({ lane: { width: 14, length: 100 }, ...over }), rand);
  sim.spawn(Team.Player, UnitKind.Mob, -5, 2, 1);
  sim.setWind(2);
  run(sim, 60);
  sim.setWind(0);
  const atGustEnd = sim.view.posX[0];
  run(sim, 60);
  const later = sim.view.posX[0];
  run(sim, 30);
  return [atGustEnd, later, sim.view.posX[0]];
}

const ICE = [{ x: 0, z: 0, width: 14, length: 100 }];

test('sim m5: on ice a gust carries a unit further and it keeps sliding after the gust', () => {
  const [, plainLater, plainEnd] = gustDrift({});
  const [, iceLater, iceEnd] = gustDrift({ ice: ICE });
  assert.ok(Math.abs(plainLater - -3) < 1e-3, `plain floor drifts exactly wind x time (${plainLater})`);
  assert.equal(plainEnd, plainLater, 'plain floor stops with the gust');
  assert.ok(iceLater > plainLater + 0.5, `ice ${iceLater} vs plain ${plainLater}`);
  assert.ok(iceEnd > iceLater + 0.1, 'still sliding after the gust');
});

// A stream of mobs fired straight up the lane through an ice patch, no wind: the mean
// sideways speed of the mobs while they are on the patch (or the same stretch of floor).
function sidewaysOnPatch(ice: LevelDef['ice']): number {
  const patch = { x: 0, z: 20, width: 10, length: 12 };
  const sim = createSim(level({ ice }), mulberry32(7));
  const prev = new Float32Array(4096);
  let sum = 0;
  let n = 0;
  for (let s = 0; s < 360; s++) {
    if (s % 10 === 0 && s < 240) sim.spawn(Team.Player, UnitKind.Mob, 0, 2, 3);
    const v = sim.view;
    const before = v.count;
    for (let i = 0; i < before; i++) prev[i] = v.posX[i];
    sim.step(SIM_DT, []);
    if (v.count !== before) continue; // compaction reorders the arrays
    for (let i = 0; i < v.count; i++) {
      if (Math.abs(v.posZ[i] - patch.z) > patch.length / 2) continue;
      sum += Math.abs(v.posX[i] - prev[i]) / SIM_DT;
      n++;
    }
  }
  assert.ok(n > 100, `mobs crossed the patch (${n} unit-steps)`);
  return sum / n;
}

test('sim m5: with no wind, mobs stepping onto ice skid sideways far more than on plain floor', () => {
  const plain = sidewaysOnPatch(undefined);
  const ice = sidewaysOnPatch([{ x: 0, z: 20, width: 10, length: 12 }]);
  assert.ok(ice > plain * 3 && ice > 0.2, `ice ${ice.toFixed(3)} u/s vs plain ${plain.toFixed(3)} u/s`);
});

test('sim m5: iceGrip 1 removes the slide', () => {
  const plain = gustDrift({});
  const grip = gustDrift({ ice: ICE, mods: { iceGrip: 1 } });
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(plain[k] - grip[k]) < 1e-4, `${grip[k]} vs ${plain[k]}`);
});

test('sim m5: a freezing gate freezes on its budget, blocks and chips, thaws early when chipped, then works again', () => {
  const gates = [
    { id: 'f', op: 'add' as const, value: 1, x: 0, z: 10, width: 4, freeze: { after: 5, duration: 2, hp: 6 } },
  ];
  const line = (sim: Sim, count: number) => {
    for (let k = 0; k < count; k++) sim.spawn(Team.Player, UnitKind.Mob, -1.6 + k * 0.8, 9.95, 1);
  };
  const thawTime = (chip: boolean): { time: number; chipped: boolean } => {
    const sim = createSim(level({ gates, lane: { width: 10, length: 200 } }), rand);
    // Four units leave the gate open; the fifth fills the budget and still gets +1.
    line(sim, 4);
    let ev = run(sim, 30);
    assert.equal(of(ev, 'gateFrozen').length, 0);
    assert.equal(sim.gateIce(0), 0);
    line(sim, 1);
    ev = run(sim, 1);
    assert.equal(of(ev, 'gateFrozen').length, 1, 'freezes on the unit that fills the budget');
    assert.equal(of(ev, 'gate')[0].added, 1);
    assert.equal(sim.gateIce(0), 6);
    const frozeAt = sim.time;
    run(sim, 30); // let the crossed crowd move on
    const before = sim.totals().player;
    line(sim, 3);
    ev = run(sim, 1);
    assert.equal(sim.gateIce(0), 3, 'ice falls by the crossing weight');
    assert.equal(sim.totals().player, before, 'blocked units cancel against the ice, no +1');
    assert.equal(of(ev, 'gateChipped').length, 1, 'chip events are throttled to one per gate per step');
    if (chip) {
      run(sim, 6);
      line(sim, 3);
    }
    const all: SimEvent[] = [];
    for (let s = 0; s < 200 && of(all, 'gateThawed').length === 0; s++) run(sim, 1, all);
    const thawed = of(all, 'gateThawed')[0];
    const time = sim.time - frozeAt;
    // Thawed: the next unit gets +1 again.
    run(sim, 30);
    const t0 = sim.totals().player;
    line(sim, 1);
    ev = run(sim, 1);
    assert.equal(of(ev, 'gate')[0]?.added, 1, 'the op works again after the thaw');
    assert.equal(sim.totals().player, t0 + 2);
    return { time, chipped: thawed.chipped };
  };
  const chipped = thawTime(true);
  const alone = thawTime(false);
  assert.equal(chipped.chipped, true);
  assert.equal(alone.chipped, false);
  assert.ok(Math.abs(alone.time - 2) < 1.5 * SIM_DT, `left alone it thaws after its duration (${alone.time})`);
  assert.ok(chipped.time < alone.time - 1, `chipped ${chipped.time} vs ${alone.time}`);
});

test('sim m5: freezeGate ices a plain gate (no clones while frozen) until the time runs out', () => {
  const gates = [{ id: 'x2', op: 'mul' as const, value: 2, x: 0, z: 10, width: 4 }];
  const sim = createSim(level({ gates, lane: { width: 10, length: 200 } }), rand);
  sim.freezeGate(0, 1, 4);
  assert.equal(sim.gateIce(0), 4);
  sim.spawn(Team.Player, UnitKind.Mob, 0, 9.95, 1);
  const ev = run(sim, 1);
  assert.equal(of(ev, 'gateFrozen').length, 1, 'reported on the next step');
  assert.equal(sim.view.count, 0);
  assert.equal(sim.gateIce(0), 3);
  run(sim, 60);
  assert.equal(sim.gateIce(0), 0);
  sim.spawn(Team.Player, UnitKind.Mob, 0, 9.95, 1);
  run(sim, 1);
  assert.equal(sim.totals().player, 2, 'x2 again after the thaw');
});

test('sim m5: an ice wall keeps both crowds out of its rectangle and they still get round it', () => {
  const wall = { id: 'iw', x: -1.5, z: 20, width: 7, depth: 2 }; // covers x -5..2: the gap is on the right
  const sim = createSim(level({ lane: { width: 10, length: 40 }, iceWalls: [wall] }), mulberry32(3));
  const events: SimEvent[] = [];
  let enemyDamage = 0;
  let playerDamage = 0;
  let hits = 0;
  for (let s = 0; s < 900; s++) {
    if (s < 120 && s % 6 === 0) sim.spawn(Team.Player, UnitKind.Mob, -4 + (s % 48) / 6, 2, 3, { spread: 0.6 });
    if (s === 200) sim.spawn(Team.Enemy, UnitKind.Mob, -2.5, 38, 10, { spread: 2 });
    events.length = 0;
    sim.step(SIM_DT, events);
    const v = sim.view;
    for (let i = 0; i < v.count; i++) {
      const inside = Math.abs(v.posX[i] - wall.x) < wall.width / 2 && Math.abs(v.posZ[i] - wall.z) < wall.depth / 2;
      assert.ok(!inside, `unit ${i} at (${v.posX[i]}, ${v.posZ[i]}) inside the wall at step ${s}`);
    }
    for (const e of of(events, 'baseHit')) {
      if (e.team === Team.Enemy) enemyDamage += e.damage;
      else playerDamage += e.damage;
    }
    hits += of(events, 'iceWallHit').length;
    assert.ok(of(events, 'iceWallHit').length <= 2);
  }
  assert.equal(enemyDamage, 60, 'every player mob reached the enemy base');
  assert.equal(playerDamage, 10, 'every enemy mob reached the player base');
  assert.ok(hits > 0, 'head-on hits were reported');
  assert.equal(sim.view.count, 0);
});

// A World 1 style level (moving, one-use, sub and div gates, a tower and a wall, champions,
// blasts, area damage and a strafing base) hashed over 15 s. EXPECTED was recorded with the
// sim before Milestone 5, so any drift in old behaviour fails here.
const W1: LevelDef = level({
  id: 'w1-snapshot',
  playerBase: { hp: 300 },
  enemyBase: { hp: 1500, x: 0, width: 6 },
  gates: [
    { id: 'x3', op: 'mul', value: 3, x: 0, z: 18, width: 3, move: { amplitude: 2, period: 5 } },
    { id: 'p8', op: 'add', value: 8, x: -3, z: 26, width: 3, uses: 40 },
    { id: 'm4', op: 'sub', value: 4, x: 3, z: 26, width: 3 },
    { id: 'd2', op: 'div', value: 2, x: 0, z: 40, width: 2.5 },
  ],
  defenders: [
    { id: 't', kind: 'tower', x: -3.5, z: 32, hp: 120, fireRate: 3, damage: 2 },
    { id: 'w', kind: 'wall', x: 2, z: 46, hp: 80 },
  ],
  champion: { chargeNeeded: 30, hp: 60, damage: 20 },
});
const EXPECTED_W1 = 1504954360;

function w1Checksum(each?: (sim: Sim, step: number) => void): number {
  const sim = createSim(W1, mulberry32(1234), { unitBudget: 300 });
  const events: SimEvent[] = [];
  let h = 0x811c9dc5;
  const mix = (v: number) => {
    h = Math.imul(h ^ (v >>> 0), 0x01000193) >>> 0;
  };
  const f = new Float32Array(1);
  const u = new Uint32Array(f.buffer);
  for (let s = 0; s < 900; s++) {
    each?.(sim, s);
    if (s % 10 === 0) sim.spawn(Team.Player, UnitKind.Mob, Math.sin(s * 0.05) * 3.5, 1.5, 3, { spread: 0.3 });
    if (s % 25 === 0) sim.spawn(Team.Enemy, UnitKind.Mob, Math.cos(s * 0.07) * 3, 58.5, 4, { spread: 2 });
    if (s % 200 === 50) sim.spawn(Team.Player, UnitKind.Champion, 1, 1.5, 1, { hp: 60, damage: 20 });
    if (s % 120 === 30) {
      sim.spawn(Team.Player, UnitKind.Mob, -1, 1.5, 2, {
        variant: 3,
        deathBlast: { radius: 1.2, damage: 3 },
        speed: 8,
      });
    }
    if (s === 400) sim.damageArea(Team.Enemy, 0, 30, 3, 20);
    if (s === 500) sim.damageDefender(1, 15);
    if (s === 600) sim.setEnemyBaseX(1);
    events.length = 0;
    sim.step(SIM_DT, events);
    mix(events.length);
    for (const e of events) mix(e.type.length);
    const v = sim.view;
    mix(v.count);
    for (let i = 0; i < v.count; i++) {
      f[0] = v.posX[i];
      mix(u[0]);
      f[0] = v.posZ[i];
      mix(u[0]);
      f[0] = v.hp[i];
      mix(u[0]);
      mix(v.weight[i]);
      mix(v.team[i]);
    }
  }
  for (const d of sim.defenders) {
    f[0] = d.hp;
    mix(u[0]);
  }
  return h;
}

test('sim m5: a World 1 level plays bit for bit as before Milestone 5', () => {
  assert.equal(w1Checksum(), EXPECTED_W1);
});

test('sim m5: setWind(0) leaves a run identical to one that never called it', () => {
  assert.equal(
    w1Checksum((sim, s) => {
      if (s % 90 === 0) sim.setWind(0);
    }),
    EXPECTED_W1,
  );
});

test('sim m5: frozen units stand still for exactly the time and never hit the base', () => {
  const sim = createSim(level(), rand);
  sim.spawn(Team.Enemy, UnitKind.Mob, -1, 1, 1);
  sim.spawn(Team.Enemy, UnitKind.Mob, 1, 1, 1);
  sim.spawn(Team.Enemy, UnitKind.Mob, 0, 40, 1); // outside the circle
  assert.equal(sim.freezeUnits(Team.Enemy, 0, 1, 1.5, 1), 2);
  const z0 = sim.view.posZ[0];
  const events: SimEvent[] = [];
  sim.step(SIM_DT, events);
  const frozen = of(events, 'unitsFrozen');
  assert.equal(frozen.length, 1);
  assert.equal(frozen[0].team, Team.Enemy);
  run(sim, 59, events);
  assert.equal(sim.view.posZ[0], z0, 'still frozen after 1 s');
  assert.ok(sim.view.posZ[2] < 40 - 4, 'the unit outside the circle kept walking');
  assert.equal(of(events, 'baseHit').length, 0, 'frozen units never hit the base');
  run(sim, 1, events);
  assert.ok(sim.view.posZ[0] < z0, 'moves again once the freeze ends');
  run(sim, 30, events);
  assert.equal(of(events, 'baseHit')[0]?.damage, 2);
  // Infinity freezes the whole team.
  sim.spawn(Team.Player, UnitKind.Mob, -3, 5, 4, { spread: 1 });
  sim.spawn(Team.Player, UnitKind.Champion, 3, 5, 1, { hp: 40 });
  assert.equal(sim.freezeUnits(Team.Player, 0, 0, Infinity, 2), 5);
});

test('sim m5: a unit with riders drops exactly that much weight of mobs when it dies', () => {
  for (const budget of [1500, 3]) {
    const sim = createSim(level(), rand, { unitBudget: budget });
    sim.spawn(Team.Player, UnitKind.Champion, 0, 20, 1, { hp: 10, riders: 5, variant: 4 });
    sim.step(SIM_DT, []);
    assert.equal(sim.damageArea(Team.Player, 0, sim.view.posZ[0], 1, 10), 10);
    assert.equal(sim.totals().player, 5, `budget ${budget}`);
    for (let i = 0; i < sim.view.count; i++) assert.equal(sim.view.variant[i], 0, 'riders are riflemen');
    const fell = of(run(sim, 1), 'giantFell');
    assert.equal(fell.length, 1);
    assert.equal(fell[0].riders, 5);
  }
});

test('sim m5: a snowball takes gate weight and lone mobs into itself, then bursts into exactly its weight', () => {
  const gates = [
    { id: 'x2', op: 'mul' as const, value: 2, x: 0, z: 10, width: 4 },
    { id: 'p5', op: 'add' as const, value: 5, x: 0, z: 14, width: 4 },
  ];
  const sim = createSim(level({ gates, lane: { width: 10, length: 40 } }), mulberry32(5));
  sim.spawn(Team.Player, UnitKind.Mob, 0, 9.5, 1, { variant: 5, speed: 9, roll: { burstWeight: 50, maxRadius: 1.2 } });
  const r0 = sim.view.radius[0];
  const events = run(sim, 40);
  assert.equal(sim.view.count, 1, 'no clones');
  sim.spawn(Team.Player, UnitKind.Mob, 0, sim.view.posZ[0] + 0.8, 1); // a lone mob ahead, slower than the ball
  run(sim, 30, events);
  assert.equal(sim.view.count, 1, 'the mob was picked up');
  assert.equal(sim.view.weight[0], 8, '1 + 1 (x2) + 5 (+5) + 1 mob');
  assert.ok(sim.view.radius[0] > r0 && sim.view.radius[0] <= 1.2);
  assert.deepEqual(
    of(events, 'gate').map((e) => e.added),
    [1, 5],
  );
  run(sim, 120, events);
  const burst = of(events, 'snowballBurst');
  assert.equal(burst.length, 1);
  assert.equal(burst[0].count, 8);
  assert.ok(burst[0].z >= 40 - 6 && burst[0].z < 40 - 5);
  assert.equal(of(events, 'baseHit').reduce((a, e) => a + e.damage, 0) + sim.totals().player, 8);
});

test('sim m5: a snowball bursts on touching an enemy instead of cancelling', () => {
  const sim = createSim(level(), mulberry32(9));
  sim.spawn(Team.Player, UnitKind.Mob, 0, 10, 1, { speed: 9, roll: { burstWeight: 50, maxRadius: 1.2 } });
  sim.spawn(Team.Player, UnitKind.Mob, 0, 10.3, 5, { spread: 0.2 }); // picked up: weight 6
  sim.spawn(Team.Enemy, UnitKind.Mob, 0, 30, 1);
  const events: SimEvent[] = [];
  for (let s = 0; s < 120 && of(events, 'snowballBurst').length === 0; s++) run(sim, 1, events);
  const burst = of(events, 'snowballBurst');
  assert.equal(burst[0]?.count, 6);
  assert.ok(burst[0].z < 30, 'burst at the enemy, far from the base');
  assert.equal(sim.totals().player, 6, 'the ball itself did not cancel');
  assert.equal(sim.totals().enemy, 1);
});

test('sim m5: 1,500 units on ice in wind with ice walls stay within the step budget', () => {
  const sim = createSim(
    level({
      ice: [{ x: 0, z: 5, width: 10, length: 50 }],
      iceWalls: [{ id: 'a', x: -3, z: 30, width: 3, depth: 1.5 }],
    }),
    mulberry32(99),
  );
  const r = mulberry32(7);
  sim.setWind(2.5);
  const topUp = () => {
    let flip = 0;
    while (sim.view.count < 1495) {
      flip ^= 1;
      if (flip) sim.spawn(Team.Enemy, UnitKind.Mob, (r() * 2 - 1) * 4, 58.5, 5, { spread: 0.8 });
      else sim.spawn(Team.Player, UnitKind.Mob, (r() * 2 - 1) * 4, 1.5, 5, { spread: 0.8 });
    }
  };
  for (let k = 0; k < 150; k++) {
    const enemy = (k & 1) === 1;
    sim.spawn(enemy ? Team.Enemy : Team.Player, UnitKind.Mob, 0, enemy ? 31 + r() * 27 : 1.5 + r() * 28, 10, {
      spread: 4.5,
    });
  }
  const events: SimEvent[] = [];
  run(sim, 30, events);
  let total = 0;
  for (let s = 0; s < 300; s++) {
    topUp();
    events.length = 0;
    const t0 = performance.now();
    sim.step(SIM_DT, events);
    total += performance.now() - t0;
  }
  const avg = total / 300;
  assert.ok(avg < 8, `average step ${avg.toFixed(3)} ms`);
});
