// Pause and result screens as plain HTML over the canvas. Everything is built
// once and toggled, with no entry animations, so a tap on Retry or Next acts
// on the very first frame. Styles are injected once with hr- scoped classes.
import { clampSensitivity, saveSettings } from '../core/settings.ts';
import type { Settings } from '../core/settings.ts';
import { isLandscapeTouch } from '../core/lifecycle.ts';

export interface Overlays {
  showResult(
    outcome: 'victory' | 'defeat',
    o: { levelName: string; timeSeconds: number; hasNext: boolean; onRetry(): void; onNext(): void },
  ): void;
  /** 'orientation' shows "Rotate to portrait" and hides Resume until a touch device is portrait again. */
  showPause(o: { reason: 'user' | 'hidden' | 'orientation'; onResume(): void; onRestart(): void }): void;
  hide(): void;
  readonly visible: boolean;
}

const CSS = `
.hr-ov{position:fixed;inset:0;z-index:10;display:none;align-items:center;justify-content:center;
  padding:max(16px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));
  background:rgba(10,14,22,0.72);font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#fff;
  -webkit-user-select:none;user-select:none;touch-action:manipulation;box-sizing:border-box}
.hr-ov.hr-on{display:flex}
.hr-card{width:100%;max-width:360px;display:flex;flex-direction:column;gap:12px;text-align:center}
.hr-h{margin:0 0 4px;font-size:44px;font-weight:900;letter-spacing:.02em;line-height:1.1}
.hr-victory .hr-h{color:#7fb2ff}
.hr-defeat .hr-h{color:#ff7a7a}
.hr-sub{margin:0 0 12px;font-size:16px;opacity:.8}
.hr-btn{min-height:56px;width:100%;border:0;border-radius:14px;font:inherit;font-size:20px;font-weight:800;
  color:#fff;background:#38455c;touch-action:manipulation;cursor:pointer;-webkit-tap-highlight-color:transparent}
.hr-btn:active{filter:brightness(1.2)}
.hr-btn.hr-primary{background:#2f6bff}
.hr-btn[hidden]{display:none}
.hr-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:48px;font-size:17px;font-weight:600;text-align:left}
.hr-toggle{min-width:96px;min-height:48px;border:0;border-radius:24px;font:inherit;font-weight:800;color:#fff;background:#38455c;touch-action:manipulation;cursor:pointer}
.hr-toggle[aria-pressed=true]{background:#1f9d55}
.hr-range{flex:1;min-height:48px;accent-color:#2f6bff;touch-action:manipulation}
.hr-val{min-width:44px;text-align:right;font-variant-numeric:tabular-nums}
`;

let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(text: string): HTMLButtonElement {
  const b = el('button', 'hr-btn', text);
  b.type = 'button';
  return b;
}

