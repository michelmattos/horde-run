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
//
// Milestone 4 loadouts (BattleLoadout, src/game/loadout.ts): the cannon fires the main mob
// and every mixEvery-th shot the mix mob (a crowd mob is always the main one; a 'heavy'
// slot fires small champions), the champion
// takes its multipliers, radius, speed, variant and echo from the loadout, and a second
// meter charges an ultimate (barrage, paratroopers or marble). Mods still apply on top.
// Without a loadout nothing of this runs, so the rand() sequence is unchanged. Cues for
// the renderer and audio (shots, ultimates, death blasts) go to an optional array.

import type { BattleState, DefenderView, InputState, LevelDef, SimEvent, SimView } from '../contracts.ts';
import { LAYOUT, SIM_DT, Team, UnitKind } from '../contracts.ts';
import type { BattleLoadout, MobSpec } from './loadout.ts';
import { firingOrder } from './loadout.ts';

// Spawn options the battle layer passes to the sim (mirrors the sim's SpawnOpts).
export interface BattleSpawnOpts {
  hp?: number;
  damage?: number;
  radius?: number;
  spread?: number;
  speed?: number;
  variant?: number;
  deathBlast?: { radius: number; damage: number };
}

export interface BattleSim {
  readonly view: SimView;
  readonly time: number;
  spawn(team: Team, kind: UnitKind, x: number, z: number, count: number, opts?: BattleSpawnOpts): void;
  step(dt: number, events: SimEvent[]): void; // baseHit.team = owner of the base that was hit
  totals(): { player: number; enemy: number };
  readonly defenders?: readonly DefenderView[];
  setEnemyBaseX?(x: number): void;
  takeBlasts?(out: { x: number; z: number; radius: number }[]): void;
  damageArea?(team: Team, x: number, z: number, radius: number, maxWeight: number): number;
  damageDefender?(index: number, amount: number): void;
}

// Things the renderer and audio react to. 'shot' per cannon shot; 'ultimate' when one
// fires (marble: z is where it starts rolling and duration the roll time); 'blast' per
// death blast in the sim.
export type BattleCue =
  | {
      type: 'ultimate';
      id: 'barrage' | 'paratroopers' | 'marble';
      x: number;
      z: number;
      radius: number;
      duration: number;
    }
  | { type: 'blast'; x: number; z: number; radius: number }
  | { type: 'shot'; x: number; count: number };

// Battle input: the shared InputState plus the ultimate button (edge-triggered like the champion's).
export type BattleInput = InputState & { ultimatePressed?: boolean };

// What the player did this battle. Counted only while playing. endTime decides the
// target-time star; the counters are for the result screen and tuning.
export interface BattleStats {
  mobsFired: number;
  championsLaunched: number;
  ultimatesFired?: number; // loadout battles only
  endTime?: number; // state.time when the outcome was decided
}

