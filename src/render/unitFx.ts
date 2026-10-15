// Unit-level World 3 effects (Milestone 6), fed the sim's events like effects.ts:
//   arrow     an archer's shot: a little wooden arrow (steel head, red fletching) flies a
//             short arc from (x, z) to (tx, tz) in ~0.25 s (crowdLogic.arrowAt) and
//             kicks up a tiny dust puff where it lands;
//   ricochet  a Gear Gun shot bounced off a lane wall: hot brass sparks spray back into
//             the lane from (x, z) with a small puff;
//   gateWalk  the Wind-up Robot starts walking a gate: for `seconds` a row of brass gear
//             glints pops up along the gate line, ticking round a tooth at a time, while
//             wind-up sparks crackle along it (crowdLogic.walkGlint*).
// Everything is pooled in typed arrays and drawn thin-instanced (arrows, puffs, sparks,
// gear glints: at most 4 draw calls, none while idle); handleEvents() and update() never
// allocate. Nothing here touches the camera.
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { SimEvent } from '../contracts.ts';
import type { Look } from './look/index.ts';
import { MIX, buildMesh, lathe, lin, mergeParts, mixUv, mixedToyMaterial, paint, place } from './look/index.ts';
import type { MixSlot } from './look/index.ts';
import { ParticlePool, mulberry32, writeTRS } from './fxLogic.ts';
import {
  WALK_GLINTS,
  WALK_SPAN,
  WALK_TICK,
  arrowAt,
  arrowDuration,
  walkGlintOffset,
  walkGlintScale,
  walkTickAngle,
} from './crowdLogic.ts';
import type { ArrowPose } from './crowdLogic.ts';
import { gearVD } from './models/championWindup.ts';
import { sphereVD } from './models/champion.ts';

const ARROWS = 48;
const PUFFS = 32;
const SPARKS = 96;
const WALKERS = 4;
const GLINT_TEETH = 8;
const GLINT_SIZE = 0.26; // gear radius (u)
const GLINT_Y = 0.55;
const WALK_SPARK_RATE = 24; // sparks per second along a walked gate
const RICOCHET_SPARKS = 10;

// sRGB-ish linear colours (instance colours; > 1 blooms on the sparks).
const BRASS_HOT = [2.4, 1.6, 0.55] as const;
const WHITE_HOT = [2.6, 2.3, 1.7] as const;
const DUST = [0.78, 0.72, 0.64] as const;

// One thin-instanced batch of fixed capacity: matrices (and optional colours), hidden
// while empty (one instance kept so the material compiles with its instance attributes).
class Batch {
  readonly mesh: Mesh;
  readonly matrices: Float32Array;
  readonly colors: Float32Array | null;
  count = 0;

  constructor(mesh: Mesh, capacity: number, withColor: boolean) {
    this.mesh = mesh;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.doNotSyncBoundingInfo = true;
    this.matrices = new Float32Array(capacity * 16);
    this.colors = withColor ? new Float32Array(capacity * 4).fill(1) : null;
    mesh.thinInstanceSetBuffer('matrix', this.matrices, 16, false);
    if (this.colors) mesh.thinInstanceSetBuffer('color', this.colors, 4, false);
    mesh.thinInstanceCount = 1;
    mesh.isVisible = false;
  }

  color(r: number, g: number, b: number): void {
    const c = this.colors;
    if (!c) return;
    const o = (this.count - 1) * 4;
    c[o] = r;
    c[o + 1] = g;
    c[o + 2] = b;
    c[o + 3] = 1;
  }

  // Writes the next instance (scale, yaw, pitch, roll); color() then sets its colour.
  push(
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    yaw: number,
    pitch: number,
    roll: number,
  ): void {
    writeTRS(this.matrices, this.count * 16, x, y, z, sx, sy, sz, yaw, pitch, roll);
    this.count++;
  }

  commit(): void {
    this.mesh.thinInstanceCount = Math.max(1, this.count);
    this.mesh.isVisible = this.count > 0;
    if (this.count > 0) {
      this.mesh.thinInstanceBufferUpdated('matrix');
      if (this.colors) this.mesh.thinInstanceBufferUpdated('color');
    }
  }
}

