// Level card, pause and result screens as plain HTML over the canvas, in the
// toy-box sticker style (docs/art-direction.md section 7): cream die-cut cards with an
// ink outline and a thick cardboard edge, a wooden header plank, and plastic sticker
// buttons that sink onto their extrusion when pressed. Everything is built once and
// toggled; the only animations are the card's quick springy pop-in and the result
// stars popping in one by one (scale only), and neither blocks input, so a tap on
// Play, Retry or Next acts on the very first frame. Nothing here moves the screen.
// Styles are injected once with hr- scoped classes on top of the shared theme.
import { clampSensitivity, saveSettings } from '../core/settings.ts';
import type { Settings } from '../core/settings.ts';
import { isLandscapeTouch } from '../core/lifecycle.ts';
import { formatTime, resultActions, starPopDelays, STAR_POP } from './uiLogic.ts';
import type { ResultAction } from './uiLogic.ts';
import { UI, WOOD_BG, injectUiTheme, outlineShadow } from './theme.ts';
import { crossIcon, mapIcon, nextIcon, playIcon, retryIcon, starIcon, tickIcon } from './icons.ts';

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
  padding:max(28px,calc(env(safe-area-inset-top) + 20px)) max(16px,env(safe-area-inset-right)) max(20px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));
  font-family:var(--tb-font);font-variant-numeric:tabular-nums;color:${UI.ink};
  -webkit-user-select:none;user-select:none;touch-action:manipulation;box-sizing:border-box}
.hr-ov.hr-on{display:flex}
.hr-ov.hr-on .hr-card{animation:hr-in 150ms cubic-bezier(.3,1.5,.6,1) both}
@keyframes hr-in{0%{transform:scale(.94);opacity:.4}100%{transform:scale(1);opacity:1}}
.hr-card{width:100%;max-width:360px;margin:auto;display:flex;flex-direction:column;gap:12px;text-align:center;padding:0 18px 22px}
.hr-ov [hidden]{display:none!important}

/* Wooden header plank across the top of the card. */
.hr-banner{position:relative;margin:-4px -22px 4px;padding:14px 18px 16px;border:4px solid ${UI.ink};border-radius:26px 26px 18px 18px;
  background:${WOOD_BG};box-shadow:inset 0 3px 0 rgba(255,225,180,.3),inset 0 -4px 0 rgba(0,0,0,.25),0 5px 0 ${UI.ink};
  display:flex;flex-direction:column;align-items:center;gap:6px}
