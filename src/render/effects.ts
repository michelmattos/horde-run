// Pooled one-shot effects in the toy look (docs/art-direction.md): orange foam darts with
// blue suction cups, paper confetti from good gates and torn paper from trap gates,
// chunky tan plastic shards and whole mini-blocks from destroyed defenders, carpet-fluff
// dust puffs, plastic chips at base hits and a brass ring of sparks at a boss phase.
//
// Cost: every effect lives in fixed typed-array pools (396 slots in all) drawn as seven
// thin-instance batches, so the whole system is at most 7 draw calls (a batch with
// nothing live is hidden and costs none). Spawning never allocates, update() never
// allocates, and nothing here reads input or moves a camera: the active camera's view
// matrix is only READ to turn puffs and sparks towards it.
//
//   batch      mesh (tris)                      material
//   darts      foam dart + suction cup (160)    PBR foam plastic, vertex colours
//   shards     broken plastic wedge (~70)       PBR plastic, instance colour
//   blocks     mini toy block (~110)            PBR plastic, instance colour (shares shards' material)
//   confetti   folded paper square (2)          PBR paper, double-sided, instance colour
//   puffs      soft fluff sprite (2)            unlit alpha, generated fluff texture
//   sparks     streak sprite (2)                unlit additive, radial texture
//   rings      floor ring (2)                   unlit alpha, generated ring texture
//
// API (index.ts): new Effects(scene, look?) then gateBurst / dust / dart / debris /
// gateShards / missPuff / phaseRing / baseHit, update(dt) once per frame, clear() on a
// level reload, dispose() with the scene. `root` holds every mesh (leave it at the origin
// in the game). No shadows are cast: the bits are small and short-lived.
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Material } from '@babylonjs/core/Materials/material';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Constants } from '@babylonjs/core/Engines/constants';
import type { Look } from './look/index.ts';
import { HEX, lin, srgb } from './look/palette.ts';
import { plasticMaterial } from './look/materials.ts';
import { lathe, place, roundedBox } from './look/geometry.ts';
import { radialTexture } from './look/textures.ts';
import {
  KeyedThrottle,
  ParticlePool,
  TracerPool,
  dartHeight,
  dartPitch,
  fxEnvelope,
  mulberry32,
  writeBillboard,
  writeStreak,
  writeTRS,
} from './fxLogic.ts';

// ---------- tuning ----------
const TRACERS = 24; // darts in flight
const FALLEN = 24; // darts bouncing off after impact
const SOLIDS = 110; // plastic shards, chips and mini-blocks
const CONFETTI = 150; // paper confetti and torn paper
const PUFFS = 48; // fluff / dust / squash puffs
const SPARKS = 32; // boss-phase sparks
const RINGS = 8; // floor rings
export const FX_POOL_TOTAL = TRACERS + FALLEN + SOLIDS + CONFETTI + PUFFS + SPARKS + RINGS; // 396

const DART_TIME = 0.2;
const DART_FROM_Y = 2.6; // the tan dart shooter on top of a block tower
const DART_TO_Y = 0.55;
const DART_LIFT = 0.35; // extra height at mid-flight (a slight lob)
const DART_SPIN = 22; // rad/s roll in flight
const DART_SCALE = 1.25; // a touch over toy scale so darts read on a phone
const DUST_INTERVAL = 0.07; // clash events arrive by the dozen; throttle the puffs
const GRAVITY = 16;

// Solid shapes (one pool, two meshes).
const SHARD = 0;
const BLOCK = 1;

// Linear colours (r, g, b) used by the spawners; read once, never allocated per spawn.
interface Rgb {
  r: number;
  g: number;
  b: number;
}
// PBR bits take LINEAR colours; the unlit sprite materials (StandardMaterial) take sRGB.
const rgb = (hex: string, k = 1): Rgb => {
  const c = lin(hex);
  return { r: c.r * k, g: c.g * k, b: c.b * k };
};
const srgbRgb = (hex: string, k = 1): Rgb => {
  const c = srgb(hex);
  return { r: c.r * k, g: c.g * k, b: c.b * k };
};

// Thin-instance batch: preallocated matrix + colour buffers, count rewritten every frame.
class FxBatch {
  readonly mesh: Mesh;
  readonly m: Float32Array;
  readonly c: Float32Array;
  readonly capacity: number;
  count = 0;

  constructor(mesh: Mesh, material: Material, capacity: number, root: TransformNode) {
    this.mesh = mesh;
    this.capacity = capacity;
    this.m = new Float32Array(capacity * 16);
    this.c = new Float32Array(capacity * 4);
    for (let i = 0; i < capacity; i++) this.m[i * 16 + 15] = 1;
    mesh.material = material;
    mesh.parent = root;
    mesh.isPickable = false;
    mesh.receiveShadows = false;
    mesh.alwaysSelectAsActiveMesh = true; // instances spread over the lane; skip culling by the base mesh
    mesh.doNotSyncBoundingInfo = true;
    mesh.thinInstanceSetBuffer('matrix', this.m, 16, false);
    mesh.thinInstanceSetBuffer('color', this.c, 4, false);
    // Never let the count reach 0: a material compiled while a mesh has no thin instances
    // leaves INSTANCESCOLOR out for good (Babylon only re-checks attributes when they
    // change), and every instance would then render white. An empty batch is hidden.
    mesh.thinInstanceCount = 1;
    mesh.isVisible = false;
  }

  // Index of the next instance, or -1 when the batch is full.
  next(): number {
    return this.count < this.capacity ? this.count++ : -1;
  }

  color(i: number, r: number, g: number, b: number, a: number): void {
    const o = i * 4;
    this.c[o] = r;
    this.c[o + 1] = g;
    this.c[o + 2] = b;
    this.c[o + 3] = a;
  }

  commit(): void {
    this.mesh.thinInstanceCount = this.count > 0 ? this.count : 1;
    this.mesh.isVisible = this.count > 0;
    if (this.count > 0) {
      this.mesh.thinInstanceBufferUpdated('matrix');
      this.mesh.thinInstanceBufferUpdated('color');
    }
  }
}

