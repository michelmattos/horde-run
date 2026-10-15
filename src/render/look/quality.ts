// Render quality tiers and the governor that drops them when frames run long. Pure
// (no Babylon imports) so it runs under Node's type stripping in tests.
//
// Tiers (see docs/art-direction.md, "Performance tiers"):
//   high   - 2048 soft PCF shadow map, crowds cast real shadows, MSAA x4, bloom, vignette
//   medium - 1024 soft PCF shadow map, crowds cast real shadows, FXAA, bloom, vignette
//   low    - 1024 single-tap PCF map, static casters only (crowds use blob shadows),
//            no post-process pipeline (tone mapping still runs in the material shaders)
// The governor only ever steps down during a session (with one retry upward after a
// long stretch of headroom), so the picture never flickers between tiers.

export type QualityLevel = 'low' | 'medium' | 'high';

export const QUALITY_ORDER: readonly QualityLevel[] = ['low', 'medium', 'high'];

export interface QualitySettings {
  shadowMapSize: number;
  shadowFilter: 'low' | 'medium'; // PCF quality: low = one hardware-filtered tap, medium = soft
  crowdShadows: boolean; // thin-instanced crowds cast into the shadow map (else blob shadows)
  postProcess: boolean; // DefaultRenderingPipeline on at all
  msaa: number; // samples on the pipeline's render target (1 = off)
  fxaa: boolean;
  bloom: boolean;
  vignette: boolean;
}

export const QUALITY_SETTINGS: Record<QualityLevel, QualitySettings> = {
  high: {
    shadowMapSize: 2048,
    shadowFilter: 'medium',
    crowdShadows: true,
    postProcess: true,
    msaa: 4,
    fxaa: false,
    bloom: true,
    vignette: true,
  },
  medium: {
    shadowMapSize: 1024,
    shadowFilter: 'medium',
    crowdShadows: true,
    postProcess: true,
    msaa: 1,
    fxaa: true,
    bloom: true,
    vignette: true,
  },
  low: {
    shadowMapSize: 1024,
    shadowFilter: 'low',
    crowdShadows: false,
    postProcess: false,
    msaa: 1,
    fxaa: false,
    bloom: false,
    vignette: false,
  },
};

export function parseQuality(v: string | null | undefined): QualityLevel | null {
  return v === 'low' || v === 'medium' || v === 'high' ? v : null;
}

// Phones (touch screens) share their GPU memory with everything else, and iOS drops
// or refuses the WebGL context of a page that uses too much (the blank screens of
// 2026-10-15). On a phone every tier keeps the shadow map at 1024 and anti-aliases with
// FXAA instead of a 4x multisampled HDR target: about 100 MB less GPU memory on high.
export const PHONE_SHADOW_MAP_MAX = 1024;

export function withDeviceLimits(q: QualitySettings, phone: boolean): QualitySettings {
  if (!phone) return q;
  const shadowMapSize = Math.min(q.shadowMapSize, PHONE_SHADOW_MAP_MAX);
  const msaa = 1;
  const fxaa = q.postProcess && (q.fxaa || q.msaa > 1);
  if (shadowMapSize === q.shadowMapSize && msaa === q.msaa && fxaa === q.fxaa) return q;
  return { ...q, shadowMapSize, msaa, fxaa };
}

// Pipeline parts switched off for this device because the canvas stayed blank with them
// (see blankWatch.ts): 'no-msaa' keeps the pipeline without its multisampled target
// (FXAA instead), 'off' draws straight to the canvas like the low tier.
export type PostFallback = 'no-msaa' | 'off';

export function parsePostFallback(v: unknown): PostFallback | null {
  return v === 'no-msaa' || v === 'off' ? v : null;
}

// A tier's settings with the device's post fallback applied.
export function withPostFallback(q: QualitySettings, f: PostFallback | null | undefined): QualitySettings {
  if (f === 'off') return { ...q, postProcess: false, msaa: 1, fxaa: false, bloom: false, vignette: false };
  if (f === 'no-msaa' && q.msaa > 1) return { ...q, msaa: 1, fxaa: true };
  return q;
}

// The next fallback after `f` for a tier, or null when the pipeline is already off.
export function nextPostFallback(q: QualitySettings, f: PostFallback | null | undefined): PostFallback | null {
  const s = withPostFallback(q, f);
  if (!s.postProcess) return null;
  return s.msaa > 1 ? 'no-msaa' : 'off';
}

