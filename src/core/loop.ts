// Fixed-step accumulator: the sim always advances in SIM_DT steps regardless of
// display refresh rate. Long frames are clamped and excess backlog dropped so a
// slow phone degrades into slow motion instead of a death spiral.
import { SIM_HZ } from '../contracts.ts';

export interface FixedStep {
  advance(frameSeconds: number, step: (dt: number) => void): number; // returns steps run
  reset(): void;
}

const MAX_FRAME_SECONDS = 0.25;

export function createFixedStep(hz: number = SIM_HZ, maxStepsPerFrame: number = 5): FixedStep {
  const dt = 1 / hz;
  // Small epsilon so 1/30 s at 60 Hz yields exactly 2 steps despite float error.
  const eps = dt * 1e-6;
  let acc = 0;
  return {
    advance(frameSeconds, step) {
      const frame = Number.isFinite(frameSeconds) ? Math.min(Math.max(frameSeconds, 0), MAX_FRAME_SECONDS) : 0;
      acc += frame;
      let steps = 0;
      while (acc + eps >= dt && steps < maxStepsPerFrame) {
        step(dt);
        acc -= dt;
        steps++;
      }
      if (acc < 0) acc = 0;
      if (steps === maxStepsPerFrame && acc >= dt) acc = acc % dt; // drop the backlog
      return steps;
    },
    reset() {
      acc = 0;
    },
  };
}
