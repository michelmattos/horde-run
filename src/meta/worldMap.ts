// World map screen: plain HTML/SVG over the app root, shown instead of the battle. One
// world is on screen at a time; with more than one world, big tabs under the header
// switch between them (each world keeps its own scroll position). World 1 is the bedroom
// floor: wooden floorboards with a toy race track winding from the first level (bottom)
// to the boss (top). World 2 is a freezer shelf: frosted wire shelving, an icy track,
// frost-rimmed level badges and a snow-globe boss node. A world still locked behind an
// earlier world's stars shows its levels under frost with a padlock card ('Earn N more
// stars in Bedroom Floor') and none of them can be played. The page scrolls natively and
// nothing on it ever moves on its own except the one auto-scroll to the newest unlocked
// level. A world's title card (no story) shows on the session's first look at the map and
// the first time ever an open world is viewed; a tap or a short timeout dismisses it. The
// last viewed world and the worlds whose card was seen are remembered per viewer
// (core/worldPrefs.ts). When the caller handles Expedition runs, a wooden footer plank
// holds a big yellow Expedition button (badges for a run in progress and an unplayed
// Daily run); the scroll area ends above it. Milestone 4 adds, each only when its handler
// is given: Home base and Collection buttons on a dock row of the footer (Collection
// wears a 'new items' count), a settings cog on the header, and a coin chip next to the
// star total when show() passes coins.
import type { SaveData, WorldTheme } from '../contracts.ts';
import { emptySave, loadGame, starCount } from '../core/save.ts';
import type { GameData } from '../core/save.ts';
import { loadWorldPrefs, saveWorldPrefs } from '../core/worldPrefs.ts';
import { MAP_NODE_SIZE, MAP_STEP, TITLE_CARD_MS, mapLayout, worldTitle } from './mapLayout.ts';
import { createSaveSheet } from './saveSheet.ts';
import { expeditionEntryLook } from './expeditionEntry.ts';
import type { ExpeditionEntryFlags } from './expeditionEntry.ts';
import { UI, WOOD_BG, injectUiTheme, outlineShadow } from '../ui/theme.ts';
import { coinIcon, compassIcon, lockIcon as lockSvg, snowflakeIcon, soldierIcon, starIcon } from '../ui/icons.ts';
import { formatCoins } from './metaLogic.ts';
import { cardsIcon, cogIcon, homeIcon } from './metaUi.ts';
import { penguinIcon, snowmanIcon } from './worldArt.ts';
import { initialWorldIndex, levelTap, lockedWorldText, showsTitleCard, worldTabs } from './worldLogic.ts';
import type { MapWorld, WorldTab } from './worldLogic.ts';

export { mapLayout } from './mapLayout.ts';
export type { MapLayoutOptions } from './mapLayout.ts';
export type { ExpeditionEntryFlags } from './expeditionEntry.ts';
export type { MapLevel, MapWorld } from './worldLogic.ts';

// Optional extras for show(): the Expedition button's badges, the coin balance (shows the
// coin chip) and how many collection items are new (a badge on the Collection button).
export interface WorldMapExtra {
  expedition?: ExpeditionEntryFlags;
  coins?: number;
  newItems?: number;
}

export interface WorldMap {
  show(save: SaveData, extra?: WorldMapExtra): void;
  hide(): void;
  readonly visible: boolean;
  readonly worldId: string; // the world on screen
  // Switches to a world's page (as its tab does); unknown ids are ignored.
  showWorld(id: string): void;
  dispose(): void;
}

const BOSS_SIZE = 88;
// Taller than MAP_STEP: each node carries a star plank and a name tag under its badge.
const MAP_NODE_STEP = Math.max(MAP_STEP, 138);
const TRACK_MAX_W = 480;
const PAD_BOTTOM = 72; // space below the first node (name label + breathing room)
const PAD_TOP = 84; // space above the boss node
const SVG_NS = 'http://www.w3.org/2000/svg';

// Varnished oak floorboards (72 px boards, staggered end joints, faint grain), drawn in CSS.
// Staggered board end joints: a 288x640 SVG tile with a joint at a different height in each 72 px board.
const JOINTS = (() => {
  const ys = [118, 402, 260, 566, 40, 330, 488, 196];
  const lines = ys
    .map((y, i) => {
      const x = (i % 4) * 72; // two joints per board column over the tile
      return `<rect x='${x + 2}' y='${y}' width='70' height='2' fill='rgba(40,18,4,.5)'/><rect x='${x + 2}' y='${y + 2}' width='70' height='1' fill='rgba(255,220,170,.15)'/>`;
    })
    .join('');
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='288' height='640'>${lines}</svg>`)}") 0 0/288px 640px`;
})();

// Varnished oak floorboards (72 px boards, staggered end joints, faint grain), drawn in CSS.
const FLOOR_BG =
  `repeating-linear-gradient(90deg,rgba(40,18,4,.55) 0 2px,rgba(255,220,170,.16) 2px 3px,transparent 3px 72px),` +
  `${JOINTS},` +
  `repeating-linear-gradient(91deg,transparent 0 5px,rgba(70,36,10,.08) 5px 6px,transparent 6px 13px,rgba(255,230,190,.06) 13px 14px),` +
  `repeating-linear-gradient(90deg,#b58250 0 72px,#a87443 72px 144px,#bd8b58 144px 216px,#a97a49 216px 288px)`;

// Freezer shelf: frosted white-blue, chrome wire rods every 64 px with cross wires and a
// scatter of frost sparkles (a 192x128 SVG tile), over a cold top-to-bottom gradient.
const WIRES = (() => {
  const rod = (y: number): string =>
    `<rect x='0' y='${y}' width='192' height='3' fill='rgba(255,255,255,.95)'/><rect x='0' y='${y + 3}' width='192' height='2.5' fill='rgba(70,120,155,.45)'/>`;
  const cross = [0, 96]
    .map(
      (x) =>
        `<rect x='${x + 46}' y='0' width='2' height='128' fill='rgba(255,255,255,.35)'/><rect x='${x + 48}' y='0' width='1.2' height='128' fill='rgba(70,120,155,.18)'/>`,
    )
    .join('');
  const sparkles = [
    [22, 18, 1.6],
    [131, 42, 1.2],
    [74, 92, 1.8],
    [170, 104, 1.3],
    [108, 12, 1],
    [40, 70, 1.1],
  ]
    .map(([x, y, r]) => `<circle cx='${x}' cy='${y}' r='${r}' fill='rgba(255,255,255,.85)'/>`)
    .join('');
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='192' height='128'>${cross}${rod(30)}${rod(94)}${sparkles}</svg>`)}") 0 0/192px 128px`;
})();
const FREEZER_BG =
  `radial-gradient(120% 60% at 50% 0%,rgba(255,255,255,.55),transparent 60%),` +
  `${WIRES},` +
  `repeating-linear-gradient(97deg,transparent 0 11px,rgba(255,255,255,.08) 11px 12px,transparent 12px 31px),` +
  `linear-gradient(180deg,#eef8fd 0%,#d3ecf8 45%,#b8dcef 100%)`;

