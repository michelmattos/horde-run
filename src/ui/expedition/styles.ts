// Styles of the Expedition screens, injected once on top of the shared toy-box theme
// (src/ui/theme.ts, docs/art-direction.md section 7). Everything is scoped under hx-.
// The run map is a green felt play mat under a wooden header plank; the other screens
// are cream sticker cards, over the felt (shop, rest, start, result) or over a dimmed
// battlefield (pick, lost battle). Motion: quick pop-ins (<= 150 ms) and a gentle pulse
// on available nodes, scale or glow only, off under prefers-reduced-motion. Nothing
// moves the screen and no animation blocks input.
import { UI, WOOD_BG, injectUiTheme, outlineShadow } from '../theme.ts';
import { LABEL_W } from './layout.ts';

// Billiard-green felt: two fine fibre crosshatches, a soft top light and a vignette.
export const FELT_BG =
  `radial-gradient(130% 90% at 50% 40%,transparent 50%,rgba(8,24,14,.55) 100%),` +
  `radial-gradient(90% 60% at 50% 0%,rgba(255,255,220,.10),transparent 70%),` +
  `repeating-linear-gradient(37deg,rgba(255,255,255,.035) 0 1px,transparent 1px 3px),` +
  `repeating-linear-gradient(-53deg,rgba(0,0,0,.05) 0 1px,transparent 1px 4px),` +
  `linear-gradient(180deg,#2f7450,#245c3f)`;

const SAFE_PAD =
  'padding:max(20px,calc(env(safe-area-inset-top) + 14px)) max(14px,env(safe-area-inset-right)) max(20px,calc(env(safe-area-inset-bottom) + 14px)) max(14px,env(safe-area-inset-left));';

