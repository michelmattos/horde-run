// Ultimate cues in the battle (Milestone 4): the paratroopers' paper parachutes drifting
// down onto the landing zone and the big glass marble rolling up the lane with a dust
// trail, then popping away. (The barrage is a burst in effects.ts.) World 2 adds the
// Blizzard: a 4 s sweep of snowflakes blowing across the enemy half of the lane, front
// running up the lane, while a frost sheet fades in over the enemy crowd and ice
// sparkles twinkle on it until the freeze ends. Driven by the battle's 'ultimate' cues
// (cue() takes them structurally, see UltimateCue); nothing here moves the camera.
//
// Pools: PARAS parachute slots in typed arrays, one thin-instanced mesh (1 draw call while
// any is in the air); one marble (3 draw calls while it rolls; a new cue restarts it);
// the Blizzard: FLAKES flakes and SPARKLES glints (thin-instanced) and one frost sheet,
// 3 draw calls while it shows (a new cue restarts it). update() and cue() never allocate.
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Look } from './look/index.ts';
import type { Effects } from './effects.ts';
import { MARBLE_RADIUS, createMarble, createParachuteMesh } from './models/ultimates.ts';
import { createFlakeMesh, createFrostSheet, createSparkleMesh, setFrostAlpha } from './models/blizzard.ts';
import type { MarbleModel } from './models/ultimates.ts';
import { marbleAt, mulberry32, parachuteAt, writeTRS } from './fxLogic.ts';
import type { MarblePose, ParachutePose } from './fxLogic.ts';

const PARAS = 24;
const PARA_COUNT = 10; // parachutes per drop (6 on 'low')
const PARA_FALL = 0.9; // seconds each one is in the air
const PARA_START_Y = 7;
const PARA_CRUMPLE = 0.25; // seconds the canopy takes to fold away after landing
const TRAIL_EVERY = 0.05; // seconds between marble dust puffs
const FLAKES = 200; // blizzard flakes in the pool (half on 'low')
const SPARKLES = 36;
const SWEEP = 4; // seconds the snow sweeps across the enemy half
const FLAKE_SPEED = 9; // lane units per second across the lane
const FLAKE_SIZE = 0.55;
const FROST_IN = 0.6; // share of the sweep over which the frost sheet fades in
const FROST_OUT = 0.6; // seconds the frost takes to melt after the freeze
const FROST_ALPHA = 0.85;
const FROST_PAD = 1.2; // the sheet reaches this far past the enemy crowd

// An 'ultimate' battle cue, structurally (BattleCue in game/battle.ts and the renderer's
// FxCue both fit): either side may add fields or ids without touching this module.
export interface UltimateCue {
  type: 'ultimate';
  id: string;
  x: number;
  z: number;
  radius: number;
  duration: number;
}

