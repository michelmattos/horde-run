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

import type { BattleState, DefenderDef, DefenderView, GateDef, InputState, LevelDef, SimEvent, SimView } from '../contracts.ts';
import { DEFENDER_DEFAULTS, LAYOUT, Team, gateX } from '../contracts.ts';

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

export type AutoplaySim = { readonly view: SimView; readonly defenders?: readonly DefenderView[] };
export type Autoplay = (state: BattleState, sim: AutoplaySim, time: number, events?: readonly SimEvent[]) => InputState;

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

export function createAutoplay(level: LevelDef, opts?: { skill?: number; attempt?: number }): Autoplay {
  const skill = Math.min(1, Math.max(0, opts?.skill ?? 0.7));
  const noiseShift = (opts?.attempt ?? 0) * 11.3; // seconds; a fixed offset per attempt
  const lim = level.cannon.aimLimit;
  const sloppiness = 1 - skill;
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
  const mobTravel = (level.lane.length - LAYOUT.cannonZ) / MOB_SPEED;
  const champTravel = (level.lane.length - LAYOUT.cannonZ) / CHAMPION_SPEED;

  let aim = 0;
  let lastTime = 0;
  let lastBaseX = level.enemyBase.x;
  let baseDir = 1; // sign of the base's x velocity
  let readySince = -1;
  const alive = (o: Obstacle): boolean => standing[o.slot] === 1;

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
        if (alive(o) && Math.abs(x - o.def.x) < o.half + BLOCK_MARGIN) c *= BLOCK_FACTOR;
        continue;
      }
      gi++;
      if (broken.has(g.id)) continue;
      const gx = gateX(g, time + (g.z - LAYOUT.cannonZ) / MOB_SPEED);
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
      const d = Math.abs(x - o.def.x);
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

  // Share of a stream fired at x that lands on a base predicted at px.
  function hitFactor(x: number, px: number): number {
    const m = Math.abs(x - px) - (level.enemyBase.width / 2 - BASE_MARGIN);
    return m <= 0 ? 1 : Math.max(0.02, 1 - m / BASE_FALLOFF);
  }

  function bestX(state: BattleState, time: number): number {
    const px = phases.length ? predictBaseX(state, mobTravel) : 0;
    let best = 0;
    let bestScore = -Infinity;
    for (let x = -lim; x <= lim + 1e-9; x += SAMPLE_STEP) {
      let s = chainScore(x, time);
      if (phases.length) s *= hitFactor(x, px);
      // Small pull toward the current aim breaks ties without jitter.
      s -= 0.01 * Math.abs(x - aim);
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

  return (state, sim, time, events) => {
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
    if (ready && readySince < 0) readySince = time;
    if (!ready) readySince = -1;

    // Champion aiming: a standing wall first, else the boss's predicted position.
    let champTarget = NaN;
    let champTol = 0;
    if (ready) {
      const wall = wallTarget();
      if (wall) {
        champTarget = wall.def.x;
        champTol = Math.max(0.3, wall.half - 0.8);
      } else if (phases.length) {
        champTarget = predictBaseX(state, champTravel);
        champTol = 0.5;
      }
    }

    const threat = threatX(sim.view);
    let target = !Number.isNaN(threat) ? threat : !Number.isNaN(champTarget) ? champTarget : bestX(state, time);
    // Slow periodic sweeps plus jitter, both shrinking as skill rises.
    const nt = time + noiseShift;
    target += sloppiness * (2.5 * Math.sin((2 * Math.PI * nt) / 7) + 1.5 * wobble(nt));
    target = Math.min(lim, Math.max(-lim, target));

    const maxStep = AIM_SPEED * dt;
    aim += Math.min(maxStep, Math.max(-maxStep, target - aim));

    const onTarget = Number.isNaN(champTarget) || Math.abs(aim - Math.min(lim, Math.max(-lim, champTarget))) <= champTol;
    const championPressed = ready && (onTarget || time - readySince >= CHAMPION_PATIENCE);

    return { aimX: aim, firing: true, championPressed, paused: false };
  };
}
