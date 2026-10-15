// HTML overlay of the home base (root data-screen="home"): a wooden header plank with a
// back button, the title and a coin chip; a bottom sheet with one sticker card per
// building in a horizontal, snapping strip (tier pips, the perk now and next, the cost,
// a lock reason, a Build button); and a transparent tap layer over the 3D village that
// reports where it was tapped. Everything else lets the 3D canvas show through.
import { HEX } from '../render/look/palette.ts';
import { UI, outlineShadow } from '../ui/theme.ts';
import { lockIcon } from '../ui/icons.ts';
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
} from '../meta/metaUi.ts';
import type { BuildingView, HomeView } from '../meta/types.ts';
import { buildingCardLook } from './homeLogic.ts';

export interface HomeSheet {
  readonly el: HTMLElement;
  show(v: HomeView): void;
  select(id: string | null, scroll: boolean): void;
  // Free band for the 3D view, as fractions of the viewport height covered at the top
  // (header) and at the bottom (sheet).
  band(): { top: number; bottom: number };
  hide(): void;
  dispose(): void;
}

export interface HomeSheetOptions {
  onBuild(id: string): void;
  onBack(): void;
  onSelect(id: string): void;
  onTap(clientX: number, clientY: number): void;
}

const INK = HEX.uiInk;

const CSS = `
.hr-home{position:fixed;inset:0;height:100dvh;z-index:11;display:none;pointer-events:none}
.hr-home.hr-on{display:block}
.hr-home .hr-head{position:absolute;left:0;right:0;top:0;pointer-events:auto}
.hr-home-tap{position:absolute;inset:0;pointer-events:auto;touch-action:none;cursor:pointer}
.hr-home-sheet{position:absolute;left:0;right:0;bottom:0;pointer-events:auto;border-radius:26px 26px 0 0;border-bottom:0;
  box-shadow:0 -8px 24px rgba(20,10,2,.4);padding:12px 0 max(12px,calc(env(safe-area-inset-bottom) + 6px))}
.hr-home-sheet h2{margin:0 max(18px,env(safe-area-inset-left)) 2px;font-size:15px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6b5440}
.hr-strip{display:flex;gap:14px;overflow-x:auto;overflow-y:hidden;touch-action:pan-x;overscroll-behavior:contain;scroll-snap-type:x mandatory;
  -webkit-overflow-scrolling:touch;scrollbar-width:none;padding:14px max(18px,env(safe-area-inset-right)) 12px max(18px,env(safe-area-inset-left));
  scroll-padding:0 max(18px,env(safe-area-inset-left))}
.hr-strip::-webkit-scrollbar{display:none}
.hr-bld{position:relative;flex:none;box-sizing:border-box;width:min(76vw,292px);min-height:168px;scroll-snap-align:center;display:flex;flex-direction:column;gap:6px;
  padding:12px 12px 10px;border:3.5px solid ${UI.ink};border-radius:20px;color:${UI.ink};text-align:left;cursor:pointer;
  background:linear-gradient(180deg,#fffdf6,#f3e5c6);box-shadow:0 5px 0 -0.5px #cdb48a,0 5px 0 3px ${UI.ink};
  transition:transform 90ms cubic-bezier(.3,1.6,.6,1)}
.hr-bld:focus-visible{outline:3px solid ${UI.yellow};outline-offset:4px}
.hr-bld.hr-sel{background:linear-gradient(180deg,#fffbe0,#ffe9a0);box-shadow:0 0 0 4px ${UI.yellow},0 5px 0 1px ${UI.ink},0 0 18px 4px rgba(255,197,49,.5)}
.hr-bld-top{display:flex;align-items:center;gap:10px}
.hr-bld-ico{flex:none;width:48px;height:48px}
.hr-bld-ico svg{width:48px;height:48px;display:block}
.hr-bld-name{display:flex;flex-direction:column;gap:3px;min-width:0}
.hr-bld-name b{font-size:20px;line-height:1.1}
.hr-bld-name span{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:#6b5440}
.hr-perk{margin:0;font-size:15px;font-weight:600;line-height:1.3;color:#3d2c1d}
.hr-perk b{font-weight:700;color:${UI.ink}}
.hr-perk.hr-next b{color:#2c8a3a}
.hr-bld-foot{margin-top:auto;display:flex;align-items:center;justify-content:flex-end;gap:8px}
.hr-bld-foot .hr-hint{flex:1;padding:6px 8px;font-size:14px}
.hr-bld .hr-price{min-width:118px}
.hr-built{padding:4px 12px;border:3.5px solid #2c8a3a;border-radius:10px;color:#2c8a3a;font-size:16px;font-weight:700;letter-spacing:.08em;
  transform:rotate(-5deg);background:rgba(255,246,227,.7)}
.hr-home .hr-head .hr-title h1{text-shadow:${outlineShadow(2.2)}}
`;

