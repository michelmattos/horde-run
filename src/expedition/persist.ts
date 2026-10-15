// Expedition persistence under its own localStorage key, so the campaign SaveData is
// never touched. Loading is defensive: a damaged run is dropped (the player starts a new
// one) while the best scores survive; nothing here throws.
import type { RunMap, RunNodeKind, RunPhase, RunState, ShopItem } from '../contracts.ts';
import type { KeyValueStore } from '../core/save.ts';
import { RUN_ROWS } from './map.ts';
import { getUpgrade } from './upgrades.ts';
import { runScore } from './run.ts';

export const EXPEDITION_KEY = 'horde-run:expedition';

export interface ExpeditionSave {
  version: 1;
  run?: RunState;
  best: { daily: Record<string, number>; bestScore: number; runsPlayed: number; runsWon: number };
}

export function emptyExpedition(): ExpeditionSave {
  return { version: 1, best: { daily: {}, bestScore: 0, runsPlayed: 0, runsWon: 0 } };
}

function defaultStore(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // Accessing localStorage can throw when site data is blocked.
  }
}

type Obj = Record<string, unknown>;
const NODE_KINDS: readonly RunNodeKind[] = ['battle', 'elite', 'rest', 'shop', 'boss'];
const PHASES: readonly RunPhase[] = ['map', 'battle', 'pick', 'shop', 'rest', 'over'];

function isRecord(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function isCount(v: unknown): v is number {
  return isNum(v) && Number.isInteger(v) && v >= 0;
}
function isStrArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'string');
}

// Basic map checks: 7 rows, well-formed nodes with unique ids, links into the next row.
function parseMap(v: unknown): RunMap | null {
  if (!isRecord(v) || !isNum(v.seed) || v.rows !== RUN_ROWS || !Array.isArray(v.nodes)) return null;
  const nodes = v.nodes as unknown[];
  const byId = new Map<string, { row: number }>();
  for (const n of nodes) {
    if (!isRecord(n) || typeof n.id !== 'string' || !isCount(n.row) || !isCount(n.col) || !isNum(n.x)) return null;
    if (n.row >= RUN_ROWS || !NODE_KINDS.includes(n.kind as RunNodeKind) || !isStrArray(n.next)) return null;
    if (byId.has(n.id)) return null;
    byId.set(n.id, { row: n.row });
  }
  for (const n of nodes as RunMap['nodes']) {
    if (n.row < RUN_ROWS - 1 && n.next.length === 0) return null;
    if (!n.next.every((id) => byId.get(id)?.row === n.row + 1)) return null;
  }
  for (let r = 0; r < RUN_ROWS; r++) if (!nodes.some((n) => (n as { row: number }).row === r)) return null;
  return v as unknown as RunMap;
}

function parseShop(v: unknown): RunState['shop'] | null {
  if (!isRecord(v) || !Array.isArray(v.items) || !isCount(v.healPrice) || !isCount(v.healAmount)) return null;
  if (typeof v.healed !== 'boolean') return null;
  const items = v.items as unknown[];
  const ok = items.every(
    (it) =>
      isRecord(it) &&
      typeof it.upgradeId === 'string' &&
      getUpgrade(it.upgradeId) !== undefined &&
      isCount(it.price) &&
      typeof it.sold === 'boolean',
  );
  return ok ? (v as unknown as RunState['shop']) : null;
}

