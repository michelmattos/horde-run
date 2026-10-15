// Home base: the green army's toy village on a corner of the bedroom rug, rebuilt with
// coins between battles. A separate Babylon Scene on the shared engine, dressed with the
// shared look (warm key light, soft shadows, the bedroom HDR environment, the post grade)
// and the bedroom floor, rug and room from the battle environment. The five buildings
// (src/home/models/village.ts) stand at their tiers, a dozen army men stand about, and a
// few toys lie on the floorboards beyond the rug. The camera is fixed (a portrait-framed
// 3/4 view, refitted only when the screen or the sheet changes size) and never moves on
// its own. The HTML overlay (homeSheet.ts) holds the header, the building cards and a tap
// layer: tapping a building in 3D selects its card, and the selected plot gets a yellow
// outline on the rug.
//
// Rendering stops when idle ('stop rendering in static menus'): needsFrame() is true only
// while something is loading or settling (the soldiers' gentle idle for a few seconds
// after show()), a build animation or confetti is running, or a change waits for a frame.
//
// INTEGRATION
//   const home = createHomeBase(engine, appRoot, { onBuild(id) {...}, onBack() {...} });
//   home.show(view);                 // HomeView; call again after a purchase: the building
//                                    // that went up drops in its new pieces with confetti
//   // in the render loop, while home.visible:
//   if (home.needsFrame()) { home.frame(dt); home.scene.render(); }
//   home.hide();                     // then render the battle scene again
import type { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import '@babylonjs/core/Culling/ray';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { buildMesh, createLook, srgb, teamColor } from '../render/look/index.ts';
import type { Look } from '../render/look/index.ts';
import { createEnvironment } from '../render/models/environment.ts';
import type { EnvironmentModel } from '../render/models/environment.ts';
import { createSoldierMesh } from '../render/models/soldier.ts';
import { createPropKit } from '../render/models/props.ts';
import type { PropKit } from '../render/models/props.ts';
import type { HomeView } from '../meta/types.ts';
import { createVillage } from './models/village.ts';
import { createConfetti } from './models/confetti.ts';
import { createHomeSheet } from './homeSheet.ts';
import { grownBuildings, tiersOf } from './homeLogic.ts';
import type { TierMap } from './homeLogic.ts';
import { SOLDIER_SPOTS, frameVillage, idlePose, pickBuilding } from './villageMath.ts';
import { PLOTS, isBuildingId } from './villagePieces.ts';
import type { BuildingId } from './villagePieces.ts';

export interface HomeBase {
  show(v: HomeView): void;
  hide(): void;
  readonly visible: boolean;
  readonly scene: Scene;
  frame(dt: number): void;
  needsFrame(): boolean;
  dispose(): void;
}

export interface HomeBaseOptions {
  onBuild(id: string): void;
  onBack(): void;
}

const SETTLE_SECONDS = 3; // soldiers' idle after show(), fading to rest
const SELECT_COLOR = '#ffc531';

// Toys on the floorboards beyond the rug (kind, variant, x, z, yaw, scale, colour).
const PROPS: [Parameters<PropKit['add']>[0], number, number, number, number, number, number][] = [
  ['block', 2, -8.6, 12.5, 0.4, 1, 0],
  ['crayon', 2, 8.4, 11.0, -0.5, 1, 2],
  ['book', 1, -9.2, 5.2, 1.2, 1, 3],
  ['car', 0, 9.0, 4.0, -2.2, 1, 1],
  ['marble', 1, 8.1, -1.5, 0, 1, 4],
  ['brick', 2, -8.4, -1.0, 0.7, 1, 5],
  ['sock', 0, 9.6, 14.5, 2.4, 1, 0],
];

// A flat rounded-rectangle outline on the rug around a plot (the selection marker).
function outline(w: number, d: number, r: number, band: number): VertexData {
  const pts: [number, number][] = [];
  const corner = (cx: number, cz: number, a0: number): void => {
    for (let i = 0; i <= 6; i++) {
      const a = a0 + (i / 6) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
  };
  const hx = w / 2 - r;
  const hz = d / 2 - r;
  corner(hx, hz, 0);
  corner(-hx, hz, Math.PI / 2);
  corner(-hx, -hz, Math.PI);
  corner(hx, -hz, Math.PI * 1.5);
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const [x, z] = pts[i];
    // Offset across the band along the outline's normal (from its neighbours' tangent).
    const [px, pz] = pts[(i + n - 1) % n];
    const [qx, qz] = pts[(i + 1) % n];
    const tl = Math.hypot(qx - px, qz - pz) || 1;
    const ox = (qz - pz) / tl;
    const oz = -(qx - px) / tl;
    pos.push(x - (ox * band) / 2, 0.02, z - (oz * band) / 2, x + (ox * band) / 2, 0.02, z + (oz * band) / 2);
    nrm.push(0, 1, 0, 0, 1, 0);
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    const b = ((i + 1) % n) * 2;
    idx.push(a, b, b + 1, a, b + 1, a + 1);
  }
  const vd = new VertexData();
  vd.positions = pos;
  vd.normals = nrm;
  vd.indices = idx;
  return vd;
}

export function createHomeBase(engine: Engine, root: HTMLElement, opts: HomeBaseOptions): HomeBase {
  const scene = new Scene(engine);
  // Taps reach the village through the overlay's tap layer, never the shared canvas.
  scene.detachControl();
  scene.skipPointerMovePicking = true;
  const camera = new TargetCamera('homeCamera', new Vector3(0, 30, -25), scene);
  camera.minZ = 1;
  camera.maxZ = 300;
  scene.activeCamera = camera;
  const look: Look = createLook(scene, { camera, remember: true, autoQuality: false });
  look.fitShadows({ minX: -8, maxX: 8, minZ: -6.5, maxZ: 11, maxY: 5 });

  let dirty = 4; // frames still to render after a change
  let pendingLoads = 0;
  const loaded = (): void => {
    pendingLoads = Math.max(0, pendingLoads - 1);
    dirty = Math.max(dirty, 4);
  };
  const track = (p: Promise<unknown>): void => {
    pendingLoads++;
    p.then(loaded, loaded);
  };
  track(look.ready);

  const env: EnvironmentModel = createEnvironment(scene, look, { laneWidth: 13, laneLength: 13, zMin: -6, zMax: 10 });
  scene.clearColor = env.clearColor;
  track(env.ready);

  const confetti = createConfetti(scene, look);
  const village = createVillage(scene, look, {
    onLanded(_id, x, y, z) {
      confetti.burst(x, y, z);
    },
  });

  // Selection outline: an unlit warm-yellow band on the rug around the selected plot.
  const ringMat = new StandardMaterial('homeSelect', scene);
  ringMat.disableLighting = true;
  ringMat.emissiveColor = srgb(SELECT_COLOR);
  ringMat.alpha = 0.92;
  ringMat.backFaceCulling = false;
  let ring: Mesh | null = null;

  // Army men: the battle's soldier mesh, thin-instanced in army green.
  let soldiers: Mesh | null = null;
  const soldierMatrices = new Float32Array(SOLDIER_SPOTS.length * 16);
  const mtx = new Matrix();
  const quat = new Quaternion();
  const scl = new Vector3();
  const pos = new Vector3();
  const writeSoldiers = (time: number, settle: number): void => {
    if (!soldiers) return;
    SOLDIER_SPOTS.forEach((s, i) => {
      const pose = idlePose(i, time, settle);
      Quaternion.RotationYawPitchRollToRef(s.yaw + pose.yaw, pose.lean, 0, quat);
      scl.set(1, pose.sy, 1);
      pos.set(s.x, 0, s.z);
      Matrix.ComposeToRef(scl, quat, pos, mtx);
      mtx.copyToArray(soldierMatrices, i * 16);
    });
    soldiers.thinInstanceBufferUpdated('matrix');
  };
  track(
    createSoldierMesh(scene, look).then((m) => {
      if (disposed) {
        m.dispose();
        return;
      }
      soldiers = m;
      const colors = new Float32Array(SOLDIER_SPOTS.length * 4);
      const c = teamColor('player');
      SOLDIER_SPOTS.forEach((_, i) => {
        const k = 0.97 + ((i * 37) % 7) * 0.01; // ±4% plastic batch variation
        colors.set([c.r * k, c.g * k, c.b * k, 1], i * 4);
      });
      m.thinInstanceSetBuffer('matrix', soldierMatrices, 16, false);
      m.thinInstanceSetBuffer('color', colors, 4, true);
      writeSoldiers(time, settle / SETTLE_SECONDS);
    }),
  );

  // Floor toys: their kit bakes its geometry once (a few hundred ms), so it is built after
  // the first frames are on screen.
  let props: PropKit | null = null;
  let propTimer = 0;
  const buildProps = (): void => {
    if (props || disposed) return;
    props = createPropKit(scene, look);
    props.begin();
    for (const [kind, variant, x, z, yaw, s, col] of PROPS) props.add(kind, variant, x, z, yaw, s, col);
    props.commit();
    dirty = Math.max(dirty, 4);
  };

  let visible = false;
  let disposed = false;
  let time = 0;
  let settle = 0;
  let animating = false;
  let confettiOn = false;
  let readyOnce = false;
  let shownTiers: TierMap | null = null;
  let selected: BuildingId | null = null;

  function setSelected(id: BuildingId | null, scroll: boolean): void {
    selected = id;
    sheet.select(id, scroll);
    ring?.dispose();
    ring = null;
    if (id) {
      const p = PLOTS[id];
      ring = buildMesh(scene, 'homeSelectRing', outline(p.w + 0.5, p.d + 0.5, 0.45, 0.12), ringMat);
      ring.position.set(p.x, 0, p.z);
    }
    dirty = Math.max(dirty, 2);
  }

  function refit(): void {
    const w = engine.getRenderWidth();
    const h = engine.getRenderHeight();
    if (w <= 0 || h <= 0) return;
    const f = frameVillage(w / h, sheet.band());
    camera.position.set(f.position[0], f.position[1], f.position[2]);
    camera.setTarget(new Vector3(f.target[0], f.target[1], f.target[2]));
    camera.fov = f.fov;
    dirty = Math.max(dirty, 3);
  }

  const sheet = createHomeSheet(root, {
    onBuild: (id) => opts.onBuild(id),
    onBack: () => opts.onBack(),
    onSelect: (id) => {
      if (isBuildingId(id)) setSelected(id, false);
    },
    onTap: (cx, cy) => {
      const rect = engine.getRenderingCanvasClientRect();
      if (!rect) return;
      const ray = scene.createPickingRay(cx - rect.left, cy - rect.top, Matrix.Identity(), camera);
      const hit = pickBuilding(
        [ray.origin.x, ray.origin.y, ray.origin.z],
        [ray.direction.x, ray.direction.y, ray.direction.z],
        village.tiers,
      );
      if (hit) setSelected(hit, true);
    },
  });

  const onResize = (): void => {
    if (visible) refit();
  };
  window.addEventListener('resize', onResize);
  const resizeObs = engine.onResizeObservable.add(onResize);

  return {
    scene,
    get visible() {
      return visible;
    },
    show(v: HomeView) {
      const tiers = tiersOf(v.buildings);
      const grown = grownBuildings(shownTiers, tiers);
      sheet.show(v);
      // Grown buildings drop in their new pieces; anything else (first show, an imported
      // save) snaps straight to its tier.
      const started = village.setTiers(tiers, grown.length > 0);
      if (started.length > 0) {
        animating = true;
        setSelected(started[0], true);
      } else if (!selected && v.buildings[0] && isBuildingId(v.buildings[0].id)) {
        setSelected(v.buildings[0].id, false);
      } else sheet.select(selected, false);
      shownTiers = tiers;
      const wasVisible = visible;
      visible = true;
      if (!wasVisible) {
        settle = SETTLE_SECONDS;
        // Let the sheet lay out before measuring the band the village must fit in.
        requestAnimationFrame(() => {
          if (visible) refit();
        });
        refit();
        if (!props) propTimer = window.setTimeout(buildProps, 600);
      }
      dirty = Math.max(dirty, 3);
    },
    hide() {
      visible = false;
      sheet.hide();
      clearTimeout(propTimer);
    },
    frame(dt: number) {
      const step = Math.max(0, Math.min(dt, 0.1));
      time += step;
      if (settle > 0) {
        settle = Math.max(0, settle - step);
        writeSoldiers(time, settle / SETTLE_SECONDS);
      }
      if (animating) animating = village.update(step);
      confettiOn = confetti.update(step);
      if (dirty > 0) dirty--;
      if (!readyOnce && scene.isReady()) {
        readyOnce = true;
        dirty = Math.max(dirty, 4); // a few more frames for the shadow cache and textures
      }
    },
    needsFrame() {
      if (!visible || disposed) return false;
      return dirty > 0 || settle > 0 || animating || confettiOn || pendingLoads > 0 || !readyOnce;
    },
    dispose() {
      disposed = true;
      visible = false;
      clearTimeout(propTimer);
      window.removeEventListener('resize', onResize);
      resizeObs.remove();
      sheet.dispose();
      props?.dispose();
      soldiers?.dispose();
      confetti.dispose();
      village.dispose();
      ring?.dispose();
      ringMat.dispose();
      env.dispose();
      look.dispose();
      scene.dispose();
    },
  };
}
