// Balance check: every shipped level played headless with the real sim and the
// autoplay bot. Guards the tuning (L1 winnable, battles 45-150 s, precise play still
// lasting about a minute, a crowd in the hundreds) and determinism.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from '../src/sim/index.ts';
import { createBattle } from '../src/game/battle.ts';
import { createAutoplay } from '../src/game/autoplay.ts';
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

function play(level: LevelDef, seed: number, skill = 0.7) {
  const rand = mulberry32(seed);
  const sim = createSim(level, rand);
  const battle = createBattle(level, sim, rand);
  const bot = createAutoplay(level, { skill });
  const events: SimEvent[] = [];
  let peak = 0;
  for (let s = 0; s < MAX_SECONDS * SIM_HZ && battle.state.outcome === 'playing'; s++) {
    events.length = 0;
    battle.step(bot(battle.state, sim, sim.time), events);
    if (battle.state.playerUnits > peak) peak = battle.state.playerUnits;
  }
  const st = battle.state;
  return { outcome: st.outcome, seconds: st.time, peak, playerBaseHp: st.playerBaseHp, enemyBaseHp: st.enemyBaseHp };
}

for (const [i, level] of LEVELS.entries()) {
  test(`balance: ${level.id} "${level.name}"`, () => {
    const r = play(level, 1);
    console.log(
      `  L${i + 1} ${level.name}: ${r.outcome} in ${r.seconds.toFixed(1)} s, peak ${r.peak} player units, ` +
        `bases player ${r.playerBaseHp.toFixed(0)}/${level.playerBase.hp} enemy ${r.enemyBaseHp.toFixed(0)}/${level.enemyBase.hp}`,
    );
    assert.notEqual(r.outcome, 'playing', 'battle did not finish');
    assert.ok(r.seconds >= 45 && r.seconds <= 150, `battle lasted ${r.seconds.toFixed(1)} s`);
    if (i === 0) assert.equal(r.outcome, 'victory', 'the bot should win the first level');

    // A player whose aim is glued to the finger must not finish in well under a minute.
    const sharp = play(level, 1, 1);
    console.log(`     skill 1: ${sharp.outcome} in ${sharp.seconds.toFixed(1)} s, peak ${sharp.peak} player units`);
    assert.equal(sharp.outcome, 'victory', 'precise play should win');
    assert.ok(sharp.seconds >= 55, `precise play won in ${sharp.seconds.toFixed(1)} s`);
    assert.ok(sharp.peak >= 200, `the crowd peaked at ${sharp.peak} units`);

    const again = play(level, 1);
    assert.equal(again.outcome, r.outcome);
    assert.equal(again.seconds, r.seconds);
  });
}