export class Effects {
  readonly root: TransformNode;
  private readonly scene: Scene;
  private readonly look: Look | null;
  private readonly rand = mulberry32(0x9e3779b9);

  // Pools.
  private readonly tracers = new TracerPool(TRACERS);
  private readonly dartFromY = new Float32Array(TRACERS).fill(DART_FROM_Y); // launch height per tracer slot
  private readonly fallen = new ParticlePool(FALLEN, { bounce: 0.3, groundY: 0.08 });
  private readonly solids = new ParticlePool(SOLIDS, { bounce: 0.38, groundY: 0 });
  private readonly confetti = new ParticlePool(CONFETTI, { drag: 2.4, groundY: 0.03 });
  private readonly puffs = new ParticlePool(PUFFS, { drag: 2.5, groundY: 0.12 });
  private readonly sparks = new ParticlePool(SPARKS, { drag: 1.1, bounce: 0.35, groundY: 0.05 });

  // Per-slot extras: rotation (yaw, pitch, roll), spin rates, shape aspect, alpha peak.
  private readonly fallenRot = new Float32Array(FALLEN * 3);
  private readonly fallenSpin = new Float32Array(FALLEN * 3);
  private readonly solidRot = new Float32Array(SOLIDS * 3);
  private readonly solidSpin = new Float32Array(SOLIDS * 3);
  private readonly solidShape = new Uint8Array(SOLIDS);
  private readonly confRot = new Float32Array(CONFETTI * 3);
  private readonly confSpin = new Float32Array(CONFETTI * 3);
  private readonly confAspect = new Float32Array(CONFETTI * 2);
  private readonly puffGrow = new Float32Array(PUFFS);
  private readonly puffAlpha = new Float32Array(PUFFS);
  private readonly puffSpin = new Float32Array(PUFFS);

  // Rings: fixed slots.
  private readonly ringX = new Float32Array(RINGS);
  private readonly ringZ = new Float32Array(RINGS);
  private readonly ringLife = new Float32Array(RINGS);
  private readonly ringMax = new Float32Array(RINGS);
  private readonly ringW0 = new Float32Array(RINGS);
  private readonly ringW1 = new Float32Array(RINGS);
  private readonly ringAspect = new Float32Array(RINGS);
  private readonly ringCol = new Float32Array(RINGS * 4);
  private nextRing = 0;

  // Throttles.
  private sinceDust = DUST_INTERVAL;
  private readonly gateBig = new KeyedThrottle(8, 0.4);
  private readonly gateTrickle = new KeyedThrottle(8, 0.09);
  private readonly baseChips = new KeyedThrottle(2, 0.12);

  // Camera axes for sprites (world space), refreshed each update from the active camera.
  private rX = 1;
  private rY = 0;
  private rZ = 0;
  private uX = 0;
  private uY = 1;
  private uZ = 0;
  private fX = 0;
  private fY = 0;
  private fZ = 1;

  // Batches and the resources they own.
  private readonly darts: FxBatch;
  private readonly shardBatch: FxBatch;
  private readonly blockBatch: FxBatch;
  private readonly confBatch: FxBatch;
  private readonly puffBatch: FxBatch;
  private readonly sparkBatch: FxBatch;
  private readonly ringBatch: FxBatch;
  private readonly materials: Material[] = [];
  private readonly textures: Texture[] = [];

  // Colours (linear).
  private readonly C = {
    tan: rgb(HEX.tan),
    tanLight: rgb(HEX.tanLight),
    tanDark: rgb(HEX.tanDark),
    green: rgb(HEX.green),
    greenLight: rgb(HEX.greenLight),
    greenDark: rgb(HEX.greenDark),
    gold: rgb(HEX.uiYellow),
    brass: rgb(HEX.brass),
    good: rgb(HEX.gateGood),
    goodDark: rgb(HEX.gateGoodDark),
    trap: rgb(HEX.gateTrap),
    trapDark: rgb(HEX.gateTrapDark),
    paper: rgb(HEX.paper),
    tinRed: rgb(HEX.tinRed),
  };

  // Sprite colours (sRGB): puffs, rings, sparks.
  private readonly S = {
    fluff: srgbRgb('#d8cdbd'),
    fluffCool: srgbRgb('#c4c1bc'),
    foam: srgbRgb('#ffd9ad'),
    trapPuff: srgbRgb('#f08a7a'),
    good: srgbRgb('#7de08f'),
    trap: srgbRgb(HEX.gateTrap),
    brass: srgbRgb('#ffd56a'),
    gold: srgbRgb('#fff0b8'),
    sparkBrass: srgbRgb(HEX.brass),
    tinRed: srgbRgb('#ff6a4a'),
  };

  constructor(scene: Scene, look?: Look) {
    this.scene = scene;
    this.look = look ?? null;
    this.root = new TransformNode('fxRoot', scene);

    // --- solids: PBR plastic, colour per instance (linear) ---
    const plastic = this.own(
      plasticMaterial(scene, null, { name: 'fxPlastic', instanceColor: true, roughness: 0.38, clearcoat: 0.35 }),
    );
    const foam = this.own(plasticMaterial(scene, null, { name: 'fxFoam', instanceColor: true, roughness: 0.72 }));
    const paperMat = this.own(
      plasticMaterial(scene, null, { name: 'fxPaper', instanceColor: true, roughness: 0.6, backFaceCulling: false }),
    );
    paperMat.twoSidedLighting = true;

    // --- sprites: unlit, colour and alpha per instance ---
    const fluffTex = this.ownTex(fluffTexture(scene));
    const ringTex = this.ownTex(ringTexture(scene));
    const puffMat = this.own(spriteMaterial(scene, 'fxPuffMat', fluffTex, false));
    const sparkMat = this.own(spriteMaterial(scene, 'fxSparkMat', radialTexture(scene), true));
    const ringMat = this.own(spriteMaterial(scene, 'fxRingMat', ringTex, false));
    ringMat.zOffset = -2; // lies on the rug: win the depth test without z-fighting

    this.darts = new FxBatch(meshFrom(scene, 'fxDarts', dartGeometry()), foam, TRACERS + FALLEN, this.root);
    this.shardBatch = new FxBatch(meshFrom(scene, 'fxShards', shardGeometry()), plastic, SOLIDS, this.root);
    this.blockBatch = new FxBatch(meshFrom(scene, 'fxBlocks', blockGeometry()), plastic, SOLIDS, this.root);
    this.confBatch = new FxBatch(meshFrom(scene, 'fxConfetti', confettiGeometry()), paperMat, CONFETTI, this.root);
    this.puffBatch = new FxBatch(meshFrom(scene, 'fxPuffs', spriteGeometry(true)), puffMat, PUFFS, this.root);
    this.sparkBatch = new FxBatch(meshFrom(scene, 'fxSparks', spriteGeometry(false)), sparkMat, SPARKS, this.root);
    this.ringBatch = new FxBatch(meshFrom(scene, 'fxRings', ringGeometry()), ringMat, RINGS, this.root);
  }

