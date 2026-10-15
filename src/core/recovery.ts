// Recovery from a lost WebGL context. iOS drops the context under GPU memory pressure or
// while the app is in the background, and the restore it sometimes offers leaves a
// half-rebuilt scene (or never comes), which showed as a blank battlefield behind the
// HUD. So the game reloads the page instead and boots straight back to where the player
// was: the same campaign level (from its start) or the Expedition run (which is saved
// at every step). The plan lives in sessionStorage so it survives the reload. A second
// loss soon after a recovery reloads on the lowest graphics settings; a third gives up
// and leaves the pause card up rather than reloading in a loop.

export type RecoveryTarget = { kind: 'level'; id: string } | { kind: 'expedition' } | { kind: 'map' };
export type RecoveryPlan = 'reload' | 'reload-low' | 'give-up';

export interface RecoveryState {
  at: number; // ms timestamp of the last loss
  count: number; // losses within RECOVERY_WINDOW_MS of each other
  target: RecoveryTarget | null; // where to boot; null once the reload consumed it
}

export const RECOVERY_WINDOW_MS = 90_000;
const KEY = 'horde-run:gpu-recovery';

export function planRecovery(prev: RecoveryState | null, now: number): { plan: RecoveryPlan; count: number } {
  const count = prev && now - prev.at >= 0 && now - prev.at < RECOVERY_WINDOW_MS ? prev.count + 1 : 1;
  return { plan: count === 1 ? 'reload' : count === 2 ? 'reload-low' : 'give-up', count };
}

function storage(): Storage | null {
  try {
    return (globalThis as { sessionStorage?: Storage }).sessionStorage ?? null;
  } catch {
    return null;
  }
}

function parseTarget(v: unknown): RecoveryTarget | null {
  if (!v || typeof v !== 'object') return null;
  const t = v as { kind?: unknown; id?: unknown };
  if (t.kind === 'level' && typeof t.id === 'string') return { kind: 'level', id: t.id };
  if (t.kind === 'expedition' || t.kind === 'map') return { kind: t.kind };
  return null;
}

export function readRecovery(): RecoveryState | null {
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as { at?: unknown; count?: unknown; target?: unknown };
    if (typeof o.at !== 'number' || typeof o.count !== 'number') return null;
    return { at: o.at, count: o.count, target: parseTarget(o.target) };
  } catch {
    return null;
  }
}

// False when it could not be stored (then a reload would lose the player's place).
export function writeRecovery(s: RecoveryState): boolean {
  try {
    const st = storage();
    if (!st) return false;
    st.setItem(KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

// At boot: where the last recovery asked to return to, once (the loss count is kept so
// a quick repeat is still detected).
export function takeRecoveryTarget(): RecoveryTarget | null {
  const s = readRecovery();
  if (!s?.target) return null;
  writeRecovery({ ...s, target: null });
  return s.target;
}
