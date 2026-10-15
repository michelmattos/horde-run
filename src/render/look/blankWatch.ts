// Blank-canvas watchdog. Pure (no Babylon imports) so it runs under Node's type stripping.
//
// Some GPUs (seen on an iPhone) never get a picture out of the post-process pipeline:
// the canvas stays fully transparent, so only the DOM HUD shows over the page
// background. A healthy frame always has opaque pixels (the scene clears to an opaque
// colour), so after a level load the renderer reads back a few canvas pixels every
// PROBE_EVERY seconds. The first opaque probe ends the watch; if the canvas is still
// transparent after BLANK_LIMIT seconds of drawn frames, the look drops the riskiest
// part of the pipeline (MSAA first, then post-processing altogether) and the watch
// starts again on the cheaper setup.

export const PROBE_EVERY = 0.25; // seconds of drawn frames between read-backs
export const BLANK_LIMIT = 3; // seconds a canvas may stay transparent (shader compiles) before falling back

// RGBA bytes read back from the canvas: blank when no sampled pixel has any alpha.
export function isBlankSample(rgba: Uint8Array): boolean {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 0) return false;
  return true;
}

export class BlankWatch {
  private watching = false;
  private elapsed = 0;
  private sinceProbe = 0;

  get active(): boolean {
    return this.watching;
  }

  // (Re)start after a level load, a pipeline change or a restored context.
  start(): void {
    this.watching = true;
    this.elapsed = 0;
    this.sinceProbe = PROBE_EVERY; // probe the first drawn frame
  }

  stop(): void {
    this.watching = false;
  }

  // Feed real seconds since the last drawn frame; true when this frame should be read back.
  tick(dt: number): boolean {
    if (!this.watching) return false;
    const d = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.1) : 0;
    this.elapsed += d;
    this.sinceProbe += d;
    if (this.sinceProbe < PROBE_EVERY) return false;
    this.sinceProbe = 0;
    return true;
  }

  // Result of the read-back tick() asked for; true when it is time to fall back.
  report(blank: boolean): boolean {
    if (!blank) {
      this.watching = false;
      return false;
    }
    if (this.elapsed < BLANK_LIMIT) return false;
    this.watching = false;
    return true;
  }
}
