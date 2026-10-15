// Autoplay bot: drives a battle the way a decent player would, for the balance test
// and integration's smoke test. It always fires, sweeps its aim toward the lane x
// whose gate chain grows the crowd most (traps score badly so they are avoided),
// turns to defend when enemies get close to the base, and launches the champion.
// Skill scales the aim noise and slow wandering sweeps; `attempt` shifts the noise in
// time, so attempts 0, 1, 2... play like separate tries by the same player.
//
// Milestone 2: live walls and towers on the aim line count as costs (and a tower's
// range as a smaller one), broken one-use gates are dropped (from the sim events
// passed in), the champion is aimed at a standing wall when there is one, and on
// boss levels the bot leads the strafing base: it aims where the base will be when
// its mobs arrive.
//
// Deterministic: the state is the current aim, the last time and what it has seen in
// events, and the "noise" is a fixed function of time, so the same input sequence
// gives the same outputs.
//
// Profiles: 'precise' (the default) is the skill-scaled bot above. It reacts at once
// and reads the whole lane, so it overstates what a thumb on a phone can do. 'human'
// stands in for an average player on a phone and is what the campaign is tuned
// against: it acts on what it saw ~0.35-0.5 s ago, aims with a slow ±0.6 drift and a
// slower slew, aims at the middle of a moving gate's (or the
// strafing boss's) sweep pulled only halfway toward where it will be, sees the far 40% of
// the lane blurred (gates and defenders there are misplaced by up to ±1 and not led at
// all), lifts its thumb now and then (short pauses in firing) and launches the
// champion 1.5-2.5 s after the meter fills. `skill` is ignored by the human profile;
// `attempt` still shifts its noise in time.
//
// Milestone 4: given a loadout (opts.loadout), it leads moving gates with the main mob's speed (firingOrder)
// and the boss with the champion's, and presses the ultimate when its meter is full (the
// battle's ultimateCharge is passed as the fifth argument): at once for the precise
// profile, after the same 1.5-2.5 s delay as the champion for the human one.

import type { BattleState, DefenderDef, DefenderView, GateDef, LevelDef, SimEvent, SimView } from '../contracts.ts';
import { DEFENDER_DEFAULTS, LAYOUT, Team, gateX } from '../contracts.ts';
import type { BattleInput } from './battle.ts';
import type { BattleLoadout } from './loadout.ts';
import { firingOrder } from './loadout.ts';

const MOB_SPEED = 7; // matches the sim's player mob speed; used to lead moving gates and the boss
const CHAMPION_SPEED = 4.5; // matches the sim's champion speed
const SAMPLE_STEP = 0.25; // candidate aim spacing (world units)
const AIM_SPEED = 9; // max aim slew (world units / s), roughly a relaxed thumb
const GOOD_MARGIN = 0.45; // stay this far inside a good gate's edge (crowd spread)
const TRAP_MARGIN = 0.8; // and this far outside a trap's edge
const DEFEND_Z = 14; // enemies closer than this to the player base count as a threat
const DEFEND_WEIGHT = 6; // threat weight that makes the bot turn to defend
const BLOCK_MARGIN = 0.6; // crowd half-spread when checking whether a defender sits on the line
const BLOCK_FACTOR = 0.3; // crowd kept when a defender sits on the line (it soaks the stream)
const TOWER_COST = 0.3; // crowd lost at point-blank to a tower's fire, fading to 0 at its range
const BASE_MARGIN = 0.7; // aim this far inside the strafing base's edge
const BASE_FALLOFF = 1.5; // and lose all value this far outside it
const CHAMPION_PATIENCE = 6; // seconds a full meter may wait for a good shot before firing anyway

export type AutoplayProfile = 'precise' | 'human';
export interface AutoplayOptions {
  skill?: number; // precise profile only: 0 sloppy .. 1 exact (default 0.7)
  attempt?: number; // shifts the noise in time: a separate try by the same player
  profile?: AutoplayProfile; // default 'precise'
  loadout?: BattleLoadout; // battle loadout: unit speeds, and the bot uses the ultimate
}

// The human profile's limits (see the header).
const HUMAN = {
  aimSpeed: 5.5, // world units / s
  reactionMin: 0.35, // seconds between seeing something and starting to aim for it
  reactionMax: 0.5,
  aimError: 0.6, // slow drifting aim error, world units
  lead: 0.5, // share of a moving gate's (or the boss's) travel it leads
  viewFrac: 0.6, // near share of the lane (cannon to enemy base) seen well
  farError: 1, // position error of gates and defenders beyond that
  liftPeriod: 4.7, // seconds between thumb lifts, roughly
  liftShare: 0.09, // share of each period with the thumb up (~0.42 s)
  championDelayMin: 1.5, // seconds after the meter fills before it looks for a shot
  championDelayMax: 2.5,
  championPatience: 9,
};

