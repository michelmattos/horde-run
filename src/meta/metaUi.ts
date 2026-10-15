// Shared look and DOM helpers of the milestone 4 meta screens (loadout, collection,
// world map extras, home base sheet), on top of the toy-box sticker theme
// (src/ui/theme.ts, docs/art-direction.md section 7). Everything is scoped under hr-.
// Screens are phone portrait first: full height (--app-h, index.html), safe-area padding, every control >= 48 px,
// native touch scrolling with overscroll contained, tap-to-inspect (no hover). Motion is
// quick and small (<= 150 ms, overshoot <= 10%), scale or opacity only, and never moves
// the screen; prefers-reduced-motion turns it off.
import { HEX } from '../render/look/palette.ts';
import { UI, WOOD_BG, injectUiTheme, outlineShadow } from '../ui/theme.ts';
import { coinIcon } from '../ui/icons.ts';
import { formatCoins, tierPips } from './metaLogic.ts';

const INK = HEX.uiInk;

// Varnished oak boards seen from above (the bedroom floor), with a warm vignette.
export const FLOOR_BG =
  `radial-gradient(130% 90% at 50% 45%,transparent 50%,rgba(40,20,6,.5) 100%),` +
  `repeating-linear-gradient(90deg,rgba(40,18,4,.5) 0 2px,rgba(255,220,170,.15) 2px 3px,transparent 3px 72px),` +
  `repeating-linear-gradient(91deg,transparent 0 5px,rgba(70,36,10,.08) 5px 6px,transparent 6px 13px,rgba(255,230,190,.06) 13px 14px),` +
  `repeating-linear-gradient(90deg,#b58250 0 72px,#a87443 72px 144px,#bd8b58 144px 216px,#a97a49 216px 288px)`;

