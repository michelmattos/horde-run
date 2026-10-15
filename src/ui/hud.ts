// In-battle HUD in the toy-box sticker style (docs/art-direction.md section 7).
//
// It is DOM over the canvas (not Babylon GUI) so it gets the self-hosted rounded font,
// real outlines and gradients, and costs no draw calls. The layer is
// pointer-events:none, so drags reach the canvas; only the pause and CHAMP buttons
// take touches. Both are also registered as blocked regions with the input, and the
// CHAMP hit circle extends a little past its ring (as before), so a second finger can
// press it while the first keeps aiming. Per frame, update() only writes what
// changed; HP fills and the charge ring move with transforms / dash offsets.
// Feedback is colour and small scale pops on HUD widgets only: nothing here moves the
// camera or the screen. Sizes live in HUD_METRICS (uiLogic.ts), which hudReserve()
// also uses, so the camera framing keeps exactly the covered strips clear.
// In an Expedition run, setRun() adds a static strip under the top bar (run HP, gold,
// the elite/boss tag and the upgrade icons). It is built once per battle, never touched
// by update(), takes no touches, and hudReserve() grows by its height while it is set.
import type { Scene } from '@babylonjs/core/scene';
import type { BattleState } from '../contracts.ts';
import type { Input } from '../core/input.ts';
import { readSafeAreaInsets } from './safeArea.ts';
import {
  HUD_METRICS as M,
  formatCount,
  formatRunHp,
  formatStacks,
  hpFraction,
  hudReserveFor,
  hudStarLook,
  hudTopHeight,
  pipLit,
  ringDashOffset,
  runIconSlots,
  runStatusLabel,
  runTagText,
  runUpgradesLabel,
  splitRunIcons,
} from './uiLogic.ts';
import type { GoalState } from './uiLogic.ts';
import { UI, WOOD_BG, injectUiTheme, outlineShadow } from './theme.ts';
import {
  championIcon,
  coinIcon,
  crossIcon,
  fortIcon,
  heartIcon,
  pauseIcon,
  soldierIcon,
  starIcon,
  tickIcon,
} from './icons.ts';

// Optional per-level extras. goals: the three stars (win, base above half, target time).
export interface HudInfo {
  bossName?: string;
  bossPhases?: number;
  goals?: readonly GoalState[];
}

// Expedition run status for the run strip. Run HP and gold change only between battles.
export interface HudRunInfo {
  hp: number;
  maxHp: number;
  gold: number;
  kind: 'battle' | 'elite' | 'boss';
  upgrades: readonly { icon: string /* inline SVG markup supplied by the caller */; label: string; stacks: number }[];
}

export interface Hud {
  update(state: BattleState, levelName: string, info?: HudInfo): void;
  // Call once per battle before the level loads (the framing reads hudReserve() then);
  // null in the campaign hides the strip.
  setRun(run: HudRunInfo | null): void;
  setVisible(v: boolean): void;
  dispose(): void;
}

const MAX_PIPS = 6;
const HIT_SLOP = 8;
const RING_STROKE = 8;
const RING_R = (M.champRing - RING_STROKE) / 2;
const RING_C = 2 * Math.PI * RING_R;
const PRESS_MS = 120;
const LEVEL_NAME_SECONDS = 3; // battle seconds the level name stays under the enemy bar
const RUN_LEFT_GUESS = 190; // left chips' width before the strip has been laid out once

// The HUD whose run strip is showing (one HUD exists at a time; null in the campaign).
let runStripOwner: object | null = null;

// CSS px of the canvas the HUD covers at the top and bottom (safe-area insets included),
// for the camera framing. Includes the run strip while an Expedition battle is set.
export function hudReserve(): { top: number; bottom: number; topBar: number } {
  return hudReserveFor(readSafeAreaInsets(), runStripOwner !== null);
}

const SAT = 'env(safe-area-inset-top,0px)';
const SAB = 'env(safe-area-inset-bottom,0px)';
const SAL = 'env(safe-area-inset-left,0px)';
const SAR = 'env(safe-area-inset-right,0px)';