function tint(vd: VertexData, color: string, slot: MixSlot): VertexData {
  vd.uvs = null;
  return mixUv(paint(vd, lin(color)), slot);
}

// A little arrow along +Z centred on its middle, 0.42 long: wooden shaft, steel head,
// red fletching.
function arrowGeometry(): VertexData {
  const shaft = place(
    lathe(
      [
        [0.014, -0.2],
        [0.014, 0.16],
      ],
      6,
    ),
    { rx: Math.PI / 2 },
  );
  const head = place(
    lathe(
      [
        [0.016, 0.15],
        [0.036, 0.16],
        [0, 0.22],
      ],
      6,
    ),
    { rx: Math.PI / 2 },
  );
  const parts = [tint(shaft, '#d7a676', MIX.paper), tint(head, '#c9ced4', MIX.brass)];
  for (let k = 0; k < 3; k++) {
    const vane = place(
      lathe(
        [
          [0.0, -0.21],
          [0.05, -0.17],
          [0.04, -0.1],
          [0.0, -0.08],
        ],
        2,
      ),
      { rx: Math.PI / 2, rz: (k * Math.PI * 2) / 3 },
    );
    parts.push(tint(vane, '#d93a2f', MIX.paper));
  }
  return mergeParts(parts);
}

// An upright brass gear glint (normal +Z, centred), radius 1.
function glintGeometry(): VertexData {
  const g = place(gearVD(1, 0.78, GLINT_TEETH, 0.18), { rx: Math.PI / 2, z: 0.09 });
  const hub = place(
    lathe(
      [
        [0.3, 0],
        [0.3, 0.12],
        [0, 0.16],
      ],
      8,
    ),
    { rx: Math.PI / 2, z: 0.08 },
  );
  return mergeParts([tint(g, '#d2a33f', MIX.brass), tint(hub, '#c9ced4', MIX.brass)]);
}

// A spark: a stretched diamond along +Z, unit length.
function sparkGeometry(): VertexData {
  const vd = place(
    lathe(
      [
        [0, -0.5],
        [0.12, 0],
        [0, 0.5],
      ],
      4,
    ),
    { rx: Math.PI / 2 },
  );
  vd.uvs = null;
  return paint(vd, [1, 1, 1]);
}

export class UnitFx {
  private readonly rand = mulberry32(0x5eed3);
  private readonly low: boolean;
  private readonly sparkMat: StandardMaterial;

