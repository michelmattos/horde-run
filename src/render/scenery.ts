// Bedroom Floor scenery: alphabet blocks, books, crayons, marbles, a toy car, socks and
// building bricks (models/props.ts) scattered on the oak floorboards on both sides of the
// rug, all static. The prop kit is built once per scene (14 thin-instanced meshes, so the
// whole room is at most 14 draw calls whatever the layout); each level rewrites its
// instance buffers once with its own stable, seeded layout. Props never enter the lane,
// and wider screens simply see more floor while the framing keeps the same lane.
import type { LevelDef } from '../contracts.ts';
import { LAYOUT } from '../contracts.ts';
import type { PropKit } from './models/props.ts';
import { addSceneryProp } from './models/props.ts';
import type { FreezerPropKit } from './models/freezerProps.ts';
import { scatterFreezerScenery, scatterScenery } from './fxLogic.ts';
import type { Rect } from './fxLogic.ts';

const PROPS_PER_UNIT_LENGTH = 0.7; // density along the lane (both sides together)
const MAX_PROPS = 70;
// How far beyond the lane edge props may sit: a portrait phone sees only a few units of
// floor beside the rug, so props far out would cost triangles nobody sees.
const REACH = 9;

function levelSeed(level: LevelDef): number {
  // Seed from the level id so each level has its own, stable, layout.
  let seed = 17;
  for (let i = 0; i < level.id.length; i++) seed = (seed * 31 + level.id.charCodeAt(i)) >>> 0;
  return seed;
}

function zRange(level: LevelDef): { zMin: number; zMax: number; count: number } {
  const zMin = LAYOUT.playerBaseZ - LAYOUT.playerBaseDepth - 6;
  const zMax = level.lane.length + LAYOUT.enemyBaseDepth + 4;
  const count = Math.min(MAX_PROPS, Math.round((zMax - zMin) * PROPS_PER_UNIT_LENGTH));
  return { zMin, zMax, count };
}

export function layoutScenery(kit: PropKit, level: LevelDef): void {
  const { zMin, zMax, count } = zRange(level);
  const seed = levelSeed(level);
  kit.begin();
  for (const p of scatterScenery(seed, level.lane.width, zMin, zMax, count, REACH)) addSceneryProp(kit, p);
  kit.commit();
}

// World 2 (the Freezer): ice cubes, pea bags, popsicles, fish-finger boxes, ice-cream
// tubs and big snowflake confetti (models/freezerProps.ts) on the frosted floor, with the
// same rules: outside the lane plus clearance, never on an ice wall that pokes past the
// lane edge. Light props (flakes, pea bags) sway in gusts via kit.setGust.
const FREEZER_MAX = 64;

export function layoutFreezerScenery(kit: FreezerPropKit, level: LevelDef): void {
  const { zMin, zMax, count } = zRange(level);
  const keepOut: Rect[] = (level.iceWalls ?? []).map((w) => ({ x: w.x, z: w.z, width: w.width, depth: w.depth }));
  kit.begin();
  for (const p of scatterFreezerScenery(
    levelSeed(level) ^ 0x5f3759df,
    level.lane.width,
    zMin,
    zMax,
    Math.min(FREEZER_MAX, count),
    REACH,
    keepOut,
  ))
    kit.add(p.kind, p.variant, p.x, p.z, p.yaw, p.scale, p.color);
  kit.commit();
}
