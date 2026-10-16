// A short log of what happened to the WebGL context, kept in localStorage so it survives
// the recovery reloads and closing the app: each boot (which WebGL it got, or why each
// start-up attempt failed) and each loss mid-game (where the player was, how long the
// page had run, what the renderer held). The phone gives no other trace of a lost
// context, so the error card's Copy report (index.html boot guard) and public/gl-check.html
// include it.

export interface GpuLogEntry {
  at: number; // ms timestamp
  event: 'boot' | 'boot-failed' | 'lost' | 'restored';
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
