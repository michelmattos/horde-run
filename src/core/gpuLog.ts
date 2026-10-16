// A short log of what happened to the WebGL context, kept in localStorage so it survives
// the recovery reloads and closing the app: each boot (which WebGL it got, or why each
// start-up attempt failed) and each loss mid-game (where the player was, how long the
// page had run, what the renderer held). The phone gives no other trace of a lost
// context, so the error card's Copy report (index.html boot guard) and public/gl-check.html
// include it.

export interface GpuLogEntry {
  at: number; // ms timestamp
  event: 'boot' | 'boot-failed' | 'lost' | 'restored' | 'ended' | 'waited';
  detail: string;
}

const KEY = 'horde-run:gpu-log';
export const GPU_LOG_MAX = 20;

function storage(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

export function readGpuLog(): GpuLogEntry[] {
  try {
    const raw = storage()?.getItem(KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list.filter(
      (e): e is GpuLogEntry =>
        !!e &&
        typeof e === 'object' &&
        typeof (e as GpuLogEntry).at === 'number' &&
        typeof (e as GpuLogEntry).detail === 'string',
    );
  } catch {
    return [];
  }
}

export function logGpu(event: GpuLogEntry['event'], detail: string): void {
  try {
    const list = [...readGpuLog(), { at: Date.now(), event, detail }].slice(-GPU_LOG_MAX);
    storage()?.setItem(KEY, JSON.stringify(list));
  } catch {
    // Full or blocked storage: the log is only a diagnostic.
  }
}

// Sign of life: while the page runs it rewrites one small record (what it is doing and
// when) every few seconds, and marks it closed on pagehide. If iOS kills the page (memory,
// a GPU process crash) nothing marks it closed, so the next start finds an open record and
// logs where the previous page stopped: the context-lost event never fires in that case.
const ALIVE_KEY = 'horde-run:alive';
const ALIVE_MS = 2000;

interface AliveMark {
  start: number; // ms timestamp the page started
  at: number; // last sign of life
  step: string; // what the page was doing
  hidden: boolean; // in the background (another app, or the screen locked)
  closed: boolean;
}

let mark: AliveMark | null = null;

function writeMark(): void {
  try {
    if (mark) storage()?.setItem(ALIVE_KEY, JSON.stringify(mark));
  } catch {
    // Full or blocked storage: the trail is only a diagnostic.
  }
}

// At start-up: log how the previous page ended if it never closed, then start this page's
// record, its heartbeat and its pagehide mark.
export function startAliveTrail(now = Date.now()): void {
  try {
    const prev = JSON.parse(storage()?.getItem(ALIVE_KEY) ?? 'null') as AliveMark | null;
    if (prev && !prev.closed && typeof prev.at === 'number' && typeof prev.start === 'number')
      logGpu(
        'ended',
        `previous page stopped without closing while ${prev.step}${prev.hidden ? ' in the background' : ''}, ` +
          `${Math.round((prev.at - prev.start) / 1000)} s after it started, ` +
          `last sign of life ${Math.round((now - prev.at) / 1000)} s before this start`,
      );
  } catch {
    // A corrupt record says nothing.
  }
  mark = { start: now, at: now, step: 'starting', hidden: document.hidden, closed: false };
  writeMark();
  setInterval(() => {
    if (!mark || mark.closed) return;
    mark.at = Date.now();
    writeMark();
  }, ALIVE_MS);
  addEventListener('pagehide', () => {
    if (!mark) return;
    mark.closed = true;
    mark.at = Date.now();
    writeMark();
  });
  // An app swiped away from the switcher was in the background: iOS ends it without pagehide.
  document.addEventListener('visibilitychange', () => {
    if (!mark) return;
    mark.hidden = document.hidden;
    mark.at = Date.now();
    writeMark();
  });
  // Back from the bfcache: the page runs again.
  addEventListener('pageshow', (e) => {
    if (!mark || !(e as PageTransitionEvent).persisted) return;
    mark.closed = false;
    writeMark();
  });
}

// What the page is doing now ("on the map", "loading 3-4"...), for the trail.
export function aliveStep(step: string): void {
  if (!mark) return;
  mark.step = step;
  mark.at = Date.now();
  writeMark();
}
