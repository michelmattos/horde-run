// Preview module for the pooled effects (src/render/effects.ts). It is not a model of its
// own: integration keeps using `new Effects(scene, look)` from index.ts. The preview fires
// every effect type on a loop around the origin so the stills catch them mid-flight:
//
//   left    foam darts lobbing from a tower-top height onto targets on the rug
//   centre  a gate burst every 1.5 s, alternating good (confetti + green ring) and trap
//           (torn red paper + red puff + red ring); a one-use gate breaking now and then
//   right   a defender destroyed (tan shards + mini-blocks), alternating wall / tower
//   front   clash dust puffs and base-hit plastic chips (green and tan)
//   back    the boss phase: brass rings and sparks
//
//   node scripts/preview.mjs effects 5212
import type { Scene } from '@babylonjs/core/scene';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import type { Look } from '../look/index.ts';
import type { ModelInfo, PreviewOptions, PreviewResult } from '../look/model.ts';
import { Effects } from '../effects.ts';

export const info: ModelInfo = {
  key: 'effects',
  title: 'Effects: darts, confetti, shards, dust, sparks',
  instanced: true,
  teams: false,
  side: 'neutral',
  height: 3,
  triangleBudget: 600,
  gameZ: 20,
};

interface Timer {
  every: number;
  t: number;
  n: number;
}

export function preview(scene: Scene, look: Look, _opts: PreviewOptions): PreviewResult {
  const root = new TransformNode('effectsPreviewRoot', scene);
  const fx = new Effects(scene, look);
  fx.root.parent = root;

  // Invisible frame so the harness frames the play area, not whatever is in flight.
  const frame: Mesh = CreateBox('effectsFrame', { width: 9, height: 3, depth: 7 }, scene);
  frame.position.y = 1.5;
  frame.isVisible = false;
  frame.isPickable = false;
  frame.parent = root;

  const timers: Record<string, Timer> = {
    dart: { every: 0.3, t: 0.25, n: 0 },
    gate: { every: 1.5, t: 1.4, n: 0 },
    shards: { every: 4.5, t: 3.0, n: 0 },
    debris: { every: 1.6, t: 1.5, n: 0 },
    dust: { every: 0.12, t: 0, n: 0 },
    base: { every: 0.45, t: 0.3, n: 0 },
    phase: { every: 2.2, t: 2.0, n: 0 },
    miss: { every: 1.3, t: 0.6, n: 0 },
  };
  const due = (tm: Timer, dt: number): boolean => {
    tm.t += dt;
    if (tm.t < tm.every) return false;
    tm.t -= tm.every;
    tm.n++;
    return true;
  };

  return {
    root,
    update(time, dt) {
      if (due(timers.dart, dt)) {
        const n = timers.dart.n;
        fx.dart(-3.2, 2.2, -2.6 + (n % 3) * 0.9, -1.5 + (n % 2) * 0.8);
      }
      if (due(timers.gate, dt)) fx.gateBurst(0, 0, 3.6, timers.gate.n % 2 === 1);
      if (due(timers.shards, dt)) fx.gateShards(0, 0.4, 3.6, timers.shards.n % 2 === 1);
      if (due(timers.debris, dt)) fx.debris(3, 0.8, timers.debris.n % 2 === 0, 3);
      if (due(timers.dust, dt)) fx.dust(-1.5 + Math.sin(time * 1.7) * 1.2, -2.6 + Math.cos(time * 2.3) * 0.4);
      if (due(timers.base, dt)) fx.baseHit(2.2 + Math.sin(time) * 0.6, -2.4, timers.base.n % 2);
      if (due(timers.phase, dt)) fx.phaseRing(0, 2.8, 4);
      if (due(timers.miss, dt)) fx.missPuff(-3.5, -3);
      fx.update(dt);
    },
    dispose() {
      fx.dispose();
      root.dispose();
    },
  };
}
