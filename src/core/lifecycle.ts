// Pause triggers: tab hidden / page hidden (calls, app switch) and, on touch
// devices only, rotating to landscape. Desktop windows never pause on aspect.

export type InterruptReason = 'hidden' | 'orientation';

function isStandalone(): boolean {
  try {
    return (
      matchMedia('(display-mode: fullscreen)').matches ||
      matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

function tryLockPortrait(): void {
  try {
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    if (isStandalone() && o && typeof o.lock === 'function') o.lock('portrait').catch(() => {});
  } catch {
    // Unsupported (iOS, desktop): the orientation pause covers it.
  }
}

export function watchInterruptions(
  onInterrupt: (r: InterruptReason) => void,
  onPortraitRestored?: () => void,
): () => void {
  tryLockPortrait();
  const landscapeTouch = matchMedia('(pointer: coarse) and (orientation: landscape)');

  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') onInterrupt('hidden');
  };
  const onPageHide = (): void => onInterrupt('hidden');
  const onOrientation = (): void => {
    if (landscapeTouch.matches) onInterrupt('orientation');
    else onPortraitRestored?.();
  };

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  landscapeTouch.addEventListener('change', onOrientation);
  // Starting in landscape on a phone pauses right away.
  if (landscapeTouch.matches) queueMicrotask(() => onInterrupt('orientation'));

  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
    landscapeTouch.removeEventListener('change', onOrientation);
  };
}

/** True when a touch device is currently in landscape (used to keep Resume hidden). */
export function isLandscapeTouch(): boolean {
  try {
    return matchMedia('(pointer: coarse) and (orientation: landscape)').matches;
  } catch {
    return false;
  }
}