const CSS = `
.hr-root{font-family:var(--tb-font);font-variant-numeric:tabular-nums;color:${UI.ink};
  -webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}
.hr-root [hidden]{display:none!important}
.hr-root button{font-family:inherit;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.hr-root .tb-btn[disabled]{filter:saturate(.35) brightness(.92);opacity:.6;cursor:default}
.hr-root .tb-btn[disabled]:active{transform:none}

/* ----- Full-screen menu: header plank, scrolling body, optional footer plank ----- */
.hr-screen{position:fixed;inset:0;height:var(--app-h);z-index:11;display:none;flex-direction:column;background:${FLOOR_BG};color:${UI.cream}}
.hr-screen.hr-on{display:flex}
.hr-head{position:relative;z-index:3;flex:none;display:flex;align-items:center;gap:10px;background:${WOOD_BG};border-bottom:4px solid ${UI.ink};
  box-shadow:inset 0 -4px 0 rgba(0,0,0,.25),0 6px 10px rgba(20,10,2,.45);
  padding:max(10px,calc(env(safe-area-inset-top) + 6px)) max(12px,env(safe-area-inset-right)) 10px max(12px,env(safe-area-inset-left))}
.hr-head>.tb-btn{flex:none;width:54px;min-height:52px;padding:0;margin:0 0 5px}
.hr-title{flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:2px}
.hr-title h1{margin:0;max-width:100%;font-size:24px;font-weight:700;line-height:1.1;color:${UI.cream};text-shadow:${outlineShadow(2.2)};
  padding:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hr-title p{margin:0;max-width:100%;font-size:14px;font-weight:600;color:#f3dcb0;text-shadow:${outlineShadow(1.4)};
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hr-body{position:relative;flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;touch-action:pan-y;overscroll-behavior:contain;
  -webkit-overflow-scrolling:touch;box-sizing:border-box;
  padding:16px max(14px,env(safe-area-inset-right)) max(20px,calc(env(safe-area-inset-bottom) + 14px)) max(14px,env(safe-area-inset-left))}
.hr-inner{max-width:460px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
.hr-foot{position:relative;z-index:3;flex:none;display:flex;justify-content:center;background:${WOOD_BG};border-top:4px solid ${UI.ink};
  box-shadow:inset 0 4px 0 rgba(255,225,180,.18),0 -6px 10px rgba(20,10,2,.4);
  padding:12px max(16px,env(safe-area-inset-right)) max(10px,calc(env(safe-area-inset-bottom) + 4px)) max(16px,env(safe-area-inset-left))}
.hr-foot .tb-btn{max-width:340px;margin:0 auto 6px}

/* ----- Coin chip ----- */
.hr-coins{flex:none;display:inline-flex;align-items:center;gap:5px;box-sizing:border-box;min-height:40px;padding:3px 12px 3px 4px;border-radius:999px;
  border:3px solid ${UI.ink};background:${UI.cream};color:${UI.ink};box-shadow:0 3px 0 ${UI.ink};font-size:18px;font-weight:700;white-space:nowrap}
.hr-coins svg{flex:none;width:30px;height:30px}
.hr-coins.hr-bump{animation:hr-bump 150ms cubic-bezier(.3,1.5,.6,1)}
@keyframes hr-bump{0%{transform:scale(1)}50%{transform:scale(1.1)}100%{transform:scale(1)}}

/* ----- Tier pips: little moulded studs ----- */
.hr-pips{display:inline-flex;gap:4px;align-items:center}
.hr-pips i{width:12px;height:12px;box-sizing:border-box;border-radius:50%;border:2px solid ${UI.ink};background:#e3d4b6;
  box-shadow:inset 0 -2px 0 rgba(0,0,0,.12)}
.hr-pips i.hr-on{background:radial-gradient(circle at 35% 30%,#fff3c4 0 18%,${UI.yellow} 45%,#c98a00)}
.hr-pips.hr-max i.hr-on{background:radial-gradient(circle at 35% 30%,#fff 0 18%,#ffd862 45%,#e09a00)}

/* ----- Small tags ----- */
.hr-new{display:inline-flex;align-items:center;padding:2px 8px 3px;border-radius:9px;border:2.5px solid ${UI.ink};background:linear-gradient(#f26a5f,${UI.red});
  color:#fff;text-shadow:${outlineShadow(1.2)};font-size:12px;font-weight:700;letter-spacing:.08em;line-height:1.1;box-shadow:0 2px 0 ${UI.ink};transform:rotate(-4deg)}
.hr-lock{display:inline-flex;align-items:center;justify-content:center}
.hr-hint{display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border-radius:12px;background:rgba(122,79,46,.12);border:2px dashed rgba(122,79,46,.45);
  font-size:15px;font-weight:700;line-height:1.3;color:#5b3f27;text-align:left}
.hr-hint svg{flex:none;margin-top:-2px}

/* ----- Price button (upgrade, buy, build) ----- */
.hr-price{--pf:#ffd862;--pf2:${UI.yellow};--pe:#b27a00;--pt:${UI.ink};display:inline-flex;align-items:center;justify-content:center;gap:6px;
  box-sizing:border-box;min-width:112px;min-height:50px;padding:0 14px 0 8px;margin:0 0 4px;border:3px solid ${UI.ink};border-radius:14px;
  background:linear-gradient(var(--pf),var(--pf2));color:var(--pt);font-size:19px;font-weight:700;white-space:nowrap;
  box-shadow:0 4px 0 var(--pe),0 4px 0 3px ${UI.ink};cursor:pointer;transition:transform 90ms cubic-bezier(.3,1.6,.6,1)}
.hr-price svg{flex:none;width:28px;height:28px}
.hr-price:active{transform:translateY(4px);box-shadow:0 0 0 var(--pe),0 0 0 3px ${UI.ink}}
.hr-price:focus-visible{outline:3px solid ${UI.yellow};outline-offset:4px}
.hr-price.hr-green{--pf:#6fd072;--pf2:${UI.green};--pe:#23692e;--pt:#fff;text-shadow:${outlineShadow(1.5)}}
.hr-price[disabled]{--pf:#e2d9ca;--pf2:#cfc5b5;--pe:#9a9184;--pt:#7d7266;text-shadow:none;cursor:default}
.hr-price[disabled]:active{transform:none;box-shadow:0 4px 0 var(--pe),0 4px 0 3px ${UI.ink}}
.hr-price[disabled] svg{filter:grayscale(1);opacity:.6}
.hr-price small{font-size:14px;font-weight:700;opacity:.9}

/* ----- Purchase pop (CSS only): the card bounces and a coin ring bursts ----- */
.hr-pop{animation:hr-pop 150ms cubic-bezier(.3,1.5,.6,1)}
@keyframes hr-pop{0%{transform:scale(1)}45%{transform:scale(1.06)}100%{transform:scale(1)}}
.hr-burst{position:absolute;left:50%;top:50%;width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:50%;pointer-events:none;
  box-shadow:0 -34px 0 -1px ${UI.yellow},24px -24px 0 -2px #fff3c4,34px 0 0 -1px ${UI.yellow},24px 24px 0 -2px #ff9b90,
    0 34px 0 -1px ${UI.yellow},-24px 24px 0 -2px #fff3c4,-34px 0 0 -1px ${UI.yellow},-24px -24px 0 -2px #8fd0ff;
  animation:hr-burst 420ms ease-out forwards}
@keyframes hr-burst{0%{transform:scale(.3);opacity:1}70%{opacity:1}100%{transform:scale(1.5);opacity:0}}

/* ----- Toast (swap, locked) ----- */
.hr-toast{position:fixed;left:50%;bottom:calc(max(16px,env(safe-area-inset-bottom)) + 110px - var(--app-under));z-index:15;transform:translateX(-50%);
  max-width:calc(100% - 40px);box-sizing:border-box;padding:11px 18px;border-radius:16px;background:${WOOD_BG};border:3.5px solid ${UI.ink};
  box-shadow:0 4px 0 ${UI.ink},0 10px 14px rgba(20,10,2,.4);font-size:17px;font-weight:700;color:${UI.cream};text-shadow:${outlineShadow(1.6)};
  text-align:center;pointer-events:none;opacity:0;transition:opacity .15s}
.hr-toast.hr-on{opacity:1}

@media (prefers-reduced-motion: reduce){.hr-pop,.hr-burst,.hr-coins.hr-bump{animation:none}.hr-burst{display:none}.hr-toast{transition:none}}
`;

