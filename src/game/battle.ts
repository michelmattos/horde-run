// Battle rules on top of the crowd sim (concept §2 core loop): the cannon fires player
// mobs, the charge meter launches a champion, enemy waves and a trickle come down the
// lane, base hits drain base HP and the first base to fall decides the outcome.
//
// Pure TypeScript: no Babylon, no src/core. Randomness is injected as `rand`, and the
// sim is reached through the structural BattleSim interface so tests can fake it.
// step() allocates nothing except the event objects it pushes.

import type { BattleState, InputState, LevelDef, SimEvent, SimView } from '../contracts.ts';
import { LAYOUT, SIM_DT, Team, UnitKind } from '../contracts.ts';

export interface BattleSim {
  readonly view: SimView;
  readonly time: number;
  spawn(
    team: Team,
    kind: UnitKind,
    x: number,
    z: number,
    count: number,
    opts?: { hp?: number; damage?: number; radius?: number; spread?: number },
  ): void;
  step(dt: number, events: SimEvent[]): void; // baseHit.team = owner of the base that was hit
  totals(): { player: number; enemy: number };
}

export interface Battle {
  readonly level: LevelDef;
  readonly state: BattleState; // same object every step, mutated in place
  readonly cannonX: number;
  step(input: InputState, events: SimEvent[]): void; // one fixed SIM_DT step; no-op when paused
}

const SHOT_SPREAD = 0.3; // x jitter half-width when a shot holds several mobs
const DEFAULT_WAVE_INTERVAL = 0.05;
const EPS = 1e-9; // absorbs float drift in accumulators so steady rates stay exact

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function createBattle(level: LevelDef, sim: BattleSim, rand: () => number): Battle {
  const state: BattleState = {
    time: 0,
    playerBaseHp: level.playerBase.hp,
    playerBaseMaxHp: level.playerBase.hp,
    enemyBaseHp: level.enemyBase.hp,
    enemyBaseMaxHp: level.enemyBase.hp,
    championCharge: 0,
    playerUnits: 0,
    enemyUnits: 0,
    outcome: 'playing',
  };

  const shotInc = level.cannon.fireRate * SIM_DT; // shots accrued per step
  const chargePerMob = 1 / level.champion.chargeNeeded;
  const enemyZ = level.lane.length - LAYOUT.enemySpawnInset;
  const waves = level.enemyWaves;
  const waveSpawned = new Int32Array(waves.length);

  let cannonX = 0;
  let steps = 0; // battle clock in whole steps, so wave timing never drifts
  // Starts primed one step short of a shot: the first press fires on its first step,
  // and the cap below stops tap-spamming from beating the fire rate.
  let shotAcc = 1 - shotInc;
  let trickleAcc = 0;

  function fire(): void {
    const n = level.cannon.unitsPerShot;
    sim.spawn(Team.Player, UnitKind.Mob, cannonX, LAYOUT.cannonZ, n, { spread: SHOT_SPREAD });
    state.championCharge = Math.min(1, state.championCharge + n * chargePerMob);
  }

  function spawnEnemy(x: number): void {
    sim.spawn(Team.Enemy, UnitKind.Mob, x, enemyZ, 1);
  }

  function spawnEnemies(t: number): void {
    for (let w = 0; w < waves.length; w++) {
      const wave = waves[w];
      const done = waveSpawned[w];
      if (done >= wave.count || t + EPS < wave.at) continue;
      const interval = wave.interval ?? DEFAULT_WAVE_INTERVAL;
      const due = interval > 0 ? Math.min(wave.count, Math.floor((t - wave.at) / interval + EPS) + 1) : wave.count;
      for (let k = done; k < due; k++) spawnEnemy(wave.x + (rand() * 2 - 1) * wave.spread);
      waveSpawned[w] = due;
    }

    const trickle = level.enemySpawnRate;
    if (trickle && t + EPS >= trickle.startAt) {
      trickleAcc += trickle.perSecond * SIM_DT;
      const eb = level.enemyBase;
      while (trickleAcc >= 1 - EPS) {
        trickleAcc -= 1;
        spawnEnemy(eb.x + (rand() * 2 - 1) * (eb.width / 2));
      }
    }
  }

  function step(input: InputState, events: SimEvent[]): void {
    if (input.paused) return;
    const t = steps * SIM_DT;
    steps++;
    const playing = state.outcome === 'playing';

    const lim = level.cannon.aimLimit;
    cannonX = clamp(input.aimX, -lim, lim);

    if (playing) {
      shotAcc += shotInc;
      if (input.firing) {
        while (shotAcc >= 1 - EPS) {
          shotAcc -= 1;
          fire();
        }
      } else if (shotAcc > 1 - shotInc) {
        shotAcc = 1 - shotInc;
      }

      if (input.championPressed && state.championCharge >= 1 - EPS) {
        sim.spawn(Team.Player, UnitKind.Champion, cannonX, LAYOUT.cannonZ, 1, {
          hp: level.champion.hp,
          damage: level.champion.damage,
        });
        state.championCharge = 0;
        events.push({ type: 'championLaunched', x: cannonX });
      }

      spawnEnemies(t);
    }

    const first = events.length;
    sim.step(SIM_DT, events);
    if (playing) {
      for (let i = first; i < events.length; i++) {
        const e = events[i];
        if (e.type !== 'baseHit') continue;
        if (e.team === Team.Enemy) state.enemyBaseHp = Math.max(0, state.enemyBaseHp - e.damage);
        else state.playerBaseHp = Math.max(0, state.playerBaseHp - e.damage);
      }
    }

    state.time = sim.time;
    const totals = sim.totals();
    state.playerUnits = totals.player;
    state.enemyUnits = totals.enemy;

    if (playing) {
      if (state.enemyBaseHp <= 0) {
        state.outcome = 'victory';
        events.push({ type: 'victory' });
      } else if (state.playerBaseHp <= 0) {
        state.outcome = 'defeat';
        events.push({ type: 'defeat' });
      }
    }
  }

  return {
    level,
    state,
    get cannonX() {
      return cannonX;
    },
    step,
  };
}
