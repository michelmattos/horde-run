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
export const STAR_POP = { firstDelayMs: 60, stepMs: 200, durationMs: 240 } as const;
export function starPopDelays(count: number): number[] {
  return Array.from({ length: count }, (_, i) => STAR_POP.firstDelayMs + i * STAR_POP.stepMs);
}

// Result buttons: the primary action first (where the thumb lands), then the rest.
export type ResultAction = 'next' | 'retry' | 'map';
export function resultActions(win: boolean, hasNext: boolean, hasMap: boolean): { primary: ResultAction; secondary: ResultAction[] } {
  if (win && hasNext) return { primary: 'next', secondary: hasMap ? ['retry', 'map'] : ['retry'] };
  // A won final level goes back to the map; a defeat always offers Retry first.
  if (win && hasMap) return { primary: 'map', secondary: ['retry'] };
  return { primary: 'retry', secondary: hasMap ? ['map'] : [] };
}

// Boss phase pips: index i is lit once the boss has reached phase i (0-based).
export function pipLit(i: number, phase: number): boolean {
  return i <= phase;
}
