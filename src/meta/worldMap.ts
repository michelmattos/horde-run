// World map screen: plain HTML/SVG over the app root, shown instead of the
// battle. World 1 is the bedroom floor: wooden floorboards with a toy race track
// winding from the first level (bottom) to the boss (top). The page scrolls
// natively and nothing on it ever moves on its own except the one auto-scroll to
// the newest unlocked level on show(). The first show() opens with a brief world
// title card (no story): a tap or a short timeout dismisses it.
import type { SaveData, WorldDef } from '../contracts.ts';
import { emptySave, isUnlocked, starCount } from '../core/save.ts';
import { MAP_NODE_SIZE, MAP_STEP, TITLE_CARD_MS, mapLayout, worldTitle } from './mapLayout.ts';
import { createSaveSheet } from './saveSheet.ts';

export { mapLayout } from './mapLayout.ts';
export type { MapLayoutOptions } from './mapLayout.ts';

export interface MapLevel {
  id: string;
  name: string;
  boss: boolean;
}

export interface WorldMap {
  show(save: SaveData): void;
  hide(): void;
  readonly visible: boolean;
  dispose(): void;
}

const BOSS_SIZE = 88;
const TRACK_MAX_W = 480;
const PAD_BOTTOM = 72; // space below the first node (name label + breathing room)
const PAD_TOP = 84; // space above the boss node
const SVG_NS = 'http://www.w3.org/2000/svg';

