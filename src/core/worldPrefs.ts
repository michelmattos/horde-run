// Per-viewer world map memory under its own localStorage key: which world the map last
// showed and which worlds' title cards have been seen. A convenience only: when storage
// is blocked or the data is damaged it falls back to "nothing remembered" and never
// throws. Pure apart from the injected store, so Node tests use an in-memory one.
import type { KeyValueStore } from './save.ts';

export const WORLD_PREFS_KEY = 'horde-run:map';

export interface WorldPrefs {
  lastWorld?: string; // id of the world the map showed last
  seen: string[]; // world ids whose title card has been shown
}

function defaultStore(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // Accessing localStorage can throw when site data is blocked.
  }
}

// Stored JSON (any shape) to WorldPrefs, field by field.
export function parseWorldPrefs(raw: unknown): WorldPrefs {
  const out: WorldPrefs = { seen: [] };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  const p = raw as Record<string, unknown>;
  if (typeof p.lastWorld === 'string' && p.lastWorld.length > 0) out.lastWorld = p.lastWorld;
  if (Array.isArray(p.seen)) out.seen = [...new Set(p.seen.filter((s): s is string => typeof s === 'string'))];
  return out;
}

export function loadWorldPrefs(store: KeyValueStore | null = defaultStore()): WorldPrefs {
  try {
    const raw = store?.getItem(WORLD_PREFS_KEY);
    return raw ? parseWorldPrefs(JSON.parse(raw)) : { seen: [] };
  } catch {
    return { seen: [] };
  }
}

export function saveWorldPrefs(p: WorldPrefs, store: KeyValueStore | null = defaultStore()): void {
  try {
    store?.setItem(WORLD_PREFS_KEY, JSON.stringify({ lastWorld: p.lastWorld, seen: p.seen }));
  } catch {
    // Storage blocked or full: the map just opens on the first world next time.
  }
}
