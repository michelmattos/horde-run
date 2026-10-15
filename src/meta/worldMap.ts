// World map screen: plain HTML/SVG over the app root, shown instead of the
// battle. World 1 is the bedroom floor: wooden floorboards with a toy race track
// winding from the first level (bottom) to the boss (top). The page scrolls
// natively and nothing on it ever moves on its own except the one auto-scroll to
// the newest unlocked level on show(). The first show() opens with a brief world
// title card (no story): a tap or a short timeout dismisses it. When the caller handles
// Expedition runs, a wooden footer plank holds a big yellow Expedition button (badges for
// a run in progress and an unplayed Daily run); the scroll area ends above it.
import type { SaveData, WorldDef } from '../contracts.ts';
import { emptySave, isUnlocked, starCount } from '../core/save.ts';
import { MAP_NODE_SIZE, MAP_STEP, TITLE_CARD_MS, mapLayout, worldTitle } from './mapLayout.ts';
import { createSaveSheet } from './saveSheet.ts';
import { expeditionEntryLook } from './expeditionEntry.ts';
import type { ExpeditionEntryFlags } from './expeditionEntry.ts';
import { UI, WOOD_BG, injectUiTheme, outlineShadow } from '../ui/theme.ts';
import { compassIcon, lockIcon as lockSvg, soldierIcon, starIcon } from '../ui/icons.ts';

export { mapLayout } from './mapLayout.ts';
export type { MapLayoutOptions } from './mapLayout.ts';
export type { ExpeditionEntryFlags } from './expeditionEntry.ts';

// Optional extras for show(): the Expedition button's badges.
export interface WorldMapExtra {
  expedition?: ExpeditionEntryFlags;
}

export interface MapLevel {
  id: string;
  name: string;
  boss: boolean;
}

