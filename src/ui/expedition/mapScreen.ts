// The Expedition run map: a felt play mat under a wooden header plank (HP, gold, the
// Daily date, Back and an overflow menu), a strip of owned upgrades (tap to inspect),
// and the 7-row branching map climbing from row 0 (bottom) to the Tin General (top).
// Only available nodes are tappable: a tap selects one and opens a small Go chip in
// thumb reach, Go enters it. The board scrolls natively; the only automatic motion is
// one instant scroll to the current row on show. Built once; show() refreshes it.
import type { RunNodeKind, UpgradeDef } from '../../contracts.ts';
import { tickIcon, soldierIcon } from '../icons.ts';
import { UI } from '../theme.ts';
import { button, el, goldChip, hpChip, iconSpan, ownedIcon } from './dom.ts';
import { RARITY_COLORS, backSvg, moreSvg, nodeIconSvg, upgradeIconSvg } from './icons.ts';
import { NODE_INFO, formatDailyDate, runMapLayout } from './layout.ts';
import type { MapOptions } from './types.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

// A node badge (disc + icon) of a kind, also used small in the Go chip.
function badge(kind: RunNodeKind, cls: string): HTMLSpanElement {
  const wrap = el('span', `${cls} hx-k-${kind}`);
  wrap.setAttribute('aria-hidden', 'true');
  const disc = el('span', 'hx-disc');
  disc.innerHTML = nodeIconSvg(kind, '66%');
  wrap.append(disc);
  return wrap;
}

export interface MapScreen {
  readonly root: HTMLElement;
  show(o: MapOptions): void;
  hide(): void;
}