function formatTime(s: number): string {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

export function createOverlays(root: HTMLElement, settings: Settings): Overlays {
  injectStyles();

  // ----- Result screen -----
  const result = el('div', 'hr-ov');
  result.setAttribute('role', 'dialog');
  const rCard = el('div', 'hr-card');
  const rHead = el('h1', 'hr-h');
  const rSub = el('p', 'hr-sub');
  const retryBtn = button('Retry');
  const nextBtn = button('Next level');
  rCard.append(rHead, rSub);
  result.append(rCard);
  root.appendChild(result);

  // ----- Pause screen -----
  const pause = el('div', 'hr-ov');
  pause.setAttribute('role', 'dialog');
  const pCard = el('div', 'hr-card');
  const pHead = el('h1', 'hr-h', 'Paused');
  const pSub = el('p', 'hr-sub');
  const resumeBtn = button('Resume');
  resumeBtn.classList.add('hr-primary');
  const restartBtn = button('Restart');

  const hapticsRow = el('div', 'hr-row');
  const hapticsToggle = el('button', 'hr-toggle');
  hapticsToggle.type = 'button';
  hapticsRow.append(el('span', '', 'Haptics'), hapticsToggle);

  const sensRow = el('label', 'hr-row');
  const sensRange = el('input', 'hr-range');
  sensRange.type = 'range';
  sensRange.min = '0.5';
  sensRange.max = '2';
  sensRange.step = '0.05';
  const sensVal = el('span', 'hr-val');
  sensRow.append(el('span', '', 'Sensitivity'), sensRange, sensVal);

  pCard.append(pHead, pSub, resumeBtn, restartBtn, hapticsRow, sensRow);
  pause.append(pCard);
  root.appendChild(pause);

  const syncSettings = (): void => {
    hapticsToggle.textContent = settings.haptics ? 'On' : 'Off';
    hapticsToggle.setAttribute('aria-pressed', String(settings.haptics));
    sensRange.value = String(settings.sensitivity);
    sensVal.textContent = `${settings.sensitivity.toFixed(2)}x`;
  };
  hapticsToggle.addEventListener('click', () => {
    settings.haptics = !settings.haptics;
    saveSettings(settings);
    syncSettings();
  });
  sensRange.addEventListener('input', () => {
    settings.sensitivity = clampSensitivity(parseFloat(sensRange.value));
    sensVal.textContent = `${settings.sensitivity.toFixed(2)}x`;
  });
  sensRange.addEventListener('change', () => saveSettings(settings));

  // ----- Actions: each screen's callbacks fire at most once, so a double tap can't restart twice -----
  let actions: { retry?: () => void; next?: () => void; resume?: () => void; restart?: () => void } = {};
  let current: HTMLElement | null = null;
  const fire = (key: keyof typeof actions): void => {
    const fn = actions[key];
    if (!fn) return;
    actions = {};
    hide();
    fn();
  };
  retryBtn.addEventListener('click', () => fire('retry'));
  nextBtn.addEventListener('click', () => fire('next'));
  resumeBtn.addEventListener('click', () => fire('resume'));
  restartBtn.addEventListener('click', () => fire('restart'));

  // Orientation pause: reveal Resume once the phone is back in portrait.
  const landscapeMq = matchMedia('(pointer: coarse) and (orientation: landscape)');
  const onOrientation = (): void => {
    if (current === pause && !isLandscapeTouch()) {
      resumeBtn.hidden = false;
      pHead.textContent = 'Paused';
      pSub.textContent = '';
    }
  };
  landscapeMq.addEventListener('change', onOrientation);

  const show = (node: HTMLElement): void => {
    if (current && current !== node) current.classList.remove('hr-on');
    current = node;
    node.classList.add('hr-on');
  };
  function hide(): void {
    if (current) current.classList.remove('hr-on');
    current = null;
    // Drop focus so Space/keys go back to the game.
    if (document.activeElement instanceof HTMLElement && root.contains(document.activeElement)) document.activeElement.blur();
  }

  return {
    showResult(outcome, o) {
      const win = outcome === 'victory';
      result.className = `hr-ov ${win ? 'hr-victory' : 'hr-defeat'}`;
      rHead.textContent = win ? 'Victory!' : 'Defeat';
      rSub.textContent = `${o.levelName} · ${formatTime(o.timeSeconds)}`;
      nextBtn.hidden = !o.hasNext;
      retryBtn.classList.toggle('hr-primary', !win || !o.hasNext);
      nextBtn.classList.toggle('hr-primary', win && o.hasNext);
      // Primary action first, where the thumb lands.
      if (win && o.hasNext) rCard.append(nextBtn, retryBtn);
      else rCard.append(retryBtn, nextBtn);
      actions = { retry: o.onRetry, next: o.onNext };
      show(result);
    },
    showPause(o) {
      const rotate = o.reason === 'orientation' && isLandscapeTouch();
      pHead.textContent = rotate ? 'Rotate to portrait' : 'Paused';
      pSub.textContent = rotate ? 'Horde Run plays in portrait.' : '';
      resumeBtn.hidden = rotate;
      syncSettings();
      actions = { resume: o.onResume, restart: o.onRestart };
      show(pause);
    },
    hide,
    get visible() {
      return current !== null;
    },
  };
}