// Where the frost sheet goes: the enemy crowd's footprint (crowdLogic.teamBounds()).
export interface FrostArea {
  count: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export class UltimateVisuals {
  private readonly look: Look;
  private readonly fx: Effects;
  private readonly rand = mulberry32(0x5eed);
  private readonly chutes: Mesh;
  private readonly marble: MarbleModel;
  private readonly matrices = new Float32Array(PARAS * 16);
  // Parachute slots: landing spot, time since launch (negative while waiting), phase.
  private readonly px = new Float32Array(PARAS);
  private readonly pz = new Float32Array(PARAS);
  private readonly pt = new Float32Array(PARAS);
  private readonly phase = new Float32Array(PARAS);
  private readonly live = new Uint8Array(PARAS);
  private nextPara = 0;
  private readonly pose: ParachutePose = { y: 0, open: 0, sway: 0, tilt: 0, crumple: 0 };
  // The marble's roll.
  private marbleOn = false;
  private marbleT = 0;
  private mx = 0;
  private mz = 0;
  private mDur = 0;
  private sinceTrail = 0;
  private readonly mPose: MarblePose = { x: 0, z: 0, roll: 0, scale: 1, done: false };
  // The Blizzard: per flake its birth time in the sweep, lane z, height and spin seeds.
  private readonly flakes: Mesh;
  private readonly sparkles: Mesh;
  private readonly frost: Mesh;
  private readonly fMatrices = new Float32Array(FLAKES * 16);
  private readonly sMatrices = new Float32Array(SPARKLES * 16);
  private readonly fBorn = new Float32Array(FLAKES);
  private readonly fZ = new Float32Array(FLAKES);
  private readonly fY = new Float32Array(FLAKES);
  private readonly fSpin = new Float32Array(FLAKES);
  private readonly sX = new Float32Array(SPARKLES);
  private readonly sZ = new Float32Array(SPARKLES);
  private readonly sPhase = new Float32Array(SPARKLES);
  private blizzOn = false;
  private blizzT = 0;
  private blizzEnd = 0; // seconds after the cue the frost starts melting
  private bMinX = 0;
  private bMaxX = 0;

  constructor(scene: Scene, look: Look, fx: Effects) {
    this.look = look;
    this.fx = fx;
    this.chutes = createParachuteMesh(scene, look);
    for (let i = 0; i < PARAS; i++) this.matrices[i * 16 + 15] = 1;
    this.chutes.thinInstanceSetBuffer('matrix', this.matrices, 16, false);
    this.chutes.thinInstanceCount = 1;
    this.chutes.isVisible = false;
    this.marble = createMarble(scene, look);
    this.marble.setVisible(false);
    this.flakes = createFlakeMesh(scene, look);
    this.sparkles = createSparkleMesh(scene, look);
    for (let i = 0; i < FLAKES; i++) this.fMatrices[i * 16 + 15] = 1;
    for (let i = 0; i < SPARKLES; i++) this.sMatrices[i * 16 + 15] = 1;
    this.flakes.thinInstanceSetBuffer('matrix', this.fMatrices, 16, false);
    this.sparkles.thinInstanceSetBuffer('matrix', this.sMatrices, 16, false);
    this.flakes.thinInstanceCount = 1;
    this.sparkles.thinInstanceCount = 1;
    this.flakes.isVisible = false;
    this.sparkles.isVisible = false;
    this.frost = createFrostSheet(scene);
  }

  // Routes an 'ultimate' cue: paratroopers, marble and blizzard play here; false for the
  // ones that are not ours (the barrage is effects.ts's). `area`: the enemy crowd's
  // footprint for the Blizzard's frost sheet (absent or empty: the enemy half of the lane).
  cue(c: UltimateCue, area?: FrostArea): boolean {
    if (c.type !== 'ultimate') return false;
    if (c.id === 'paratroopers') this.paratroopers(c.x, c.z, c.radius, c.duration);
    else if (c.id === 'marble') this.marbleRoll(c.x, c.z, c.duration);
    else if (c.id === 'blizzard') this.blizzard(c.x, c.z, c.radius, c.duration, area);
    else return false;
    return true;
  }

  // The Blizzard (cue: x = lane centre, z = half the lane length, radius = lane width,
  // duration = freeze seconds): snow sweeps across z..2z for SWEEP seconds while the frost
  // sheet covers `area` (or that half lane) until the freeze ends.
  blizzard(x: number, z: number, radius: number, duration: number, area?: FrostArea): void {
    const half = Math.max(1, radius / 2);
    const z0 = z;
    const z1 = z * 2;
    this.bMinX = x - half - 1.5;
    this.bMaxX = x + half + 1.5;
    const n = this.look.quality === 'low' ? FLAKES / 2 : FLAKES;
    // Births spread so the last flake is across the lane when the sweep ends.
    const span = Math.max(0.5, SWEEP - (this.bMaxX - this.bMinX) / FLAKE_SPEED);
    for (let i = 0; i < FLAKES; i++) {
      const born = i < n ? (i / n) * span : -1;
      this.fBorn[i] = born;
      this.fZ[i] = z0 + (z1 - z0) * Math.min(1, Math.max(0, born / SWEEP + (this.rand() - 0.5) * 0.25));
      this.fY[i] = 1.2 + this.rand() * 2.6;
      this.fSpin[i] = this.rand() * Math.PI * 2;
    }
    // The frost sheet: over the crowd (padded) or the enemy half of the lane.
    let minX = x - half;
    let maxX = x + half;
    let minZ = z0;
    let maxZ = z1;
    if (area && area.count > 0) {
      minX = Math.max(minX, area.minX - FROST_PAD);
      maxX = Math.min(maxX, area.maxX + FROST_PAD);
      minZ = area.minZ - FROST_PAD;
      maxZ = area.maxZ + FROST_PAD;
    }
    this.frost.position.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    this.frost.scaling.set(Math.max(2, maxX - minX), 1, Math.max(2, maxZ - minZ));
    for (let i = 0; i < SPARKLES; i++) {
      this.sX[i] = minX + 0.6 + this.rand() * Math.max(0, maxX - minX - 1.2);
      this.sZ[i] = minZ + 0.6 + this.rand() * Math.max(0, maxZ - minZ - 1.2);
      this.sPhase[i] = this.rand() * Math.PI * 2;
    }
    this.blizzOn = true;
    this.blizzT = 0;
    this.blizzEnd = Math.max(SWEEP, duration);
  }

  // Paratroopers over (x, z): PARA_COUNT parachutes spread over +-radius that land one
  // after another across `duration` seconds (the sim drops the units evenly over it).
  paratroopers(x: number, z: number, radius: number, duration: number): void {
    const n = this.look.quality === 'low' ? 6 : PARA_COUNT;
    const r = Math.max(0.5, radius);
    for (let k = 0; k < n; k++) {
      const i = this.nextPara;
      this.nextPara = (i + 1) % PARAS;
      const land = (Math.max(0.1, duration) * (k + 1)) / n;
      this.px[i] = x + (this.rand() * 2 - 1) * r;
      this.pz[i] = z + (this.rand() * 2 - 1) * r * 0.6;
      this.pt[i] = PARA_FALL - land; // reaches PARA_FALL (touchdown) at `land`
      this.phase[i] = this.rand() * Math.PI * 2;
      this.live[i] = 1;
    }
  }

  // The marble rolls up the lane from (x, z) for `duration` seconds.
  marbleRoll(x: number, z: number, duration: number): void {
    this.marbleOn = true;
    this.marbleT = 0;
    this.mx = x;
    this.mz = z;
    this.mDur = Math.max(0, duration);
    this.sinceTrail = 0;
    this.marble.setVisible(true);
  }

  update(dt: number): void {
    this.stepChutes(dt);
    this.stepMarble(dt);
    this.stepBlizzard(dt);
  }

  private stepBlizzard(dt: number): void {
    if (!this.blizzOn) return;
    this.blizzT += dt;
    const t = this.blizzT;
    // Frost: fades in behind the sweep's front, holds, melts after the freeze.
    const fin = Math.min(1, t / (SWEEP * FROST_IN));
    const fout = t > this.blizzEnd ? Math.max(0, 1 - (t - this.blizzEnd) / FROST_OUT) : 1;
    const frost = fin * fout;
    setFrostAlpha(this.frost, frost * FROST_ALPHA);
    if (t > this.blizzEnd + FROST_OUT) {
      this.blizzOn = false;
      this.flakes.isVisible = false;
      this.sparkles.isVisible = false;
      setFrostAlpha(this.frost, 0);
      return;
    }
    // Flakes blow across the lane (+x), drifting down and tumbling.
    const m = this.fMatrices;
    const width = this.bMaxX - this.bMinX;
    const life = width / FLAKE_SPEED;
    let count = 0;
    for (let i = 0; i < FLAKES; i++) {
      const born = this.fBorn[i];
      if (born < 0) continue;
      const a = t - born;
      if (a < 0 || a > life) continue;
      const k = a / life;
      const sp = this.fSpin[i];
      const y = this.fY[i] * (1 - 0.75 * k) + Math.sin(a * 5 + sp) * 0.15;
      const s = FLAKE_SIZE * Math.min(1, a * 6, (life - a) * 6);
      writeTRS(m, count * 16, this.bMinX + width * k, y, this.fZ[i], s, s, s, sp + a * 4, a * 7 + sp, sp * 2 + a * 3);
      count++;
    }
    this.flakes.thinInstanceCount = Math.max(1, count);
    this.flakes.isVisible = count > 0;
    if (count > 0) this.flakes.thinInstanceBufferUpdated('matrix');
    // Sparkles twinkle on the frost.
    const sm = this.sMatrices;
    let sc = 0;
    if (frost > 0.05) {
      for (let i = 0; i < SPARKLES; i++) {
        const tw = Math.sin(t * 3.1 + this.sPhase[i]);
        const s = (tw > 0 ? tw * tw : 0) * frost;
        if (s < 0.05) continue;
        writeTRS(sm, sc * 16, this.sX[i], 0.22, this.sZ[i], s, s, s, this.sPhase[i] + t, 0, 0.3);
        sc++;
      }
    }
    this.sparkles.thinInstanceCount = Math.max(1, sc);
    this.sparkles.isVisible = sc > 0;
    if (sc > 0) this.sparkles.thinInstanceBufferUpdated('matrix');
  }

  private stepChutes(dt: number): void {
    let count = 0;
    const m = this.matrices;
    const end = PARA_FALL + PARA_CRUMPLE;
    for (let i = 0; i < PARAS; i++) {
      if (!this.live[i]) continue;
      const before = this.pt[i];
      this.pt[i] += dt;
      const t = this.pt[i];
      if (before < PARA_FALL && t >= PARA_FALL) this.fx.trailPuff(this.px[i], this.pz[i], 0.7);
      if (t >= end) {
        this.live[i] = 0;
        continue;
      }
      if (t < 0) continue; // not launched yet
      const p = this.pose;
      parachuteAt(t / PARA_FALL, PARA_START_Y, this.phase[i], PARA_CRUMPLE / PARA_FALL, p);
      // Canopy opens (whole figure scales in), then crumples flat and shrinks away.
      const s = p.crumple > 0 ? 1 - p.crumple : Math.min(1, p.open);
      const sy = p.crumple > 0 ? Math.max(0.05, 1 - p.crumple) : p.open;
      writeTRS(m, count * 16, this.px[i] + p.sway, p.y, this.pz[i], s, sy, s, this.phase[i], 0, p.tilt);
      count++;
    }
    this.chutes.thinInstanceCount = Math.max(1, count);
    this.chutes.isVisible = count > 0;
    if (count > 0) this.chutes.thinInstanceBufferUpdated('matrix');
  }

  private stepMarble(dt: number): void {
    if (!this.marbleOn) return;
    this.marbleT += dt;
    const p = this.mPose;
    marbleAt(this.marbleT, this.mx, this.mz, this.mDur, MARBLE_RADIUS, p);
    if (p.done) {
      this.marbleOn = false;
      this.marble.setVisible(false);
      return;
    }
    const root = this.marble.root;
    root.position.set(p.x, MARBLE_RADIUS * p.scale, p.z);
    this.marble.spin.rotation.x = p.roll;
    this.marble.setScale(p.scale);
    // Dust trail while it rolls; a last puff ring as it pops.
    if (this.marbleT < this.mDur) {
      this.sinceTrail += dt;
      if (this.sinceTrail >= TRAIL_EVERY) {
        this.sinceTrail = 0;
        this.fx.trailPuff(p.x + (this.rand() - 0.5) * MARBLE_RADIUS, p.z - MARBLE_RADIUS * 0.8, 0.9);
      }
    } else if (this.marbleT - dt < this.mDur) {
      for (let k = 0; k < 5; k++) this.fx.trailPuff(p.x, p.z, 1.3);
    }
  }

  clear(): void {
    this.live.fill(0);
    this.marbleOn = false;
    this.marble.setVisible(false);
    this.chutes.isVisible = false;
    this.blizzOn = false;
    this.flakes.isVisible = false;
    this.sparkles.isVisible = false;
    setFrostAlpha(this.frost, 0);
  }

  dispose(): void {
    this.chutes.dispose();
    this.marble.dispose();
    this.flakes.dispose();
    this.sparkles.dispose();
    this.frost.dispose();
  }
}
