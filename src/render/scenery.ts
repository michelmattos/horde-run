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
import { scatterScenery } from './fxLogic.ts';

const PROPS_PER_UNIT_LENGTH = 0.7; // density along the lane (both sides together)
const MAX_PROPS = 70;
// How far beyond the lane edge props may sit: a portrait phone sees only a few units of
// floor beside the rug, so props far out would cost triangles nobody sees.
const REACH = 9;

export function layoutScenery(kit: PropKit, level: LevelDef): void {
  const zMin = LAYOUT.playerBaseZ - LAYOUT.playerBaseDepth - 6;
  const zMax = level.lane.length + LAYOUT.enemyBaseDepth + 4;
  const count = Math.min(MAX_PROPS, Math.round((zMax - zMin) * PROPS_PER_UNIT_LENGTH));
  // Seed from the level id so each level has its own, stable, layout.
  let seed = 17;
  for (let i = 0; i < level.id.length; i++) seed = (seed * 31 + level.id.charCodeAt(i)) >>> 0;
  kit.begin();
  for (const p of scatterScenery(seed, level.lane.width, zMin, zMax, count, REACH)) addSceneryProp(kit, p);
  kit.commit();
}
