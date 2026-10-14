// Balance check: every World 1 level played headless with the real sim and the
// autoplay bot. Guards the tuning (every level winnable by precise play in 55-150 s,
// 1-1 also winnable by a sloppier player) and determinism. Prints one line per level
// so the difficulty ramp is visible when tuning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/index.ts';
import { createBattle } from '../src/game/battle.ts';
import { createAutoplay } from '../src/game/autoplay.ts';
import { evaluateStars } from '../src/game/stars.ts';
import { LEVELS } from '../src/game/levels.ts';
import { SIM_HZ } from '../src/contracts.ts';
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

const MAX_SECONDS = 180;

function play(level: LevelDef, seed: number, skill: number) {
  const rand = mulberry32(seed);
  const sim = createSim(level, rand);
  const battle = createBattle(level, sim, rand);
  const bot = createAutoplay(level, { skill });
  const events: SimEvent[] = [];
  let peak = 0;
  let destroyed = 0;
  let missed = 0;
  for (let s = 0; s < MAX_SECONDS * SIM_HZ && battle.state.outcome === 'playing'; s++) {
    const input = bot(battle.state, sim, sim.time, events); // the bot sees last step's events
    events.length = 0;
    battle.step(input, events);
    for (const e of events) {
      if (e.type === 'defenderDestroyed') destroyed++;
      else if (e.type === 'baseMiss') missed += e.count;
    }
    if (battle.state.playerUnits > peak) peak = battle.state.playerUnits;
  }
  const st = battle.state;
  return {
    outcome: st.outcome,
    seconds: battle.stats.endTime ?? st.time,
    peak,
    playerBase: st.playerBaseHp / st.playerBaseMaxHp,
    stars: evaluateStars(level, st, battle.stats),
    destroyed,
    missed,
  };
}

for (const level of LEVELS) {
  test(`balance: ${level.id} "${level.name}"`, () => {
    const r = play(level, 1, 1);
    const stars = r.stars.map((s) => (s ? '*' : '.')).join('');
    console.log(
      `  ${level.id.padEnd(5)} ${level.name.padEnd(16)} skill 1: ${r.outcome} in ${r.seconds.toFixed(1)} s, peak ${r.peak}, ` +
        `base ${(r.playerBase * 100).toFixed(0)}%, stars ${stars}, defenders broken ${r.destroyed}, misses ${r.missed}`,
    );
    assert.equal(r.outcome, 'victory', 'precise play should win');
    assert.ok(r.seconds >= 55 && r.seconds <= 150, `battle lasted ${r.seconds.toFixed(1)} s`);

    if (level.id === '1-1') {
      const casual = play(level, 1, 0.7);
      console.log(`        skill 0.7: ${casual.outcome} in ${casual.seconds.toFixed(1)} s`);
      assert.equal(casual.outcome, 'victory', 'the first level should be won by a sloppier player too');
    }

    const again = play(level, 1, 1);
    assert.deepEqual(again, r);
  });
}

// The ramp: a decent (not perfect) player, skill 0.8, wins every level on every seed,
// and the base HP left over falls from the opening levels to the closing ones. Guards
// against a single-level cliff (1-9 once needed near-perfect aim to thread its gate).
test('balance: skill 0.8 wins every level and the base-HP margin ramps down', () => {
  const seeds = [1, 2, 3];
  const margins = LEVELS.map((level) => {
    const runs = seeds.map((seed) => play(level, seed, 0.8));
    for (const [k, r] of runs.entries()) {
      assert.equal(r.outcome, 'victory', `${level.id} seed ${seeds[k]} lost at skill 0.8 after ${r.seconds.toFixed(0)} s`);
    }
    return runs.reduce((sum, r) => sum + r.playerBase, 0) / runs.length;
  });
  console.log(`  skill 0.8 base margins: ${margins.map((m, i) => `${LEVELS[i].id} ${(m * 100).toFixed(0)}%`).join(', ')}`);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const opening = mean(margins.slice(0, 3));
  const closing = mean(margins.slice(-3));
  assert.ok(opening - closing >= 0.12, `opening ${opening.toFixed(2)} vs closing ${closing.toFixed(2)}: no visible ramp`);
  // No later level may be easier than the opening ones.
  for (const [i, m] of margins.entries()) {
    if (i < 3) continue;
    assert.ok(m <= opening + 0.05, `${LEVELS[i].id} is easier (${m.toFixed(2)}) than the opening levels (${opening.toFixed(2)})`);
  }
});
