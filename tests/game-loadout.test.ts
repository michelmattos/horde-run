// Milestone 4 loadouts in the battle layer: the slot mix, spec stats and variants on
// spawns, the loadout champion, the ultimate meter and each ultimate's effect, cue
// emission, determinism, the autoplay pressing the ultimate, and no change at all
// without a loadout (golden numbers recorded from the Milestone 3 battle).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, ULTIMATE } from '../src/game/battle.ts';
import type { BattleCue, BattleSim, BattleSpawnOpts } from '../src/game/battle.ts';
import { DEFAULT_BATTLE_LOADOUT } from '../src/game/loadout.ts';
import type { BattleLoadout, MobSpec } from '../src/game/loadout.ts';
import { getLevelById } from '../src/game/levels.ts';
import { createSim } from '../src/sim/index.ts';
import { LAYOUT, SIM_DT, SIM_HZ, Team, UnitKind } from '../src/contracts.ts';
import type { InputState, LevelDef, SimEvent, SimView } from '../src/contracts.ts';
import { play } from './balance-play.ts';

interface SpawnRec {
  team: Team;
  kind: UnitKind;
  x: number;
  z: number;
  count: number;
  opts?: BattleSpawnOpts;
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

function fakeSim(): { sim: BattleSim; spawns: SpawnRec[]; blasts: { x: number; z: number; radius: number }[] } {
  const spawns: SpawnRec[] = [];
  const blasts: { x: number; z: number; radius: number }[] = [];
  let time = 0;
  const sim: BattleSim = {
    view: emptyView,
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
    takeBlasts(out) {
      out.push(...blasts);
      blasts.length = 0;
    },
  };
  return { sim, spawns, blasts };
}

function level(over: Partial<LevelDef> = {}): LevelDef {
  return {
    id: 'lo',
    name: 'Loadout',
    lane: { width: 10, length: 60 },
    cannon: { fireRate: 6, unitsPerShot: 3, aimLimit: 4 },
    playerBase: { hp: 100 },
    enemyBase: { hp: 150, x: 0, width: 6 },
    gates: [],
    enemyWaves: [],
    champion: { chargeNeeded: 30, hp: 100, damage: 80 },
    ...over,
  };
}

const input = (over: Partial<InputState & { ultimatePressed: boolean }> = {}) => ({
  aimX: 0,
  firing: false,
  championPressed: false,
  paused: false,
  ...over,
});
const rand = () => 0.5;
const player = (s: SpawnRec[]) => s.filter((r) => r.team === Team.Player);

// Tier-0 item values (progression's catalog) used as fixtures.
const SPRINTER: MobSpec = {
  id: 'sprinter',
  variant: 2,
  kind: 'mob',
  perShot: null,
  hp: 0.7,
  damage: 0.8,
  radius: 0.24,
  speed: 10,
};
const BOMBER: MobSpec = {
  id: 'bomber',
  variant: 3,
  kind: 'mob',
  perShot: 1,
  hp: 2,
  damage: 1,
  radius: 0.32,
  speed: 6,
  deathBlast: { radius: 1.4, damage: 4 },
};
const D = DEFAULT_BATTLE_LOADOUT;
const loadout = (over: Partial<BattleLoadout> = {}): BattleLoadout => ({ ...D, ...over });

// Steps until `n` cannon shots have been fired (one 'shot' cue each).
function fireShots(b: ReturnType<typeof createBattle>, n: number, cues: BattleCue[]): void {
  let shots = 0;
  for (let s = 0; s < 10 * SIM_HZ && shots < n; s++) {
    const before = cues.length;
    b.step(input({ firing: true }), [], cues);
    shots += cues.slice(before).filter((c) => c.type === 'shot').length;
  }
}

test('loadout: a fixed-count mob in slot 1 is still the mix; fractional counts carry over', () => {
  const f = fakeSim();
  // Knight first: fired as the mix all the same, and a cannon-scaled 0.5 knight per mix
  // shot makes every other mix shot a knight (the empty ones fire riflemen).
  const lo = loadout({ mobs: [{ ...D.mobs[1], perShot: 0.5 }, D.mobs[0]], mixEvery: 2 });
  const b = createBattle(level(), f.sim, rand, lo);
  fireShots(b, 8, []);
  assert.deepEqual(
    player(f.spawns).map((r) => [r.kind, r.count]),
    [0, 1, 0, 0, 0, 1, 0, 0].map((k) => (k ? [UnitKind.Champion, 1] : [UnitKind.Mob, 3])),
  );
});

test('loadout: slot 1 every shot, slot 2 on every mixEvery-th shot, with each spec on the spawn', () => {
  const f = fakeSim();
  const lo = loadout({ mobs: [SPRINTER, D.mobs[1]], mixEvery: 3 });
  const b = createBattle(level(), f.sim, rand, lo);
  const cues: BattleCue[] = [];
  fireShots(b, 9, cues);
  const shots = player(f.spawns);
  assert.deepEqual(
    shots.map((r) => [r.kind, r.count]),
    [0, 0, 1, 0, 0, 1, 0, 0, 1].map((k) => (k ? [UnitKind.Champion, 1] : [UnitKind.Mob, 3])),
  );
  const m = shots[0].opts!;
  assert.deepEqual([m.hp, m.damage, m.radius, m.speed, m.variant], [0.7, 0.8, 0.24, 10, 2]);
  const k = shots[2].opts!;
  assert.deepEqual([k.hp, k.damage, k.radius, k.speed, k.variant], [10, 10, 0.55, 5.5, 1]);
  assert.equal(b.stats.mobsFired, 6 * 3 + 3);
  assert.deepEqual(
    cues.filter((c) => c.type === 'shot').map((c) => (c.type === 'shot' ? c.count : 0)),
    [3, 3, 1, 3, 3, 1, 3, 3, 1],
  );
});

test('loadout: a bomber slot passes its death blast; mods still apply on top', () => {
  const f = fakeSim();
  const lv = level({ mods: { mobHp: 2, shotSpread: 0.9, knightEvery: 5 } });
  const b = createBattle(lv, f.sim, rand, loadout({ mobs: [D.mobs[0], BOMBER], mixEvery: 2 }));
  fireShots(b, 2, []);
  const shots = player(f.spawns);
  // Shot 1: three riflemen (hp x2 from mods, spread 0.9); shot 2: the bomber.
  assert.deepEqual(
    shots.map((r) => [r.kind, r.count]),
    [
      [UnitKind.Mob, 3],
      [UnitKind.Mob, 1],
    ],
  );
  assert.equal(shots[0].opts!.hp, 2);
  assert.equal(shots[0].opts!.spread, 0.9);
  const bomb = shots[1].opts!;
  assert.deepEqual(bomb.deathBlast, { radius: 1.4, damage: 4 });
  assert.equal(bomb.variant, 3);
  assert.equal(bomb.hp, 4, 'mobHp scales a mob slot');
  fireShots(b, 1, []); // mobs 5..7: the 5th is a mods knight
  assert.deepEqual(
    player(f.spawns)
      .slice(2)
      .map((r) => [r.kind, r.count]),
    [
      [UnitKind.Mob, 2],
      [UnitKind.Champion, 1],
    ],
  );
});

test('loadout: champion charge, stats, radius, speed, variant and echo come from the champion spec', () => {
  const f = fakeSim();
  const drummer = {
    id: 'drummer',
    variant: 10,
    hpMul: 0.75,
    damageMul: 0.8,
    radius: 0.9,
    speed: 5,
    chargeMul: 0.5,
    echo: 24,
  };
  const b = createBattle(level({ mods: { championEcho: 2 } }), f.sim, rand, loadout({ champion: drummer }));
  // chargeNeeded 30 x 0.5 = 15 mobs: five 3-mob shots (no slot 2 before the 10th shot).
  fireShots(b, 4, []);
  assert.ok(b.state.championCharge < 1);
  fireShots(b, 1, []);
  assert.ok(Math.abs(b.state.championCharge - 1) < 1e-9);
  f.spawns.length = 0;
  const events: SimEvent[] = [];
  b.step(input({ championPressed: true }), events);
  const champ = f.spawns.find((r) => r.kind === UnitKind.Champion)!;
  assert.deepEqual(champ.opts, { hp: 75, damage: 64, radius: 0.9, speed: 5, variant: 10 });
  const echo = f.spawns.find((r) => r.kind === UnitKind.Mob)!;
  assert.equal(echo.count, 26, 'drummer echo plus the mods echo');
  assert.equal(echo.opts!.variant, 0);
  assert.equal(b.state.championCharge, 0);
  assert.ok(events.some((e) => e.type === 'championLaunched'));
});

test('ultimate: fills with mobs fired, only fires when full, resets, and barrage spreads slot-1 mobs', () => {
  const f = fakeSim();
  const lo = loadout({ ultimate: { id: 'barrage', chargeNeeded: 12, power: 30 }, mixEvery: 0 });
  const b = createBattle(level(), f.sim, rand, lo);
  assert.equal(b.hasUltimate, true);
  assert.equal(b.ultimateCharge, 0);
  fireShots(b, 2, []);
  assert.ok(Math.abs(b.ultimateCharge - 0.5) < 1e-9);
  f.spawns.length = 0;
  const cues: BattleCue[] = [];
  b.step(input({ ultimatePressed: true }), [], cues);
  assert.equal(f.spawns.length, 0, 'half a meter does nothing');
  fireShots(b, 2, []);
  assert.equal(b.ultimateCharge, 1);
  f.spawns.length = 0;
  b.step(input({ ultimatePressed: true, aimX: 2 }), [], cues);
  assert.equal(b.ultimateCharge, 0);
  assert.equal(b.stats.ultimatesFired, 1);
  const s = player(f.spawns)[0];
  assert.deepEqual([s.kind, s.count, s.x, s.z, s.opts!.spread], [UnitKind.Mob, 30, 0, LAYOUT.cannonZ + 2, 4]);
  assert.deepEqual(cues, [{ type: 'ultimate', id: 'barrage', x: 0, z: LAYOUT.cannonZ + 2, radius: 4, duration: 0 }]);
  // A heavy main mob (two fixed-count mobs, a knight the lighter) sends the same hp as knights.
  const g = fakeSim();
  const hb = createBattle(level(), g.sim, rand, { ...lo, mobs: [{ ...D.mobs[1], hp: 20 }, D.mobs[1]] });
  fireShots(hb, 40, []);
  g.spawns.length = 0;
  hb.step(input({ ultimatePressed: true }), []);
  assert.deepEqual([g.spawns[0].kind, g.spawns[0].count], [UnitKind.Champion, 3]);
});

test('ultimate: paratroopers land over one second around the aim at 55% of the lane, inside it', () => {
  const f = fakeSim();
  const lo = loadout({ ultimate: { id: 'paratroopers', chargeNeeded: 3, power: 40 }, mixEvery: 0 });
  const b = createBattle(level(), f.sim, rand, lo);
  fireShots(b, 1, []);
  f.spawns.length = 0;
  const cues: BattleCue[] = [];
  b.step(input({ ultimatePressed: true, aimX: 4 }), [], cues);
  for (let s = 0; s < 2 * SIM_HZ; s++) b.step(input({ aimX: 4 }), []);
  const drops = player(f.spawns);
  const edge = 5 - ULTIMATE.paraSpread;
  assert.equal(
    drops.reduce((n, r) => n + r.count, 0),
    40,
  );
  assert.ok(drops.length >= 30 && drops.length <= SIM_HZ, `${drops.length} drop steps`);
  for (const r of drops) assert.deepEqual([r.x, r.z, r.opts!.spread], [edge, 33, ULTIMATE.paraSpread]);
  assert.deepEqual(cues, [
    { type: 'ultimate', id: 'paratroopers', x: edge, z: 33, radius: ULTIMATE.paraSpread, duration: 1 },
  ]);
});

test('ultimate: the marble rolls up the line removing `power` enemy weight, bumps defenders, spares the base', () => {
  const lv = level({
    defenders: [{ id: 'w', kind: 'wall', x: 2, z: 30, hp: 200 }],
    enemyBase: { hp: 150, x: 0, width: 6 },
  });
  const sim = createSim(lv, rand);
  const lo = loadout({ ultimate: { id: 'marble', chargeNeeded: 3, power: 20 }, mixEvery: 0 });
  const b = createBattle(lv, sim, rand, lo);
  b.step(input({ firing: true, aimX: -4 }), []); // one shot (well off the line) fills the meter
  // Enemies standing still in single file on the marble's line (x = 2), and some off it.
  for (let k = 0; k < 12; k++) {
    sim.spawn(Team.Enemy, UnitKind.Mob, 2, 20 + 0.6 * k, 1, { speed: 0.001 });
    sim.spawn(Team.Enemy, UnitKind.Mob, 2, 40 + 0.6 * k, 1, { speed: 0.001 });
  }
  for (let k = 0; k < 6; k++) sim.spawn(Team.Enemy, UnitKind.Mob, -1, 20 + 0.6 * k, 1, { speed: 0.001 });
  const cues: BattleCue[] = [];
  const enemyBefore = sim.totals().enemy;
  b.step(input({ ultimatePressed: true, aimX: 2 }), [], cues);
  const end = lv.lane.length - ULTIMATE.marbleStop;
  assert.deepEqual(
    cues.filter((c) => c.type === 'ultimate'),
    [
      {
        type: 'ultimate',
        id: 'marble',
        x: 2,
        z: LAYOUT.cannonZ,
        radius: ULTIMATE.marbleRadius,
        duration: (end - LAYOUT.cannonZ) / ULTIMATE.marbleSpeed,
      },
    ],
  );
  for (let s = 0; s < 6 * SIM_HZ; s++) b.step(input({ aimX: 2 }), []);
  const removed = enemyBefore - sim.totals().enemy;
  assert.ok(Math.abs(removed - 20) < 1e-6, `removed ${removed}`);
  assert.equal(sim.totals().enemy, 4 + 6, 'the rest of the far group and everything off the line remain');
  assert.equal(sim.defenders[0].hp, 200 - 20 * ULTIMATE.marbleDefender, 'the wall was bumped once');
  assert.equal(b.state.enemyBaseHp, 150, 'the marble never hits the base');
});

test('cues: a blast cue per sim blast; nothing is pushed without a cue array', () => {
  const f = fakeSim();
  const b = createBattle(level(), f.sim, rand, D);
  f.blasts.push({ x: 1, z: 20, radius: 1.4 }, { x: -1, z: 22, radius: 1.4 });
  const cues: BattleCue[] = [];
  b.step(input(), [], cues);
  assert.deepEqual(cues, [
    { type: 'blast', x: 1, z: 20, radius: 1.4 },
    { type: 'blast', x: -1, z: 22, radius: 1.4 },
  ]);
  b.step(input({ firing: true }), []); // no cue array: fine, nothing to push to
});

test('loadout battles are deterministic for a seed, and the autoplay uses the ultimate', () => {
  const lv = getLevelById('1-4')!;
  const a = play(lv, 'human', 1, D);
  assert.deepEqual(a, play(lv, 'human', 1, D));
  assert.ok(a.ultimates > 0, 'the bot pressed the ultimate');
  assert.equal(play(lv, 1, 0).ultimates, 0, 'no loadout, no ultimate');
});

test('no loadout: the battle plays exactly as in Milestone 3, and cues only observe', () => {
  // Golden numbers recorded from main before loadouts existed (Milestone 3 plus the
  // auto-firing cannon), re-recorded after the Milestone 5 rebalance of the level data.
  const r = play(getLevelById('1-6')!, 'human', 2);
  assert.deepEqual([r.outcome, r.seconds, r.peak, r.fired, r.playerBase], ['defeat', 81.9666666666633, 450, 1416, 0]);
  const r10 = play(getLevelById('1-10')!, 'human', 2);
  assert.deepEqual(
    [r10.outcome, r10.seconds, r10.peak, r10.fired, r10.enemyBase],
    ['defeat', 80.14999999999674, 516, 1347, 0.1135],
  );
  // Passing a cue array changes nothing but the cues.
  const lv = getLevelById('1-2')!;
  const run = (withCues: boolean) => {
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const sim = createSim(lv, rnd);
    const b = createBattle(lv, sim, rnd);
    const cues: BattleCue[] = [];
    for (let s = 0; s < 20 * SIM_HZ; s++) b.step(input({ firing: true }), [], withCues ? cues : undefined);
    return { state: { ...b.state }, cues, hasUltimate: b.hasUltimate, charge: b.ultimateCharge };
  };
  const plain = run(false);
  const cued = run(true);
  assert.deepEqual(cued.state, plain.state);
  assert.equal(plain.hasUltimate, false);
  assert.equal(plain.charge, 0);
  assert.ok(cued.cues.length > 0 && cued.cues.every((c) => c.type === 'shot'));
  assert.ok(SIM_DT > 0);
});
