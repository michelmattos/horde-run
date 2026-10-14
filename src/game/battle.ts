// Battle rules on top of the crowd sim (concept §2 core loop): the cannon fires player
// mobs, the charge meter launches a champion, enemy waves and a trickle come down the
// lane, base hits drain base HP and the first base to fall decides the outcome.
//
// Pure TypeScript: no Babylon, no src/core. Randomness is injected as `rand`, and the
// sim is reached through the structural BattleSim interface so tests can fake it.
// step() allocates nothing except the event objects it pushes.
//
// Boss levels (level.boss): the enemy base strafes across the lane. Phases switch as
// its HP falls; the strafe integrates a phase angle and eases its amplitude, so the
// base never jumps, and each new phase can summon enemies and change the trickle.
//
// Expedition runs (level.mods, BattleMods): cannon mobs get per-weight hp and damage
// (gate clones inherit both), every Nth mob can be a knight (a small champion),
// shots can come in bursts, a crowd can wait in front of the cannon at the start and
// champions can bring an echo of mobs. A level without mods plays exactly as before:
// no extra rand() calls, no extra spawns.

import type { BattleState, DefenderView, InputState, LevelDef, SimEvent, SimView } from '../contracts.ts';
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
  readonly defenders?: readonly DefenderView[];
  setEnemyBaseX?(x: number): void;
}

// What the player did this battle. Counted only while playing. endTime decides the
// target-time star; the counters are for the result screen and tuning.
export interface BattleStats {
  mobsFired: number;
  championsLaunched: number;
  endTime?: number; // state.time when the outcome was decided
}

export interface Battle {
  readonly level: LevelDef;
  readonly state: BattleState; // same object every step, mutated in place
  readonly stats: BattleStats;
  readonly cannonX: number;
  step(input: InputState, events: SimEvent[]): void; // one fixed SIM_DT step; no-op when paused
}

