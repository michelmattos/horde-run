// Expedition battle generator: deterministic per spec, always a valid level, room left
// for the gates run upgrades add, elites harder than battles, the Tin General as the
// boss, and a reduced balance check against the 'human' autoplay profile. The full
// tuning table (20+ seeds per row) is in RUN_BATTLE_TARGETS' comment in expedition.ts;
// here a few fixed seeds guard the curve: the first battle is an easy win, a late
// battle and an elite can go either way, and the boss falls to a typical mid-run build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateRunBattle, RUN_BATTLE_TARGETS, RUN_FREE_BANDS } from '../src/game/expedition.ts';
import { LEVELS, getLevelById, validateLevel } from '../src/game/levels.ts';
import { cardsClash } from '../src/game/gateSpacing.ts';
import { applyUpgrades } from '../src/expedition/index.ts';
import { DEFENDER_DEFAULTS } from '../src/contracts.ts';
import type { LevelDef, RunBattleSpec } from '../src/contracts.ts';
import { play } from './balance-play.ts';
import type { PlayResult } from './balance-play.ts';

const SEED = (k: number): number => 1000 + k * 7919; // the seeds used when tuning
const KINDS: RunBattleSpec['kind'][] = ['battle', 'elite'];

function specs(n: number): RunBattleSpec[] {
  const out: RunBattleSpec[] = [];
  for (let k = 0; k < n; k++) {
    const seed = (k * 2654435761) >>> 0;
    out.push(k % 10 === 9 ? { seed, kind: 'boss', index: 4 } : { seed, kind: KINDS[k % 2], index: k % 4 });
  }
  return out;
}

const GATE_MAX = { doubler: 3, supply: 2, fork: 1, tripler: 1 };
const waveTotal = (l: LevelDef): number => l.enemyWaves.reduce((n, w) => n + w.count, 0);

test('generateRunBattle is deterministic per spec and ids follow x{index}-{kind}-{seed % 10000}', () => {
  const spec: RunBattleSpec = { seed: 123456789, kind: 'elite', index: 2 };
  assert.deepEqual(generateRunBattle(spec), generateRunBattle({ ...spec }));
  assert.equal(generateRunBattle(spec).id, 'x2-elite-6789');
  assert.equal(generateRunBattle({ seed: 42, kind: 'boss', index: 4 }).id, 'x4-boss-42');
  const levels = Array.from({ length: 12 }, (_, k) => generateRunBattle({ seed: SEED(k), kind: 'battle', index: 1 }));
  assert.ok(new Set(levels.map((l) => JSON.stringify(l.gates))).size >= 4, 'seeds vary the gate layout');
  assert.ok(new Set(levels.map((l) => l.name)).size >= 4, 'seeds vary the name');
});

test('100 generated battles pass validateLevel unchanged, with names, intros and a target time', () => {
  for (const spec of specs(100)) {
    const level = generateRunBattle(spec);
    assert.deepEqual(validateLevel(JSON.parse(JSON.stringify(level)), level.id), level);
    assert.ok(level.name.length > 0);
    assert.ok(level.targetTime !== undefined);
    assert.equal(level.lane.width, 10);
    assert.ok(level.lane.length >= 55 && level.lane.length <= 65, `${level.id} length ${level.lane.length}`);
    if (spec.kind === 'battle') assert.equal(level.intro, undefined);
    else assert.ok(level.intro, `${level.id} needs an intro`);
    if (spec.kind !== 'boss') assert.equal(level.boss, undefined);
  }
});

test('two 6-unit z-bands of the player half stay free of gates and defenders', () => {
  assert.ok(RUN_FREE_BANDS.length >= 2);
  for (const [a, b] of RUN_FREE_BANDS) assert.ok(b - a >= 6 && a >= 8 && b <= 30);
  for (const spec of specs(100)) {
    const level = generateRunBattle(spec);
    for (const [a, b] of RUN_FREE_BANDS) {
      for (const g of level.gates) assert.ok(g.z < a || g.z > b, `${level.id}: gate ${g.id} at z ${g.z}`);
      for (const d of level.defenders ?? []) {
        const w = d.width ?? (d.kind === 'tower' ? DEFENDER_DEFAULTS.towerWidth : DEFENDER_DEFAULTS.wallWidth);
        const half = (d.kind === 'tower' ? w : DEFENDER_DEFAULTS.wallDepth) / 2;
        assert.ok(d.z + half < a || d.z - half > b, `${level.id}: defender ${d.id} at z ${d.z}`);
      }
    }
  }
});

// Sign cards: in the portrait camera a gate's card hides the card of a gate a few units
// behind it when they overlap in x. Campaign levels, generated battles and the gates run
// upgrades add must all keep such pairs CARD_CLEAR_Z apart.
test('gate sign cards never cover each other, with or without gate upgrades', () => {
  const clash = (l: LevelDef): string | undefined => {
    for (const a of l.gates)
      for (const b of l.gates)
        if (a !== b && cardsClash(a, b)) return `${l.id}: ${a.id} (z ${a.z}) / ${b.id} (z ${b.z})`;
    return undefined;
  };
  for (const l of LEVELS) assert.equal(clash(l), undefined);
  const builds: Record<string, number>[] = [
    { doubler: 3 },
    { supply: 2, doubler: 2 },
    { fork: 1, tripler: 1, doubler: 1 },
    GATE_MAX,
  ];
  for (const spec of specs(300)) {
    const level = generateRunBattle(spec);
    assert.equal(clash(level), undefined);
    for (const b of builds) assert.equal(clash(applyUpgrades(level, b)), undefined);
  }
});

