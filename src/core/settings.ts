// Player settings persisted in localStorage. One shared object is mutated in
// place by the overlays; input, haptics and audio read it live. Parsing is pure
// (parseSettings) so old or hand-edited stored data falls back field by field.

export interface Settings {
  sensitivity: number; // 0.5..2, default 1
  haptics: boolean; // default true
  sound: boolean; // default true
  volume: number; // 0..1, default 0.8
}

const KEY = 'horde-run:settings';

export function defaultSettings(): Settings {
  return { sensitivity: 1, haptics: true, sound: true, volume: 0.8 };
}

export function clampSensitivity(v: number): number {
  return Number.isFinite(v) ? Math.min(2, Math.max(0.5, v)) : 1;
}

export function clampVolume(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.8;
}

// Stored JSON (any shape) to Settings: each known field is kept when it has the right
// type, everything else gets its default. Settings saved before sound existed load as
// sound on at 80% volume.
export function parseSettings(raw: unknown): Settings {
  const s = defaultSettings();
  if (!raw || typeof raw !== 'object') return s;
  const p = raw as Record<string, unknown>;
  if (typeof p.sensitivity === 'number') s.sensitivity = clampSensitivity(p.sensitivity);
  if (typeof p.haptics === 'boolean') s.haptics = p.haptics;
  if (typeof p.sound === 'boolean') s.sound = p.sound;
  if (typeof p.volume === 'number') s.volume = clampVolume(p.volume);
  return s;
}

export function loadSettings(): Settings {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (raw) return parseSettings(JSON.parse(raw));
  } catch {
    // Private mode or corrupt data: keep defaults.
  }
  return defaultSettings();
}

export function saveSettings(s: Settings): void {
  try {
    globalThis.localStorage?.setItem(
      KEY,
      JSON.stringify({ sensitivity: s.sensitivity, haptics: s.haptics, sound: s.sound, volume: s.volume }),
    );
  } catch {
    // Storage blocked: settings just won't persist.
  }
}
