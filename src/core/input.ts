// Touch-first input. A DOM-free state machine (createInputCore) holds the rules
// so tests can drive it; createInput only translates pointer/keyboard events.
//
// Rules: the first pointer that goes down in the lower 70% of the screen (and
// not on a HUD button) becomes the aim pointer. The cannon fires on its own
// whenever the game is not paused, touched or not. Aiming is relative to where the finger touched down. Other pointers
// are tracked but never steal aim. Mouse left-drag works the same and may start
// anywhere. Space presses champion; Escape/P call the onPauseKey callback.
import type { InputState } from '../contracts.ts';
import type { Settings } from './settings.ts';

/** Gain from screen-width fraction to lane width (before sensitivity). */
export const AIM_GAIN = 1.15;
/** Touches must start below this fraction of the screen height to aim. */
export const AIM_ZONE_TOP = 0.3;
const MAX_POINTERS = 10;

export interface AimAnchor {
  aimAtDown: number;
  downX: number;
}

/**
 * Relative aim: the cannon moves by the finger's horizontal travel since the
 * anchor. When the result hits ±aimLimit the anchor is rebased to the current
 * finger position, so reversing direction responds immediately. Mutates anchor.
 */
export function relativeAim(
  anchor: AimAnchor,
  clientX: number,
  widthPx: number,
  laneWidth: number,
  sensitivity: number,
  aimLimit: number,
): number {
  const w = widthPx > 0 ? widthPx : 1;
  const raw = anchor.aimAtDown + ((clientX - anchor.downX) / w) * laneWidth * AIM_GAIN * sensitivity;
  if (raw > aimLimit || raw < -aimLimit) {
    const clamped = raw > aimLimit ? aimLimit : -aimLimit;
    anchor.aimAtDown = clamped;
    anchor.downX = clientX;
    return clamped;
  }
  return raw;
}

export type PointerKind = 'mouse' | 'touch' | 'pen';

/** DOM-free input state machine. Coordinates are client px; the caller passes the target size. */
export interface InputCore {
  configure(laneWidth: number, aimLimit: number): void;
  /** Returns true if this pointer became the aim pointer (caller should capture it). */
  down(
    id: number,
    clientX: number,
    clientY: number,
    width: number,
    height: number,
    kind: PointerKind,
    blocked: boolean,
  ): boolean;
  move(id: number, clientX: number, width: number): void;
  up(id: number): void;
  pressChampion(): void;
  setPaused(p: boolean): void;
  readonly paused: boolean;
  readonly aimX: number;
  readonly aimPointerId: number; // -1 when none
  sample(): InputState;
  releaseAll(): void;
  reset(): void;
}

export function createInputCore(settings: Settings): InputCore {
  let laneWidth = 10;
  let aimLimit = 4;
  let aimX = 0;
  let aimId = -1;
  let paused = false;
  let championLatch = false;
  const anchor: AimAnchor = { aimAtDown: 0, downX: 0 };
  // Every live pointer id, so a second finger is known and never promoted to aim.
  const ids = new Float64Array(MAX_POINTERS).fill(NaN);

  const track = (id: number): boolean => {
    for (let i = 0; i < MAX_POINTERS; i++) if (ids[i] === id) return true;
    for (let i = 0; i < MAX_POINTERS; i++) {
      if (Number.isNaN(ids[i])) {
        ids[i] = id;
        return true;
      }
    }
    return false;
  };
  const untrack = (id: number): void => {
    for (let i = 0; i < MAX_POINTERS; i++) if (ids[i] === id) ids[i] = NaN;
  };
  const releaseAll = (): void => {
    ids.fill(NaN);
    aimId = -1;
  };

  return {
    configure(lw, limit) {
      laneWidth = lw;
      aimLimit = limit;
      aimX = 0;
      releaseAll();
    },
    down(id, clientX, clientY, width, height, kind, blocked) {
      if (blocked || paused) return false;
      if (!track(id)) return false;
      if (aimId !== -1) return false;
      const inZone = kind === 'mouse' || clientY >= height * AIM_ZONE_TOP;
      if (!inZone || width <= 0) return false;
      aimId = id;
      anchor.aimAtDown = aimX;
      anchor.downX = clientX;
      return true;
    },
    move(id, clientX, width) {
      if (id !== aimId || paused) return;
      aimX = relativeAim(anchor, clientX, width, laneWidth, settings.sensitivity, aimLimit);
    },
    up(id) {
      untrack(id);
      if (id === aimId) aimId = -1;
    },
    pressChampion() {
      if (!paused) championLatch = true;
    },
    setPaused(p) {
      paused = p;
      if (p) {
        releaseAll();
        championLatch = false;
      }
    },
    get paused() {
      return paused;
    },
    get aimX() {
      return aimX;
    },
    get aimPointerId() {
      return aimId;
    },
    sample() {
      const championPressed = championLatch && !paused;
      if (championPressed) championLatch = false;
      return { aimX, firing: !paused, championPressed, paused };
    },
    releaseAll,
    reset() {
      releaseAll();
      aimX = 0;
      championLatch = false;
    },
  };
}