// ----- Building stickers (decorative) -----
function svg(body: string): string {
  return `<svg class="tb-ico" viewBox="0 0 48 48" width="48" height="48" aria-hidden="true" focusable="false">${body}</svg>`;
}
function disc(c1: string, c2: string): string {
  return (
    `<circle cx="24" cy="25.5" r="22" fill="${INK}"/><circle cx="24" cy="24" r="22" fill="${INK}"/>` +
    `<circle cx="24" cy="24" r="19" fill="${c2}"/><circle cx="21" cy="19" r="12" fill="${c1}" opacity=".5"/>`
  );
}
const ICONS: Record<string, () => string> = {
  barracks: () =>
    svg(
      disc('#e6c08e', '#a8743f') +
        `<path d="M11 24 L24 13 L37 24" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>` +
        `<path d="M11 24 L24 13 L37 24" fill="none" stroke="#d93a2f" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>` +
        `<rect x="14" y="24" width="20" height="13" rx="2" fill="#c08a55" stroke="${INK}" stroke-width="2.4"/>` +
        `<path d="M14 28.5 H34 M14 33 H34" stroke="${INK}" stroke-width="1.4" opacity=".5"/>` +
        `<rect x="21" y="28" width="6" height="9" rx="1" fill="#6e4426" stroke="${INK}" stroke-width="1.8"/>`,
    ),
  walls: () =>
    svg(
      disc('#9fc2f5', '#2f6fd6') +
        `<rect x="9" y="25" width="10" height="10" rx="2" fill="#d93a2f" stroke="${INK}" stroke-width="2.4"/>` +
        `<rect x="29" y="25" width="10" height="10" rx="2" fill="#f2b630" stroke="${INK}" stroke-width="2.4"/>` +
        `<rect x="9" y="15" width="10" height="10" rx="2" fill="#8e4fc4" stroke="${INK}" stroke-width="2.4"/>` +
        `<rect x="29" y="15" width="10" height="10" rx="2" fill="#1fa3b0" stroke="${INK}" stroke-width="2.4"/>` +
        `<path d="M19 35 V24 C19 18 29 18 29 24 V35" fill="none" stroke="${INK}" stroke-width="2.4"/>` +
        `<path d="M12 22 V18 M16 32 H12 M32 18 L36 22 M32 32 H36" stroke="${HEX.uiCream}" stroke-width="1.8" stroke-linecap="round"/>`,
    ),
  workshop: () =>
    svg(
      disc('#c3cbd2', '#7b858e') +
        `<path d="M14 34 L30 18" stroke="${INK}" stroke-width="8" stroke-linecap="round"/>` +
        `<path d="M14 34 L30 18" stroke="#c08a55" stroke-width="4" stroke-linecap="round"/>` +
        `<path d="M25 13 L35 23 L31 27 L21 17 Z" fill="#b9c0c6" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>` +
        `<circle cx="33" cy="33" r="5.5" fill="#d2a33f" stroke="${INK}" stroke-width="2.4"/><circle cx="33" cy="33" r="2" fill="${INK}"/>`,
    ),
  garden: () =>
    svg(
      disc('#8fd4b8', '#2e8a6e') +
        `<path d="M24 10 L33 24 H28 L35 33 H13 L20 24 H15 Z" fill="#4aa585" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>` +
        `<rect x="21.5" y="33" width="5" height="5" fill="#9a6634" stroke="${INK}" stroke-width="2"/>` +
        `<circle cx="13" cy="34" r="3.2" fill="#d93a2f" stroke="${INK}" stroke-width="1.8"/><circle cx="35" cy="34" r="3.2" fill="#f2b630" stroke="${INK}" stroke-width="1.8"/>`,
    ),
  flagpole: () =>
    svg(
      disc('#ffe08a', '#d99a12') +
        `<path d="M17 38 V10" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>` +
        `<path d="M17 38 V10" stroke="#b9c0c6" stroke-width="2" stroke-linecap="round"/>` +
        `<path d="M18 11 C24 8 28 14 35 11 V22 C28 25 24 19 18 22 Z" fill="${HEX.green}" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>` +
        `<rect x="11" y="36" width="12" height="4" rx="1.5" fill="#d8d2c6" stroke="${INK}" stroke-width="2"/>`,
    ),
};

