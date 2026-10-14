// Vibration API feedback. Silently does nothing where vibrate is missing (iOS)
// or when the player turned haptics off; reads settings live.
import type { SimEvent } from '../contracts.ts';
import type { Settings } from './settings.ts';

export interface Haptics {
  onEvents(events: readonly SimEvent[]): void;
  result(win: boolean): void;
}

const TICK_MS = 8;
const TICK_MIN_GAP_MS = 90;
const BUMP_MS = 30;
const WIN_PATTERN = [40, 60, 40, 60, 120];
const LOSE_PATTERN = [200, 80, 200];

export function createHaptics(settings: Settings): Haptics {
  let lastTick = -Infinity;
  const vibrate = (p: number | number[]): void => {
    if (!settings.haptics) return;
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(p);
    } catch {
      // Some browsers throw without a user gesture; haptics are optional.
    }
  };
  return {
    onEvents(events) {
      if (!settings.haptics) return;
      let bump = false;
      let tick = false;
      for (let i = 0; i < events.length; i++) {
        const e = events[i];
        if (e.type === 'championLaunched') bump = true;
        else if (e.type === 'gate' && e.added > 0) tick = true;
      }
      if (bump) {
        vibrate(BUMP_MS);
        lastTick = performance.now();
      } else if (tick) {
        const now = performance.now();
        if (now - lastTick >= TICK_MIN_GAP_MS) {
          lastTick = now;
          vibrate(TICK_MS);
        }
      }
    },
    result(win) {
      vibrate(win ? WIN_PATTERN : LOSE_PATTERN);
    },
  };
}
