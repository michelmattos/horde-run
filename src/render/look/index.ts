// The shared look of Horde Run: lighting rig, shadows, image-based environment, colour
// grade and post-processing, quality tiers, plus re-exports of the material recipes,
// palette and modelling helpers. One Look per Scene. See docs/art-direction.md for the
// intent and src/render/models/README.md for how models use it.
//
//   const look = createLook(scene, { camera });
//   look.fitShadows({ minX: -8, maxX: 8, minZ: -4, maxZ: 70 });   // per level
//   look.addShadowCaster(mesh);             // static or animated pieces
//   look.addShadowCaster(crowdMesh, 'crowd'); // thin-instanced crowds (dropped on 'low')
//   look.receiveShadows(floorMesh);
//   // per frame: if (look.sample(dt)) {...}  (auto-drops quality when frames run long)
//
// Lighting: warm late-afternoon sun through a window up-left of the lane (key, casts the
// only shadows), a cool sky / warm floor-bounce hemispheric fill, and the HDRI for
// reflections and soft ambient. The camera is never moved by anything here.
import type { Scene } from '@babylonjs/core/scene';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Material } from '@babylonjs/core/Materials/material';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture';
import { StaticShadowCache } from './shadowCache.ts';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import type { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import { HEX, lin, srgb } from './palette.ts';
import { loadEnvironment } from './environment.ts';
import { applyGrade, createPipeline } from './post.ts';
import {
  QUALITY_SETTINGS,
  QualityGovernor,
  nextPostFallback,
  parseQuality,
  readSavedRender,
  withPostFallback,
  writeSavedRender,
} from './quality.ts';
import type { PostFallback, QualityLevel, QualitySettings } from './quality.ts';

export * from './palette.ts';
export * from './materials.ts';
export * from './geometry.ts';
export { createBlobShadowMesh, BLOB_Y } from './blobShadow.ts';
export { surfaceTextures, radialTexture } from './textures.ts';
export type { SurfaceKind, SurfaceTextures } from './textures.ts';
export { QUALITY_SETTINGS, QualityGovernor, parseQuality, readSavedRender, writeSavedRender } from './quality.ts';
export type { PostFallback, QualityLevel, QualitySettings } from './quality.ts';
export { BlankWatch, isBlankSample } from './blankWatch.ts';
export { GRADE } from './post.ts';

// Sun direction (travels down, to the right and away from the camera): lit faces point
// at the camera, shadows fall up-right of each toy. Elevation ~45 degrees.
export const KEY_DIRECTION = new Vector3(0.55, -0.7, 0.45).normalize();
export const LIGHT = {
  keyIntensity: 2.6,
  fillIntensity: 0.45,
  shadowDarkness: 0.0, // 0 = the key is fully blocked; the fill and IBL keep shadows warm
  shadowBias: 0.0015,
  shadowNormalBias: 0.012,
};

export type CasterKind = 'static' | 'crowd';

export interface ShadowBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  maxY?: number; // tallest caster (default 6)
}

export interface LookOptions {
  camera?: Camera; // attach the post pipeline now (or later with setCamera)
  quality?: QualityLevel; // tier ceiling (default high); ?quality=low|medium|high in the URL overrides and locks it
  remember?: boolean; // start from the tier the last session settled on, and save changes (default false)
  environment?: boolean; // load the HDRI (default true)
  autoQuality?: boolean; // let sample() drop the tier (default true)
}

export interface Look {
  readonly scene: Scene;
  readonly key: DirectionalLight;
  readonly fill: HemisphericLight;
  readonly shadows: ShadowGenerator;
  readonly quality: QualityLevel;
  readonly settings: QualitySettings;
  readonly environment: BaseTexture | null;
  readonly ready: Promise<void>; // resolves when the environment has loaded (or failed)
  readonly pipeline: DefaultRenderingPipeline | null;
  addShadowCaster(mesh: AbstractMesh, kind?: CasterKind): void;
  removeShadowCaster(mesh: AbstractMesh): void;
  receiveShadows(mesh: AbstractMesh, on?: boolean): void;
  fitShadows(b: ShadowBounds): void;
  setCamera(camera: Camera): void;
  setQuality(q: QualityLevel): void;
  onQualityChange(cb: (q: QualityLevel) => void): () => void;
  sample(dt: number): boolean; // feed real frame seconds; true when the tier changed
  warmUp(seconds?: number): void; // ignore frame times after a level load
  // Applies the parts of a tier change that recompile shaders (PCF filter, post pipeline
  // on/off), deferred from a mid-battle step. Call at a level load, behind the loading.
  applyPending(): void;
  contextRestored(): void; // the WebGL context came back: rebuild the shadow cache
  // The canvas stayed blank with the current pipeline: switch its riskiest part off for
  // this device (remembered) and rebuild. False when there is nothing left to drop.
  degradePost(): boolean;
  readonly postFallback: PostFallback | null;
  readonly locked: boolean; // the tier was forced from the URL
  material<T extends Material>(key: string, make: () => T): T; // shared per-look material cache
  dispose(): void;
}

