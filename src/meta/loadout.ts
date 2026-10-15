// Loadout screen: shown between the level card and the battle. Five big sticker slots
// (cannon, mob 1, mob 2, champion, ultimate) on the bedroom floor; tapping a slot opens a
// bottom sheet with that slot's items. Unlocked items equip at once (picking the other mob
// slot's mob swaps the two); locked ones show a padlock and, on tap, their unlock hint.
// A coin chip and a back button sit on the header plank, the big yellow Fight! button on
// the footer plank. The selection shown is the one passed in (repaired only if it holds a
// locked or unknown item). Pure rules live in metaLogic.ts.
//
//   const screen = createLoadoutScreen(root, { onStart(sel) {...}, onBack() {...}, onCollection() {...} });
//   screen.show(view);  // LoadoutView from integration
//   screen.hide();
import { UI, outlineShadow } from '../ui/theme.ts';
import { lockIcon, tickIcon } from '../ui/icons.ts';
import { itemIcon } from './itemIcons.ts';
import { SLOT_KEYS, SLOT_LABEL, assignSlot, pickerEntries, repairSelection, selectedId, slotOf } from './metaLogic.ts';
import type { Selection, SlotKey } from './metaLogic.ts';
import {
  backIcon,
  button,
  cardsIcon,
  coinChip,
  createToast,
  el,
  iconButton,
  iconSpan,
  injectMetaStyles,
  pips,
} from './metaUi.ts';
import type { ItemCard, LoadoutView } from './types.ts';

export interface LoadoutScreen {
  show(v: LoadoutView): void;
  hide(): void;
  readonly visible: boolean;
  dispose(): void;
}

export interface LoadoutOptions {
  onStart(sel: LoadoutView['selected']): void;
  onBack(): void;
  onCollection(): void;
}

const PICK_TITLE: Record<SlotKey, string> = {
  cannon: 'Pick a cannon',
  mob0: 'Pick mob 1',
  mob1: 'Pick mob 2',
  champion: 'Pick a champion',
  ultimate: 'Pick an ultimate',
};

