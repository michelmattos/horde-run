// World map screen: plain HTML/SVG over the app root, shown instead of the
// battle. Level nodes sit on a winding dirt path from the first level (bottom)
// to the boss (top); the page scrolls natively and nothing on it ever moves on
// its own except the one auto-scroll to the newest unlocked level on show().
import type { SaveData, WorldDef } from '../contracts.ts';
import { emptySave, isUnlocked, starCount } from '../core/save.ts';
import { MAP_NODE_SIZE, MAP_STEP, mapLayout } from './mapLayout.ts';
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
  font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#fff;background:#3f7d3a;
  -webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}
.hm-map.hm-on{display:flex}
.hm-head{flex:none;display:flex;align-items:center;gap:12px;background:#24502a;box-shadow:0 2px 0 #1a3b1f;
  padding:max(10px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) 10px max(16px,env(safe-area-inset-left))}
.hm-title{flex:1;min-width:0}
.hm-world{margin:0;font-size:22px;font-weight:900;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hm-meta{margin:2px 0 0;font-size:15px;font-weight:700;opacity:.9}
.hm-star-total{color:#ffd43b}
.hm-head-btn{flex:none;min-width:72px;min-height:48px;border:0;border-radius:14px;font:inherit;font-size:17px;font-weight:800;
  color:#fff;background:#3a6b40;touch-action:manipulation;cursor:pointer}
.hm-head-btn:active{filter:brightness(1.25)}
.hm-scroll{position:relative;flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;touch-action:pan-y;overscroll-behavior:contain;
  -webkit-overflow-scrolling:touch;
  background:radial-gradient(circle at 20% 30%,#4c8f45 0 18%,transparent 19%) 0 0/180px 220px,
    radial-gradient(circle at 75% 70%,#468a40 0 14%,transparent 15%) 0 0/160px 200px,#3f7d3a;
  padding:0 max(0px,env(safe-area-inset-right)) env(safe-area-inset-bottom) max(0px,env(safe-area-inset-left))}
.hm-soon{margin:16px auto 0;width:calc(100% - 32px);max-width:${TRACK_MAX_W - 32}px;box-sizing:border-box;border-radius:16px;
  padding:14px 16px;background:rgba(220,235,255,.16);border:2px dashed rgba(255,255,255,.35);text-align:center;opacity:.7}
.hm-soon b{display:block;font-size:18px}
.hm-soon span{font-size:14px}
.hm-track{position:relative;margin:0 auto;width:100%;max-width:${TRACK_MAX_W}px}
.hm-track>svg{position:absolute;left:0;top:0;pointer-events:none}
.hm-node{position:absolute;display:flex;flex-direction:column;align-items:center;gap:3px;width:120px;margin-left:-60px;
  padding:0;border:0;background:none;font:inherit;color:#fff;cursor:pointer;touch-action:manipulation}
.hm-disc{display:flex;align-items:center;justify-content:center;box-sizing:border-box;border-radius:50%;
  width:${MAP_NODE_SIZE}px;height:${MAP_NODE_SIZE}px;font-size:26px;font-weight:900;background:#2f9e44;
  border:4px solid #e9f5db;box-shadow:0 4px 0 #1b4d24;position:relative}
.hm-node:active .hm-disc{filter:brightness(1.2);box-shadow:0 2px 0 #1b4d24}
.hm-node.hm-current .hm-disc{background:#f59f00;border-color:#fff3bf;box-shadow:0 4px 0 #8a5a00,0 0 0 6px rgba(255,243,191,.35)}
.hm-node.hm-locked .hm-disc{background:#5c6b5e;border-color:#9aa59b;box-shadow:0 4px 0 #2e3830;color:#d0d6d1}
.hm-node.hm-boss .hm-disc{width:${BOSS_SIZE}px;height:${BOSS_SIZE}px;font-size:34px;background:#c92a2a;border-color:#ffc9c9;box-shadow:0 5px 0 #6b1414}
.hm-node.hm-boss.hm-locked .hm-disc{background:#7a4a4a;border-color:#b89a9a}
.hm-crown{position:absolute;top:-22px;font-size:26px;color:#ffd43b;text-shadow:0 2px 0 #7a5a00}
.hm-stars{display:flex;gap:1px;font-size:17px;line-height:1;color:rgba(0,0,0,.35);text-shadow:0 1px 0 rgba(255,255,255,.15)}
.hm-stars .hm-lit{color:#ffd43b;text-shadow:0 1px 0 #7a5a00}
.hm-name{max-width:120px;font-size:13px;font-weight:700;line-height:1.15;text-align:center;text-shadow:0 1px 2px rgba(0,0,0,.6)}
.hm-lock{width:22px;height:22px}
.hm-nudge{position:fixed;left:50%;bottom:max(24px,calc(env(safe-area-inset-bottom) + 16px));z-index:9;
  transform:translateX(-50%);padding:12px 20px;border-radius:24px;background:rgba(20,30,22,.92);font-size:17px;font-weight:800;
  pointer-events:none;opacity:0;transition:opacity .2s;white-space:nowrap}
.hm-nudge.hm-on{opacity:1}
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
  soon.append(el('b', '', 'World 2: Frozen Pass'), el('span', '', 'Coming soon'));
  const track = el('div', 'hm-track');
  scroll.append(soon, track);

  const nudge = el('div', 'hm-nudge');
  nudge.setAttribute('role', 'status');
  map.append(head, scroll, nudge);
  root.appendChild(map);

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
      svg('path', { d, fill: 'none', stroke: '#7a5530', 'stroke-width': 34, 'stroke-linecap': 'round' }),
      svg('path', { d, fill: 'none', stroke: '#c49a62', 'stroke-width': 24, 'stroke-linecap': 'round' }),
      svg('path', { d, fill: 'none', stroke: '#d9b682', 'stroke-width': 4, 'stroke-dasharray': '2 16', 'stroke-linecap': 'round' }),
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
      if (lv.boss) disc.append(el('span', 'hm-crown', '♛'));
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
    },
    hide() {
      visible = false;
      map.classList.remove('hm-on');
      nudge.classList.remove('hm-on');
      sheet.close();
    },
    get visible() {
      return visible;
    },
    dispose() {
      window.removeEventListener('resize', onResize);
      clearTimeout(nudgeTimer);
      sheet.dispose();
      map.remove();
    },
  };
}