test('run-added gates and mods on a generated battle still validate', () => {
  const level = generateRunBattle({ seed: 77, kind: 'elite', index: 3 });
  const [[a], [b]] = RUN_FREE_BANDS;
  const upgraded: LevelDef = {
    ...level,
    gates: [
      ...level.gates,
      { id: 'up-1', op: 'mul', value: 3, x: -2, z: a + 3, width: 3 },
      { id: 'up-2', op: 'add', value: 15, x: 2, z: b + 3, width: 3.4 },
    ],
    mods: { mobHp: 1.25, knightEvery: 10, burst: { shots: 3, gap: 0.1 }, startCrowd: 20 },
  };
  assert.deepEqual(validateLevel(upgraded, 'upgraded'), upgraded);
});

test('battles scale with index and elites are harder than battles at the same index', () => {
  for (let k = 0; k < 20; k++) {
    const seed = SEED(k);
    const first = generateRunBattle({ seed, kind: 'battle', index: 0 });
    const last = generateRunBattle({ seed, kind: 'battle', index: 3 });
    assert.ok(waveTotal(last) > waveTotal(first), 'more waves later in the run');
    assert.ok((last.enemySpawnRate?.perSecond ?? 0) > (first.enemySpawnRate?.perSecond ?? 0));
    assert.ok((last.defenders?.length ?? 0) > (first.defenders?.length ?? 0));
    for (let index = 0; index < 4; index++) {
      const battle = generateRunBattle({ seed, kind: 'battle', index });
      const elite = generateRunBattle({ seed, kind: 'elite', index });
      assert.ok(
        elite.enemyBase.hp > battle.enemyBase.hp || waveTotal(elite) > waveTotal(battle),
        `elite ${elite.id} is not harder than ${battle.id}`,
      );
      assert.equal(elite.defenders?.length, (battle.defenders?.length ?? 0) + 1, 'one extra defender');
    }
  }
});

test('the boss is the Tin General with the phases of 1-10', () => {
  const src = getLevelById('1-10')!;
  const boss = generateRunBattle({ seed: 2024, kind: 'boss', index: 4 });
  assert.equal(boss.name, 'Tin General');
  assert.equal(boss.boss?.name, src.boss?.name);
  assert.equal(boss.boss?.phases.length, src.boss?.phases.length);
  boss.boss?.phases.forEach((ph, i) => {
    assert.equal(ph.belowHp, src.boss!.phases[i].belowHp);
    assert.deepEqual(ph.strafe, src.boss!.phases[i].strafe);
    assert.equal(ph.summon, src.boss!.phases[i].summon);
  });
  assert.ok(boss.enemyBase.hp > src.enemyBase.hp, 'tuned for a run: upgrades make the player stronger');
  assert.ok(boss.intro);
});

// A typical mid-run build without gate upgrades (Oiled Gears x2, Sharp Bayonets, Pep
// Talk): about a coin toss against the boss (5/12 over seeds 5000 + 7919k since auto-fire).
const MID_RUN = { rapid: 2, sharp: 1, pep: 1 };
const midRun = (level: LevelDef): LevelDef => applyUpgrades(level, MID_RUN);

function checkWin(r: PlayResult, what: string): void {
  assert.equal(r.outcome, 'victory', `${what} should be won`);
  const { min, max } = RUN_BATTLE_TARGETS.winSeconds;
  assert.ok(r.seconds >= min && r.seconds <= max, `${what} won in ${r.seconds.toFixed(0)} s`);
}

test('balance (reduced): first battle easy, late battles and elites a coin toss, boss beatable with a build', () => {
  const battle = (k: number, kind: RunBattleSpec['kind'], index: number): PlayResult =>
    play(generateRunBattle({ seed: SEED(k), kind, index }), 'human', k);

  checkWin(battle(0, 'battle', 0), 'battle 0');
  // Index 3 and elites: tuned to 60-75% and 40-60% wins over 20 seeds; these seeds
  // land on each side, so a shift in either direction breaks this test.
  checkWin(battle(8, 'battle', 3), 'battle 3, seed 8');
  assert.equal(battle(7, 'battle', 3).outcome, 'defeat', 'battle 3, seed 7 should be lost');
  checkWin(battle(4, 'elite', 1), 'elite 1, seed 4');
  assert.equal(battle(0, 'elite', 1).outcome, 'defeat', 'elite 1, seed 0 should be lost');

  const boss = (k: number): PlayResult =>
    play(midRun(generateRunBattle({ seed: 5000 + k * 7919, kind: 'boss', index: 4 })), 'human', k);
  checkWin(boss(4), 'boss with a mid-run build, attempt 4');
  assert.equal(boss(2).outcome, 'defeat', 'boss with a mid-run build, attempt 2 should be lost');
});