const CSS = `
.hr-lo-sub{margin:2px 2px 0;font-size:15px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${UI.cream};text-shadow:${outlineShadow(1.6)}}
.hr-boss{display:inline-flex;align-items:center;margin-left:6px;padding:1px 8px 2px;border-radius:8px;border:2px solid ${UI.ink};
  background:linear-gradient(#f26a5f,${UI.red});color:#fff;font-size:12px;font-weight:700;letter-spacing:.06em;text-shadow:${outlineShadow(1.1)};vertical-align:1px}
.hr-slots{display:grid;grid-template-columns:1fr 1fr;gap:16px 12px;padding-top:8px}
.hr-slot{--tint:${UI.cream};position:relative;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;gap:5px;min-height:168px;margin:0 0 6px;
  padding:16px 8px 12px;border:3.5px solid ${UI.ink};border-radius:20px;color:${UI.ink};text-align:center;cursor:pointer;
  background:radial-gradient(120% 70% at 50% 0%,rgba(255,255,255,.85),transparent 60%),linear-gradient(180deg,#fffdf6,var(--tint));
  box-shadow:inset 0 -4px 0 rgba(0,0,0,.06),0 6px 0 -0.5px #cdb48a,0 6px 0 3px ${UI.ink},0 12px 14px rgba(20,10,2,.3);
  transition:transform 90ms cubic-bezier(.3,1.6,.6,1)}
.hr-slot:active{transform:translateY(4px)}
.hr-slot:focus-visible{outline:3px solid ${UI.yellow};outline-offset:5px}
.hr-slot.hr-wide{grid-column:1/-1;flex-direction:row;align-items:center;gap:14px;min-height:118px;padding:16px 16px 12px;text-align:left}
.hr-slot[data-kind=cannon]{--tint:#e7ecf0}
.hr-slot[data-kind=mob]{--tint:#e2f0da}
.hr-slot[data-kind=champion]{--tint:#fde6cc}
.hr-slot[data-kind=ultimate]{--tint:#ece0fa}
.hr-slot .hr-ico{display:block;width:78px;height:78px;flex:none}
.hr-slot .hr-ico svg{width:78px;height:78px;display:block;filter:drop-shadow(0 3px 0 rgba(43,29,18,.25))}
.hr-slot-tag{position:absolute;top:-13px;left:12px;padding:3px 10px 4px;border-radius:9px;border:2.5px solid ${UI.ink};background:${UI.wood};
  color:${UI.cream};text-shadow:${outlineShadow(1.3)};font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;box-shadow:0 2px 0 ${UI.ink}}
.hr-slot-name{font-size:20px;font-weight:700;line-height:1.1}
.hr-slot-text{font-size:14px;font-weight:600;line-height:1.25;color:#5b4632;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.hr-slot-col{display:flex;flex-direction:column;align-items:center;gap:5px;min-width:0;flex:1}
.hr-slot.hr-wide .hr-slot-col{align-items:flex-start}
.hr-swap{position:absolute;right:8px;top:8px;width:26px;height:26px;border-radius:50%;border:2.5px solid ${UI.ink};background:${UI.yellow};
  display:flex;align-items:center;justify-content:center;box-shadow:0 2px 0 ${UI.ink}}
.hr-swap::before{content:'';width:8px;height:8px;border-right:3px solid ${UI.ink};border-bottom:3px solid ${UI.ink};transform:translateY(-2px) rotate(45deg)}
.hr-lo-more{margin-top:4px}
.hr-lo-more .tb-btn{max-width:340px;margin:0 auto 6px}
.hr-fight{min-width:220px}
.hr-fight span{font-size:32px;letter-spacing:.02em}

/* ----- Picker sheet ----- */
.hr-sheet-wrap{position:fixed;inset:0;z-index:13;display:none;flex-direction:column;justify-content:flex-end}
.hr-sheet-wrap.hr-on{display:flex}
.hr-sheet-bg{position:absolute;inset:0;border:0;padding:0;margin:0;cursor:pointer}
.hr-sheet{position:relative;width:100%;max-width:520px;margin:0 auto;max-height:86dvh;display:flex;flex-direction:column;border-radius:26px 26px 0 0;
  border-bottom:0;box-shadow:0 -10px 30px rgba(20,10,2,.45);
  padding:14px max(14px,env(safe-area-inset-right)) max(16px,calc(env(safe-area-inset-bottom) + 10px)) max(14px,env(safe-area-inset-left))}
.hr-sheet-wrap.hr-on .hr-sheet{animation:hr-up 150ms cubic-bezier(.3,1.3,.6,1) both}
@keyframes hr-up{0%{transform:translateY(24px);opacity:.6}100%{transform:none;opacity:1}}
.hr-sheet-head{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.hr-sheet-head h2{flex:1;margin:0;font-size:24px;font-weight:700;line-height:1.1}
.hr-sheet-head .tb-btn{flex:none;width:auto;min-width:96px;margin:0 0 5px}
.hr-sheet-list{overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y;-webkit-overflow-scrolling:touch;margin:0 -6px;padding:12px 6px 6px}
.hr-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:16px 12px}
.hr-tile{position:relative;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;gap:4px;min-height:142px;margin:0 0 5px;padding:12px 6px 10px;
  border:3px solid ${UI.ink};border-radius:18px;background:linear-gradient(180deg,#fffdf7,#f3e5c6);color:${UI.ink};cursor:pointer;
  box-shadow:0 5px 0 -0.5px #cdb48a,0 5px 0 3px ${UI.ink};transition:transform 90ms cubic-bezier(.3,1.6,.6,1)}
.hr-tile:active{transform:translateY(3px)}
.hr-tile:focus-visible{outline:3px solid ${UI.yellow};outline-offset:4px}
.hr-tile .hr-ico svg{width:64px;height:64px;display:block}
.hr-tile b{font-size:17px;line-height:1.1}
.hr-tile.hr-cur{background:linear-gradient(180deg,#fffbe0,#ffe9a0);box-shadow:0 0 0 4px ${UI.yellow},0 5px 0 1px ${UI.ink}}
.hr-tile.hr-locked{background:linear-gradient(180deg,#eee6d6,#d9cdb6);color:#6b5a48}
.hr-tile.hr-locked .hr-ico{filter:grayscale(.85) brightness(.85);opacity:.75}
.hr-tile .hr-padlock{position:absolute;left:50%;top:34px;margin-left:-19px;width:38px;height:38px}
.hr-tile .hr-padlock svg{width:38px;height:38px;display:block}
.hr-tile[aria-pressed=true]{box-shadow:0 0 0 4px ${UI.blue},0 5px 0 1px ${UI.ink}}
.hr-tile .hr-check{position:absolute;left:-10px;top:-10px;width:30px;height:30px}
.hr-tile .hr-check svg{width:30px;height:30px;display:block}
.hr-tile .hr-in{position:absolute;right:-6px;top:-11px;padding:2px 7px 3px;border-radius:8px;border:2px solid ${UI.ink};background:${UI.cream};
  font-size:12px;font-weight:700;box-shadow:0 2px 0 ${UI.ink};transform:rotate(4deg)}
.hr-tile .hr-new{position:absolute;right:-6px;top:-11px}
.hr-detail{margin-top:12px;display:flex;flex-direction:column;gap:6px;padding:12px 14px;border-radius:16px;background:rgba(214,186,138,.22);
  border:2.5px dashed rgba(122,79,46,.4);text-align:left}
.hr-detail b{font-size:19px}
.hr-detail p{margin:0;font-size:15px;font-weight:600;line-height:1.3;color:#3d2c1d}
`;

