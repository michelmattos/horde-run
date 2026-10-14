// Level card, pause and result screens as plain HTML over the canvas. Everything
// is built once and toggled; the only animation is the result stars' CSS pop,
// which never blocks input, so a tap on Play, Retry or Next acts on the very
// first frame. Nothing here moves the screen. Styles are injected once with
// hr- scoped classes.
import { clampSensitivity, saveSettings } from '../core/settings.ts';
import type { Settings } from '../core/settings.ts';
import { isLandscapeTouch } from '../core/lifecycle.ts';
import { formatTime, resultActions, starPopDelays, STAR_POP } from './uiLogic.ts';
import type { ResultAction } from './uiLogic.ts';

export interface LevelIntroOptions {
  code: string; // '1-4'
  levelName: string;
  intro?: string; // shown highlighted as 'New: ...'
  goals: readonly string[]; // the 3 star labels (starGoalLabels): win, base above half, target time
  earned: readonly boolean[]; // best stars so far
  boss?: string;
  onPlay(): void;
  onMap(): void;
}

export interface ResultOptions {
  levelName: string;
  timeSeconds: number;
  hasNext: boolean;
  onRetry(): void;
  onNext(): void;
  stars?: readonly boolean[]; // 3: stars earned in this battle
  goals?: readonly string[]; // 3 labels, shown with a tick or cross from `stars`
  newBest?: boolean;
  onMap?(): void;
}

export interface PauseOptions {
  reason: 'user' | 'hidden' | 'orientation';
  onResume(): void;
  onRestart(): void;
  onMap?(): void;
}

export interface Overlays {
  showLevelIntro(o: LevelIntroOptions): void;
  showResult(outcome: 'victory' | 'defeat', o: ResultOptions): void;
  /** 'orientation' shows "Rotate to portrait" and hides Resume until a touch device is portrait again. */
  showPause(o: PauseOptions): void;
  hide(): void;
  readonly visible: boolean;
}