const CSS = `
.hx-root{font-family:var(--tb-font);font-variant-numeric:tabular-nums;color:${UI.ink};
  -webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}
.hx-root [hidden]{display:none!important}
.hx-root button{font-family:inherit;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.hx-root .tb-btn[disabled]{filter:saturate(.35) brightness(.92);opacity:.6;cursor:default}
.hx-root .tb-btn[disabled]:active{transform:none}

/* ----- Full-screen card screens ----- */
.hx-ov{position:fixed;inset:0;height:var(--app-h);z-index:11;display:none;overflow-y:auto;overflow-x:hidden;touch-action:pan-y;
  overscroll-behavior:contain;-webkit-overflow-scrolling:touch;box-sizing:border-box;${SAFE_PAD}}
.hx-ov.hx-on{display:block}
.hx-ov.hx-felt{background:${FELT_BG}}
.hx-wrap{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center}
.hx-card{width:100%;max-width:410px;margin:auto 0;display:flex;flex-direction:column;gap:12px;padding:0 16px 20px;text-align:center}
.hx-ov.hx-on .hx-card{animation:hx-in 140ms cubic-bezier(.3,1.4,.6,1) both}
@keyframes hx-in{0%{transform:scale(.95);opacity:.5}100%{transform:scale(1);opacity:1}}

/* Wooden header plank of a card (as the campaign overlays). */
.hx-banner{position:relative;margin:-4px -20px 2px;padding:14px 18px 15px;border:4px solid ${UI.ink};border-radius:26px 26px 18px 18px;
  background:${WOOD_BG};box-shadow:inset 0 3px 0 rgba(255,225,180,.3),inset 0 -4px 0 rgba(0,0,0,.25),0 5px 0 ${UI.ink};
  display:flex;flex-direction:column;align-items:center;gap:6px}
.hx-banner::before,.hx-banner::after{content:'';position:absolute;top:50%;width:9px;height:9px;margin-top:-4px;border-radius:50%;
  background:radial-gradient(circle at 35% 35%,#f4e2b8,#a8834a 60%,#5e4220);box-shadow:0 0 0 2px ${UI.ink}}
.hx-banner::before{left:12px}
.hx-banner::after{right:12px}
.hx-h{margin:0;font-size:38px;font-weight:700;line-height:1.08;color:${UI.cream};text-shadow:${outlineShadow(2.6)};padding:0 10px}
.hx-h.hx-gold{color:${UI.yellow}}
.hx-h.hx-pink{color:#ffb4a8}
.hx-h.hx-huge{font-size:46px}
.hx-sub{margin:0;font-size:16px;font-weight:600;line-height:1.3;color:#6b5440}
.hx-banner .hx-sub{color:#f6e3bf;text-shadow:${outlineShadow(1.6)}}
.hx-lead{margin:2px 0 0;font-size:18px;font-weight:700}
.hx-stack{display:flex;flex-direction:column;gap:12px;margin-top:4px}
.hx-pair{display:flex;gap:12px}
.hx-pair>.tb-btn{flex:1;min-width:0}
.hx-chips{display:flex;flex-wrap:wrap;justify-content:center;gap:8px}

/* Ribbon stickers: ELITE, NEW BEST, daily date. */
.hx-tag{align-self:center;display:inline-flex;align-items:center;gap:6px;padding:4px 12px 5px;border-radius:10px;border:3px solid ${UI.ink};
  box-shadow:0 3px 0 ${UI.ink};font-size:15px;font-weight:700;letter-spacing:.06em;line-height:1.1;transform:rotate(-2deg)}
.hx-tag-red{background:linear-gradient(#f26a5f,${UI.red});color:#fff;text-shadow:${outlineShadow(1.4)}}
.hx-tag-yellow{background:linear-gradient(#ffd862,${UI.yellow});color:${UI.ink};text-shadow:none}
.hx-tag-cream{background:${UI.cream};color:${UI.ink};text-shadow:none;transform:none;letter-spacing:.02em}

/* Campaign coins row (run result, lost battle). */
.hx-coins{display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:16px;background:rgba(255,197,49,.16);
  border:2.5px dashed rgba(178,122,0,.45);font-size:17px;font-weight:700}
.hx-coins>span:first-child{display:flex}
.hx-coins b{font-size:24px;color:#a86b00}
.hx-coins .hx-coins-total{margin-left:auto;min-height:32px;padding:2px 10px;font-size:15px}

/* Chips: heart + HP bar, coin + gold. */
.hx-chip{display:inline-flex;align-items:center;gap:6px;box-sizing:border-box;min-height:40px;padding:3px 12px 3px 5px;border-radius:999px;
  border:3px solid ${UI.ink};background:${UI.cream};color:${UI.ink};box-shadow:0 3px 0 ${UI.ink};font-size:17px;font-weight:700;white-space:nowrap}
.hx-chip>svg{flex:none}
.hx-chip.hx-hp{flex:1 1 170px;min-width:0;max-width:280px}
.hx-chip .hx-delta{font-size:15px}
.hx-neg{color:#c0322a}
.hx-pos{color:#2c8a3a}
.hx-lead .hx-delta{font-size:24px}
.hx-bar{position:relative;flex:1;min-width:48px;height:14px;border-radius:8px;border:2.5px solid ${UI.ink};background:#5a3a22;overflow:hidden;
  box-shadow:inset 0 2px 0 rgba(0,0,0,.35)}
.hx-bar>i{position:absolute;left:0;top:0;bottom:0;border-radius:0 5px 5px 0}
.hx-bar .hx-fill{background:linear-gradient(#7ad66f,${UI.green});box-shadow:inset 0 2px 0 rgba(255,255,255,.35)}
.hx-bar.hx-warn .hx-fill{background:linear-gradient(#ffe07a,#e6a91a)}
.hx-bar.hx-low .hx-fill{background:linear-gradient(#ff8c80,${UI.red})}
.hx-bar .hx-heal{background:repeating-linear-gradient(135deg,#bdf3a8 0 5px,#8fdc7c 5px 10px)}
.hx-bar .hx-loss{background:repeating-linear-gradient(135deg,#ff9b90 0 5px,#e5483d 5px 10px);opacity:.9}
.hx-bar.hx-big{height:22px;border-width:3px;border-radius:12px}

/* ----- Upgrade card (pick, shop) ----- */
.hx-list{display:flex;flex-direction:column;gap:14px;margin-top:6px}
.hx-up{--face:#fff;--edge:#3f78c8;position:relative;box-sizing:border-box;display:grid;grid-template-columns:64px 1fr;gap:12px;align-items:start;
  width:100%;min-height:96px;padding:14px 14px 12px 12px;margin:0;border:3.5px solid ${UI.ink};border-radius:18px;text-align:left;color:${UI.ink};
  background:linear-gradient(180deg,#fffdf7 0%,var(--face) 100%);
  box-shadow:inset 0 -3px 0 rgba(0,0,0,.06),0 5px 0 -0.5px #cdb48a,0 5px 0 3px ${UI.ink},0 10px 12px rgba(20,10,2,.28);
  transition:transform 90ms cubic-bezier(.3,1.6,.6,1)}
button.hx-up{cursor:pointer}
button.hx-up:active{transform:translateY(3px)}
.hx-up:focus-visible{outline:3px solid ${UI.yellow};outline-offset:4px}
.hx-up[aria-pressed=true]{background:linear-gradient(180deg,#fffbe0 0%,#ffe9a0 100%);
  box-shadow:0 0 0 4px ${UI.yellow},0 5px 0 1px ${UI.ink},0 0 22px 6px rgba(255,197,49,.6)}
.hx-up-ico{width:64px;height:64px;display:block}
.hx-up-ico svg{width:64px;height:64px;display:block}
.hx-up-body{display:flex;flex-direction:column;gap:4px;min-width:0;padding-right:4px}
.hx-up-name{font-size:20px;font-weight:700;line-height:1.1;padding-right:60px}
.hx-up-text{font-size:16px;font-weight:600;line-height:1.3;color:#3d2c1d}
.hx-up-bad{font-size:15px;font-weight:700;line-height:1.3;color:#c0322a}
.hx-up-tags{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:2px}
.hx-pill{display:inline-flex;align-items:center;padding:2px 9px 3px;border-radius:999px;border:2px solid ${UI.ink};font-size:13px;font-weight:700;
  line-height:1.15;letter-spacing:.03em;background:#f0dfbd;color:${UI.ink}}
.hx-pill.hx-owned{background:${UI.ink};color:${UI.cream}}
.hx-ribbon{position:absolute;top:-11px;right:12px;padding:3px 10px 4px;border-radius:9px;border:2.5px solid ${UI.ink};background:var(--edge);
  color:#fff;text-shadow:${outlineShadow(1.3)};font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
  box-shadow:0 2px 0 ${UI.ink};transform:rotate(3deg)}
.hx-up .hx-check{position:absolute;left:-10px;top:-10px;width:30px;height:30px;display:none}
.hx-up .hx-check svg{width:30px;height:30px}
.hx-up[aria-pressed=true] .hx-check{display:block}
.hx-up.hx-sold{filter:saturate(.3);opacity:.7}
.hx-stamp{position:absolute;right:16px;top:50%;margin-top:-20px;padding:4px 12px;border:4px solid #c0322a;border-radius:10px;color:#c0322a;
  font-size:24px;font-weight:700;letter-spacing:.12em;transform:rotate(-12deg);background:rgba(255,246,227,.7);pointer-events:none}
.hx-buyrow{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:6px}

/* Price tag button. */
.hx-price{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-width:96px;min-height:48px;padding:0 14px 0 8px;
  border:3px solid ${UI.ink};border-radius:14px;background:linear-gradient(#ffd862,${UI.yellow});color:${UI.ink};font-size:20px;font-weight:700;
  box-shadow:0 4px 0 #b27a00,0 4px 0 3px ${UI.ink};cursor:pointer;transition:transform 90ms cubic-bezier(.3,1.6,.6,1)}
.hx-price:active{transform:translateY(4px);box-shadow:0 0 0 #b27a00,0 0 0 3px ${UI.ink}}
.hx-price[disabled]{background:#d8d0c2;color:#7d7266;box-shadow:0 4px 0 #9a9184,0 4px 0 3px ${UI.ink};cursor:default}
.hx-price[disabled]:active{transform:none}
.hx-price[disabled] svg{filter:grayscale(1);opacity:.6}

/* Heal row / panels on dashed paper. */
.hx-paper{border-radius:16px;background:rgba(214,186,138,.22);border:2.5px dashed rgba(122,79,46,.4);padding:10px 12px}
.hx-heal{display:grid;grid-template-columns:48px 1fr auto;align-items:center;gap:10px;text-align:left}
.hx-heal b{display:block;font-size:18px}
.hx-heal span{font-size:15px;font-weight:600;color:#6b5440}

/* Stats list (result, start). */
.hx-stats{list-style:none;margin:0;display:flex;flex-direction:column;gap:2px;text-align:left}
.hx-stats li{display:flex;justify-content:space-between;align-items:center;min-height:32px;font-size:17px;font-weight:600}
.hx-stats li b{font-weight:700}
.hx-tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.hx-tile{display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 4px;border-radius:14px;border:2.5px solid ${UI.ink};background:#f6e8cb;
  box-shadow:0 3px 0 ${UI.ink}}
.hx-tile b{font-size:22px;line-height:1.1}
.hx-tile span{font-size:13px;font-weight:700;color:#6b5440;letter-spacing:.03em}

/* Score and the NEW BEST stamp. */
.hx-score{position:relative;display:flex;flex-direction:column;align-items:center;gap:2px;padding:4px 0}
.hx-score span{font-size:15px;font-weight:700;letter-spacing:.1em;color:#6b5440}
.hx-score b{font-size:52px;line-height:1;font-weight:700}
.hx-score .hx-best{font-size:16px;font-weight:600;letter-spacing:0;color:#6b5440}
.hx-newbest{position:absolute;right:-6px;top:-10px;padding:4px 10px;border-radius:10px;border:3px solid ${UI.ink};
  background:linear-gradient(#ffd862,${UI.yellow});box-shadow:0 3px 0 ${UI.ink};font-size:15px;font-weight:700;letter-spacing:.06em;transform:rotate(8deg)}
.hx-ov.hx-on .hx-newbest{animation:hx-stamp 150ms 120ms cubic-bezier(.3,1.5,.6,1) both}
@keyframes hx-stamp{0%{transform:rotate(8deg) scale(1.4);opacity:0}100%{transform:rotate(8deg) scale(1);opacity:1}}

/* Icon rows with stack badges (result, map strip). */
.hx-icons{display:flex;flex-wrap:wrap;justify-content:center;gap:8px}
.hx-own{position:relative;flex:none;display:block;width:48px;height:48px;padding:0;margin:0;border:0;background:none;cursor:pointer}
.hx-own svg{width:48px;height:48px;display:block}
.hx-own[aria-pressed=true] svg{filter:drop-shadow(0 0 5px ${UI.yellow}) drop-shadow(0 0 2px ${UI.yellow})}
.hx-own i{position:absolute;right:-5px;bottom:-4px;min-width:22px;padding:1px 4px;box-sizing:border-box;border-radius:999px;border:2px solid ${UI.ink};
  background:${UI.yellow};color:${UI.ink};font-size:12px;font-weight:700;font-style:normal;line-height:1.2;text-align:center}

/* Two-line sticker buttons (start screen). */
.hx-btn2{flex-direction:column;gap:5px;min-height:76px;padding:8px 16px}
.hx-btn2 small{font-size:15px;font-weight:600;letter-spacing:0;opacity:.95}
.tb-btn.tb-green.hx-btn2 small,.tb-btn.tb-wood.hx-btn2 small{text-shadow:${outlineShadow(1.4)}}

/* Rest: a campfire glowing in the dark. */
.hx-fire{align-self:center;width:150px;height:150px;border-radius:50%;border:4px solid ${UI.ink};display:flex;align-items:center;justify-content:center;
  background:radial-gradient(60% 55% at 50% 62%,rgba(255,170,60,.85),rgba(255,120,40,.25) 55%,transparent 75%),radial-gradient(circle at 50% 40%,#3a4880,#1b2147);
  box-shadow:inset 0 -6px 0 rgba(0,0,0,.25),0 6px 0 ${UI.ink},0 0 40px rgba(255,150,50,.45)}
.hx-fire svg{width:112px;height:112px}
.hx-hprow{display:flex;align-items:center;gap:10px}
.hx-hprow svg{flex:none}
.hx-hprow .hx-bar{flex:1}
.hx-hprow b{min-width:88px;text-align:right;font-size:18px}

/* ----- Run map ----- */
.hx-map{position:fixed;inset:0;height:var(--app-h);z-index:11;display:none;flex-direction:column;background:${FELT_BG};color:${UI.cream}}
.hx-map.hx-on{display:flex}
.hx-head{position:relative;z-index:3;flex:none;display:flex;flex-direction:column;gap:8px;background:${WOOD_BG};border-bottom:4px solid ${UI.ink};
  box-shadow:inset 0 -4px 0 rgba(0,0,0,.25),0 6px 10px rgba(10,20,10,.45);
  padding:max(10px,calc(env(safe-area-inset-top) + 6px)) max(12px,env(safe-area-inset-right)) 10px max(12px,env(safe-area-inset-left))}
.hx-row{display:flex;align-items:center;gap:10px}
.hx-row>.tb-btn{flex:none;width:52px;min-height:50px;padding:0;margin:0 0 5px}
.hx-title{flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:2px}
.hx-title h1{margin:0;font-size:24px;font-weight:700;line-height:1.1;color:${UI.cream};text-shadow:${outlineShadow(2.2)};padding:2px}
.hx-title p{margin:0;font-size:14px;font-weight:600;color:#f3dcb0;text-shadow:${outlineShadow(1.4)}}
.hx-strip{display:flex;align-items:center;gap:10px;min-height:56px;overflow-x:auto;overflow-y:hidden;touch-action:pan-x;scrollbar-width:none;
  margin:0 -12px -10px;padding:6px 14px 10px;background:rgba(20,10,4,.28);border-top:2px solid rgba(0,0,0,.25)}
.hx-strip::-webkit-scrollbar{display:none}
.hx-strip .hx-empty{font-size:15px;font-weight:600;color:#f3dcb0;text-shadow:${outlineShadow(1.4)};white-space:nowrap}
.hx-tip{position:absolute;left:12px;right:12px;top:calc(100% + 8px);z-index:4;display:none;grid-template-columns:48px 1fr;gap:10px;padding:12px 14px;
  text-align:left;border-radius:18px;max-width:420px;margin:0 auto}
.hx-tip.hx-on{display:grid;animation:hx-in 120ms cubic-bezier(.3,1.4,.6,1) both}
.hx-tip svg{width:48px;height:48px}
.hx-tip b{display:block;font-size:18px;line-height:1.15}
.hx-tip p{margin:3px 0 0;font-size:15px;font-weight:600;line-height:1.3}
.hx-tip .hx-up-bad{display:block;margin-top:3px}
.hx-board{position:relative;flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;touch-action:pan-y;overscroll-behavior:contain;
  -webkit-overflow-scrolling:touch;padding:0 env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}
.hx-track{position:relative;margin:12px auto 100px;width:calc(100% - 16px);max-width:460px}
.hx-track::before{content:'';position:absolute;inset:0;border-radius:24px;border:2.5px dashed rgba(255,246,227,.28);pointer-events:none}
.hx-track>svg{position:absolute;left:0;top:0;pointer-events:none}
.hx-node{position:absolute;padding:0;margin:0;border:0;background:none;color:#fff;cursor:pointer;border-radius:50%}
.hx-node[data-available=false]{cursor:default}
.hx-disc{--c1:#a5dc84;--c2:${UI.army};--c3:${UI.armyDark};--edge:#1f3f1a;--rim:${UI.ink};
  position:relative;display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:100%;height:100%;border-radius:50%;
  border:4px solid ${UI.ink};background:radial-gradient(60% 50% at 34% 26%,rgba(255,255,255,.55),transparent 60%),
  radial-gradient(90% 90% at 40% 35%,var(--c1),var(--c2) 55%,var(--c3));
  box-shadow:inset 0 0 0 3px var(--rim),inset 0 -5px 0 rgba(0,0,0,.2),0 5px 0 var(--edge),0 5px 0 4px ${UI.ink},0 12px 12px rgba(5,15,8,.45);
  transition:transform 90ms cubic-bezier(.3,1.6,.6,1)}
.hx-disc svg{width:66%;height:66%}
.hx-k-elite .hx-disc{--c1:#7d5c4a;--c2:#4a3022;--c3:#24150c;--edge:#120a05;--rim:${UI.red};box-shadow:inset 0 0 0 5px ${UI.red},inset 0 -5px 0 rgba(0,0,0,.2),0 5px 0 #120a05,0 5px 0 4px ${UI.ink},0 12px 12px rgba(5,15,8,.45)}
.hx-k-shop .hx-disc{--c1:#a8d6f7;--c2:#3d8fd6;--c3:#245e99;--edge:#163d66}
.hx-k-rest .hx-disc{--c1:#7d8fca;--c2:#34427a;--c3:#1d2550;--edge:#10163a}
.hx-k-boss .hx-disc{--c1:#ffffff;--c2:${UI.tin};--c3:${UI.tinDark};--edge:#3a4148;
  background:radial-gradient(60% 50% at 34% 26%,rgba(255,255,255,.75),transparent 60%),
    radial-gradient(circle at 50% 9%,#59616a 0 2.5px,transparent 3px),radial-gradient(circle at 91% 50%,#59616a 0 2.5px,transparent 3px),
    radial-gradient(circle at 50% 91%,#59616a 0 2.5px,transparent 3px),radial-gradient(circle at 9% 50%,#59616a 0 2.5px,transparent 3px),
    radial-gradient(90% 90% at 40% 35%,var(--c1),var(--c2) 55%,var(--c3))}
.hx-node .hx-label{position:absolute;left:50%;top:calc(100% + 9px);transform:translateX(-50%);max-width:${LABEL_W}px;box-sizing:border-box;overflow:hidden;text-overflow:ellipsis;padding:2px 8px 3px;
  border-radius:9px;border:2.5px solid ${UI.ink};background:${UI.cream};color:${UI.ink};box-shadow:0 2px 0 ${UI.ink};
  font-size:13px;font-weight:700;line-height:1.15;white-space:nowrap;pointer-events:none}
.hx-k-elite .hx-label{background:linear-gradient(#f26a5f,${UI.red});color:#fff;text-shadow:${outlineShadow(1.2)}}
.hx-k-boss .hx-label{top:auto;bottom:calc(100% + 4px);max-width:none;background:linear-gradient(#f26a5f,${UI.red});color:#fff;
  text-shadow:${outlineShadow(1.2)};letter-spacing:.04em;transform:translateX(-50%) rotate(-3deg)}
.hx-node:active[data-available=true] .hx-disc{transform:translateY(4px) scale(.97)}
.hx-node.hx-avail .hx-disc{animation:hx-pulse 1500ms ease-in-out infinite}
.hx-node.hx-avail .hx-disc::after{content:'';position:absolute;inset:-11px;border-radius:50%;border:4px solid rgba(255,230,140,.95);
  box-shadow:0 0 14px rgba(255,214,90,.85);animation:hx-glow 1500ms ease-in-out infinite;pointer-events:none}
@keyframes hx-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.07)}}
@keyframes hx-glow{0%,100%{opacity:.35}50%{opacity:1}}
.hx-node.hx-sel .hx-disc{animation:none;transform:scale(1.08)}
.hx-node.hx-sel .hx-disc::after{animation:none;opacity:1;border-color:${UI.yellow};border-width:5px}
.hx-node.hx-visited .hx-disc{filter:saturate(.35) brightness(.88)}
.hx-node.hx-gone{opacity:.5}
.hx-node.hx-gone .hx-disc{filter:saturate(.25)}
.hx-node .hx-tick{position:absolute;right:-8px;top:-8px;width:28px;height:28px}
.hx-node .hx-tick svg{width:28px;height:28px;display:block}
.hx-node .hx-label.hx-you{display:flex;align-items:center;gap:3px;padding-left:4px;background:linear-gradient(#ffe27a,${UI.yellow});color:${UI.ink};text-shadow:none}
.hx-node .hx-label.hx-you svg{width:18px;height:18px}
.hx-node.hx-here .hx-disc::after{content:'';position:absolute;inset:-11px;border-radius:50%;border:5px solid ${UI.yellow};
  box-shadow:0 0 0 2px ${UI.ink},0 0 16px rgba(255,214,90,.8);pointer-events:none}

/* Go confirm chip (bottom, in thumb reach) and the overflow menu. */
.hx-go{position:absolute;left:max(12px,env(safe-area-inset-left));right:max(12px,env(safe-area-inset-right));
  bottom:max(14px,calc(env(safe-area-inset-bottom) + 10px));z-index:5;display:none;grid-template-columns:56px 1fr auto;align-items:center;gap:12px;
  max-width:440px;margin:0 auto;padding:10px 12px 10px 10px;border-radius:22px;text-align:left}
.hx-go.hx-on{display:grid;animation:hx-in 120ms cubic-bezier(.3,1.4,.6,1) both}
.hx-go .hx-mini{width:56px;height:56px}
.hx-go b{display:block;font-size:20px;line-height:1.1}
.hx-go>div>span{display:block;font-size:15px;font-weight:600;line-height:1.25;color:#6b5440}
.hx-go .tb-btn{width:auto;min-width:96px;margin:0 0 6px}
.hx-menu{position:absolute;right:max(12px,env(safe-area-inset-right));top:calc(100% + 8px);z-index:5;display:none;padding:10px;border-radius:18px;width:220px}
.hx-menu.hx-on{display:block;animation:hx-in 120ms cubic-bezier(.3,1.4,.6,1) both}
.hx-menu .tb-btn{margin:0 0 6px}
.hx-ask{position:absolute;inset:0;z-index:6;display:none;align-items:center;justify-content:center;${SAFE_PAD}box-sizing:border-box}
.hx-ask.hx-on{display:flex}
.hx-ask .hx-card{color:${UI.ink};animation:hx-in 120ms cubic-bezier(.3,1.4,.6,1) both;padding-top:20px}

@media (prefers-reduced-motion: reduce){
  .hx-ov.hx-on .hx-card,.hx-tip.hx-on,.hx-go.hx-on,.hx-menu.hx-on,.hx-ask .hx-card,.hx-ov.hx-on .hx-newbest{animation:none}
  .hx-node.hx-avail .hx-disc,.hx-node.hx-avail .hx-disc::after{animation:none}
  .hx-node.hx-avail .hx-disc::after{opacity:.9}
  .hx-up,.hx-price,.hx-disc{transition:none}
}
`;

let injected = false;
export function injectExpeditionStyles(): void {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  injectUiTheme();
  const style = document.createElement('style');
  style.dataset.tb = 'expedition';
  style.textContent = CSS;
  document.head.appendChild(style);
}
