// Expedition World 2 pieces: the freezer gate layouts (freezing gates, a fork split by an
// ice wall, an ice-wall chokepoint), the Snow Globe Giant as a second run boss, and the
// five World 2 upgrades on every template combination. Sweeps compose battles straight
// from template picks, so every layout, defender set and lane is covered, mirrored too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RUN_FREE_BANDS,
  RUN_TEMPLATE_COUNTS,
  composeRunBattle,
  composeRunBoss,
  generateRunBattle,
  runBossModel,
} from '../src/game/expedition.ts';
import type { RunBattlePicks } from '../src/game/expedition.ts';
import { applyUpgrades } from '../src/expedition/index.ts';
import { cardsClash } from '../src/game/gateSpacing.ts';
import { validateLevel } from '../src/game/levels.ts';
import { DEFENDER_DEFAULTS } from '../src/contracts.ts';
import type { DefenderDef, GateDef, IceWallDef, LevelDef, RunBattleSpec } from '../src/contracts.ts';

type Build = Readonly<Record<string, number>>;

// Every lane x gate layout x defender set, both mirrors, at index 0 and as a late elite
// (the most defenders); the wave pattern only scales numbers, so one is enough.
function everyBattle(): LevelDef[] {
  const out: LevelDef[] = [];
  const specs: RunBattleSpec[] = [
    { seed: 11, kind: 'battle', index: 0 },
    { seed: 12, kind: 'elite', index: 3 },
  ];
  for (const spec of specs)
    for (let lane = 0; lane < RUN_TEMPLATE_COUNTS.lanes; lane++)
      for (let gates = 0; gates < RUN_TEMPLATE_COUNTS.gates; gates++)
        for (let defenders = 0; defenders < RUN_TEMPLATE_COUNTS.defenders; defenders++)
          for (const mirror of [false, true]) {
            const picks: RunBattlePicks = { lane, gates, defenders, waves: (lane + gates) % 3, mirror, name: 0 };
            out.push(composeRunBattle(spec, picks));
          }
  return out;
}
const BATTLES = everyBattle();
const BOSSES = [0, 1, 2, 3].flatMap((k) =>
  (['tinGeneral', 'snowGlobeGiant'] as const).map((m) => composeRunBoss({ seed: 900 + k, kind: 'boss', index: 4 }, m)),
);

const added = (l: LevelDef): GateDef[] => l.gates.filter((g) => g.id.startsWith('up-'));
const reach = (g: GateDef): number => g.width / 2 + Math.abs(g.move?.amplitude ?? 0);

function defenderBox(d: DefenderDef): { x: number; z: number; hw: number; hd: number } {
  const w =
    d.width ??
    (d.kind === 'tower' ? DEFENDER_DEFAULTS.towerWidth : d.kind === 'wall' ? DEFENDER_DEFAULTS.wallWidth : 3);
  const depth = d.kind === 'tower' ? w : d.kind === 'wall' ? DEFENDER_DEFAULTS.wallDepth : 1.6;
  return { x: d.x, z: d.z, hw: w / 2, hd: depth / 2 };
}
const overlaps = (a: { x: number; z: number; hw: number; hd: number }, w: IceWallDef): boolean =>
  Math.abs(a.x - w.x) < a.hw + w.width / 2 && Math.abs(a.z - w.z) < a.hd + w.depth / 2;

test('the freezer layouts bring freezing gates, a fork with an ice-wall divider and a chokepoint', () => {
  const freezer = BATTLES.filter((l) => l.theme === 'freezer');
  assert.ok(freezer.length > 0 && freezer.length < BATTLES.length, 'some layouts play in the freezer, not all');
  assert.ok(
    freezer.some((l) => l.gates.some((g) => g.freeze)),
    'a layout with freezing gates',
  );
  assert.ok(
    freezer.some((l) => (l.iceWalls?.length ?? 0) >= 2),
    'a chokepoint layout',
  );
  for (const l of BATTLES) {
    if (l.theme !== 'freezer') {
      if (l.theme === undefined)
        assert.equal(l.ice ?? l.iceWalls ?? l.trickleMix, undefined, `${l.id}: World 1 layouts stay as they were`);
      continue;
    }
    // Forks: gates sharing an id stand on one z line, apart, with a divider between them.
    const forks = new Map<string, GateDef[]>();
    for (const g of l.gates) if (g.fork) forks.set(g.fork, [...(forks.get(g.fork) ?? []), g]);
    for (const [id, gs] of forks) {
      assert.equal(gs.length, 2, `${l.id} fork ${id}`);
      const [a, b] = gs;
      assert.equal(a.z, b.z);
      assert.ok(Math.abs(a.x - b.x) >= reach(a) + reach(b), `${l.id}: fork gates overlap`);
      const divider = (l.iceWalls ?? []).find(
        (w) => Math.abs(w.z - a.z) < w.depth / 2 && w.x > Math.min(a.x, b.x) && w.x < Math.max(a.x, b.x),
      );
      assert.ok(divider, `${l.id}: fork ${id} has an ice wall between its gates`);
    }
  }
});