const CSS = `
.tb-hud{position:absolute;inset:0;z-index:4;pointer-events:none;overflow:hidden;font-family:var(--tb-font);
  font-variant-numeric:tabular-nums;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
.tb-hud[hidden]{display:none}
.tb-hud button{pointer-events:auto;touch-action:none;-webkit-tap-highlight-color:transparent;font:inherit;padding:0;margin:0;cursor:pointer}

/* ----- Top ----- */
.tb-top{position:absolute;top:calc(${SAT} + ${M.topPad}px);left:calc(${SAL} + ${M.edge}px);right:calc(${SAR} + ${M.edge}px);
  height:${Math.max(M.pause, M.barH + M.rowGap + M.row2H)}px;display:flex;gap:10px}
.tb-pause{flex:none;position:relative;width:${M.pause}px;height:${M.pause}px;border-radius:50%;border:3.5px solid ${UI.ink};
  background:radial-gradient(90% 70% at 35% 22%,rgba(255,230,190,.45),transparent 55%),${WOOD_BG};
  box-shadow:inset 0 -3px 0 rgba(0,0,0,.25),0 4px 0 #26160b,0 4px 0 3px ${UI.ink},0 8px 10px rgba(20,10,2,.3);
  display:flex;align-items:center;justify-content:center;transition:transform 90ms cubic-bezier(.3,1.6,.6,1)}
.tb-pause.tb-down{transform:translateY(4px)}
.tb-pause svg{width:30px;height:30px}
.tb-main{flex:1;min-width:0;position:relative}
.tb-ebar{position:absolute;left:0;right:0;top:0;height:${M.barH}px}
.tb-frame{position:absolute;inset:0 0 0 18px;border-radius:${M.barH / 2}px;border:3px solid ${UI.ink};padding:4px;box-sizing:border-box;
  background:${WOOD_BG};box-shadow:inset 0 2px 0 rgba(255,225,180,.3),0 3px 0 ${UI.ink},0 6px 8px rgba(20,10,2,.3)}
.tb-track{position:relative;height:100%;border-radius:999px;overflow:hidden;background:linear-gradient(180deg,#140b05,#2a1a0e 45%,#382414);
  box-shadow:inset 0 2px 3px rgba(0,0,0,.7),0 0 0 2px #1a0f07;transform:translateZ(0)}
.tb-fill{position:absolute;inset:0;border-radius:999px;transform-origin:0 50%;will-change:transform;
  transition:transform 120ms ease-out}
.tb-fill::after{content:'';position:absolute;left:8px;right:8px;top:2px;height:26%;border-radius:999px;background:rgba(255,255,255,.3)}
.tb-fill-tan{background:linear-gradient(180deg,#f7ebcf 0%,#e2c896 30%,#d6b47c 62%,#c8a46a 100%);
  box-shadow:inset 0 0 0 1.5px rgba(26,15,7,.9),inset 0 -3px 0 rgba(120,82,36,.45)}
.tb-fill-tan::after{background:rgba(255,255,255,.6)}
.tb-track::after{content:'';position:absolute;inset:0;border-radius:999px;pointer-events:none;
  background:repeating-linear-gradient(90deg,transparent 0 calc(10% - 2px),rgba(43,29,18,.38) calc(10% - 2px) 10%)}
.tb-fill-green{background:linear-gradient(180deg,${UI.armyLight} 0%,${UI.army} 58%,${UI.armyDark} 100%)}
.tb-ebar.tb-pulse .tb-fill-tan{animation:tb-flash 300ms ease-out}
.tb-ebar.tb-pulse .tb-frame{animation:tb-pop 150ms cubic-bezier(.3,1.6,.6,1)}
@keyframes tb-flash{0%,40%{filter:brightness(1.8)}100%{filter:none}}
@keyframes tb-pop{0%{transform:scale(1)}50%{transform:scale(1.06,1.1)}100%{transform:scale(1)}}
.tb-bar-text{position:absolute;inset:0 12px 0 50px;display:flex;align-items:center;gap:6px;color:${UI.cream};
  text-shadow:${outlineShadow(1.8)};font-weight:700;line-height:1}
.tb-boss{font-size:13px;letter-spacing:.06em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.tb-gap{flex:1}
.tb-pips{display:flex;gap:4px}
.tb-pip{width:10px;height:10px;border-radius:50%;border:2px solid ${UI.ink};background:rgba(255,246,227,.25);box-sizing:border-box}
.tb-pip.tb-lit{background:${UI.yellow};box-shadow:inset 0 -2px 0 rgba(0,0,0,.2)}
.tb-epct{font-size:15px;min-width:4ch;text-align:right;color:#fff}
.tb-eunits{flex:none;display:flex;align-items:center;gap:2px;height:${M.row2H - 4}px;padding:0 9px 0 3px;border-radius:13px;border:2.5px solid ${UI.ink};
  box-sizing:border-box;background:radial-gradient(90% 80% at 35% 25%,${UI.tanLight},${UI.tan} 60%,${UI.tanDark});box-shadow:0 2px 0 ${UI.ink};
  color:${UI.cream};text-shadow:${outlineShadow(1.6)};font-size:15px;font-weight:700;line-height:1}
.tb-eunits svg{width:20px;height:20px}
.tb-eunits[hidden]{display:none}
.tb-badge{position:absolute;box-sizing:border-box;border-radius:50%;border:3px solid ${UI.ink};display:flex;align-items:center;justify-content:center}
.tb-ebadge{left:0;top:-4px;width:42px;height:42px;
  background:radial-gradient(80% 70% at 35% 25%,${UI.tanLight},${UI.tan} 55%,${UI.tanDark});
  box-shadow:inset 0 -3px 0 rgba(0,0,0,.18),0 3px 0 ${UI.ink}}
.tb-ebadge.tb-tin{background:radial-gradient(80% 70% at 35% 25%,#f2f4f6,${UI.tin} 55%,${UI.tinDark})}
.tb-ebadge svg{width:34px;height:34px;margin-top:-2px}
.tb-row2{position:absolute;left:18px;right:0;top:${M.barH + M.rowGap}px;height:${M.row2H}px;display:flex;align-items:center;gap:8px}
.tb-level{flex:1;min-width:0;transition:opacity 600ms ease-out;font-size:17px;font-weight:700;color:#fff;text-shadow:${outlineShadow(2.2)};white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;padding:4px 4px 6px 4px}
.tb-level.tb-faded{opacity:0}
.tb-row2r{flex:none;margin-left:auto;display:flex;align-items:center;gap:8px}
.tb-goals{flex:none;display:flex;gap:2px;height:${M.row2H}px;align-items:center;padding:0 6px;border-radius:15px;border:3px solid ${UI.ink};
  box-sizing:border-box;background:${UI.cream};box-shadow:0 3px 0 ${UI.ink}}
.tb-goals[hidden]{display:none}
.tb-goal{position:relative;width:24px;height:24px}
.tb-goal .tb-star{width:24px;height:24px;transition:transform 150ms cubic-bezier(.3,1.6,.6,1)}
.tb-goal.tb-pending .tb-star-body{fill:#f3e6c8}
.tb-goal.tb-pending .tb-star-shine{fill:#fffaf0}
.tb-goal.tb-failed .tb-star-body{fill:#a39d92}
.tb-goal.tb-failed .tb-star-shine{fill:#c1bbb0}
.tb-goal.tb-failed .tb-star{opacity:.75}
.tb-goal.tb-pop .tb-star{transform:scale(1.1)}
.tb-mark{position:absolute;right:-4px;bottom:-3px;width:13px;height:13px;display:none}
.tb-mark svg{width:13px;height:13px;display:block}
.tb-goal.tb-met .tb-mark-tick,.tb-goal.tb-failed .tb-mark-cross{display:block}

/* ----- Bottom ----- */
.tb-bottom{position:absolute;left:calc(${SAL} + ${M.edge}px);right:calc(${SAR} + ${M.edge}px);bottom:calc(${SAB} + ${M.bottomPad}px);
  height:${Math.max(M.champRing + M.champTagOver, M.armyBadge + M.armyGap + M.baseBarH)}px}
.tb-army{position:absolute;left:0;bottom:0;width:min(200px,calc(100% - ${M.champRing + 16}px));height:${M.armyBadge + M.armyGap + M.baseBarH}px}
.tb-abadge{left:0;top:0;width:${M.armyBadge}px;height:${M.armyBadge}px;z-index:1;
  background:radial-gradient(80% 70% at 35% 25%,#a5dc84,${UI.army} 55%,${UI.armyDark});
  box-shadow:inset 0 -3px 0 rgba(0,0,0,.2),0 4px 0 ${UI.ink},0 6px 8px rgba(20,10,2,.3)}
.tb-abadge svg{width:40px;height:40px;margin-top:-2px}
.tb-acount{position:absolute;left:${M.armyBadge - 16}px;top:6px;height:38px;min-width:84px;padding:0 14px 0 22px;border-radius:0 19px 19px 0;
  display:flex;align-items:center;font-size:25px;font-weight:700;line-height:1;box-sizing:border-box}
.tb-acount.tb-plank{border-radius:0 19px 19px 0;border-left:0}
.tb-pbar{position:absolute;left:0;right:0;bottom:0;height:${M.baseBarH}px}
.tb-pbar .tb-frame{inset:0 0 0 14px;border-radius:${M.baseBarH / 2}px;padding:3.5px}
.tb-fbadge{left:0;top:-4px;width:32px;height:32px;
  background:radial-gradient(80% 70% at 35% 25%,#a5dc84,${UI.army} 55%,${UI.armyDark});box-shadow:0 3px 0 ${UI.ink}}
.tb-fbadge svg{width:24px;height:24px}

.tb-champ{position:absolute;right:0;bottom:${M.champTagOver}px;width:${M.champRing}px;height:${M.champRing}px;border:0;border-radius:50%;
  background:none}
.tb-champ-body{position:absolute;inset:0;transform-origin:50% 60%}
.tb-champ.tb-ready .tb-champ-body{animation:tb-bounce 1100ms cubic-bezier(.3,1.5,.6,1) infinite}
@keyframes tb-bounce{0%{transform:scale(1)}9%{transform:scale(1.08)}17%{transform:scale(.985)}24%,100%{transform:scale(1)}}
.tb-glow{position:absolute;inset:-20px;border-radius:50%;opacity:0;
  background:radial-gradient(closest-side,rgba(255,197,49,.85),rgba(255,197,49,.35) 60%,rgba(255,197,49,0))}
.tb-champ.tb-ready .tb-glow{opacity:1;animation:tb-glow 1100ms ease-in-out infinite}
@keyframes tb-glow{0%,100%{opacity:.65}10%{opacity:1}}
.tb-ring{position:absolute;inset:0;transform:rotate(-90deg)}
.tb-ring-track{fill:rgba(43,29,18,.55);stroke:rgba(43,29,18,.7)}
.tb-ring-fill{fill:none;stroke:#9be27a;stroke-linecap:round;transition:stroke-dashoffset 120ms linear}
.tb-champ.tb-ready .tb-ring-fill{stroke:${UI.yellow}}
.tb-ring-edge{fill:none;stroke:${UI.ink};stroke-width:2.5}
.tb-face{position:absolute;left:${(M.champRing - M.champFace) / 2}px;top:${(M.champRing - M.champFace) / 2 - 3}px;width:${M.champFace}px;height:${M.champFace}px;
  box-sizing:border-box;border-radius:50%;border:3.5px solid ${UI.ink};display:flex;align-items:center;justify-content:center;
  background:radial-gradient(70% 60% at 34% 24%,#b6ea8f 0%,#7cbf5e 22%,${UI.army} 58%,${UI.armyDark} 100%);
  box-shadow:inset 0 -5px 0 rgba(0,0,0,.18),inset 0 3px 0 rgba(255,255,255,.35),0 5px 0 #23461d,0 5px 0 3px ${UI.ink};
  transition:transform 90ms cubic-bezier(.3,1.6,.6,1),filter 150ms}
.tb-champ:not(.tb-ready) .tb-face{filter:saturate(.8) brightness(.92)}
.tb-champ.tb-down .tb-face{transform:translateY(4px);box-shadow:inset 0 -5px 0 rgba(0,0,0,.18),0 1px 0 #23461d,0 1px 0 3px ${UI.ink}}
.tb-face svg{width:60px;height:60px;margin:-2px 0 0 2px}
.tb-champ:not(.tb-ready) .tb-face svg{opacity:.8}
.tb-tag{position:absolute;left:50%;bottom:-${M.champTagOver + 2}px;transform:translateX(-50%);height:24px;padding:0 10px;border-radius:12px;
  border:3px solid ${UI.ink};box-sizing:border-box;display:flex;align-items:center;font-size:14px;font-weight:700;letter-spacing:.06em;
  color:${UI.cream};text-shadow:${outlineShadow(1.5)};background:${WOOD_BG};box-shadow:0 3px 0 ${UI.ink};white-space:nowrap}
.tb-champ.tb-ready .tb-tag{background:linear-gradient(#ffd862,${UI.yellow});color:${UI.ink};text-shadow:none}
/* ----- Expedition run strip (static; under the top bar, no touches) ----- */
.tb-run{position:absolute;top:calc(${SAT} + ${M.topPad + hudTopHeight() + M.runGap}px);left:calc(${SAL} + ${M.edge}px);
  right:calc(${SAR} + ${M.edge}px);height:${M.runH}px;display:flex;align-items:center;gap:6px;pointer-events:none}
.tb-run[hidden]{display:none}
.tb-run-l{flex:none;display:flex;align-items:center;gap:6px}
.tb-rchip{position:relative;flex:none;display:flex;align-items:center;gap:4px;height:${M.runH - 6}px;margin-left:11px;padding:0 8px 0 16px;
  border-radius:13px;border:2.5px solid ${UI.ink};box-sizing:border-box;background:${WOOD_BG};box-shadow:0 2px 0 ${UI.ink};
  color:${UI.cream};text-shadow:${outlineShadow(1.6)};font-size:15px;font-weight:700;line-height:1}
.tb-rchip>svg{position:absolute;left:-12px;top:50%;width:26px;height:26px;margin-top:-13px}
.tb-rhp-track{position:relative;width:32px;height:9px;border-radius:999px;overflow:hidden;background:#1d1108;
  box-shadow:inset 0 1px 2px rgba(0,0,0,.7),0 0 0 1.5px ${UI.ink}}
.tb-rhp-fill{position:absolute;inset:0;border-radius:999px;transform-origin:0 50%;
  background:linear-gradient(180deg,#ff8a7f 0%,${UI.red} 55%,#a8261d 100%)}
.tb-rhp-fill::after{content:'';position:absolute;left:3px;right:3px;top:1px;height:30%;border-radius:999px;background:rgba(255,255,255,.4)}
.tb-rgold{color:#ffe08a}
.tb-rtag{flex:none;height:22px;padding:0 6px;border-radius:9px;border:2.5px solid ${UI.ink};box-sizing:border-box;display:flex;align-items:center;
  font-size:12px;font-weight:700;letter-spacing:.08em;color:#fff;text-shadow:${outlineShadow(1.3)};box-shadow:0 2px 0 ${UI.ink};transform:rotate(-3deg)}
.tb-rtag[hidden]{display:none}
.tb-rtag-elite{background:linear-gradient(#5b8fe6,${UI.blue})}
.tb-rtag-boss{background:linear-gradient(#f26a5f,${UI.red})}
.tb-run-r{flex:1;min-width:0;display:flex;justify-content:flex-end;align-items:center;gap:${M.runIconGap}px}
.tb-rup{position:relative;flex:none;width:${M.runIcon}px;height:${M.runIcon}px;box-sizing:border-box;border-radius:9px;border:2.5px solid ${UI.ink};
  background:radial-gradient(80% 70% at 35% 25%,#fffaf0,${UI.cream} 55%,#ecd9b4);box-shadow:0 2px 0 ${UI.ink};
  display:flex;align-items:center;justify-content:center}
.tb-rup>svg{width:${M.runIcon - 7}px;height:${M.runIcon - 7}px}
.tb-rstack{position:absolute;right:-6px;bottom:-6px;min-width:17px;height:15px;padding:0 3px;box-sizing:border-box;border-radius:8px;
  border:2px solid ${UI.ink};background:${UI.yellow};color:${UI.ink};font-size:10px;font-weight:700;line-height:11px;text-align:center}
.tb-rmore{flex:none;height:${M.runIcon - 4}px;min-width:${M.runIcon}px;padding:0 6px;box-sizing:border-box;border-radius:13px;border:2.5px solid ${UI.ink};
  background:${WOOD_BG};box-shadow:0 2px 0 ${UI.ink};display:flex;align-items:center;justify-content:center;
  color:${UI.cream};text-shadow:${outlineShadow(1.4)};font-size:14px;font-weight:700;line-height:1}

@media (prefers-reduced-motion: reduce){.tb-champ.tb-ready .tb-champ-body,.tb-champ.tb-ready .tb-glow{animation:none}}
`;