export function lowerQuality(q: QualityLevel): QualityLevel {
  const i = QUALITY_ORDER.indexOf(q);
  return QUALITY_ORDER[Math.max(0, i - 1)];
}

export function higherQuality(q: QualityLevel): QualityLevel {
  const i = QUALITY_ORDER.indexOf(q);
  return QUALITY_ORDER[Math.min(QUALITY_ORDER.length - 1, i + 1)];
}

const SLOW_MS = 19; // smoothed frame time above this counts as "running long" (60 Hz target)
const HEADROOM_MS = 17.2;
const SLOW_HOLD = 2; // seconds of long frames before stepping down
const FAST_MS = 25; // far over budget (under 40 fps): step down sooner
const FAST_HOLD = 1;
const UP_HOLD = 30; // seconds of headroom before the single retry upward
const IGNORE_DT = 0.25; // tab switches and load hitches are not a steady frame time
const SMOOTHING = 0.08;

export class QualityGovernor {
  level: QualityLevel;
  readonly ceiling: QualityLevel;
  private avgMs = 16.7;
  private slowFor = 0;
  private fastFor = 0;
  private ignoreFor = 0;
  private retried = false;
  locked: boolean; // true when the level was forced (?quality=...): never changes

  // `ceiling` (default `start`) is the tier the single upward retry may climb back to,
  // so a session that starts on a remembered lower tier can still recover.
  constructor(start: QualityLevel, locked = false, ceiling: QualityLevel = start) {
    this.level = start;
    this.ceiling = QUALITY_ORDER.indexOf(ceiling) >= QUALITY_ORDER.indexOf(start) ? ceiling : start;
    this.locked = locked;
  }

  // Ignore samples for a while (level load: shader compiles, uploads).
  warmUp(seconds = 2): void {
    this.ignoreFor = seconds;
    this.slowFor = 0;
    this.fastFor = 0;
    this.avgMs = 16.7;
  }

  // Feed the real seconds since the last rendered frame; returns true when `level` changed.
  sample(dt: number): boolean {
    if (this.locked || !(dt > 0) || dt > IGNORE_DT) return false;
    if (this.ignoreFor > 0) {
      this.ignoreFor -= dt;
      return false;
    }
    this.avgMs += (dt * 1000 - this.avgMs) * SMOOTHING;
    if (this.avgMs > SLOW_MS) {
      this.slowFor += dt;
      this.fastFor = 0;
    } else if (this.avgMs <= HEADROOM_MS) {
      this.fastFor += dt;
      this.slowFor = 0;
    } else {
      this.slowFor = 0;
      this.fastFor = 0;
    }
    const hold = this.avgMs > FAST_MS ? FAST_HOLD : SLOW_HOLD;
    if (this.slowFor >= hold && this.level !== 'low') {
      this.level = lowerQuality(this.level);
      this.warmUp(1);
      return true;
    }
    if (!this.retried && this.fastFor >= UP_HOLD && this.level !== this.ceiling) {
      this.retried = true; // one retry only: a device on the edge must not oscillate
      this.level = higherQuality(this.level);
      this.warmUp(1);
      return true;
    }
    return false;
  }
}

// ---------- remembered settings ----------
// The tier and render pixel ratio a session settled on, so the next cold start begins
// there instead of descending from the top again. localStorage may be missing or throw
// (private mode, blocked storage, Node tests): every access is guarded.

export interface SavedRender {
  quality?: QualityLevel;
  ratio?: number;
  post?: PostFallback;
}

const SAVE_KEY = 'horde-run:render-v1';

function storage(): Storage | null {
  try {
    const s = (globalThis as { localStorage?: Storage }).localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

export function readSavedRender(): SavedRender {
  try {
    const raw = storage()?.getItem(SAVE_KEY);
    if (!raw) return {};
    const o = JSON.parse(raw) as { quality?: unknown; ratio?: unknown; post?: unknown };
    const out: SavedRender = {};
    const q = parseQuality(typeof o.quality === 'string' ? o.quality : null);
    if (q) out.quality = q;
    const post = parsePostFallback(o.post);
    if (post) out.post = post;
    if (typeof o.ratio === 'number' && Number.isFinite(o.ratio) && o.ratio > 0) out.ratio = o.ratio;
    return out;
  } catch {
    return {};
  }
}

export function writeSavedRender(patch: SavedRender): void {
  try {
    const s = storage();
    if (!s) return;
    s.setItem(SAVE_KEY, JSON.stringify({ ...readSavedRender(), ...patch }));
  } catch {
    // storage full or blocked: not remembering is fine
  }
}
