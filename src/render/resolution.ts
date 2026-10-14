// Adaptive render resolution (concept §8 "Phone performance"). Pure logic: it tracks a
// smoothed frame time and steps the render pixel ratio down when frames run long and
// back up when there is headroom. The caller applies it as hardware scaling.
//
// Frame time here is the rAF interval, so on a vsynced display a frame with headroom
// still reads as the display interval (16.7 ms at 60 Hz). "Headroom" therefore means
// "keeping up with a 60 Hz display", not "faster than it". If a step up turns out to
// be too much and the ratio drops again soon after, the next step up waits longer, so
// a device on the edge does not oscillate. warmUp() ignores samples for a while after
// a level load (shader compiles, buffer uploads) so a one-off hitch never sticks.
//
// Note: with the engine's adaptToDeviceRatio = false, Babylon renders at
// cssSize / hardwareScalingLevel, so the scaling level for a pixel ratio r is 1 / r.

const MAX_RATIO = 1.5;
const MIN_RATIO = 0.75;
const STEP = 0.25;
const SLOW_MS = 20;
const HEADROOM_MS = 17.5; // at or under a 60 Hz vsync interval, with a little jitter allowance
const SLOW_HOLD = 1.5; // seconds over SLOW_MS before stepping down
const UP_HOLD = 5; // seconds of headroom before stepping up
const UP_HOLD_MAX = 40; // backoff ceiling after repeated failed step-ups
const FAILED_UP_WINDOW = 10; // a drop within this many seconds of a step up means the step up failed
const WARM_UP = 2; // default seconds ignored by warmUp()
const SMOOTHING = 0.1; // EMA weight per frame
const IGNORE_DT = 0.25; // tab switches and hitches are not a steady frame time

export class ResolutionScaler {
  readonly cap: number;
  ratio: number;
  // Lowest ratio a step down may reach right now (the renderer raises it while cheaper
  // savings, such as a lower shadow/post tier, are still available).
  floor = MIN_RATIO;
  private avgMs = 16.7;
  private slowFor = 0;
  private fastFor = 0;
  private upHold = UP_HOLD;
  private sinceUp = Infinity; // seconds since the last step up
  private ignoreFor = 0;

  // `start`: a ratio remembered from an earlier session (clamped to [MIN_RATIO, cap]).
  constructor(devicePixelRatio: number, start?: number) {
    this.cap = Math.min(Math.max(devicePixelRatio, MIN_RATIO), MAX_RATIO);
    this.ratio =
      start !== undefined && start > 0
        ? Math.min(this.cap, Math.max(MIN_RATIO, Math.round(start / STEP) * STEP))
        : this.cap;
  }

  // Ignore frame times for `seconds` (call on level load) and forget the step-up backoff.
  warmUp(seconds = WARM_UP): void {
    this.ignoreFor = seconds;
    this.upHold = UP_HOLD;
    this.sinceUp = Infinity;
    this.settle();
  }

  // Feed one rendered frame; returns true when `ratio` changed.
  sample(dt: number): boolean {
    if (!(dt > 0) || dt > IGNORE_DT) return false;
    if (this.ignoreFor > 0) {
      this.ignoreFor -= dt;
      return false;
    }
    this.sinceUp += dt;
    this.avgMs += (dt * 1000 - this.avgMs) * SMOOTHING;
    if (this.avgMs > SLOW_MS) {
      this.slowFor += dt;
      this.fastFor = 0;
    } else if (this.avgMs <= HEADROOM_MS) {
      this.fastFor += dt;
      this.slowFor = 0;
    } else {
      this.slowFor = 0;
      this.fastFor = 0;
    }
    const floor = Math.max(MIN_RATIO, Math.min(this.floor, this.cap));
    if (this.slowFor >= SLOW_HOLD && this.ratio > floor) {
      this.ratio = Math.max(floor, this.ratio - STEP);
      if (this.sinceUp < FAILED_UP_WINDOW) this.upHold = Math.min(UP_HOLD_MAX, this.upHold * 2);
      this.sinceUp = Infinity;
      this.settle();
      return true;
    }
    if (this.fastFor >= this.upHold && this.ratio < this.cap) {
      this.ratio = Math.min(this.cap, this.ratio + STEP);
      this.sinceUp = 0;
      this.settle();
      return true;
    }
    return false;
  }

  get scalingLevel(): number {
    return 1 / this.ratio;
  }

  private settle(): void {
    this.slowFor = 0;
    this.fastFor = 0;
    this.avgMs = 16.7;
  }
}
