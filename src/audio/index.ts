// The game's sound system (WebAudio): effects, background music and a shared reverb.
//
// Graph:
//   effect voice (buffer source -> gain -> optional stereo panner) -> sfx bus -> compressor -> limiter
//   music parts (music.ts) -> music bus -> limiter
//   effect and music reverb sends -> sfx / music send bus -> convolver -> limiter
//   limiter -> destination
// The two buses follow the Music and Effects volumes (and the Sound switch); the send
// buses follow them too, so turning the music down turns its reverb down with it. The
// compressor keeps a battle with a thousand mobs from clipping; the throttle in
// mapping.ts keeps it from stacking in the first place; the limiter is the last guard.
// Effects are recorded impacts (samples.ts) where those are loaded, else synthesized
// recipes (synth.ts), each pre-rendered once into an AudioBuffer with an
// OfflineAudioContext so playing one costs a buffer source, a gain and maybe a panner.
// Until its buffer is ready (or where offline rendering is missing) a recipe plays live.
//
// iOS Safari only lets audio start inside a user gesture: the first touchend,
// pointerup, click or keydown on the unlock target creates or resumes the context and
// plays a 1-sample silent buffer. Listening continues until the context is 'running',
// and starts again whenever it leaves that state on its own (iOS 'interrupted' after a
// call or Siri), so the next tap brings sound back. suspend()/resume() are the
// integrator's visibility hooks; while suspended nothing new is scheduled. Music asked
// for before the first tap starts as soon as the context runs.
import type { SimEvent } from '../contracts.ts';
import type { Settings } from '../core/settings.ts';
import { makeNoise, makeReverbImpulse } from './dsp.ts';
import { SOUND_RULES, admitSound, createThrottleState, masterGain, panForX, soundsForFrame } from './mapping.ts';
import type { AudioCue, SoundId } from './mapping.ts';
import { createMusicPlayer } from './music.ts';
import type { MusicPlayer } from './music.ts';
import { SAMPLES, pickTake } from './samples.ts';
import type { MusicId } from './songs.ts';
import { RECIPES, recipeKey } from './synth.ts';
import type { Kit } from './synth.ts';

export type { AudioCue, SoundId, SoundRequest } from './mapping.ts';
export type { MusicId } from './songs.ts';
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
  /**
   * The background music for the screen (null = none). Asking for the song already
   * playing changes nothing, so menus can call this freely; a new song crossfades in,
   * after `delay` seconds when given. A battle's victory or defeat stops its music.
   */
  setMusic(id: MusicId | null, opts?: { delay?: number }): void;
  /** Runtime mute on top of settings.sound (not saved). */
  setMuted(m: boolean): void;
  /** Re-reads settings.sound, musicVolume and sfxVolume (call after a change). */
  applySettings(): void;
  /** Hidden: suspends the context; nothing plays until resume(). */
  suspend(): void;
  resume(): void;
  dispose(): void;
}

// Sounds that get a little random pitch so repeats don't sound machine-gunned
// (recorded takes always do; see samples.ts).
export const JITTER = new Set<SoundId>(['shot', 'towerShot', 'blast', 'tap', 'gateGood', 'gateTrap']);
// Reverb send per sound: the musical stings and big moments get some room, while the
// constant battle noise stays dry and close.
export const SEND: Readonly<Partial<Record<SoundId, number>>> = {
  victory: 0.35,
  defeat: 0.35,
  bossPhase: 0.3,
  unlock: 0.3,
  upgrade: 0.25,
  coin: 0.15,
  gateGood: 0.12,
  ultimate: 0.2,
  championLaunch: 0.15,
  defenderDown: 0.2,
  gateBreak: 0.15,
  build: 0.15,
};
// Bus levels at full volume. Music sits under the effects: it is there to make the
// screens feel alive, not to compete with the battle.
export const SFX_LEVEL = 0.9;
export const MUSIC_LEVEL = 0.7;
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

// decodeAudioData with the callback form old Safari needs.
function decode(ctx: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    const p = ctx.decodeAudioData(data, resolve, reject) as Promise<AudioBuffer> | undefined;
    if (p && typeof p.then === 'function') p.then(resolve, reject);
  });
}