export type AutoplaySim = { readonly view: SimView; readonly defenders?: readonly DefenderView[] };
export type Autoplay = (
  state: BattleState,
  sim: AutoplaySim,
  time: number,
  events?: readonly SimEvent[],
  ultimateCharge?: number, // Battle.ultimateCharge; with opts.loadout the bot presses the ultimate when full
) => BattleInput;

// Smooth pseudo-noise in about [-1, 1]: a fixed function of time, no Math.random.
function wobble(t: number): number {
  return 0.6 * Math.sin(t * 1.7) * Math.sin(t * 2.9 + 1.3) + 0.4 * Math.sin(t * 4.3 + 0.5);
}

interface Obstacle {
  def: DefenderDef;
  slot: number; // index into the per-call liveness flags
  half: number; // footprint half-width
  range: number; // towers: shooting radius; walls: 0
}

// Human profile: how far off it sees a far gate or defender at noise time nt. Each
// object gets its own phase so they do not all err the same way.
function farOffset(nt: number, k: number): number {
  return HUMAN.farError * wobble(0.23 * nt + 2.9 * k + 0.7);
}

export function createAutoplay(level: LevelDef, opts?: AutoplayOptions): Autoplay {
  const human = opts?.profile === 'human';
  const skill = Math.min(1, Math.max(0, opts?.skill ?? 0.7));
  const noiseShift = (opts?.attempt ?? 0) * 11.3; // seconds; a fixed offset per attempt
  const lim = level.cannon.aimLimit;
  const sloppiness = human ? 0 : 1 - skill;
  const aimSpeed = human ? HUMAN.aimSpeed : AIM_SPEED;
  const lead = human ? HUMAN.lead : 1;
  const farZ = human ? LAYOUT.cannonZ + HUMAN.viewFrac * (level.lane.length - LAYOUT.cannonZ) : Infinity;
  const championPatience = human ? HUMAN.championPatience : CHAMPION_PATIENCE;
  // Gates and defenders sorted by z once, so the chain is evaluated in crossing order.
  const gates = level.gates.slice().sort((a, b) => a.z - b.z);
  const obstacles: Obstacle[] = (level.defenders ?? [])
    .map((d) => ({
      def: d,
      slot: 0,
      half: (d.width ?? (d.kind === 'tower' ? DEFENDER_DEFAULTS.towerWidth : DEFENDER_DEFAULTS.wallWidth)) / 2,
      range: d.kind === 'tower' ? (d.range ?? DEFENDER_DEFAULTS.range) : 0,
    }))
    .sort((a, b) => a.def.z - b.def.z);
  obstacles.forEach((o, i) => (o.slot = i));
  const standing = new Uint8Array(obstacles.length); // refreshed every call
  const broken = new Set<string>(); // one-use gates seen breaking, and destroyed defenders
  const phases = level.boss ? level.boss.phases.slice().sort((a, b) => b.belowHp - a.belowHp) : [];
  const mobSpeed = opts?.loadout ? firingOrder(opts.loadout.mobs)[0].speed : MOB_SPEED;
  const mobTravel = (level.lane.length - LAYOUT.cannonZ) / mobSpeed;
  const champTravel = (level.lane.length - LAYOUT.cannonZ) / (opts?.loadout?.champion.speed ?? CHAMPION_SPEED);
  const useUltimate = opts?.loadout !== undefined;

  let aim = 0;
  let lastTime = 0;
  let lastBaseX = level.enemyBase.x;
  let baseDir = 1; // sign of the base's x velocity
  let readySince = -1;
  let intent = 0; // human: where it means to aim, before its aim error
  let championWait = 0; // human: seconds to wait after the meter fills
  let ultReadySince = -1;
  let ultWait = 0;
  const alive = (o: Obstacle): boolean => standing[o.slot] === 1;
  // Human reaction delay: recent desired targets, acted on `reaction` seconds late.
  const seenT: number[] = [];
  const seenX: number[] = [];
  // Perceived x of gate i / obstacle o at gate-crossing time tc (now is `time`).
  // Precise: exactly where a moving gate will be when the stream gets there. Human:
  // the middle of its sweep, pulled `lead` of the way toward that (and only the middle
  // of the sweep, misplaced, for a far gate).
  const gateSeenX = (g: GateDef, i: number, time: number): number => {
    if (g.z > farZ) return g.x + farOffset(time + noiseShift, i);
    const exact = gateX(g, time + (g.z - LAYOUT.cannonZ) / mobSpeed);
    return lead === 1 ? exact : g.x + lead * (exact - g.x);
  };
  const obstacleX = (o: Obstacle, time: number): number =>
    o.def.z <= farZ ? o.def.x : o.def.x + farOffset(time + noiseShift, 17 + o.slot);

  // Expected crowd multiplier for weight-1 mobs fired at x: every gate on the line
  // applies in z order (clones go on through the later ones too), and a defender
  // standing on the line soaks part of the stream before anything behind it.
  function chainScore(x: number, time: number): number {
    let c = 1;
    let gi = 0;
    let oi = 0;
    while (gi < gates.length || oi < obstacles.length) {
      const g: GateDef | undefined = gates[gi];
      const o: Obstacle | undefined = obstacles[oi];
      if (o && (!g || o.def.z < g.z)) {
        oi++;
        if (alive(o) && Math.abs(x - obstacleX(o, time)) < o.half + BLOCK_MARGIN) c *= BLOCK_FACTOR;
        continue;
      }
      gi++;
      if (broken.has(g.id)) continue;
      const gx = gateSeenX(g, gi, time);
      const d = Math.abs(x - gx);
      const good = g.op === 'mul' || g.op === 'add';
      if (good ? d > g.width / 2 - GOOD_MARGIN : d > g.width / 2 + TRAP_MARGIN) continue;
      switch (g.op) {
        case 'mul':
          c *= g.value;
          break;
        case 'add':
          c *= 1 + g.value;
          break;
        case 'sub':
          c = 0;
          break;
        case 'div':
          c /= g.value;
          break;
      }
    }
    // Towers shoot whatever passes within range; the closer the line, the more it costs.
    for (const o of obstacles) {
      if (o.range === 0 || !alive(o)) continue;
      const d = Math.abs(x - obstacleX(o, time));
      if (d < o.range) c *= 1 - TOWER_COST * (1 - d / o.range);
    }
    return c;
  }

  // Where the strafing base will be `ahead` seconds from now, from its current x and
  // direction of travel and the current phase's strafe.
  function predictBaseX(state: BattleState, ahead: number): number {
    const x0 = level.enemyBase.x;
    const x = state.enemyBaseX ?? x0;
    const ph = phases[state.bossPhase ?? 0];
    const amp = ph.strafe.amplitude;
    if (amp <= 1e-6) return x;
    const s = Math.min(1, Math.max(-1, (x - x0) / amp));
    const theta = baseDir >= 0 ? Math.asin(s) : Math.PI - Math.asin(s);
    return x0 + amp * Math.sin(theta + (2 * Math.PI * ahead) / ph.strafe.period);
  }

  // The human leads the strafing base only part of the way from the middle of its sweep.
  function leadBase(predicted: number): number {
    return lead === 1 ? predicted : level.enemyBase.x + lead * (predicted - level.enemyBase.x);
  }

  // Share of a stream fired at x that lands on a base predicted at px.
  function hitFactor(x: number, px: number): number {
    const m = Math.abs(x - px) - (level.enemyBase.width / 2 - BASE_MARGIN);
    return m <= 0 ? 1 : Math.max(0.02, 1 - m / BASE_FALLOFF);
  }

  function bestX(state: BattleState, time: number): number {
    const px = phases.length ? leadBase(predictBaseX(state, mobTravel)) : 0;
    let best = 0;
    let bestScore = -Infinity;
    for (let x = -lim; x <= lim + 1e-9; x += SAMPLE_STEP) {
      let s = chainScore(x, time);
      if (phases.length) s *= hitFactor(x, px);
      // Small pull toward the current aim (the human's intended aim, so its aim error
      // does not feed back and wander) breaks ties without jitter.
      s -= 0.01 * Math.abs(x - intent);
      if (s > bestScore) {
        bestScore = s;
        best = x;
      }
    }
    return best;
  }

  // Weighted mean x of enemies close to the player base, or NaN if no real threat.
  function threatX(view: SimView): number {
    let w = 0;
    let sx = 0;
    for (let i = 0; i < view.count; i++) {
      if (view.team[i] !== Team.Enemy || view.posZ[i] > DEFEND_Z) continue;
      w += view.weight[i];
      sx += view.posX[i] * view.weight[i];
    }
    return w >= DEFEND_WEIGHT ? sx / w : NaN;
  }

  // The standing wall nearest the current aim, for the champion to break.
  function wallTarget(): Obstacle | undefined {
    let best: Obstacle | undefined;
    for (const o of obstacles) {
      if (o.def.kind !== 'wall' || !alive(o)) continue;
      if (!best || Math.abs(o.def.x - aim) < Math.abs(best.def.x - aim)) best = o;
    }
    return best;
  }

  return (state, sim, time, events, ultimateCharge) => {
    if (events) {
      for (const e of events) {
        if (e.type === 'gateBroken') broken.add(e.gateId);
        else if (e.type === 'gate' && e.usesLeft === 0) broken.add(e.gateId);
        else if (e.type === 'defenderDestroyed') broken.add(e.id);
      }
    }
    // Defenders stand until the sim reports hp 0 (or, without sim.defenders, until destroyed).
    for (const o of obstacles) {
      const view = sim.defenders?.find((d) => d.id === o.def.id);
      standing[o.slot] = !broken.has(o.def.id) && (view ? view.hp > 0 : true) ? 1 : 0;
    }

    const dt = Math.max(0, time - lastTime);
    lastTime = time;
    if (phases.length) {
      const bx = state.enemyBaseX ?? level.enemyBase.x;
      if (bx !== lastBaseX) baseDir = bx > lastBaseX ? 1 : -1;
      lastBaseX = bx;
    }

    const ready = state.outcome === 'playing' && state.championCharge >= 1;
    if (ready && readySince < 0) {
      readySince = time;
      championWait = human
        ? HUMAN.championDelayMin +
          (HUMAN.championDelayMax - HUMAN.championDelayMin) * (0.5 + 0.5 * wobble(time + noiseShift + 5.1))
        : 0;
    }
    if (!ready) readySince = -1;

    // Champion aiming: a standing wall first, else the boss's predicted position.
    let champTarget = NaN;
    let champTol = 0;
    if (ready && time - readySince >= championWait) {
      const wall = wallTarget();
      if (wall) {
        champTarget = wall.def.x;
        champTol = Math.max(0.3, wall.half - 0.8);
      } else if (phases.length) {
        champTarget = leadBase(predictBaseX(state, champTravel));
        champTol = 0.5;
      }
    }

    if (!human) intent = aim;
    const threat = threatX(sim.view);
    let target = !Number.isNaN(threat) ? threat : !Number.isNaN(champTarget) ? champTarget : bestX(state, time);
    const nt = time + noiseShift;
    let firing = true;
    if (human) {
      // Act on what was wanted `reaction` seconds ago.
      seenT.push(time);
      seenX.push(target);
      const reaction =
        HUMAN.reactionMin + (HUMAN.reactionMax - HUMAN.reactionMin) * (0.5 + 0.5 * wobble(0.5 * nt + 3.7));
      let k = 0;
      while (k + 1 < seenT.length && seenT[k + 1] <= time - reaction) k++;
      if (k > 0) {
        seenT.splice(0, k);
        seenX.splice(0, k);
      }
      // Nothing seen long enough ago yet (the opening moments): hold still.
      if (seenT[0] <= time - reaction) {
        intent = seenX[0];
        target = intent + HUMAN.aimError * wobble(0.3 * nt + 1.1);
      } else target = aim;
      const lift = nt / HUMAN.liftPeriod + 0.15 * Math.sin(0.29 * nt);
      firing = lift - Math.floor(lift) >= HUMAN.liftShare;
    } else {
      // Slow periodic sweeps plus jitter, both shrinking as skill rises.
      target += sloppiness * (2.5 * Math.sin((2 * Math.PI * nt) / 7) + 1.5 * wobble(nt));
    }
    target = Math.min(lim, Math.max(-lim, target));

    const maxStep = aimSpeed * dt;
    aim += Math.min(maxStep, Math.max(-maxStep, target - aim));

    const onTarget =
      Number.isNaN(champTarget) || Math.abs(aim - Math.min(lim, Math.max(-lim, champTarget))) <= champTol;
    const championPressed =
      ready && time - readySince >= championWait && (onTarget || time - readySince >= championPatience);

    let ultimatePressed = false;
    if (useUltimate) {
      const full = state.outcome === 'playing' && (ultimateCharge ?? 0) >= 1;
      if (full && ultReadySince < 0) {
        ultReadySince = time;
        ultWait = human
          ? HUMAN.championDelayMin +
            (HUMAN.championDelayMax - HUMAN.championDelayMin) * (0.5 + 0.5 * wobble(time + noiseShift + 8.3))
          : 0;
      }
      if (!full) ultReadySince = -1;
      ultimatePressed = full && time - ultReadySince >= ultWait;
    }

    return useUltimate
      ? { aimX: aim, firing, championPressed, ultimatePressed, paused: false }
      : { aimX: aim, firing, championPressed, paused: false };
  };
}
