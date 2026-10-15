// Ultimate cues in the battle (Milestone 4): the paratroopers' paper parachutes drifting
// down onto the landing zone and the big glass marble rolling up the lane with a dust
// trail, then popping away. (The barrage is a burst in effects.ts.) Driven by the battle's
// 'ultimate' cues; nothing here moves the camera.
//
// Pools: PARAS parachute slots in typed arrays, one thin-instanced mesh (1 draw call while
// any is in the air); one marble (3 draw calls while it rolls; a new cue restarts it).
// update() and cue() never allocate.
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Look } from './look/index.ts';
import type { Effects } from './effects.ts';
import { MARBLE_RADIUS, createMarble, createParachuteMesh } from './models/ultimates.ts';
import type { MarbleModel } from './models/ultimates.ts';
import { marbleAt, mulberry32, parachuteAt, writeTRS } from './fxLogic.ts';
import type { MarblePose, ParachutePose } from './fxLogic.ts';

const PARAS = 24;
const PARA_COUNT = 10; // parachutes per drop (6 on 'low')
const PARA_FALL = 0.9; // seconds each one is in the air
const PARA_START_Y = 7;
const PARA_CRUMPLE = 0.25; // seconds the canopy takes to fold away after landing
const TRAIL_EVERY = 0.05; // seconds between marble dust puffs

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
  }

  dispose(): void {
    this.chutes.dispose();
    this.marble.dispose();
  }
}
