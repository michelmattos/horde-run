// Babylon-free and DOM-free UI helpers (formatting, pop curves, button choice),
// kept separate so they run under Node's test runner. Every effect here is a
// colour, alpha or scale change on a widget; nothing moves the camera or screen.

export type GoalState = 'pending' | 'met' | 'failed';

export function formatTime(s: number): string {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

// Scale of a quick "pop": rises from 1 to `peak` and back over `durMs`, 1 outside it.
export function popScale(elapsedMs: number, durMs: number, peak: number): number {
  if (!(elapsedMs >= 0) || elapsedMs >= durMs || durMs <= 0) return 1;
  return 1 + (peak - 1) * Math.sin(Math.PI * (elapsedMs / durMs));
}

// Linear blend between two '#rrggbb' colours, t clamped to [0, 1].
export function mixHex(a: string, b: string, t: number): string {
  const k = Math.min(1, Math.max(0, t));
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  let out = 0;
  for (const shift of [16, 8, 0]) {
    const ca = (pa >> shift) & 255;
    const cb = (pb >> shift) & 255;
    out |= Math.round(ca + (cb - ca) * k) << shift;
  }
  return '#' + out.toString(16).padStart(6, '0');
}

// HUD star look: gold while still achievable or met, grey and dimmed once failed.
export const STAR_GOLD = '#ffd34d';
export const STAR_GREY = '#8a9099';
export function hudStarStyle(s: GoalState): { color: string; alpha: number } {
  return s === 'failed' ? { color: STAR_GREY, alpha: 0.45 } : { color: STAR_GOLD, alpha: 1 };
}

// Result screen star fill-in: each star pops in turn, the last one done well under 0.8 s.
// Each pop is a quick springy scale-in (<= 150 ms, overshoot <= 10%, art direction section 7).
export const STAR_POP = { firstDelayMs: 140, stepMs: 170, durationMs: 150 } as const;
export function starPopDelays(count: number): number[] {
  return Array.from({ length: count }, (_, i) => STAR_POP.firstDelayMs + i * STAR_POP.stepMs);
}

// Result buttons: the primary action first (where the thumb lands), then the rest.
export type ResultAction = 'next' | 'retry' | 'map';
export function resultActions(
  win: boolean,
  hasNext: boolean,
  hasMap: boolean,
): { primary: ResultAction; secondary: ResultAction[] } {
  if (win && hasNext) return { primary: 'next', secondary: hasMap ? ['retry', 'map'] : ['retry'] };
  // A won final level goes back to the map; a defeat always offers Retry first.
  if (win && hasMap) return { primary: 'map', secondary: ['retry'] };
  return { primary: 'retry', secondary: hasMap ? ['map'] : [] };
}

// Boss phase pips: index i is lit once the boss has reached phase i (0-based).
export function pipLit(i: number, phase: number): boolean {
  return i <= phase;
}

// ---------- Sticker HUD metrics (CSS px) ----------
// One source of truth for the DOM HUD's CSS and hudReserve(), so the camera framing
// keeps exactly the covered strips clear. Layout: the pause button alone in the top-left
// corner; the enemy base HP is a vertical bar on the left under it (top half of the
// screen); the player base HP is a vertical bar on the right above the CHAMP button
// (bottom half), lifted off the bottom edge so the bottom strip stays free for the
// dragging thumb.
export const HUD_METRICS = {
  edge: 12, // side margin inside the safe area
  topPad: 8, // gap under the top safe-area inset
  pause: 54, // round wooden pause button
  sideGap: 12, // gap between the pause button (or run strip) and the enemy column
  vbarW: 30, // vertical HP bar width (wood frame)
  vbarMin: 72, // shortest a vertical bar gets on a small screen
  vbarMax: 210, // longest a vertical bar gets on a tall screen
  barBadge: 40, // round badge capping the top end of each vertical bar
  liftBottom: 112, // free band above the bottom safe-area inset, kept for dragging
  thumbRow: 110, // band the camera keeps under the cannon row for the dragging thumb
  bottomPad: 10, // gap above the bottom safe-area inset
  champFace: 80, // the CHAMP button itself (>= 76)
  champRing: 98, // outer diameter of the charge ring
  champTagOver: 12, // the CHAMP tag hangs this far below the ring
  clear: 14, // gap kept between the HUD and the battlefield framing
  cannonRow: 12, // extra room so the cannon row sits above the thumb band
  runGap: 6, // gap between the top row and the Expedition run strip
  runH: 32, // Expedition run strip: run HP, gold, node tag, upgrade icons
  runIcon: 30, // one upgrade icon slot in the run strip
  runIconGap: 4,
} as const;

// Height of the top HUD block (the pause row); `run` adds the Expedition run strip under it.
export function hudTopHeight(run = false): number {
  const m = HUD_METRICS;
  return run ? m.pause + m.runGap + m.runH : m.pause;
}

// CSS px covered at the top and bottom (safe-area insets included) plus the clear gap.
// The side columns only cover scenery beside the lane, so they are not reserved. The
// bottom keeps the thumb band clear so the cannon row sits above the dragging finger.
// `topBar`: bottom of the top row, which tall models at the far end (the enemy flag, the
// boss's plume) must stay under. With the run strip (`run`) that is the strip's bottom.
export function hudReserveFor(
  ins: { top: number; bottom: number },
  run = false,
): { top: number; bottom: number; topBar: number } {
  const m = HUD_METRICS;
  return {
    topBar: Math.round(ins.top + m.topPad + hudTopHeight(run)),
    top: Math.round(ins.top + m.topPad + hudTopHeight(run) + m.clear),
    bottom: Math.round(ins.bottom + m.bottomPad + m.thumbRow + m.clear + m.cannonRow),
  };
}

// stroke-dashoffset of a ring of `circumference` that is `charge` (0..1) full.
export function ringDashOffset(charge: number, circumference: number): number {
  const c = Number.isFinite(charge) ? Math.min(1, Math.max(0, charge)) : 0;
  return circumference * (1 - c);
}

// Fraction for an HP bar, clamped to [0, 1]; 0 when the max is unknown.
export function hpFraction(hp: number, max: number): number {
  if (!(max > 0) || !Number.isFinite(hp)) return 0;
  return Math.min(1, Math.max(0, hp / max));
}

// Counts (run gold): exact up to 9,999, then '12.3k' so the chip never overflows.
export function formatCount(n: number): string {
  const v = Math.max(0, Math.round(Number.isFinite(n) ? n : 0));
  if (v < 10000) return String(v);
  const k = v / 1000;
  return `${k >= 100 ? Math.round(k) : (Math.floor(k * 10) / 10).toFixed(1)}k`;
}

// ---------- Expedition run strip ----------
// Run HP, gold, the node tag and the upgrade icons under the top bar. Static during a
// battle: these helpers run once per setRun / resize, never per frame.

export type RunNodeTag = 'battle' | 'elite' | 'boss';
export const RUN_MAX_ICONS = 6;

// How many icon slots fit in `width` CSS px (at least 1).
export function runIconSlots(width: number): number {
  const m = HUD_METRICS;
  if (!(width > 0)) return 1;
  return Math.max(1, Math.floor((width + m.runIconGap) / (m.runIcon + m.runIconGap)));
}

// Icons to draw and the '+k' overflow: at most RUN_MAX_ICONS icons, and when not all fit,
// one slot goes to the '+k' chip.
export function splitRunIcons<T>(items: readonly T[], slots: number = RUN_MAX_ICONS + 1): { shown: T[]; more: number } {
  const free = Math.max(1, Math.floor(Number.isFinite(slots) ? slots : 1));
  if (items.length <= Math.min(RUN_MAX_ICONS, free)) return { shown: items.slice(), more: 0 };
  const n = Math.max(0, Math.min(RUN_MAX_ICONS, free - 1));
  return { shown: items.slice(0, n), more: items.length - n };
}

// Stack badge: 'x2', 'x3'..., nothing for a single stack.
export function formatStacks(stacks: number): string {
  const n = Math.floor(Number.isFinite(stacks) ? stacks : 0);
  return n > 1 ? `x${n}` : '';
}

// Run HP number: whole points, never below 0 (a sliver of HP still reads as 1).
export function formatRunHp(hp: number): string {
  return String(Number.isFinite(hp) ? Math.max(0, Math.ceil(hp)) : 0);
}

export function runTagText(kind: RunNodeTag): string {
  return kind === 'elite' ? 'ELITE' : kind === 'boss' ? 'BOSS' : '';
}

// Read-only label list for the icon row: 'Burst Fire x2, Tough Mobs'.
export function runUpgradesLabel(upgrades: readonly { label: string; stacks: number }[]): string {
  if (upgrades.length === 0) return 'No upgrades yet';
  return upgrades.map((u) => (formatStacks(u.stacks) ? `${u.label} ${formatStacks(u.stacks)}` : u.label)).join(', ');
}

// Screen-reader summary of the left chips.
export function runStatusLabel(hp: number, maxHp: number, gold: number, kind: RunNodeTag): string {
  const tag = runTagText(kind);
  return `Run health ${formatRunHp(hp)} of ${formatRunHp(maxHp)}, ${formatCount(gold)} gold${tag ? `, ${tag.toLowerCase()} battle` : ''}`;
}