const QUALITY_ORDER_INDEX: Record<QualityLevel, number> = { low: 0, medium: 1, high: 2 };

function filterQuality(f: QualitySettings['shadowFilter']): number {
  return f === 'medium' ? ShadowGenerator.QUALITY_MEDIUM : ShadowGenerator.QUALITY_LOW;
}

function urlQuality(): QualityLevel | null {
  try {
    return parseQuality(new URLSearchParams(location.search).get('quality'));
  } catch {
    return null;
  }
}

export function createLook(scene: Scene, opts: LookOptions = {}): Look {
  return new LookImpl(scene, opts);
}

class LookImpl implements Look {
  readonly scene: Scene;
  readonly key: DirectionalLight;
  readonly fill: HemisphericLight;
  shadows: ShadowGenerator;
  environment: BaseTexture | null = null;
  readonly ready: Promise<void>;
  pipeline: DefaultRenderingPipeline | null = null;
  private camera: Camera | null = null;
  private readonly governor: QualityGovernor;
  private readonly casters = new Map<AbstractMesh, CasterKind>();
  private readonly listeners = new Set<(q: QualityLevel) => void>();
  private readonly cache = new Map<string, Material>();
  private readonly auto: boolean;
  private readonly remember: boolean;
  private readonly saveFallback: boolean;
  postFallback: PostFallback | null;
  private readonly cacheStatic: StaticShadowCache;
  // What the shader-affecting parts are currently built for (they lag the tier mid-battle).
  private appliedFilter: QualitySettings['shadowFilter'];
  private appliedPost: boolean;
  private disposed = false;

  constructor(scene: Scene, opts: LookOptions) {
    this.scene = scene;
    const forced = urlQuality();
    const ceiling = opts.quality ?? 'high';
    this.remember = !forced && !!opts.remember;
    const saved = this.remember ? readSavedRender().quality : undefined;
    // A remembered tier never exceeds the ceiling; the governor can still retry upward once.
    const start = saved && QUALITY_ORDER_INDEX[saved] < QUALITY_ORDER_INDEX[ceiling] ? saved : ceiling;
    this.governor = new QualityGovernor(forced ?? start, !!forced, forced ?? ceiling);
    this.auto = opts.autoQuality ?? true;
    // A pipeline that left the canvas blank on this device stays off, even on a URL-forced tier.
    this.saveFallback = !!opts.remember;
    this.postFallback = opts.remember ? (readSavedRender().post ?? null) : null;
    this.appliedFilter = this.settings.shadowFilter;
    this.appliedPost = this.settings.postProcess;
    this.cacheStatic = new StaticShadowCache(scene);
    scene.clearColor = Color4.FromColor3(srgb(HEX.wall), 1);
    scene.ambientColor.set(0, 0, 0);

    this.key = new DirectionalLight('lookKey', KEY_DIRECTION.clone(), scene);
    this.key.diffuse = lin(HEX.sun).scale(1 / Math.max(lin(HEX.sun).r, 1e-3)); // normalised warm tint
    this.key.specular = this.key.diffuse.clone();
    this.key.intensity = LIGHT.keyIntensity;
    this.key.autoUpdateExtends = false;
    this.key.shadowOrthoScale = 0;
    this.key.shadowMinZ = 1;
    this.key.shadowMaxZ = 200;

    this.fill = new HemisphericLight('lookFill', new Vector3(-0.2, 1, -0.3), scene);
    this.fill.diffuse = lin(HEX.sky).scale(1 / Math.max(lin(HEX.sky).b, 1e-3));
    this.fill.groundColor = lin(HEX.bounce).scale(0.6 / Math.max(lin(HEX.bounce).r, 1e-3));
    this.fill.specular.set(0, 0, 0);
    this.fill.intensity = LIGHT.fillIntensity;

    applyGrade(scene);
    this.shadows = this.makeShadows();
    this.cacheStatic.attach(this.shadows);
    this.fitShadows({ minX: -10, maxX: 10, minZ: -6, maxZ: 70 });
    if (opts.camera) this.setCamera(opts.camera);

    this.ready =
      opts.environment === false
        ? Promise.resolve()
        : loadEnvironment(scene).then((tex) => {
            if (this.disposed) {
              tex?.dispose();
              return;
            }
            this.environment = tex;
          });
  }

