// Small DOM builders shared by the Expedition screens: elements, sticker buttons,
// HP and gold chips, and the upgrade card used by the pick and shop screens.
import type { UpgradeDef } from '../../contracts.ts';
import { coinIcon, tickIcon } from '../icons.ts';
import { CATEGORY_COLORS, RARITY_COLORS, coinSvg, heartSvg, upgradeIconOf, upgradeIconSvg } from './icons.ts';
import { formatGold, formatHp, hpPercent, hpTone } from './layout.ts';

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Decorative icon markup in a span.
export function iconSpan(cls: string, html: string): HTMLSpanElement {
  const e = el('span', cls);
  e.setAttribute('aria-hidden', 'true');
  e.innerHTML = html;
  return e;
}

// Sticker button (theme .tb-btn) with an optional decorative icon and a data-action hook.
export function button(text: string, variant: string, action?: string, icon = ''): HTMLButtonElement {
  const b = el('button', `tb-btn ${variant}`.trim());
  b.type = 'button';
  if (action) b.dataset.action = action;
  b.innerHTML = icon;
  b.append(el('span', '', text));
  return b;
}

// Two-line sticker button: a big label and a small detail line under it.
export function button2(
  variant: string,
  action: string,
): { btn: HTMLButtonElement; set(main: string, small: string): void } {
  const btn = el('button', `tb-btn hx-btn2 ${variant}`.trim());
  btn.type = 'button';
  btn.dataset.action = action;
  const main = el('span', '');
  const small = el('small', '');
  btn.append(main, small);
  return {
    btn,
    set(m, s) {
      main.textContent = m;
      small.textContent = s;
      small.hidden = !s;
    },
  };
}

// HP bar: current fill, plus an optional striped ghost segment from `ghostFrom` to
// `ghostTo` HP ('heal' previews a heal, 'loss' shows what was just lost).
export function hpBar(
  hp: number,
  maxHp: number,
  ghost?: { from: number; to: number; kind: 'heal' | 'loss' },
  big = false,
): HTMLSpanElement {
  const bar = el('span', `hx-bar hx-${hpTone(hp, maxHp)}${big ? ' hx-big' : ''}`);
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label', `Run HP ${formatHp(hp, maxHp)}`);
  if (ghost) {
    const g = el('i', `hx-${ghost.kind}`);
    const a = hpPercent(Math.min(ghost.from, ghost.to), maxHp);
    const b = hpPercent(Math.max(ghost.from, ghost.to), maxHp);
    g.style.left = `${a}%`;
    g.style.width = `${Math.max(0, b - a)}%`;
    bar.append(g);
  }
  const fill = el('i', 'hx-fill');
  fill.style.width = `${hpPercent(hp, maxHp)}%`;
  bar.append(fill);
  return bar;
}

// Heart chip: heart icon, bar and 'hp/max' text.
export function hpChip(hp: number, maxHp: number, ghost?: Parameters<typeof hpBar>[2]): HTMLSpanElement {
  const c = el('span', 'hx-chip hx-hp');
  c.append(iconSpan('', heartSvg(30)), hpBar(hp, maxHp, ghost), el('span', '', formatHp(hp, maxHp)));
  return c;
}

export function goldChip(gold: number, extra?: HTMLElement): HTMLSpanElement {
  const c = el('span', 'hx-chip hx-gold');
  c.setAttribute('aria-label', `${gold} gold`);
  const v = el('span', 'hx-gold-v', formatGold(gold));
  c.append(iconSpan('', coinSvg(28)), v);
  if (extra) c.append(extra);
  return c;
}

// Campaign coins paid out by a run or battle: '+N coins' and the wallet total.
export function coinsRow(earned: number, total: number): HTMLDivElement {
  const row = el('div', 'hx-coins');
  row.setAttribute('role', 'img');
  row.setAttribute('aria-label', `${formatGold(earned)} coins earned, ${formatGold(total)} coins in total`);
  row.append(
    iconSpan('', coinIcon(34)),
    el('b', '', `+${formatGold(earned)}`),
    el('span', '', 'coins'),
    el('span', 'hx-chip hx-coins-total', `Total ${formatGold(total)}`),
  );
  return row;
}

// The upgrade card: big icon, name, rule text, red drawback, rarity ribbon, category
// tag and an 'Owned xN' badge. A button when it is selectable (pick), a div otherwise.
export function upgradeCard(def: UpgradeDef, owned: number, selectable: boolean): HTMLElement {
  const card = selectable ? el('button', 'hx-up') : el('div', 'hx-up');
  if (card instanceof HTMLButtonElement) {
    card.type = 'button';
    card.setAttribute('aria-pressed', 'false');
  }
  card.dataset.upgradeId = def.id;
  const r = RARITY_COLORS[def.rarity];
  card.style.setProperty('--face', r.face);
  card.style.setProperty('--edge', r.edge);
  const body = el('span', 'hx-up-body');
  body.append(el('span', 'hx-up-name', def.name), el('span', 'hx-up-text', def.text));
  if (def.drawback) body.append(el('span', 'hx-up-bad', def.drawback));
  const tags = el('span', 'hx-up-tags');
  tags.append(el('span', 'hx-pill', CATEGORY_COLORS[def.category].label));
  if (owned > 0) tags.append(el('span', 'hx-pill hx-owned', `Owned x${owned}`));
  body.append(tags);
  card.append(
    iconSpan('hx-up-ico', upgradeIconSvg(upgradeIconOf(def), 64)),
    body,
    el('span', 'hx-ribbon', r.label),
    iconSpan('hx-check', tickIcon(30)),
  );
  return card;
}

// One owned upgrade as a small icon button with its stack count.
export function ownedIcon(def: UpgradeDef, stacks: number, tag: 'button' | 'span' = 'button'): HTMLElement {
  const b = tag === 'button' ? el('button', 'hx-own') : el('span', 'hx-own');
  if (b instanceof HTMLButtonElement) {
    b.type = 'button';
    b.setAttribute('aria-pressed', 'false');
  }
  b.dataset.upgradeId = def.id;
  b.setAttribute('aria-label', stacks > 1 ? `${def.name} x${stacks}` : def.name);
  b.innerHTML = upgradeIconSvg(upgradeIconOf(def), 48);
  if (stacks > 1) b.append(el('i', '', `x${stacks}`));
  return b;
}