  private own<T extends Material>(m: T): T {
    this.materials.push(m);
    return m;
  }

  private ownTex(t: Texture): Texture {
    this.textures.push(t);
    return t;
  }

  // Fewer bits on the 'low' quality tier.
  private count(n: number): number {
    return this.look?.quality === 'low' ? Math.max(1, Math.round(n * 0.6)) : n;
  }

  private r(a: number, b: number): number {
    return a + (b - a) * this.rand();
  }

  // ---------- public spawners (signatures used by index.ts) ----------

  // Units passed a gate. Good: a fountain of gold and green paper confetti and a soft
  // green ring; trap: a red puff of torn paper bits and a red ring. Gates report every
  // tick while units stream through, so a full burst fires at most every 0.4 s per gate
  // and the ticks in between add a light trickle.
  gateBurst(x: number, z: number, width: number, positive: boolean): void {
    const w = Math.max(1, width);
    const key = Math.round(z * 2) * 64 + Math.round(x / w) * 2 + (positive ? 0 : 1);
    if (this.gateBig.allow(key)) {
      if (positive) {
        this.ring(x, z, w * 0.35, w * 1.15, 0.75, 0.6, this.S.good, 1.15, 0.95);
        this.confettiFountain(x, z, w, this.count(26));
      } else {
        this.ring(x, z, w * 0.35, w * 1.05, 0.75, 0.55, this.S.trap, 1.15, 0.9);
        this.tornPaper(x, z, w, this.count(14));
        for (let i = 0; i < 3; i++)
          this.puff(
            x + this.r(-0.4, 0.4) * w,
            this.r(0.5, 1.1),
            z + this.r(-0.3, 0.3),
            this.r(-1, 1),
            0.6,
            -0.4,
            0.7,
            2.0,
            0.8,
            this.S.trapPuff.r,
            this.S.trapPuff.g,
            this.S.trapPuff.b,
            0.8,
          );
      }
    } else if (this.gateTrickle.allow(key)) {
      if (positive) this.confettiFountain(x, z, w, 3);
      else this.tornPaper(x, z, w, 2);
    }
  }

  // Two soldiers clashed: a soft carpet-fluff puff (throttled).
  dust(x: number, z: number): void {
    if (this.sinceDust < DUST_INTERVAL) return;
    this.sinceDust = 0;
    const c = this.S.fluff;
    for (let i = 0; i < 2; i++) {
      const a = this.rand() * Math.PI * 2;
      const tint = this.r(0.92, 1.08);
      this.puff(
        x + Math.cos(a) * 0.25,
        this.r(0.2, 0.35),
        z + Math.sin(a) * 0.25,
        Math.cos(a) * 0.7,
        this.r(0.2, 0.5),
        Math.sin(a) * 0.7,
        0.55,
        1.5,
        this.r(0.7, 0.9),
        c.r * tint,
        c.g * tint,
        c.b * tint,
        0.85,
      );
    }
  }

  // A tower's foam dart lobs from (x, fromY, z) to (tx, tz) with a spin, squashes with a
  // puff and bounces off. fromY: the tower's world muzzle height (defaults to a 1.6 tower).
  dart(x: number, z: number, tx: number, tz: number, fromY = DART_FROM_Y): void {
    this.dartFromY[this.tracers.spawn(x, z, tx, tz, DART_TIME)] = fromY;
  }

  // A destroyed defender: chunky tan plastic shards and a couple of whole mini-blocks
  // bounce out and settle, then shrink away; a little dust. Walls throw more, wider.
  debris(x: number, z: number, wall: boolean, width: number): void {
    const n = this.count(wall ? 16 : 11);
    const spread = wall ? Math.max(0.6, width * 0.45) : 0.45;
    const C = this.C;
    for (let i = 0; i < n; i++) {
      const pick = i % 5;
      const c = pick === 0 && i % 2 === 0 ? C.tanDark : pick < 3 ? C.tan : C.tanLight;
      const a = this.rand() * Math.PI * 2;
      const sp = this.r(1.6, 4);
      this.solid(
        SHARD,
        x + this.r(-1, 1) * spread,
        this.r(0.5, 1.8),
        z + this.r(-0.3, 0.3),
        Math.cos(a) * sp,
        this.r(4, 7.5),
        Math.sin(a) * sp * 0.8,
        this.r(1.6, 2.2),
        this.r(0.2, 0.36),
        c,
      );
    }
    const blocks = wall ? 3 : 2;
    for (let i = 0; i < blocks; i++) {
      const a = this.rand() * Math.PI * 2;
      const sp = this.r(1.2, 2.6);
      this.solid(
        BLOCK,
        x + this.r(-1, 1) * spread,
        this.r(0.8, 1.6),
        z + this.r(-0.2, 0.2),
        Math.cos(a) * sp,
        this.r(4.5, 6.5),
        Math.sin(a) * sp * 0.7,
        2.4,
        this.r(0.34, 0.44),
        i % 2 === 0 ? C.tanLight : C.tan,
      );
    }
    const f = this.S.fluff;
    for (let i = 0; i < 3; i++)
      this.puff(
        x + this.r(-1, 1) * spread,
        this.r(0.3, 0.8),
        z + this.r(-0.3, 0.3),
        this.r(-0.8, 0.8),
        0.4,
        this.r(-0.5, 0.5),
        0.85,
        2.2,
        this.r(0.9, 1.3),
        f.r,
        f.g,
        f.b,
        0.75,
      );
  }