  get quality(): QualityLevel {
    return this.governor.level;
  }

  get settings(): QualitySettings {
    return withPostFallback(QUALITY_SETTINGS[this.governor.level], this.postFallback);
  }

  get locked(): boolean {
    return this.governor.locked;
  }

  // One generator for the session: tier changes resize its map and change its caster
  // list in place (same shader defines, no recompile).
  private makeShadows(): ShadowGenerator {
    const q = this.settings;
    const sg = new ShadowGenerator(q.shadowMapSize, this.key);
    sg.usePercentageCloserFiltering = true;
    sg.filteringQuality = filterQuality(this.appliedFilter);
    sg.bias = LIGHT.shadowBias;
    sg.normalBias = LIGHT.shadowNormalBias;
    sg.setDarkness(LIGHT.shadowDarkness);
    sg.transparencyShadow = false;
    sg.frustumEdgeFalloff = 0.15; // fade out at the edge of the fitted area instead of a hard cut
    const map = sg.getShadowMap();
    if (map) map.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONEVERYFRAME;
    for (const [mesh, kind] of this.casters) if (kind === 'static' || q.crowdShadows) sg.addShadowCaster(mesh, false);
    return sg;
  }

  addShadowCaster(mesh: AbstractMesh, kind: CasterKind = 'static'): void {
    this.casters.set(mesh, kind);
    if (kind === 'static' || this.settings.crowdShadows) this.shadows.addShadowCaster(mesh, false);
    if (kind === 'static') this.cacheStatic.addStatic(mesh);
    mesh.onDisposeObservable.addOnce(() => this.removeShadowCaster(mesh));
  }

  removeShadowCaster(mesh: AbstractMesh): void {
    this.casters.delete(mesh);
    this.cacheStatic.remove(mesh);
    this.shadows.removeShadowCaster(mesh, false);
  }

  receiveShadows(mesh: AbstractMesh, on = true): void {
    mesh.receiveShadows = on;
    const m = mesh.material;
    if (m?.isFrozen) {
      // Frozen materials skip define updates: thaw for one frame so the shadow code compiles in.
      m.unfreeze();
      this.scene.onAfterRenderObservable.addOnce(() => m.freeze());
    }
  }

