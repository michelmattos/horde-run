// Level card, pause and result screens as plain HTML over the canvas, in the
// toy-box sticker style (docs/art-direction.md section 7): cream die-cut cards with an
// ink outline and a thick cardboard edge, a wooden header plank, and plastic sticker
// buttons that sink onto their extrusion when pressed. Everything is built once and
// toggled; the only animations are the card's quick springy pop-in and the result
// stars popping in one by one (scale only), and neither blocks input, so a tap on
// Play, Retry or Next acts on the very first frame. Nothing here moves the screen.
// Styles are injected once with hr- scoped classes on top of the shared theme.
// The result card can add a coin tally that counts up after the stars and a 'New!'
// sticker row for unlocks. The settings panel (sound, music and effects volume, haptics, sensitivity)
// lives on the pause card and, through showSettings, on its own card for the menus;
// every change is saved and reported through onSettingsChanged so audio follows live.
import { clampSensitivity, clampVolume, saveSettings } from '../core/settings.ts';
import type { Settings } from '../core/settings.ts';
import { isLandscapeTouch } from '../core/lifecycle.ts';
import {
  COIN_TALLY,
  coinTallyAt,
  formatCoinDelta,
  formatCount,
  formatTime,
  rangeValueAt,
  resultActions,
  starPopDelays,
  STAR_POP,
} from './uiLogic.ts';
import type { ResultAction } from './uiLogic.ts';
import { UI, WOOD_BG, injectUiTheme, outlineShadow } from './theme.ts';
import { coinIcon, crossIcon, mapIcon, nextIcon, playIcon, retryIcon, starIcon, tickIcon } from './icons.ts';

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
  // Coins from this battle: the earned sum, the new wallet total and how it adds up.
  coins?: { earned: number; total: number; lines: { label: string; amount: number }[] };
  // Things this battle unlocked, shown as 'New!' stickers under the tally.
  unlocked?: { name: string; icon?: string /* SVG markup */ }[];
}

export interface PauseOptions {
  reason: 'user' | 'hidden' | 'orientation';
  onResume(): void;
  onRestart(): void;
  onMap?(): void;
}

export interface SettingsScreenOptions {
  onClose(): void;
}

export interface OverlaysOptions {
  // Called after every settings change (already saved), so audio can follow live.
  onSettingsChanged?(s: Settings): void;
  // UI sound hooks: 'tap' on settings toggles, 'coin' when the tally starts, 'unlock' for New! stickers.
  onSound?(id: 'tap' | 'coin' | 'unlock'): void;
}

export interface Overlays {
  showLevelIntro(o: LevelIntroOptions): void;
  showResult(outcome: 'victory' | 'defeat', o: ResultOptions): void;
  /** 'orientation' shows "Rotate to portrait" and hides Resume until a touch device is portrait again. */
  showPause(o: PauseOptions): void;
  /** The same settings panel on its own card (from menus), with a Done button and no battle buttons. */
  showSettings(o: SettingsScreenOptions): void;
  hide(): void;
  readonly visible: boolean;
}

const THUMB = 36; // slider thumb diameter, px

