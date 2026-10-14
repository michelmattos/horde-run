// Expedition screens (concept 4.2): start, run map, upgrade pick, shop, rest, lost
// battle and run result, as plain HTML in the toy-box sticker style. Each screen's
// container is built once and toggled; show* refills it with the data it is given and
// hides the others. Terminal callbacks hide the screens first and fire at most once per
// show; shop purchases keep the shop up (show it again with the new data). The screens
// hold no run rules: the integration reads the run and wires the callbacks.
import type { UpgradeDef } from '../../contracts.ts';
import { mapIcon, nextIcon, playIcon, retryIcon, tickIcon } from '../icons.ts';
import { formatTime } from '../uiLogic.ts';
import { button, button2, el, goldChip, hpBar, hpChip, iconSpan, ownedIcon, upgradeCard } from './dom.ts';
import { backSvg, coinSvg, heartSvg, nodeIconSvg } from './icons.ts';
import { countUp, formatDailyDate, formatGold, formatHp, healPreview, priceState } from './layout.ts';
import { createMapScreen } from './mapScreen.ts';
import { injectExpeditionStyles } from './styles.ts';
import type { ExpeditionScreens } from './types.ts';

export type {
  BattleLostOptions,
  ExpeditionScreens,
  MapOptions,
  OwnedUpgrade,
  PickOptions,
  RestOptions,
  RunResultOptions,
  ShopOptions,
  StartOptions,
} from './types.ts';
export { RARITY_COLORS, nodeIconSvg, upgradeIconSvg } from './icons.ts';
export { runMapLayout } from './layout.ts';

const COUNT_UP_MS = 150;

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// A full-screen scrolling layer holding one cream card; `felt` puts it on the play mat,
// otherwise it dims what is behind (the battlefield after a fight).
function panel(parent: HTMLElement, felt: boolean, label: string): { root: HTMLDivElement; card: HTMLDivElement } {
  const root = el('div', `hx-root hx-ov ${felt ? 'hx-felt' : 'tb-backdrop'}`);
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', label);
  const wrap = el('div', 'hx-wrap');
  const card = el('div', 'hx-card tb-card');
  wrap.append(card);
  root.append(wrap);
  parent.appendChild(root);
  return { root, card };
}

function banner(title: string, tone: '' | 'hx-gold' | 'hx-pink', sub?: string, huge = false): HTMLDivElement {
  const b = el('div', 'hx-banner');
  b.append(el('h1', `hx-h ${tone}${huge ? ' hx-huge' : ''}`.trim(), title));
  if (sub) b.append(el('p', 'hx-sub', sub));
  return b;
}

function delta(text: string, cls: 'hx-neg' | 'hx-pos'): HTMLSpanElement {
  return el('span', `hx-delta ${cls}`, text);
}

