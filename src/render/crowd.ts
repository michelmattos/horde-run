// Thin-instance crowd renderer: classic green-vs-tan plastic army men. Mobs are riflemen
// striding forward (models/soldier.ts) or, from a Milestone 4 loadout, knights,
// sprinters and bombers (models/soldierVariants.ts, picked by the sim view's render
// variant byte); the champion is the loadout's: the kneeling bazooka sarge
// (models/champion.ts), the wind-up tank or the drummer (championTank.ts,
// championDrummer.ts), each a team-coloured body plus a 'trim' mesh drawn with the same
// matrices. One mesh per figure for both armies: the shared 'army-plastic' PBR material
// has a white albedo and the team colour comes from a per-instance LINEAR 'color' buffer.
// Matrices are rewritten every frame from the SimView with a little "hop" (bounce,
// forward lean and waddle, phase-offset per unit, styled per figure) like a kid hopping
// the toys along.
//
// Milestone 5 (World 2) adds the Giant (models/giant.ts) and the rolling snowball
// (models/snowball.ts: it rolls by the distance it travels instead of hopping) for the
// player, and the snowman and the wind-up penguin (models/snowman.ts, penguin.ts: each a
// team-coloured kit mesh plus a white-instanced body mesh) for the enemy. While a Blizzard
// holds the enemy crowd (BattleState.enemyFrozen > 0, update()'s third argument) the enemy
// figures stop hopping and take an ice-blue tint, easing back to their colour at the end.
//
// Milestone 6 (World 3) adds the archer (models/archer.ts) and the Wind-up Robot champion
// (models/championWindup.ts: body, trim and a turning brass key) for the player, and the
// enemy wind-up tin robot (models/windupRobot.ts: tin body and a turning key). Both
// wind-up figures are drawn off their motion (crowdLogic.GaitTracker): the robot rocks
// stiffly while it walks and stands still in its pauses, the key on its back unwinding
// fast while it walks; the champion clanks along in heavy rocking strides.
//
// Batches: rifleman, knight, sprinter, bomber, the bomber's firecrackers, champion body,
// champion trim, Giant, snowball, snowman kit + snow, penguin kit + tin and (on 'low')
// blob shadows, plus the archer, the robot's tin + key and the Wind-up Robot's body, trim
// and key (World 3): at most 20 draw calls when every kind is on screen at once (a
// level shows 6-9), plus the same in the shadow pass on high / medium, and a batch with
// no units is hidden (costs nothing). A view without a variant array draws today's look
// (riflemen and the champion: 3 calls).
// Buffers grow geometrically and nothing is allocated per frame in steady state. On the
// 'low' tier the crowd leaves the shadow map and gets soft blob shadows instead.
//
// Load: the synchronous fallback meshes (lite soldier, low champion) are drawn from the
// first frame; the full meshes replace them as soon as their promises resolve (a few
// ms; the champion fetches its baked AO file once).
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { SimView } from '../contracts.ts';
import { Team } from '../contracts.ts';
import type { Look } from './look/index.ts';
import { createBlobShadowMesh, teamColor } from './look/index.ts';
import { createSoldierFallback, createSoldierMesh } from './models/soldier.ts';
import { createChampionFallback, createChampionMeshes } from './models/champion.ts';
import type { ChampionMeshes } from './models/champion.ts';
import { createChampionTank } from './models/championTank.ts';
import { createChampionDrummer } from './models/championDrummer.ts';
import { createBomberAccentMesh, createSoldierVariantMesh } from './models/soldierVariants.ts';
import { createGiantMesh } from './models/giant.ts';
import { createSnowballMesh } from './models/snowball.ts';
import { createSnowmanMeshes } from './models/snowman.ts';
import { createPenguinMeshes } from './models/penguin.ts';
import { createArcherMesh } from './models/archer.ts';
import { ROBOT_KEY, createWindupRobotMeshes } from './models/windupRobot.ts';
import { WINDUP_KEY, createChampionWindup } from './models/championWindup.ts';
import { writeTRS } from './fxLogic.ts';
import {
  GaitTracker,
  RollTracker,
  SLOT,
  SLOT_COUNT,
  crowdScale,
  crowdSlot,
  frostAmount,
  frostColor,
  rotateLocal,
  slotStyle,
  tinRock,
} from './crowdLogic.ts';
import type { ChampionId, CrowdSlot, HopStyle } from './crowdLogic.ts';