let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  injectUiTheme();
  const style = document.createElement('style');
  style.dataset.tb = 'hud';
  style.textContent = CSS;
  document.head.appendChild(style);
}

function div(cls: string, html = ''): HTMLDivElement {
  const e = document.createElement('div');
  e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

function hpBar(kind: 'enemy' | 'player'): { root: HTMLDivElement; fill: HTMLDivElement; text: HTMLDivElement } {
  const root = div(kind === 'enemy' ? 'tb-ebar' : 'tb-pbar');
  const frame = div('tb-frame');
  const track = div('tb-track');
  const fill = div(`tb-fill ${kind === 'enemy' ? 'tb-fill-tan' : 'tb-fill-green'}`);
  track.append(fill);
  frame.append(track);
  const text = div('tb-bar-text');
  root.append(frame, text);
  return { root, fill, text };
}

export function createHud(scene: Scene, input: Input, opts: { onPause: () => void }): Hud {
  injectStyles();
  const canvas = scene.getEngine().getRenderingCanvas() as HTMLCanvasElement;
  const host = canvas.parentElement ?? document.body;

  const hud = div('tb-hud');
  hud.setAttribute('role', 'group');
  hud.setAttribute('aria-label', 'Battle HUD');

  // ----- Top: pause, enemy base HP (tan army badge + count, boss name and phase pips), level + goal stars -----
  const top = div('tb-top');
  const pause = document.createElement('button');
  pause.type = 'button';
  pause.className = 'tb-pause';
  pause.setAttribute('aria-label', 'Pause');
  pause.tabIndex = -1;
  pause.innerHTML = pauseIcon(30);
  const main = div('tb-main');
  const enemy = hpBar('enemy');
  const eBadge = div('tb-badge tb-ebadge', soldierIcon(34, UI.cream));
  enemy.root.append(eBadge);
  const bossText = document.createElement('span');
  bossText.className = 'tb-boss';
  const pipsBox = document.createElement('span');
  pipsBox.className = 'tb-pips';
  const pips: HTMLSpanElement[] = [];
  for (let i = 0; i < MAX_PIPS; i++) {
    const p = document.createElement('span');
    p.className = 'tb-pip';
    p.hidden = true;
    pipsBox.append(p);
    pips.push(p);
  }
  // The bar shows the base's HP as a percentage; the enemy soldier count lives in its own
  // tan badge under the bar (a bare count on an HP bar read as 'enemy HP 0').
  const ePct = document.createElement('span');
  ePct.className = 'tb-epct';
  ePct.setAttribute('aria-label', 'Enemy base health');
  enemy.text.append(bossText, div('tb-gap'), pipsBox, ePct);
  const eUnits = div('tb-eunits', soldierIcon(20, UI.cream));
  eUnits.setAttribute('aria-label', 'Enemy soldiers');
  const eCount = document.createElement('span');
  eUnits.append(eCount);
  eUnits.hidden = true;

  const row2 = div('tb-row2');
  const levelText = div('tb-level');
  const goalsBox = div('tb-goals');
  goalsBox.hidden = true;
  const goalEls: HTMLDivElement[] = [];
  for (let i = 0; i < 3; i++) {
    const g = div(
      'tb-goal tb-pending',
      starIcon(24) +
        `<span class="tb-mark tb-mark-tick">${tickIcon(13)}</span><span class="tb-mark tb-mark-cross">${crossIcon(13)}</span>`,
    );
    goalEls.push(g);
    goalsBox.append(g);
  }
  const row2Right = div('tb-row2r');
  row2Right.append(eUnits, goalsBox);
  row2.append(levelText, row2Right);
  main.append(enemy.root, row2);
  top.append(pause, main);

  // ----- Bottom: army badge + count, player base HP, CHAMP button -----
  const bottom = div('tb-bottom');
  const army = div('tb-army');
  const aBadge = div('tb-badge tb-abadge', soldierIcon(40, UI.cream));
  const aCount = div('tb-acount tb-plank tb-outline-cream');
  aCount.setAttribute('aria-label', 'Your army');
  const player = hpBar('player');
  player.root.append(div('tb-badge tb-fbadge', fortIcon(24, UI.cream, UI.yellow)));
  army.append(player.root, aBadge, aCount);

  const champ = document.createElement('button');
  champ.type = 'button';
  champ.className = 'tb-champ';
  champ.setAttribute('aria-label', 'Champion');
  champ.tabIndex = -1;
  const S = M.champRing;
  champ.innerHTML =
    `<div class="tb-champ-body"><div class="tb-glow"></div>` +
    `<svg class="tb-ring" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" aria-hidden="true">` +
    `<circle class="tb-ring-track" cx="${S / 2}" cy="${S / 2}" r="${S / 2 - 1.5}" stroke-width="3"/>` +
    `<circle class="tb-ring-fill" cx="${S / 2}" cy="${S / 2}" r="${RING_R}" stroke-width="${RING_STROKE}" stroke-dasharray="${RING_C.toFixed(2)}" stroke-dashoffset="${RING_C.toFixed(2)}"/>` +
    `<circle class="tb-ring-edge" cx="${S / 2}" cy="${S / 2}" r="${S / 2 - 1.25}"/>` +
    `</svg><div class="tb-face">${championIcon(60, UI.cream)}</div><div class="tb-tag">CHAMP</div></div>`;
  const ringFill = champ.querySelector('.tb-ring-fill') as SVGCircleElement;
  const champTag = champ.querySelector('.tb-tag') as HTMLDivElement;
  bottom.append(army, champ);

  // ----- Expedition run strip: heart (run HP) + coin (gold) + tag on the left, upgrade icons on the right -----
  const run = div('tb-run');
  run.hidden = true;
  const runLeft = div('tb-run-l');
  const hpChip = div('tb-rchip', heartIcon(26));
  const hpTrack = div('tb-rhp-track');
  const hpFill = div('tb-rhp-fill');
  hpTrack.append(hpFill);
  const hpText = document.createElement('span');
  hpChip.append(hpTrack, hpText);
  const goldChip = div('tb-rchip', coinIcon(26));
  const goldText = document.createElement('span');
  goldText.className = 'tb-rgold';
  goldChip.append(goldText);
  const runTag = div('tb-rtag');
  runLeft.append(hpChip, goldChip, runTag);
  const runIcons = div('tb-run-r');
  run.append(runLeft, runIcons);

  hud.append(top, run, bottom);
  host.appendChild(hud);

  // ----- Hits -----
  let visible = true;
  let disposed = false;
  const inChampion = (x: number, y: number): boolean => {
    if (!visible || disposed) return false;
    const r = champ.getBoundingClientRect();
    if (r.width === 0) return false;
    const dx = x - (r.left + r.width / 2);
    const dy = y - (r.top + r.height / 2);
    const rad = r.width / 2 + HIT_SLOP;
    return dx * dx + dy * dy <= rad * rad;
  };
  const inPause = (x: number, y: number): boolean => {
    if (!visible || disposed) return false;
    const r = pause.getBoundingClientRect();
    if (r.width === 0) return false;
    return x >= r.left - HIT_SLOP && x <= r.right + HIT_SLOP && y >= r.top - HIT_SLOP && y <= r.bottom + HIT_SLOP;
  };
  input.addBlockedRegion(inChampion);
  input.addBlockedRegion(inPause);

  let champTimer = 0;
  let pauseTimer = 0;
  const pressChampion = (): void => {
    input.pressChampion();
    champ.classList.add('tb-down');
    clearTimeout(champTimer);
    champTimer = window.setTimeout(() => champ.classList.remove('tb-down'), PRESS_MS);
  };
  const doPause = (): void => {
    pause.classList.add('tb-down');
    clearTimeout(pauseTimer);
    pauseTimer = window.setTimeout(() => pause.classList.remove('tb-down'), PRESS_MS);
    opts.onPause();
  };
  const onChampDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    pressChampion();
  };
  const onPauseDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    doPause();
  };
  // Touches just outside the buttons land on the canvas: same slop as the blocked regions.
  const onCanvasDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (inChampion(e.clientX, e.clientY)) pressChampion();
    else if (inPause(e.clientX, e.clientY)) doPause();
  };
  champ.addEventListener('pointerdown', onChampDown);
  pause.addEventListener('pointerdown', onPauseDown);
  canvas.addEventListener('pointerdown', onCanvasDown, { capture: true });

  // Icons that fit the row right now; redone on setRun, on show and on resize only.
  let runInfo: HudRunInfo | null = null;
  let laidOutSlots = -1;
  const layoutRunIcons = (): void => {
    if (!runInfo || hud.hidden) return;
    const stripW = run.clientWidth || window.innerWidth - 2 * M.edge;
    const leftW = runLeft.offsetWidth || RUN_LEFT_GUESS;
    const slots = runIconSlots(stripW - leftW - 6);
    if (slots === laidOutSlots) return;
    laidOutSlots = slots;
    const { shown, more } = splitRunIcons(runInfo.upgrades, slots);
    runIcons.replaceChildren();
    for (const u of shown) {
      const tile = div('tb-rup', u.icon);
      const stacks = formatStacks(u.stacks);
      if (stacks) tile.append(div('tb-rstack', stacks));
      runIcons.append(tile);
    }
    if (more > 0) runIcons.append(div('tb-rmore', `+${more}`));
  };
  const onResize = (): void => {
    laidOutSlots = -1;
    layoutRunIcons();
  };
  window.addEventListener('resize', onResize);

  // ----- Per-frame update: only touch what changed -----
  let lastLevel = '';
  let lastEnemyUnits = -1;
  let lastFaded: boolean | null = null;
  let lastPlayerUnits = -1;
  let lastEnemyFill = -1;
  let lastPlayerFill = -1;
  let lastCharge = -1;
  let wasFull = false;
  let lastBoss: string | null = null;
  let lastPips = -1;
  let lastPhase = -1;
  let hasGoals = false;
  let pulseTimer = 0;
  const lastGoals: (GoalState | '')[] = ['', '', ''];
  const popTimers = [0, 0, 0];

  return {
    update(state, levelName, info) {
      if (disposed) return;
      // ----- Boss name and phase pips -----
      const boss = info?.bossName ?? '';
      if (boss !== lastBoss) {
        lastBoss = boss;
        bossText.textContent = boss.toUpperCase();
        lastLevel = ''; // re-check the level name against the new boss name
        eBadge.classList.toggle('tb-tin', boss !== '');
        lastPhase = -1;
      }
      const nPips = boss ? Math.min(MAX_PIPS, Math.max(0, info?.bossPhases ?? 0)) : 0;
      const phase = state.bossPhase ?? 0;
      if (nPips !== lastPips || phase !== lastPhase) {
        // Pulse only when the boss moves on to a later phase (a retry resets quietly).
        if (lastPhase >= 0 && phase > lastPhase && nPips === lastPips) {
          enemy.root.classList.remove('tb-pulse');
          void enemy.root.offsetWidth;
          enemy.root.classList.add('tb-pulse');
          clearTimeout(pulseTimer);
          pulseTimer = window.setTimeout(() => enemy.root.classList.remove('tb-pulse'), 320);
        }
        lastPips = nPips;
        lastPhase = phase;
        for (let i = 0; i < MAX_PIPS; i++) {
          pips[i].hidden = i >= nPips;
          pips[i].classList.toggle('tb-lit', pipLit(i, phase));
        }
      }

      // ----- Goal stars: pending (pale gold), met (gold + tick), failed (grey + cross) -----
      const goals = info?.goals;
      const wantGoals = !!goals && goals.length > 0;
      if (wantGoals !== hasGoals) {
        hasGoals = wantGoals;
        goalsBox.hidden = !wantGoals;
      }
      if (goals) {
        for (let i = 0; i < 3; i++) {
          const g: GoalState = goals[i] ?? 'pending';
          if (g === lastGoals[i]) continue;
          const changed = lastGoals[i] !== '';
          lastGoals[i] = g;
          const el = goalEls[i];
          el.className = `tb-goal ${hudStarLook(g).cls}`;
          if (changed && g !== 'pending') {
            el.classList.add('tb-pop');
            clearTimeout(popTimers[i]);
            popTimers[i] = window.setTimeout(() => el.classList.remove('tb-pop'), 150);
          }
        }
      }

      // The level name fades once the battle is under way (the title card already said it),
      // so the far end of the lane stays clear.
      const faded = state.time > LEVEL_NAME_SECONDS;
      if (faded !== lastFaded) {
        lastFaded = faded;
        levelText.classList.toggle('tb-faded', faded);
      }
      if (levelName !== lastLevel) {
        lastLevel = levelName;
        levelText.textContent = levelName;
        // The boss bar already names him: do not repeat 'Tin General' under it.
        levelText.hidden = boss !== '' && levelName.toLowerCase() === boss.toLowerCase();
      }
      const eu = Math.round(state.enemyUnits);
      if (eu !== lastEnemyUnits) {
        lastEnemyUnits = eu;
        eCount.textContent = formatCount(eu);
        eUnits.hidden = eu <= 0;
      }
      const pu = Math.round(state.playerUnits);
      if (pu !== lastPlayerUnits) {
        lastPlayerUnits = pu;
        aCount.textContent = formatCount(pu);
      }
      const ef = Math.round(hpFraction(state.enemyBaseHp, state.enemyBaseMaxHp) * 500) / 500;
      if (ef !== lastEnemyFill) {
        lastEnemyFill = ef;
        enemy.fill.style.transform = `scaleX(${ef})`;
        ePct.textContent = `${Math.ceil(ef * 100)}%`;
      }
      const pf = Math.round(hpFraction(state.playerBaseHp, state.playerBaseMaxHp) * 500) / 500;
      if (pf !== lastPlayerFill) {
        lastPlayerFill = pf;
        player.fill.style.transform = `scaleX(${pf})`;
      }

      const charge = Math.round(Math.min(1, Math.max(0, state.championCharge)) * 100) / 100;
      if (charge !== lastCharge) {
        lastCharge = charge;
        ringFill.style.strokeDashoffset = ringDashOffset(charge, RING_C).toFixed(2);
      }
      const full = charge >= 1;
      if (full !== wasFull) {
        wasFull = full;
        champ.classList.toggle('tb-ready', full);
        champTag.textContent = full ? 'CHAMP!' : 'CHAMP';
      }
    },
    setRun(info) {
      if (disposed) return;
      runInfo = info;
      runStripOwner = info ? hud : runStripOwner === hud ? null : runStripOwner;
      run.hidden = !info;
      laidOutSlots = -1;
      if (!info) {
        runIcons.replaceChildren();
        return;
      }
      hpFill.style.transform = `scaleX(${hpFraction(info.hp, info.maxHp)})`;
      hpText.textContent = formatRunHp(info.hp);
      goldText.textContent = formatCount(info.gold);
      const tag = runTagText(info.kind);
      runTag.hidden = tag === '';
      runTag.textContent = tag;
      runTag.className = `tb-rtag tb-rtag-${info.kind}`;
      runLeft.setAttribute('aria-label', runStatusLabel(info.hp, info.maxHp, info.gold, info.kind));
      runIcons.setAttribute('aria-label', `Upgrades: ${runUpgradesLabel(info.upgrades)}`);
      layoutRunIcons();
    },
    setVisible(v) {
      visible = v;
      hud.hidden = !v;
      if (v) layoutRunIcons();
    },
    dispose() {
      disposed = true;
      clearTimeout(champTimer);
      clearTimeout(pauseTimer);
      clearTimeout(pulseTimer);
      for (const t of popTimers) clearTimeout(t);
      window.removeEventListener('resize', onResize);
      if (runStripOwner === hud) runStripOwner = null;
      champ.removeEventListener('pointerdown', onChampDown);
      pause.removeEventListener('pointerdown', onPauseDown);
      canvas.removeEventListener('pointerdown', onCanvasDown, { capture: true });
      hud.remove();
    },
  };
}