function slotCard(key: SlotKey): {
  el: HTMLButtonElement;
  set(item: ItemCard | undefined): void;
} {
  const kind = slotOf(key);
  const b = el('button', `hr-slot${key === 'cannon' ? ' hr-wide' : ''}`);
  b.type = 'button';
  b.dataset.slot = key;
  b.dataset.kind = kind;
  const ico = iconSpan('hr-ico', '');
  const col = el('span', 'hr-slot-col');
  const name = el('span', 'hr-slot-name');
  const text = el('span', 'hr-slot-text');
  const pipBox = el('span', '');
  col.append(name, pipBox, text);
  b.append(el('span', 'hr-slot-tag', SLOT_LABEL[key]), ico, col, iconSpan('hr-swap', ''));
  return {
    el: b,
    set(item) {
      ico.innerHTML = itemIcon(item?.id ?? '', 78);
      name.textContent = item?.name ?? 'Empty';
      text.textContent = item?.text ?? '';
      pipBox.replaceChildren(item ? pips(item.tier, item.maxTier) : el('span', ''));
      b.setAttribute('aria-label', `${SLOT_LABEL[key]}: ${item?.name ?? 'empty'}. Tap to change`);
    },
  };
}

export function createLoadoutScreen(root: HTMLElement, opts: LoadoutOptions): LoadoutScreen {
  injectMetaStyles(CSS, 'loadout');

  const screen = el('div', 'hr-screen hr-root');
  screen.dataset.screen = 'loadout';
  screen.setAttribute('role', 'main');
  screen.setAttribute('aria-label', 'Loadout');

  // ----- Header plank -----
  const head = el('header', 'hr-head');
  const back = iconButton('tb-wood', 'Back', backIcon(30), 'back');
  const title = el('div', 'hr-title');
  const h1 = el('h1', '');
  const sub = el('p', '');
  title.append(h1, sub);
  const coins = coinChip();
  head.append(back, title, coins.el);

  // ----- Body: slots + collection link -----
  const body = el('div', 'hr-body');
  const inner = el('div', 'hr-inner');
  const slotsEl = el('div', 'hr-slots');
  const cards = new Map<SlotKey, ReturnType<typeof slotCard>>();
  for (const key of SLOT_KEYS) {
    const c = slotCard(key);
    c.el.addEventListener('click', () => openPicker(key));
    cards.set(key, c);
    slotsEl.append(c.el);
  }
  const more = el('div', 'hr-lo-more');
  const collectionBtn = button('tb-btn tb-wood tb-small', 'Upgrades & collection', 'collection', cardsIcon(30));
  collectionBtn.addEventListener('click', () => opts.onCollection());
  more.append(collectionBtn);
  inner.append(el('p', 'hr-lo-sub', 'Your loadout'), slotsEl, more);
  body.append(inner);

  // ----- Footer: Fight! -----
  const foot = el('footer', 'hr-foot');
  const fight = button('tb-btn tb-yellow tb-big hr-fight', 'Fight!', 'fight');
  fight.addEventListener('click', () => {
    if (!view) return;
    closePicker();
    opts.onStart({ ...sel, mobs: [sel.mobs[0], sel.mobs[1]] });
  });
  foot.append(fight);

  screen.append(head, body, foot);
  root.appendChild(screen);

  // ----- Picker sheet -----
  const wrap = el('div', 'hr-sheet-wrap hr-root');
  wrap.dataset.picker = '';
  const bg = el('button', 'hr-sheet-bg tb-backdrop');
  bg.type = 'button';
  bg.setAttribute('aria-label', 'Close');
  const sheet = el('div', 'hr-sheet tb-card');
  sheet.setAttribute('role', 'dialog');
  const sheetHead = el('div', 'hr-sheet-head');
  const sheetTitle = el('h2', '');
  const done = button('tb-btn tb-small', 'Done', 'close');
  sheetHead.append(sheetTitle, done);
  const list = el('div', 'hr-sheet-list');
  const tiles = el('div', 'hr-tiles');
  const detail = el('div', 'hr-detail');
  list.append(tiles, detail);
  sheet.append(sheetHead, list);
  wrap.append(bg, sheet);
  root.appendChild(wrap);
  const toast = createToast(root);

  let view: LoadoutView | null = null;
  let sel: Selection = { cannon: '', mobs: ['', ''], champion: '', ultimate: '' };
  let visible = false;
  let pickKey: SlotKey | null = null;
  let inspectId: string | null = null;

  function renderSlots(): void {
    const items = view?.items ?? [];
    for (const key of SLOT_KEYS) {
      const id = selectedId(sel, key);
      cards.get(key)?.set(items.find((i) => i.id === id));
    }
  }

  function renderDetail(item: ItemCard | undefined): void {
    detail.replaceChildren();
    if (!item) {
      detail.hidden = true;
      return;
    }
    detail.hidden = false;
    detail.append(el('b', '', item.name), el('p', '', item.text));
    if (item.locked) {
      const hint = el('div', 'hr-hint');
      hint.append(iconSpan('hr-lock', lockIcon(24, '#f1ebe0')), el('span', '', item.hint || 'Locked'));
      detail.append(hint);
    }
  }

  function renderPicker(): void {
    if (!view || !pickKey) return;
    const key = pickKey;
    sheetTitle.textContent = PICK_TITLE[key];
    sheet.setAttribute('aria-label', PICK_TITLE[key]);
    tiles.replaceChildren();
    for (const e of pickerEntries(sel, key, view.items)) {
      const t = el('button', 'hr-tile');
      t.type = 'button';
      t.dataset.item = e.item.id;
      t.classList.toggle('hr-cur', e.current);
      t.classList.toggle('hr-locked', !e.usable);
      t.setAttribute('aria-pressed', String(inspectId === e.item.id && !e.usable));
      t.append(iconSpan('hr-ico', itemIcon(e.item.id, 64)), el('b', '', e.item.name));
      if (e.usable) t.append(pips(e.item.tier, e.item.maxTier));
      else t.append(iconSpan('hr-padlock', lockIcon(38, '#f1ebe0')), el('span', 'hr-slot-text', 'Locked'));
      if (e.current) t.append(iconSpan('hr-check', tickIcon(30)));
      if (e.inOtherSlot) t.append(el('span', 'hr-in', key === 'mob0' ? 'Mob 2' : 'Mob 1'));
      else if (e.item.isNew && e.usable) t.append(el('span', 'hr-new', 'NEW'));
      const label = e.usable
        ? `${e.item.name}${e.current ? ', equipped' : e.inOtherSlot ? ', swap slots' : ''}`
        : `${e.item.name}, locked. ${e.item.hint}`;
      t.setAttribute('aria-label', label);
      t.addEventListener('click', () => pick(e.item.id));
      tiles.append(t);
    }
    const shown = view.items.find((i) => i.id === (inspectId ?? selectedId(sel, key)));
    renderDetail(shown);
  }

  function pick(id: string): void {
    if (!view || !pickKey) return;
    const r = assignSlot(sel, pickKey, id, view.items);
    if (r.result === 'locked') {
      inspectId = id; // tap-to-inspect: show the hint, keep the sheet open
      renderPicker();
      return;
    }
    if (r.result === 'unknown') return;
    sel = r.sel;
    if (r.result === 'swapped') toast.show('Mob slots swapped');
    renderSlots();
    closePicker();
  }

  function openPicker(key: SlotKey): void {
    if (!view) return;
    pickKey = key;
    inspectId = null;
    renderPicker();
    wrap.classList.add('hr-on');
    list.scrollTop = 0;
    done.focus({ preventScroll: true });
  }

  function closePicker(): void {
    if (!pickKey) return;
    const key = pickKey;
    pickKey = null;
    inspectId = null;
    wrap.classList.remove('hr-on');
    cards.get(key)?.el.focus({ preventScroll: true });
  }

  bg.addEventListener('click', closePicker);
  done.addEventListener('click', closePicker);
  back.addEventListener('click', () => {
    if (pickKey) closePicker();
    else opts.onBack();
  });
  const onKey = (e: KeyboardEvent): void => {
    if (!visible) return;
    if (e.key === 'Escape') {
      if (pickKey) closePicker();
      else opts.onBack();
    }
  };
  window.addEventListener('keydown', onKey);

  return {
    show(v: LoadoutView) {
      view = v;
      sel = repairSelection(v.selected, v.items);
      h1.textContent = `Level ${v.level.code}`;
      sub.replaceChildren(v.level.name);
      if (v.level.boss) {
        const tag = el('span', 'hr-boss', 'BOSS');
        sub.append(tag, ` ${v.level.boss}`);
      }
      coins.set(v.coins);
      renderSlots();
      if (pickKey) renderPicker();
      visible = true;
      screen.classList.add('hr-on');
    },
    hide() {
      visible = false;
      closePicker();
      toast.hide();
      screen.classList.remove('hr-on');
    },
    get visible() {
      return visible;
    },
    dispose() {
      window.removeEventListener('keydown', onKey);
      toast.dispose();
      wrap.remove();
      screen.remove();
    },
  };
}