  // Units that ran past the enemy base: a small cool-grey puff just beyond the lane end.
  missPuff(x: number, z: number): void {
    const c = this.S.fluffCool;
    for (let i = 0; i < 3; i++) {
      const a = this.rand() * Math.PI * 2;
      this.puff(
        x + Math.cos(a) * 0.3,
        0.3,
        z + 0.4 + Math.sin(a) * 0.3,
        Math.cos(a) * 0.8,
        0.5,
        Math.sin(a) * 0.8,
        0.6,
        1.6,
        0.75,
        c.r,
        c.g,
        c.b,
        0.75,
      );
    }
  }

  // A one-use gate breaks: plastic shards of its frame colour and a few paper bits.
  gateShards(x: number, z: number, width: number, good: boolean): void {
    const C = this.C;
    const n = this.count(12);
    for (let i = 0; i < n; i++) {
      const px = x + this.r(-0.5, 0.5) * width;
      const c = i % 3 === 0 ? (good ? C.goodDark : C.trapDark) : good ? C.good : C.trap;
      this.solid(
        SHARD,
        px,
        this.r(0.5, 2),
        z,
        (px - x) * 1.4,
        this.r(2.5, 5.5),
        this.r(-2.2, 0.6),
        this.r(1.3, 1.8),
        this.r(0.18, 0.3),
        c,
      );
    }
    if (good) this.confettiFountain(x, z, width, this.count(8));
    else this.tornPaper(x, z, width, this.count(8));
  }