const CSS = `
.hr-ov{position:fixed;inset:0;z-index:10;display:none;align-items:center;justify-content:center;overflow-y:auto;
  padding:max(16px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));
  background:rgba(10,14,22,0.72);font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#fff;
  -webkit-user-select:none;user-select:none;touch-action:manipulation;box-sizing:border-box}
.hr-ov.hr-on{display:flex}
.hr-card{width:100%;max-width:360px;margin:auto;display:flex;flex-direction:column;gap:12px;text-align:center}
.hr-h{margin:0 0 4px;font-size:44px;font-weight:900;letter-spacing:.02em;line-height:1.1}
.hr-victory .hr-h{color:#8ee08f}
.hr-defeat .hr-h{color:#ff7a7a}
.hr-sub{margin:0 0 12px;font-size:16px;opacity:.8}
.hr-btn{min-height:56px;width:100%;border:0;border-radius:14px;font:inherit;font-size:20px;font-weight:800;
  color:#fff;background:#38455c;touch-action:manipulation;cursor:pointer;-webkit-tap-highlight-color:transparent}
.hr-btn:active{filter:brightness(1.2)}
.hr-btn.hr-primary{background:#2f9e44}
.hr-ov [hidden]{display:none!important}
.hr-stack{display:flex;flex-direction:column;gap:12px}
.hr-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:48px;font-size:17px;font-weight:600;text-align:left}
.hr-toggle{min-width:96px;min-height:48px;border:0;border-radius:24px;font:inherit;font-weight:800;color:#fff;background:#38455c;touch-action:manipulation;cursor:pointer}
.hr-toggle[aria-pressed=true]{background:#1f9d55}
.hr-range{flex:1;min-height:48px;accent-color:#2f9e44;touch-action:manipulation}
.hr-val{min-width:44px;text-align:right;font-variant-numeric:tabular-nums}
.hr-pair{display:flex;gap:12px}
.hr-pair>.hr-btn{flex:1}
.hr-code{align-self:center;padding:4px 14px;border-radius:999px;background:#38455c;font-size:15px;font-weight:800;letter-spacing:.06em}
.hr-name{margin:0;font-size:32px;font-weight:900;line-height:1.15}
.hr-boss{margin:0;font-size:17px;font-weight:900;letter-spacing:.08em;color:#ff7a7a}
.hr-new{margin:0;padding:12px 14px;border-radius:12px;background:rgba(255,211,77,.14);border:2px solid #ffd34d;
  font-size:16px;font-weight:600;line-height:1.35;text-align:left}
.hr-new b{color:#ffd34d}
.hr-goals{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;text-align:left}
.hr-goal{display:flex;align-items:center;gap:10px;min-height:32px;font-size:17px;font-weight:600}
.hr-goal .hr-mark{flex:none;width:28px;text-align:center;font-size:22px;line-height:1}
.hr-mark.hr-gold{color:#ffd34d}
.hr-mark.hr-off{color:#6b7380}
.hr-mark.hr-ok{color:#4ade80;font-weight:900}
.hr-mark.hr-no{color:#ff7a7a;font-weight:900}
.hr-goal.hr-dim{opacity:.6}
.hr-stars{display:flex;justify-content:center;gap:10px;margin:0 0 4px;font-size:56px;line-height:1}
.hr-bigstar{display:inline-block;color:#3a4352}
.hr-bigstar.hr-earned{color:#ffd34d;animation:hr-pop ${STAR_POP.durationMs}ms ease-out both}
@keyframes hr-pop{0%{color:#3a4352;transform:scale(1)}55%{color:#ffd34d;transform:scale(1.35)}100%{color:#ffd34d;transform:scale(1)}}
@media (prefers-reduced-motion: reduce){.hr-bigstar.hr-earned{animation:none}}
.hr-best{margin:0;font-size:17px;font-weight:800;color:#ffd34d}
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

const STAR = '\u2605';

// One goal line: a leading mark (star, tick or cross) and its label.
function goalLine(mark: string, markCls: string, text: string, dim = false): HTMLLIElement {
  const li = el('li', dim ? 'hr-goal hr-dim' : 'hr-goal');
  li.append(el('span', `hr-mark ${markCls}`, mark), el('span', '', text));
  return li;
}

export function createOverlays(root: HTMLElement, settings: Settings): Overlays {
  injectStyles();

  // ----- Level card -----
  const intro = el('div', 'hr-ov');
  intro.setAttribute('role', 'dialog');
  const iCard = el('div', 'hr-card');
  const iCode = el('div', 'hr-code');
  const iName = el('h1', 'hr-name');
  const iBoss = el('p', 'hr-boss');
  const iNew = el('p', 'hr-new');
  const iGoals = el('ul', 'hr-goals');
  const playBtn = button('Play');
  playBtn.classList.add('hr-primary');
  const iMapBtn = button('Map');
  iCard.append(iCode, iName, iBoss, iNew, iGoals, playBtn, iMapBtn);
  intro.append(iCard);
  root.appendChild(intro);

  // ----- Result screen -----
  const result = el('div', 'hr-ov');
  result.setAttribute('role', 'dialog');
  const rCard = el('div', 'hr-card');
  const rHead = el('h1', 'hr-h');
  const rSub = el('p', 'hr-sub');
  const rStars = el('div', 'hr-stars');
  rStars.setAttribute('role', 'img');
  const bigStars = [0, 1, 2].map(() => el('span', 'hr-bigstar', STAR));
  rStars.append(...bigStars);
  const rBest = el('p', 'hr-best', 'New best time');
  const rGoals = el('ul', 'hr-goals');
  const rButtons = el('div', 'hr-stack');
  const rSecondary = el('div', 'hr-pair');
  const retryBtn = button('Retry');
  const nextBtn = button('Next level');
  const rMapBtn = button('Map');
  const resultBtn: Record<ResultAction, HTMLButtonElement> = { next: nextBtn, retry: retryBtn, map: rMapBtn };
  rCard.append(rHead, rSub, rStars, rBest, rGoals, rButtons);
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
  const pMapBtn = button('World map');

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

  pCard.append(pHead, pSub, resumeBtn, restartBtn, pMapBtn, hapticsRow, sensRow);
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
  let actions: {
    retry?: () => void;
    next?: () => void;
    resume?: () => void;
    restart?: () => void;
    play?: () => void;
    map?: () => void;
  } = {};
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
  playBtn.addEventListener('click', () => fire('play'));
  for (const b of [iMapBtn, rMapBtn, pMapBtn]) b.addEventListener('click', () => fire('map'));

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
    showLevelIntro(o) {
      iCode.textContent = o.code;
      iName.textContent = o.levelName;
      iBoss.textContent = o.boss ? `Boss: ${o.boss.toUpperCase()}` : '';
      iBoss.hidden = !o.boss;
      iNew.replaceChildren();
      if (o.intro) iNew.append(el('b', '', 'New: '), o.intro);
      iNew.hidden = !o.intro;
      iGoals.replaceChildren(
        ...o.goals.map((g, i) => (o.earned[i] ? goalLine(STAR, 'hr-gold', g) : goalLine('\u2606', 'hr-off', g))),
      );
      actions = { play: o.onPlay, map: o.onMap };
      show(intro);
    },
    showResult(outcome, o) {
      const win = outcome === 'victory';
      result.className = `hr-ov ${win ? 'hr-victory' : 'hr-defeat'}`;
      rHead.textContent = win ? 'Victory!' : 'Defeat';
      rSub.textContent = `${o.levelName} · ${formatTime(o.timeSeconds)}`;

      // Stars fill in left to right; restart the CSS pop by re-adding the class after a reflow.
      const stars = o.stars;
      rStars.hidden = !stars;
      if (stars) {
        const delays = starPopDelays(3);
        bigStars.forEach((s, i) => {
          s.classList.remove('hr-earned');
          s.style.animationDelay = `${delays[i]}ms`;
        });
        void rStars.offsetWidth;
        bigStars.forEach((s, i) => s.classList.toggle('hr-earned', !!stars[i]));
        rStars.setAttribute('aria-label', `${stars.filter(Boolean).length} of 3 stars`);
      }
      rBest.hidden = !(win && o.newBest);
      const goals = stars && o.goals ? o.goals : [];
      rGoals.hidden = goals.length === 0;
      rGoals.replaceChildren(
        ...goals.map((g, i) => (stars?.[i] ? goalLine('\u2713', 'hr-ok', g) : goalLine('\u2717', 'hr-no', g, true))),
      );

      // Primary action full width first, where the thumb lands; the rest share a row.
      const plan = resultActions(win, o.hasNext, !!o.onMap);
      for (const b of Object.values(resultBtn)) b.classList.remove('hr-primary');
      const primary = resultBtn[plan.primary];
      primary.classList.add('hr-primary');
      rSecondary.replaceChildren(...plan.secondary.map((a) => resultBtn[a]));
      rButtons.replaceChildren(primary, rSecondary);
      rSecondary.hidden = plan.secondary.length === 0;
      actions = { retry: o.onRetry, next: o.onNext, map: o.onMap };
      show(result);
    },
    showPause(o) {
      const rotate = o.reason === 'orientation' && isLandscapeTouch();
      pHead.textContent = rotate ? 'Rotate to portrait' : 'Paused';
      pSub.textContent = rotate ? 'Horde Run plays in portrait.' : '';
      resumeBtn.hidden = rotate;
      pMapBtn.hidden = !o.onMap;
      syncSettings();
      actions = { resume: o.onResume, restart: o.onRestart, map: o.onMap };
      show(pause);
    },
    hide,
    get visible() {
      return current !== null;
    },
  };
}