const CSS = `
.hm-map{position:fixed;inset:0;height:var(--app-h);z-index:8;display:none;flex-direction:column;
  font-family:var(--tb-font);font-variant-numeric:tabular-nums;color:${UI.cream};background:#8a5a32;
  -webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}
.hm-map.hm-on{display:flex}
.hm-head{position:relative;z-index:2;flex:none;display:flex;flex-direction:column;background:${WOOD_BG};
  border-bottom:4px solid ${UI.ink};box-shadow:inset 0 -4px 0 rgba(0,0,0,.25),0 6px 10px rgba(20,10,2,.45);
  padding:max(12px,calc(env(safe-area-inset-top) + 6px)) max(14px,env(safe-area-inset-right)) 12px max(14px,env(safe-area-inset-left))}
.hm-head-row{display:flex;align-items:center;gap:12px}
.hm-title{flex:1;min-width:0}
.hm-world{margin:0;font-size:25px;font-weight:700;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  color:${UI.cream};text-shadow:${outlineShadow(2.2)};padding:2px 2px 4px}
.hm-meta{margin:3px 0 0;min-width:0;display:flex;align-items:center;gap:8px;font-size:15px;font-weight:600;color:#f3dcb0;text-shadow:${outlineShadow(1.4)}}
.hm-star-total{display:inline-flex;align-items:center;gap:4px;padding:2px 10px 2px 4px;border-radius:999px;border:2.5px solid ${UI.ink};
  background:${UI.cream};color:${UI.ink};text-shadow:none;font-weight:700;box-shadow:0 2px 0 ${UI.ink}}
.hm-star-total svg{width:20px;height:20px}
.hm-head .tb-btn{flex:none;width:auto;min-width:76px;margin:0 0 5px}
.hm-scroll{position:relative;flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;touch-action:pan-y;overscroll-behavior:contain;
  -webkit-overflow-scrolling:touch;background:${FLOOR_BG};background-attachment:local;
  padding:0 max(0px,env(safe-area-inset-right)) env(safe-area-inset-bottom) max(0px,env(safe-area-inset-left))}
.hm-shade{position:fixed;inset:0;height:var(--app-h);pointer-events:none;z-index:1;
  background:radial-gradient(130% 90% at 50% 55%,transparent 55%,rgba(40,20,6,.45) 100%)}
.hm-soon{position:relative;margin:22px auto 0;width:calc(100% - 40px);max-width:${TRACK_MAX_W - 40}px;box-sizing:border-box;border-radius:20px;
  padding:14px 16px 14px 64px;text-align:left;color:#16405e;border:3.5px solid ${UI.ink};
  background:radial-gradient(120% 90% at 20% 0%,rgba(255,255,255,.8),transparent 55%),linear-gradient(160deg,#e6f6ff,#a9d8f2);
  box-shadow:0 6px 0 #6fa6c6,0 6px 0 3px ${UI.ink},0 12px 14px rgba(20,10,2,.35)}
.hm-soon::after{content:'';position:absolute;inset:6px;border-radius:14px;border:2px dashed rgba(22,64,94,.35);pointer-events:none}
.hm-soon b{display:block;font-size:19px;font-weight:700}
.hm-soon span{font-size:14px;font-weight:600;opacity:.8}
.hm-soon .hm-lock{position:absolute;left:14px;top:50%;width:38px;height:38px;margin-top:-19px}
.hm-track{position:relative;margin:0 auto;width:100%;max-width:${TRACK_MAX_W}px}
.hm-track>svg{position:absolute;left:0;top:0;pointer-events:none}
.hm-node{position:absolute;display:flex;flex-direction:column;align-items:center;gap:4px;width:124px;margin-left:-62px;
  padding:0;border:0;background:none;font:inherit;color:#fff;cursor:pointer;touch-action:manipulation}
.hm-disc{--c1:#a5dc84;--c2:${UI.army};--c3:${UI.armyDark};--edge:#1f3f1a;
  display:flex;align-items:center;justify-content:center;box-sizing:border-box;border-radius:50%;
  width:${MAP_NODE_SIZE}px;height:${MAP_NODE_SIZE}px;font-size:30px;font-weight:700;line-height:1;color:#fff;text-shadow:${outlineShadow(2.2)};
  background:radial-gradient(60% 50% at 34% 26%,rgba(255,255,255,.65),transparent 60%),radial-gradient(90% 90% at 40% 35%,var(--c1),var(--c2) 55%,var(--c3));
  border:4px solid ${UI.ink};position:relative;transition:transform 90ms cubic-bezier(.3,1.6,.6,1);
  box-shadow:inset 0 -5px 0 rgba(0,0,0,.2),0 6px 0 var(--edge),0 6px 0 4px ${UI.ink},0 14px 12px rgba(20,10,2,.4)}
.hm-disc::before{content:'';position:absolute;inset:5px;border-radius:50%;border:2px solid rgba(255,255,255,.28);pointer-events:none}
.hm-node:active .hm-disc{transform:translateY(5px);box-shadow:inset 0 -5px 0 rgba(0,0,0,.2),0 1px 0 var(--edge),0 1px 0 4px ${UI.ink},0 4px 6px rgba(20,10,2,.35)}
.hm-node.hm-current .hm-disc{--c1:#fff1b8;--c2:${UI.yellow};--c3:#c98a00;--edge:#7a5200}
.hm-node.hm-current .hm-disc::after{content:'';position:absolute;inset:-14px;border-radius:50%;border:4px solid rgba(255,214,90,.95);
  box-shadow:0 0 14px rgba(255,214,90,.9);animation:hm-glow 1100ms ease-in-out infinite;pointer-events:none}
@keyframes hm-glow{0%,100%{opacity:.35}12%{opacity:1}}
.hm-node.hm-locked .hm-disc{--c1:#d9d3c8;--c2:#9b948a;--c3:#6b655d;--edge:#3f3a33}
.hm-node.hm-boss .hm-disc{--c1:#ffffff;--c2:${UI.tin};--c3:${UI.tinDark};--edge:#3a4148;width:${BOSS_SIZE}px;height:${BOSS_SIZE}px;font-size:36px;
  background:radial-gradient(60% 50% at 34% 26%,rgba(255,255,255,.75),transparent 60%),
    radial-gradient(circle at 50% 9%,#59616a 0 2.5px,transparent 3px),radial-gradient(circle at 91% 50%,#59616a 0 2.5px,transparent 3px),
    radial-gradient(circle at 50% 91%,#59616a 0 2.5px,transparent 3px),radial-gradient(circle at 9% 50%,#59616a 0 2.5px,transparent 3px),
    radial-gradient(90% 90% at 40% 35%,var(--c1),var(--c2) 55%,var(--c3))}
.hm-node.hm-boss.hm-locked .hm-disc{--c2:#9aa1a8;--c3:#555c63}
.hm-badge{position:absolute;top:-17px;left:50%;transform:translateX(-50%) rotate(-4deg);padding:3px 10px 4px;border-radius:9px;
  background:linear-gradient(#f26a5f,${UI.red});border:3px solid ${UI.ink};box-shadow:0 3px 0 ${UI.ink};
  font-size:14px;font-weight:700;letter-spacing:.08em;line-height:1.1;color:#fff;text-shadow:${outlineShadow(1.4)}}
.hm-stars{display:flex;gap:0;padding:2px 6px;border-radius:999px;background:rgba(43,29,18,.72);border:2px solid ${UI.ink};margin-top:6px}
.hm-stars svg{width:18px;height:18px}
.hm-name{max-width:124px;padding:3px 9px 4px;border-radius:10px;border:2.5px solid ${UI.ink};background:${UI.cream};color:${UI.ink};
  font-size:13px;font-weight:700;line-height:1.15;text-align:center;box-shadow:0 2px 0 ${UI.ink}}
.hm-node.hm-locked .hm-name{background:#e9dfcc;color:#6b5a48}
.hm-disc .hm-lock{width:30px;height:30px}
.hm-node.hm-boss .hm-disc .hm-lock{width:36px;height:36px}
.hm-nudge{position:fixed;left:50%;bottom:calc(max(24px,calc(env(safe-area-inset-bottom) + 16px)) - var(--app-under));z-index:9;
  transform:translateX(-50%);padding:12px 22px;border-radius:18px;background:${WOOD_BG};border:3.5px solid ${UI.ink};
  box-shadow:0 4px 0 ${UI.ink},0 10px 14px rgba(20,10,2,.4);font-size:18px;font-weight:700;color:${UI.cream};text-shadow:${outlineShadow(1.6)};
  pointer-events:none;opacity:0;transition:opacity .15s;width:max-content;max-width:calc(100vw - 40px);box-sizing:border-box;text-align:center}
.hm-nudge.hm-on{opacity:1}
.hm-card{position:fixed;inset:0;height:var(--app-h);z-index:12;display:none;flex-direction:column;align-items:center;justify-content:center;gap:18px;
  padding:max(16px,env(safe-area-inset-top)) max(20px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(20px,env(safe-area-inset-left));
  box-sizing:border-box;text-align:center;cursor:pointer;touch-action:manipulation;
  background:radial-gradient(110% 70% at 50% 45%,rgba(122,79,46,.55),rgba(30,16,6,.94)),${FLOOR_BG};
  font-family:var(--tb-font);color:${UI.cream};-webkit-user-select:none;user-select:none;opacity:1;transition:opacity .3s}
.hm-card.hm-on{display:flex}
.hm-card.hm-out{opacity:0;pointer-events:none}
.hm-card-title{order:2;margin:0;max-width:340px;padding:18px 22px 22px;box-sizing:border-box;font-size:36px;font-weight:700;line-height:1.1;
  color:${UI.cream};text-shadow:${outlineShadow(2.8)};background:${WOOD_BG};border:4px solid ${UI.ink};border-radius:22px;
  box-shadow:inset 0 3px 0 rgba(255,225,180,.3),inset 0 -5px 0 rgba(0,0,0,.25),0 7px 0 ${UI.ink},0 18px 24px rgba(0,0,0,.5);transform:rotate(-1.5deg)}
.hm-card-art{order:1;display:flex;align-items:flex-end;gap:10px}
.hm-card-art .hm-army{width:96px;height:96px;border-radius:50%;border:4px solid ${UI.ink};display:flex;align-items:center;justify-content:center;
  box-shadow:inset 0 -5px 0 rgba(0,0,0,.2),0 5px 0 ${UI.ink}}
.hm-card-art .hm-army svg{width:76px;height:76px}
.hm-card-art .hm-green{background:radial-gradient(80% 70% at 35% 25%,#a5dc84,${UI.army} 55%,${UI.armyDark})}
.hm-card-art .hm-tan{background:radial-gradient(80% 70% at 35% 25%,${UI.tanLight},${UI.tan} 55%,${UI.tanDark})}
.hm-card-art .hm-tan svg{transform:scaleX(-1)}
.hm-vs{align-self:center;font-size:30px;font-weight:700;color:${UI.yellow};text-shadow:${outlineShadow(2.4)}}
.hm-card-sub{order:3;margin:0;padding:6px 16px 7px;border-radius:999px;border:3px solid ${UI.ink};background:${UI.cream};color:${UI.ink};
  font-size:17px;font-weight:700;box-shadow:0 3px 0 ${UI.ink}}
.hm-card-hint{order:4;margin:10px 0 0;font-size:16px;font-weight:600;color:#f3dcb0;text-shadow:${outlineShadow(1.4)};animation:hm-hint 1600ms ease-in-out infinite}
@keyframes hm-hint{0%,100%{opacity:.55}50%{opacity:1}}
.hm-foot{position:relative;z-index:2;flex:none;background:${WOOD_BG};border-top:4px solid ${UI.ink};
  box-shadow:inset 0 4px 0 rgba(255,225,180,.18),0 -6px 10px rgba(20,10,2,.4);
  padding:12px max(16px,env(safe-area-inset-right)) max(10px,calc(env(safe-area-inset-bottom) + 4px)) max(16px,env(safe-area-inset-left))}
.hm-foot .tb-btn{max-width:${TRACK_MAX_W - 60}px;margin:0 auto 6px;min-height:62px;justify-content:center;gap:12px}
.hm-exp-ico{flex:none;width:38px;height:38px}
.hm-exp-ico svg{width:38px;height:38px;display:block}
.hm-exp-txt{display:flex;flex-direction:column;align-items:flex-start;gap:3px;min-width:0}
.hm-exp-txt b{font-size:24px;font-weight:700;line-height:1}
.hm-exp-txt small{font-size:13px;font-weight:600;line-height:1;opacity:.78;white-space:nowrap}
.hm-exp-run{position:absolute;top:-14px;right:14px;padding:3px 9px 4px;border-radius:9px;border:3px solid ${UI.ink};
  background:linear-gradient(#5cbf5f,${UI.green});box-shadow:0 3px 0 ${UI.ink};transform:rotate(3deg);
  font-size:12px;font-weight:700;letter-spacing:.04em;line-height:1.1;color:#fff;text-shadow:${outlineShadow(1.3)};white-space:nowrap}
.hm-exp-dot{position:absolute;top:-8px;left:-8px;width:20px;height:20px;box-sizing:border-box;border-radius:50%;border:3px solid ${UI.ink};
  background:radial-gradient(60% 55% at 35% 30%,#ff9a90,${UI.red} 70%);box-shadow:0 2px 0 ${UI.ink}}
.hm-exp-run[hidden],.hm-exp-dot[hidden]{display:none}
.hm-map.hm-has-foot .hm-scroll{padding-bottom:0}
.hm-map.hm-has-foot .hm-nudge{bottom:calc(max(10px,env(safe-area-inset-bottom)) + 100px)}
.hm-map.hm-has-dock .hm-nudge{bottom:calc(max(10px,env(safe-area-inset-bottom)) + 186px)}
.hm-coin-total{display:inline-flex;align-items:center;gap:4px;padding:2px 10px 2px 3px;border-radius:999px;border:2.5px solid ${UI.ink};
  background:${UI.cream};color:${UI.ink};text-shadow:none;font-weight:700;box-shadow:0 2px 0 ${UI.ink}}
.hm-coin-total svg{width:22px;height:22px}
.hm-coin-total[hidden]{display:none}
.hm-head .tb-btn.hm-cog{min-width:0;width:52px;padding:0}
.hm-dock{display:flex;gap:10px;max-width:${TRACK_MAX_W - 60}px;margin:0 auto 18px}
.hm-meta.hm-wrap{flex-wrap:wrap;row-gap:5px}
.hm-faction{white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis}
.hm-meta>.hm-star-total,.hm-meta>.hm-coin-total{flex:none}
.hm-dock .tb-btn{flex:1;min-width:0;margin:0 0 6px;min-height:56px;font-size:19px;gap:8px;padding:0 10px}
.hm-dock .tb-btn svg{width:32px;height:32px}
.hm-dock-new{position:absolute;top:-12px;right:-6px;min-width:26px;box-sizing:border-box;padding:2px 7px 3px;border-radius:999px;border:3px solid ${UI.ink};
  background:linear-gradient(#f26a5f,${UI.red});box-shadow:0 2px 0 ${UI.ink};color:#fff;text-shadow:${outlineShadow(1.2)};
  font-size:13px;font-weight:700;line-height:1.1;text-align:center}
.hm-dock-new[hidden]{display:none}
/* ----- World tabs (more than one world) ----- */
.hm-tabs{display:flex;gap:10px;margin-top:10px}
.hm-tab{position:relative;flex:1 1 0;min-width:0;min-height:54px;display:flex;align-items:center;gap:8px;padding:4px 10px 4px 6px;box-sizing:border-box;
  border:3px solid ${UI.ink};border-radius:16px;background:rgba(30,16,6,.38);color:${UI.cream};font:inherit;text-align:left;cursor:pointer;
  box-shadow:inset 0 2px 0 rgba(255,225,180,.16),0 3px 0 ${UI.ink};touch-action:manipulation;-webkit-tap-highlight-color:transparent;
  transition:transform 90ms cubic-bezier(.3,1.6,.6,1)}
.hm-tab:active{transform:translateY(3px)}
.hm-tab:focus-visible{outline:3px solid ${UI.yellow};outline-offset:3px}
.hm-tab[aria-selected='true']{color:${UI.ink};background:radial-gradient(120% 90% at 30% 0%,rgba(255,255,255,.8) 0 18%,transparent 46%),linear-gradient(180deg,${UI.cream},#f1e2c0);
  box-shadow:0 4px 0 -0.5px #c9a978,0 4px 0 3px ${UI.ink}}
.hm-tab-ico{flex:none;width:40px;height:40px;border-radius:50%;border:3px solid ${UI.ink};box-sizing:border-box;display:flex;align-items:center;justify-content:center;
  box-shadow:inset 0 -3px 0 rgba(0,0,0,.18),0 2px 0 ${UI.ink}}
.hm-tab-ico svg{width:30px;height:30px}
.hm-tab-ico.hm-bedroom{background:radial-gradient(80% 70% at 35% 25%,#a5dc84,${UI.army} 55%,${UI.armyDark})}
.hm-tab-ico.hm-freezer{background:radial-gradient(80% 70% at 35% 25%,#f2fbff,#8fd0ee 55%,#3f8fbf)}
.hm-tab.hm-locked .hm-tab-ico{filter:saturate(.35) brightness(.9)}
.hm-tab-txt{display:flex;flex-direction:column;gap:3px;min-width:0}
.hm-tab-txt b{font-size:17px;font-weight:700;line-height:1;white-space:nowrap}
.hm-tab-txt small{display:flex;align-items:center;gap:3px;font-size:13px;font-weight:600;line-height:1;white-space:nowrap;overflow:hidden;opacity:.85}
.hm-tab-txt small svg{flex:none;width:14px;height:14px}
.hm-tab:not([aria-selected='true']) .hm-tab-txt{text-shadow:${outlineShadow(1.5)}}
.hm-tab-new{position:absolute;top:-9px;right:-7px;width:20px;height:20px;box-sizing:border-box;border-radius:50%;border:3px solid ${UI.ink};
  background:radial-gradient(60% 55% at 35% 30%,#ff9a90,${UI.red} 70%);box-shadow:0 2px 0 ${UI.ink}}
.hm-tab-new[hidden]{display:none}

/* ----- One page per world; a locked world's padlock card floats over its frosted track ----- */
.hm-page{position:relative;flex:1;min-height:0;display:none;flex-direction:column}
.hm-page.hm-on{display:flex}
.hm-page.hm-locked .hm-track{filter:saturate(.55) brightness(1.04);opacity:.72}
.hm-wlock{position:absolute;z-index:2;left:50%;top:50%;width:min(320px,calc(100% - 40px));transform:translate(-50%,-50%) rotate(-1deg);
  box-sizing:border-box;padding:18px 18px 14px;text-align:center;color:#16405e;border:4px solid ${UI.ink};border-radius:24px;
  background:radial-gradient(120% 90% at 20% 0%,rgba(255,255,255,.9),transparent 55%),linear-gradient(160deg,#f2fbff,#b3def4);
  box-shadow:0 7px 0 #6fa6c6,0 7px 0 3.5px ${UI.ink},0 18px 24px rgba(10,40,64,.4)}
.hm-wlock[hidden]{display:none}
.hm-wlock::after{content:'';position:absolute;inset:7px;border-radius:17px;border:2px dashed rgba(22,64,94,.32);pointer-events:none}
.hm-wlock .hm-lock{display:block;width:60px;height:60px;margin:-50px auto 6px}
.hm-wlock .hm-lock svg{width:60px;height:60px}
.hm-wlock h2{margin:0 0 6px;font-size:22px;font-weight:700;line-height:1.1}
.hm-wlock p{margin:0 0 12px;font-size:16px;font-weight:600;line-height:1.25}
.hm-wlock .tb-btn{position:relative;z-index:1;margin:0}
.hm-soon.hm-go{display:block;font:inherit;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;min-height:64px}
.hm-soon.hm-go:active{transform:translateY(4px);box-shadow:0 2px 0 #6fa6c6,0 2px 0 3px ${UI.ink},0 6px 8px rgba(20,10,2,.3)}
.hm-soon .hm-soon-ico{position:absolute;left:12px;top:50%;width:42px;height:42px;margin-top:-21px}
.hm-soon .hm-soon-ico svg{width:42px;height:42px}

/* ----- World 2: the freezer shelf ----- */
.hm-map.hm-cold{background:#9cc7de}
.hm-map.hm-cold .hm-shade{background:radial-gradient(130% 90% at 50% 55%,transparent 55%,rgba(16,52,80,.38) 100%)}
.hm-scroll.hm-freezer{background:${FREEZER_BG};background-attachment:local}
.hm-freezer .hm-disc{--c1:#e6f7ff;--c2:#5fb4e0;--c3:#2f78a8;--edge:#1d4f73}
.hm-freezer .hm-disc::before{inset:4px;border:2.5px dashed rgba(240,250,255,.9)}
.hm-freezer .hm-node.hm-locked .hm-disc{--c1:#eef3f6;--c2:#a9b8c2;--c3:#77889a;--edge:#4a5864}
.hm-snowcap{position:absolute;left:50%;top:-9px;width:52px;height:20px;margin-left:-26px;pointer-events:none}
.hm-snowcap svg{display:block;width:52px;height:20px}
.hm-freezer .hm-name{background:#f4fbff}
.hm-freezer .hm-node.hm-locked .hm-name{background:#dde8ee;color:#56697a}
.hm-freezer .hm-node.hm-boss .hm-disc{--c1:#ffffff;--c2:#bfe6f8;--c3:#6fb2d6;--edge:#2e6f93;
  background:radial-gradient(38% 28% at 32% 24%,rgba(255,255,255,.95),transparent 70%),
    radial-gradient(circle at 30% 58%,#fff 0 2px,transparent 2.6px),radial-gradient(circle at 67% 38%,#fff 0 2px,transparent 2.6px),
    radial-gradient(circle at 57% 70%,#fff 0 1.6px,transparent 2.2px),radial-gradient(circle at 43% 34%,#fff 0 1.4px,transparent 2px),
    radial-gradient(circle at 76% 60%,#fff 0 1.8px,transparent 2.4px),radial-gradient(circle at 22% 42%,#fff 0 1.3px,transparent 1.9px),
    radial-gradient(62% 26% at 50% 100%,#ffffff 0 62%,transparent 64%),
    radial-gradient(90% 90% at 40% 35%,var(--c1),var(--c2) 55%,var(--c3))}
.hm-freezer .hm-node.hm-boss.hm-locked .hm-disc{--c2:#cbd7de;--c3:#8695a0}
.hm-globe-base{position:absolute;z-index:1;left:50%;bottom:-17px;width:80px;height:24px;margin-left:-40px;box-sizing:border-box;
  border:3.5px solid ${UI.ink};border-radius:8px 8px 14px 14px;background:linear-gradient(180deg,#e0574b 0%,#b5302a 60%,#8c221d 100%);
  box-shadow:inset 0 3px 0 rgba(255,255,255,.3),0 4px 0 ${UI.ink}}
.hm-globe-base::after{content:'';position:absolute;left:7px;right:7px;top:5px;height:4px;border-radius:2px;background:#d2a33f}
.hm-freezer .hm-node.hm-boss .hm-stars{margin-top:22px}

/* ----- The freezer's title card: an ice block over the shelf ----- */
.hm-card.hm-frost{background:radial-gradient(110% 70% at 50% 45%,rgba(190,230,250,.3),rgba(8,34,56,.93)),${FREEZER_BG}}
.hm-card.hm-frost .hm-card-title{position:relative;background:linear-gradient(165deg,#f7fcff 0%,#cdeaf8 45%,#93cde9 100%);
  box-shadow:inset 0 3px 0 rgba(255,255,255,.85),inset 0 -5px 0 rgba(40,110,160,.3),0 7px 0 ${UI.ink},0 18px 24px rgba(0,0,0,.5)}
.hm-card.hm-frost .hm-card-title::before{content:'';position:absolute;left:12%;right:12%;top:-12px;height:18px;border:3.5px solid ${UI.ink};border-bottom:0;
  border-radius:14px 14px 4px 4px;background:#f6fbfe}
.hm-card-art .hm-ice{background:radial-gradient(80% 70% at 35% 25%,#f2fbff,#8fd0ee 55%,#3f8fbf)}
.hm-card-art .hm-mini{width:64px;height:64px;align-self:flex-end;margin-left:-26px}
.hm-card-art .hm-mini svg{width:50px;height:50px}
.hm-card.hm-frost .hm-card-hint{color:#e6f6ff}
@media (prefers-reduced-motion: reduce){.hm-card{transition:none}.hm-card-hint,.hm-node.hm-current .hm-disc::after{animation:none}}
`;