function card(b: BuildingView, onBuild: (id: string) => void, onSelect: (id: string) => void): HTMLElement {
  const look = buildingCardLook(b);
  const c = el('div', 'hr-bld');
  c.dataset.building = b.id;
  c.tabIndex = 0;
  c.setAttribute('role', 'group');
  c.setAttribute('aria-label', `${b.name}, ${look.tierText}`);
  const top = el('div', 'hr-bld-top');
  const name = el('div', 'hr-bld-name');
  const tier = el('span', '');
  tier.append(pips(b.tier, b.maxTier), look.tierText);
  name.append(el('b', '', b.name), tier);
  top.append(iconSpan('hr-bld-ico', (ICONS[b.id] ?? ICONS.barracks)()), name);
  c.append(top);
  const now = el('p', 'hr-perk');
  now.append(el('b', '', 'Now: '), b.perkNow);
  c.append(now);
  if (b.nextPerk) {
    const next = el('p', 'hr-perk hr-next');
    next.append(el('b', '', 'Next: '), b.nextPerk);
    c.append(next);
  }
  const foot = el('div', 'hr-bld-foot');
  if (b.lockedReason && b.nextCost !== null) {
    const hint = el('div', 'hr-hint');
    hint.append(iconSpan('hr-lock', lockIcon(20, '#f1ebe0')), el('span', '', b.lockedReason));
    foot.append(hint);
  }
  if (look.action === 'built') foot.append(el('span', 'hr-built', 'FULLY BUILT'));
  else if (b.nextCost !== null) {
    const btn = priceButton(b.nextCost, look.label);
    btn.dataset.action = 'build';
    btn.disabled = look.action !== 'build';
    btn.setAttribute('aria-label', `${look.label} ${b.name} for ${b.nextCost} coins${look.why ? `, ${look.why}` : ''}`);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (btn.disabled) return;
      popEffect(c);
      onBuild(b.id);
    });
    foot.append(btn);
  }
  c.append(foot);
  c.addEventListener('click', () => onSelect(b.id));
  c.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') onSelect(b.id);
  });
  return c;
}

export function createHomeSheet(root: HTMLElement, opts: HomeSheetOptions): HomeSheet {
  injectMetaStyles(CSS, 'home');
  const wrap = el('div', 'hr-home hr-root');
  wrap.dataset.screen = 'home';
  wrap.setAttribute('role', 'main');
  wrap.setAttribute('aria-label', 'Home base');

  const tap = el('div', 'hr-home-tap');
  tap.setAttribute('aria-hidden', 'true');
  tap.addEventListener('click', (e) => opts.onTap(e.clientX, e.clientY));

  const head = el('header', 'hr-head');
  const back = iconButton('tb-wood', 'Back', backIcon(30), 'back');
  back.addEventListener('click', () => opts.onBack());
  const title = el('div', 'hr-title');
  title.append(el('h1', '', 'Home base'), el('p', '', 'Rebuild the village with coins'));
  const coins = coinChip();
  head.append(back, title, coins.el);

  const sheet = el('section', 'hr-home-sheet tb-card');
  sheet.setAttribute('aria-label', 'Buildings');
  const strip = el('div', 'hr-strip');
  sheet.append(el('h2', '', 'Buildings'), strip);

  wrap.append(tap, head, sheet);
  root.appendChild(wrap);

  let selected: string | null = null;
  const cards = new Map<string, HTMLElement>();
  let lastTiers = new Map<string, number>();

  const applySelection = (): void => {
    for (const [id, c] of cards) c.classList.toggle('hr-sel', id === selected);
  };

  const onKey = (e: KeyboardEvent): void => {
    if (wrap.classList.contains('hr-on') && e.key === 'Escape') opts.onBack();
  };
  window.addEventListener('keydown', onKey);

  return {
    el: wrap,
    show(v) {
      coins.set(v.coins);
      const keep = strip.scrollLeft;
      strip.replaceChildren();
      cards.clear();
      for (const b of v.buildings) {
        const c = card(b, opts.onBuild, opts.onSelect);
        cards.set(b.id, c);
        strip.append(c);
        const was = lastTiers.get(b.id);
        if (was !== undefined && b.tier > was) popEffect(c);
      }
      lastTiers = new Map(v.buildings.map((b) => [b.id, b.tier]));
      wrap.classList.add('hr-on');
      strip.scrollLeft = keep;
      applySelection();
    },
    select(id, scroll) {
      selected = id;
      applySelection();
      const c = id ? cards.get(id) : undefined;
      if (c && scroll) {
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        const left = c.offsetLeft - (strip.clientWidth - c.offsetWidth) / 2;
        strip.scrollTo({ left: Math.max(0, left), behavior: reduce ? 'auto' : 'smooth' });
      }
    },
    band() {
      const h = window.innerHeight || 1;
      const top = head.getBoundingClientRect().bottom / h;
      const bottom = (h - sheet.getBoundingClientRect().top) / h;
      return { top: Math.max(0, top), bottom: Math.max(0, bottom) };
    },
    hide() {
      wrap.classList.remove('hr-on');
    },
    dispose() {
      window.removeEventListener('keydown', onKey);
      wrap.remove();
    },
  };
}