const CSS = `
.hr-ov{position:fixed;inset:0;height:var(--app-h);z-index:10;display:none;align-items:center;justify-content:center;overflow-y:auto;
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
.hr-ov-boss{align-self:center;margin:2px 0 0;padding:6px 14px;border-radius:12px;border:3px solid ${UI.ink};background:linear-gradient(#f26a5f,${UI.red});
  color:#fff;text-shadow:${outlineShadow(1.6)};font-size:16px;font-weight:700;letter-spacing:.08em;box-shadow:0 3px 0 ${UI.ink};transform:rotate(-2deg)}
.hr-ov-new{margin:2px 4px;padding:12px 14px 13px;border-radius:6px 6px 14px 6px;background:linear-gradient(170deg,#fff3a8,#ffe36e);
  border:2.5px solid rgba(43,29,18,.85);box-shadow:0 4px 0 rgba(43,29,18,.85);font-size:16px;font-weight:600;line-height:1.35;text-align:left;
  transform:rotate(-1deg)}
.hr-ov-new b{font-weight:700;color:#a0420f}

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
.hr-ov-slot{position:relative;width:76px;height:76px}
.hr-ov-slot.hr-mid{width:96px;height:96px;margin-bottom:12px}
.hr-ov-slot svg{position:absolute;inset:0;width:100%;height:100%}
.hr-ov-slot .hr-on-star{opacity:0;transform:scale(.55)}
.hr-ov-slot.hr-earned .hr-on-star{animation:hr-ov-pop ${STAR_POP.durationMs}ms cubic-bezier(.2,.9,.3,1) both}
@keyframes hr-ov-pop{0%{opacity:0;transform:scale(.55)}70%{opacity:1;transform:scale(1.08)}100%{opacity:1;transform:scale(1)}}
@media (prefers-reduced-motion: reduce){.hr-ov-slot.hr-earned .hr-on-star{animation:none;opacity:1;transform:none}.hr-ov.hr-on .hr-card{animation:none}}
.hr-best{align-self:center;margin:0;padding:5px 16px;border-radius:999px;border:3px solid ${UI.ink};background:linear-gradient(#ffd862,${UI.yellow});
  box-shadow:0 3px 0 ${UI.ink};font-size:16px;font-weight:700;color:${UI.ink};transform:rotate(-2deg)}

/* Pause settings on an inset paper panel. */
.hr-settings{display:flex;flex-direction:column;gap:2px;margin-top:6px;padding:6px 14px;border-radius:16px;background:rgba(214,186,138,.22);
  border:2.5px dashed rgba(122,79,46,.35)}
.hr-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:52px;font-size:17px;font-weight:600;text-align:left}
.hr-toggle{position:relative;flex:none;width:96px;height:52px;margin:2px 0 5px;border:3px solid ${UI.ink};border-radius:26px;padding:0;
  background:#cdbb9a;box-shadow:inset 0 3px 0 rgba(0,0,0,.15),0 3px 0 ${UI.ink};font:inherit;font-size:14px;font-weight:700;
  color:${UI.ink};cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;transition:background 120ms}
.hr-toggle::before{content:'';position:absolute;top:3px;left:3px;width:40px;height:40px;border-radius:50%;border:3px solid ${UI.ink};box-sizing:border-box;
  background:radial-gradient(70% 60% at 35% 28%,#fff,${UI.cream} 60%,#e2cfa6);transition:transform 120ms cubic-bezier(.3,1.5,.6,1)}
.hr-toggle .hr-tlabel{position:absolute;top:0;bottom:0;right:12px;display:flex;align-items:center}
.hr-toggle[aria-pressed=true]{background:linear-gradient(#5cbf5f,${UI.green})}
.hr-toggle[aria-pressed=true]::before{transform:translateX(44px)}
.hr-toggle[aria-pressed=true] .hr-tlabel{right:auto;left:12px;color:#fff;text-shadow:${outlineShadow(1.5)}}
.hr-trow{cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.hr-row.hr-dim{opacity:.55}
/* Sliders: dragged by our own pointer handler (touch-action:none), tap anywhere on the track to jump. */
.hr-range{flex:1;min-width:0;height:48px;margin:0;background:none;-webkit-appearance:none;appearance:none;touch-action:none;cursor:pointer}
.hr-range::-webkit-slider-runnable-track{height:14px;border-radius:7px;border:3px solid ${UI.ink};background:${WOOD_BG}}
.hr-range::-moz-range-track{height:10px;border-radius:7px;border:3px solid ${UI.ink};background:${UI.woodLight}}
.hr-range::-webkit-slider-thumb{-webkit-appearance:none;width:${THUMB}px;height:${THUMB}px;margin-top:-${THUMB / 2 - 4}px;border-radius:50%;border:3px solid ${UI.ink};
  background:radial-gradient(70% 60% at 35% 28%,#fff1b8,${UI.yellow} 60%,#d39a00);box-shadow:0 3px 0 ${UI.ink}}
.hr-range::-moz-range-thumb{width:${THUMB - 6}px;height:${THUMB - 6}px;border-radius:50%;border:3px solid ${UI.ink};background:${UI.yellow}}
.hr-val{min-width:52px;text-align:right;font-weight:700}

/* Coin tally: big count-up on a paper strip, the lines that add up to it, the wallet total. */
.hr-ov-coins{display:flex;flex-direction:column;gap:6px;padding:8px 12px 10px;border-radius:16px;background:rgba(255,197,49,.16);
  border:2.5px dashed rgba(178,122,0,.45)}
.hr-coin-head{display:flex;align-items:center;gap:8px}
.hr-coin-head svg{flex:none;width:38px;height:38px}
.hr-coin-earned{font-size:30px;font-weight:700;line-height:1;color:#a86b00}
.hr-coin-total{margin-left:auto;padding:4px 10px;border-radius:999px;border:2.5px solid ${UI.ink};background:${UI.cream};
  box-shadow:0 2px 0 ${UI.ink};font-size:15px;font-weight:700;white-space:nowrap}
.hr-coin-lines{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.hr-coin-lines li{display:flex;justify-content:space-between;gap:10px;min-height:22px;font-size:15px;font-weight:600;color:#6b5440;text-align:left}
.hr-coin-lines b{font-weight:700;color:${UI.ink}}

/* 'New!' unlock stickers. */
.hr-unlocks{display:flex;flex-wrap:wrap;justify-content:center;gap:10px}
.hr-unlock{position:relative;display:flex;align-items:center;gap:8px;min-height:48px;padding:6px 14px 6px 8px;border-radius:14px;
  border:3px solid ${UI.ink};background:linear-gradient(170deg,#fffaf0,${UI.cream});box-shadow:0 4px 0 ${UI.ink};font-size:16px;font-weight:700;
  transform:scale(0);opacity:0}
.hr-unlock.hr-ov-pop{animation:hr-ov-pop 150ms cubic-bezier(.2,.9,.3,1) both}
.hr-unlock-ico{flex:none;width:36px;height:36px;display:flex;align-items:center;justify-content:center}
.hr-unlock-ico svg{width:36px;height:36px}
.hr-newtag{position:absolute;top:-12px;right:-10px;padding:2px 7px;border-radius:9px;border:2.5px solid ${UI.ink};
  background:linear-gradient(#f26a5f,${UI.red});color:#fff;text-shadow:${outlineShadow(1.3)};font-size:12px;letter-spacing:.06em;
  box-shadow:0 2px 0 ${UI.ink};transform:rotate(8deg)}
@media (prefers-reduced-motion: reduce){.hr-unlock{transform:none;opacity:1}.hr-unlock.hr-ov-pop{animation:none}}
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

// Sticker on/off switch in a settings row. The row is a <label>, so tapping the name
// toggles too and the hit area is the whole 52 px row.
function toggleRow(label: string): { row: HTMLLabelElement; btn: HTMLButtonElement; set(on: boolean): void } {
  const row = el('label', 'hr-row hr-trow');
  const btn = el('button', 'hr-toggle');
  btn.type = 'button';
  btn.setAttribute('aria-label', label);
  const text = el('span', 'hr-tlabel');
  text.setAttribute('aria-hidden', 'true');
  btn.append(text);
  row.append(el('span', '', label), btn);
  return {
    row,
    btn,
    set(on) {
      text.textContent = on ? 'ON' : 'OFF';
      btn.setAttribute('aria-pressed', String(on));
    },
  };
}

// Slider row. Touch drags are handled here (touch-action:none on the input): a tap
// anywhere on the track jumps the thumb there and the drag follows the finger, which
// beats iOS's grab-the-thumb-first native slider. Keyboard input still works natively.
function sliderRow(
  label: string,
  range: { min: number; max: number; step: number },
  onInput: (v: number) => void,
  onCommit: () => void,
): { row: HTMLLabelElement; input: HTMLInputElement; val: HTMLSpanElement } {
  const row = el('label', 'hr-row');
  const input = el('input', 'hr-range');
  input.type = 'range';
  input.min = String(range.min);
  input.max = String(range.max);
  input.step = String(range.step);
  const val = el('span', 'hr-val');
  row.append(el('span', '', label), input, val);
  let dragId = -1;
  const follow = (clientX: number): void => {
    const r = input.getBoundingClientRect();
    const v = rangeValueAt(clientX, r.left, r.width, THUMB, range.min, range.max, range.step);
    if (parseFloat(input.value) === v) return;
    input.value = String(v);
    onInput(v);
  };
  input.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    dragId = e.pointerId;
    try {
      input.setPointerCapture(e.pointerId);
    } catch {
      // Capture can fail if the pointer is already gone; the tap still sets the value.
    }
    follow(e.clientX);
  });
  input.addEventListener('pointermove', (e) => {
    if (e.pointerId === dragId) follow(e.clientX);
  });
  const end = (e: PointerEvent): void => {
    if (e.pointerId !== dragId) return;
    dragId = -1;
    onCommit();
  };
  input.addEventListener('pointerup', end);
  input.addEventListener('pointercancel', end);
  input.addEventListener('input', () => onInput(parseFloat(input.value)));
  input.addEventListener('change', onCommit);
  return { row, input, val };
}

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function createOverlays(root: HTMLElement, settings: Settings, opts: OverlaysOptions = {}): Overlays {
  injectStyles();

  // ----- Level card -----
  const intro = overlay();
  const iCard = el('div', 'hr-card tb-card');
  const iCode = el('div', 'hr-code');
  const iName = el('h1', 'hr-name');
  const iBoss = el('p', 'hr-ov-boss');
  const iNew = el('p', 'hr-ov-new');
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
    const s = el('span', i === 1 ? 'hr-ov-slot hr-mid' : 'hr-ov-slot');
    s.innerHTML = starIcon('100%', 'tb-off') + starIcon('100%', 'hr-on-star');
    return s;
  });
  rStars.append(...slots);
  const rBest = el('p', 'hr-best', 'New best time!');
  const rGoals = el('ul', 'hr-goals');
  // Coin tally: '+N' counting up, the wallet total, and the lines that add up to N.
  const rCoins = el('div', 'hr-ov-coins');
  const coinHead = el('div', 'hr-coin-head');
  const coinIco = el('span', '');
  coinIco.setAttribute('aria-hidden', 'true');
  coinIco.innerHTML = coinIcon(38);
  const coinEarned = el('b', 'hr-coin-earned');
  const coinTotal = el('span', 'hr-coin-total');
  coinHead.append(coinIco, coinEarned, coinTotal);
  const coinLines = el('ul', 'hr-coin-lines');
  rCoins.append(coinHead, coinLines);
  const rUnlocks = el('div', 'hr-unlocks');
  const rButtons = el('div', 'hr-stack');
  const rSecondary = el('div', 'hr-pair');
  const retryBtn = button('Retry', '', retryIcon(22));
  const nextBtn = button('Next level', '', nextIcon(22));
  const rMapBtn = button('Map', '', mapIcon(22));
  const resultBtn: Record<ResultAction, HTMLButtonElement> = { next: nextBtn, retry: retryBtn, map: rMapBtn };
  const resultIcon: Record<ResultAction, (s: number) => string> = { next: nextIcon, retry: retryIcon, map: mapIcon };
  rCard.append(banner(rHead, rSub), rStars, rBest, rGoals, rCoins, rUnlocks, rButtons);
  result.append(rCard);
  root.appendChild(result);

  // ----- Settings panel (on the pause card, or on its own card from menus) -----
  const changed = (save: boolean): void => {
    if (save) saveSettings(settings);
    opts.onSettingsChanged?.(settings);
  };
  const haptics = toggleRow('Haptics');
  const sound = toggleRow('Sound');
  const volumeRow = (label: string, key: 'musicVolume' | 'sfxVolume'): ReturnType<typeof sliderRow> => {
    const r = sliderRow(
      label,
      { min: 0, max: 1, step: 0.05 },
      (v) => {
        settings[key] = clampVolume(v);
        r.val.textContent = `${Math.round(settings[key] * 100)}%`;
        changed(false);
      },
      () => changed(true),
    );
    return r;
  };
  const musicVol = volumeRow('Music', 'musicVolume');
  const sfxVol = volumeRow('Effects', 'sfxVolume');
  const sens = sliderRow(
    'Sensitivity',
    { min: 0.5, max: 2, step: 0.05 },
    (v) => {
      settings.sensitivity = clampSensitivity(v);
      sens.val.textContent = `${settings.sensitivity.toFixed(2)}x`;
      changed(false);
    },
    () => changed(true),
  );
  const panel = el('div', 'hr-settings');
  panel.append(sound.row, musicVol.row, sfxVol.row, haptics.row, sens.row);

  const syncSettings = (): void => {
    haptics.set(settings.haptics);
    sound.set(settings.sound);
    for (const [r, v] of [
      [musicVol, settings.musicVolume],
      [sfxVol, settings.sfxVolume],
    ] as const) {
      r.row.classList.toggle('hr-dim', !settings.sound);
      r.input.value = String(v);
      r.val.textContent = `${Math.round(v * 100)}%`;
    }
    sens.input.value = String(settings.sensitivity);
    sens.val.textContent = `${settings.sensitivity.toFixed(2)}x`;
  };
  haptics.btn.addEventListener('click', () => {
    settings.haptics = !settings.haptics;
    syncSettings();
    changed(true);
    opts.onSound?.('tap');
  });
  sound.btn.addEventListener('click', () => {
    settings.sound = !settings.sound;
    syncSettings();
    changed(true);
    opts.onSound?.('tap'); // heard only when sound just went on: a preview
  });

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
  pCard.append(banner(pHead, pSub), pStack, panel);
  pause.append(pCard);
  root.appendChild(pause);

  // ----- Settings screen (menus) -----
  const settingsOv = overlay();
  const sCard = el('div', 'hr-card tb-card');
  const doneBtn = button('Done', 'tb-yellow tb-big', tickIcon(28));
  sCard.append(banner(el('h1', 'hr-h', 'Settings')), doneBtn);
  settingsOv.append(sCard);
  root.appendChild(settingsOv);

  // ----- Actions: each screen's callbacks fire at most once, so a double tap can't restart twice -----
  let actions: {
    retry?: () => void;
    next?: () => void;
    resume?: () => void;
    restart?: () => void;
    play?: () => void;
    map?: () => void;
    close?: () => void;
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
  doneBtn.addEventListener('click', () => fire('close'));
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

  // ----- Result tally timing: the count-up starts once the stars have popped -----
  let tallyTimer = 0;
  let tallyRaf = 0;
  const stopTally = (): void => {
    clearTimeout(tallyTimer);
    cancelAnimationFrame(tallyRaf);
  };
  const showTally = (earned: number, total: number): void => {
    const v = coinTallyAt(earned, total, 0, 0);
    coinEarned.textContent = formatCoinDelta(v.earned);
    coinTotal.textContent = `Total ${formatCount(v.total)}`;
  };
  const popUnlocks = (): void => {
    const items = Array.from(rUnlocks.children) as HTMLElement[];
    if (items.length === 0) return;
    items.forEach((u, i) => {
      u.style.animationDelay = `${i * 120}ms`;
      u.classList.add('hr-ov-pop');
    });
    opts.onSound?.('unlock');
  };
  const runTally = (coins: ResultOptions['coins']): void => {
    if (!coins || reducedMotion()) {
      if (coins) showTally(coins.earned, coins.total);
      tallyTimer = window.setTimeout(popUnlocks, coins ? 0 : COIN_TALLY.delayMs);
      return;
    }
    const start = coinTallyAt(coins.earned, coins.total, 0);
    coinEarned.textContent = formatCoinDelta(start.earned);
    coinTotal.textContent = `Total ${formatCount(start.total)}`;
    tallyTimer = window.setTimeout(() => {
      if (coins.earned > 0) opts.onSound?.('coin');
      const t0 = performance.now();
      const step = (): void => {
        const t = performance.now() - t0;
        const v = coinTallyAt(coins.earned, coins.total, t);
        coinEarned.textContent = formatCoinDelta(v.earned);
        coinTotal.textContent = `Total ${formatCount(v.total)}`;
        if (t < COIN_TALLY.durationMs) tallyRaf = requestAnimationFrame(step);
        else popUnlocks();
      };
      step();
    }, COIN_TALLY.delayMs);
  };

  const show = (node: HTMLElement): void => {
    if (current && current !== node) current.classList.remove('hr-on');
    if (current === result && node !== result) stopTally();
    current = node;
    node.classList.add('hr-on');
  };
  function hide(): void {
    stopTally();
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
      stopTally();
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

      // Coins and unlocks.
      const coins = o.coins;
      rCoins.hidden = !coins;
      if (coins) {
        rCoins.setAttribute('aria-label', `${coins.earned} coins earned, ${coins.total} in total`);
        coinLines.replaceChildren(
          ...coins.lines.map((l) => {
            const li = el('li', '');
            li.append(el('span', '', l.label), el('b', '', formatCoinDelta(l.amount)));
            return li;
          }),
        );
        coinLines.hidden = coins.lines.length === 0;
      }
      const unlocked = o.unlocked ?? [];
      rUnlocks.hidden = unlocked.length === 0;
      rUnlocks.replaceChildren(
        ...unlocked.map((u) => {
          const item = el('div', 'hr-unlock');
          if (u.icon) {
            const ico = el('span', 'hr-unlock-ico');
            ico.setAttribute('aria-hidden', 'true');
            ico.innerHTML = u.icon;
            item.append(ico);
          }
          item.append(el('span', '', u.name), el('span', 'hr-newtag', 'NEW!'));
          item.setAttribute('aria-label', `New: ${u.name}`);
          return item;
        }),
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
      result.scrollTop = 0;
      if (coins || unlocked.length > 0) runTally(coins);
    },
    showPause(o) {
      const rotate = o.reason === 'orientation' && isLandscapeTouch();
      pHead.textContent = rotate ? 'Rotate to portrait' : 'Paused';
      pSub.textContent = rotate ? 'Horde Run plays in portrait.' : '';
      pSub.hidden = !rotate;
      resumeBtn.hidden = rotate;
      pMapBtn.hidden = !o.onMap;
      pCard.append(panel);
      syncSettings();
      actions = { resume: o.onResume, restart: o.onRestart, map: o.onMap };
      show(pause);
    },
    showSettings(o) {
      sCard.insertBefore(panel, doneBtn);
      syncSettings();
      actions = { close: o.onClose };
      show(settingsOv);
      settingsOv.scrollTop = 0;
    },
    hide,
    get visible() {
      return current !== null;
    },
  };
}
