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
// all) and launches the champion 1.5-2.5 s after the meter fills. `skill` is ignored by the human profile;
// `attempt` still shifts its noise in time.
//
// Milestone 4: given a loadout (opts.loadout), it leads moving gates with the main mob's speed (firingOrder)
// and the boss with the champion's, and presses the ultimate when its meter is full (the
// battle's ultimateCharge is passed as the fifth argument): at once for the precise
// profile, after the same 1.5-2.5 s delay as the champion for the human one (the
// Blizzard included).
//
// Milestone 5 (World 2): a frozen gate (sim.gateIce, or gateFrozen / gateThawed events)
// gives nothing and soaks the stream like a wall, so the bot only chips it when every
// other line is worse; of a fork's branches it keeps the one it is on unless another
// scores clearly better; ice walls cost like walls on the aim line, igloos too unless the
// crowd is big, when it aims at them (and the champion) to knock them down. While a gust
// pushes, it aims upwind by the drift the stream will pick up on its way to each gate
// (more over ice, where wind feeds the slide); the human counter-steers through its
// usual reaction delay, so late.
//
// Milestone 6 (World 3): a toggling gate scores by the effect it will have when the
// stream gets there (gateEffectAt), so the bot fires at gates that will be open and
// steers off a timed x3 about to flip to a trap; the human cannot time it and counts the
// worse of what a timed gate shows now and half its flight ahead.
// Saws on the line cost like a defender (where a sliding saw will be when the stream
// passes, less with mods.sawGuard). Belts and turntables carry the stream: each candidate
// aim is traced up the lane through them (the human reads a flipping belt's current
// direction), so the bot aims upstream to ride a belt into a good gate. Gates are read
// at their live spots (sim.gateSpot) and skipped while gliding (sim.gateLifted), so after
// a Jack-in-the-Box shuffle the bot re-targets (the human through its reaction delay).
// Shield walls block the line like walls, and the champion is launched at them. With a
// Gear Gun each aim scores as the mean of its left and right ricochet streams.

import type {
  BattleState,
  DefenderDef,
  DefenderView,
  GateDef,
  GateOp,
  LevelDef,
  SimEvent,
  SimView,
} from '../contracts.ts';
import {
  DEFENDER_DEFAULTS,
  LAYOUT,
  Team,
  conveyorDir,
  gateEffectAt,
  gateX,
  sawPos,
  sawUp,
  turntableSpin,
} from '../contracts.ts';
import type { BattleInput } from './battle.ts';
import { defenderWidth } from './levels.ts';
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
// World 2
const FORK_STICK = 1.15; // a fork branch must score this much better to switch to it
const CHIP_PULL = 0.05; // per point of gain, how much a frozen good gate beats another frozen one
const IGLOO_CROWD = 80; // crowd weight from which the bot attacks igloos instead of avoiding them
const IGLOO_BONUS = 1.6; // their pull on the aim line then
// Wind drift model (mirrors the sim's ice constants): off ice the wind moves units at its
// force; on ice it feeds a slide that builds up and decays slowly.
const DRIFT_DT = 0.1;
const ICE_WIND_GAIN = 1.5;
const ICE_DECAY = 0.6;
const OFF_ICE_DECAY = 8;
const ICE_MAX_SLIDE = 8;
// World 3
const SAW_FACTOR = 0.3; // crowd kept when a saw sits on the line (it shreds the stream)
const TRACE_DT = 0.1; // seconds per step when tracing a stream over belts and turntables
const HEAVY_CARRY = 0.5; // belts carry champion-kind units at this share (mirrors the sim)

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
  championDelayMin: 1.5, // seconds after the meter fills before it looks for a shot
  championDelayMax: 2.5,
  championPatience: 9,
};