export function createExpeditionScreens(root: HTMLElement): ExpeditionScreens {
  injectExpeditionStyles();

  let current: HTMLElement | null = null;
  let countRaf = 0;

  function hide(): void {
    cancelAnimationFrame(countRaf);
    if (current === mapScreen.root) mapScreen.hide();
    else current?.classList.remove('hx-on');
    current = null;
    // Drop focus so keys go back to the game.
    if (document.activeElement instanceof HTMLElement && root.contains(document.activeElement))
      document.activeElement.blur();
  }
  const done = (fn: () => void): void => {
    hide();
    fn();
  };
  const show = (node: HTMLElement): void => {
    if (current && current !== node) hide();
    current = node;
    node.classList.add('hx-on');
    node.scrollTop = 0;
  };

  const mapScreen = createMapScreen(root, done);
  const start = panel(root, true, 'Expedition');
  const pick = panel(root, false, 'Choose an upgrade');
  const shop = panel(root, true, 'Shop');
  const rest = panel(root, true, 'Campfire');
  const lost = panel(root, false, 'Battle lost');
  const result = panel(root, true, 'Run result');

  return {
    showStart(o) {
      const { card } = start;
      const resume = o.resume;
      const onResume = o.onResume;
      const kids: HTMLElement[] = [
        banner('Expedition', 'hx-gold', 'A seeded run across World 1'),
        el('p', 'hx-sub', 'Four fights, two stops, then the Tin General. Run HP and gold carry over.'),
      ];
      const stack = el('div', 'hx-stack');
      if (resume && onResume) {
        const r = button2('tb-green', 'resume');
        const parts = [
          `HP ${formatHp(resume.hp, resume.maxHp)}`,
          `${formatGold(resume.gold)} gold`,
          `${resume.battlesWon} won`,
        ];
        if (resume.daily) parts.push(`Daily ${formatDailyDate(resume.daily)}`);
        r.set('Resume run', parts.join(' · '));
        r.btn.addEventListener('click', () => done(onResume));
        stack.append(r.btn);
      }
      const n = button2('tb-yellow tb-big', 'new');
      n.set('New run', 'Random map');
      n.btn.addEventListener('click', () => done(() => o.onNew()));
      const d = button2('tb-wood', 'daily');
      const date = formatDailyDate(o.dailyDate);
      d.set(
        'Daily run',
        o.dailyBest !== undefined ? `${date} · Best ${formatGold(o.dailyBest)}` : `${date} · No score yet`,
      );
      d.btn.addEventListener('click', () => done(() => o.onDaily()));
      stack.append(n.btn, d.btn);
      kids.push(stack);

      const tiles = el('div', 'hx-tiles');
      for (const [v, label] of [
        [formatGold(o.runsPlayed), 'RUNS'],
        [formatGold(o.runsWon), 'WINS'],
        [formatGold(o.bestScore), 'BEST'],
      ] as const) {
        const t = el('div', 'hx-tile');
        t.append(el('b', '', v), el('span', '', label));
        tiles.append(t);
      }
      const back = button('Back', 'tb-small', 'back', backSvg(24));
      back.addEventListener('click', () => done(() => o.onBack()));
      kids.push(tiles, back);
      card.replaceChildren(...kids);
      show(start.root);
    },

    showMap(o) {
      if (current && current !== mapScreen.root) hide();
      current = mapScreen.root;
      mapScreen.show(o);
    },

    showPick(o) {
      const { card } = pick;
      const head = banner(o.title, 'hx-gold');
      if (o.elite) head.append(el('span', 'hx-tag hx-tag-red', 'ELITE REWARD'));
      const chips = el('div', 'hx-chips');
      const hp = hpChip(o.hp, o.maxHp, o.hpLost > 0 ? { from: o.hp, to: o.hp + o.hpLost, kind: 'loss' } : undefined);
      if (o.hpLost > 0) hp.append(delta(`-${Math.round(o.hpLost)}`, 'hx-neg'));
      const gain = delta(`+${formatGold(o.goldGained)}`, 'hx-pos');
      const gold = goldChip(o.gold, o.goldGained > 0 ? gain : undefined);
      chips.append(hp, gold);

      const take = button('Take', 'tb-yellow tb-big', 'take', tickIcon(28));
      take.disabled = true;
      const skip = button('Skip', 'tb-small', 'skip');
      let chosen = '';
      const list = el('div', 'hx-list');
      list.setAttribute('role', 'group');
      list.setAttribute('aria-label', 'Upgrades on offer');
      const cards = o.offer.map((def: UpgradeDef) => {
        const c = upgradeCard(def, o.owned[def.id] ?? 0, true);
        c.addEventListener('click', () => {
          chosen = def.id;
          for (const k of cards) k.setAttribute('aria-pressed', String(k === c));
          take.disabled = false;
        });
        return c;
      });
      list.append(...cards);
      take.addEventListener('click', () => {
        const id = chosen;
        if (id) done(() => o.onPick(id));
      });
      skip.addEventListener('click', () => done(() => o.onSkip()));
      const stack = el('div', 'hx-stack');
      stack.append(take, skip);
      take.hidden = cards.length === 0;
      card.replaceChildren(
        head,
        chips,
        el('p', 'hx-lead', cards.length ? 'Choose an upgrade' : 'Nothing left to offer'),
        list,
        stack,
      );
      show(pick.root);

      // Quick gold count-up (value only; nothing moves).
      const value = gold.querySelector('.hx-gold-v');
      if (value && o.goldGained > 0 && !reducedMotion()) {
        const base = o.gold - o.goldGained;
        const t0 = performance.now();
        const step = (): void => {
          const t = performance.now() - t0;
          value.textContent = formatGold(base + countUp(o.goldGained, t, COUNT_UP_MS));
          if (t < COUNT_UP_MS) countRaf = requestAnimationFrame(step);
        };
        step();
      }
    },

    showShop(o) {
      const { card } = shop;
      const chips = el('div', 'hx-chips');
      chips.append(goldChip(o.gold), hpChip(o.hp, o.maxHp));
      const list = el('div', 'hx-list');
      o.items.forEach((item, i) => {
        const c = upgradeCard(item.def, item.owned, false);
        const state = priceState(item.price, o.gold, item.sold);
        if (state === 'sold') {
          c.classList.add('hx-sold');
          c.append(el('span', 'hx-stamp', 'SOLD'));
        } else {
          const row = el('span', 'hx-buyrow');
          row.style.gridColumn = '1 / -1';
          const price = el('button', 'hx-price');
          price.type = 'button';
          price.dataset.action = 'buy';
          price.dataset.index = String(i);
          price.innerHTML = coinSvg(26);
          price.append(formatGold(item.price));
          price.disabled = state === 'poor';
          price.setAttribute(
            'aria-label',
            state === 'poor'
              ? `${item.def.name}: ${item.price} gold, not enough gold`
              : `Buy ${item.def.name} for ${item.price} gold`,
          );
          price.addEventListener('click', () => {
            price.disabled = true; // no double buy before the shop is shown again
            o.onBuy(i);
          });
          row.append(el('span', 'hx-sub', state === 'poor' ? 'Not enough gold' : ''), price);
          c.append(row);
        }
        list.append(c);
      });

      const heal = el('div', 'hx-paper hx-heal');
      const { gained } = healPreview(o.hp, o.maxHp, o.heal.amount);
      const healText = el('div', '');
      healText.append(
        el('b', '', 'Field repairs'),
        el('span', '', o.heal.done ? 'Fort patched up' : gained > 0 ? `+${gained} run HP` : 'Already at full HP'),
      );
      let healEnd: HTMLElement;
      if (o.heal.done) {
        healEnd = iconSpan('', tickIcon(40));
      } else {
        const hb = el('button', 'hx-price');
        hb.type = 'button';
        hb.dataset.action = 'heal';
        hb.innerHTML = coinSvg(26);
        hb.append(formatGold(o.heal.price));
        hb.disabled = gained <= 0 || o.gold < o.heal.price;
        hb.setAttribute('aria-label', `Heal ${gained} HP for ${o.heal.price} gold`);
        hb.addEventListener('click', () => {
          hb.disabled = true;
          o.onHeal();
        });
        healEnd = hb;
      }
      heal.append(iconSpan('', heartSvg(46)), healText, healEnd);

      const leave = button('Leave shop', 'tb-green tb-big', 'leave', nextIcon(26, '#fff'));
      leave.addEventListener('click', () => done(() => o.onLeave()));
      card.replaceChildren(banner('Shop', 'hx-gold', 'Spend your gold on upgrades'), chips, list, heal, leave);
      const keep = current === shop.root ? shop.root.scrollTop : 0;
      show(shop.root);
      shop.root.scrollTop = keep; // re-shown after a purchase: stay where the player was
    },

    showRest(o) {
      const { card } = rest;
      const { to, gained } = healPreview(o.hp, o.maxHp, o.heal);
      const hpRow = el('div', 'hx-hprow');
      hpRow.append(
        iconSpan('', heartSvg(36)),
        hpBar(o.hp, o.maxHp, { from: o.hp, to, kind: 'heal' }, true),
        el('b', '', gained > 0 ? `${Math.round(o.hp)} → ${Math.round(to)}` : formatHp(o.hp, o.maxHp)),
      );
      const paper = el('div', 'hx-paper');
      paper.append(hpRow);
      const restBtn = button('Rest', 'tb-green tb-big', 'rest', playIcon(26, '#fff'));
      restBtn.addEventListener('click', () => done(() => o.onRest()));
      card.replaceChildren(
        banner('Campfire', 'hx-gold', 'A quiet night by the fire'),
        iconSpan('hx-fire', nodeIconSvg('rest', 112)),
        el('p', 'hx-lead', gained > 0 ? `Rest to heal +${gained} run HP` : 'Your fort is already at full HP'),
        paper,
        restBtn,
      );
      show(rest.root);
    },

    showBattleLost(o) {
      const { card } = lost;
      const hpRow = el('div', 'hx-hprow');
      hpRow.append(
        iconSpan('', heartSvg(36)),
        hpBar(o.hp, o.maxHp, { from: o.hp, to: o.hp + o.hpLost, kind: 'loss' }, true),
        el('b', '', formatHp(o.hp, o.maxHp)),
      );
      const paper = el('div', 'hx-paper');
      paper.append(hpRow);
      const cont = button(
        o.boss ? 'Try the boss again' : 'Continue',
        'tb-yellow tb-big',
        'continue',
        o.boss ? retryIcon(26) : nextIcon(26),
      );
      cont.addEventListener('click', () => done(() => o.onContinue()));
      const lostLine = el('p', 'hx-lead');
      lostLine.append('Run HP ', delta(`-${Math.round(o.hpLost)}`, 'hx-neg'));
      card.replaceChildren(
        banner(
          o.boss ? 'Repelled!' : 'Defeat',
          'hx-pink',
          o.boss ? 'The Tin General holds his fort' : 'Your fort fell this time',
        ),
        lostLine,
        paper,
        el('p', 'hx-sub', o.boss ? 'Regroup and storm him again.' : 'The run goes on. Pick your next stop on the map.'),
        cont,
      );
      show(lost.root);
    },

    showRunResult(o) {
      const { card } = result;
      const won = o.outcome === 'won';
      const head = banner(
        won ? 'Victory!' : 'Defeat',
        won ? 'hx-gold' : 'hx-pink',
        won ? 'The Tin General has fallen' : 'Your expedition ends here',
        true,
      );
      if (o.daily) head.append(el('span', 'hx-tag hx-tag-yellow', `Daily ${formatDailyDate(o.daily)}`));

      const score = el('div', 'hx-score');
      score.append(el('span', '', 'SCORE'), el('b', '', formatGold(o.score)));
      if (o.best !== undefined) score.append(el('span', 'hx-best', `Best ${formatGold(o.best)}`));
      if (o.newBest) score.append(el('span', 'hx-newbest', 'NEW BEST'));

      const stats = el('ul', 'hx-stats hx-paper');
      for (const [label, value] of [
        ['Battles won', String(o.stats.battlesWon)],
        ['Battles lost', String(o.stats.battlesLost)],
        ['Gold earned', formatGold(o.stats.goldEarned)],
        ['Run HP lost', String(Math.round(o.stats.hpLost))],
        ['Run HP left', formatHp(o.hp, o.maxHp)],
        ['Battle time', formatTime(o.stats.seconds)],
      ] as const) {
        const li = el('li', '');
        li.append(el('span', '', label), el('b', '', value));
        stats.append(li);
      }

      const icons = el('div', 'hx-icons');
      for (const u of o.upgrades) icons.append(ownedIcon(u.def, u.stacks, 'span'));
      if (o.upgrades.length === 0) icons.append(el('span', 'hx-sub', 'No upgrades taken'));

      const again = button('New run', 'tb-yellow tb-big', 'new-run', retryIcon(26));
      again.addEventListener('click', () => done(() => o.onNewRun()));
      const toMap = button('World map', 'tb-small', 'map', mapIcon(22));
      toMap.addEventListener('click', () => done(() => o.onMap()));
      const stack = el('div', 'hx-stack');
      stack.append(again, toMap);
      card.replaceChildren(head, score, stats, el('p', 'hx-lead', 'Upgrades taken'), icons, stack);
      show(result.root);
    },

    hide,
    get visible() {
      return current !== null;
    },
  };
}