test('ice walls stay inside the lane, out of the free bands and off gates and defenders', () => {
  for (const l of [...BATTLES, ...BOSSES]) {
    for (const w of l.iceWalls ?? []) {
      assert.ok(Math.abs(w.x) + w.width / 2 <= l.lane.width / 2 + 1e-9, `${l.id}: ${w.id} outside the lane`);
      if (l.boss === undefined)
        for (const [a, b] of RUN_FREE_BANDS)
          assert.ok(w.z + w.depth / 2 < a || w.z - w.depth / 2 > b, `${l.id}: ${w.id} in a free band`);
      for (const d of l.defenders ?? []) assert.ok(!overlaps(defenderBox(d), w), `${l.id}: ${w.id} on ${d.id}`);
      for (const g of l.gates)
        assert.ok(!overlaps({ x: g.x, z: g.z, hw: reach(g), hd: 0.3 }, w), `${l.id}: ${w.id} on gate ${g.id}`);
    }
    for (const p of l.ice ?? []) assert.ok(Math.abs(p.x) + p.width / 2 <= l.lane.width / 2 + 1e-9);
  }
});

test('an owned Frost Gate always finds a spot and never clashes, on every template', () => {
  for (const base of [...BATTLES, ...BOSSES]) {
    for (const build of [
      { 'frost-gate': 1 },
      { 'frost-gate': 1, tripler: 1, fork: 1, supply: 2, doubler: 3 },
    ] as Build[]) {
      const out = applyUpgrades(base, build);
      const frost = out.gates.filter((g) => g.id.startsWith('up-frost-gate'));
      if (Object.keys(build).length === 1) assert.equal(frost.length, 1, `${base.id}: no room for the Frost Gate`);
      for (const g of frost) assert.ok(g.freeze && g.op === 'mul', `${base.id}: ${g.id} is not a freezing multiplier`);
      for (const g of added(out)) {
        assert.ok(g.z >= 6 && g.z <= out.lane.length / 2, `${base.id}: ${g.id} at z ${g.z}`);
        for (const o of out.gates) {
          if (o === g) continue;
          const sideBySide = o.z === g.z && Math.abs(o.x - g.x) >= reach(o) + reach(g) + 0.3;
          assert.ok(sideBySide || Math.abs(o.z - g.z) >= 3, `${base.id}: ${g.id} too close to ${o.id}`);
          assert.ok(!cardsClash(o, g), `${base.id}: ${g.id} and ${o.id} cover each other's sign`);
        }
        for (const w of out.iceWalls ?? [])
          assert.ok(!overlaps({ x: g.x, z: g.z, hw: reach(g), hd: 0.5 }, w), `${base.id}: ${g.id} in ice wall ${w.id}`);
        for (const d of out.defenders ?? []) assert.ok(Math.abs(d.z - g.z) >= 2.5, `${base.id}: ${g.id} by ${d.id}`);
      }
    }
  }
});

test('with each World 2 upgrade owned, every generated battle and both bosses stay valid', () => {
  const builds: Build[] = [{ 'frost-gate': 1 }, { rink: 1 }, { skates: 2 }, { cocoa: 1 }, { avalanche: 2 }];
  const all: Build = {
    'frost-gate': 1,
    rink: 1,
    skates: 2,
    cocoa: 1,
    avalanche: 2,
    chest: 1,
    overcharge: 1,
    doubler: 3,
  };
  for (const base of [...BATTLES, ...BOSSES]) {
    for (const build of [...builds, all]) {
      const out = applyUpgrades(base, build);
      const back = validateLevel(JSON.parse(JSON.stringify(out)), out.id);
      assert.deepEqual(back, out, `${base.id} ${Object.keys(build).join(',')}`);
    }
  }
});

test('the run boss is the Tin General, the Snow Globe Giant or the Jack-in-the-Box, picked by the seed', () => {
  const tally = { tinGeneral: 0, snowGlobeGiant: 0, jackInTheBox: 0 };
  for (let k = 0; k < 400; k++) {
    const seed = (k * 2654435761) >>> 0;
    const model = runBossModel(seed);
    tally[model]++;
    assert.equal(runBossModel(seed), model, 'deterministic');
    const boss = generateRunBattle({ seed, kind: 'boss', index: 4 });
    assert.equal(boss.boss?.model ?? 'tinGeneral', model);
  }
  assert.ok(
    Object.values(tally).every((n) => n > 100),
    JSON.stringify(tally),
  );
});

test('the Snow Globe Giant: freezer boss with its own phases (lob, frozen gates, gusts)', () => {
  const boss = composeRunBoss({ seed: 2024, kind: 'boss', index: 4 }, 'snowGlobeGiant');
  assert.equal(boss.name, 'Snow Globe Giant');
  assert.equal(boss.theme, 'freezer');
  assert.equal(boss.boss?.model, 'snowGlobeGiant');
  const [p1, p2, p3] = boss.boss!.phases;
  assert.equal(boss.boss!.phases.length, 3);
  assert.ok(p1.lob && !p1.freezeGates && !p1.gusts, 'phase 1 lobs snowballs');
  assert.ok(p2.freezeGates && p2.belowHp < p1.belowHp, 'phase 2 freezes the gates');
  assert.ok(p3.gusts && p3.belowHp < p2.belowHp, 'phase 3 adds gusts');
  assert.ok(
    boss.enemyWaves.some((w) => w.unit === 'snowman'),
    'snowmen march with it',
  );
  assert.ok(boss.intro && boss.targetTime);
  // Not the campaign's 2-10: the run boss is built from its own template.
  const mirrored = [0, 1, 2, 3, 4, 5].map((k) =>
    composeRunBoss({ seed: 7 + k, kind: 'boss', index: 4 }, 'snowGlobeGiant'),
  );
  assert.ok(new Set(mirrored.map((l) => JSON.stringify(l.gates.map((g) => g.x)))).size === 2, 'seeds mirror the lane');
});
