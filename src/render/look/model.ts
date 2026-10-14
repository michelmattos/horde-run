// The model module contract (src/render/models/README.md). Every src/render/models/<key>.ts
// exports `info` and `preview` (for the preview harness, src/preview.ts) plus its own
// typed game API (createX / buildX) that integration wires into the renderer.
import type { Scene } from '@babylonjs/core/scene';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Look } from './index.ts';
import type { TeamName } from './palette.ts';

export interface ModelInfo {
  key: string; // same as the file name
  title: string;
  instanced: boolean; // true when the game draws it with thin instances
  teams: boolean; // true when it comes in player (green) and enemy (tan) versions
  // Which way it is turned in the game. Every model is authored facing +Z (its front).
  //   'player'  - player-side piece (cannon, player fort): yaw 0, front faces up the lane;
  //               the camera sees its back and top
  //   'enemy'   - enemy-side piece (enemy fort, tower, wall, Tin General): yaw PI, front
  //               faces down the lane toward the camera
  //   'team'    - either army (soldier, champion): yaw by team as above
  //   'neutral' - gates and props: yaw PI, so the front (sign, label) faces the camera
  side: 'player' | 'enemy' | 'team' | 'neutral';
  height: number; // approximate height in lane units, for framing the preview camera
  variants?: readonly string[]; // optional named variants (?variant=...), first is the default
  triangleBudget: number; // per instance / per model, from the task brief
  gameZ?: number; // lane z where it usually stands, for the preview's 'game' view (default 20)
}

export interface PreviewOptions {
  team: TeamName;
  variant: string | null;
}

// What preview() returns: a root to frame and orbit, optional animation, and cleanup.
export interface PreviewResult {
  root: TransformNode; // every mesh of the preview hangs under it (instanced meshes too)
  update?(time: number, dt: number): void; // idle animation (hop, recoil, key turning ...)
  dispose(): void;
}

export interface ModelModule {
  info: ModelInfo;
  preview(scene: Scene, look: Look, opts: PreviewOptions): Promise<PreviewResult> | PreviewResult;
}