// The sim's view with the Milestone 4 render variant byte (absent before it) and the
// Milestone 5 sideways ice slide in u/s (absent or 0 when not sliding).
export type VariantView = SimView & { readonly variant?: Uint8Array; readonly slide?: Float32Array };

// Hop: |sin| bounce with a forward lean on each hop and a side-to-side waddle.
const HOP_HEIGHT = 0.11;
const HOP_SPEED = 10;
const HOP_LEAN = 0.16; // radians at the top of a hop (positive pitch tips the +Z front down)
const WADDLE = 0.1; // radians of roll either side
// Skid on ice: a sliding figure stops hopping and tips against the slide like a skater.
const SKID_FULL = 2.5; // u/s of sideways slide for the full skid pose
const SKID_TILT = 0.32; // radians of roll at the full skid
const CHAMPION_BRIGHT = 1.12; // the champion is moulded a shade lighter so he pops
// ±4% per-instance brightness (art direction section 3): neighbouring figures separate
// instead of reading as one continuous plastic band. Keyed by sim index (swap-remove
// keeps most indices stable; a moved unit changes shade by a few percent at most).
const SHADE_VARIATION = 0.04;
const SHADES = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  SHADES[i] = 1 + SHADE_VARIATION * (((h >>> 0) / 0xffffffff) * 2 - 1);
}
const INITIAL_CAPACITY = 1024;
// The figures (authored facing +Z) stand three-quarter on to the lane camera rather than
// square: a profile shows the helmet, the rifle and the striding legs, the army-man
// silhouette, where a straight back view is just a green blob. Player toys face up the
// lane, the tan army faces down it (toward the camera).
const PLAYER_YAW = -0.7;
const ENEMY_YAW = Math.PI + 0.55;
// Blob shadow footprints (low tier), in units of the instance scale.
const MOB_BLOB = { x: 1.05, z: 1.2 }; // the radial falloff leaves a soft dark core about the size of the base plate
const CHAMP_BLOB = { x: 2.1, z: 2.4 };
const KNIGHT_BLOB = { x: 1.15, z: 1.3 };
const SNOWBALL_BLOB = 2.1;
const BLOB: Partial<Record<CrowdSlot, { x: number; z: number }>> = {
  [SLOT.knight]: KNIGHT_BLOB,
  [SLOT.giant]: { x: 2.3, z: 2.7 },
  [SLOT.snowman]: { x: 1.7, z: 1.8 },
  [SLOT.penguin]: { x: 1.3, z: 1.4 },
  [SLOT.robot]: { x: 1.35, z: 1.35 },
  [SLOT.windup]: CHAMP_BLOB,
};

class InstanceBatch {
  mesh: Mesh;
  private matrices = new Float32Array(0);
  private colors: Float32Array | null;
  private capacity = 0;
  count = 0;

  constructor(mesh: Mesh, withColor = true) {
    this.mesh = mesh;
    this.colors = withColor ? new Float32Array(0) : null;
    this.ensureCapacity(INITIAL_CAPACITY);
  }

  get matrixData(): Float32Array {
    return this.matrices;
  }

  // Swap in a new mesh (fallback -> full model): the buffers move over.
  setMesh(mesh: Mesh): void {
    const old = this.mesh;
    this.mesh = mesh;
    this.attach();
    old.dispose();
  }