let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  injectUiTheme();
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

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

// Icon markup in a span (decorative).
function iconSpan(cls: string, html: string): HTMLSpanElement {
  const e = el('span', cls);
  e.setAttribute('aria-hidden', 'true');
  e.innerHTML = html;
  return e;
}

// Smooth curve through points (Catmull-Rom converted to cubic Béziers).
function smoothPath(pts: readonly { x: number; y: number }[]): string {
  if (pts.length === 0) return '';
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;
  }
  return d;
}

// Short label for a node: '1-7' → '7'.
function levelNumber(id: string): string {
  const dash = id.lastIndexOf('-');
  return dash >= 0 ? id.slice(dash + 1) : id;
}

// The road drawn under a world's level nodes, as stacked strokes of one path: soft
// contact shadow, ink edge, kerb, road, sheen and a dashed centre line.
interface TrackStroke {
  stroke: string;
  width: number;
  dash?: string;
  cap?: 'round' | 'butt';
  shift?: string;
}
const TRACKS: Readonly<Record<WorldTheme, readonly TrackStroke[]>> = {
  // A toy race track lying on the floor: red and white kerb, grey road.
  bedroom: [
    { stroke: 'rgba(40,18,4,.35)', width: 46, shift: 'translate(0 6)' },
    { stroke: UI.ink, width: 42 },
    { stroke: '#e03131', width: 36 },
    { stroke: '#f1f3f5', width: 36, dash: '14 14', cap: 'butt' },
    { stroke: '#5c636e', width: 28 },
    { stroke: 'rgba(255,255,255,.12)', width: 10, shift: 'translate(-3 -4)' },
    { stroke: '#f1f3f5', width: 3, dash: '10 12' },
  ],
  // An icy path on the shelf: a snow bank with blue-shadowed drifts, pale ice, a glassy sheen.
  freezer: [
    { stroke: 'rgba(30,80,115,.3)', width: 48, shift: 'translate(0 6)' },
    { stroke: UI.ink, width: 42 },
    { stroke: '#f7fbfe', width: 36 },
    { stroke: '#cfe6f3', width: 36, dash: '6 22', cap: 'round' },
    { stroke: '#8fcbea', width: 26 },
    { stroke: 'rgba(255,255,255,.55)', width: 8, shift: 'translate(-4 -4)' },
    { stroke: '#e9f7ff', width: 3, dash: '3 14' },
  ],
};