export interface Battle {
  readonly level: LevelDef;
  readonly state: BattleState; // same object every step, mutated in place
  readonly stats: BattleStats;
  readonly cannonX: number;
  readonly ultimateCharge: number; // 0..1; always 0 without a loadout
  readonly hasUltimate: boolean; // true when the battle was given a loadout
  // One fixed SIM_DT step; no-op when paused. Cues are pushed only when the array is given.
  step(input: BattleInput, events: SimEvent[], cues?: BattleCue[]): void;
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
// Ultimates (loadout battles).
export const ULTIMATE = {
  barrageAhead: 2, // barrage lands at z = cannonZ + this, across the full aim width
  paraZ: 0.55, // paratroopers land at this share of the lane length
  paraSpread: 1.6, // x half-width of the paratrooper drop
  paraTime: 1, // seconds the drop takes
  marbleRadius: 1.6,
  marbleSpeed: 12, // world units / s
  marbleStop: 6, // the marble stops this far before the enemy base (never hits it)
  marbleDefender: 0.5, // each defender it rolls over takes power x this
} as const;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function createBattle(level: LevelDef, sim: BattleSim, rand: () => number, loadout?: BattleLoadout): Battle {
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
  const chargePerMob = 1 / (level.champion.chargeNeeded * (loadout?.champion.chargeMul ?? 1));
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
  // Knights from mods.knightEvery (the Expedition mod) render as knights: variant 1.
  const knightOpts = { hp: knight.hp, damage: knight.damage, radius: knight.radius, variant: 1 };
  const burstShots = mods?.burst ? Math.max(1, Math.floor(mods.burst.shots)) : 0;
  const burstGap = mods?.burst?.gap ?? 0;
  const startCrowd = Math.max(0, Math.floor(mods?.startCrowd ?? 0));
  const echo = Math.max(0, Math.floor(mods?.championEcho ?? 0));
  const crowdOpts = { ...mobOpts, spread: level.cannon.aimLimit };
  const echoOpts = { ...mobOpts, spread: ECHO_SPREAD };
  let burstQueue = 0; // burst shots still to fire
  let burstCd = 0; // seconds until the next queued burst shot
  let cues: BattleCue[] | undefined; // the current step's cue array, if any

  // Loadout, resolved once (see the header). Absent: none of this is used.
  const lo = loadout ? resolveLoadout(level, loadout) : undefined;
  let shotNo = 0; // cannon shots fired, for the slot-2 mix
  const carry = [0.5, 0.5]; // fixed-count slots: fractional units owed (0.5 rounds to nearest)
  let ultimateCharge = 0;
  const ultPerMob = loadout ? 1 / Math.max(1, loadout.ultimate.chargeNeeded) : 0;
  let paraLeft = 0; // paratrooper drop: units still to land, steps left, where
  let paraSteps = 0;
  let paraX = 0;
  let marbleOn = false; // marble: rolling, where, weight left to remove, defenders hit
  let marbleZ = 0;
  let marbleX = 0;
  let marbleLeft = 0;
  let marbleHit = 0;
  const blastScratch: { x: number; z: number; radius: number }[] = [];

  function fire(): void {
    if (lo) {
      fireLoadout(lo);
      return;
    }
    const n = level.cannon.unitsPerShot;
    cues?.push({ type: 'shot', x: cannonX, count: n });
    // Every knightEvery-th mob counted over the battle is a knight instead.
    const knights = knightEvery
      ? Math.floor((stats.mobsFired + n) / knightEvery) - Math.floor(stats.mobsFired / knightEvery)
      : 0;
    if (n > knights) sim.spawn(Team.Player, UnitKind.Mob, cannonX, LAYOUT.cannonZ, n - knights, mobOpts);
    if (knights > 0) sim.spawn(Team.Player, UnitKind.Champion, cannonX, LAYOUT.cannonZ, knights, knightOpts);
    stats.mobsFired += n;
    state.championCharge = Math.min(1, state.championCharge + n * chargePerMob);
  }

  // A loadout shot: slot 1, or slot 2 on every mixEvery-th shot. Mob slots still get
  // knightEvery knights from the mods; heavy slots fire small champions.
  // A fixed-count slot's fractional perShot (scaled by the cannon) carries over between
  // its shots, so its units per second follow the cannon's; a mix shot that comes up
  // empty fires slot 1 instead.
  function fireLoadout(l: ResolvedLoadout): void {
    shotNo++;
    let slot = l.mixEvery > 0 && shotNo % l.mixEvery === 0 ? 1 : 0;
    let n = slotCount(l, slot);
    if (n === 0 && slot === 1) n = slotCount(l, (slot = 0));
    if (n === 0) return;
    const spec = l.specs[slot];
    cues?.push({ type: 'shot', x: cannonX, count: n });
    if (spec.kind === 'heavy') {
      sim.spawn(Team.Player, UnitKind.Champion, cannonX, LAYOUT.cannonZ, n, l.shotOpts[slot]);
    } else {
      const knights = knightEvery
        ? Math.floor((stats.mobsFired + n) / knightEvery) - Math.floor(stats.mobsFired / knightEvery)
        : 0;
      if (n > knights) sim.spawn(Team.Player, UnitKind.Mob, cannonX, LAYOUT.cannonZ, n - knights, l.shotOpts[slot]);
      if (knights > 0) sim.spawn(Team.Player, UnitKind.Champion, cannonX, LAYOUT.cannonZ, knights, knightOpts);
    }
    stats.mobsFired += n;
    state.championCharge = Math.min(1, state.championCharge + n * chargePerMob);
    ultimateCharge = Math.min(1, ultimateCharge + n * ultPerMob);
  }

  // Units the next shot of `slot` fires: the cannon's count for a crowd slot, the
  // carried fixed count otherwise.
  function slotCount(l: ResolvedLoadout, slot: number): number {
    if (l.specs[slot].perShot === null) return l.perShot[slot];
    carry[slot] += l.perShot[slot];
    const n = Math.floor(carry[slot]);
    carry[slot] -= n;
    return n;
  }

  // Spawns `units` slot-1 units (slot1Units turns a weight of mobs into a unit count).
  function spawnSlot1(l: ResolvedLoadout, x: number, z: number, units: number, opts: BattleSpawnOpts): void {
    sim.spawn(Team.Player, l.specs[0].kind === 'heavy' ? UnitKind.Champion : UnitKind.Mob, x, z, units, opts);
  }

  function fireUltimate(l: ResolvedLoadout): void {
    const u = l.ultimate;
    const lim = level.cannon.aimLimit;
    if (u.id === 'barrage') {
      const z = LAYOUT.cannonZ + ULTIMATE.barrageAhead;
      spawnSlot1(l, 0, z, slot1Units(l, u.power), l.barrageOpts);
      cues?.push({ type: 'ultimate', id: u.id, x: 0, z, radius: lim, duration: 0 });
    } else if (u.id === 'paratroopers') {
      if (paraLeft > 0) spawnSlot1(l, paraX, l.paraZ, paraLeft, l.paraOpts); // an unfinished drop lands at once
      const edge = level.lane.width / 2 - ULTIMATE.paraSpread;
      paraX = clamp(cannonX, -Math.max(0, edge), Math.max(0, edge));
      paraLeft = slot1Units(l, u.power);
      paraSteps = Math.max(1, Math.round(ULTIMATE.paraTime / SIM_DT));
      cues?.push({
        type: 'ultimate',
        id: u.id,
        x: paraX,
        z: l.paraZ,
        radius: ULTIMATE.paraSpread,
        duration: ULTIMATE.paraTime,
      });
    } else {
      marbleOn = true;
      marbleX = cannonX;
      marbleZ = LAYOUT.cannonZ;
      marbleLeft = u.power;
      marbleHit = 0;
      cues?.push({
        type: 'ultimate',
        id: u.id,
        x: marbleX,
        z: marbleZ,
        radius: ULTIMATE.marbleRadius,
        duration: Math.max(0, l.marbleEnd - marbleZ) / ULTIMATE.marbleSpeed,
      });
    }
  }

  // Paratroopers land evenly over paraTime; the marble rolls on, spending its power on
  // enemy units and bumping each defender it passes once.
  function stepUltimates(l: ResolvedLoadout): void {
    if (paraLeft > 0) {
      const n = Math.ceil(paraLeft / paraSteps);
      paraSteps--;
      paraLeft -= n;
      spawnSlot1(l, paraX, l.paraZ, n, l.paraOpts);
    }
    if (!marbleOn) return;
    marbleZ += ULTIMATE.marbleSpeed * SIM_DT;
    if (marbleZ >= l.marbleEnd) {
      marbleOn = false;
      return;
    }
    const r = ULTIMATE.marbleRadius;
    if (marbleLeft > 0 && sim.damageArea) marbleLeft -= sim.damageArea(Team.Enemy, marbleX, marbleZ, r, marbleLeft);
    const defs = sim.defenders;
    if (defs && sim.damageDefender) {
      for (let k = 0; k < defs.length && k < 31; k++) {
        const d = defs[k];
        if ((marbleHit >>> k) & 1 || d.hp <= 0 || !circleTouches(d, marbleX, marbleZ, r)) continue;
        marbleHit |= 1 << k;
        sim.damageDefender(k, l.ultimate.power * ULTIMATE.marbleDefender);
      }
    }
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

  function step(input: BattleInput, events: SimEvent[], cueOut?: BattleCue[]): void {
    if (input.paused) return;
    cues = cueOut;
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
        if (lo) {
          sim.spawn(Team.Player, UnitKind.Champion, cannonX, LAYOUT.cannonZ, 1, lo.championOpts);
          const all = echo + lo.echo;
          if (all > 0) spawnSlot1(lo, cannonX, LAYOUT.cannonZ - ECHO_BEHIND, slot1Units(lo, all), lo.echoOpts);
        } else {
          sim.spawn(Team.Player, UnitKind.Champion, cannonX, LAYOUT.cannonZ, 1, {
            hp: level.champion.hp,
            damage: level.champion.damage,
          });
          if (echo > 0) sim.spawn(Team.Player, UnitKind.Mob, cannonX, LAYOUT.cannonZ - ECHO_BEHIND, echo, echoOpts);
        }
        state.championCharge = 0;
        stats.championsLaunched++;
        events.push({ type: 'championLaunched', x: cannonX });
      }

      if (lo) {
        if (input.ultimatePressed && ultimateCharge >= 1 - EPS) {
          fireUltimate(lo);
          ultimateCharge = 0;
          stats.ultimatesFired = (stats.ultimatesFired ?? 0) + 1;
        }
        stepUltimates(lo);
      }

      spawnEnemies(t);
    }

    moveBase();
    const first = events.length;
    sim.step(SIM_DT, events);
    if (cues && sim.takeBlasts) {
      sim.takeBlasts(blastScratch);
      for (const b of blastScratch) cues.push({ type: 'blast', x: b.x, z: b.z, radius: b.radius });
      blastScratch.length = 0;
    }
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
    get ultimateCharge() {
      return ultimateCharge;
    },
    hasUltimate: loadout !== undefined,
    step,
  };
}

