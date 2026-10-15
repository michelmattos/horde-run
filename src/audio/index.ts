// The game's sound system (WebAudio, all synthesized in synth.ts).
//
// Graph: voice (buffer source -> gain -> optional stereo panner) -> master gain ->
// compressor -> destination. The compressor keeps a battle with a thousand mobs from
// clipping; the throttle in mapping.ts keeps it from stacking in the first place.
// Each sound is pre-rendered once into an AudioBuffer with an OfflineAudioContext, so
// playing one costs a buffer source, a gain and maybe a panner. Until its buffer is
// ready (or where offline rendering is missing) the recipe plays live instead.
//
// iOS Safari only lets audio start inside a user gesture: the first touchend,
// pointerup, click or keydown on the unlock target creates or resumes the context and
// plays a 1-sample silent buffer. Listening continues until the context is 'running',
// and starts again whenever it leaves that state on its own (iOS 'interrupted' after a
// call or Siri), so the next tap brings sound back. suspend()/resume() are the
// integrator's pause and visibility hooks; while suspended nothing new is scheduled.
import type { SimEvent } from '../contracts.ts';
import type { Settings } from '../core/settings.ts';
import { SOUND_RULES, admitSound, createThrottleState, masterGain, panForX, soundsForFrame } from './mapping.ts';
import type { AudioCue, SoundId } from './mapping.ts';
import { RECIPES, makeNoise, recipeKey } from './synth.ts';
import type { Kit } from './synth.ts';

export type { AudioCue, SoundId, SoundRequest } from './mapping.ts';
export {
  SOUND_IDS,
  SOUND_RULES,
  admitSound,
  createThrottleState,
  masterGain,
  panForX,
  soundsForFrame,
} from './mapping.ts';

export interface PlayOptions {
  x?: number; // world x for stereo pan
  volume?: number; // 0..1, multiplies the sound's base volume
  variant?: string; // 'barrage' | 'paratroopers' | 'marble' for 'ultimate'; 'sarge' | 'tank' | 'drummer' for 'championLaunch'
}

export interface GameAudio {
  /** Creates or resumes the AudioContext; call inside a user gesture. Gestures on the unlock target do this already. */
  unlock(): void;
  /** True once the context has run (sound can be heard). */
  readonly unlocked: boolean;
  play(id: SoundId, opts?: PlayOptions): void;
  /** One battle frame: this frame's sim events and battle cues (BattleCue[] fits). */
  battleFrame(events: readonly SimEvent[], cues: readonly AudioCue[]): void;
  /** Which champion's launch sound championLaunched events play (default 'sarge'). */
  setChampion(id: 'sarge' | 'tank' | 'drummer'): void;
  /** Runtime mute on top of settings.sound (not saved). */
  setMuted(m: boolean): void;
  /** Sets settings.volume (0..1) and applies it; the caller saves settings. */
  setVolume(v: number): void;
  /** Pause / hidden: suspends the context; nothing plays until resume(). */
  suspend(): void;
  resume(): void;
  dispose(): void;
}

// Sounds that get a little random pitch so repeats don't sound machine-gunned.
const JITTER = new Set<SoundId>([
  'shot',
  'clash',
  'hitEnemyBase',
  'hitPlayerBase',
  'towerShot',
  'blast',
  'tap',
  'gateGood',
]);
const OFFLINE_RATE = 44100;
const GESTURES = ['touchend', 'pointerup', 'click', 'keydown'] as const;
const RESUME_RETRY_MS = 500;

type Ctor<T> = new (...args: never[]) => T;
interface AudioGlobals {
  AudioContext?: Ctor<AudioContext>;
  webkitAudioContext?: Ctor<AudioContext>;
  OfflineAudioContext?: new (channels: number, length: number, rate: number) => OfflineAudioContext;
  webkitOfflineAudioContext?: new (channels: number, length: number, rate: number) => OfflineAudioContext;
}

// Renders one recipe to a mono buffer. Old Safari returns nothing from startRendering
// and fires oncomplete instead, so both paths resolve the same promise.
function renderRecipe(
  Offline: NonNullable<AudioGlobals['OfflineAudioContext']>,
  key: string,
  noiseFor: (ctx: BaseAudioContext) => AudioBuffer,
): Promise<AudioBuffer> {
  const r = RECIPES[key];
  const oc = new Offline(1, Math.ceil((r.dur + 0.05) * OFFLINE_RATE), OFFLINE_RATE);
  r.play({ ctx: oc, out: oc.destination, noise: noiseFor(oc) }, 0);
  return new Promise<AudioBuffer>((resolve, reject) => {
    oc.oncomplete = (e) => resolve(e.renderedBuffer);
    const p = oc.startRendering() as Promise<AudioBuffer> | undefined;
    if (p && typeof p.then === 'function') p.then(resolve, reject);
  });
}