// `done(fn)` hides every Expedition screen, then runs fn (callbacks fire at most once per show).
export function createMapScreen(parent: HTMLElement, done: (fn: () => void) => void): MapScreen {
  const map = el('div', 'hx-root hx-map');
  map.setAttribute('role', 'main');
  map.setAttribute('aria-label', 'Expedition map');

  // ----- Header plank -----
  const head = el('header', 'hx-head');
  const backBtn = button('', 'tb-wood', 'back', backSvg(30));
  backBtn.setAttribute('aria-label', 'Back');
  const title = el('div', 'hx-title');
  const sub = el('p', '');
  title.append(el('h1', '', 'Expedition'), sub);
  const moreBtn = button('', 'tb-wood', 'menu', moreSvg(30));
  moreBtn.setAttribute('aria-label', 'Run menu');
  moreBtn.setAttribute('aria-haspopup', 'true');
  const row1 = el('div', 'hx-row');
  row1.append(backBtn, title, moreBtn);
  const row2 = el('div', 'hx-row');
  const strip = el('div', 'hx-strip');
  strip.setAttribute('aria-label', 'Your upgrades');

  const tip = el('div', 'hx-tip tb-card');
  tip.setAttribute('role', 'status');
  const menu = el('div', 'hx-menu tb-card');
  const abandonBtn = button('Abandon run', 'tb-red tb-small', 'abandon');
  menu.append(abandonBtn);
  head.append(row1, row2, strip, tip, menu);

  // ----- Board -----
  const board = el('div', 'hx-board');
  const track = el('div', 'hx-track');
  board.append(track);

  // ----- Go chip -----
  const go = el('div', 'hx-go tb-card');
  const goBadgeSlot = el('span', '');
  const goText = el('div', '');
  const goName = el('b', '');
  const goHint = el('span', '');
  goText.append(goName, goHint);
  const goBtn = button('Go', 'tb-yellow', 'go');
  go.append(goBadgeSlot, goText, goBtn);

  // ----- Abandon confirm -----
  const ask = el('div', 'hx-ask tb-backdrop');
  ask.setAttribute('role', 'dialog');
  ask.setAttribute('aria-modal', 'true');
  const askCard = el('div', 'hx-card tb-card');
  const keepBtn = button('Keep going', 'tb-green', 'keep');
  const confirmBtn = button('Abandon', 'tb-red', 'abandon-confirm');
  const askPair = el('div', 'hx-pair');
  askPair.append(keepBtn, confirmBtn);
  askCard.append(
    el('p', 'hx-lead', 'Abandon this run?'),
    el('p', 'hx-sub', 'The run ends here and counts as a defeat.'),
    askPair,
  );
  ask.append(askCard);

  map.append(head, board, go, ask);
  parent.appendChild(map);

  let opts: MapOptions | null = null;
  let selected = '';
  let tipFor = '';
  let laidOutWidth = -1;
  const nodeBtns = new Map<string, HTMLButtonElement>();

  const closeTip = (): void => {
    tipFor = '';
    tip.classList.remove('hx-on');
    for (const b of strip.querySelectorAll<HTMLElement>('.hx-own')) b.setAttribute('aria-pressed', 'false');
  };
  const closeMenu = (): void => menu.classList.remove('hx-on');
  const select = (id: string): void => {
    selected = id;
    for (const [nid, b] of nodeBtns) b.classList.toggle('hx-sel', nid === id);
    const node = opts?.run.map.nodes.find((n) => n.id === id);
    if (!node) {
      go.classList.remove('hx-on');
      return;
    }
    goBadgeSlot.replaceChildren(badge(node.kind, 'hx-mini'));
    goName.textContent = NODE_INFO[node.kind].label;
    goHint.textContent = NODE_INFO[node.kind].hint;
    go.classList.add('hx-on');
  };

  const showTip = (def: UpgradeDef, stacks: number, btn: HTMLElement): void => {
    if (tipFor === def.id) {
      closeTip();
      return;
    }
    closeTip();
    closeMenu();
    tipFor = def.id;
    btn.setAttribute('aria-pressed', 'true');
    const text = el('div', '');
    const name = el('b', '', stacks > 1 ? `${def.name} x${stacks}` : def.name);
    const rarity = el('span', 'hx-pill');
    rarity.textContent = RARITY_COLORS[def.rarity].label;
    rarity.style.cssText = `background:${RARITY_COLORS[def.rarity].edge};color:#fff;margin-left:6px;vertical-align:2px`;
    name.append(rarity);
    text.append(name, el('p', '', def.text));
    if (def.drawback) text.append(el('span', 'hx-up-bad', def.drawback));
    tip.replaceChildren(iconSpan('', upgradeIconSvg(def.icon, 48)), text);
    tip.classList.add('hx-on');
  };

  // ----- Events -----
  backBtn.addEventListener('click', () => {
    const o = opts;
    if (o) done(() => o.onBack());
  });
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeTip();
    menu.classList.toggle('hx-on');
  });
  abandonBtn.addEventListener('click', () => {
    closeMenu();
    ask.classList.add('hx-on');
  });
  keepBtn.addEventListener('click', () => ask.classList.remove('hx-on'));
  confirmBtn.addEventListener('click', () => {
    const o = opts;
    if (o) done(() => o.onAbandon());
  });
  // Go enters the selected node; with nothing selected (automation only: the chip is
  // hidden) it takes the first available node, so a script can choose in one tap.
  goBtn.addEventListener('click', () => {
    const o = opts;
    const id = selected || o?.available[0];
    if (o && id && o.available.includes(id)) done(() => o.onChoose(id));
  });
  // Taps on empty board or header space close the chip, tip and menu.
  board.addEventListener('click', (e) => {
    if (!(e.target instanceof Element) || !e.target.closest('.hx-node')) select('');
    closeTip();
    closeMenu();
  });
  head.addEventListener('click', (e) => {
    if (!(e.target instanceof Element)) return;
    if (!e.target.closest('.hx-own')) closeTip(); // includes a tap on the tip itself
    if (!e.target.closest('.hx-menu, [data-action=menu]')) closeMenu();
  });

  // ----- Rendering -----
  function renderHeader(o: MapOptions): void {
    const { run } = o;
    sub.replaceChildren();
    const won = run.stats.battlesWon;
    sub.append(run.at === undefined ? 'Pick your first battle' : `Battles won: ${won}`);
    if (run.daily) {
      const d = el('span', 'hx-tag hx-tag-yellow', `Daily ${formatDailyDate(run.daily)}`);
      d.style.cssText =
        'margin-left:8px;padding:1px 8px 2px;font-size:13px;border-width:2px;box-shadow:0 2px 0 ' + UI.ink;
      sub.append(d);
    }
    row2.replaceChildren(hpChip(run.hp, run.maxHp), goldChip(run.gold));
    strip.replaceChildren();
    if (o.upgrades.length === 0) strip.append(el('span', 'hx-empty', 'No upgrades yet. Win a battle to pick one.'));
    for (const u of o.upgrades) {
      const b = ownedIcon(u.def, u.stacks);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        showTip(u.def, u.stacks, b);
      });
      strip.append(b);
    }
  }

  function renderBoard(o: MapOptions): void {
    const w = track.clientWidth;
    if (w === 0) return;
    laidOutWidth = w;
    const { run } = o;
    const lay = runMapLayout(run.map, w);
    track.style.height = `${lay.height}px`;
    const byId = new Map(run.map.nodes.map((n) => [n.id, n]));
    const visited = new Set(run.visited);
    const avail = new Set(o.available);
    const at = run.at;
    const atRow = at ? (byId.get(at)?.row ?? -1) : -1;
    const isGone = (id: string): boolean => {
      const n = byId.get(id);
      return !!n && !visited.has(id) && !avail.has(id) && n.row <= atRow;
    };

    // Edges: the path taken (solid yellow), the way on (bright), the rest (faint).
    const s = svgEl('svg', { width: w, height: lay.height, viewBox: `0 0 ${w} ${lay.height}`, 'aria-hidden': 'true' });
    const order = new Map(run.visited.map((id, i) => [id, i]));
    for (const e of lay.edges) {
      const taken = order.has(e.from) && order.get(e.to) === (order.get(e.from) ?? -9) + 1;
      const next = e.from === at && avail.has(e.to);
      const faint = isGone(e.from) || isGone(e.to);
      const color = taken ? UI.yellow : next ? UI.cream : '#d9caa6';
      const op = taken || next ? 1 : faint ? 0.22 : 0.55;
      s.append(
        svgEl('path', {
          d: e.d,
          fill: 'none',
          stroke: 'rgba(5,15,8,.35)',
          'stroke-width': 11,
          transform: 'translate(0 4)',
          opacity: op,
        }),
        svgEl('path', {
          d: e.d,
          fill: 'none',
          stroke: UI.ink,
          'stroke-width': 9,
          'stroke-linecap': 'round',
          opacity: op,
        }),
        svgEl('path', {
          d: e.d,
          fill: 'none',
          stroke: color,
          'stroke-width': 5,
          'stroke-linecap': 'round',
          'stroke-dasharray': taken ? 'none' : '1 11',
          opacity: op,
        }),
      );
    }

    nodeBtns.clear();
    const kids: HTMLElement[] = [];
    for (const p of lay.nodes) {
      const n = byId.get(p.id);
      if (!n) continue;
      const b = el('button', `hx-node hx-k-${n.kind}`);
      b.type = 'button';
      b.dataset.nodeId = n.id;
      const isAvail = avail.has(n.id);
      b.dataset.available = String(isAvail);
      b.style.cssText = `left:${p.x - p.size / 2}px;top:${p.y - p.size / 2}px;width:${p.size}px;height:${p.size}px`;
      const disc = el('span', 'hx-disc');
      disc.innerHTML = nodeIconSvg(n.kind, '66%');
      const here = n.id === at;
      const label = el('span', 'hx-label', n.kind === 'boss' ? 'BOSS' : NODE_INFO[n.kind].label);
      if (here) {
        // The current node: a yellow ring and a 'You' tag with a little soldier.
        label.className = 'hx-label hx-you';
        label.replaceChildren(iconSpan('', soldierIcon(18, UI.cream)), 'You');
        b.classList.add('hx-here');
      } else if (visited.has(n.id)) b.classList.add('hx-visited');
      else if (isGone(n.id)) b.classList.add('hx-gone');
      if (isAvail) b.classList.add('hx-avail');
      b.append(disc, label);
      if (!here && visited.has(n.id)) b.append(iconSpan('hx-tick', tickIcon(28)));
      const state = here ? 'you are here' : isAvail ? 'available' : visited.has(n.id) ? 'visited' : 'not reachable now';
      b.setAttribute('aria-label', `${NODE_INFO[n.kind].label}, row ${n.row + 1}, ${state}`);
      if (!isAvail) b.setAttribute('aria-disabled', 'true');
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        closeTip();
        closeMenu();
        // A second tap on the selected node enters it, like Go.
        if (isAvail && selected === n.id) done(() => o.onChoose(n.id));
        else if (isAvail) select(n.id);
      });
      nodeBtns.set(n.id, b);
      kids.push(b);
    }
    track.replaceChildren(s, ...kids);
    if (selected && !avail.has(selected)) selected = '';
    select(selected);
  }

  // One instant scroll so the current row (or row 0) sits low on screen with the way on above it.
  function scrollToCurrent(o: MapOptions): void {
    const focus = o.run.at ?? o.available[0];
    const b = focus ? nodeBtns.get(focus) : undefined;
    if (!b) return;
    const y = track.offsetTop + b.offsetTop + b.offsetHeight / 2;
    board.scrollTop = Math.max(0, y - board.clientHeight * 0.68);
  }

  const onResize = (): void => {
    if (opts && map.classList.contains('hx-on') && track.clientWidth !== laidOutWidth) renderBoard(opts);
  };
  window.addEventListener('resize', onResize);

  return {
    root: map,
    show(o) {
      opts = o;
      selected = '';
      closeTip();
      closeMenu();
      ask.classList.remove('hx-on');
      map.classList.add('hx-on');
      renderHeader(o);
      renderBoard(o); // needs the map displayed to measure the board width
      scrollToCurrent(o);
    },
    hide() {
      map.classList.remove('hx-on');
      ask.classList.remove('hx-on');
      go.classList.remove('hx-on');
      closeTip();
      closeMenu();
    },
  };
}
