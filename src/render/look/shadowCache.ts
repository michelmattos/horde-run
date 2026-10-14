// Static shadow caching for the sun's shadow map. Most casters never move (the forts,
// the props beside the rug, the room), but a ShadowGenerator redraws every caster every
// frame. This splits the map's draw into two passes:
//
//   static  - casters that have not moved since the cache was built. Drawn once into the
//             map, then the map's depth is copied (blitFramebuffer) into a cache target.
//   dynamic - the crowd, and anything that has moved (cannon, gates, boss, falling wall
//             blocks): drawn every frame on top of the cached depth.
//
// Every frame the map starts from the cached static depth (one depth blit instead of
// ~25 draw calls and their vertex work), then only the dynamic casters draw. A static
// caster whose world matrix, visibility or instance count changes is demoted to dynamic
// for the rest of the level and the cache is rebuilt once without it. invalidate()
// (level load, light refit, quality change, context restore) forgets the demotions and
// rebuilds. WebGL2 only; elsewhere the generator draws everything as before.
import type { Scene } from '@babylonjs/core/scene';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { SubMesh } from '@babylonjs/core/Meshes/subMesh';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture';

type RenderFn = NonNullable<RenderTargetTexture['customRenderFunction']>;

interface Sig {
  flag: number;
  enabled: boolean;
  visible: boolean;
  thin: number;
}

interface GlTarget {
  _framebuffer?: WebGLFramebuffer | null;
}

// Instanced meshes are drawn in one batch with their source mesh: track the source.
function keyOf(m: AbstractMesh): AbstractMesh {
  const src = (m as AbstractMesh & { sourceMesh?: AbstractMesh }).sourceMesh;
  return src ?? m;
}

function sigOf(m: AbstractMesh): Sig {
  const w = m.computeWorldMatrix();
  return {
    flag: w.updateFlag,
    enabled: m.isEnabled(),
    visible: m.isVisible,
    thin: (m as AbstractMesh & { thinInstanceCount?: number }).thinInstanceCount ?? 0,
  };
}

function same(a: Sig, b: Sig): boolean {
  return a.flag === b.flag && a.enabled === b.enabled && a.visible === b.visible && a.thin === b.thin;
}

export class StaticShadowCache {
  private readonly scene: Scene;
  private readonly gl: WebGL2RenderingContext | null;
  private sg: ShadowGenerator | null = null;
  private cache: RenderTargetTexture | null = null;
  private pass: 'all' | 'static' | 'dynamic' = 'all';
  private valid = false;
  private readonly statics = new Map<AbstractMesh, Sig>(); // registered static casters
  private readonly demoted = new Set<AbstractMesh>(); // keys drawn every frame
  private enabled: boolean;
  private lastBuild = -1;

  constructor(scene: Scene) {
    this.scene = scene;
    const engine = scene.getEngine() as unknown as { _gl?: WebGL2RenderingContext; webGLVersion?: number; isWebGPU?: boolean };
    this.gl = !engine.isWebGPU && engine._gl && (engine.webGLVersion ?? 1) >= 2 ? engine._gl : null;
    this.enabled = !!this.gl;
  }

  get active(): boolean {
    return this.enabled;
  }

  // Number of casters currently served from the cache (for tests and debugging).
  get cachedCount(): number {
    let n = 0;
    for (const m of this.statics.keys()) if (!this.demoted.has(keyOf(m))) n++;
    return n;
  }

  // (Re)attach to a generator; call after creating it or after its map was recreated
  // (mapSize change).
  attach(sg: ShadowGenerator): void {
    this.sg = sg;
    this.cache?.dispose();
    this.cache = null;
    this.valid = false;
    if (!this.enabled) return;
    const map = sg.getShadowMap();
    if (!map) return;
    const size = map.getSize().width;
    try {
      const cache = new RenderTargetTexture('shadowStaticCache', size, this.scene, false, true, map.textureType, false, undefined, false, false, undefined, map.textureFormat);
      cache.createDepthStencilTexture(this.scene.getEngine().useReverseDepthBuffer ? 516 : 513, true);
      this.cache = cache;
    } catch (e) {
      console.warn('shadow cache disabled', e);
      this.enabled = false;
      return;
    }
    sg.customAllowRendering = (sm: SubMesh) => this.allow(sm);
    const original = map.customRenderFunction as RenderFn;
    map.customRenderFunction = (opaque, alphaTest, transparent, depthOnly) => {
      if (!this.enabled || !this.cache) return original(opaque, alphaTest, transparent, depthOnly);
      const id = this.scene.getRenderId();
      this.check();
      if (!this.valid) {
        this.pass = 'static';
        original(opaque, alphaTest, transparent, depthOnly);
        this.valid = this.copy(map, this.cache, size);
        this.lastBuild = id;
      } else if (!this.copy(this.cache, map, size)) {
        // Copy failed (lost context, odd driver): draw everything this frame.
        this.valid = false;
        this.pass = 'all';
        original(opaque, alphaTest, transparent, depthOnly);
        return;
      }
      this.pass = 'dynamic';
      original(opaque, alphaTest, transparent, depthOnly);
      this.pass = 'all';
    };
  }

  addStatic(mesh: AbstractMesh): void {
    this.statics.set(mesh, sigOf(mesh));
    this.valid = false;
  }

  remove(mesh: AbstractMesh): void {
    if (this.statics.delete(mesh)) this.valid = false;
  }

  // Forget the demotions and rebuild (level load, light refit, quality change).
  invalidate(): void {
    this.demoted.clear();
    for (const m of this.statics.keys()) this.statics.set(m, sigOf(m));
    this.valid = false;
  }

  dispose(): void {
    this.cache?.dispose();
    this.cache = null;
    this.statics.clear();
    this.demoted.clear();
    this.sg = null;
  }

  private allow(sm: SubMesh): boolean {
    if (this.pass === 'all') return true;
    const k = keyOf(sm.getMesh());
    const cached = this.statics.has(k) && !this.demoted.has(k);
    return this.pass === 'static' ? cached : !cached;
  }

  // Demote any static caster that changed since its snapshot.
  private check(): void {
    for (const [m, s] of this.statics) {
      const k = keyOf(m);
      if (this.demoted.has(k)) continue;
      const now = sigOf(m);
      if (!same(now, s)) {
        this.demoted.add(k);
        this.statics.set(m, now);
        this.valid = false;
      }
    }
  }

  // Depth blit between two render targets; leaves the destination bound as the framebuffer
  // when it is the shadow map (it is during the map's render).
  private copy(from: RenderTargetTexture, to: RenderTargetTexture, size: number): boolean {
    const gl = this.gl;
    const src = (from.renderTarget as unknown as GlTarget | null)?._framebuffer;
    const dst = (to.renderTarget as unknown as GlTarget | null)?._framebuffer;
    if (!gl || !src || !dst || gl.isContextLost()) return false;
    const map = this.sg?.getShadowMap();
    const mapFb = (map?.renderTarget as unknown as GlTarget | null)?._framebuffer ?? null;
    const scissor = gl.isEnabled(gl.SCISSOR_TEST);
    if (scissor) gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dst);
    gl.blitFramebuffer(0, 0, size, size, 0, 0, size, size, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    // The shadow map is the bound framebuffer while it renders; put it back.
    gl.bindFramebuffer(gl.FRAMEBUFFER, mapFb);
    if (scissor) gl.enable(gl.SCISSOR_TEST);
    return true;
  }

  // Frames since the cache was last rebuilt (debugging).
  builtAt(): number {
    return this.lastBuild;
  }
}
