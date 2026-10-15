// Collection screen: every cannon, mob, champion and ultimate, one tab per slot. An
// unlocked item shows its tier pips, stats (now -> next tier) and an Upgrade price button
// (disabled when unaffordable, a 'Max' stamp when fully upgraded); a locked one shows a
// padlock and exactly how to unlock it, or a Buy button for coin-unlock items. A tap on an
// action pops the card (CSS only); integration then calls show() with fresh data, which
// re-renders in place, keeps the tab and the scroll position, and pops the card again
// once the purchase has landed.
//
//   const screen = createCollectionScreen(root, { onUpgrade(id) {...}, onBuy(id) {...}, onBack() {...} });
//   screen.show(view);  // CollectionView from integration; call again after each purchase
import { UI, outlineShadow } from '../ui/theme.ts';
import { lockIcon } from '../ui/icons.ts';
import { itemIcon } from './itemIcons.ts';
import { ITEM_SLOTS, SLOT_TITLE, collectionAction, collectionSections, tierLabel } from './metaLogic.ts';
import {
  backIcon,
  coinChip,
  el,
  iconButton,
  iconSpan,
  injectMetaStyles,
  pips,
  popEffect,
  priceButton,
} from './metaUi.ts';
import type { CollectionItem, CollectionView, ItemSlot } from './types.ts';

export interface CollectionScreen {
  show(v: CollectionView): void;
  hide(): void;
  readonly visible: boolean;
  dispose(): void;
}

export interface CollectionOptions {
  onUpgrade(id: string): void;
  onBuy(id: string): void;
  onBack(): void;
}

const CSS = `
.hr-tabs{position:relative;z-index:2;flex:none;display:grid;grid-template-columns:repeat(4,1fr);gap:6px;
  padding:10px max(10px,env(safe-area-inset-right)) 12px max(10px,env(safe-area-inset-left));background:rgba(43,29,18,.45);
  border-bottom:3px solid rgba(20,10,2,.5)}
.hr-tab{position:relative;box-sizing:border-box;min-height:50px;margin:0 0 4px;padding:4px 2px;border:3px solid ${UI.ink};border-radius:14px;
  background:linear-gradient(180deg,#f3e5c6,#dcc7a0);color:${UI.ink};font-size:15px;font-weight:700;line-height:1.05;cursor:pointer;
  box-shadow:0 4px 0 ${UI.ink};transition:transform 90ms cubic-bezier(.3,1.6,.6,1);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px}
.hr-tab small{font-size:12px;font-weight:700;color:#6b5440}
.hr-tab:active{transform:translateY(3px);box-shadow:0 1px 0 ${UI.ink}}
.hr-tab[aria-selected=true]{background:linear-gradient(180deg,#ffd862,${UI.yellow})}
.hr-tab:focus-visible{outline:3px solid ${UI.yellow};outline-offset:3px}
.hr-tab .hr-dot{position:absolute;top:-7px;right:-5px;min-width:20px;box-sizing:border-box;padding:1px 5px;border-radius:999px;border:2.5px solid ${UI.ink};
  background:${UI.red};color:#fff;font-size:11px;line-height:1.2;text-shadow:${outlineShadow(1)}}
.hr-cl-list{display:flex;flex-direction:column;gap:20px;padding-top:6px}
.hr-it{position:relative;box-sizing:border-box;display:grid;grid-template-columns:76px 1fr;gap:10px 12px;padding:14px 14px 14px 12px;
  border:3.5px solid ${UI.ink};border-radius:20px;color:${UI.ink};text-align:left;
  background:radial-gradient(120% 70% at 50% 0%,rgba(255,255,255,.8),transparent 60%),linear-gradient(180deg,#fffdf6,#f6ead0);
  box-shadow:inset 0 -3px 0 rgba(0,0,0,.06),0 6px 0 -0.5px #cdb48a,0 6px 0 3px ${UI.ink},0 12px 14px rgba(20,10,2,.28)}
.hr-it.hr-locked{background:linear-gradient(180deg,#efe7d8,#ddd0b8)}
.hr-it .hr-ico{position:relative;width:76px;height:76px}
.hr-it .hr-ico svg{width:76px;height:76px;display:block}
.hr-it.hr-locked .hr-ico svg{filter:grayscale(.85) brightness(.85);opacity:.75}
.hr-it .hr-padlock{position:absolute;left:50%;top:50%;width:40px;height:40px;margin:-20px 0 0 -20px}
.hr-it .hr-padlock svg{width:40px;height:40px;filter:none;opacity:1}
.hr-it-head{display:flex;flex-direction:column;gap:4px;min-width:0}
.hr-it-name{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:21px;font-weight:700;line-height:1.1}
.hr-it-tier{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;color:#6b5440;letter-spacing:.03em}
.hr-it-text{grid-column:1/-1;margin:0;font-size:15px;font-weight:600;line-height:1.3;color:#3d2c1d}
.hr-stats{grid-column:1/-1;list-style:none;margin:0;padding:6px 10px;border-radius:12px;background:rgba(214,186,138,.25);display:flex;flex-direction:column;gap:2px}
.hr-stats li{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:28px;font-size:15px;font-weight:600}
.hr-stats li b{font-weight:700;white-space:nowrap}
.hr-stats li b i{font-style:normal;color:#2c8a3a}
.hr-it-foot{grid-column:1/-1;display:flex;align-items:center;justify-content:flex-end;gap:10px;flex-wrap:wrap}
.hr-it-foot .hr-hint{flex:1 1 180px}
.hr-stamp{padding:4px 12px;border:3.5px solid #2c8a3a;border-radius:10px;color:#2c8a3a;font-size:18px;font-weight:700;letter-spacing:.12em;
  transform:rotate(-6deg);background:rgba(255,246,227,.7)}
.hr-cl-empty{font-size:16px;font-weight:600;color:${UI.cream};text-shadow:${outlineShadow(1.4)};text-align:center}
`;