// Validates a stored run; returns null when anything is off.
function parseRun(v: unknown): RunState | null {
  if (!isRecord(v) || v.version !== 1 || !isNum(v.seed)) return null;
  const map = parseMap(v.map);
  if (!map) return null;
  const ids = new Set(map.nodes.map((n) => n.id));
  if (!isStrArray(v.visited) || !v.visited.every((id) => ids.has(id))) return null;
  if (v.at !== undefined && (typeof v.at !== 'string' || !ids.has(v.at))) return null;
  if (!isCount(v.hp) || !isCount(v.maxHp) || v.maxHp === 0 || v.hp > v.maxHp || !isCount(v.gold)) return null;
  if (!PHASES.includes(v.phase as RunPhase)) return null;
  if (v.outcome !== 'active' && v.outcome !== 'won' && v.outcome !== 'lost') return null;
  if ((v.outcome === 'active') !== (v.phase !== 'over')) return null;
  if (v.daily !== undefined && typeof v.daily !== 'string') return null;
  if (!isRecord(v.upgrades)) return null;
  const upgrades: Record<string, number> = {};
  for (const [id, n] of Object.entries(v.upgrades)) {
    if (!isCount(n)) return null;
    if (getUpgrade(id) && n > 0) upgrades[id] = n; // ids from a newer pool are dropped
  }
  const s = v.stats;
  if (!isRecord(s) || !['battlesWon', 'battlesLost', 'goldEarned', 'hpLost'].every((k) => isCount(s[k]))) return null;
  if (!isNum(s.seconds) || s.seconds < 0) return null;

  const run: RunState = {
    version: 1,
    seed: v.seed,
    map,
    visited: [...v.visited],
    hp: v.hp,
    maxHp: v.maxHp,
    gold: v.gold,
    upgrades,
    phase: v.phase as RunPhase,
    stats: {
      battlesWon: s.battlesWon as number,
      battlesLost: s.battlesLost as number,
      goldEarned: s.goldEarned as number,
      hpLost: s.hpLost as number,
      seconds: s.seconds,
    },
    outcome: v.outcome,
  };
  if (typeof v.daily === 'string') run.daily = v.daily;
  if (typeof v.at === 'string') run.at = v.at;

  // Phase-specific data must be present and sane.
  if ((run.phase === 'battle' || run.phase === 'shop' || run.phase === 'rest') && run.at === undefined) return null;
  if (run.phase === 'pick') {
    if (!isStrArray(v.offer) || v.offer.length === 0 || !v.offer.every((id) => getUpgrade(id))) return null;
    run.offer = [...v.offer];
  }
  if (run.phase === 'shop') {
    const shop = parseShop(v.shop);
    if (!shop) return null;
    run.shop = { ...shop, items: shop.items.map((it: ShopItem) => ({ ...it })) };
  }
  const lb = v.lastBattle;
  if (isRecord(lb) && typeof lb.victory === 'boolean' && isCount(lb.hpLost) && isCount(lb.gold))
    run.lastBattle = { victory: lb.victory, hpLost: lb.hpLost, gold: lb.gold };
  return run;
}

function parseBest(v: unknown): ExpeditionSave['best'] {
  const best = emptyExpedition().best;
  if (!isRecord(v)) return best;
  if (isRecord(v.daily))
    for (const [date, score] of Object.entries(v.daily)) if (isCount(score)) best.daily[date] = score;
  if (isCount(v.bestScore)) best.bestScore = v.bestScore;
  if (isCount(v.runsPlayed)) best.runsPlayed = v.runsPlayed;
  if (isCount(v.runsWon)) best.runsWon = v.runsWon;
  return best;
}

export function loadExpedition(store: KeyValueStore | null = defaultStore()): ExpeditionSave {
  try {
    const raw = store?.getItem(EXPEDITION_KEY);
    if (!raw) return emptyExpedition();
    const p: unknown = JSON.parse(raw);
    if (!isRecord(p) || p.version !== 1) return emptyExpedition();
    const out: ExpeditionSave = { version: 1, best: parseBest(p.best) };
    const run = parseRun(p.run);
    if (run) out.run = run;
    return out;
  } catch {
    return emptyExpedition();
  }
}

export function saveExpedition(s: ExpeditionSave, store: KeyValueStore | null = defaultStore()): void {
  try {
    store?.setItem(EXPEDITION_KEY, JSON.stringify(s));
  } catch {
    // Storage blocked or full: the run just won't survive a reload.
  }
}

// Books a finished (or abandoned) run into the bests and clears the saved run.
export function recordRunEnd(s: ExpeditionSave, run: RunState): ExpeditionSave {
  const score = runScore(run);
  const best = {
    daily: { ...s.best.daily },
    bestScore: Math.max(s.best.bestScore, score),
    runsPlayed: s.best.runsPlayed + 1,
    runsWon: s.best.runsWon + (run.outcome === 'won' ? 1 : 0),
  };
  if (run.daily !== undefined) best.daily[run.daily] = Math.max(best.daily[run.daily] ?? 0, score);
  return { version: 1, best };
}
