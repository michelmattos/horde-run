// Pure state for the world map's Expedition button: which badges it wears and what it
// says to a screen reader. No DOM here so it is testable in Node.

export interface ExpeditionEntryFlags {
  active: boolean; // a run is saved and can be resumed
  dailyDone: boolean; // today's Daily run has already been played
}

export interface ExpeditionEntryLook {
  progress: boolean; // 'Run in progress' badge
  daily: boolean; // 'Daily ready' dot
  sub: string; // small line under the button title
  aria: string;
}

// Unknown flags (the caller passed none) show no badge and no dot.
export function expeditionEntryLook(flags?: ExpeditionEntryFlags): ExpeditionEntryLook {
  const progress = flags?.active === true;
  const daily = flags !== undefined && !flags.dailyDone;
  const sub = progress ? 'Tap to resume your run' : daily ? 'Daily run ready' : 'Roguelite run';
  const parts = ['Expedition'];
  if (progress) parts.push('run in progress');
  if (daily) parts.push('daily run ready');
  return { progress, daily, sub, aria: parts.join(', ') };
}