export function createAudio(settings: Settings, opts: { unlockTarget?: EventTarget } = {}): GameAudio {
  const g = globalThis as unknown as AudioGlobals;
  const AC = g.AudioContext ?? g.webkitAudioContext;
  const Offline = g.OfflineAudioContext ?? g.webkitOfflineAudioContext;
  const target: EventTarget | undefined = opts.unlockTarget ?? (typeof document !== 'undefined' ? document : undefined);

  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let muted = false;
  let userSuspended = false;
  let everRan = false;
  let disposed = false;
  let listening = false;
  let appliedGain = -1;
  let lastResumeTry = -Infinity;
  let champion: string = 'sarge';
  const buffers = new Map<string, AudioBuffer>();
  const throttle = createThrottleState();

  const noiseFor = (c: BaseAudioContext): AudioBuffer => (noise ??= makeNoise(c));

  // Pre-render every recipe, one at a time, off the critical path.
  const renderAll = async (): Promise<void> => {
    if (!Offline) return;
    for (const key of Object.keys(RECIPES)) {
      if (disposed) return;
      try {
        buffers.set(key, await renderRecipe(Offline, key, noiseFor));
      } catch {
        // This sound keeps playing live; nothing else to do.
      }
    }
  };
  if (Offline && typeof setTimeout === 'function') setTimeout(() => void renderAll(), 0);

  const onGesture = (): void => unlock();
  const listen = (): void => {
    if (listening || !target || disposed) return;
    listening = true;
    for (const ev of GESTURES) target.addEventListener(ev, onGesture, { capture: true, passive: true });
  };
  const unlisten = (): void => {
    if (!listening || !target) return;
    listening = false;
    for (const ev of GESTURES) target.removeEventListener(ev, onGesture, { capture: true });
  };

  const applyGain = (): void => {
    if (!ctx || !master) return;
    const v = masterGain(settings.sound, muted, settings.volume);
    if (v === appliedGain) return;
    appliedGain = v;
    master.gain.setTargetAtTime(v, ctx.currentTime, 0.02);
  };

  const onState = (): void => {
    if (!ctx || disposed) return;
    if (ctx.state === 'running') {
      everRan = true;
      unlisten();
    } else if (!userSuspended) {
      listen(); // iOS 'interrupted', or suspended by the system: the next tap resumes
    }
  };

  function build(): AudioContext | null {
    if (ctx || !AC || disposed) return ctx;
    try {
      ctx = new (AC as unknown as new (o?: AudioContextOptions) => AudioContext)({ latencyHint: 'interactive' });
    } catch {
      return null;
    }
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 6;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(comp);
    comp.connect(ctx.destination);
    ctx.onstatechange = onState;
    applyGain();
    return ctx;
  }

  function unlock(): void {
    const c = build();
    if (!c) return;
    if (c.state !== 'running' && !userSuspended) {
      c.resume().then(onState, () => undefined);
    }
    // The 1-sample silent buffer that iOS needs to really open the output.
    try {
      const b = c.createBuffer(1, 1, c.sampleRate);
      const s = c.createBufferSource();
      s.buffer = b;
      s.connect(c.destination);
      s.start(0);
    } catch {
      // Harmless: the resume above is what matters on other browsers.
    }
    onState();
  }

  // True when a sound may be scheduled right now; nudges a stalled context back.
  const ready = (): boolean => {
    if (disposed || userSuspended || !ctx || !master) return false;
    if (ctx.state !== 'running') {
      const now = performance.now();
      if (everRan && now - lastResumeTry > RESUME_RETRY_MS) {
        lastResumeTry = now;
        ctx.resume().then(onState, () => undefined);
      }
      return false;
    }
    applyGain();
    return appliedGain > 0;
  };

  function start(id: SoundId, volume: number, x: number | undefined, variant: string | undefined): void {
    const c = ctx as AudioContext;
    const out = c.createGain();
    out.gain.value = Math.max(0, Math.min(1, volume));
    const pan = panForX(x);
    let tail: AudioNode = out;
    if (pan !== 0 && typeof c.createStereoPanner === 'function') {
      const p = c.createStereoPanner();
      p.pan.value = pan;
      out.connect(p);
      tail = p;
    }
    tail.connect(master as GainNode);
    const key = recipeKey(id, variant);
    const buf = buffers.get(key);
    const cleanup = (): void => {
      out.disconnect();
      if (tail !== out) tail.disconnect();
    };
    if (buf) {
      const src = c.createBufferSource();
      src.buffer = buf;
      if (JITTER.has(id)) src.playbackRate.value = 0.96 + Math.random() * 0.08;
      src.connect(out);
      src.onended = () => {
        src.disconnect();
        cleanup();
      };
      src.start();
      return;
    }
    const r = RECIPES[key];
    const kit: Kit = { ctx: c, out, noise: noiseFor(c) };
    r.play(kit, c.currentTime + 0.005);
    setTimeout(cleanup, (r.dur + 0.1) * 1000);
  }

  listen();

  return {
    unlock,
    get unlocked() {
      return everRan;
    },
    play(id, o) {
      if (!ready()) return;
      if (!admitSound(throttle, id, performance.now())) return;
      const variant = o?.variant ?? (id === 'championLaunch' ? champion : undefined);
      start(id, SOUND_RULES[id].volume * (o?.volume ?? 1), o?.x, variant);
    },
    battleFrame(events, cues) {
      if (!ready()) return;
      if (events.length === 0 && cues.length === 0) return;
      const reqs = soundsForFrame(events, cues, performance.now(), throttle);
      for (let i = 0; i < reqs.length; i++) {
        const r = reqs[i];
        start(r.id, r.volume, r.x, r.variant ?? (r.id === 'championLaunch' ? champion : undefined));
      }
    },
    setChampion(id) {
      champion = id;
    },
    setMuted(m) {
      muted = m;
      applyGain();
    },
    setVolume(v) {
      settings.volume = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : settings.volume;
      applyGain();
    },
    suspend() {
      userSuspended = true;
      if (ctx && ctx.state === 'running') ctx.suspend().catch(() => undefined);
    },
    resume() {
      userSuspended = false;
      if (!ctx) return;
      if (ctx.state !== 'running') ctx.resume().then(onState, () => undefined);
      onState();
    },
    dispose() {
      disposed = true;
      unlisten();
      buffers.clear();
      if (ctx) {
        ctx.onstatechange = null;
        ctx.close().catch(() => undefined);
      }
      ctx = null;
      master = null;
    },
  };
}