  // Boss phase change: a brass-gold ring rolls out over the floor with a second, slower
  // one behind it, and gold and red sparks fly out of the tank (briefly bright for bloom).
  phaseRing(x: number, z: number, width: number): void {
    const C = this.C;
    const w = Math.max(2, width);
    this.ring(x, z, w * 0.2, w * 1.0, 1, 0.75, this.S.brass, 1.25, 1);
    this.ring(x, z, w * 0.1, w * 0.7, 1, 1.05, this.S.gold, 1.15, 0.85);
    const n = this.count(28);
    const rad = w * 0.25;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.r(-0.1, 0.1);
      const pick = i % 4;
      const c = pick === 3 ? this.S.tinRed : this.S.sparkBrass;
      const k = pick === 3 ? 1.8 : 2.4; // brief overdrive: these are the only things that bloom
      const sp = this.r(5, 8.5);
      this.sparks.spawn(
        x + Math.cos(a) * rad,
        this.r(1.2, 2),
        z + Math.sin(a) * rad * 0.6,
        Math.cos(a) * sp,
        this.r(2, 5),
        Math.sin(a) * sp * 0.7,
        this.r(0.6, 0.9),
        this.r(0.12, 0.18),
        c.r * k,
        c.g * k,
        c.b * k,
        9,
      );
    }
    // A handful of brass "medals" among them, tumbling down like confetti.
    for (let i = 0; i < this.count(10); i++) {
      const a = this.rand() * Math.PI * 2;
      this.confettiPiece(
        x + Math.cos(a) * rad,
        this.r(1.4, 2.2),
        z + Math.sin(a) * rad * 0.6,
        Math.cos(a) * 3,
        this.r(3, 6),
        Math.sin(a) * 2,
        this.r(1.4, 1.9),
        this.r(0.18, 0.24),
        1,
        1,
        i % 2 === 0 ? C.brass : C.gold,
        1.15,
      );
    }
  }

  // A base takes hits: a small spray of plastic chips in the base's army colour at the
  // impact point. team = the base that was hit (0 / 'player' = green fort, 1 / 'enemy' =
  // tan fort), as in the sim's baseHit event. Throttled per base.
  baseHit(x: number, z: number, team: number | 'player' | 'enemy'): void {
    const enemy = team === 1 || team === 'enemy';
    if (!this.baseChips.allow(enemy ? 1 : 0)) return;
    const C = this.C;
    const n = this.count(6);
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const sp = this.r(1.2, 2.8);
      const c = enemy
        ? i % 3 === 0
          ? C.tanDark
          : i % 3 === 1
            ? C.tan
            : C.tanLight
        : i % 3 === 0
          ? C.greenDark
          : i % 3 === 1
            ? C.green
            : C.greenLight;
      this.solid(
        SHARD,
        x + this.r(-0.3, 0.3),
        this.r(0.6, 1.2),
        z + this.r(-0.2, 0.2),
        Math.cos(a) * sp,
        this.r(3, 5),
        Math.sin(a) * sp * 0.6 - (enemy ? 1 : -1) * 0.8,
        this.r(0.9, 1.3),
        this.r(0.1, 0.16),
        c,
      );
    }
    const f = this.S.fluff;
    this.puff(x, 0.7, z, 0, 0.6, 0, 0.45, 1.4, 0.6, f.r, f.g, f.b, 0.6);
  }

  // ---------- spawn helpers ----------

  private ring(
    x: number,
    z: number,
    w0: number,
    w1: number,
    aspect: number,
    life: number,
    c: Rgb,
    k: number,
    alpha: number,
  ): void {
    const i = this.nextRing;
    this.nextRing = (i + 1) % RINGS;
    this.ringX[i] = x;
    this.ringZ[i] = z;
    this.ringLife[i] = life;
    this.ringMax[i] = life;
    this.ringW0[i] = w0;
    this.ringW1[i] = w1;
    this.ringAspect[i] = aspect;
    this.ringCol[i * 4] = c.r * k;
    this.ringCol[i * 4 + 1] = c.g * k;
    this.ringCol[i * 4 + 2] = c.b * k;
    this.ringCol[i * 4 + 3] = alpha;
  }

  private puff(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    grow: number,
    size: number,
    r: number,
    g: number,
    b: number,
    alpha: number,
  ): void {
    const s = this.puffs.spawn(x, y, z, vx, vy, vz, life, size, r, g, b, -0.8);
    this.puffGrow[s] = grow;
    this.puffAlpha[s] = alpha;
    this.puffSpin[s] = this.rand() * Math.PI * 2;
  }

  private solid(
    shape: number,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size: number,
    c: Rgb,
  ): void {
    const s = this.solids.spawn(x, y, z, vx, vy, vz, life, size, c.r, c.g, c.b, GRAVITY);
    this.solidShape[s] = shape;
    const o = s * 3;
    this.solidRot[o] = this.rand() * Math.PI * 2;
    this.solidRot[o + 1] = this.rand() * Math.PI * 2;
    this.solidRot[o + 2] = this.rand() * Math.PI * 2;
    this.solidSpin[o] = this.r(-6, 6);
    this.solidSpin[o + 1] = this.r(-12, 12);
    this.solidSpin[o + 2] = this.r(-12, 12);
  }

  private confettiPiece(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size: number,
    ax: number,
    az: number,
    c: Rgb,
    k: number,
  ): void {
    const s = this.confetti.spawn(x, y, z, vx, vy, vz, life, size, c.r * k, c.g * k, c.b * k, 9);
    const o = s * 3;
    this.confRot[o] = this.rand() * Math.PI * 2;
    this.confRot[o + 1] = this.rand() * Math.PI * 2;
    this.confRot[o + 2] = this.rand() * Math.PI * 2;
    this.confSpin[o] = this.r(-3, 3);
    this.confSpin[o + 1] = this.r(-14, 14);
    this.confSpin[o + 2] = this.r(-10, 10);
    this.confAspect[s * 2] = ax;
    this.confAspect[s * 2 + 1] = az;
  }

  private confettiFountain(x: number, z: number, w: number, n: number): void {
    const C = this.C;
    for (let i = 0; i < n; i++) {
      const pick = this.rand();
      const c = pick < 0.45 ? C.gold : pick < 0.8 ? C.good : C.paper;
      const strip = this.rand() < 0.3;
      const px = x + this.r(-0.42, 0.42) * w;
      this.confettiPiece(
        px,
        this.r(0.9, 1.9),
        z + this.r(-0.15, 0.15),
        (px - x) * 0.9 + this.r(-1, 1),
        this.r(5, 8.5),
        this.r(-2.4, 0.4),
        this.r(1.5, 2.1),
        this.r(0.21, 0.3),
        strip ? 0.38 : 1,
        strip ? 1.5 : 1,
        c,
        pick < 0.45 ? 1.15 : 1,
      );
    }
  }

  private tornPaper(x: number, z: number, w: number, n: number): void {
    const C = this.C;
    for (let i = 0; i < n; i++) {
      const pick = this.rand();
      const c = pick < 0.5 ? C.trap : pick < 0.75 ? C.trapDark : C.paper;
      const px = x + this.r(-0.4, 0.4) * w;
      const s = this.r(0.2, 0.34);
      this.confettiPiece(
        px,
        this.r(0.8, 1.7),
        z + this.r(-0.2, 0.2),
        (px - x) * 1.2 + this.r(-1.5, 1.5),
        this.r(2.5, 5),
        this.r(-2, 0.6),
        this.r(1.0, 1.5),
        s,
        this.r(0.55, 1),
        this.r(0.45, 1.1),
        c,
        1,
      );
    }
  }

  // ---------- per frame ----------

  update(dt: number): void {
    if (!(dt > 0)) dt = 0;
    if (dt > 0.1) dt = 0.1; // a background tab must not fling everything through the floor
    this.sinceDust += dt;
    this.gateBig.tick(dt);
    this.gateTrickle.tick(dt);
    this.baseChips.tick(dt);
    this.readCamera();

    this.stepDarts(dt);
    this.stepSolids(dt);
    this.stepConfetti(dt);
    this.stepPuffs(dt);
    this.stepSparks(dt);
    this.stepRings(dt);
  }

  private readCamera(): void {
    const cam = this.scene.activeCamera;
    if (!cam) return;
    const v = cam.getViewMatrix().m; // cached by the camera: no allocation, read only
    this.rX = v[0];
    this.rY = v[4];
    this.rZ = v[8];
    this.uX = v[1];
    this.uY = v[5];
    this.uZ = v[9];
    this.fX = v[2];
    this.fY = v[6];
    this.fZ = v[10];
  }

  private stepDarts(dt: number): void {
    const t = this.tracers;
    t.step(dt);
    const foam = this.S.foam;
    for (let e = 0; e < t.endedCount; e++) {
      const s = t.endedSlot[e];
      const ex = t.endedX[e];
      const ez = t.endedZ[e];
      const dx = ex - t.x0[s];
      const dz = ez - t.z0[s];
      const d = Math.max(1e-3, Math.hypot(dx, dz));
      // Squash puff and the dart bouncing back off the target.
      this.puff(ex, DART_TO_Y, ez, 0, 0.4, 0, 0.3, 1.9, 0.5, foam.r, foam.g, foam.b, 0.85);
      const f = this.fallen.spawn(
        ex - (dx / d) * 0.25,
        DART_TO_Y,
        ez - (dz / d) * 0.25,
        (-dx / d) * this.r(1, 1.8),
        this.r(2, 3.2),
        (-dz / d) * this.r(1, 1.8),
        0.9,
        1,
        1,
        1,
        1,
        GRAVITY,
      );
      const o = f * 3;
      this.fallenRot[o] = Math.atan2(dx, dz);
      this.fallenRot[o + 1] = 0.3;
      this.fallenRot[o + 2] = 0;
      this.fallenSpin[o] = this.r(-3, 3);
      this.fallenSpin[o + 1] = this.r(-14, -8); // flips nose up as it bounces back
      this.fallenSpin[o + 2] = this.r(-6, 6);
    }

    const b = this.darts;
    b.count = 0;
    for (let i = 0; i < t.capacity; i++) {
      if (!t.isLive(i)) continue;
      const k = t.progress(i);
      const dx = t.x1[i] - t.x0[i];
      const dz = t.z1[i] - t.z0[i];
      const dist = Math.hypot(dx, dz);
      const j = b.next();
      if (j < 0) break;
      const y0 = this.dartFromY[i];
      writeTRS(
        b.m,
        j * 16,
        t.x0[i] + dx * k,
        dartHeight(k, y0, DART_TO_Y, DART_LIFT),
        t.z0[i] + dz * k,
        DART_SCALE,
        DART_SCALE,
        DART_SCALE,
        Math.atan2(dx, dz),
        dartPitch(k, y0, DART_TO_Y, DART_LIFT, dist),
        k * DART_TIME * DART_SPIN + i,
      );
      b.color(j, 1, 1, 1, 1);
    }

    const p = this.fallen;
    p.step(dt);
    for (let i = 0; i < p.capacity; i++) {
      if (!p.isLive(i)) continue;
      const o = i * 3;
      const rot = this.fallenRot;
      if (p.grounded(i)) {
        // Lie flat on the floor.
        rot[o + 1] += (Math.round(rot[o + 1] / Math.PI) * Math.PI - rot[o + 1]) * Math.min(1, dt * 14);
        rot[o + 2] += (0 - rot[o + 2]) * Math.min(1, dt * 14);
      } else {
        rot[o] += this.fallenSpin[o] * dt;
        rot[o + 1] += this.fallenSpin[o + 1] * dt;
        rot[o + 2] += this.fallenSpin[o + 2] * dt;
      }
      const k = p.remaining(i);
      const age = (1 - k) * p.maxLife[i];
      const squash = age < 0.1 ? 0.65 + 3.5 * age : 1; // squashes on impact, springs back
      const s = Math.min(1, k / 0.25) * DART_SCALE;
      const j = b.next();
      if (j < 0) break;
      writeTRS(
        b.m,
        j * 16,
        p.px[i],
        p.py[i],
        p.pz[i],
        s * (2 - squash),
        s * (2 - squash),
        s * squash,
        rot[o],
        rot[o + 1],
        rot[o + 2],
      );
      b.color(j, 1, 1, 1, 1);
    }
    b.commit();
  }

  private stepSolids(dt: number): void {
    const p = this.solids;
    p.step(dt);
    const sb = this.shardBatch;
    const bb = this.blockBatch;
    sb.count = 0;
    bb.count = 0;
    const rot = this.solidRot;
    const spin = this.solidSpin;
    const settle = Math.min(1, dt * 12);
    for (let i = 0; i < p.capacity; i++) {
      if (!p.isLive(i)) continue;
      const o = i * 3;
      const block = this.solidShape[i] === BLOCK;
      if (p.grounded(i)) {
        // Settle: shards fall flat, blocks onto any face.
        const step = block ? Math.PI / 2 : Math.PI;
        rot[o + 1] += (Math.round(rot[o + 1] / step) * step - rot[o + 1]) * settle;
        rot[o + 2] += (Math.round(rot[o + 2] / step) * step - rot[o + 2]) * settle;
      } else {
        rot[o] += spin[o] * dt;
        rot[o + 1] += spin[o + 1] * dt;
        rot[o + 2] += spin[o + 2] * dt;
      }
      const k = p.remaining(i);
      const fade = k < 0.25 ? k / 0.25 : 1; // shrink away at the end
      const size = p.size[i] * fade;
      const lift = size * (block ? 0.5 : 0.24);
      const batch = block ? bb : sb;
      const j = batch.next();
      if (j < 0) continue;
      writeTRS(batch.m, j * 16, p.px[i], p.py[i] + lift, p.pz[i], size, size, size, rot[o], rot[o + 1], rot[o + 2]);
      batch.color(j, p.r[i], p.g[i], p.b[i], 1);
    }
    sb.commit();
    bb.commit();
  }

  private stepConfetti(dt: number): void {
    const p = this.confetti;
    p.step(dt);
    const b = this.confBatch;
    b.count = 0;
    const rot = this.confRot;
    const spin = this.confSpin;
    for (let i = 0; i < p.capacity; i++) {
      if (!p.isLive(i)) continue;
      const o = i * 3;
      if (p.grounded(i)) {
        rot[o + 1] += (0 - rot[o + 1]) * Math.min(1, dt * 20);
        rot[o + 2] += (0 - rot[o + 2]) * Math.min(1, dt * 20);
        rot[o + 1] = Math.abs(rot[o + 1]) < 0.02 ? 0 : rot[o + 1];
      } else {
        rot[o] += spin[o] * dt;
        rot[o + 1] += spin[o + 1] * dt;
        rot[o + 2] += spin[o + 2] * dt;
        // Flutter: a little sideways sway while it drifts down.
        p.vx[i] += Math.sin(rot[o + 1] * 0.7) * 2.2 * dt;
      }
      const k = p.remaining(i);
      const s = p.size[i] * (k < 0.2 ? k / 0.2 : 1);
      const j = b.next();
      if (j < 0) break;
      writeTRS(
        b.m,
        j * 16,
        p.px[i],
        p.py[i],
        p.pz[i],
        s * this.confAspect[i * 2],
        s,
        s * this.confAspect[i * 2 + 1],
        rot[o],
        rot[o + 1],
        rot[o + 2],
      );
      b.color(j, p.r[i], p.g[i], p.b[i], 1);
    }
    b.commit();
  }

  private stepPuffs(dt: number): void {
    const p = this.puffs;
    p.step(dt);
    const b = this.puffBatch;
    b.count = 0;
    for (let i = 0; i < p.capacity; i++) {
      if (!p.isLive(i)) continue;
      const k = p.remaining(i);
      const age = 1 - k;
      const grow = 1 + (this.puffGrow[i] - 1) * (1 - (1 - age) * (1 - age)); // ease-out growth
      const s = p.size[i] * grow;
      const a = this.puffAlpha[i] * fxEnvelope(k, 0.12, 0.7);
      const j = b.next();
      if (j < 0) break;
      writeBillboard(
        b.m,
        j * 16,
        p.px[i],
        p.py[i],
        p.pz[i],
        s,
        s,
        this.puffSpin[i] + age * 0.6,
        this.rX,
        this.rY,
        this.rZ,
        this.uX,
        this.uY,
        this.uZ,
      );
      b.color(j, p.r[i], p.g[i], p.b[i], a);
    }
    b.commit();
  }

  private stepSparks(dt: number): void {
    const p = this.sparks;
    p.step(dt);
    const b = this.sparkBatch;
    b.count = 0;
    for (let i = 0; i < p.capacity; i++) {
      if (!p.isLive(i)) continue;
      const k = p.remaining(i);
      const speed = Math.hypot(p.vx[i], p.vy[i], p.vz[i]);
      const w = p.size[i] * (0.4 + 0.6 * k);
      const len = w * 1.5 + speed * 0.07;
      const j = b.next();
      if (j < 0) break;
      writeStreak(b.m, j * 16, p.px[i], p.py[i], p.pz[i], p.vx[i], p.vy[i], p.vz[i], w, len, this.fX, this.fY, this.fZ);
      const a = fxEnvelope(k, 0, 0.5);
      b.color(j, p.r[i], p.g[i], p.b[i], a);
    }
    b.commit();
  }

  private stepRings(dt: number): void {
    const b = this.ringBatch;
    b.count = 0;
    for (let i = 0; i < RINGS; i++) {
      if (this.ringLife[i] <= 0) continue;
      this.ringLife[i] -= dt;
      if (this.ringLife[i] <= 0) continue;
      const k = this.ringLife[i] / this.ringMax[i];
      const t = 1 - k;
      const e = 1 - (1 - t) * (1 - t) * (1 - t); // ease-out cubic
      const w = this.ringW0[i] + (this.ringW1[i] - this.ringW0[i]) * e;
      const j = b.next();
      if (j < 0) break;
      writeTRS(b.m, j * 16, this.ringX[i], 0.045, this.ringZ[i], w, 1, w * this.ringAspect[i], 0, 0, 0);
      const c = i * 4;
      b.color(
        j,
        this.ringCol[c],
        this.ringCol[c + 1],
        this.ringCol[c + 2],
        this.ringCol[c + 3] * fxEnvelope(k, 0.08, 0.75),
      );
    }
    b.commit();
  }

  // Hide everything (used when a level is reloaded).
  clear(): void {
    this.tracers.clear();
    this.fallen.clear();
    this.solids.clear();
    this.confetti.clear();
    this.puffs.clear();
    this.sparks.clear();
    this.ringLife.fill(0);
    this.gateBig.clear();
    this.gateTrickle.clear();
    this.baseChips.clear();
    this.sinceDust = DUST_INTERVAL;
    for (const b of [
      this.darts,
      this.shardBatch,
      this.blockBatch,
      this.confBatch,
      this.puffBatch,
      this.sparkBatch,
      this.ringBatch,
    ]) {
      b.count = 0;
      b.commit();
    }
  }

  // Live particles across every pool (tests, debug overlays).
  liveCount(): number {
    let rings = 0;
    for (let i = 0; i < RINGS; i++) if (this.ringLife[i] > 0) rings++;
    let darts = 0;
    for (let i = 0; i < TRACERS; i++) if (this.tracers.isLive(i)) darts++;
    return (
      darts +
      rings +
      this.fallen.liveCount() +
      this.solids.liveCount() +
      this.confetti.liveCount() +
      this.puffs.liveCount() +
      this.sparks.liveCount()
    );
  }

  dispose(): void {
    this.root.dispose(); // takes every batch mesh with it
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
  }
}