  // Fit the sun's orthographic shadow frustum around the area that matters (the lane, its
  // bases, plus a margin for scenery). Smaller area = sharper shadows.
  fitShadows(b: ShadowBounds): void {
    const maxY = b.maxY ?? 6;
    const center = new Vector3((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
    const dir = this.key.direction.clone().normalize();
    const pos = center.subtract(dir.scale(100));
    this.key.position.copyFrom(pos);
    const view = Matrix.LookAtLH(pos, pos.add(dir), Vector3.Up());
    let l = Infinity,
      r = -Infinity,
      bo = Infinity,
      t = -Infinity,
      zn = Infinity,
      zf = -Infinity;
    const v = new Vector3();
    for (const x of [b.minX, b.maxX])
      for (const y of [0, maxY])
        for (const z of [b.minZ, b.maxZ]) {
          Vector3.TransformCoordinatesFromFloatsToRef(x, y, z, view, v);
          l = Math.min(l, v.x);
          r = Math.max(r, v.x);
          bo = Math.min(bo, v.y);
          t = Math.max(t, v.y);
          zn = Math.min(zn, v.z);
          zf = Math.max(zf, v.z);
        }
    this.key.orthoLeft = l;
    this.key.orthoRight = r;
    this.key.orthoBottom = bo;
    this.key.orthoTop = t;
    this.key.shadowMinZ = Math.max(0.1, zn - 2);
    this.key.shadowMaxZ = zf + 2;
    this.cacheStatic.invalidate();
  }

  setCamera(camera: Camera): void {
    this.camera = camera;
    this.rebuildPipeline();
  }

  private rebuildPipeline(): void {
    this.pipeline?.dispose();
    this.pipeline = null;
    if (this.camera) this.pipeline = createPipeline(this.scene, this.camera, this.settings);
    else this.scene.imageProcessingConfiguration.vignetteEnabled = false;
  }

  setQuality(q: QualityLevel): void {
    if (q === this.governor.level && this.shadows) return;
    this.governor.level = q;
    this.applyQuality(true);
  }

  // Live parts (no shader recompiles) apply at once: the map size, which casters draw
  // into it, MSAA / FXAA / bloom on the existing pipeline. The parts that change material
  // defines (PCF filter quality, the pipeline existing at all, which moves tone mapping
  // between the materials and the post pass) wait for applyPending() at the next level
  // load unless `heavy`, so a struggling phone never recompiles ~50 materials mid-battle.
  private applyQuality(heavy: boolean): void {
    const q = this.settings;
    const sg = this.shadows;
    if (sg.mapSize !== q.shadowMapSize) {
      sg.mapSize = q.shadowMapSize;
      this.cacheStatic.attach(sg);
    }
    for (const [mesh, kind] of this.casters) {
      if (kind !== 'crowd') continue;
      if (q.crowdShadows) sg.addShadowCaster(mesh, false);
      else sg.removeShadowCaster(mesh, false);
    }
    if (heavy) {
      if (this.appliedFilter !== q.shadowFilter) {
        this.appliedFilter = q.shadowFilter;
        sg.filteringQuality = filterQuality(q.shadowFilter);
      }
      if (this.appliedPost !== q.postProcess) {
        this.appliedPost = q.postProcess;
        this.rebuildPipeline();
      } else this.tunePipeline();
    } else this.tunePipeline();
    this.cacheStatic.invalidate();
    if (this.remember) writeSavedRender({ quality: this.governor.level });
    for (const cb of this.listeners) cb(this.governor.level);
  }

  // In-place pipeline changes for the current tier (post-process shaders only).
  private tunePipeline(): void {
    const p = this.pipeline;
    if (!p) return;
    const q = this.settings;
    const post = q.postProcess; // false: a deferred drop to 'low', keep the pass as cheap as possible
    const webgl2 = this.scene.getEngine().version >= 2;
    const samples = post && webgl2 ? q.msaa : 1;
    if (p.samples !== samples) p.samples = samples;
    const fxaa = post && (q.fxaa || (q.msaa > 1 && !webgl2));
    if (p.fxaaEnabled !== fxaa) p.fxaaEnabled = fxaa;
    const bloom = post && q.bloom;
    if (p.bloomEnabled !== bloom) p.bloomEnabled = bloom;
  }

  applyPending(): void {
    const q = this.settings;
    if (this.appliedFilter === q.shadowFilter && this.appliedPost === q.postProcess) return;
    this.applyQuality(true);
  }

  degradePost(): boolean {
    const next = nextPostFallback(QUALITY_SETTINGS[this.governor.level], this.postFallback);
    if (!next) return false;
    console.warn(`look: canvas stayed blank with the post pipeline, falling back to '${next}'`);
    this.postFallback = next;
    if (this.saveFallback) writeSavedRender({ post: next });
    this.applyQuality(true);
    return true;
  }

  contextRestored(): void {
    this.cacheStatic.attach(this.shadows);
    this.cacheStatic.invalidate();
  }

  onQualityChange(cb: (q: QualityLevel) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  sample(dt: number): boolean {
    if (!this.auto) return false;
    if (!this.governor.sample(dt)) return false;
    this.applyQuality(false);
    return true;
  }

  warmUp(seconds = 2): void {
    this.governor.warmUp(seconds);
  }

  material<T extends Material>(key: string, make: () => T): T {
    let m = this.cache.get(key) as T | undefined;
    if (!m || m.getScene() !== this.scene) {
      m = make();
      this.cache.set(key, m);
    }
    return m;
  }

  dispose(): void {
    this.disposed = true;
    this.pipeline?.dispose();
    this.cacheStatic.dispose();
    this.shadows.dispose();
    this.key.dispose();
    this.fill.dispose();
    for (const m of this.cache.values()) m.dispose();
    this.cache.clear();
    this.environment?.dispose();
    this.listeners.clear();
  }
}