const SHOT_SPREAD = 0.3; // x jitter half-width when a shot holds several mobs
// Knight stats when mods.knightEvery is set without mods.knight.
export const DEFAULT_KNIGHT = { hp: 10, damage: 10, radius: 0.55 } as const;
const START_CROWD_ROWS = 5; // startCrowd stands in rows at z = cannonZ + 1 .. + 5
const ECHO_BEHIND = 0.6; // championEcho mobs spawn this far behind the champion
const ECHO_SPREAD = 0.8;
const DEFAULT_WAVE_INTERVAL = 0.05;
const EPS = 1e-9; // absorbs float drift in accumulators so steady rates stay exact
export const BOSS_AMP_EASE = 1; // seconds for the strafe amplitude to reach a new phase's

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
    enemyBaseX: level.enemyBase.x,
  };
  const stats: BattleStats = { mobsFired: 0, championsLaunched: 0 };

  // Boss strafe state: phases sorted by threshold, highest (the opening phase) first.
  const phases = level.boss ? level.boss.phases.slice().sort((a, b) => b.belowHp - a.belowHp) : [];
  let phase = 0;
  let angle = 0;
  let amp = phases.length ? phases[0].strafe.amplitude : 0;
  let ampRate = 0; // world units per second while easing toward the phase amplitude
  if (phases.length) state.bossPhase = 0;

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

  // Mods, resolved once. Spawn option objects are built here so step() stays allocation-free.
  const mods = level.mods;
  const mobOpts: { spread: number; hp?: number; damage?: number } = { spread: mods?.shotSpread ?? SHOT_SPREAD };
  if (mods?.mobHp !== undefined) mobOpts.hp = mods.mobHp;
  if (mods?.mobDamage !== undefined) mobOpts.damage = mods.mobDamage;
  const knightEvery = mods?.knightEvery ?? 0;
  const knight = mods?.knight ?? DEFAULT_KNIGHT;
  const knightOpts = { hp: knight.hp, damage: knight.damage, radius: knight.radius };
  const burstShots = mods?.burst ? Math.max(1, Math.floor(mods.burst.shots)) : 0;
  const burstGap = mods?.burst?.gap ?? 0;
  const startCrowd = Math.max(0, Math.floor(mods?.startCrowd ?? 0));
  const echo = Math.max(0, Math.floor(mods?.championEcho ?? 0));
  const crowdOpts = { ...mobOpts, spread: level.cannon.aimLimit };
  const echoOpts = { ...mobOpts, spread: ECHO_SPREAD };
  let burstQueue = 0; // burst shots still to fire
  let burstCd = 0; // seconds until the next queued burst shot

  function fire(): void {
    const n = level.cannon.unitsPerShot;
    // Every knightEvery-th mob counted over the battle is a knight instead.
    const knights = knightEvery
      ? Math.floor((stats.mobsFired + n) / knightEvery) - Math.floor(stats.mobsFired / knightEvery)
      : 0;
    if (n > knights) sim.spawn(Team.Player, UnitKind.Mob, cannonX, LAYOUT.cannonZ, n - knights, mobOpts);
    if (knights > 0) sim.spawn(Team.Player, UnitKind.Champion, cannonX, LAYOUT.cannonZ, knights, knightOpts);
    stats.mobsFired += n;
    state.championCharge = Math.min(1, state.championCharge + n * chargePerMob);
  }

  // A shot released by the fire rate: one shot, or a burst queued at the current aim.
  function release(): void {
    if (burstShots > 0) burstQueue += burstShots;
    else fire();
  }

  // Fires queued burst shots `burstGap` apart, whether or not the thumb is still down.
  function drainBurst(): void {
    if (burstCd > 0) burstCd -= SIM_DT;
    while (burstQueue > 0 && burstCd <= EPS) {
      fire();
      burstQueue--;
      burstCd += burstGap;
    }
    if (burstQueue === 0 && burstCd < 0) burstCd = 0;
  }

  function spawnStartCrowd(): void {
    let left = startCrowd;
    for (let r = 0; r < START_CROWD_ROWS && left > 0; r++) {
      const n = Math.ceil(left / (START_CROWD_ROWS - r));
      sim.spawn(Team.Player, UnitKind.Mob, 0, LAYOUT.cannonZ + 1 + r, n, crowdOpts);
      left -= n;
    }
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
    const perSecond = (phases.length ? phases[phase].trickle : undefined) ?? trickle?.perSecond ?? 0;
    if (perSecond > 0 && t + EPS >= (trickle?.startAt ?? 0)) {
      trickleAcc += perSecond * SIM_DT;
      while (trickleAcc >= 1 - EPS) {
        trickleAcc -= 1;
        spawnAcrossBase(1);
      }
    }
  }

  function spawnAcrossBase(count: number): void {
    const x = state.enemyBaseX ?? level.enemyBase.x;
    const half = level.enemyBase.width / 2;
    for (let k = 0; k < count; k++) spawnEnemy(x + (rand() * 2 - 1) * half);
  }

  // Advances the strafe by one step and tells the sim where the base is.
  function moveBase(): void {
    if (!phases.length) return;
    const ph = phases[phase];
    angle += (2 * Math.PI * SIM_DT) / ph.strafe.period;
    const target = ph.strafe.amplitude;
    const d = ampRate * SIM_DT;
    amp = Math.abs(target - amp) <= d ? target : amp + (target > amp ? d : -d);
    state.enemyBaseX = level.enemyBase.x + amp * Math.sin(angle);
    sim.setEnemyBaseX?.(state.enemyBaseX);
  }

  // Enters every phase whose threshold the base HP has fallen below.
  function checkPhase(events: SimEvent[]): void {
    const frac = state.enemyBaseHp / state.enemyBaseMaxHp;
    while (phase + 1 < phases.length && frac < phases[phase + 1].belowHp) {
      phase++;
      const ph = phases[phase];
      ampRate = Math.abs(ph.strafe.amplitude - amp) / BOSS_AMP_EASE;
      state.bossPhase = phase;
      events.push({ type: 'bossPhase', phase, x: state.enemyBaseX ?? level.enemyBase.x, z: level.lane.length });
      if (ph.summon) spawnAcrossBase(ph.summon);
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
      if (steps === 1 && startCrowd > 0) spawnStartCrowd();
      shotAcc += shotInc;
      if (input.firing) {
        while (shotAcc >= 1 - EPS) {
          shotAcc -= 1;
          release();
        }
      } else if (shotAcc > 1 - shotInc) {
        shotAcc = 1 - shotInc;
      }
      if (burstShots > 0) drainBurst();

      if (input.championPressed && state.championCharge >= 1 - EPS) {
        sim.spawn(Team.Player, UnitKind.Champion, cannonX, LAYOUT.cannonZ, 1, {
          hp: level.champion.hp,
          damage: level.champion.damage,
        });
        if (echo > 0) sim.spawn(Team.Player, UnitKind.Mob, cannonX, LAYOUT.cannonZ - ECHO_BEHIND, echo, echoOpts);
        state.championCharge = 0;
        stats.championsLaunched++;
        events.push({ type: 'championLaunched', x: cannonX });
      }

      spawnEnemies(t);
    }

    moveBase();
    const first = events.length;
    sim.step(SIM_DT, events);
    if (playing) {
      for (let i = first; i < events.length; i++) {
        const e = events[i];
        if (e.type !== 'baseHit') continue;
        if (e.team === Team.Enemy) state.enemyBaseHp = Math.max(0, state.enemyBaseHp - e.damage);
        else state.playerBaseHp = Math.max(0, state.playerBaseHp - e.damage);
      }
      if (state.enemyBaseHp > 0) checkPhase(events);
    }

    state.time = sim.time;
    const totals = sim.totals();
    state.playerUnits = totals.player;
    state.enemyUnits = totals.enemy;

    if (playing) {
      if (state.enemyBaseHp <= 0) {
        state.outcome = 'victory';
        stats.endTime = state.time;
        events.push({ type: 'victory' });
      } else if (state.playerBaseHp <= 0) {
        state.outcome = 'defeat';
        stats.endTime = state.time;
        events.push({ type: 'defeat' });
      }
    }
  }

  return {
    level,
    state,
    stats,
    get cannonX() {
      return cannonX;
    },
    step,
  };
}