// ---------- materials ----------

function spriteMaterial(scene: Scene, name: string, tex: Texture, additive: boolean): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.disableLighting = true;
  m.diffuseColor = Color3.Black();
  m.specularColor = Color3.Black();
  m.emissiveColor = Color3.White(); // times vertex colour times instance colour
  m.opacityTexture = tex;
  m.backFaceCulling = false;
  m.disableDepthWrite = true;
  if (additive) m.alphaMode = Constants.ALPHA_ADD;
  m.freeze();
  return m;
}

// ---------- geometry (all built once) ----------

function meshFrom(scene: Scene, name: string, vd: VertexData): Mesh {
  const mesh = new Mesh(name, scene);
  vd.applyToMesh(mesh, false);
  return mesh;
}

function setColors(vd: VertexData, fn: (x: number, y: number, z: number) => [number, number, number]): VertexData {
  const p = vd.positions!;
  const n = p.length / 3;
  const c = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const [r, g, b] = fn(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
    c[i * 4] = r;
    c[i * 4 + 1] = g;
    c[i * 4 + 2] = b;
    c[i * 4 + 3] = 1;
  }
  vd.colors = c;
  return vd;
}

// Foam dart, 0.66 long along +Z, centred on its middle: an orange foam body with a soft
// back end and a lighter seam (shows the spin), a blue rubber suction cup on the nose.
function dartGeometry(): VertexData {
  const prof: [number, number][] = [
    [0, -0.33],
    [0.05, -0.33],
    [0.07, -0.315],
    [0.078, -0.29],
    [0.078, 0.17],
    [0.072, 0.19],
    [0.045, 0.2],
    [0.045, 0.2],
    [0.042, 0.24],
    [0.06, 0.26],
    [0.11, 0.31],
    [0.12, 0.325],
    [0.112, 0.335],
    [0.08, 0.33],
    [0, 0.322],
  ];
  const vd = lathe(prof, 12);
  const orange = lin(HEX.toyOrange);
  const seam = lin('#ffb36b');
  const blue = lin(HEX.toyBlue);
  setColors(vd, (x, y, z) => {
    if (y > 0.195) return [blue.r, blue.g, blue.b];
    const a = Math.atan2(z, x);
    if (y > -0.29 && Math.abs(a) < 0.45) return [seam.r, seam.g, seam.b];
    const back = y < -0.3 ? 0.8 : 1;
    return [orange.r * back, orange.g * back, orange.b * back];
  });
  return place(vd, { rx: Math.PI / 2 }); // +Y → +Z
}