export interface WorldMap {
  show(save: SaveData, extra?: WorldMapExtra): void;
  hide(): void;
  readonly visible: boolean;
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

const CSS = `
.hm-map{position:fixed;inset:0;height:100dvh;z-index:8;display:none;flex-direction:column;
  font-family:var(--tb-font);font-variant-numeric:tabular-nums;color:${UI.cream};background:#8a5a32;
  -webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}
.hm-map.hm-on{display:flex}
.hm-head{position:relative;z-index:2;flex:none;display:flex;align-items:center;gap:12px;background:${WOOD_BG};
  border-bottom:4px solid ${UI.ink};box-shadow:inset 0 -4px 0 rgba(0,0,0,.25),0 6px 10px rgba(20,10,2,.45);
  padding:max(12px,calc(env(safe-area-inset-top) + 6px)) max(14px,env(safe-area-inset-right)) 12px max(14px,env(safe-area-inset-left))}
.hm-title{flex:1;min-width:0}
.hm-world{margin:0;font-size:25px;font-weight:700;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  color:${UI.cream};text-shadow:${outlineShadow(2.2)};padding:2px 2px 4px}
.hm-meta{margin:3px 0 0;display:flex;align-items:center;gap:8px;font-size:15px;font-weight:600;color:#f3dcb0;text-shadow:${outlineShadow(1.4)}}
.hm-star-total{display:inline-flex;align-items:center;gap:4px;padding:2px 10px 2px 4px;border-radius:999px;border:2.5px solid ${UI.ink};
  background:${UI.cream};color:${UI.ink};text-shadow:none;font-weight:700;box-shadow:0 2px 0 ${UI.ink}}
.hm-star-total svg{width:20px;height:20px}
.hm-head .tb-btn{flex:none;width:auto;min-width:76px;margin:0 0 5px}
.hm-scroll{position:relative;flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;touch-action:pan-y;overscroll-behavior:contain;
  -webkit-overflow-scrolling:touch;background:${FLOOR_BG};background-attachment:local;
  padding:0 max(0px,env(safe-area-inset-right)) env(safe-area-inset-bottom) max(0px,env(safe-area-inset-left))}
.hm-shade{position:fixed;inset:0;pointer-events:none;z-index:1;
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
.hm-nudge{position:fixed;left:50%;bottom:max(24px,calc(env(safe-area-inset-bottom) + 16px));z-index:9;
  transform:translateX(-50%);padding:12px 22px;border-radius:18px;background:${WOOD_BG};border:3.5px solid ${UI.ink};
  box-shadow:0 4px 0 ${UI.ink},0 10px 14px rgba(20,10,2,.4);font-size:18px;font-weight:700;color:${UI.cream};text-shadow:${outlineShadow(1.6)};
  pointer-events:none;opacity:0;transition:opacity .15s;white-space:nowrap}
.hm-nudge.hm-on{opacity:1}
.hm-card{position:fixed;inset:0;z-index:12;display:none;flex-direction:column;align-items:center;justify-content:center;gap:18px;
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

export function createWorldMap(
  root: HTMLElement,
  opts: {
    world: WorldDef;
    levels: readonly MapLevel[]; // same order as world.levels
    onPlay(levelId: string): void; // only fires for unlocked levels
    onSaveReplaced(save: SaveData): void; // after a confirmed import (already written to storage)
    onExpedition?(): void; // shows the Expedition button when given
    whenUncovered?(): Promise<void>; // resolves once the loading screen is gone (the title card waits for it)
  },
): WorldMap {
  injectStyles();
  const { world, levels } = opts;

  const map = el('div', 'hm-map');
  map.setAttribute('role', 'main');
  map.setAttribute('aria-label', `${world.name} map`);

  // ----- Header -----
  const head = el('header', 'hm-head');
  const title = el('div', 'hm-title');
  const meta = el('p', 'hm-meta');
  const totalEl = el('span', 'hm-star-total');
  meta.append(`vs ${world.faction}`, totalEl);
  title.append(el('h1', 'hm-world', world.name), meta);
  const saveBtn = el('button', 'tb-btn tb-small', 'Save');
  saveBtn.type = 'button';
  head.append(title, saveBtn);

  // ----- Scrolling body: coming-soon card on top, then the path track -----
  const scroll = el('div', 'hm-scroll');
  const soon = el('div', 'hm-soon');
  soon.append(
    iconSpan('hm-lock', lockSvg(38, '#e6f6ff')),
    el('b', '', 'World 2 \u00b7 Freezer'),
    el('span', '', 'Coming soon'),
  );
  const track = el('div', 'hm-track');
  scroll.append(soon, track);

  const nudge = el('div', 'hm-nudge');
  nudge.setAttribute('role', 'status');
  map.append(head, scroll);

  // ----- Expedition footer: a big yellow sticker button over the bottom safe area -----
  let expBtn: HTMLButtonElement | null = null;
  let expSub: HTMLElement | null = null;
  let expRun: HTMLElement | null = null;
  let expDot: HTMLElement | null = null;
  const onExpedition = opts.onExpedition;
  if (onExpedition) {
    const foot = el('footer', 'hm-foot');
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
    map.append(foot);
    map.classList.add('hm-has-foot');
  }
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

  // ----- World title card: shown on the first show() only, gone on a tap or after TITLE_CARD_MS -----
  const card = el('div', 'hm-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', worldTitle(world));
  card.dataset.titleCard = world.id;
  // The title stays the first line of the card's text (the smoke test reads it); the art is ordered above it in CSS.
  const art = el('div', 'hm-card-art');
  art.setAttribute('aria-hidden', 'true');
  art.append(
    iconSpan('hm-army hm-green', soldierIcon(76, UI.cream)),
    el('span', 'hm-vs', 'VS'),
    iconSpan('hm-army hm-tan', soldierIcon(76, UI.cream)),
  );
  card.append(
    el('h1', 'hm-card-title', worldTitle(world)),
    art,
    el('p', 'hm-card-sub', `vs the ${world.faction}`),
    el('p', 'hm-card-hint', 'Tap to start'),
  );
  root.appendChild(card);
  let cardShown = false;
  let cardTimer = 0;
  let cardFadeTimer = 0;
  const dismissCard = (): void => {
    if (!card.classList.contains('hm-on') || card.classList.contains('hm-out')) return;
    clearTimeout(cardTimer);
    card.classList.add('hm-out'); // fades (opacity only); taps pass to the map at once
    cardFadeTimer = window.setTimeout(() => card.classList.remove('hm-on', 'hm-out'), 320);
  };
  card.addEventListener('click', dismissCard);

  let save: SaveData = emptySave(); // replaced by show()
  let visible = false;
  let nudgeTimer = 0;
  let laidOutWidth = -1;
  const nodes: HTMLButtonElement[] = [];

  const sheet = createSaveSheet(root, {
    getSave: () => save,
    onSaveReplaced: (next) => {
      save = next;
      render();
      opts.onSaveReplaced(next);
    },
  });
  saveBtn.addEventListener('click', () => sheet.open());

  const showNudge = (text: string): void => {
    nudge.textContent = text;
    nudge.classList.add('hm-on');
    clearTimeout(nudgeTimer);
    nudgeTimer = window.setTimeout(() => nudge.classList.remove('hm-on'), 1600);
  };

  // Build one button per level once; render() only updates classes and stars.
  levels.forEach((lv, i) => {
    const b = el('button', 'hm-node');
    b.type = 'button';
    b.dataset.level = lv.id;
    if (lv.boss) b.classList.add('hm-boss');
    b.addEventListener('click', () => {
      if (isUnlocked(save, world, lv.id)) {
        opts.onPlay(lv.id);
        return;
      }
      const prev = i > 0 ? levels[i - 1].id : '';
      showNudge(prev ? `Win ${prev} first` : 'Locked');
    });
    nodes.push(b);
    track.appendChild(b);
  });

  // Positions depend only on width, so redo them on resize but not on every show.
  function layout(): void {
    const w = track.clientWidth;
    if (w === laidOutWidth || w === 0) return;
    laidOutWidth = w;
    const pts = mapLayout(levels.length, w, { nodeSize: BOSS_SIZE, margin: 16, step: MAP_NODE_STEP });
    const topY = pts.length ? pts[pts.length - 1].y : 0;
    const h = topY + PAD_TOP + PAD_BOTTOM + BOSS_SIZE / 2;
    track.style.height = `${h}px`;
    // Convert upward y to CSS top (disc centre).
    const centres = pts.map((p) => ({ x: p.x, y: h - PAD_BOTTOM - p.y }));

    track.querySelector('svg')?.remove();
    const s = svg('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}`, 'aria-hidden': 'true' });
    const d = smoothPath(centres);
    s.append(
      // A toy race track lying on the floor: soft contact shadow, ink edge, kerb, grey road, dashed centre line.
      svg('path', {
        d,
        fill: 'none',
        stroke: 'rgba(40,18,4,.35)',
        'stroke-width': 46,
        'stroke-linecap': 'round',
        transform: 'translate(0 6)',
      }),
      svg('path', { d, fill: 'none', stroke: UI.ink, 'stroke-width': 42, 'stroke-linecap': 'round' }),
      svg('path', { d, fill: 'none', stroke: '#e03131', 'stroke-width': 36, 'stroke-linecap': 'round' }),
      svg('path', {
        d,
        fill: 'none',
        stroke: '#f1f3f5',
        'stroke-width': 36,
        'stroke-dasharray': '14 14',
        'stroke-linecap': 'butt',
      }),
      svg('path', { d, fill: 'none', stroke: '#5c636e', 'stroke-width': 28, 'stroke-linecap': 'round' }),
      svg('path', {
        d,
        fill: 'none',
        stroke: 'rgba(255,255,255,.12)',
        'stroke-width': 10,
        'stroke-linecap': 'round',
        transform: 'translate(-3 -4)',
      }),
      svg('path', {
        d,
        fill: 'none',
        stroke: '#f1f3f5',
        'stroke-width': 3,
        'stroke-dasharray': '10 12',
        'stroke-linecap': 'round',
      }),
    );
    track.prepend(s);

    centres.forEach((c, i) => {
      const disc = levels[i].boss ? BOSS_SIZE : MAP_NODE_SIZE;
      nodes[i].style.left = `${c.x}px`;
      nodes[i].style.top = `${c.y - disc / 2}px`;
    });
  }

  function render(): void {
    totalEl.innerHTML = starIcon(20);
    totalEl.append(`${starCount(save, world.levels)}/${world.levels.length * 3}`);
    totalEl.setAttribute('aria-label', `${starCount(save, world.levels)} of ${world.levels.length * 3} stars`);
    let current = -1;
    levels.forEach((lv, i) => {
      const b = nodes[i];
      const unlocked = isUnlocked(save, world, lv.id);
      const stars = save.levels[lv.id]?.stars ?? [false, false, false];
      if (unlocked) current = i;
      b.classList.toggle('hm-locked', !unlocked);
      b.replaceChildren();
      const disc = el('span', 'hm-disc');
      if (lv.boss) disc.append(el('span', 'hm-badge', 'BOSS'));
      if (unlocked) disc.append(levelNumber(lv.id));
      else disc.append(iconSpan('hm-lock', lockSvg(lv.boss ? 36 : 30, '#f1ebe0')));
      const starRow = iconSpan('hm-stars', stars.map((lit) => starIcon(18, lit ? '' : 'tb-off')).join(''));
      b.append(disc, starRow, el('span', 'hm-name', lv.name));
      const got = stars.filter(Boolean).length;
      b.setAttribute('aria-label', `${lv.id} ${lv.name}, ${unlocked ? `${got} of 3 stars` : 'locked'}`);
    });
    // The newest unlocked level gets the highlight until it is won (the boss keeps its own red look).
    nodes.forEach((b, i) => {
      const won = save.levels[levels[i].id]?.stars[0] === true;
      b.classList.toggle('hm-current', i === current && !won && !levels[i].boss);
    });
    scrollTo(current);
  }

  function scrollTo(index: number): void {
    const b = nodes[Math.max(0, index)];
    if (!b) return;
    // Centre the node in the visible area (instant: no animated motion).
    const top = b.offsetTop + track.offsetTop - scroll.clientHeight / 2 + MAP_NODE_SIZE / 2;
    scroll.scrollTop = Math.max(0, top);
  }

  const onResize = (): void => {
    if (visible) layout();
  };
  window.addEventListener('resize', onResize);

  return {
    show(next: SaveData, extra?: WorldMapExtra) {
      save = next;
      visible = true;
      renderExpedition(extra?.expedition);
      map.classList.add('hm-on');
      layout(); // needs the map displayed to measure width
      render();
      if (!cardShown) {
        cardShown = true;
        card.classList.add('hm-on');
        // Count the card's time from when it is actually on screen (boot work and the
        // loading screen can hold it back), not from when it was asked for.
        void (opts.whenUncovered?.() ?? Promise.resolve()).then(() =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              if (card.classList.contains('hm-on')) cardTimer = window.setTimeout(dismissCard, TITLE_CARD_MS);
            }),
          ),
        );
      }
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