const CSS = `
.hm-map{position:fixed;inset:0;height:100dvh;z-index:8;display:none;flex-direction:column;
  font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#fff;background:#a8733f;
  -webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}
.hm-map.hm-on{display:flex}
.hm-head{flex:none;display:flex;align-items:center;gap:12px;background:#4a2f1b;box-shadow:0 2px 0 #2e1c10;
  padding:max(10px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) 10px max(16px,env(safe-area-inset-left))}
.hm-title{flex:1;min-width:0}
.hm-world{margin:0;font-size:22px;font-weight:900;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hm-meta{margin:2px 0 0;font-size:15px;font-weight:700;opacity:.9}
.hm-star-total{color:#ffd43b}
.hm-head-btn{flex:none;min-width:72px;min-height:48px;border:0;border-radius:14px;font:inherit;font-size:17px;font-weight:800;
  color:#fff;background:#7a5232;touch-action:manipulation;cursor:pointer}
.hm-head-btn:active{filter:brightness(1.25)}
.hm-scroll{position:relative;flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;touch-action:pan-y;overscroll-behavior:contain;
  -webkit-overflow-scrolling:touch;
  background:repeating-linear-gradient(90deg,rgba(60,30,10,.45) 0 2px,transparent 2px 72px),
    repeating-linear-gradient(0deg,transparent 0 238px,rgba(60,30,10,.35) 238px 240px) 36px 0/72px 480px,
    repeating-linear-gradient(90deg,#b37c47 0 72px,#a66f3b 72px 144px,#bb8550 144px 216px);
  padding:0 max(0px,env(safe-area-inset-right)) env(safe-area-inset-bottom) max(0px,env(safe-area-inset-left))}
.hm-soon{margin:16px auto 0;width:calc(100% - 32px);max-width:${TRACK_MAX_W - 32}px;box-sizing:border-box;border-radius:16px;
  padding:14px 16px;background:rgba(220,235,255,.18);border:2px dashed rgba(255,255,255,.45);text-align:center;opacity:.8}
.hm-soon b{display:block;font-size:18px}
.hm-soon span{font-size:14px}
.hm-track{position:relative;margin:0 auto;width:100%;max-width:${TRACK_MAX_W}px}
.hm-track>svg{position:absolute;left:0;top:0;pointer-events:none}
.hm-node{position:absolute;display:flex;flex-direction:column;align-items:center;gap:3px;width:120px;margin-left:-60px;
  padding:0;border:0;background:none;font:inherit;color:#fff;cursor:pointer;touch-action:manipulation}
.hm-disc{display:flex;align-items:center;justify-content:center;box-sizing:border-box;border-radius:50%;
  width:${MAP_NODE_SIZE}px;height:${MAP_NODE_SIZE}px;font-size:26px;font-weight:900;background:#3f9d47;
  border:4px solid #e9f5db;box-shadow:0 4px 0 #1f5a27;position:relative}
.hm-node:active .hm-disc{filter:brightness(1.2);box-shadow:0 2px 0 #1f5a27}
.hm-node.hm-current .hm-disc{background:#f59f00;border-color:#fff3bf;box-shadow:0 4px 0 #8a5a00,0 0 0 6px rgba(255,243,191,.35)}
.hm-node.hm-locked .hm-disc{background:#6f6a62;border-color:#aaa49a;box-shadow:0 4px 0 #3a362f;color:#ddd8d0}
.hm-node.hm-boss .hm-disc{width:${BOSS_SIZE}px;height:${BOSS_SIZE}px;font-size:34px;background:#8d99a6;border-color:#eef2f5;box-shadow:0 5px 0 #4a525c}
.hm-node.hm-boss.hm-locked .hm-disc{background:#6c727a;border-color:#a9aeb4}
.hm-badge{position:absolute;top:-14px;padding:2px 8px;border-radius:999px;background:#c92a2a;border:2px solid #ffe3e3;
  font-size:12px;font-weight:900;letter-spacing:.08em;line-height:1.2}
.hm-stars{display:flex;gap:1px;font-size:17px;line-height:1;color:rgba(0,0,0,.35);text-shadow:0 1px 0 rgba(255,255,255,.15)}
.hm-stars .hm-lit{color:#ffd43b;text-shadow:0 1px 0 #7a5a00}
.hm-name{max-width:120px;font-size:13px;font-weight:700;line-height:1.15;text-align:center;text-shadow:0 1px 2px rgba(0,0,0,.7)}
.hm-lock{width:22px;height:22px}
.hm-nudge{position:fixed;left:50%;bottom:max(24px,calc(env(safe-area-inset-bottom) + 16px));z-index:9;
  transform:translateX(-50%);padding:12px 20px;border-radius:24px;background:rgba(40,24,12,.92);font-size:17px;font-weight:800;
  pointer-events:none;opacity:0;transition:opacity .2s;white-space:nowrap}
.hm-nudge.hm-on{opacity:1}
.hm-card{position:fixed;inset:0;z-index:12;display:none;flex-direction:column;align-items:center;justify-content:center;gap:10px;
  padding:max(16px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));
  box-sizing:border-box;background:rgba(36,20,8,.86);text-align:center;cursor:pointer;touch-action:manipulation;
  font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#fff;-webkit-user-select:none;user-select:none;
  opacity:1;transition:opacity .3s}
.hm-card.hm-on{display:flex}
.hm-card.hm-out{opacity:0;pointer-events:none}
.hm-card-title{margin:0;font-size:34px;font-weight:900;line-height:1.15;letter-spacing:.01em}
.hm-card-sub{margin:0;font-size:17px;font-weight:700;color:#d9c3a5}
.hm-card-hint{margin:18px 0 0;font-size:14px;font-weight:600;opacity:.6}
@media (prefers-reduced-motion: reduce){.hm-card{transition:none}}
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

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

function lockIcon(): SVGSVGElement {
  const s = svg('svg', { viewBox: '0 0 24 24', class: 'hm-lock', 'aria-hidden': 'true' });
  s.append(
    svg('path', { d: 'M7 11V8a5 5 0 0 1 10 0v3', fill: 'none', stroke: 'currentColor', 'stroke-width': 3 }),
    svg('rect', { x: 4, y: 11, width: 16, height: 11, rx: 2, fill: 'currentColor' }),
  );
  return s;
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
  meta.append(`${world.faction} · `, totalEl);
  title.append(el('h1', 'hm-world', world.name), meta);
  const saveBtn = el('button', 'hm-head-btn', 'Save');
  saveBtn.type = 'button';
  head.append(title, saveBtn);

  // ----- Scrolling body: coming-soon card on top, then the path track -----
  const scroll = el('div', 'hm-scroll');
  const soon = el('div', 'hm-soon');
  soon.append(el('b', '', 'World 2 \u00b7 Freezer'), el('span', '', 'Coming soon'));
  const track = el('div', 'hm-track');
  scroll.append(soon, track);

  const nudge = el('div', 'hm-nudge');
  nudge.setAttribute('role', 'status');
  map.append(head, scroll, nudge);
  root.appendChild(map);

  // ----- World title card: shown on the first show() only, gone on a tap or after TITLE_CARD_MS -----
  const card = el('div', 'hm-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', worldTitle(world));
  card.dataset.titleCard = world.id;
  card.append(el('h1', 'hm-card-title', worldTitle(world)), el('p', 'hm-card-sub', `vs the ${world.faction}`), el('p', 'hm-card-hint', 'Tap to start'));
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
    const pts = mapLayout(levels.length, w, { nodeSize: BOSS_SIZE, margin: 16, step: MAP_STEP });
    const topY = pts.length ? pts[pts.length - 1].y : 0;
    const h = topY + PAD_TOP + PAD_BOTTOM + BOSS_SIZE / 2;
    track.style.height = `${h}px`;
    // Convert upward y to CSS top (disc centre).
    const centres = pts.map((p) => ({ x: p.x, y: h - PAD_BOTTOM - p.y }));

    track.querySelector('svg')?.remove();
    const s = svg('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}`, 'aria-hidden': 'true' });
    const d = smoothPath(centres);
    s.append(
      // A toy race track: kerb, grey road, dashed white centre line.
      svg('path', { d, fill: 'none', stroke: '#e03131', 'stroke-width': 36, 'stroke-linecap': 'round' }),
      svg('path', { d, fill: 'none', stroke: '#f1f3f5', 'stroke-width': 36, 'stroke-dasharray': '14 14', 'stroke-linecap': 'butt' }),
      svg('path', { d, fill: 'none', stroke: '#5c636e', 'stroke-width': 28, 'stroke-linecap': 'round' }),
      svg('path', { d, fill: 'none', stroke: '#f1f3f5', 'stroke-width': 3, 'stroke-dasharray': '10 12', 'stroke-linecap': 'round' }),
    );
    track.prepend(s);

    centres.forEach((c, i) => {
      const disc = levels[i].boss ? BOSS_SIZE : MAP_NODE_SIZE;
      nodes[i].style.left = `${c.x}px`;
      nodes[i].style.top = `${c.y - disc / 2}px`;
    });
  }

  function render(): void {
    totalEl.textContent = `${starCount(save, world.levels)}/${world.levels.length * 3} ★`;
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
      else disc.append(lockIcon());
      const starRow = el('span', 'hm-stars');
      for (const lit of stars) starRow.append(el('span', lit ? 'hm-lit' : '', '★'));
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
    show(next: SaveData) {
      save = next;
      visible = true;
      map.classList.add('hm-on');
      layout(); // needs the map displayed to measure width
      render();
      if (!cardShown) {
        cardShown = true;
        card.classList.add('hm-on');
        cardTimer = window.setTimeout(dismissCard, TITLE_CARD_MS);
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
