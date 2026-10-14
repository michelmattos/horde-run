// Safe-area insets (notch, home indicator) in CSS px. CSS env() values are not
// readable from JS directly, so a hidden probe div carries them as padding. Read on
// layout changes only (not per frame), so there is no cache to go stale on rotation.

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

let probe: HTMLDivElement | null = null;

function ensureProbe(): HTMLDivElement {
  if (probe) return probe;
  probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText =
    'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
    'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);';
  document.body.appendChild(probe);
  return probe;
}

export function readSafeAreaInsets(): Insets {
  const cs = getComputedStyle(ensureProbe());
  return {
    top: parseFloat(cs.paddingTop) || 0,
    right: parseFloat(cs.paddingRight) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left: parseFloat(cs.paddingLeft) || 0,
  };
}