let injected = false;
export function injectMetaStyles(extra: string, key: string): void {
  if (typeof document === 'undefined') return;
  injectUiTheme();
  if (!injected) {
    injected = true;
    const s = document.createElement('style');
    s.dataset.hr = 'meta';
    s.textContent = CSS;
    document.head.appendChild(s);
  }
  if (document.head.querySelector(`style[data-hr="${key}"]`)) return;
  const s = document.createElement('style');
  s.dataset.hr = key;
  s.textContent = extra;
  document.head.appendChild(s);
}

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

export function iconSpan(cls: string, html: string): HTMLSpanElement {
  const e = el('span', cls);
  e.setAttribute('aria-hidden', 'true');
  e.innerHTML = html;
  return e;
}

export function button(cls: string, label: string, action?: string, icon = ''): HTMLButtonElement {
  const b = el('button', cls);
  b.type = 'button';
  if (action) b.dataset.action = action;
  b.innerHTML = icon;
  if (label) b.append(el('span', '', label));
  return b;
}

// Square icon-only sticker button for header planks (back, gear).
export function iconButton(cls: string, aria: string, icon: string, action?: string): HTMLButtonElement {
  const b = button(`tb-btn ${cls}`.trim(), '', action, icon);
  b.setAttribute('aria-label', aria);
  return b;
}

export function coinChip(): { el: HTMLSpanElement; set(n: number): void } {
  const c = el('span', 'hr-coins');
  const v = el('span', '');
  c.append(iconSpan('', coinIcon(30)), v);
  let last = -1;
  return {
    el: c,
    set(n) {
      v.textContent = formatCoins(n);
      c.setAttribute('aria-label', `${formatCoins(n)} coins`);
      if (last >= 0 && n !== last) {
        c.classList.remove('hr-bump');
        void c.offsetWidth; // restart the bump
        c.classList.add('hr-bump');
      }
      last = n;
    },
  };
}

export function pips(tier: number, maxTier: number): HTMLSpanElement {
  const p = el('span', `hr-pips${tier >= maxTier ? ' hr-max' : ''}`);
  p.setAttribute('role', 'img');
  p.setAttribute('aria-label', `Tier ${tier} of ${maxTier}`);
  for (const on of tierPips(tier, maxTier)) p.append(el('i', on ? 'hr-on' : ''));
  return p;
}

// Price button: coin + amount (+ optional small label).
export function priceButton(cost: number, label: string, cls = ''): HTMLButtonElement {
  const b = el('button', `hr-price ${cls}`.trim());
  b.type = 'button';
  b.innerHTML = coinIcon(28);
  b.append(el('span', '', formatCoins(cost)));
  if (label) b.append(el('small', '', label));
  return b;
}