  ensureCapacity(n: number): void {
    if (n <= this.capacity) return;
    let cap = Math.max(this.capacity, INITIAL_CAPACITY);
    while (cap < n) cap *= 2;
    this.capacity = cap;
    this.matrices = new Float32Array(cap * 16);
    if (this.colors) this.colors = new Float32Array(cap * 4);
    for (let i = 0; i < cap; i++) this.matrices[i * 16 + 15] = 1;
    this.attach();
  }

  private attach(): void {
    this.mesh.thinInstanceSetBuffer('matrix', this.matrices, 16, false);
    if (this.colors) this.mesh.thinInstanceSetBuffer('color', this.colors, 4, false);
    // Never compile the material with zero instances (Babylon would leave the instance
    // colour attribute off for good): keep one instance and hide the mesh instead.
    this.mesh.thinInstanceCount = Math.max(1, this.count);
    this.mesh.isVisible = this.count > 0;
  }

  // Scale s, roll (Z), pitch (X), yaw (Y), translate; colour (linear).
  write(
    x: number,
    y: number,
    z: number,
    s: number,
    pitch: number,
    roll: number,
    yaw: number,
    r: number,
    g: number,
    b: number,
  ): void {
    writeTRS(this.matrices, this.count * 16, x, y, z, s, s, s, yaw, pitch, roll);
    const c = this.colors;
    if (c) {
      const p = this.count * 4;
      c[p] = r;
      c[p + 1] = g;
      c[p + 2] = b;
      c[p + 3] = 1;
    }
    this.count++;
  }

  // Flat footprint (blob shadow): scale (sx, 1, sz), yaw only.
  writeFlat(x: number, z: number, sx: number, sz: number, yaw: number): void {
    writeTRS(this.matrices, this.count * 16, x, 0, z, sx, 1, sz, yaw, 0, 0);
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

  dispose(): void {
    this.mesh.dispose();
  }
}

export class CrowdRenderer {
  // One batch per crowd slot (SLOT.*); the champion slot's batch is the champion body.
  private readonly batches: InstanceBatch[] = [];
  private readonly accent: InstanceBatch; // the bomber's firecrackers (bomber matrices)
  private readonly snowmanSnow: InstanceBatch; // the snowman's body (snowman matrices, white x frost)
  private readonly penguinTin: InstanceBatch; // the penguin's tin body (penguin matrices, white x frost)
  private readonly roll = new RollTracker();
  private readonly gait = new GaitTracker(); // wind-up robots and the Wind-up Robot champion
  private readonly robotKey: InstanceBatch; // the robot's key (own matrices, white x frost)
  private readonly windupTrim: InstanceBatch; // Wind-up Robot trim (windup slot matrices)
  private readonly windupKey: InstanceBatch; // its key (own matrices), also for a 'windup' loadout champion
  private champKey = false; // the champion slot holds the Wind-up Robot (draw its key too)
  private readonly keyAt = { x: 0, y: 0, z: 0 };
  private lastTime = Number.NaN;
  private readonly tint = new Float32Array(3);
  private trim: InstanceBatch | null = null;
  private readonly blobs: InstanceBatch;
  private readonly scene: Scene;
  private readonly look: Look;
  private readonly playerColor = teamColor('player');
  private readonly enemyColor = teamColor('enemy');
  private champion: ChampionId = 'sarge';
  private championToken = 0; // bumps on every champion swap, so a late sarge load is dropped
  private readonly styles: HopStyle[] = [];
  private disposed = false;