// A loadout with every spawn option object built once, so step() stays allocation-free.
interface ResolvedLoadout {
  specs: [MobSpec, MobSpec];
  perShot: [number, number];
  shotOpts: [BattleSpawnOpts, BattleSpawnOpts];
  mixEvery: number;
  championOpts: BattleSpawnOpts;
  echo: number;
  echoOpts: BattleSpawnOpts;
  barrageOpts: BattleSpawnOpts;
  paraOpts: BattleSpawnOpts;
  paraZ: number;
  marbleEnd: number;
  ultimate: BattleLoadout['ultimate'];
}

function resolveLoadout(level: LevelDef, l: BattleLoadout): ResolvedLoadout {
  const mods = level.mods;
  const spread = mods?.shotSpread ?? SHOT_SPREAD;
  // Mob slots scale with the mods' per-weight hp and damage (1 = the spec as is).
  const opts = (spec: MobSpec, sp: number): BattleSpawnOpts => {
    const mob = spec.kind === 'mob';
    const o: BattleSpawnOpts = {
      hp: spec.hp * (mob ? (mods?.mobHp ?? 1) : 1),
      damage: spec.damage * (mob ? (mods?.mobDamage ?? 1) : 1),
      radius: spec.radius,
      speed: spec.speed,
      variant: spec.variant,
      spread: sp,
    };
    if (spec.deathBlast) o.deathBlast = { radius: spec.deathBlast.radius, damage: spec.deathBlast.damage };
    return o;
  };
  // Fixed counts stay fractional (progression scales them by the cannon); see slotCount.
  const count = (spec: MobSpec) => (spec.perShot === null ? level.cannon.unitsPerShot : Math.max(0, spec.perShot));
  const c = l.champion;
  const [a, b] = firingOrder(l.mobs);
  return {
    specs: [a, b],
    // Two fixed-count mobs: the main one fires no more hp per shot than the crowd would
    // (gates do not copy knights, so a knight-only army steamrolled at one a shot).
    perShot: [a.perShot === null ? count(a) : Math.min(count(a), level.cannon.unitsPerShot / a.hp), count(b)],
    shotOpts: [opts(a, spread), opts(b, spread)],
    mixEvery: Math.max(0, Math.floor(l.mixEvery)),
    championOpts: {
      hp: level.champion.hp * c.hpMul,
      damage: level.champion.damage * c.damageMul,
      radius: c.radius,
      speed: c.speed,
      variant: c.variant,
    },
    echo: Math.max(0, Math.floor(c.echo)),
    echoOpts: opts(a, ECHO_SPREAD),
    barrageOpts: opts(a, level.cannon.aimLimit),
    paraOpts: opts(a, ULTIMATE.paraSpread),
    paraZ: ULTIMATE.paraZ * level.lane.length,
    marbleEnd: level.lane.length - ULTIMATE.marbleStop,
    ultimate: l.ultimate,
  };
}

// A weight of mobs as slot-1 units: itself for a mob slot, weight / hp (at least one) for a heavy slot.
function slot1Units(l: ResolvedLoadout, weight: number): number {
  const spec = l.specs[0];
  const w = Math.max(0, Math.round(weight));
  return spec.kind === 'heavy' ? Math.max(1, Math.round(w / spec.hp)) : w;
}

// Does a circle overlap a defender's footprint (tower disc or wall rectangle)?
function circleTouches(d: DefenderView, x: number, z: number, r: number): boolean {
  const dx = x - d.x;
  const dz = z - d.z;
  if (d.kind === 'tower') {
    const rs = r + d.width / 2;
    return dx * dx + dz * dz < rs * rs;
  }
  const hx = d.width / 2;
  const hz = d.depth / 2;
  const ox = dx < -hx ? dx + hx : dx > hx ? dx - hx : 0;
  const oz = dz < -hz ? dz + hz : dz > hz ? dz - hz : 0;
  return ox * ox + oz * oz < r * r;
}