function itemCard(item: CollectionItem, onUpgrade: (id: string) => void, onBuy: (id: string) => void): HTMLElement {
  const card = el('article', `hr-it${item.locked ? ' hr-locked' : ''}`);
  card.dataset.item = item.id;
  const ico = iconSpan('hr-ico', itemIcon(item.id, 76));
  if (item.locked) ico.append(iconSpan('hr-padlock', lockIcon(40, '#f1ebe0')));
  const head = el('div', 'hr-it-head');
  const name = el('div', 'hr-it-name', item.name);
  if (item.isNew && !item.locked) name.append(el('span', 'hr-new', 'NEW'));
  head.append(name);
  if (!item.locked) {
    const tier = el('div', 'hr-it-tier');
    tier.append(pips(item.tier, item.maxTier), el('span', '', tierLabel(item.tier, item.maxTier)));
    head.append(tier);
  }
  card.append(ico, head, el('p', 'hr-it-text', item.text));

  if (!item.locked && item.stats.length > 0) {
    const ul = el('ul', 'hr-stats');
    for (const s of item.stats) {
      const li = el('li', '');
      const v = el('b', '', s.value);
      if (s.next !== undefined && s.next !== s.value) v.append(' → ', el('i', '', s.next));
      li.append(el('span', '', s.label), v);
      ul.append(li);
    }
    card.append(ul);
  }

  const foot = el('div', 'hr-it-foot');
  const act = collectionAction(item);
  if (act.kind === 'locked' || act.kind === 'buy') {
    const hint = el('div', 'hr-hint');
    hint.append(iconSpan('hr-lock', lockIcon(22, '#f1ebe0')), el('span', '', item.hint || 'Locked'));
    foot.append(hint);
  }
  if (act.kind === 'upgrade' || act.kind === 'buy') {
    const b = priceButton(act.cost, act.kind === 'upgrade' ? 'Upgrade' : 'Buy', act.kind === 'buy' ? 'hr-green' : '');
    b.dataset.action = act.kind;
    b.disabled = !act.enabled;
    b.setAttribute(
      'aria-label',
      `${act.kind === 'upgrade' ? 'Upgrade' : 'Buy'} ${item.name} for ${act.cost} coins${act.enabled ? '' : ', not enough coins'}`,
    );
    b.addEventListener('click', () => {
      if (b.disabled) return;
      popEffect(card);
      if (act.kind === 'upgrade') onUpgrade(item.id);
      else onBuy(item.id);
    });
    foot.append(b);
  } else if (act.kind === 'max') {
    foot.append(el('span', 'hr-stamp', 'MAX'));
  }
  if (foot.childElementCount > 0) card.append(foot);
  return card;
}

// Compact fingerprint of what a card shows, to spot the card a purchase changed.
function cardKey(i: CollectionItem): string {
  return `${i.locked ? 1 : 0}:${i.tier}`;
}