  constructor(scene: Scene, look: Look) {
    this.scene = scene;
    this.look = look;
    const lite = createSoldierFallback(scene, look);
    look.addShadowCaster(lite, 'crowd');
    look.receiveShadows(lite);
    this.batches[SLOT.rifleman] = new InstanceBatch(lite);
    this.batches[SLOT.knight] = new InstanceBatch(createSoldierVariantMesh(scene, look, 'knight'));
    this.batches[SLOT.sprinter] = new InstanceBatch(createSoldierVariantMesh(scene, look, 'sprinter'));
    this.batches[SLOT.bomber] = new InstanceBatch(createSoldierVariantMesh(scene, look, 'bomber'));
    this.accent = new InstanceBatch(createBomberAccentMesh(scene, look), false);
    this.batches[SLOT.giant] = new InstanceBatch(createGiantMesh(scene, look));
    this.batches[SLOT.snowball] = new InstanceBatch(createSnowballMesh(scene, look));
    const snowman = createSnowmanMeshes(scene, look);
    this.batches[SLOT.snowman] = new InstanceBatch(snowman.kit);
    this.snowmanSnow = new InstanceBatch(snowman.snow);
    const penguin = createPenguinMeshes(scene, look);
    this.batches[SLOT.penguin] = new InstanceBatch(penguin.kit);
    this.penguinTin = new InstanceBatch(penguin.tin);
    this.batches[SLOT.archer] = new InstanceBatch(createArcherMesh(scene, look));
    const robot = createWindupRobotMeshes(scene, look);
    this.batches[SLOT.robot] = new InstanceBatch(robot.tin);
    this.robotKey = new InstanceBatch(robot.key);
    const windup = createChampionWindup(scene, look);
    this.batches[SLOT.windup] = new InstanceBatch(windup.body);
    this.windupTrim = new InstanceBatch(windup.trim!, false);
    this.windupKey = new InstanceBatch(windup.key, false);
    const low = createChampionFallback(scene, look);
    this.batches[SLOT.champion] = new InstanceBatch(low.body);
    this.useTrim(low);
    const blob = createBlobShadowMesh(scene, 'crowdBlobs', 0.62);
    blob.alwaysSelectAsActiveMesh = true;
    blob.doNotSyncBoundingInfo = true;
    this.blobs = new InstanceBatch(blob, false);
    this.refreshStyles();

    void createSoldierMesh(scene, look).then((m) => {
      if (this.disposed) {
        m.dispose();
        return;
      }
      look.receiveShadows(m);
      this.batches[SLOT.rifleman].setMesh(m);
    });
    this.loadSarge();
  }

  private loadSarge(): void {
    const token = ++this.championToken;
    void createChampionMeshes(this.scene, this.look).then((c) => {
      if (this.disposed || token !== this.championToken) {
        c.body.dispose();
        c.trim?.dispose();
        return;
      }
      this.batches[SLOT.champion].setMesh(c.body);
      this.useTrim(c);
    });
  }

  private useTrim(c: ChampionMeshes): void {
    this.trim?.dispose();
    this.trim = c.trim ? new InstanceBatch(c.trim, false) : null;
  }

  private refreshStyles(): void {
    for (let s = 0; s < SLOT_COUNT; s++) this.styles[s] = slotStyle(s as CrowdSlot, this.champion);
  }

  // The loadout's champion model (call between battles). Sarge loads its full mesh
  // asynchronously behind the low-detail one; the tank, drummer and Wind-up Robot are
  // synchronous (the robot's key is drawn from the shared key batch).
  setChampion(id: ChampionId): void {
    if (id === this.champion) return;
    this.champion = id;
    this.champKey = id === 'windup';
    this.refreshStyles();
    if (id === 'sarge') {
      const low = createChampionFallback(this.scene, this.look);
      this.batches[SLOT.champion].setMesh(low.body);
      this.useTrim(low);
      this.loadSarge();
      return;
    }
    this.championToken++;
    let c: ChampionMeshes;
    if (id === 'windup') {
      const w = createChampionWindup(this.scene, this.look);
      w.key.dispose(); // the windup slot's key batch draws it
      c = w;
    } else c = id === 'tank' ? createChampionTank(this.scene, this.look) : createChampionDrummer(this.scene, this.look);
    this.batches[SLOT.champion].setMesh(c.body);
    this.useTrim(c);
  }

  get championId(): ChampionId {
    return this.champion;
  }

