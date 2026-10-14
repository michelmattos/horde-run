// Campaign progress persisted as one JSON object in localStorage, with a
// human-portable export/import format. Pure: storage is injected so Node tests
// can use an in-memory store. Settings live under their own key (settings.ts).
import type { LevelProgress, SaveData, WorldDef } from '../contracts.ts';

export interface KeyValueStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export const SAVE_KEY = 'horde-run:save';
const GAME_TAG = 'horde-run';
// Times above this are treated as garbage (a level never lasts a day).
const MAX_TIME = 24 * 3600;

export function emptySave(): SaveData {
  return { version: 1, levels: {} };
}

function defaultStore(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // Accessing localStorage can throw when site data is blocked.
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validTime(t: unknown): t is number {
  return typeof t === 'number' && Number.isFinite(t) && t > 0 && t <= MAX_TIME;
}

// Parses one level entry; returns null when the shape is wrong. Unknown keys are dropped.
function parseLevel(v: unknown): LevelProgress | null {
  if (!isRecord(v)) return null;
  const s = v.stars;
  if (!Array.isArray(s) || s.length !== 3 || !s.every((b) => typeof b === 'boolean')) return null;
  const out: LevelProgress = { stars: [s[0], s[1], s[2]] };
  if (validTime(v.bestTime)) out.bestTime = v.bestTime;
  return out;
}

// Shared by load and import: returns the parsed levels or an error message.
function parseLevels(v: unknown): Record<string, LevelProgress> | string {
  if (!isRecord(v)) return 'The save has no level list.';
  const levels: Record<string, LevelProgress> = {};
  for (const [id, entry] of Object.entries(v)) {
    const p = parseLevel(entry);
    if (!p) return `Level "${id}" has an invalid entry.`;
    levels[id] = p;
  }
  return levels;
}

export function loadSave(store: KeyValueStore | null = defaultStore()): SaveData {
  try {
    const raw = store?.getItem(SAVE_KEY);
    if (!raw) return emptySave();
    const p: unknown = JSON.parse(raw);
    if (!isRecord(p) || p.version !== 1) return emptySave();
    const levels = parseLevels(p.levels);
    return typeof levels === 'string' ? emptySave() : { version: 1, levels };
  } catch {
    return emptySave();
  }
}

export function writeSave(save: SaveData, store: KeyValueStore | null = defaultStore()): void {
  try {
    store?.setItem(SAVE_KEY, JSON.stringify({ version: 1, levels: save.levels }));
  } catch {
    // Storage blocked or full: progress just won't persist this session.
  }
}

// Merges one battle result. Stars only ever turn on; best time counts victories only.
export function recordResult(
  save: SaveData,
  levelId: string,
  r: { victory: boolean; stars: [boolean, boolean, boolean]; time: number },
): { save: SaveData; newStars: number; newBest: boolean } {
  const prev = save.levels[levelId];
  const old: [boolean, boolean, boolean] = prev ? prev.stars : [false, false, false];
  const won = r.victory ? r.stars : ([false, false, false] as const);
  const stars: [boolean, boolean, boolean] = [old[0] || won[0], old[1] || won[1], old[2] || won[2]];
  const newStars = stars.filter(Boolean).length - old.filter(Boolean).length;

  let bestTime = prev?.bestTime;
  let newBest = false;
  if (r.victory && validTime(r.time) && (bestTime === undefined || r.time < bestTime)) {
    bestTime = r.time;
    newBest = true;
  }
  const entry: LevelProgress = { stars };
  if (bestTime !== undefined) entry.bestTime = bestTime;
  return { save: { version: 1, levels: { ...save.levels, [levelId]: entry } }, newStars, newBest };
}

export function isUnlocked(save: SaveData, world: WorldDef, levelId: string): boolean {
  const i = world.levels.indexOf(levelId);
  if (i < 0) return false;
  if (i === 0) return true;
  return save.levels[world.levels[i - 1]]?.stars[0] === true;
}

export function starCount(save: SaveData, levelIds?: readonly string[]): number {
  const ids = levelIds ?? Object.keys(save.levels);
  let n = 0;
  for (const id of ids) {
    const p = save.levels[id];
    if (p) n += p.stars.filter(Boolean).length;
  }
  return n;
}

export function exportSave(save: SaveData): string {
  return JSON.stringify(
    { game: GAME_TAG, version: 1, exportedAt: new Date().toISOString(), levels: save.levels },
    null,
    2,
  );
}

// Throws an Error with a message fit to show the player when the text is not a valid save.
export function importSave(text: string): SaveData {
  let p: unknown;
  try {
    p = JSON.parse(text);
  } catch {
    throw new Error('That is not valid JSON. Paste the whole exported save.');
  }
  if (!isRecord(p)) throw new Error('That is not a Horde Run save.');
  if (p.game !== GAME_TAG) throw new Error('That is not a Horde Run save.');
  if (p.version !== 1) throw new Error(`Unsupported save version: ${String(p.version)}.`);
  const levels = parseLevels(p.levels);
  if (typeof levels === 'string') throw new Error(levels);
  return { version: 1, levels };
}