  // Arrows in flight.
  private readonly ax0 = new Float32Array(ARROWS);
  private readonly az0 = new Float32Array(ARROWS);
  private readonly ax1 = new Float32Array(ARROWS);
  private readonly az1 = new Float32Array(ARROWS);
  private readonly at = new Float32Array(ARROWS); // seconds flown
  private readonly adur = new Float32Array(ARROWS); // 0 = free slot
  private nextArrow = 0;
  private readonly pose: ArrowPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };

  // Puffs (dust) and sparks.
  private readonly puffs = new ParticlePool(PUFFS, { drag: 3, groundY: 0.05 });
  private readonly sparks = new ParticlePool(SPARKS, { drag: 1.2, bounce: 0.3, groundY: 0.03 });

  // Gate walks: start x, z, seconds in, duration (0 = free), spark accumulator.
  private readonly wx = new Float32Array(WALKERS);
  private readonly wz = new Float32Array(WALKERS);
  private readonly wt = new Float32Array(WALKERS);
  private readonly wdur = new Float32Array(WALKERS);
  private readonly wacc = new Float32Array(WALKERS);
  private nextWalker = 0;

  private readonly arrowBatch: Batch;
  private readonly puffBatch: Batch;
  private readonly sparkBatch: Batch;
  private readonly glintBatch: Batch;

  constructor(scene: Scene, look: Look) {
    this.low = look.quality === 'low';
    const mix = look.material('toy-mix', () => mixedToyMaterial(scene));
    const sm = new StandardMaterial('unitFxSpark', scene);
    sm.disableLighting = true;
    sm.diffuseColor = Color3.Black();
    sm.specularColor = Color3.Black();
    sm.emissiveColor = Color3.White(); // times the instance colour
    this.sparkMat = sm;
    this.arrowBatch = new Batch(buildMesh(scene, 'unitFxArrows', arrowGeometry(), mix), ARROWS, false);
    const dust = sphereVD(1, 7, 4);
    this.puffBatch = new Batch(buildMesh(scene, 'unitFxPuffs', tint(dust, '#ffffff', MIX.paper), mix), PUFFS, true);
    this.sparkBatch = new Batch(buildMesh(scene, 'unitFxSparks', sparkGeometry(), sm), SPARKS, true);
    this.glintBatch = new Batch(buildMesh(scene, 'unitFxGlints', glintGeometry(), mix), WALKERS * WALK_GLINTS, true);
  }

  handleEvents(events: readonly SimEvent[]): void {
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.type === 'arrow') this.arrow(e.x, e.z, e.tx, e.tz);
      else if (e.type === 'ricochet') this.ricochet(e.x, e.z);
      else if (e.type === 'gateWalk') this.gateWalk(e.x, e.z, e.seconds);
    }
  }

  private arrow(x: number, z: number, tx: number, tz: number): void {
    const i = this.nextArrow;
    this.nextArrow = (i + 1) % ARROWS;
    this.ax0[i] = x;
    this.az0[i] = z;
    this.ax1[i] = tx;
    this.az1[i] = tz;
    this.at[i] = 0;
    this.adur[i] = arrowDuration(Math.hypot(tx - x, tz - z));
  }

  private ricochet(x: number, z: number): void {
    const r = this.rand;
    const dir = x > 0 ? -1 : 1; // back into the lane
    const n = this.low ? RICOCHET_SPARKS / 2 : RICOCHET_SPARKS;
    for (let k = 0; k < n; k++) {
      const c = k % 3 === 0 ? WHITE_HOT : BRASS_HOT;
      this.sparks.spawn(
        x,
        0.5 + r() * 0.3,
        z,
        dir * (2 + r() * 4),
        1.5 + r() * 3,
        (r() - 0.5) * 5,
        0.25 + r() * 0.25,
        0.16 + r() * 0.1,
        c[0],
        c[1],
        c[2],
        9,
      );
    }
    this.puff(x + dir * 0.15, 0.35, z, 0.22);
  }

  private gateWalk(x: number, z: number, seconds: number): void {
    if (!(seconds > 0)) return;
    const i = this.nextWalker;
    this.nextWalker = (i + 1) % WALKERS;
    this.wx[i] = x;
    this.wz[i] = z;
    this.wt[i] = 0;
    this.wdur[i] = seconds;
    this.wacc[i] = 0;
  }

  private puff(x: number, y: number, z: number, size: number): void {
    const r = this.rand;
    this.puffs.spawn(
      x,
      y,
      z,
      (r() - 0.5) * 0.8,
      0.5 + r() * 0.4,
      (r() - 0.5) * 0.8,
      0.35,
      size,
      DUST[0],
      DUST[1],
      DUST[2],
      -0.3,
    );
  }

  update(dt: number): void {
    const r = this.rand;
    // Arrows.
    const ab = this.arrowBatch;
    ab.count = 0;
    const pose = this.pose;
    for (let i = 0; i < ARROWS; i++) {
      const dur = this.adur[i];
      if (dur <= 0) continue;
      const t = this.at[i] + dt;
      if (t >= dur) {
        this.adur[i] = 0;
        const tx = this.ax1[i];
        const tz = this.az1[i];
        this.puff(tx, 0.3, tz, 0.12);
        if (!this.low) this.puff(tx + (r() - 0.5) * 0.2, 0.2, tz + (r() - 0.5) * 0.2, 0.09);
        continue;
      }
      this.at[i] = t;
      arrowAt(t / dur, this.ax0[i], this.az0[i], this.ax1[i], this.az1[i], pose);
      ab.push(pose.x, pose.y, pose.z, 1, 1, 1, pose.yaw, pose.pitch, 0);
    }

    // Gate walks: glints and their wind-up sparks.
    const gb = this.glintBatch;
    gb.count = 0;
    for (let w = 0; w < WALKERS; w++) {
      const dur = this.wdur[w];
      if (dur <= 0) continue;
      const before = this.wt[w];
      const t = before + dt;
      if (t >= dur) {
        this.wdur[w] = 0;
        continue;
      }
      this.wt[w] = t;
      const x0 = this.wx[w];
      const z0 = this.wz[w];
      const ang = walkTickAngle(t, GLINT_TEETH);
      for (let j = 0; j < WALK_GLINTS; j++) {
        const s = walkGlintScale(j, t, dur);
        if (s <= 0) continue;
        const dirSpin = j % 2 === 0 ? 1 : -1; // neighbours turn opposite ways, like meshing gears
        gb.push(
          x0 + walkGlintOffset(j),
          GLINT_Y * s,
          z0,
          GLINT_SIZE * s,
          GLINT_SIZE * s,
          GLINT_SIZE * s,
          Math.PI,
          0,
          ang * dirSpin,
        );
        // Each tick flashes the gears bright for a moment.
        const f = 1 - ((t / WALK_TICK) % 1);
        const k = 1 + 1.4 * f * f * f;
        gb.color(k, k, k);
      }
      // Sparks crackling along the line.
      this.wacc[w] += dt * (this.low ? WALK_SPARK_RATE / 2 : WALK_SPARK_RATE);
      while (this.wacc[w] >= 1) {
        this.wacc[w] -= 1;
        const c = r() < 0.3 ? WHITE_HOT : BRASS_HOT;
        this.sparks.spawn(
          x0 + (r() * 2 - 1) * WALK_SPAN,
          0.15 + r() * 0.5,
          z0 + (r() - 0.5) * 0.3,
          (r() - 0.5) * 2.5,
          1 + r() * 2.5,
          (r() - 0.5) * 1.5,
          0.2 + r() * 0.2,
          0.1 + r() * 0.08,
          c[0],
          c[1],
          c[2],
          7,
        );
      }
    }

    // Puffs: grow, then shrink away.
    this.puffs.step(dt);
    const pb = this.puffBatch;
    pb.count = 0;
    const P = this.puffs;
    for (let i = 0; i < PUFFS; i++) {
      if (P.life[i] <= 0) continue;
      const k = P.remaining(i);
      const s = P.size[i] * (0.6 + 1.6 * (1 - k)) * Math.min(1, k * 2.5);
      pb.push(P.px[i], P.py[i], P.pz[i], s, s * 0.8, s, 0, 0, 0);
      pb.color(P.r[i], P.g[i], P.b[i]);
    }

    // Sparks: streak along their velocity, fading.
    this.sparks.step(dt);
    const sb = this.sparkBatch;
    sb.count = 0;
    const S = this.sparks;
    for (let i = 0; i < SPARKS; i++) {
      if (S.life[i] <= 0) continue;
      const k = S.remaining(i);
      const vx = S.vx[i];
      const vy = S.vy[i];
      const vz = S.vz[i];
      const hs = Math.hypot(vx, vz);
      const speed = Math.hypot(hs, vy);
      const len = S.size[i] * (0.5 + Math.min(1.5, speed * 0.25));
      const w = S.size[i] * 0.5 * (0.4 + 0.6 * k);
      sb.push(S.px[i], S.py[i], S.pz[i], w, w, len, Math.atan2(vx, vz), Math.atan2(-vy, Math.max(1e-3, hs)), 0);
      sb.color(S.r[i] * k, S.g[i] * k, S.b[i] * k);
    }

    ab.commit();
    gb.commit();
    pb.commit();
    sb.commit();
  }

  // Drops every effect in flight (a new level).
  clear(): void {
    this.adur.fill(0);
    this.wdur.fill(0);
    this.puffs.clear();
    this.sparks.clear();
  }

  dispose(): void {
    this.arrowBatch.mesh.dispose();
    this.puffBatch.mesh.dispose();
    this.sparkBatch.mesh.dispose();
    this.glintBatch.mesh.dispose();
    this.sparkMat.dispose();
  }
}
