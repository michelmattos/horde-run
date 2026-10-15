// Pure layout and formatting for the Expedition screens (no DOM, no Babylon), so it
// runs under Node's test runner. The run map lays rows out bottom (row 0) to top (the
// boss) in CSS px: node centres measured from the top of the board, sized for thumbs,
// kept clear of the screen edges and of each other, and edges as smooth SVG paths.
import type { RunMap, RunNodeKind } from '../../contracts.ts';

export const NODE_SIZE = 60; // badge diameter of a regular node (touch target >= 48)
export const BOSS_SIZE = 96;
export const ROW_STEP = 116; // vertical distance between row centres
export const EDGE_MARGIN = 14; // clear space kept at each side of the board
export const LABEL_W = 72; // name tag under a node; neighbours keep their tags apart
const NODE_GAP = 6; // extra gap between neighbouring tags
const PAD_TOP = 34; // above the boss badge (its crown tag)
const PAD_BOTTOM = 52; // below the row 0 badges (their tags and breathing room)
const BOSS_EXTRA = 26; // the boss row sits a little further up for its bigger badge

export interface MapLayoutNode {
  id: string;
  x: number; // centre, px from the left of the board
  y: number; // centre, px from the top of the board
  size: number; // badge diameter
}

export interface MapLayout {
  nodes: MapLayoutNode[];
  edges: { from: string; to: string; d: string }[];
  height: number;
}

const r1 = (v: number): number => Math.round(v * 10) / 10;

// Spreads one row's centres so neighbours are at least `gap` apart and every centre
// stays within [lo, hi]; keeps the seeded order and roughly the seeded positions.
function spreadRow(xs: number[], gap: number, lo: number, hi: number): number[] {
  const out = xs.map((x) => Math.min(hi, Math.max(lo, x)));
  const n = out.length;
  if (n < 2) return out;
  const needed = gap * (n - 1);
  if (needed >= hi - lo) {
    // Too narrow for the wanted gap: share the width evenly.
    const step = (hi - lo) / (n - 1);
    return out.map((_, i) => lo + i * step);
  }
  for (let i = 1; i < n; i++) out[i] = Math.max(out[i], out[i - 1] + gap);
  if (out[n - 1] > hi) {
    out[n - 1] = hi;
    for (let i = n - 2; i >= 0; i--) out[i] = Math.min(out[i], out[i + 1] - gap);
  }
  return out;
}

export function runMapLayout(map: RunMap, width: number): MapLayout {
  const w = Math.max(0, width);
  const lastRow = Math.max(0, map.rows - 1);
  const rowY = (row: number): number =>
    row >= lastRow ? PAD_TOP + BOSS_SIZE / 2 : PAD_TOP + BOSS_SIZE / 2 + BOSS_EXTRA + (lastRow - row) * ROW_STEP;
  const height = rowY(0) + NODE_SIZE / 2 + PAD_BOTTOM;

  const nodes: MapLayoutNode[] = [];
  for (let row = 0; row <= lastRow; row++) {
    const inRow = map.nodes.filter((n) => n.row === row).sort((a, b) => a.col - b.col);
    if (inRow.length === 0) continue;
    const size = (k: RunNodeKind): number => (k === 'boss' ? BOSS_SIZE : NODE_SIZE);
    const half = Math.max(...inRow.map((n) => size(n.kind))) / 2;
    const lo = EDGE_MARGIN + Math.max(half, LABEL_W / 2);
    const hi = w - lo;
    // Seeded x (0..1, columns at (col + .5) / width) is stretched a little so 2- and
    // 3-wide rows use the whole board, then pushed apart where jitter crowds them.
    const xs = inRow.map((n) => lo + Math.min(1, Math.max(0, (n.x - 0.1) / 0.8)) * Math.max(0, hi - lo));
    const spread = hi > lo ? spreadRow(xs, Math.max(NODE_SIZE, LABEL_W) + NODE_GAP, lo, hi) : xs.map(() => w / 2);
    inRow.forEach((n, i) => nodes.push({ id: n.id, x: r1(spread[i]), y: r1(rowY(row)), size: size(n.kind) }));
  }

  const at = new Map(nodes.map((n) => [n.id, n]));
  const edges: MapLayout['edges'] = [];
  for (const n of map.nodes) {
    const a = at.get(n.id);
    if (!a) continue;
    for (const id of n.next) {
      const b = at.get(id);
      if (!b) continue;
      const my = r1((a.y + b.y) / 2);
      edges.push({ from: n.id, to: id, d: `M${a.x},${a.y} C${a.x},${my} ${b.x},${my} ${b.x},${b.y}` });
    }
  }
  return { nodes, edges, height: r1(height) };
}

// ---------- HP bars ----------

export function hpPercent(hp: number, maxHp: number): number {
  if (!(maxHp > 0)) return 0;
  return Math.round(Math.min(1, Math.max(0, hp / maxHp)) * 1000) / 10;
}

export type HpTone = 'good' | 'warn' | 'low';
export function hpTone(hp: number, maxHp: number): HpTone {
  const p = hpPercent(hp, maxHp);
  return p > 50 ? 'good' : p > 25 ? 'warn' : 'low';
}

export function formatHp(hp: number, maxHp: number): string {
  return `${Math.max(0, Math.round(hp))}/${Math.round(maxHp)}`;
}

// What a heal of `amount` would do: the HP after it (capped) and how much it really adds.
export function healPreview(hp: number, maxHp: number, amount: number): { to: number; gained: number } {
  const to = Math.min(maxHp, hp + Math.max(0, amount));
  return { to, gained: Math.max(0, to - hp) };
}

// ---------- Gold, prices, dates ----------

// 1250 -> '1,250' (fixed grouping, independent of the device locale).
export function formatGold(n: number): string {
  const v = Math.max(0, Math.round(n));
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export type PriceState = 'sold' | 'afford' | 'poor';
export function priceState(price: number, gold: number, sold: boolean): PriceState {
  if (sold) return 'sold';
  return gold >= price ? 'afford' : 'poor';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// '2026-10-14' -> 'Oct 14' (parsed by hand: no Date, so no timezone shift).
export function formatDailyDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}` : iso;
}

// Quick ease-out count-up for a number chip: `target` reached at `durationMs`.
export function countUp(target: number, elapsedMs: number, durationMs: number): number {
  if (!(durationMs > 0) || elapsedMs >= durationMs) return target;
  const t = Math.max(0, elapsedMs) / durationMs;
  return Math.round(target * (1 - (1 - t) * (1 - t)));
}

// ---------- Node kinds ----------

export const NODE_INFO: Record<RunNodeKind, { label: string; hint: string }> = {
  battle: { label: 'Battle', hint: 'Win to pick an upgrade' },
  elite: { label: 'Elite', hint: 'Tougher fight, better reward' },
  shop: { label: 'Shop', hint: 'Spend gold on upgrades' },
  rest: { label: 'Rest', hint: 'Heal your run HP' },
  boss: { label: 'Tin General', hint: 'Boss: beat him to win the run' },
};