// A drift of snow sitting on a level badge, with two icicles (World 2).
const SNOWCAP =
  `<svg viewBox="0 0 52 20" aria-hidden="true" focusable="false">` +
  `<path d="M3 14 C3 6 10 3 17 5 C21 1 31 1 35 5 C42 3 49 6 49 14 C47 16 44 15 42 14 L40 19 L37.5 14 C30 16 22 16 15 14 L13 18.5 L11 14 C8 15.5 4.5 16 3 14 Z" fill="#f7fbfe" stroke="${UI.ink}" stroke-width="2.6" stroke-linejoin="round"/>` +
  `<path d="M10 8 C14 6 18 6 21 7.5" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>` +
  `</svg>`;

function themeOf(entry: MapWorld): WorldTheme {
  return entry.world.theme ?? 'bedroom';
}

interface Page {
  entry: MapWorld;
  theme: WorldTheme;
  root: HTMLDivElement; // the page (tab panel)
  scroll: HTMLDivElement;
  track: HTMLDivElement;
  teaser: HTMLDivElement; // holder of the card above the boss: the next world, or 'coming soon'
  lock: HTMLDivElement; // padlock card, shown while the world is locked
  lockText: HTMLParagraphElement;
  nodes: HTMLButtonElement[];
  laidOutWidth: number;
}

