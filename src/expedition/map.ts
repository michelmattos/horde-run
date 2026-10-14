// Expedition run map (concept §4.2): a seeded Slay-the-Spire style ladder of 7 rows.
// Row kinds are fixed per row so every path has exactly 4 fights, 2 stops and the boss;
// the seed only picks row widths, where elites sit, the shop/rest order and the edges.
// Edges link neighbouring columns only and never cross, so the map reads cleanly on a phone.
import type { RunMap, RunNode, RunNodeKind, RunState } from '../contracts.ts';
import { createRng, seedFromString } from '../core/rng.ts';
import type { Rng } from '../core/rng.ts';

export const RUN_ROWS = 7;

const COMBAT_ROWS = [1, 3, 4]; // battle or elite
const STOP_ROWS = [2, 5]; // shop or rest
const BOSS_ROW = RUN_ROWS - 1;
const MAX_JITTER = 0.06;
const MIN_ELITES = 2;

export function nodeId(row: number, col: number): string {
  return `r${row}c${col}`;
}

function rowWidth(row: number, rng: Rng): number {
  if (row === 0) return 3;
  if (row === BOSS_ROW) return 1;
  return 2 + rng.int(2);
}

function rowKinds(row: number, width: number, rng: Rng): RunNodeKind[] {
  if (row === BOSS_ROW) return ['boss'];
  if (STOP_ROWS.includes(row)) {
    // Both kinds present: one of each, the third (if any) random, then shuffled.
    const kinds: RunNodeKind[] = ['shop', 'rest'];
    if (width === 3) kinds.push(rng.next() < 0.5 ? 'shop' : 'rest');
    for (let i = kinds.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
    }
    return kinds;
  }
  return Array.from({ length: width }, (): RunNodeKind => 'battle');
}

// Column indices of row `to` sorted by distance from x (ties: lower column first).
function nearestCols(x: number, to: readonly RunNode[]): number[] {
  return to
    .map((n, i) => ({ i, d: Math.abs(n.x - x) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((e) => e.i);
}

// Links row `from` to row `to`: each node takes its nearest column or its two nearest.
// Every combination is enumerated (at most 2^3) and the valid ones (no crossing, every
// target reached) are drawn from uniformly. Taking only the nearest is always crossing-free,
// so a valid set exists whenever the widths come from rowWidth.
function linkRows(from: readonly RunNode[], to: readonly RunNode[], rng: Rng): number[][] {
  const options = from.map((n) => {
    const near = nearestCols(n.x, to);
    const one = [near[0]];
    return near.length > 1 ? [one, [near[0], near[1]].sort((a, b) => a - b)] : [one];
  });
  const valid: number[][][] = [];
  const pick = (i: number, acc: number[][]): void => {
    if (i === options.length) {
      if (isValidLink(acc, to.length)) valid.push(acc.map((t) => [...t]));
      return;
    }
    for (const opt of options[i]) pick(i + 1, [...acc, opt]);
  };
  pick(0, []);
  if (valid.length === 0) throw new Error('generateRunMap: no valid edge set'); // unreachable for widths 1..3
  return valid[rng.int(valid.length)];
}

function isValidLink(targets: readonly number[][], toCount: number): boolean {
  const reached = new Set<number>();
  for (let i = 0; i < targets.length; i++) {
    for (const t of targets[i]) reached.add(t);
    // No crossing: every target of node i is <= every target of node i+1.
    if (i > 0 && Math.max(...targets[i - 1]) > Math.min(...targets[i])) return false;
  }
  return reached.size === toCount;
}

export function generateRunMap(seed: number): RunMap {
  const rng = createRng(seedFromString(`map:${seed}`));
  const rows: RunNode[][] = [];
  for (let row = 0; row < RUN_ROWS; row++) {
    const width = rowWidth(row, rng);
    const kinds = rowKinds(row, width, rng);
    rows.push(
      kinds.map((kind, col) => {
        const jitter = width === 1 ? 0 : (rng.next() * 2 - 1) * MAX_JITTER;
        return { id: nodeId(row, col), row, col, x: (col + 0.5) / width + jitter, kind, next: [] };
      }),
    );
  }

  // Elites: about 60% of combat rows get one, then top up to MIN_ELITES on rows without one.
  const eliteRows = COMBAT_ROWS.filter(() => rng.next() < 0.6);
  for (const row of COMBAT_ROWS) {
    if (eliteRows.length >= MIN_ELITES) break;
    if (!eliteRows.includes(row)) eliteRows.push(row);
  }
  for (const row of eliteRows) rows[row][rng.int(rows[row].length)].kind = 'elite';

  for (let row = 0; row < BOSS_ROW; row++) {
    const links = linkRows(rows[row], rows[row + 1], rng);
    rows[row].forEach((n, i) => {
      n.next = links[i].map((c) => rows[row + 1][c].id);
    });
  }
  return { seed, rows: RUN_ROWS, nodes: rows.flat() };
}

export function getNode(map: RunMap, id: string): RunNode | undefined {
  return map.nodes.find((n) => n.id === id);
}

export function isCombatKind(kind: RunNodeKind): kind is 'battle' | 'elite' | 'boss' {
  return kind === 'battle' || kind === 'elite' || kind === 'boss';
}

// Ids the player may enter now: the first row before any choice, else the current node's
// links while on the map; nothing during a battle, pick, shop, rest or after the run.
export function availableNodes(run: RunState): string[] {
  if (run.phase !== 'map' || run.outcome !== 'active') return [];
  if (run.at === undefined) return run.map.nodes.filter((n) => n.row === 0).map((n) => n.id);
  return [...(getNode(run.map, run.at)?.next ?? [])];
}