export type AutoplaySim = {
  readonly view: SimView;
  readonly defenders?: readonly DefenderView[];
  gateIce?(index: number): number; // World 2: remaining ice hp of a gate (level order); 0 = open
  gateSpot?(index: number, out: { x: number; z: number }): void; // World 3: a gate's live spot
  gateLifted?(index: number): boolean; // World 3: true while a gate glides (no effect)
};
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
  def: Pick<DefenderDef, 'id' | 'kind' | 'x' | 'z'>;
  slot: number; // index into the per-call liveness flags
  half: number; // footprint half-width
  range: number; // towers: shooting radius; walls: 0
  ice: boolean; // an ice wall: never destroyed
}

// What a gate effect does to a stream of single mobs (null: a shut gate, no change).
function effectGain(e: { op: GateOp; value: number } | null): number {
  if (!e) return 1;
  return e.op === 'mul' ? e.value : e.op === 'add' ? 1 + e.value : e.op === 'div' ? 1 / e.value : 0;
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
  const defWidth = (d: DefenderDef): number => d.width ?? defenderWidth(d.kind);
  const obstacles: Obstacle[] = [
    ...(level.defenders ?? []).map((d) => ({
      def: d,
      slot: 0,
      half: defWidth(d) / 2,
      range: d.kind === 'tower' ? (d.range ?? DEFENDER_DEFAULTS.range) : 0,
      ice: false,
    })),
    ...(level.iceWalls ?? []).map((w) => ({
      def: { id: w.id, kind: 'wall' as const, x: w.x, z: w.z },
      slot: 0,
      half: w.width / 2,
      range: 0,
      ice: true,
    })),
  ].sort((a, b) => a.def.z - b.def.z);
  obstacles.forEach((o, i) => (o.slot = i));
  const standing = new Uint8Array(obstacles.length); // refreshed every call
  const broken = new Set<string>(); // one-use gates seen breaking, and destroyed defenders
  // World 2: frozen gates (by id) and each sorted gate's index in level order (for gateIce).
  const frozen = new Set<string>();
  const gateIndex = gates.map((g) => level.gates.indexOf(g));
  const forkOf = gates.map((g) => g.fork);
  const iced = new Uint8Array(gates.length); // refreshed every call
  const drift = new Float64Array(gates.length); // per gate: wind drift of the stream on the way there
  const obstacleDrift = new Float64Array(obstacles.length);
  const ice = level.ice ?? [];
  const laneHalf = level.lane.width / 2;
  const gustDefs = [
    ...(level.gusts ?? []),
    ...(level.boss?.phases ?? []).flatMap((ph) => (ph.gusts ? [ph.gusts] : [])),
  ];
  const gustDuration = gustDefs.length ? Math.max(...gustDefs.map((g) => g.duration)) : 0;
  let gustSince = -1; // time the current push was first seen
  let crowd = 0; // player crowd weight, for the igloo rule
  const phases = level.boss ? level.boss.phases.slice().sort((a, b) => b.belowHp - a.belowHp) : [];
  const mobSpeed = opts?.loadout ? firingOrder(opts.loadout.mobs)[0].speed : MOB_SPEED;
  const mobTravel = (level.lane.length - LAYOUT.cannonZ) / mobSpeed;
  const champTravel = (level.lane.length - LAYOUT.cannonZ) / (opts?.loadout?.champion.speed ?? CHAMPION_SPEED);
  const useUltimate = opts?.loadout !== undefined;
  // World 3. Each is only switched on by a level that has the hazard, so World 1 and 2
  // levels score exactly as before.
  const toggles = gates.some((g) => g.toggle);
  const saws = level.saws ?? [];
  const sawKeep = 1 - (1 - SAW_FACTOR) * (1 - (level.mods?.sawGuard ?? 0));
  const belts = level.conveyors ?? [];
  const tables = level.turntables ?? [];
  const carried = belts.length > 0 || tables.length > 0;
  const grip = 1 - (level.mods?.beltGrip ?? 0);
  const carry = opts?.loadout && firingOrder(opts.loadout.mobs)[0].kind === 'heavy' ? HEAVY_CARRY * grip : grip;
  const liveSpots = phases.some((ph) => ph.shuffle);
  const liveX = Float64Array.from(gates, (g) => g.x); // each sorted gate's live spot
  const liveZ = Float64Array.from(gates, (g) => g.z);
  const lifted = new Uint8Array(gates.length); // refreshed every call
  const order = Int32Array.from(gates, (_, k) => k); // sorted gates in their live z order
  const spot = { x: 0, z: 0 };
  const sawPt = { x: 0, z: 0 };
  // The traced stream (carried levels): x offset picked up on the way to each gate, obstacle
  // and saw, and the seconds it takes to get there. Targets are walked in z order.
  const pathG = new Float64Array(gates.length);
  const pathO = new Float64Array(obstacles.length);
  const pathS = new Float64Array(saws.length);
  const timeG = new Float64Array(gates.length);
  const timeS = new Float64Array(saws.length);
  const sawZ = saws.map((sw) => sw.z + (sw.path?.dz ?? 0) / 2); // the line a saw is crossed on
  // Gear Gun: every crowd shot ricochets, half of them to each side, so each aim is scored
  // as the mean of a left and a right stream bouncing off the lane walls.
  const shot = opts?.loadout?.shot;
  const rico = shot?.kind === 'ricochet' ? shot : undefined;
  const ricoVx = rico ? rico.angle * mobSpeed : 0;
  const targets: { z: number; kind: 0 | 1 | 2; i: number }[] = [
    ...gates.map((g, i) => ({ z: g.z, kind: 0 as const, i })),
    ...obstacles.map((o) => ({ z: o.def.z, kind: 1 as const, i: o.slot })),
    ...saws.map((_, i) => ({ z: sawZ[i], kind: 2 as const, i })),
  ];

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
  // `k` is the gate's sorted index; a shuffled gate sways around its live spot.
  const gateSeenX = (g: GateDef, k: number, time: number): number => {
    const bx = liveX[k];
    const bz = liveZ[k];
    if (bz > farZ) return bx + farOffset(time + noiseShift, k + 1);
    const tc = time + (carried ? timeG[k] : (bz - LAYOUT.cannonZ) / mobSpeed);
    const exact = bx === g.x ? gateX(g, tc) : bx + gateX(g, tc) - g.x;
    return lead === 1 ? exact : bx + lead * (exact - bx);
  };
  // The effect a toggling gate will have when the stream gets there. The human cannot
  // time it: it plays safe and counts the worse of what the gate shows now and what it
  // will show half the flight ahead (only what it shows now far up the lane).
  const gateEffect = (g: GateDef, k: number, time: number): { op: GateOp; value: number } | null => {
    if (!g.toggle) return g;
    const travel = carried ? timeG[k] : (liveZ[k] - LAYOUT.cannonZ) / mobSpeed;
    if (!human) return gateEffectAt(g, time + travel);
    const now = gateEffectAt(g, time);
    if (liveZ[k] > farZ) return now;
    const then = gateEffectAt(g, time + lead * travel);
    return effectGain(then) < effectGain(now) ? then : now;
  };
  const obstacleX = (o: Obstacle, time: number): number =>
    o.def.z <= farZ ? o.def.x : o.def.x + farOffset(time + noiseShift, 17 + o.slot);

  // Expected crowd multiplier for weight-1 mobs fired at x: every gate on the line
  // applies in z order (clones go on through the later ones too), and a defender
  // standing on the line soaks part of the stream before anything behind it.
  // Where a ricochet stream fired at x0 is after t seconds (side -1 left, 1 right): it
  // flips at each lane wall and walks straight on along the wall once its bounces run out.
  function ricoX(x0: number, t: number, side: number): number {
    const wall = laneHalf - LAYOUT.mobRadius;
    let x = x0;
    let v = side * ricoVx;
    let left = rico?.bounces ?? 0;
    let rest = t;
    while (rest > 0 && v !== 0) {
      const tw = ((v > 0 ? wall : -wall) - x) / v;
      if (tw >= rest) return x + v * rest;
      x = v > 0 ? wall : -wall;
      rest -= tw;
      left--;
      v = left > 0 ? -v : 0;
    }
    return x;
  }
  // The sideways offset a ricochet stream (side, 0 = none) has picked up by depth z.
  const ricoOff = (x: number, z: number, side: number): number =>
    side === 0 ? 0 : ricoX(x, (z - LAYOUT.cannonZ) / mobSpeed, side) - x;

  function chainScore(x: number, time: number, side = 0): number {
    if (carried) trace(x, time);
    let c = 1;
    let gi = 0;
    let oi = 0;
    while (gi < gates.length || oi < obstacles.length) {
      const k = gi < gates.length ? order[gi] : -1;
      const g: GateDef | undefined = gates[k];
      const o: Obstacle | undefined = obstacles[oi];
      if (o && (!g || o.def.z < liveZ[k])) {
        oi++;
        const ox = x + obstacleDrift[o.slot] + pathO[o.slot] + ricoOff(x, o.def.z, side);
        if (alive(o) && Math.abs(ox - obstacleX(o, time)) < o.half + BLOCK_MARGIN)
          c *= o.def.kind === 'igloo' && crowd >= IGLOO_CROWD ? IGLOO_BONUS : BLOCK_FACTOR;
        continue;
      }
      gi++;
      if (broken.has(g.id) || lifted[k]) continue;
      const gx = gateSeenX(g, k, time);
      const d = Math.abs(x + drift[k] + pathG[k] + ricoOff(x, liveZ[k], side) - gx);
      if (iced[k]) {
        // A frozen gate does nothing and soaks the stream until it is chipped open; when
        // every line is blocked, the better gate is the one worth chipping.
        if (d <= g.width / 2)
          c *= BLOCK_FACTOR * (1 + CHIP_PULL * (g.op === 'mul' ? g.value - 1 : g.op === 'add' ? g.value : 0));
        continue;
      }
      const e = toggles ? gateEffect(g, k, time) : g;
      if (!e) continue; // a timed gate that will be shut: nothing happens there
      const good = e.op === 'mul' || e.op === 'add';
      if (good ? d > g.width / 2 - GOOD_MARGIN : d > g.width / 2 + TRAP_MARGIN) continue;
      switch (e.op) {
        case 'mul':
          c *= e.value;
          break;
        case 'add':
          c *= 1 + e.value;
          break;
        case 'sub':
          c = 0;
          break;
        case 'div':
          c /= e.value;
          break;
      }
    }
    // Saws shred whatever passes through them while they are up.
    for (let i = 0; i < saws.length; i++) {
      const sw = saws[i];
      const tc = time + lead * (carried ? timeS[i] : (sawZ[i] - LAYOUT.cannonZ) / mobSpeed);
      if (!sawUp(sw, tc)) continue;
      sawPos(sw, tc, sawPt);
      const sx = sawZ[i] > farZ ? sw.x + (sw.path?.dx ?? 0) / 2 + farOffset(time + noiseShift, 29 + i) : sawPt.x;
      if (Math.abs(x + pathS[i] + ricoOff(x, sawZ[i], side) - sx) < sw.radius + BLOCK_MARGIN) c *= sawKeep;
    }
    // Towers shoot whatever passes within range; the closer the line, the more it costs.
    for (const o of obstacles) {
      if (o.range === 0 || !alive(o)) continue;
      const d = Math.abs(x - obstacleX(o, time));
      if (d < o.range) c *= 1 - TOWER_COST * (1 - d / o.range);
    }
    return c;
  }

  // Follows a stream fired at x0 up the lane over belts and turntables, recording the x
  // offset and travel time at each gate, obstacle and saw line (targets sorted by z).
  function trace(x0: number, time: number): void {
    let x = x0;
    let z: number = LAYOUT.cannonZ;
    let t = 0;
    let ti = 0;
    const zEnd = level.lane.length;
    while (ti < targets.length && z < zEnd && t < 30) {
      const now = human ? time : time + t; // the human reads belts as they run now
      let vx = 0;
      let vz = mobSpeed;
      for (const b of belts) {
        if (Math.abs(x - b.x) > b.width / 2 || z < b.z || z > b.z + b.length) continue;
        const dir = conveyorDir(b, now) * carry;
        vx += b.vx * dir;
        vz += b.vz * dir;
      }
      let nx = x + vx * TRACE_DT;
      let nz = z + Math.max(0.5, vz) * TRACE_DT;
      for (const p of tables) {
        const dx = nx - p.x;
        const dz = nz - p.z;
        if (dx * dx + dz * dz > p.radius * p.radius) continue;
        const a = turntableSpin(p, now) * carry * TRACE_DT;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        nx = p.x + dx * ca - dz * sa;
        nz = Math.max(nz, p.z + dx * sa + dz * ca); // the stream still walks on: never backward
      }
      nx = Math.max(-laneHalf, Math.min(laneHalf, nx));
      while (ti < targets.length && targets[ti].z <= nz) {
        const tg = targets[ti++];
        const f = nz > z ? (tg.z - z) / (nz - z) : 1;
        const off = x + (nx - x) * Math.max(0, Math.min(1, f)) - x0;
        const at = t + TRACE_DT * Math.max(0, Math.min(1, f));
        if (tg.kind === 0) {
          pathG[tg.i] = off;
          timeG[tg.i] = at;
        } else if (tg.kind === 1) pathO[tg.i] = off;
        else {
          pathS[tg.i] = off;
          timeS[tg.i] = at;
        }
      }
      x = nx;
      z = nz;
      t += TRACE_DT;
    }
  }

  // Refreshes live gate spots after a shuffle (sorted order by live z) and the target list.
  function updateSpots(sim: AutoplaySim): void {
    let changed = false;
    for (let k = 0; k < gates.length; k++) {
      lifted[k] = sim.gateLifted?.(gateIndex[k]) ? 1 : 0;
      if (!sim.gateSpot) continue;
      sim.gateSpot(gateIndex[k], spot);
      if (spot.x !== liveX[k] || spot.z !== liveZ[k]) changed = true;
      liveX[k] = spot.x;
      liveZ[k] = spot.z;
    }
    if (!changed) return;
    order.sort((a, b) => liveZ[a] - liveZ[b] || a - b);
    for (const tg of targets) if (tg.kind === 0) tg.z = liveZ[tg.i];
    targets.sort((a, b) => a.z - b.z);
  }

  // Is x inside an ice patch at depth z?
  function onIce(x: number, z: number): boolean {
    for (const p of ice) if (z >= p.z && z <= p.z + p.length && Math.abs(x - p.x) <= p.width / 2) return true;
    return false;
  }

  // Sideways drift a stream fired at x picks up before it reaches depth z while a gust of
  // `force` pushes for `left` more seconds (integrated along its path at mob speed).
  function driftTo(x: number, zEnd: number, force: number, left: number): number {
    let px = 0;
    let v = 0;
    let t = 0;
    for (let z = LAYOUT.cannonZ; z < zEnd; z += mobSpeed * DRIFT_DT, t += DRIFT_DT) {
      const wind = t < left ? force : 0;
      if (onIce(x + px, z)) {
        v += ICE_WIND_GAIN * wind * DRIFT_DT;
        v = Math.max(-ICE_MAX_SLIDE, Math.min(ICE_MAX_SLIDE, v)) * Math.exp(-ICE_DECAY * DRIFT_DT);
      } else {
        px += wind * DRIFT_DT;
        v *= Math.exp(-OFF_ICE_DECAY * DRIFT_DT);
      }
      px += v * DRIFT_DT;
      px = Math.max(-laneHalf - x, Math.min(laneHalf - x, px)); // the lane's sides stop the drift
    }
    return px;
  }

  // Refreshes the per-gate and per-obstacle drift for the current gust (0 when calm).
  function updateDrift(state: BattleState, time: number): void {
    const g = state.gust;
    const active = g?.active === true && g.dir !== 0;
    if (!active) gustSince = -1;
    else if (gustSince < 0) gustSince = time;
    const left = active ? Math.max(0, gustDuration - (time - gustSince)) : 0;
    const force = active ? (g?.dir ?? 0) * gustForce(state) : 0;
    for (let k = 0; k < gates.length; k++) drift[k] = force === 0 ? 0 : driftTo(aim, gates[k].z, force, left);
    for (const o of obstacles) obstacleDrift[o.slot] = force === 0 ? 0 : driftTo(aim, o.def.z, force, left);
  }

  // The push of the gust under way: the strongest gust the level (or boss) can blow.
  function gustForce(state: BattleState): number {
    let f = 0;
    for (const d of level.gusts ?? []) f = Math.max(f, Math.abs(d.force));
    const ph = phases[state.bossPhase ?? 0];
    if (ph?.gusts) f = Math.max(f, Math.abs(ph.gusts.force));
    return f;
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
    const branch = forkBranch(intent, time);
    for (let x = -lim; x <= lim + 1e-9; x += SAMPLE_STEP) {
      let s: number;
      if (rico) {
        const end = level.lane.length;
        s = 0.5 * chainScore(x, time, -1) * (phases.length ? hitFactor(x + ricoOff(x, end, -1), px) : 1);
        s += 0.5 * chainScore(x, time, 1) * (phases.length ? hitFactor(x + ricoOff(x, end, 1), px) : 1);
      } else {
        s = chainScore(x, time);
        if (phases.length) s *= hitFactor(x, px);
      }
      // Stay on the fork branch already chosen unless another is clearly better.
      if (branch >= 0 && forkBranch(x, time) === branch) s *= FORK_STICK;
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

  // The fork gate (sorted index) a stream fired at x goes through, or -1.
  function forkBranch(x: number, time: number): number {
    for (let k = 0; k < gates.length; k++) {
      const g = gates[k];
      if (forkOf[k] === undefined || broken.has(g.id)) continue;
      if (Math.abs(x + drift[k] - gateSeenX(g, k, time)) <= g.width / 2 - GOOD_MARGIN) return k;
    }
    return -1;
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
      if ((o.def.kind !== 'wall' && o.def.kind !== 'igloo' && o.def.kind !== 'shield') || o.ice || !alive(o)) continue;
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
        else if (e.type === 'gateFrozen') frozen.add(e.gateId);
        else if (e.type === 'gateThawed') frozen.delete(e.gateId);
      }
    }
    for (let k = 0; k < gates.length; k++) {
      const ice = sim.gateIce ? sim.gateIce(gateIndex[k]) > 0 : frozen.has(gates[k].id);
      iced[k] = ice ? 1 : 0;
    }
    crowd = state.playerUnits;
    if (liveSpots) updateSpots(sim);
    // Defenders stand until the sim reports hp 0 (or, without sim.defenders, until destroyed).
    for (const o of obstacles) {
      const view = sim.defenders?.find((d) => d.id === o.def.id);
      standing[o.slot] = o.ice || (!broken.has(o.def.id) && (view ? view.hp > 0 : true)) ? 1 : 0;
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
    if (gustDefs.length) updateDrift(state, time);
    const threat = threatX(sim.view);
    let target = !Number.isNaN(threat) ? threat : !Number.isNaN(champTarget) ? champTarget : bestX(state, time);
    const nt = time + noiseShift;
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
      ? { aimX: aim, firing: true, championPressed, ultimatePressed, paused: false }
      : { aimX: aim, firing: true, championPressed, paused: false };
  };
}
