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

// Frame cap (concept §8 "Heat and battery"): the render loop draws at most ~60 frames a
// second even on a 120 Hz ProMotion screen. requestAnimationFrame still fires every
// display refresh; tick() says which of those callbacks may draw. A callback that comes
// sooner than one 60 Hz frame after the last drawn frame (less a little slack for
// timer jitter, well under half of a 120 Hz frame) is skipped. On a 60 Hz screen every
// frame draws; on 120 Hz every other one. Returns the seconds since the last drawn
// frame, or -1 to skip this one.
export const FRAME_CAP_HZ = 60;
const FRAME_SLACK_MS = 3;

export interface FrameCap {
  tick(nowMs: number): number;
  reset(): void; // the next tick always draws (after a stop, a resize or a menu)
}

export function createFrameCap(hz: number = FRAME_CAP_HZ, slackMs: number = FRAME_SLACK_MS): FrameCap {
  const minGap = 1000 / hz - slackMs;
  let last = -1;
  return {
    tick(nowMs) {
      if (last < 0 || nowMs < last) {
        last = nowMs;
        return 0;
      }
      const gap = nowMs - last;
      if (gap < minGap) return -1;
      last = nowMs;
      return gap / 1000;
    },
    reset() {
      last = -1;
    },
  };
}