// Restarts the pop animation on `node` and drops a one-shot coin burst on it.
export function popEffect(node: HTMLElement): void {
  node.classList.remove('hr-pop');
  void node.offsetWidth;
  node.classList.add('hr-pop');
  const burst = el('i', 'hr-burst');
  burst.setAttribute('aria-hidden', 'true');
  node.append(burst);
  window.setTimeout(() => burst.remove(), 460);
}

export function createToast(root: HTMLElement): { show(text: string): void; hide(): void; dispose(): void } {
  const t = el('div', 'hr-toast hr-root');
  t.setAttribute('role', 'status');
  root.appendChild(t);
  let timer = 0;
  return {
    show(text) {
      t.textContent = text;
      t.classList.add('hr-on');
      clearTimeout(timer);
      timer = window.setTimeout(() => t.classList.remove('hr-on'), 1800);
    },
    hide() {
      clearTimeout(timer);
      t.classList.remove('hr-on');
    },
    dispose() {
      clearTimeout(timer);
      t.remove();
    },
  };
}

// ----- Small icons used by the meta chrome (decorative, sticker style) -----
function svg(body: string, size: number): string {
  return `<svg class="tb-ico" viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true" focusable="false">${body}</svg>`;
}

export function backIcon(size: number, color: string = HEX.uiCream): string {
  const d = 'M19.5 7 L10 16 L19.5 25';
  return svg(
    `<path d="${d}" fill="none" stroke="${INK}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<path d="${d}" fill="none" stroke="${color}" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"/>`,
    size,
  );
}

// A little toy house: red roof, cream walls, a green door.
export function homeIcon(size: number): string {
  return svg(
    `<path d="M7 15 L7 27 L25 27 L25 15" fill="${INK}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>` +
      `<path d="M7 15 L7 27 L25 27 L25 15" fill="${HEX.uiCream}" stroke="${HEX.uiCream}" stroke-width="1" stroke-linejoin="round"/>` +
      `<path d="M3.5 16 L16 5 L28.5 16" fill="none" stroke="${INK}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<path d="M3.5 16 L16 5 L28.5 16" fill="none" stroke="${HEX.toyRed}" stroke-width="3.8" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<rect x="13" y="18.5" width="6.5" height="8.5" rx="1.4" fill="${HEX.green}" stroke="${INK}" stroke-width="1.8"/>` +
      `<rect x="20.5" y="7" width="3.4" height="6" fill="${HEX.toyRed}" stroke="${INK}" stroke-width="1.6"/>`,
    size,
  );
}

// A fanned pair of collectible cards with a star.
export function cardsIcon(size: number): string {
  return svg(
    `<rect x="5" y="7" width="14" height="19" rx="2.6" fill="${HEX.toyBlue}" stroke="${INK}" stroke-width="2.4" transform="rotate(-12 12 16.5)"/>` +
      `<rect x="12" y="6" width="14" height="19" rx="2.6" fill="${HEX.uiCream}" stroke="${INK}" stroke-width="2.4" transform="rotate(8 19 15.5)"/>` +
      `<path d="M19.4 10.4 L20.8 13.6 L24.2 13.9 L21.6 16.1 L22.4 19.5 L19.4 17.7 L16.4 19.5 L17.2 16.1 L14.6 13.9 L18 13.6 Z" fill="${HEX.uiYellow}" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round" transform="rotate(8 19 15.5)"/>`,
    size,
  );
}

// A cog for settings: ink-outlined cream teeth around a hub.
export function cogIcon(size: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    for (const [da, r] of [
      [-0.22, 9.2],
      [-0.12, 12.4],
      [0.12, 12.4],
      [0.22, 9.2],
    ] as const) {
      const t = a + da * 1.6;
      pts.push(`${(16 + Math.cos(t) * r).toFixed(2)} ${(16 + Math.sin(t) * r).toFixed(2)}`);
    }
  }
  const d = `M${pts.join(' L')} Z`;
  return svg(
    `<path d="${d}" fill="${INK}" stroke="${INK}" stroke-width="4.4" stroke-linejoin="round"/>` +
      `<path d="${d}" fill="${HEX.uiCream}" stroke="${HEX.uiCream}" stroke-width="0.6" stroke-linejoin="round"/>` +
      `<circle cx="16" cy="16" r="4" fill="${HEX.uiWoodLight}" stroke="${INK}" stroke-width="2.4"/>`,
    size,
  );
}