export function createAudio(
  settings: Settings,
  opts: { unlockTarget?: EventTarget; baseUrl?: string } = {},
): GameAudio {
  const g = globalThis as unknown as AudioGlobals;
  const AC = g.AudioContext ?? g.webkitAudioContext;
  const Offline = g.OfflineAudioContext ?? g.webkitOfflineAudioContext;
  const target: EventTarget | undefined = opts.unlockTarget ?? (typeof document !== 'undefined' ? document : undefined);
  const baseUrl = opts.baseUrl ?? '/';

  let ctx: AudioContext | null = null;
  let sfxBus: GainNode | null = null;
  let musicBus: GainNode | null = null;
  let sfxSend: GainNode | null = null;
  let musicSend: GainNode | null = null;
  let music: MusicPlayer | null = null;
  let noise: AudioBuffer | null = null;
  let muted = false;
  let userSuspended = false;
  let everRan = false;
  let disposed = false;
  let listening = false;
  let sfxGain = -1;
  let musicGain = -1;
  let lastResumeTry = -Infinity;
  let champion: string = 'sarge';
  let wantMusic: MusicId | null = null;
  let musicDelay = 0;
  let samplesStarted = false;
  const buffers = new Map<string, AudioBuffer>();
  const takes = new Map<SoundId, AudioBuffer[]>();
  const lastTake = new Map<SoundId, number>();
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

  // Fetch and decode the recorded takes once the context exists (~60 KB in all).
  const loadSamples = async (c: AudioContext): Promise<void> => {
    if (samplesStarted || typeof fetch !== 'function') return;
    samplesStarted = true;
    for (const [id, set] of Object.entries(SAMPLES) as [SoundId, NonNullable<(typeof SAMPLES)[SoundId]>][]) {
      const got: AudioBuffer[] = [];
      for (const file of set.files) {
        if (disposed) return;
        try {
          const res = await fetch(`${baseUrl}${file}`);
          if (res.ok) got.push(await decode(c, await res.arrayBuffer()));
        } catch {
          // A missing take just leaves fewer to pick from.
        }
      }
      if (got.length === set.files.length) takes.set(id, got);
    }
  };

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

  const setLevel = (node: GainNode | null, v: number): void => {
    if (ctx && node) node.gain.setTargetAtTime(v, ctx.currentTime, 0.03);
  };

  // Bus gains from the settings; the music player only runs while it can be heard.
  const applyGain = (): void => {
    if (!ctx) return;
    const s = masterGain(settings.sound, muted, settings.sfxVolume) * SFX_LEVEL;
    if (s !== sfxGain) {
      sfxGain = s;
      setLevel(sfxBus, s);
      setLevel(sfxSend, s);
    }
    const m = masterGain(settings.sound, muted, settings.musicVolume) * MUSIC_LEVEL;
    if (m !== musicGain) {
      musicGain = m;
      setLevel(musicBus, m);
      setLevel(musicSend, m);
    }
    syncMusic();
  };

  // Starts, switches or stops the music player to match what the screen wants.
  const syncMusic = (): void => {
    if (!music || !ctx) return;
    // While the context is suspended its clock stands still, so a playing song just waits.
    const id = musicGain > 0 ? wantMusic : null;
    if (music.current === id) return;
    music.play(id, { delay: musicDelay });
    musicDelay = 0;
  };

  const onState = (): void => {
    if (!ctx || disposed) return;
    if (ctx.state === 'running') {
      everRan = true;
      unlisten();
      void loadSamples(ctx);
    } else if (!userSuspended) {
      listen(); // iOS 'interrupted', or suspended by the system: the next tap resumes
    }
    applyGain();
  };

  function build(): AudioContext | null {
    if (ctx || !AC || disposed) return ctx;
    let c: AudioContext;
    try {
      c = new (AC as unknown as new (o?: AudioContextOptions) => AudioContext)({ latencyHint: 'interactive' });
    } catch {
      return null;
    }
    ctx = c;
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 2;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.15;
    limiter.connect(c.destination);
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 6;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    comp.connect(limiter);
    const reverb = c.createConvolver();
    reverb.buffer = makeReverbImpulse(c);
    reverb.connect(limiter);
    const bus = (to: AudioNode): GainNode => {
      const n = c.createGain();
      n.gain.value = 0;
      n.connect(to);
      return n;
    };
    sfxBus = bus(comp);
    musicBus = bus(limiter);
    sfxSend = bus(reverb);
    musicSend = bus(reverb);
    music = createMusicPlayer(c, musicBus, musicSend, noiseFor(c));
    c.onstatechange = onState;
    applyGain();
    return c;
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
    if (disposed || userSuspended || !ctx || !sfxBus) return false;
    if (ctx.state !== 'running') {
      const now = performance.now();
      if (everRan && now - lastResumeTry > RESUME_RETRY_MS) {
        lastResumeTry = now;
        ctx.resume().then(onState, () => undefined);
      }
      return false;
    }
    applyGain();
    return sfxGain > 0;
  };

  // A recorded take for `id`, or null when its takes have not loaded.
  const takeFor = (id: SoundId): AudioBuffer | null => {
    const list = takes.get(id);
    if (!list) return null;
    const i = pickTake(list.length, lastTake.get(id) ?? -1, Math.random());
    lastTake.set(id, i);
    return list[i];
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
    tail.connect(sfxBus as GainNode);
    const sendAmt = SEND[id] ?? 0;
    let send: GainNode | null = null;
    if (sendAmt > 0 && sfxSend) {
      send = c.createGain();
      send.gain.value = sendAmt;
      tail.connect(send);
      send.connect(sfxSend);
    }
    const cleanup = (): void => {
      out.disconnect();
      if (tail !== out) tail.disconnect();
      send?.disconnect();
    };
    const set = SAMPLES[id];
    if (set && takes.has(id)) {
      out.gain.value *= set.gain;
      const hits = set.hits ?? [0];
      let longest = 0;
      for (const at of hits) {
        const buf = takeFor(id) as AudioBuffer;
        const src = c.createBufferSource();
        src.buffer = buf;
        const rate = set.rate[0] + Math.random() * (set.rate[1] - set.rate[0]);
        src.playbackRate.value = rate;
        src.connect(out);
        src.start(c.currentTime + at);
        longest = Math.max(longest, at + buf.duration / rate);
      }
      setTimeout(cleanup, (longest + 0.2) * 1000);
      return;
    }
    const key = recipeKey(id, variant);
    const buf = buffers.get(key);
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
      music?.pump();
      for (let i = 0; i < events.length; i++) {
        const t = events[i].type;
        if (t === 'victory' || t === 'defeat') {
          wantMusic = null; // the fanfare (or the sad trumpet) plays alone
          syncMusic();
          break;
        }
      }
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
    setMusic(id, o) {
      if (id === wantMusic) return;
      wantMusic = id;
      musicDelay = o?.delay ?? 0;
      syncMusic();
    },
    setMuted(m) {
      muted = m;
      applyGain();
    },
    applySettings() {
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
      music?.dispose();
      buffers.clear();
      takes.clear();
      if (ctx) {
        ctx.onstatechange = null;
        ctx.close().catch(() => undefined);
      }
      ctx = null;
      sfxBus = null;
      musicBus = null;
      music = null;
    },
  };
}
