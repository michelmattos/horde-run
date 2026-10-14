// Autoplay bot: drives a battle the way a decent player would, for the balance test
// and integration's smoke test. It always fires, sweeps its aim toward the lane x
// whose gate chain grows the crowd most (traps score badly so they are avoided),
// turns to defend when enemies get close to the base, and launches the champion as
// soon as the meter is full. Skill scales the aim noise and slow wandering sweeps.
//
// Deterministic: the only state is the current aim and last time, and the "noise" is
// a fixed function of time, so the same input sequence gives the same outputs.

import type { BattleState, GateDef, InputState, LevelDef, SimView } from '../contracts.ts';
import { LAYOUT, Team, gateX } from '../contracts.ts';

const MOB_SPEED = 7; // matches the sim's player mob speed; used to lead moving gates
const SAMPLE_STEP = 0.25; // candidate aim spacing (world units)
const AIM_SPEED = 9; // max aim slew (world units / s), roughly a relaxed thumb
const GOOD_MARGIN = 0.45; // stay this far inside a good gate's edge (crowd spread)
const TRAP_MARGIN = 0.8; // and this far outside a trap's edge
const DEFEND_Z = 14; // enemies closer than this to the player base count as a threat
const DEFEND_WEIGHT = 6; // threat weight that makes the bot turn to defend

// Expected crowd multiplier for weight-1 mobs fired at x: every gate on the line
// applies in z order, and clones from a gate go on through the later ones too.
function chainScore(gates: readonly GateDef[], x: number, time: number): number {
  let c = 1;
  for (const g of gates) {
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
  return c;
}

// Smooth pseudo-noise in about [-1, 1]: a fixed function of time, no Math.random.
function wobble(t: number): number {
  return 0.6 * Math.sin(t * 1.7) * Math.sin(t * 2.9 + 1.3) + 0.4 * Math.sin(t * 4.3 + 0.5);
}

export function createAutoplay(
  level: LevelDef,
  opts?: { skill?: number },
): (state: BattleState, sim: { readonly view: SimView }, time: number) => InputState {
  const skill = Math.min(1, Math.max(0, opts?.skill ?? 0.7));
  const lim = level.cannon.aimLimit;
  // Gates sorted by z once, so the chain is evaluated in crossing order.
  const gates = level.gates.slice().sort((a, b) => a.z - b.z);
  const sloppiness = 1 - skill;
  let aim = 0;
  let lastTime = 0;

  function bestGateX(time: number): number {
    let best = 0;
    let bestScore = -Infinity;
    for (let x = -lim; x <= lim + 1e-9; x += SAMPLE_STEP) {
      // Small pull toward the current aim breaks ties without jitter.
      const s = chainScore(gates, x, time) - 0.01 * Math.abs(x - aim);
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

  return (state, sim, time) => {
    const threat = threatX(sim.view);
    let target = Number.isNaN(threat) ? bestGateX(time) : threat;
    // Slow periodic sweeps plus jitter, both shrinking as skill rises.
    target += sloppiness * (2.5 * Math.sin((2 * Math.PI * time) / 7) + 1.5 * wobble(time));
    target = Math.min(lim, Math.max(-lim, target));

    const dt = Math.max(0, time - lastTime);
    lastTime = time;
    const maxStep = AIM_SPEED * dt;
    aim += Math.min(maxStep, Math.max(-maxStep, target - aim));

    return {
      aimX: aim,
      firing: true,
      championPressed: state.outcome === 'playing' && state.championCharge >= 1,
      paused: false,
    };
  };
}