export function createWorldMap(
  root: HTMLElement,
  opts: {
    worlds: readonly MapWorld[]; // in play order; a world's `unlock` names an earlier one
    onPlay(levelId: string): void; // only fires for unlocked levels of open worlds
    onSaveReplaced(save: SaveData): void; // after a confirmed import (already written to storage)
    onExpedition?(): void; // shows the Expedition button when given
    onHome?(): void; // shows the Home base button when given
    onCollection?(): void; // shows the Collection button when given
    onSettings?(): void; // shows the settings cog when given
    // The save sheet exports and imports the whole game (stars, coins, collection). It reads
    // the profile from storage unless getGame is given; onGameReplaced also gets the profile.
    getGame?(): GameData;
    onGameReplaced?(g: GameData): void;
    whenUncovered?(): Promise<void>; // resolves once the loading screen is gone (the title card waits for it)
  },
): WorldMap {
  injectStyles();
  const entries = opts.worlds;
  if (entries.length === 0) throw new Error('createWorldMap needs at least one world');
  const defs = entries.map((e) => e.world);
  const prefs = loadWorldPrefs();
  let current = initialWorldIndex(defs, prefs.lastWorld);

  const map = el('div', 'hm-map');
  map.setAttribute('role', 'main');

  // ----- Header: the world's name, faction, stars and coins; cog and Save; world tabs -----
  const head = el('header', 'hm-head');
  const headRow = el('div', 'hm-head-row');
  const title = el('div', 'hm-title');
  const worldName = el('h1', 'hm-world');
  const meta = el('p', 'hm-meta');
  const faction = el('span', 'hm-faction');
  const totalEl = el('span', 'hm-star-total');
  const coinEl = el('span', 'hm-coin-total');
  coinEl.hidden = true;
  coinEl.dataset.coins = '';
  meta.append(faction, totalEl, coinEl);
  title.append(worldName, meta);
  const saveBtn = el('button', 'tb-btn tb-small', 'Save');
  saveBtn.type = 'button';
  headRow.append(title);
  const onSettings = opts.onSettings;
  if (onSettings) {
    const cog = el('button', 'tb-btn tb-small hm-cog');
    cog.type = 'button';
    cog.dataset.action = 'settings';
    cog.setAttribute('aria-label', 'Settings');
    cog.innerHTML = cogIcon(30);
    cog.addEventListener('click', () => onSettings());
    headRow.append(cog);
  }
  headRow.append(saveBtn);
  head.append(headRow);

  const tabs: HTMLButtonElement[] = [];
  if (entries.length > 1) {
    const tabRow = el('div', 'hm-tabs');
    tabRow.setAttribute('role', 'tablist');
    tabRow.setAttribute('aria-label', 'Worlds');
    entries.forEach((e, i) => {
      const t = el('button', 'hm-tab');
      t.type = 'button';
      t.setAttribute('role', 'tab');
      t.dataset.world = e.world.id;
      t.addEventListener('click', () => selectWorld(i));
      tabRow.append(t);
      tabs.push(t);
    });
    head.append(tabRow);
  }
  map.append(head);

  const nudge = el('div', 'hm-nudge');
  nudge.setAttribute('role', 'status');
  let nudgeTimer = 0;
  const showNudge = (text: string): void => {
    nudge.textContent = text;
    nudge.classList.add('hm-on');
    clearTimeout(nudgeTimer);
    nudgeTimer = window.setTimeout(() => nudge.classList.remove('hm-on'), 1800);
  };

  let save: SaveData = emptySave(); // replaced by show()

  // ----- One page per world: teaser card on top, then the path track; padlock card over it -----
  const pages: Page[] = entries.map((entry, wi) => {
    const theme = themeOf(entry);
    const page = el('div', 'hm-page');
    page.setAttribute('role', 'tabpanel');
    page.dataset.worldPage = entry.world.id;
    const scroll = el('div', `hm-scroll hm-${theme}`);
    const teaser = el('div', '');
    const track = el('div', 'hm-track');
    scroll.append(teaser, track);
    const lock = el('div', 'hm-wlock');
    lock.hidden = true;
    const lockText = el('p', '');
    const lockTitle = el('h2', '', worldTitle(entry.world));
    lock.append(iconSpan('hm-lock', lockSvg(60, '#e6f6ff')), lockTitle, lockText);
    const fromIdx = entries.findIndex((e) => e.world.id === entry.world.unlock?.world);
    if (fromIdx >= 0 && fromIdx !== wi) {
      const back = el('button', 'tb-btn tb-small tb-yellow', `Play ${entries[fromIdx].world.name}`);
      back.type = 'button';
      back.addEventListener('click', () => selectWorld(fromIdx));
      lock.append(back);
    }
    page.append(scroll, lock);
    map.append(page);

    const nodes = entry.levels.map((lv) => {
      const b = el('button', 'hm-node');
      b.type = 'button';
      b.dataset.level = lv.id;
      if (lv.boss) b.classList.add('hm-boss');
      b.addEventListener('click', () => {
        const tap = levelTap(save, entry.world, defs, lv.id);
        if (tap.play) opts.onPlay(lv.id);
        else showNudge(tap.nudge);
      });
      track.appendChild(b);
      return b;
    });
    return { entry, theme, root: page, scroll, track, teaser, lock, lockText, nodes, laidOutWidth: -1 };
  });

  // ----- Expedition footer: a big yellow sticker button over the bottom safe area -----
  let expBtn: HTMLButtonElement | null = null;
  let expSub: HTMLElement | null = null;
  let expRun: HTMLElement | null = null;
  let expDot: HTMLElement | null = null;
  let newBadge: HTMLElement | null = null;
  const onExpedition = opts.onExpedition;
  const { onHome, onCollection } = opts;
  const foot = el('footer', 'hm-foot');
  if (onHome || onCollection) {
    // Dock row: Home base and Collection, above the Expedition button.
    const dock = el('div', 'hm-dock');
    if (onHome) {
      const b = el('button', 'tb-btn tb-small');
      b.type = 'button';
      b.dataset.action = 'home';
      b.innerHTML = homeIcon(32);
      b.append(el('span', '', 'Home base'));
      b.addEventListener('click', () => onHome());
      dock.append(b);
    }
    if (onCollection) {
      const b = el('button', 'tb-btn tb-small');
      b.type = 'button';
      b.dataset.action = 'collection';
      b.innerHTML = cardsIcon(32);
      newBadge = el('span', 'hm-dock-new');
      newBadge.hidden = true;
      b.append(el('span', '', 'Collection'), newBadge);
      b.addEventListener('click', () => onCollection());
      dock.append(b);
    }
    foot.append(dock);
    map.classList.add('hm-has-dock');
  }
  if (onExpedition) {
    expBtn = el('button', 'tb-btn tb-yellow');
    expBtn.type = 'button';
    expBtn.dataset.action = 'expedition';
    const txt = el('span', 'hm-exp-txt');
    expSub = el('small', '');
    txt.append(el('b', '', 'Expedition'), expSub);
    expRun = el('span', 'hm-exp-run', 'Run in progress');
    expDot = el('span', 'hm-exp-dot');
    expDot.title = 'Daily ready';
    expBtn.append(iconSpan('hm-exp-ico', compassIcon(38)), txt, expRun, expDot);
    expBtn.addEventListener('click', () => onExpedition());
    foot.append(expBtn);
  }
  if (foot.childElementCount > 0) {
    map.append(foot);
    map.classList.add('hm-has-foot');
  }
  const renderExtras = (extra?: WorldMapExtra): void => {
    const coins = extra?.coins;
    coinEl.hidden = coins === undefined;
    meta.classList.toggle('hm-wrap', coins !== undefined);
    if (coins !== undefined) {
      coinEl.innerHTML = coinIcon(22);
      coinEl.append(formatCoins(coins));
      coinEl.setAttribute('aria-label', `${formatCoins(coins)} coins`);
    }
    if (newBadge) {
      const n = Math.max(0, Math.floor(extra?.newItems ?? 0));
      newBadge.hidden = n === 0;
      newBadge.textContent = String(n);
      newBadge.parentElement?.setAttribute('aria-label', n > 0 ? `Collection, ${n} new` : 'Collection');
    }
  };
  const renderExpedition = (flags?: ExpeditionEntryFlags): void => {
    if (!expBtn || !expSub || !expRun || !expDot) return;
    const look = expeditionEntryLook(flags);
    expSub.textContent = look.sub;
    expRun.hidden = !look.progress;
    expDot.hidden = !look.daily;
    expBtn.setAttribute('aria-label', look.aria);
  };
  renderExpedition();

  map.append(el('div', 'hm-shade'), nudge);
  root.appendChild(map);

  // ----- World title card: gone on a tap or after TITLE_CARD_MS -----
  const card = el('div', 'hm-card');
  card.setAttribute('role', 'dialog');
  root.appendChild(card);
  let cardTimer = 0;
  let cardFadeTimer = 0;
  let firstLook = true; // the session's first show() of the map
  const dismissCard = (): void => {
    if (!card.classList.contains('hm-on') || card.classList.contains('hm-out')) return;
    clearTimeout(cardTimer);
    card.classList.add('hm-out'); // fades (opacity only); taps pass to the map at once
    cardFadeTimer = window.setTimeout(() => card.classList.remove('hm-on', 'hm-out'), 320);
  };
  card.addEventListener('click', dismissCard);
  // Fills the card for a world. The title stays the first line of its text (the smoke test
  // reads it); the art is ordered above it in CSS.
  const fillCard = (entry: MapWorld): void => {
    const w = entry.world;
    const cold = themeOf(entry) === 'freezer';
    card.classList.toggle('hm-frost', cold);
    card.setAttribute('aria-label', worldTitle(w));
    card.dataset.titleCard = w.id;
    const art = el('div', 'hm-card-art');
    art.setAttribute('aria-hidden', 'true');
    art.append(iconSpan('hm-army hm-green', soldierIcon(76, UI.cream)), el('span', 'hm-vs', 'VS'));
    if (cold)
      art.append(iconSpan('hm-army hm-ice', snowmanIcon(76)), iconSpan('hm-army hm-ice hm-mini', penguinIcon(50)));
    else art.append(iconSpan('hm-army hm-tan', soldierIcon(76, UI.cream)));
    card.replaceChildren(
      el('h1', 'hm-card-title', worldTitle(w)),
      art,
      el('p', 'hm-card-sub', `vs the ${w.faction}`),
      el('p', 'hm-card-hint', 'Tap to start'),
    );
  };
  fillCard(entries[current]);
  // Shows the card once it is actually on screen (boot work and the loading screen can
  // hold it back), and counts its time from then.
  const openCard = (entry: MapWorld): void => {
    clearTimeout(cardTimer);
    clearTimeout(cardFadeTimer);
    fillCard(entry);
    card.classList.remove('hm-out');
    card.classList.add('hm-on');
    if (!prefs.seen.includes(entry.world.id)) {
      prefs.seen = [...prefs.seen, entry.world.id];
      saveWorldPrefs(prefs);
    }
    void (opts.whenUncovered?.() ?? Promise.resolve()).then(() =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (card.classList.contains('hm-on')) cardTimer = window.setTimeout(dismissCard, TITLE_CARD_MS);
        }),
      ),
    );
  };

  let visible = false;

  const sheet = createSaveSheet(root, {
    getGame: () => opts.getGame?.() ?? { save, profile: loadGame().profile },
    onGameReplaced: (next) => {
      save = next.save;
      render();
      opts.onGameReplaced?.(next);
      opts.onSaveReplaced(next.save);
    },
  });
  saveBtn.addEventListener('click', () => sheet.open());

  // Positions depend only on width, so redo them on resize but not on every show.
  function layout(p: Page): void {
    const w = p.track.clientWidth;
    if (w === p.laidOutWidth || w === 0) return;
    p.laidOutWidth = w;
    const levels = p.entry.levels;
    const pts = mapLayout(levels.length, w, { nodeSize: BOSS_SIZE, margin: 16, step: MAP_NODE_STEP });
    const topY = pts.length ? pts[pts.length - 1].y : 0;
    const h = topY + PAD_TOP + PAD_BOTTOM + BOSS_SIZE / 2;
    p.track.style.height = `${h}px`;
    // Convert upward y to CSS top (disc centre).
    const centres = pts.map((pt) => ({ x: pt.x, y: h - PAD_BOTTOM - pt.y }));

    p.track.querySelector('svg')?.remove();
    const s = svg('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}`, 'aria-hidden': 'true' });
    const d = smoothPath(centres);
    for (const t of TRACKS[p.theme]) {
      const attrs: Record<string, string | number> = {
        d,
        fill: 'none',
        stroke: t.stroke,
        'stroke-width': t.width,
        'stroke-linecap': t.cap ?? 'round',
      };
      if (t.dash) attrs['stroke-dasharray'] = t.dash;
      if (t.shift) attrs.transform = t.shift;
      s.append(svg('path', attrs));
    }
    p.track.prepend(s);

    centres.forEach((c, i) => {
      const disc = levels[i].boss ? BOSS_SIZE : MAP_NODE_SIZE;
      p.nodes[i].style.left = `${c.x}px`;
      p.nodes[i].style.top = `${c.y - disc / 2}px`;
    });
  }

  // The card above a world's boss: the next world (padlock or a way in), or 'coming soon'.
  function renderTeaser(p: Page, wi: number, tabList: readonly WorldTab[]): void {
    const next = entries[wi + 1];
    if (!next) {
      const soon = el('div', 'hm-soon');
      soon.append(
        iconSpan('hm-lock', lockSvg(38, '#e6f6ff')),
        el('b', '', 'More worlds'),
        el('span', '', 'Coming soon'),
      );
      p.teaser.replaceChildren(soon);
      return;
    }
    const nextTitle = worldTitle(next.world);
    if (tabList[wi + 1].locked) {
      const soon = el('div', 'hm-soon');
      soon.append(
        iconSpan('hm-lock', lockSvg(38, '#e6f6ff')),
        el('b', '', nextTitle),
        el('span', '', lockedWorldText(save, next.world, defs)),
      );
      p.teaser.replaceChildren(soon);
      return;
    }
    const go = el('button', 'hm-soon hm-go');
    go.type = 'button';
    go.dataset.action = 'next-world';
    go.append(
      iconSpan('hm-soon-ico', worldEmblem(next)),
      el('b', '', nextTitle),
      el('span', '', 'Open: tap to go there'),
    );
    go.addEventListener('click', () => selectWorld(wi + 1));
    p.teaser.replaceChildren(go);
  }

  function renderPage(p: Page, wi: number, tabList: readonly WorldTab[]): number {
    const { world, levels } = p.entry;
    const locked = tabList[wi].locked;
    p.root.classList.toggle('hm-locked', locked);
    p.lock.hidden = !locked;
    p.lockText.textContent = lockedWorldText(save, world, defs);
    renderTeaser(p, wi, tabList);
    let currentLevel = -1;
    levels.forEach((lv, i) => {
      const b = p.nodes[i];
      const tap = levelTap(save, world, defs, lv.id);
      const open = tap.play;
      const stars = save.levels[lv.id]?.stars ?? [false, false, false];
      if (open) currentLevel = i;
      b.classList.toggle('hm-locked', !open);
      b.replaceChildren();
      const disc = el('span', 'hm-disc');
      if (lv.boss) disc.append(el('span', 'hm-badge', 'BOSS'));
      else if (p.theme === 'freezer') disc.append(iconSpan('hm-snowcap', SNOWCAP));
      if (open) disc.append(levelNumber(lv.id));
      else disc.append(iconSpan('hm-lock', lockSvg(lv.boss ? 36 : 30, '#f1ebe0')));
      if (lv.boss && p.theme === 'freezer') disc.append(el('span', 'hm-globe-base'));
      const starRow = iconSpan('hm-stars', stars.map((lit) => starIcon(18, lit ? '' : 'tb-off')).join(''));
      b.append(disc, starRow, el('span', 'hm-name', lv.name));
      const got = stars.filter(Boolean).length;
      b.setAttribute('aria-label', `${lv.id} ${lv.name}, ${open ? `${got} of 3 stars` : 'locked'}`);
    });
    // The newest unlocked level gets the highlight until it is won (the boss keeps its own look).
    p.nodes.forEach((b, i) => {
      const won = save.levels[levels[i].id]?.stars[0] === true;
      b.classList.toggle('hm-current', i === currentLevel && !won && !levels[i].boss);
    });
    return currentLevel;
  }

  function renderTabs(tabList: readonly WorldTab[]): void {
    tabs.forEach((t, i) => {
      const tab = tabList[i];
      const on = i === current;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      t.classList.toggle('hm-locked', tab.locked);
      const sub = el('small', '');
      if (tab.locked) sub.append(iconSpan('', lockSvg(14, on ? UI.ink : UI.cream)), 'Locked');
      else sub.append(iconSpan('', starIcon(14)), `${tab.stars}/${tab.maxStars}`);
      const txt = el('span', 'hm-tab-txt');
      txt.append(el('b', '', tab.label), sub);
      const dot = el('span', 'hm-tab-new');
      dot.hidden = !tab.fresh || on;
      t.replaceChildren(iconSpan(`hm-tab-ico hm-${themeOf(entries[i])}`, worldEmblem(entries[i])), txt, dot);
      t.setAttribute(
        'aria-label',
        `${tab.label}, ${tab.name}: ${tab.locked ? 'locked' : `${tab.stars} of ${tab.maxStars} stars`}${tab.fresh ? ', new' : ''}`,
      );
    });
  }

  function renderHeader(): void {
    const { world } = entries[current];
    map.setAttribute('aria-label', `${world.name} map`);
    map.classList.toggle('hm-cold', pages[current].theme === 'freezer');
    worldName.textContent = world.name;
    faction.textContent = `vs ${world.faction}`;
    const got = starCount(save, world.levels);
    const max = world.levels.length * 3;
    totalEl.innerHTML = starIcon(20);
    totalEl.append(`${got}/${max}`);
    totalEl.setAttribute('aria-label', `${got} of ${max} stars`);
    pages.forEach((p, i) => p.root.classList.toggle('hm-on', i === current));
  }

  // Redraws every page (cheap: a few dozen nodes) and scrolls the shown one to its newest level.
  function render(): void {
    const tabList = worldTabs(save, defs, prefs.seen);
    renderHeader();
    renderTabs(tabList);
    const currentLevels = pages.map((p, i) => renderPage(p, i, tabList));
    layout(pages[current]);
    scrollTo(pages[current], currentLevels[current]);
  }

  function scrollTo(p: Page, index: number): void {
    const b = p.nodes[Math.max(0, index)];
    if (!b) return;
    // Centre the node in the visible area (instant: no animated motion).
    const top = b.offsetTop + p.track.offsetTop - p.scroll.clientHeight / 2 + MAP_NODE_SIZE / 2;
    p.scroll.scrollTop = Math.max(0, top);
  }

  // Switches the page; an open world seen for the first time opens with its title card.
  function selectWorld(i: number): void {
    if (i === current || i < 0 || i >= entries.length) return;
    current = i;
    prefs.lastWorld = entries[i].world.id;
    saveWorldPrefs(prefs);
    nudge.classList.remove('hm-on');
    if (!visible) return;
    const tabList = worldTabs(save, defs, prefs.seen);
    const opening = showsTitleCard(tabList[i], false, prefs.seen);
    render();
    if (opening) openCard(entries[i]);
    tabs[i]?.focus({ preventScroll: true });
  }

  const onResize = (): void => {
    if (visible) layout(pages[current]);
  };
  window.addEventListener('resize', onResize);

  return {
    show(next: SaveData, extra?: WorldMapExtra) {
      save = next;
      visible = true;
      renderExpedition(extra?.expedition);
      renderExtras(extra);
      map.classList.add('hm-on');
      render(); // lays the shown page out once the map is displayed (it needs a width)
      const tab = worldTabs(save, defs, prefs.seen)[current];
      if (showsTitleCard(tab, firstLook, prefs.seen)) openCard(entries[current]);
      firstLook = false;
    },
    hide() {
      visible = false;
      map.classList.remove('hm-on');
      nudge.classList.remove('hm-on');
      clearTimeout(cardTimer);
      card.classList.remove('hm-on', 'hm-out');
      sheet.close();
    },
    get visible() {
      return visible;
    },
    get worldId() {
      return entries[current].world.id;
    },
    showWorld(id: string) {
      const i = entries.findIndex((e) => e.world.id === id);
      if (i >= 0) selectWorld(i);
    },
    dispose() {
      window.removeEventListener('resize', onResize);
      clearTimeout(nudgeTimer);
      clearTimeout(cardTimer);
      clearTimeout(cardFadeTimer);
      sheet.dispose();
      card.remove();
      map.remove();
    },
  };
}

// A world's round emblem figure: a soldier for the bedroom, a snowflake for the freezer.
function worldEmblem(entry: MapWorld): string {
  return themeOf(entry) === 'freezer' ? snowflakeIcon(30) : soldierIcon(30, UI.cream);
}
