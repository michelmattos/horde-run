// In-battle HUD in the toy-box sticker style (docs/art-direction.md section 7).
//
// It is DOM over the canvas (not Babylon GUI) so it gets the self-hosted rounded font,
// real outlines and gradients, and costs no draw calls. The layer is
// pointer-events:none, so drags reach the canvas; only the pause, CHAMP and ultimate
// buttons take touches. The ultimate (when the loadout has one) mirrors CHAMP in the
// bottom-left corner, lifted off the bottom by the same amount. Layout: pause alone in the top-left corner with the level name beside
// it; the enemy base HP is a vertical bar on the left under the pause button (top half of
// the screen); the player base HP is a vertical bar on the right above the CHAMP button
// (bottom half), both lifted off the bottom edge so the bottom strip is free for the
// dragging thumb. No soldier counts and no live stars: stars belong to the result screen. Both are also registered as blocked regions with the input, and the
// CHAMP hit circle extends a little past its ring (as before), so a second finger can
// press it while the first keeps aiming. Per frame, update() only writes what
// changed; HP fills and the charge ring move with transforms / dash offsets.
// Feedback is colour and small scale pops on HUD widgets only: nothing here moves the
// camera or the screen. Sizes live in HUD_METRICS (uiLogic.ts), which hudReserve()
// also uses, so the camera framing keeps exactly the covered strips clear.
// In an Expedition run, setRun() adds a static strip under the top row (run HP, gold,
// the elite/boss tag and the upgrade icons). It is built once per battle, never touched
// by update(), takes no touches, and hudReserve() grows by its height while it is set.
// World 2 adds two hazard widgets, both pure DOM (the camera and the canvas never move):
// a gust telegraph, an arrow chip docked at the right edge off the lane that fills
// toward the push while the gust is coming and pulses while it blows, and a frost tint
// with a snowflake countdown chip on the enemy column while the Blizzard holds the enemy
// crowd frozen (state.enemyFrozen). Neither takes touches nor changes hudReserve().
// World 3 adds the Jack-in-the-Box shuffle telegraph (state.shuffle): a wooden chip under
// the gust's spot, still off the lane, whose brass fill grows and whose crank winds while
// the boss cranks, then pulses while the gates glide. No touches, no hudReserve() change.
// The CHAMP button also shows the Wind-up Robot ('windup').
import type { Scene } from '@babylonjs/core/scene';
import type { BattleState } from '../contracts.ts';
import type { Input } from '../core/input.ts';
import { readSafeAreaInsets } from './safeArea.ts';
import {
  HUD_METRICS as M,
  formatCount,
  formatRunHp,
  formatStacks,
  frozenSecondsLabel,
  gustChipLook,
  hpFraction,
  shuffleChipLook,
  hudReserveFor,
  hudTopHeight,
  pipLit,
  ringDashOffset,
  ultimateTagText,
  runIconSlots,
  runStatusLabel,
  runTagText,
  runUpgradesLabel,
  splitRunIcons,
} from './uiLogic.ts';
import { UI, WOOD_BG, injectUiTheme, outlineShadow } from './theme.ts';
import {
  championIconFor,
  coinIcon,
  crankIcon,
  fortIcon,
  gustArrowIcon,
  heartIcon,
  pauseIcon,
  snowflakeIcon,
  ultimateIcon,
} from './icons.ts';
import type { ChampionIconId, UltimateIconId } from './icons.ts';

