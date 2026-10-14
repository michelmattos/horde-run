// Player settings persisted in localStorage. One shared object is mutated in
// place by the overlays; input and haptics read it live.

export interface Settings {
  sensitivity: number; // 0.5..2, default 1
  haptics: boolean; // default true
}

const KEY = 'horde-run:settings';

export function clampSensitivity(v: number): number {
  return Number.isFinite(v) ? Math.min(2, Math.max(0.5, v)) : 1;
}

export function loadSettings(): Settings {
  const s: Settings = { sensitivity: 1, haptics: true };
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Settings>;
      if (typeof p.sensitivity === 'number') s.sensitivity = clampSensitivity(p.sensitivity);
      if (typeof p.haptics === 'boolean') s.haptics = p.haptics;
    }
  } catch {
    // Private mode or corrupt data: keep defaults.
  }
  return s;
}

export function saveSettings(s: Settings): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify({ sensitivity: s.sensitivity, haptics: s.haptics }));
  } catch {
    // Storage blocked: settings just won't persist.
  }
}