// A chunky broken piece of moulded plastic, about 1 x 0.48 x 0.8: a rounded slab cut
// into a wedge (one end thinner and narrower) so pieces read as shards, not cubes.
function shardGeometry(): VertexData {
  const vd = roundedBox(1, 0.48, 0.8, 0.07, 1);
  const p = vd.positions as number[];
  for (let i = 0; i < p.length; i += 3) {
    const u = p[i] + 0.5; // 0 at the thick end → 1 at the thin end
    if (p[i + 1] > 0) p[i + 1] -= u * 0.26; // the top slopes down
    p[i + 2] *= 1 - u * 0.4; // and the piece narrows
    p[i + 2] += (p[i + 2] > 0 ? 1 : 0) * u * u * 0.08; // a slightly ragged broken edge
  }
  vd.positions = p;
  const normals: number[] = [];
  VertexData.ComputeNormals(p, vd.indices as number[], normals);
  vd.normals = normals;
  // A touch of baked shading: underside and thin end a little darker.
  return setColors(vd, (x, y) => {
    const k = (y < 0 ? 0.82 : 1) * (1 - (x + 0.5) * 0.12);
    return [k, k, k];
  });
}

// A whole mini toy block: rounded cube with a recessed face panel feel (darker edges).
function blockGeometry(): VertexData {
  const vd = roundedBox(1, 1, 1, 0.12, 2);
  return setColors(vd, (x, y, z) => {
    const edge =
      Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) > 0.47 &&
      (Math.abs(x) > 0.38 ? 1 : 0) + (Math.abs(y) > 0.38 ? 1 : 0) + (Math.abs(z) > 0.38 ? 1 : 0) >= 2;
    const k = (edge ? 0.86 : 1) * (y < -0.4 ? 0.85 : 1);
    return [k, k, k];
  });
}