.hr-banner::before,.hr-banner::after{content:'';position:absolute;top:50%;width:9px;height:9px;margin-top:-4px;border-radius:50%;
  background:radial-gradient(circle at 35% 35%,#f4e2b8,#a8834a 60%,#5e4220);box-shadow:0 0 0 2px ${UI.ink}}
.hr-banner::before{left:12px}
.hr-banner::after{right:12px}
.hr-h,.hr-name{margin:0;color:${UI.cream};text-shadow:${outlineShadow(2.6)};font-weight:700;line-height:1.08;letter-spacing:.01em}
.hr-h{font-size:42px}
.hr-name{font-size:31px;padding:0 10px}
.hr-victory .hr-h{color:${UI.yellow}}
.hr-defeat .hr-h{color:#ffb4a8}
.hr-code{align-self:center;padding:5px 14px 6px;border-radius:999px;border:3px solid ${UI.ink};background:linear-gradient(#ffd862,${UI.yellow});
  box-shadow:0 3px 0 ${UI.ink};font-size:15px;font-weight:700;letter-spacing:.08em;color:${UI.ink}}
.hr-sub{margin:0;font-size:16px;font-weight:600;color:#6b5440}
.hr-banner .hr-sub{color:#f6e3bf;text-shadow:${outlineShadow(1.6)}}
.hr-banner .hr-chip{text-shadow:none}
.hr-chip{display:inline-flex;align-items:center;gap:6px;margin-left:4px;padding:2px 10px;border-radius:999px;background:#f0dfbd;border:2px solid #d2b98a;
  font-weight:700;color:${UI.ink}}

/* Buttons: theme .tb-btn; rows of secondary buttons share the width. */
.hr-stack{display:flex;flex-direction:column;gap:12px;margin-top:4px}
.hr-pair{display:flex;gap:12px}
.hr-pair>.tb-btn{flex:1;min-width:0}

/* Boss sticker and the yellow sticky note for something new. */
.hr-boss{align-self:center;margin:2px 0 0;padding:6px 14px;border-radius:12px;border:3px solid ${UI.ink};background:linear-gradient(#f26a5f,${UI.red});
  color:#fff;text-shadow:${outlineShadow(1.6)};font-size:16px;font-weight:700;letter-spacing:.08em;box-shadow:0 3px 0 ${UI.ink};transform:rotate(-2deg)}
.hr-new{margin:2px 4px;padding:12px 14px 13px;border-radius:6px 6px 14px 6px;background:linear-gradient(170deg,#fff3a8,#ffe36e);
  border:2.5px solid rgba(43,29,18,.85);box-shadow:0 4px 0 rgba(43,29,18,.85);font-size:16px;font-weight:600;line-height:1.35;text-align:left;
  transform:rotate(-1deg)}
.hr-new b{font-weight:700;color:#a0420f}

/* Goal list: star (or tick / cross) sticker + label on a paper strip. */
.hr-goals{list-style:none;margin:0;padding:8px 10px;display:flex;flex-direction:column;gap:4px;text-align:left;border-radius:16px;
  background:rgba(214,186,138,.22);border:2.5px dashed rgba(122,79,46,.35)}
.hr-goal{display:flex;align-items:center;gap:10px;min-height:36px;font-size:17px;font-weight:600;color:${UI.ink};line-height:1.2}
.hr-goal .hr-mark{flex:none;width:30px;height:30px;display:flex;align-items:center;justify-content:center}
.hr-goal .hr-mark svg{width:30px;height:30px}
.hr-goal.hr-dim{color:#8b7560}

/* Result stars: hollow slots with the earned star popping in over each. */
.hr-stars{position:relative;display:flex;justify-content:center;align-items:flex-end;gap:2px;margin:2px 0 0;height:96px}
.hr-stars::before{content:'';position:absolute;left:50%;top:50%;width:210px;height:210px;margin:-112px 0 0 -105px;border-radius:50%;
  background:repeating-conic-gradient(from 0deg,rgba(255,197,49,.22) 0 12deg,transparent 12deg 24deg);
  -webkit-mask:radial-gradient(closest-side,#000 40%,transparent);mask:radial-gradient(closest-side,#000 40%,transparent);opacity:0;pointer-events:none}
.hr-victory .hr-stars::before{opacity:1}
.hr-slot{position:relative;width:76px;height:76px}
.hr-slot.hr-mid{width:96px;height:96px;margin-bottom:12px}
.hr-slot svg{position:absolute;inset:0;width:100%;height:100%}
.hr-slot .hr-on-star{opacity:0;transform:scale(.55)}
.hr-slot.hr-earned .hr-on-star{animation:hr-pop ${STAR_POP.durationMs}ms cubic-bezier(.2,.9,.3,1) both}
@keyframes hr-pop{0%{opacity:0;transform:scale(.55)}70%{opacity:1;transform:scale(1.08)}100%{opacity:1;transform:scale(1)}}
@media (prefers-reduced-motion: reduce){.hr-slot.hr-earned .hr-on-star{animation:none;opacity:1;transform:none}.hr-ov.hr-on .hr-card{animation:none}}
.hr-best{align-self:center;margin:0;padding:5px 16px;border-radius:999px;border:3px solid ${UI.ink};background:linear-gradient(#ffd862,${UI.yellow});
  box-shadow:0 3px 0 ${UI.ink};font-size:16px;font-weight:700;color:${UI.ink};transform:rotate(-2deg)}

/* Pause settings on an inset paper panel. */
.hr-settings{display:flex;flex-direction:column;gap:2px;margin-top:6px;padding:6px 14px;border-radius:16px;background:rgba(214,186,138,.22);
  border:2.5px dashed rgba(122,79,46,.35)}
.hr-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:52px;font-size:17px;font-weight:600;text-align:left}
.hr-toggle{position:relative;flex:none;width:84px;height:44px;margin:4px 0 6px;border:3px solid ${UI.ink};border-radius:22px;padding:0;
  background:#cdbb9a;box-shadow:inset 0 3px 0 rgba(0,0,0,.15),0 3px 0 ${UI.ink};font:inherit;font-size:14px;font-weight:700;
  color:${UI.ink};cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;transition:background 120ms}
.hr-toggle::before{content:'';position:absolute;top:3px;left:3px;width:32px;height:32px;border-radius:50%;border:3px solid ${UI.ink};box-sizing:border-box;
  background:radial-gradient(70% 60% at 35% 28%,#fff,${UI.cream} 60%,#e2cfa6);transition:transform 120ms cubic-bezier(.3,1.5,.6,1)}
.hr-toggle .hr-tlabel{position:absolute;top:0;bottom:0;right:10px;display:flex;align-items:center}
.hr-toggle[aria-pressed=true]{background:linear-gradient(#5cbf5f,${UI.green})}
.hr-toggle[aria-pressed=true]::before{transform:translateX(40px)}
.hr-toggle[aria-pressed=true] .hr-tlabel{right:auto;left:10px;color:#fff;text-shadow:${outlineShadow(1.5)}}
.hr-range{flex:1;min-width:0;height:48px;margin:0;background:none;-webkit-appearance:none;appearance:none;touch-action:manipulation}
.hr-range::-webkit-slider-runnable-track{height:14px;border-radius:7px;border:3px solid ${UI.ink};background:${WOOD_BG}}
.hr-range::-moz-range-track{height:10px;border-radius:7px;border:3px solid ${UI.ink};background:${UI.woodLight}}
.hr-range::-webkit-slider-thumb{-webkit-appearance:none;width:30px;height:30px;margin-top:-11px;border-radius:50%;border:3px solid ${UI.ink};
  background:radial-gradient(70% 60% at 35% 28%,#fff1b8,${UI.yellow} 60%,#d39a00);box-shadow:0 3px 0 ${UI.ink}}
.hr-range::-moz-range-thumb{width:26px;height:26px;border-radius:50%;border:3px solid ${UI.ink};background:${UI.yellow}}
.hr-val{min-width:48px;text-align:right;font-weight:700}
`;

let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  injectUiTheme();
  const style = document.createElement('style');
  style.dataset.tb = 'overlays';
  style.textContent = CSS;
  document.head.appendChild(style);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Sticker button: an optional decorative icon then the label (the accessible name is the label alone).
function button(text: string, variant = '', icon = ''): HTMLButtonElement {
  const b = el('button', `tb-btn ${variant}`.trim());
  b.type = 'button';
  setLabel(b, text, icon);
  return b;
}

function setLabel(b: HTMLButtonElement, text: string, icon = ''): void {
  b.innerHTML = icon;
  b.append(el('span', '', text));
}

// One goal line: a leading mark (star, tick or cross sticker) and its label.
function goalLine(markSvg: string, text: string, dim = false): HTMLLIElement {
  const li = el('li', dim ? 'hr-goal hr-dim' : 'hr-goal');
  const mark = el('span', 'hr-mark');
  mark.innerHTML = markSvg;
  li.append(mark, el('span', '', text));
  return li;
}

function banner(...children: HTMLElement[]): HTMLDivElement {
  const b = el('div', 'hr-banner');
  b.append(...children);
  return b;
}

function overlay(): HTMLDivElement {
  const o = el('div', 'hr-ov tb-backdrop');
  o.setAttribute('role', 'dialog');
  o.setAttribute('aria-modal', 'true');
  return o;
}

export function createOverlays(root: HTMLElement, settings: Settings): Overlays {
  injectStyles();

  // ----- Level card -----
  const intro = overlay();
  const iCard = el('div', 'hr-card tb-card');
  const iCode = el('div', 'hr-code');
  const iName = el('h1', 'hr-name');
  const iBoss = el('p', 'hr-boss');
  const iNew = el('p', 'hr-new');
  const iGoals = el('ul', 'hr-goals');
  const playBtn = button('Play', 'tb-yellow tb-big', playIcon(26));
  const iMapBtn = button('Map', 'tb-small', mapIcon(22));
  const iStack = el('div', 'hr-stack');
  iStack.append(playBtn, iMapBtn);
  iCard.append(banner(iCode, iName), iBoss, iNew, iGoals, iStack);
  intro.append(iCard);
  root.appendChild(intro);

  // ----- Result screen -----
  const result = overlay();
  const rCard = el('div', 'hr-card tb-card');
  const rHead = el('h1', 'hr-h');
  const rSub = el('p', 'hr-sub');
  const rStars = el('div', 'hr-stars');
  rStars.setAttribute('role', 'img');
  const slots = [0, 1, 2].map((i) => {
    const s = el('span', i === 1 ? 'hr-slot hr-mid' : 'hr-slot');
    s.innerHTML = starIcon('100%', 'tb-off') + starIcon('100%', 'hr-on-star');
    return s;
  });
  rStars.append(...slots);
  const rBest = el('p', 'hr-best', 'New best time!');
  const rGoals = el('ul', 'hr-goals');
  const rButtons = el('div', 'hr-stack');
  const rSecondary = el('div', 'hr-pair');
  const retryBtn = button('Retry', '', retryIcon(22));
  const nextBtn = button('Next level', '', nextIcon(22));
  const rMapBtn = button('Map', '', mapIcon(22));
  const resultBtn: Record<ResultAction, HTMLButtonElement> = { next: nextBtn, retry: retryBtn, map: rMapBtn };
  const resultIcon: Record<ResultAction, (s: number) => string> = { next: nextIcon, retry: retryIcon, map: mapIcon };
  rCard.append(banner(rHead, rSub), rStars, rBest, rGoals, rButtons);
  result.append(rCard);
  root.appendChild(result);

  // ----- Pause screen -----
  const pause = overlay();
  const pCard = el('div', 'hr-card tb-card');
  const pHead = el('h1', 'hr-h', 'Paused');
  const pSub = el('p', 'hr-sub');
  const resumeBtn = button('Resume', 'tb-yellow tb-big', playIcon(26));
  const restartBtn = button('Restart', '', retryIcon(22));
  const pMapBtn = button('World map', '', mapIcon(22));
  const pStack = el('div', 'hr-stack');
  pStack.append(resumeBtn, restartBtn, pMapBtn);

  const hapticsRow = el('div', 'hr-row');
  const hapticsToggle = el('button', 'hr-toggle');
  hapticsToggle.type = 'button';
  hapticsToggle.setAttribute('aria-label', 'Haptics');
  const hapticsLabel = el('span', 'hr-tlabel');
  hapticsLabel.setAttribute('aria-hidden', 'true');
  hapticsToggle.append(hapticsLabel);
  hapticsRow.append(el('span', '', 'Haptics'), hapticsToggle);

  const sensRow = el('label', 'hr-row');
  const sensRange = el('input', 'hr-range');
  sensRange.type = 'range';
  sensRange.min = '0.5';
  sensRange.max = '2';
  sensRange.step = '0.05';
  const sensVal = el('span', 'hr-val');
  sensRow.append(el('span', '', 'Sensitivity'), sensRange, sensVal);
  const pSettings = el('div', 'hr-settings');
  pSettings.append(hapticsRow, sensRow);

  pCard.append(banner(pHead, pSub), pStack, pSettings);
  pause.append(pCard);
  root.appendChild(pause);

  const syncSettings = (): void => {
    hapticsLabel.textContent = settings.haptics ? 'ON' : 'OFF';
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
      pSub.hidden = true;
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
    if (document.activeElement instanceof HTMLElement && root.contains(document.activeElement))
      document.activeElement.blur();
  }

  return {
    showLevelIntro(o) {
      iCode.textContent = `LEVEL ${o.code}`;
      iName.textContent = o.levelName;
      iBoss.textContent = o.boss ? `BOSS: ${o.boss.toUpperCase()}` : '';
      iBoss.hidden = !o.boss;
      iNew.replaceChildren();
      if (o.intro) iNew.append(el('b', '', 'New: '), o.intro);
      iNew.hidden = !o.intro;
      iGoals.replaceChildren(
        ...o.goals.map((g, i) => goalLine(starIcon(30, o.earned[i] ? '' : 'tb-off'), g, !o.earned[i])),
      );
      actions = { play: o.onPlay, map: o.onMap };
      show(intro);
    },
    showResult(outcome, o) {
      const win = outcome === 'victory';
      result.className = `hr-ov tb-backdrop ${win ? 'hr-victory' : 'hr-defeat'}`;
      rHead.textContent = win ? 'Victory!' : 'Defeat';
      rSub.replaceChildren(o.levelName);
      const chip = el('span', 'hr-chip', formatTime(o.timeSeconds));
      rSub.append(chip);

      // Stars fill in left to right; restart the CSS pop by re-adding the class after a reflow.
      const stars = o.stars;
      rStars.hidden = !stars;
      if (stars) {
        const delays = starPopDelays(3);
        slots.forEach((s, i) => {
          s.classList.remove('hr-earned');
          (s.lastElementChild as SVGElement).style.animationDelay = `${delays[i]}ms`;
        });
        void rStars.offsetWidth;
        slots.forEach((s, i) => s.classList.toggle('hr-earned', !!stars[i]));
        rStars.setAttribute('aria-label', `${stars.filter(Boolean).length} of 3 stars`);
      }
      rBest.hidden = !(win && o.newBest);
      const goals = stars && o.goals ? o.goals : [];
      rGoals.hidden = goals.length === 0;
      rGoals.replaceChildren(
        ...goals.map((g, i) => (stars?.[i] ? goalLine(tickIcon(28), g) : goalLine(crossIcon(28), g, true))),
      );

      // Primary action (yellow, big) first, where the thumb lands; the rest share a row.
      const plan = resultActions(win, o.hasNext, !!o.onMap);
      for (const [k, b] of Object.entries(resultBtn) as [ResultAction, HTMLButtonElement][]) {
        const primary = k === plan.primary;
        b.className = primary ? 'tb-btn tb-yellow tb-big' : 'tb-btn tb-small';
        setLabel(b, k === 'next' ? 'Next level' : k === 'retry' ? 'Retry' : 'Map', resultIcon[k](primary ? 26 : 22));
      }
      const primary = resultBtn[plan.primary];
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
      pSub.hidden = !rotate;
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