export function createCollectionScreen(root: HTMLElement, opts: CollectionOptions): CollectionScreen {
  injectMetaStyles(CSS, 'collection');

  const screen = el('div', 'hr-screen hr-root');
  screen.dataset.screen = 'collection';
  screen.setAttribute('role', 'main');
  screen.setAttribute('aria-label', 'Collection');

  const head = el('header', 'hr-head');
  const back = iconButton('tb-wood', 'Back', backIcon(30), 'back');
  back.addEventListener('click', () => opts.onBack());
  const title = el('div', 'hr-title');
  const sub = el('p', '');
  title.append(el('h1', '', 'Collection'), sub);
  const coins = coinChip();
  head.append(back, title, coins.el);

  const tabs = el('div', 'hr-tabs');
  tabs.setAttribute('role', 'tablist');
  const tabBtns = new Map<ItemSlot, { b: HTMLButtonElement; count: HTMLElement; dot: HTMLElement }>();
  for (const slot of ITEM_SLOTS) {
    const b = el('button', 'hr-tab');
    b.type = 'button';
    b.dataset.tab = slot;
    b.setAttribute('role', 'tab');
    const count = el('small', '');
    const dot = el('span', 'hr-dot');
    dot.hidden = true;
    b.append(el('span', '', SLOT_TITLE[slot]), count, dot);
    b.addEventListener('click', () => selectTab(slot));
    tabBtns.set(slot, { b, count, dot });
    tabs.append(b);
  }

  const body = el('div', 'hr-body');
  const inner = el('div', 'hr-inner');
  const list = el('div', 'hr-cl-list');
  list.setAttribute('role', 'tabpanel');
  inner.append(list);
  body.append(inner);
  screen.append(head, tabs, body);
  root.appendChild(screen);

  let view: CollectionView | null = null;
  let tab: ItemSlot = 'cannon';
  let visible = false;
  const scrollByTab = new Map<ItemSlot, number>();
  let lastKeys = new Map<string, string>();

  function renderTabs(): void {
    const sections = collectionSections(view?.items ?? []);
    for (const slot of ITEM_SLOTS) {
      const t = tabBtns.get(slot);
      if (!t) continue;
      const s = sections.find((x) => x.slot === slot);
      t.b.setAttribute('aria-selected', String(slot === tab));
      t.count.textContent = s ? `${s.unlocked}/${s.items.length}` : '0/0';
      t.dot.hidden = !s || s.isNew === 0;
      t.dot.textContent = s ? String(s.isNew) : '';
    }
  }

  function renderList(changed: ReadonlySet<string>): void {
    const items = (view?.items ?? []).filter((i) => i.slot === tab);
    list.replaceChildren();
    if (items.length === 0) list.append(el('p', 'hr-cl-empty', 'Nothing here yet.'));
    for (const item of items) {
      const card = itemCard(item, opts.onUpgrade, opts.onBuy);
      list.append(card);
      if (changed.has(item.id)) popEffect(card);
    }
  }

  function selectTab(slot: ItemSlot): void {
    if (slot === tab) return;
    scrollByTab.set(tab, body.scrollTop);
    tab = slot;
    renderTabs();
    renderList(new Set());
    body.scrollTop = scrollByTab.get(slot) ?? 0;
  }

  return {
    show(v: CollectionView) {
      const keep = body.scrollTop;
      const wasVisible = visible;
      view = v;
      coins.set(v.coins);
      const unlocked = v.items.filter((i) => !i.locked).length;
      sub.textContent = `${unlocked} of ${v.items.length} unlocked`;
      // Pop the cards a purchase just changed (only on a refresh of the open screen).
      const changed = new Set<string>();
      const keys = new Map(v.items.map((i) => [i.id, cardKey(i)] as const));
      if (wasVisible) for (const [id, k] of keys) if (lastKeys.has(id) && lastKeys.get(id) !== k) changed.add(id);
      lastKeys = keys;
      if (!v.items.some((i) => i.slot === tab)) tab = v.items[0]?.slot ?? 'cannon';
      renderTabs();
      renderList(changed);
      visible = true;
      screen.classList.add('hr-on');
      body.scrollTop = wasVisible ? keep : (scrollByTab.get(tab) ?? keep);
    },
    hide() {
      if (visible) scrollByTab.set(tab, body.scrollTop);
      visible = false;
      screen.classList.remove('hr-on');
    },
    get visible() {
      return visible;
    },
    dispose() {
      screen.remove();
    },
  };
}
