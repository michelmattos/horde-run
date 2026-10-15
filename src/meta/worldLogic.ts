// Pure rules of the multi-world map (no DOM): which worlds are open, what a locked
// world's padlock card says, what a tap on a level node does, which world the map opens
// on and when a world's title card shows. worldMap.ts only draws what these decide, so
// the rules run under Node's test runner.
import type { SaveData, WorldDef } from '../contracts.ts';
import { isUnlocked, isWorldUnlocked, starCount, starsNeeded } from '../core/save.ts';

export interface MapLevel {
  id: string;
  name: string;
  boss: boolean;
}

// One world page of the map: the world and its level nodes (same order as world.levels).
export interface MapWorld {
  world: WorldDef;
  levels: readonly MapLevel[];
}

export interface WorldTab {
  id: string;
  label: string; // 'World 2'
  name: string; // 'Freezer'
  locked: boolean;
  stars: number; // stars held in this world
  maxStars: number;
  fresh: boolean; // open, but its title card has not been seen yet
}

// 'w2' -> 'World 2' (the id's trailing number; the id itself when it has none).
export function worldLabel(world: Pick<WorldDef, 'id'>): string {
  const m = /(\d+)$/.exec(world.id);
  return `World ${m ? Number(m[1]) : world.id}`;
}

export function worldTabs(save: SaveData, worlds: readonly WorldDef[], seen: readonly string[]): WorldTab[] {
  return worlds.map((w) => {
    const locked = !isWorldUnlocked(save, w, worlds);
    return {
      id: w.id,
      label: worldLabel(w),
      name: w.name,
      locked,
      stars: starCount(save, w.levels),
      maxStars: w.levels.length * 3,
      fresh: !locked && !seen.includes(w.id),
    };
  });
}

// The padlock line of a locked world: 'Earn 4 more stars in Bedroom Floor', or 'Open
// Freezer first' when the stars are in but the world they come from is still locked (an
// imported save). Empty when open.
export function lockedWorldText(save: SaveData, world: WorldDef, worlds: readonly WorldDef[]): string {
  if (!world.unlock || isWorldUnlocked(save, world, worlds)) return '';
  const from = worlds.find((w) => w.id === world.unlock?.world);
  const fromName = from?.name ?? worldLabel({ id: world.unlock.world });
  const n = starsNeeded(save, world, worlds);
  return n > 0 ? `Earn ${n} more star${n === 1 ? '' : 's'} in ${fromName}` : `Open ${fromName} first`;
}

export type LevelTap = { play: true } | { play: false; nudge: string };

// A tap on a level node: play it only when its world is open and the previous level of
// the world is won; otherwise say why not.
export function levelTap(save: SaveData, world: WorldDef, worlds: readonly WorldDef[], levelId: string): LevelTap {
  const lockedText = lockedWorldText(save, world, worlds);
  if (lockedText) return { play: false, nudge: lockedText };
  if (isUnlocked(save, world, levelId)) return { play: true };
  const i = world.levels.indexOf(levelId);
  return { play: false, nudge: i > 0 ? `Win ${world.levels[i - 1]} first` : 'Locked' };
}

// Index of the world the map opens on: the one viewed last when it still exists, else the first.
export function initialWorldIndex(worlds: readonly Pick<WorldDef, 'id'>[], lastWorld: string | undefined): number {
  const i = lastWorld === undefined ? -1 : worlds.findIndex((w) => w.id === lastWorld);
  return Math.max(0, i);
}

// Whether viewing a world shows its title card: the session's first look at the map does
// (as World 1 always has), and so does the first look ever at a world once it is open.
// A locked world never does.
export function showsTitleCard(
  tab: Pick<WorldTab, 'id' | 'locked'>,
  firstLook: boolean,
  seen: readonly string[],
): boolean {
  return !tab.locked && (firstLook || !seen.includes(tab.id));
}