export interface Input {
  configure(opts: { laneWidth: number; aimLimit: number }): void; // per level; resets aim to 0 and releases pointers
  sample(): InputState; // once per sim step; championPressed is true for exactly one sample after a press
  pressChampion(): void; // HUD button and Space call this
  setPaused(p: boolean): void; // pausing releases all pointers and drops a pending champion press
  readonly paused: boolean;
  addBlockedRegion(test: (clientX: number, clientY: number) => boolean): void; // pointers starting where test() is true are ignored
  /** Escape or P was pressed (not auto-repeat). The integrator toggles pause here. */
  onPauseKey(cb: () => void): void;
  reset(): void; // releases pointers, aim back to 0, clears champion press; does not change paused
  dispose(): void;
}

export function createInput(target: HTMLElement, settings: Settings): Input {
  const core = createInputCore(settings);
  const blocked: Array<(x: number, y: number) => boolean> = [];
  let pauseCb: (() => void) | null = null;

  const isBlocked = (x: number, y: number): boolean => {
    for (let i = 0; i < blocked.length; i++) if (blocked[i](x, y)) return true;
    return false;
  };

  const onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const rect = target.getBoundingClientRect();
    const kind: PointerKind = e.pointerType === 'mouse' ? 'mouse' : e.pointerType === 'pen' ? 'pen' : 'touch';
    const isHud = isBlocked(e.clientX, e.clientY);
    const becameAim = core.down(e.pointerId, e.clientX, e.clientY - rect.top, rect.width, rect.height, kind, isHud);
    if (becameAim) {
      e.preventDefault();
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        // Capture can fail if the pointer is already gone; tracking still works.
      }
    }
  };
  const onMove = (e: PointerEvent): void => {
    if (e.pointerId !== core.aimPointerId) return;
    core.move(e.pointerId, e.clientX, target.clientWidth);
  };
  const onUp = (e: PointerEvent): void => core.up(e.pointerId);
  const onContext = (e: Event): void => e.preventDefault();
  const onBlur = (): void => core.releaseAll();
  const onKey = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    if (e.code === 'Space') {
      if (core.paused) return; // let Space activate focused overlay buttons
      e.preventDefault();
      core.pressChampion();
    } else if (e.code === 'Escape' || e.code === 'KeyP') {
      e.preventDefault();
      pauseCb?.();
    }
  };

  target.addEventListener('pointerdown', onDown);
  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', onUp);
  target.addEventListener('pointercancel', onUp);
  target.addEventListener('lostpointercapture', onUp);
  target.addEventListener('contextmenu', onContext);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('blur', onBlur);
  window.addEventListener('keydown', onKey);

  return {
    configure: (o) => core.configure(o.laneWidth, o.aimLimit),
    sample: () => core.sample(),
    pressChampion: () => core.pressChampion(),
    setPaused: (p) => core.setPaused(p),
    get paused() {
      return core.paused;
    },
    addBlockedRegion: (test) => {
      blocked.push(test);
    },
    onPauseKey: (cb) => {
      pauseCb = cb;
    },
    reset: () => core.reset(),
    dispose() {
      target.removeEventListener('pointerdown', onDown);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      target.removeEventListener('lostpointercapture', onUp);
      target.removeEventListener('contextmenu', onContext);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('keydown', onKey);
      core.releaseAll();
      blocked.length = 0;
      pauseCb = null;
    },
  };
}