  // Crowd batches drawn in the last frame (main pass; the shadow pass repeats the figures).
  get drawBatches(): number {
    let n = 0;
    for (const b of this.batches) if (b.count > 0) n++;
    if (this.accent.count > 0) n++;
    if (this.snowmanSnow.count > 0) n++;
    if (this.penguinTin.count > 0) n++;
    if (this.robotKey.count > 0) n++;
    if (this.windupTrim.count > 0) n++;
    if (this.windupKey.count > 0) n++;
    if (this.trim && this.trim.count > 0) n++;
    if (this.blobs.count > 0) n++;
    return n;
  }

  // enemyFrozen: BattleState.enemyFrozen (seconds of Blizzard freeze left; 0 / absent = none).
  update(view: VariantView, time: number, enemyFrozen = 0): void {
    const n = view.count;
    const trim = this.trim;
    const blobs = this.look.settings.crowdShadows ? null : this.blobs;
    const batches = this.batches;
    for (let s = 0; s < SLOT_COUNT; s++) {
      batches[s].ensureCapacity(n);
      batches[s].count = 0;
    }
    this.accent.ensureCapacity(n);
    this.accent.count = 0;
    this.snowmanSnow.ensureCapacity(n);
    this.snowmanSnow.count = 0;
    this.penguinTin.ensureCapacity(n);
    this.penguinTin.count = 0;
    this.robotKey.ensureCapacity(n);
    this.robotKey.count = 0;
    this.windupTrim.ensureCapacity(n);
    this.windupTrim.count = 0;
    this.windupKey.ensureCapacity(n);
    this.windupKey.count = 0;
    const dt = Number.isNaN(this.lastTime) ? 0 : Math.max(0, Math.min(0.1, time - this.lastTime));
    this.lastTime = time;
    const gait = this.gait;
    gait.ensureCapacity(n);
    const key = this.keyAt;
    trim?.ensureCapacity(n);
    if (trim) trim.count = 0;
    blobs?.ensureCapacity(n);
    this.blobs.count = 0;
    const pc = this.playerColor;
    const ec = this.enemyColor;
    const cb = CHAMPION_BRIGHT;
    // Frost on the enemy: still figures, tinted colours (exactly the team colour at 0).
    const frost = frostAmount(enemyFrozen);
    const thaw = 1 - frost;
    const tint = this.tint;
    frostColor(ec.r, ec.g, ec.b, frost, tint);
    const er = tint[0];
    const eg = tint[1];
    const eb = tint[2];
    frostColor(1, 1, 1, frost, tint);
    const wr = tint[0];
    const wg = tint[1];
    const wb = tint[2];
    const roll = this.roll;
    roll.ensureCapacity(n);
    const { posX, posZ, team, kind, radius } = view;
    const variant = view.variant;
    const slide = view.slide;
    for (let i = 0; i < n; i++) {
      const slot = crowdSlot(kind[i], variant ? variant[i] : 0);
      const s = crowdScale(slot, radius[i]);
      const x = posX[i];
      const z = posZ[i];
      const player = team[i] === Team.Player;
      const yaw = player ? PLAYER_YAW : ENEMY_YAW;
      const batch = batches[slot];
      const v = SHADES[i & 255];
      if (slot === SLOT.snowball) {
        // Rolls by the distance it travels; no hop, no three-quarter turn.
        roll.step(i, x, z, radius[i]);
        batch.write(x, s, z, s, roll.pitch, roll.roll, 0, v, v, v);
        blobs?.writeFlat(x, z, SNOWBALL_BLOB * s, SNOWBALL_BLOB * s, 0);
        continue;
      }
      roll.clear(i);
      const st = this.styles[slot];
      const wound = slot === SLOT.robot || slot === SLOT.windup || (slot === SLOT.champion && this.champKey);
      // Phase from time and position: stable per unit (the sim reorders its arrays) and
      // varied across the crowd, so the army hops along out of step. Frozen enemies stand.
      const live = player ? 1 : thaw;
      const sv = slide ? slide[i] : 0;
      const skid = sv === 0 ? 0 : sv > SKID_FULL ? 1 : sv < -SKID_FULL ? -1 : sv / SKID_FULL;
      const step = live * (1 - (skid < 0 ? -skid : skid));
      let sn = Math.sin(time * HOP_SPEED * st.speed + z * 1.9 + x * 3.7);
      let walk = step;
      if (wound) {
        // Wind-up toys: a clipped, cam-like rock while walking, still in their pauses.
        gait.step(i, x, z, dt, live);
        walk *= gait.move;
        sn = tinRock(time * HOP_SPEED * st.speed + z * 1.9 + x * 3.7);
      } else gait.clear(i);
      const hop = Math.abs(sn) * walk;
      const y = hop * HOP_HEIGHT * st.height * s;
      const lean = hop * HOP_LEAN * st.lean;
      const rl = sn * WADDLE * st.waddle * walk - skid * SKID_TILT;
      if (slot === SLOT.champion || slot === SLOT.windup) {
        if (player) batch.write(x, y, z, s, lean, rl, yaw, pc.r * cb, pc.g * cb, pc.b * cb);
        else batch.write(x, y, z, s, lean, rl, yaw, er * cb, eg * cb, eb * cb);
        if (slot === SLOT.windup) this.windupTrim.write(x, y, z, s, lean, rl, yaw, 1, 1, 1);
        else trim?.write(x, y, z, s, lean, rl, yaw, 1, 1, 1);
        if (wound) {
          rotateLocal(WINDUP_KEY.x * s, WINDUP_KEY.y * s, WINDUP_KEY.z * s, yaw, lean, rl, key);
          this.windupKey.write(x + key.x, y + key.y, z + key.z, s, lean, rl + gait.key, yaw, 1, 1, 1);
        }
        blobs?.writeFlat(x, z, CHAMP_BLOB.x * s, CHAMP_BLOB.z * s, yaw);
        continue;
      }
      // The tin robot is fully printed in its vertex colours: white (x frost), not tan.
      if (slot === SLOT.robot) batch.write(x, y, z, s, lean, rl, yaw, wr * v, wg * v, wb * v);
      else if (player) batch.write(x, y, z, s, lean, rl, yaw, pc.r * v, pc.g * v, pc.b * v);
      else batch.write(x, y, z, s, lean, rl, yaw, er * v, eg * v, eb * v);
      if (slot === SLOT.bomber) this.accent.write(x, y, z, s, lean, rl, yaw, 1, 1, 1);
      else if (slot === SLOT.snowman) this.snowmanSnow.write(x, y, z, s, lean, rl, yaw, wr * v, wg * v, wb * v);
      else if (slot === SLOT.penguin) this.penguinTin.write(x, y, z, s, lean, rl, yaw, wr, wg, wb);
      else if (slot === SLOT.robot) {
        rotateLocal(ROBOT_KEY.x * s, ROBOT_KEY.y * s, ROBOT_KEY.z * s, yaw, lean, rl, key);
        this.robotKey.write(x + key.x, y + key.y, z + key.z, s, lean, rl + gait.key, yaw, wr, wg, wb);
      }
      const fb = BLOB[slot] ?? MOB_BLOB;
      blobs?.writeFlat(x, z, fb.x * s, fb.z * s, yaw);
    }
    for (let s = 0; s < SLOT_COUNT; s++) batches[s].commit();
    this.accent.commit();
    this.snowmanSnow.commit();
    this.penguinTin.commit();
    this.robotKey.commit();
    this.windupTrim.commit();
    this.windupKey.commit();
    trim?.commit();
    this.blobs.commit();
  }

  dispose(): void {
    this.disposed = true;
    for (const b of this.batches) b.dispose();
    this.accent.dispose();
    this.snowmanSnow.dispose();
    this.penguinTin.dispose();
    this.robotKey.dispose();
    this.windupTrim.dispose();
    this.windupKey.dispose();
    this.trim?.dispose();
    this.blobs.dispose();
  }
}