// Optional per-level extras: the boss's name and phase count (phase pips by the enemy bar).
export interface HudInfo {
  bossName?: string;
  bossPhases?: number;
  // The loadout's ultimate: charge 0..1 fills its ring; the button is hidden when absent.
  ultimate?: { charge: number; id: UltimateIconId; label: string };
  // Which champion the CHAMP button shows (default Sarge).
  champion?: { id: ChampionIconId };
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
const ULT_R = (M.ultRing - RING_STROKE) / 2;
const ULT_C = 2 * Math.PI * ULT_R;
const PRESS_MS = 120;
const LEVEL_NAME_SECONDS = 3; // battle seconds the level name stays beside the pause button
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

/* ----- Top row: pause, then the level name (fades) or the boss's name ----- */
.tb-pause{position:absolute;top:calc(${SAT} + ${M.topPad}px);left:calc(${SAL} + ${M.edge}px);width:${M.pause}px;height:${M.pause}px;
  border-radius:50%;border:3.5px solid ${UI.ink};box-sizing:border-box;
  background:radial-gradient(90% 70% at 35% 22%,rgba(255,230,190,.45),transparent 55%),${WOOD_BG};
  box-shadow:inset 0 -3px 0 rgba(0,0,0,.25),0 4px 0 #26160b,0 4px 0 3px ${UI.ink},0 8px 10px rgba(20,10,2,.3);
  display:flex;align-items:center;justify-content:center;transition:transform 90ms cubic-bezier(.3,1.6,.6,1)}
.tb-pause.tb-down{transform:translateY(4px)}
.tb-pause svg{width:30px;height:30px}
.tb-title{position:absolute;top:calc(${SAT} + ${M.topPad}px);left:calc(${SAL} + ${M.edge + M.pause + 12}px);right:calc(${SAR} + ${M.edge}px);
  height:${M.pause}px;display:flex;align-items:center;gap:8px;min-width:0}
.tb-level{flex:0 1 auto;min-width:0;transition:opacity 600ms ease-out;font-size:17px;font-weight:700;color:#fff;text-shadow:${outlineShadow(2.2)};
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:4px 4px 6px 4px}
.tb-level.tb-faded{opacity:0}
.tb-boss{flex:0 1 auto;min-width:0;height:28px;padding:0 12px;border-radius:14px;border:3px solid ${UI.ink};box-sizing:border-box;
  display:flex;align-items:center;font-size:13px;font-weight:700;letter-spacing:.06em;color:${UI.cream};text-shadow:${outlineShadow(1.6)};
  background:radial-gradient(90% 80% at 35% 25%,#f2f4f6,${UI.tin} 55%,${UI.tinDark});box-shadow:0 3px 0 ${UI.ink};
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tb-boss[hidden]{display:none}

/* ----- Vertical HP bars: wooden frame, dark track. The player fill drains toward the bottom (CHAMP);
   the enemy fill drains toward the top, away from the battle. ----- */
.tb-vbar{position:relative;flex:1 1 auto;width:${M.barBadge}px;min-height:${M.vbarMin + M.barBadge / 2}px;max-height:${M.vbarMax + M.barBadge / 2}px}
.tb-frame{position:absolute;top:${M.barBadge / 2}px;bottom:0;left:${(M.barBadge - M.vbarW) / 2}px;width:${M.vbarW}px;
  border-radius:${M.vbarW / 2}px;border:3px solid ${UI.ink};padding:${M.barBadge / 2 - 2}px 4px 4px;box-sizing:border-box;
  background:${WOOD_BG};box-shadow:inset 2px 0 0 rgba(255,225,180,.3),0 3px 0 ${UI.ink},0 6px 8px rgba(20,10,2,.3)}
.tb-track{position:relative;width:100%;height:100%;border-radius:999px;overflow:hidden;background:linear-gradient(90deg,#140b05,#2a1a0e 45%,#382414);
  box-shadow:inset 2px 0 3px rgba(0,0,0,.7),0 0 0 2px #1a0f07;transform:translateZ(0)}
.tb-fill{position:absolute;inset:0;border-radius:999px;transform-origin:50% 100%;will-change:transform;transition:transform 120ms ease-out}
.tb-fill::after{content:'';position:absolute;top:6px;bottom:6px;left:2px;width:28%;border-radius:999px;background:rgba(255,255,255,.3)}
.tb-enemy .tb-fill{transform-origin:50% 0}
.tb-fill-tan{background:linear-gradient(90deg,#f7ebcf 0%,#e2c896 30%,#d6b47c 62%,#c8a46a 100%);
  box-shadow:inset 0 0 0 1.5px rgba(26,15,7,.9),inset -3px 0 0 rgba(120,82,36,.45)}
.tb-fill-tan::after{background:rgba(255,255,255,.6)}
.tb-fill-green{background:linear-gradient(90deg,${UI.armyLight} 0%,${UI.army} 58%,${UI.armyDark} 100%)}
.tb-track::after{content:'';position:absolute;inset:0;border-radius:999px;pointer-events:none;
  background:repeating-linear-gradient(180deg,transparent 0 calc(10% - 2px),rgba(43,29,18,.38) calc(10% - 2px) 10%)}
.tb-badge{position:absolute;left:0;top:0;width:${M.barBadge}px;height:${M.barBadge}px;z-index:1;box-sizing:border-box;border-radius:50%;
  border:3px solid ${UI.ink};display:flex;align-items:center;justify-content:center;box-shadow:inset 0 -3px 0 rgba(0,0,0,.18),0 3px 0 ${UI.ink}}
.tb-badge svg{width:30px;height:30px}
.tb-ebadge{background:radial-gradient(80% 70% at 35% 25%,${UI.tanLight},${UI.tan} 55%,${UI.tanDark})}
.tb-ebadge.tb-tin{background:radial-gradient(80% 70% at 35% 25%,#f2f4f6,${UI.tin} 55%,${UI.tinDark})}
.tb-pbadge{background:radial-gradient(80% 70% at 35% 25%,#a5dc84,${UI.army} 55%,${UI.armyDark})}
.tb-vbar.tb-pulse .tb-fill-tan{animation:tb-flash 300ms ease-out}
.tb-vbar.tb-pulse .tb-frame{animation:tb-pop 150ms cubic-bezier(.3,1.6,.6,1)}
@keyframes tb-flash{0%,40%{filter:brightness(1.8)}100%{filter:none}}
@keyframes tb-pop{0%{transform:scale(1)}50%{transform:scale(1.1,1.04)}100%{transform:scale(1)}}

/* ----- Left column (top half): enemy base HP under the pause button, % and boss phase pips ----- */
.tb-enemy{position:absolute;top:calc(${SAT} + ${M.topPad + M.pause + M.sideGap}px);bottom:50%;
  left:calc(${SAL} + ${M.edge + (M.pause - M.barBadge) / 2}px);width:${M.barBadge}px;display:flex;flex-direction:column;align-items:center;gap:6px}
.tb-hud.tb-has-run .tb-enemy{top:calc(${SAT} + ${M.topPad + hudTopHeight(true) + M.sideGap}px)}
.tb-epct{flex:none;min-width:46px;height:24px;padding:0 6px;border-radius:12px;border:2.5px solid ${UI.ink};box-sizing:border-box;
  display:flex;align-items:center;justify-content:center;background:${WOOD_BG};box-shadow:0 2px 0 ${UI.ink};
  color:#fff;text-shadow:${outlineShadow(1.6)};font-size:14px;font-weight:700;line-height:1}
.tb-pips{position:absolute;left:${M.barBadge + 4}px;top:${M.barBadge + 6}px;display:flex;flex-direction:column;gap:5px}
.tb-pip{width:12px;height:12px;border-radius:50%;border:2.5px solid ${UI.ink};background:rgba(255,246,227,.55);box-sizing:border-box;box-shadow:0 1.5px 0 ${UI.ink}}
.tb-pip.tb-lit{background:${UI.yellow};box-shadow:inset 0 -2px 0 rgba(0,0,0,.2),0 1.5px 0 ${UI.ink}}

/* ----- Right column (bottom half): player base HP above the CHAMP button, lifted off the bottom ----- */
.tb-player{position:absolute;top:50%;bottom:calc(${SAB} + ${M.liftBottom}px);right:calc(${SAR} + ${M.edge}px);width:${M.champRing}px;
  display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:10px}
.tb-player .tb-vbar{flex:0 1 ${M.vbarMax + M.barBadge / 2}px}
/* The player's fortress badge caps the bottom end of its bar, next to the CHAMP button. */
.tb-player .tb-frame{top:0;bottom:${M.barBadge / 2}px;padding:4px 4px ${M.barBadge / 2 - 2}px}
.tb-player .tb-badge{top:auto;bottom:0}
.tb-champ-slot{position:relative;flex:none;width:${M.champRing}px;height:${M.champRing + M.champTagOver}px}

.tb-cbtn{position:absolute;border:0;border-radius:50%;background:none;padding:0}
.tb-champ{left:0;top:0;width:${M.champRing}px;height:${M.champRing}px}
/* ----- Bottom-left corner: the ultimate, mirroring CHAMP (the enemy bar keeps to the top half) ----- */
.tb-ult{left:calc(${SAL} + ${M.edge + (M.champRing - M.ultRing) / 2}px);bottom:calc(${SAB} + ${M.liftBottom + M.champTagOver}px);
  width:${M.ultRing}px;height:${M.ultRing}px;pointer-events:auto}
.tb-ult[hidden]{display:none}
.tb-champ-body{position:absolute;inset:0;transform-origin:50% 60%}
.tb-cbtn.tb-ready .tb-champ-body{animation:tb-bounce 1100ms cubic-bezier(.3,1.5,.6,1) infinite}
@keyframes tb-bounce{0%{transform:scale(1)}9%{transform:scale(1.08)}17%{transform:scale(.985)}24%,100%{transform:scale(1)}}
.tb-glow{position:absolute;inset:-20px;border-radius:50%;opacity:0;
  background:radial-gradient(closest-side,rgba(255,197,49,.85),rgba(255,197,49,.35) 60%,rgba(255,197,49,0))}
.tb-cbtn.tb-ready .tb-glow{opacity:1;animation:tb-glow 1100ms ease-in-out infinite}
@keyframes tb-glow{0%,100%{opacity:.65}10%{opacity:1}}
.tb-ring{position:absolute;inset:0;transform:rotate(-90deg)}
.tb-ring-track{fill:rgba(43,29,18,.55);stroke:rgba(43,29,18,.7)}
.tb-ring-fill{fill:none;stroke:#9be27a;stroke-linecap:round;transition:stroke-dashoffset 120ms linear}
.tb-ult .tb-ring-fill{stroke:#ffb259}
.tb-cbtn.tb-ready .tb-ring-fill{stroke:${UI.yellow}}
.tb-ring-edge{fill:none;stroke:${UI.ink};stroke-width:2.5}
.tb-face{position:absolute;left:${(M.champRing - M.champFace) / 2}px;top:${(M.champRing - M.champFace) / 2 - 3}px;width:${M.champFace}px;height:${M.champFace}px;
  box-sizing:border-box;border-radius:50%;border:3.5px solid ${UI.ink};display:flex;align-items:center;justify-content:center;
  background:radial-gradient(70% 60% at 34% 24%,#b6ea8f 0%,#7cbf5e 22%,${UI.army} 58%,${UI.armyDark} 100%);
  box-shadow:inset 0 -5px 0 rgba(0,0,0,.18),inset 0 3px 0 rgba(255,255,255,.35),0 5px 0 #23461d,0 5px 0 3px ${UI.ink};
  transition:transform 90ms cubic-bezier(.3,1.6,.6,1),filter 150ms}
.tb-cbtn:not(.tb-ready) .tb-face{filter:saturate(.8) brightness(.92)}
.tb-champ.tb-down .tb-face{transform:translateY(4px);box-shadow:inset 0 -5px 0 rgba(0,0,0,.18),0 1px 0 #23461d,0 1px 0 3px ${UI.ink}}
.tb-ult .tb-face{left:${(M.ultRing - M.ultFace) / 2}px;top:${(M.ultRing - M.ultFace) / 2 - 3}px;width:${M.ultFace}px;height:${M.ultFace}px;
  background:radial-gradient(70% 60% at 34% 24%,#ffb3a6 0%,#f47d70 22%,${UI.red} 58%,#a8261d 100%);
  box-shadow:inset 0 -5px 0 rgba(0,0,0,.18),inset 0 3px 0 rgba(255,255,255,.35),0 5px 0 #7a1d16,0 5px 0 3px ${UI.ink}}
.tb-ult.tb-down .tb-face{transform:translateY(4px);box-shadow:inset 0 -5px 0 rgba(0,0,0,.18),0 1px 0 #7a1d16,0 1px 0 3px ${UI.ink}}
.tb-ult .tb-face svg{width:52px;height:52px;margin:0}
.tb-face svg{width:60px;height:60px;margin:-2px 0 0 2px}
.tb-cbtn:not(.tb-ready) .tb-face svg{opacity:.8}
.tb-tag{position:absolute;left:50%;bottom:-${M.champTagOver + 2}px;transform:translateX(-50%);height:24px;padding:0 10px;border-radius:12px;
  border:3px solid ${UI.ink};box-sizing:border-box;display:flex;align-items:center;font-size:14px;font-weight:700;letter-spacing:.06em;
  color:${UI.cream};text-shadow:${outlineShadow(1.5)};background:${WOOD_BG};box-shadow:0 3px 0 ${UI.ink};white-space:nowrap}
.tb-ult .tb-tag{font-size:13px;letter-spacing:.04em;padding:0 8px}
.tb-cbtn.tb-ready .tb-tag{background:linear-gradient(#ffd862,${UI.yellow});color:${UI.ink};text-shadow:none}
/* ----- Expedition run strip (static; under the top row, no touches) ----- */
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

/* ----- World 2: gust telegraph. Docked at the right edge at 30% height, off the lane and
   clear of both HP columns, so the enemy base and the boss at the lane's far end stay in
   view while a gust is warned and while it blows. No touches. ----- */
.tb-gust{position:absolute;top:30%;right:calc(${SAR} + ${M.edge}px);width:116px;height:44px;
  box-sizing:border-box;border-radius:22px;border:3px solid ${UI.ink};background:${WOOD_BG};overflow:hidden;
  box-shadow:inset 0 2px 0 rgba(255,225,180,.28),0 4px 0 ${UI.ink},0 8px 10px rgba(20,10,2,.3);transform-origin:50% 50%}
.tb-gust[hidden]{display:none}
.tb-gust-fill{position:absolute;inset:0;transform:scaleX(0);transform-origin:0 50%;will-change:transform;
  background:linear-gradient(180deg,#e6f6ff 0%,#9fd6f0 55%,#5fb4e0 100%)}
.tb-gust.tb-left .tb-gust-fill{transform-origin:100% 50%}
.tb-gust-ico{position:absolute;left:50%;top:50%;width:48px;height:48px;margin:-24px 0 0 -24px}
.tb-gust-ico svg{width:48px;height:48px;display:block}
.tb-gust.tb-left .tb-gust-ico{transform:scaleX(-1)}
.tb-gust.tb-on{animation:tb-gust 420ms ease-in-out infinite;border-color:${UI.ink}}
.tb-gust.tb-on .tb-gust-fill{background:linear-gradient(180deg,#ffffff 0%,#bfe6f8 50%,#7cc4e8 100%)}
@keyframes tb-gust{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}

/* ----- World 3: Jack-in-the-Box shuffle telegraph. Docked at the right edge under the gust
   chip's spot (both can never cover the lane or the HP columns). No touches. ----- */
.tb-shuffle{position:absolute;top:calc(30% + 56px);right:calc(${SAR} + ${M.edge}px);width:116px;height:44px;
  box-sizing:border-box;border-radius:22px;border:3px solid ${UI.ink};background:${WOOD_BG};overflow:hidden;
  box-shadow:inset 0 2px 0 rgba(255,225,180,.28),0 4px 0 ${UI.ink},0 8px 10px rgba(20,10,2,.3);transform-origin:50% 50%}
.tb-shuffle[hidden]{display:none}
.tb-shuffle-fill{position:absolute;inset:0;transform:scaleX(0);transform-origin:0 50%;will-change:transform;
  background:radial-gradient(circle,rgba(239,227,198,.8) 0 2px,transparent 2.6px) 3px 3px/14px 14px,linear-gradient(180deg,#6f97dc 0%,#2e5aa8 55%,#1f3f7a 100%)}
.tb-shuffle-ico{position:absolute;left:50%;top:50%;width:48px;height:48px;margin:-24px 0 0 -24px}
.tb-shuffle-ico svg{width:48px;height:48px;display:block;overflow:visible}
.tb-crank-arm{transition:transform 90ms linear}
.tb-shuffle.tb-on{animation:tb-gust 420ms ease-in-out infinite}
.tb-shuffle.tb-on .tb-shuffle-fill{background:radial-gradient(circle,rgba(255,236,200,.75) 0 2px,transparent 2.6px) 3px 3px/14px 14px,linear-gradient(180deg,#ff9a90 0%,${UI.red} 55%,#a8261d 100%)}

/* ----- World 2: the enemy crowd frozen by the Blizzard (frost tint + countdown chip) ----- */
.tb-enemy.tb-frozen .tb-frame{box-shadow:inset 2px 0 0 rgba(255,255,255,.5),0 0 0 3px #bfe6f8,0 3px 0 ${UI.ink},0 0 12px rgba(160,220,250,.9)}
.tb-enemy.tb-frozen .tb-fill-tan{filter:saturate(.35) brightness(1.15) hue-rotate(160deg)}
.tb-enemy.tb-frozen .tb-ebadge{background:radial-gradient(80% 70% at 35% 25%,#f2fbff,#8fd0ee 55%,#3f8fbf)}
.tb-efrost{flex:none;display:flex;align-items:center;gap:2px;height:26px;padding:0 7px 0 2px;border-radius:13px;border:2.5px solid ${UI.ink};box-sizing:border-box;
  background:linear-gradient(180deg,#e6f6ff,#8fcbea);box-shadow:0 2px 0 ${UI.ink};color:#16405e;font-size:14px;font-weight:700;line-height:1}
.tb-efrost[hidden]{display:none}
.tb-efrost svg{width:22px;height:22px}

@media (prefers-reduced-motion: reduce){.tb-cbtn.tb-ready .tb-champ-body,.tb-cbtn.tb-ready .tb-glow,.tb-gust.tb-on,.tb-shuffle.tb-on{animation:none}.tb-crank-arm{transition:none}}
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

function vBar(
  kind: 'enemy' | 'player',
  badge: string,
): { root: HTMLDivElement; fill: HTMLDivElement; badge: HTMLDivElement } {
  const root = div('tb-vbar');
  const frame = div('tb-frame');
  const track = div('tb-track');
  const fill = div(`tb-fill ${kind === 'enemy' ? 'tb-fill-tan' : 'tb-fill-green'}`);
  track.append(fill);
  frame.append(track);
  const b = div(`tb-badge ${kind === 'enemy' ? 'tb-ebadge' : 'tb-pbadge'}`, badge);
  root.append(frame, b);
  return { root, fill, badge: b };
}

// Round plastic button with a charge ring (CHAMP and the ultimate share it).
function roundButtonMarkup(size: number, ringR: number, ringC: number, icon: string, tag: string): string {
  const c = size / 2;
  return (
    `<div class="tb-champ-body"><div class="tb-glow"></div>` +
    `<svg class="tb-ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">` +
    `<circle class="tb-ring-track" cx="${c}" cy="${c}" r="${c - 1.5}" stroke-width="3"/>` +
    `<circle class="tb-ring-fill" cx="${c}" cy="${c}" r="${ringR}" stroke-width="${RING_STROKE}" stroke-dasharray="${ringC.toFixed(2)}" stroke-dashoffset="${ringC.toFixed(2)}"/>` +
    `<circle class="tb-ring-edge" cx="${c}" cy="${c}" r="${c - 1.25}"/>` +
    `</svg><div class="tb-face">${icon}</div><div class="tb-tag">${tag}</div></div>`
  );
}

export function createHud(scene: Scene, input: Input, opts: { onPause: () => void }): Hud {
  injectStyles();
  const canvas = scene.getEngine().getRenderingCanvas() as HTMLCanvasElement;
  const host = canvas.parentElement ?? document.body;

  const hud = div('tb-hud');
  hud.setAttribute('role', 'group');
  hud.setAttribute('aria-label', 'Battle HUD');

  // ----- Top row: pause, then the level name (fades) or the boss's name -----
  const pause = document.createElement('button');
  pause.type = 'button';
  pause.className = 'tb-pause';
  pause.setAttribute('aria-label', 'Pause');
  pause.tabIndex = -1;
  pause.innerHTML = pauseIcon(30);
  const title = div('tb-title');
  const levelText = div('tb-level');
  const bossText = div('tb-boss');
  bossText.hidden = true;
  title.append(levelText, bossText);

  // ----- Left column: enemy base HP (tan fortress badge, tin for the boss), % and phase pips -----
  const enemyCol = div('tb-enemy');
  const enemy = vBar('enemy', fortIcon(30, UI.cream, UI.red));
  enemy.root.setAttribute('role', 'meter');
  enemy.root.setAttribute('aria-label', 'Enemy base health');
  const pipsBox = div('tb-pips');
  const pips: HTMLDivElement[] = [];
  for (let i = 0; i < MAX_PIPS; i++) {
    const p = div('tb-pip');
    p.hidden = true;
    pipsBox.append(p);
    pips.push(p);
  }
  enemy.root.append(pipsBox);
  const ePct = div('tb-epct');
  ePct.setAttribute('aria-hidden', 'true');
  const eFrost = div('tb-efrost', snowflakeIcon(22));
  eFrost.hidden = true;
  const eFrostText = document.createElement('span');
  eFrost.append(eFrostText);
  enemyCol.append(enemy.root, ePct, eFrost);

  // ----- Gust telegraph: hidden until a gust is coming -----
  const gust = div('tb-gust');
  gust.hidden = true;
  gust.setAttribute('role', 'img');
  const gustFill = div('tb-gust-fill');
  gust.append(gustFill, div('tb-gust-ico', gustArrowIcon(48)));

  // ----- Shuffle telegraph (Jack-in-the-Box): hidden until the boss starts cranking -----
  const shuffle = div('tb-shuffle');
  shuffle.hidden = true;
  shuffle.setAttribute('role', 'img');
  shuffle.setAttribute('aria-label', 'The gates are about to move');
  const shuffleFill = div('tb-shuffle-fill');
  const shuffleIco = div('tb-shuffle-ico', crankIcon(48));
  shuffle.append(shuffleFill, shuffleIco);
  const crankArm = shuffleIco.querySelector('.tb-crank-arm') as SVGGElement;

  // ----- Right column: player base HP (green fortress badge) above the CHAMP button -----
  const playerCol = div('tb-player');
  const player = vBar('player', fortIcon(30, UI.cream, UI.yellow));
  player.root.setAttribute('role', 'meter');
  player.root.setAttribute('aria-label', 'Your base health');

  const champ = document.createElement('button');
  champ.type = 'button';
  champ.className = 'tb-cbtn tb-champ';
  champ.setAttribute('aria-label', 'Champion');
  champ.tabIndex = -1;
  champ.innerHTML = roundButtonMarkup(M.champRing, RING_R, RING_C, championIconFor('sarge', 60, UI.cream), 'CHAMP');
  const ringFill = champ.querySelector('.tb-ring-fill') as SVGCircleElement;
  const champTag = champ.querySelector('.tb-tag') as HTMLDivElement;
  const champSlot = div('tb-champ-slot');
  champSlot.append(champ);
  playerCol.append(player.root, champSlot);
  const champFace = champ.querySelector('.tb-face') as HTMLDivElement;

  // ----- Bottom-left corner: the ultimate, hidden until update() gets one -----
  const ult = document.createElement('button');
  ult.type = 'button';
  ult.className = 'tb-cbtn tb-ult';
  ult.setAttribute('aria-label', 'Ultimate');
  ult.tabIndex = -1;
  ult.hidden = true;
  ult.innerHTML = roundButtonMarkup(M.ultRing, ULT_R, ULT_C, '', '');
  const ultFill = ult.querySelector('.tb-ring-fill') as SVGCircleElement;
  const ultTag = ult.querySelector('.tb-tag') as HTMLDivElement;
  const ultFace = ult.querySelector('.tb-face') as HTMLDivElement;

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

  hud.append(pause, title, run, gust, shuffle, enemyCol, playerCol, ult);
  host.appendChild(hud);

  // ----- Hits -----
  let visible = true;
  let disposed = false;
  const inRound = (b: HTMLButtonElement, x: number, y: number): boolean => {
    if (!visible || disposed || b.hidden) return false;
    const r = b.getBoundingClientRect();
    if (r.width === 0) return false;
    const dx = x - (r.left + r.width / 2);
    const dy = y - (r.top + r.height / 2);
    const rad = r.width / 2 + HIT_SLOP;
    return dx * dx + dy * dy <= rad * rad;
  };
  const inChampion = (x: number, y: number): boolean => inRound(champ, x, y);
  const inUltimate = (x: number, y: number): boolean => inRound(ult, x, y);
  const inPause = (x: number, y: number): boolean => {
    if (!visible || disposed) return false;
    const r = pause.getBoundingClientRect();
    if (r.width === 0) return false;
    return x >= r.left - HIT_SLOP && x <= r.right + HIT_SLOP && y >= r.top - HIT_SLOP && y <= r.bottom + HIT_SLOP;
  };
  input.addBlockedRegion(inChampion);
  input.addBlockedRegion(inUltimate);
  input.addBlockedRegion(inPause);

  let champTimer = 0;
  let ultTimer = 0;
  let pauseTimer = 0;
  const pressChampion = (): void => {
    input.pressChampion();
    champ.classList.add('tb-down');
    clearTimeout(champTimer);
    champTimer = window.setTimeout(() => champ.classList.remove('tb-down'), PRESS_MS);
  };
  const pressUltimate = (): void => {
    input.pressUltimate();
    ult.classList.add('tb-down');
    clearTimeout(ultTimer);
    ultTimer = window.setTimeout(() => ult.classList.remove('tb-down'), PRESS_MS);
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
  const onUltDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    pressUltimate();
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
    else if (inUltimate(e.clientX, e.clientY)) pressUltimate();
    else if (inPause(e.clientX, e.clientY)) doPause();
  };
  champ.addEventListener('pointerdown', onChampDown);
  ult.addEventListener('pointerdown', onUltDown);
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
  let lastFaded: boolean | null = null;
  let lastEnemyFill = -1;
  let lastPlayerFill = -1;
  let lastCharge = -1;
  let wasFull = false;
  let lastChampion: ChampionIconId = 'sarge';
  let lastUltId = '';
  let lastUltLabel = '';
  let lastUltCharge = -1;
  let ultFull = false;
  let lastBoss: string | null = null;
  let lastPips = -1;
  let lastPhase = -1;
  let pulseTimer = 0;
  let lastGustShow = false;
  let lastGustDir = 0;
  let lastGustFill = -1;
  let lastGustActive = false;
  let lastFrozen = '';
  let lastShuffleShow = false;
  let lastShuffleFill = -1;
  let lastShuffleTurn = -1;
  let lastShuffleActive = false;

  return {
    update(state, levelName, info) {
      if (disposed) return;
      // ----- Boss name and phase pips -----
      const boss = info?.bossName ?? '';
      if (boss !== lastBoss) {
        lastBoss = boss;
        bossText.textContent = boss.toUpperCase();
        bossText.hidden = boss === '';
        lastLevel = ''; // re-check the level name against the new boss name
        enemy.badge.classList.toggle('tb-tin', boss !== '');
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
        // The boss chip already names him: do not repeat 'Tin General' beside it.
        levelText.hidden = boss !== '' && levelName.toLowerCase() === boss.toLowerCase();
      }
      const ef = Math.round(hpFraction(state.enemyBaseHp, state.enemyBaseMaxHp) * 500) / 500;
      if (ef !== lastEnemyFill) {
        lastEnemyFill = ef;
        enemy.fill.style.transform = `scaleY(${ef})`;
        ePct.textContent = `${Math.ceil(ef * 100)}%`;
        enemy.root.setAttribute('aria-valuenow', String(Math.ceil(ef * 100)));
      }
      const pf = Math.round(hpFraction(state.playerBaseHp, state.playerBaseMaxHp) * 500) / 500;
      if (pf !== lastPlayerFill) {
        lastPlayerFill = pf;
        player.fill.style.transform = `scaleY(${pf})`;
        player.root.setAttribute('aria-valuenow', String(Math.ceil(pf * 100)));
      }

      // ----- World 2: gust telegraph and the frozen enemy crowd -----
      const g = gustChipLook(state.gust);
      if (g.show !== lastGustShow) {
        lastGustShow = g.show;
        gust.hidden = !g.show;
      }
      if (g.show) {
        if (g.dir !== lastGustDir) {
          lastGustDir = g.dir;
          gust.classList.toggle('tb-left', g.dir < 0);
          gust.setAttribute('aria-label', `Gust blowing to the ${g.dir < 0 ? 'left' : 'right'}`);
        }
        if (g.fill !== lastGustFill) {
          lastGustFill = g.fill;
          gustFill.style.transform = `scaleX(${g.fill})`;
        }
        if (g.active !== lastGustActive) {
          lastGustActive = g.active;
          gust.classList.toggle('tb-on', g.active);
        }
      }
      // ----- World 3: the Jack-in-the-Box cranking up a gate shuffle -----
      const sh = shuffleChipLook(state.shuffle);
      if (sh.show !== lastShuffleShow) {
        lastShuffleShow = sh.show;
        shuffle.hidden = !sh.show;
      }
      if (sh.show) {
        if (sh.fill !== lastShuffleFill) {
          lastShuffleFill = sh.fill;
          shuffleFill.style.transform = `scaleX(${sh.fill})`;
        }
        if (sh.turn !== lastShuffleTurn) {
          lastShuffleTurn = sh.turn;
          crankArm.style.transform = `rotate(${sh.turn}deg)`;
        }
        if (sh.active !== lastShuffleActive) {
          lastShuffleActive = sh.active;
          shuffle.classList.toggle('tb-on', sh.active);
          shuffle.setAttribute('aria-label', sh.active ? 'The gates are moving' : 'The gates are about to move');
        }
      }
      const frozen = frozenSecondsLabel(state.enemyFrozen);
      if (frozen !== lastFrozen) {
        enemyCol.classList.toggle('tb-frozen', frozen !== '');
        eFrost.hidden = frozen === '';
        eFrostText.textContent = frozen;
        lastFrozen = frozen;
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
      const champId = info?.champion?.id ?? 'sarge';
      if (champId !== lastChampion) {
        lastChampion = champId;
        champFace.innerHTML = championIconFor(champId, 60, UI.cream);
      }

      // ----- Ultimate: shown only when the battle has one -----
      const u = info?.ultimate;
      const uid = u ? u.id : '';
      if (uid !== lastUltId || (u && u.label !== lastUltLabel)) {
        lastUltId = uid;
        lastUltLabel = u?.label ?? '';
        ult.hidden = !u;
        if (u) {
          ultFace.innerHTML = ultimateIcon(u.id, 52);
          ultTag.textContent = ultimateTagText(u.id, u.label);
          ult.setAttribute('aria-label', `Ultimate: ${u.label}`);
        }
        lastUltCharge = -1;
      }
      if (u) {
        const uc = Math.round(Math.min(1, Math.max(0, u.charge)) * 100) / 100;
        if (uc !== lastUltCharge) {
          lastUltCharge = uc;
          ultFill.style.strokeDashoffset = ringDashOffset(uc, ULT_C).toFixed(2);
        }
        const uFull = uc >= 1;
        if (uFull !== ultFull) {
          ultFull = uFull;
          ult.classList.toggle('tb-ready', uFull);
        }
      }
    },
    setRun(info) {
      if (disposed) return;
      runInfo = info;
      runStripOwner = info ? hud : runStripOwner === hud ? null : runStripOwner;
      run.hidden = !info;
      hud.classList.toggle('tb-has-run', !!info);
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
      clearTimeout(ultTimer);
      clearTimeout(pauseTimer);
      clearTimeout(pulseTimer);
      window.removeEventListener('resize', onResize);
      if (runStripOwner === hud) runStripOwner = null;
      champ.removeEventListener('pointerdown', onChampDown);
      ult.removeEventListener('pointerdown', onUltDown);
      pause.removeEventListener('pointerdown', onPauseDown);
      canvas.removeEventListener('pointerdown', onCanvasDown, { capture: true });
      hud.remove();
    },
  };
}