// One square of paper, 1 x 1 in the XZ plane, folded slightly along a diagonal so it
// catches the light differently on each half (flat shaded, double-sided).
function confettiGeometry(): VertexData {
  const A = [-0.5, 0.09, -0.5];
  const B = [0.5, 0, -0.5];
  const C = [0.5, 0.09, 0.5];
  const D = [-0.5, 0, 0.5];
  const positions = [...A, ...B, ...D, ...B, ...C, ...D];
  const indices = [0, 2, 1, 3, 5, 4];
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = normals;
  vd.uvs = [0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1];
  return vd;
}

// Unit quad in the local XY plane for sprites. Puffs get a vertical shade (lit top, a
// darker underside) through vertex colours so the fluff looks round, not flat.
function spriteGeometry(shaded: boolean): VertexData {
  const vd = new VertexData();
  vd.positions = [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0];
  vd.normals = [0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1];
  vd.uvs = [0, 0, 1, 0, 1, 1, 0, 1];
  vd.indices = [0, 1, 2, 0, 2, 3];
  if (shaded) vd.colors = [0.74, 0.7, 0.68, 1, 0.74, 0.7, 0.68, 1, 1.05, 1.03, 1.0, 1, 1.05, 1.03, 1.0, 1];
  return vd;
}

// Unit (diameter 1) quad on the floor (XZ plane) for rings.
function ringGeometry(): VertexData {
  const vd = new VertexData();
  vd.positions = [-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5];
  vd.normals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
  vd.uvs = [0, 0, 1, 0, 1, 1, 0, 1];
  vd.indices = [0, 2, 1, 0, 3, 2];
  return vd;
}

// ---------- generated textures (tiny, built once per Effects) ----------

function alphaTexture(scene: Scene, name: string, n: number, alpha: (u: number, v: number) => number): Texture {
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      const a = alpha((x + 0.5) / n - 0.5, (y + 0.5) / n - 0.5);
      data[i + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
    }
  }
  const t = RawTexture.CreateRGBATexture(data, n, n, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  t.name = name;
  t.hasAlpha = true;
  t.wrapU = Texture.CLAMP_ADDRESSMODE;
  t.wrapV = Texture.CLAMP_ADDRESSMODE;
  return t;
}

// A lumpy carpet-fluff cloud: a few overlapping soft blobs inside a round falloff.
function fluffTexture(scene: Scene): Texture {
  const blobs: [number, number, number][] = [
    [0, 0.02, 0.24],
    [-0.17, -0.06, 0.16],
    [0.16, -0.08, 0.17],
    [-0.1, 0.16, 0.15],
    [0.12, 0.15, 0.14],
    [0.0, -0.2, 0.13],
    [-0.24, 0.1, 0.1],
    [0.25, 0.06, 0.1],
  ];
  return alphaTexture(scene, 'fxFluff', 64, (u, v) => {
    let a = 0;
    for (const [bx, by, br] of blobs) {
      const d = Math.hypot(u - bx, v - by) / br;
      a += Math.exp(-d * d * 1.6);
    }
    const edge = Math.max(0, 1 - Math.pow(Math.hypot(u, v) * 2, 3));
    // Fine fibre noise so the puff is not a perfect gradient.
    const noise = 0.85 + 0.15 * Math.sin(u * 91 + Math.sin(v * 57) * 3) * Math.sin(v * 83 + u * 19);
    return Math.min(1, a * 1.0) * edge * noise;
  });
}

// A soft ring with a faint inner glow (floor rings at gates and the boss phase).
function ringTexture(scene: Scene): Texture {
  return alphaTexture(scene, 'fxRing', 128, (u, v) => {
    const r = Math.hypot(u, v) * 2; // 0 centre → 1 edge of the quad
    const band = Math.min(
      1,
      Math.exp(-Math.pow((r - 0.82) / 0.045, 2)) + 0.4 * Math.exp(-Math.pow((r - 0.8) / 0.13, 2)),
    );
    const glow = r < 0.82 ? 0.22 * Math.pow(r / 0.82, 3) : 0;
    return r >= 1 ? 0 : band + glow;
  });
}
