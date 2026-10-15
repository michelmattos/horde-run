// The Expedition run state machine (concept §4.2). Every step takes a RunState and returns
// a new one; nothing is mutated. Every random draw is seeded from the run seed plus a salt
// naming the node and purpose, so a run resumed from storage sees the same offers and stock.
import type { RunBattleSpec, RunNode, RunPhase, RunState, ShopItem } from '../contracts.ts';
import { createRng, seedFromString } from '../core/rng.ts';
import type { Rng } from '../core/rng.ts';
import { availableNodes, generateRunMap, getNode, isCombatKind } from './map.ts';
import { RARITY_PRICE, drawOffer, getUpgrade } from './upgrades.ts';

type CombatKind = RunBattleSpec['kind'];

export const RUN_RULES = Object.freeze({
  maxHp: 100,
  startGold: 30,
  winHpCost: { battle: 30, elite: 35, boss: 30 } as Readonly<Record<CombatKind, number>>, // x fort HP fraction lost
  // A lost boss costs less: the retry is the same fight, so a run gets about three tries.
  lossHpCost: { battle: 30, elite: 40, boss: 30 } as Readonly<Record<CombatKind, number>>,
  restHealFraction: 0.3,
  shopHealAmount: 25,
  shopHealPrice: 35,
  shopItems: 3,
  chestGold: 1.5,
  fortMaxHp: 20, // Sturdy Fort: +max HP and heal, per stack
});

function rngFor(run: RunState, nodeId: string, purpose: string): Rng {
  return createRng(seedFromString(`${run.seed}:${nodeId}:${purpose}`));
}

function expectPhase(run: RunState, phase: RunPhase, fn: string): void {
  if (run.phase !== phase) throw new Error(`${fn}: run is in phase '${run.phase}', expected '${phase}'`);
}

function currentNode(run: RunState): RunNode {
  const node = run.at === undefined ? undefined : getNode(run.map, run.at);
  if (!node) throw new Error('run has no current node');
  return node;
}

function clone(run: RunState): RunState {
  return structuredClone(run);
}

export function newRun(seed: number, opts: { daily?: string } = {}): RunState {
  const run: RunState = {
    version: 1,
    seed,
    map: generateRunMap(seed),
    visited: [],
    hp: RUN_RULES.maxHp,
    maxHp: RUN_RULES.maxHp,
    gold: RUN_RULES.startGold,
    upgrades: {},
    phase: 'map',
    stats: { battlesWon: 0, battlesLost: 0, goldEarned: 0, hpLost: 0, seconds: 0 },
    outcome: 'active',
  };
  if (opts.daily !== undefined) run.daily = opts.daily;
  return run;
}

function drawShop(run: RunState, nodeId: string): NonNullable<RunState['shop']> {
  const rng = rngFor(run, nodeId, 'shop');
  const items: ShopItem[] = drawOffer(rng.next, run.upgrades, { count: RUN_RULES.shopItems }).map((upgradeId) => {
    const base = RARITY_PRICE[getUpgrade(upgradeId)?.rarity ?? 'common'];
    const price = Math.max(5, Math.round((base * (0.9 + 0.2 * rng.next())) / 5) * 5);
    return { upgradeId, price, sold: false };
  });
  return { items, healPrice: RUN_RULES.shopHealPrice, healAmount: RUN_RULES.shopHealAmount, healed: false };
}

export function chooseNode(run: RunState, nodeId: string): RunState {
  if (!availableNodes(run).includes(nodeId)) throw new Error(`chooseNode: '${nodeId}' is not available`);
  const node = getNode(run.map, nodeId);
  if (!node) throw new Error(`chooseNode: unknown node '${nodeId}'`);
  const next = clone(run);
  next.visited.push(nodeId);
  next.at = nodeId;
  delete next.offer;
  delete next.shop;
  delete next.lastBattle;
  if (isCombatKind(node.kind)) next.phase = 'battle';
  else if (node.kind === 'shop') {
    next.phase = 'shop';
    next.shop = drawShop(run, nodeId);
  } else next.phase = 'rest';
  return next;
}

// What the battle generator needs for the current node (phase 'battle').
export function battleSpec(run: RunState): RunBattleSpec {
  expectPhase(run, 'battle', 'battleSpec');
  const node = currentNode(run);
  if (!isCombatKind(node.kind)) throw new Error(`battleSpec: node '${node.id}' is not a battle`);
  const fights = run.visited.filter((id) => {
    const n = getNode(run.map, id);
    return n !== undefined && isCombatKind(n.kind);
  }).length;
  return {
    seed: seedFromString(`${run.seed}:${node.id}:battle`),
    kind: node.kind,
    index: Math.max(0, fights - 1),
  };
}

// Gold for a won battle: battle 20+int(10)+5*index, elite and boss 45+int(15)+5*index; War Chest x1.5.
function battleGold(run: RunState, spec: RunBattleSpec, nodeId: string): number {
  const rng = rngFor(run, nodeId, 'gold');
  const base = spec.kind === 'battle' ? 20 + rng.int(10) : 45 + rng.int(15);
  const gold = base + 5 * spec.index;
  return (run.upgrades.chest ?? 0) > 0 ? Math.round(gold * RUN_RULES.chestGold) : gold;
}

export function finishBattle(
  run: RunState,
  r: { victory: boolean; baseHpFraction: number; seconds: number },
): RunState {
  const spec = battleSpec(run);
  const node = currentNode(run);
  const next = clone(run);
  const lostFraction = Math.min(1, Math.max(0, 1 - (Number.isFinite(r.baseHpFraction) ? r.baseHpFraction : 0)));
  const cost = r.victory ? Math.round(RUN_RULES.winHpCost[spec.kind] * lostFraction) : RUN_RULES.lossHpCost[spec.kind];
  const hpLost = Math.min(run.hp, cost);
  const gold = r.victory ? battleGold(run, spec, node.id) : 0;

  next.hp = run.hp - hpLost;
  next.gold = run.gold + gold;
  next.stats.hpLost += hpLost;
  next.stats.goldEarned += gold;
  next.stats.seconds += Math.max(0, Number.isFinite(r.seconds) ? r.seconds : 0);
  if (r.victory) next.stats.battlesWon += 1;
  else next.stats.battlesLost += 1;
  next.lastBattle = { victory: r.victory, hpLost, gold };

  if (next.hp <= 0) {
    next.hp = 0;
    next.outcome = 'lost';
    next.phase = 'over';
  } else if (r.victory && spec.kind === 'boss') {
    next.outcome = 'won';
    next.phase = 'over';
  } else if (r.victory) {
    const offer = drawOffer(rngFor(run, node.id, 'offer').next, run.upgrades, { elite: spec.kind === 'elite' });
    // With every upgrade maxed there is nothing to pick, so go straight back to the map.
    next.phase = offer.length > 0 ? 'pick' : 'map';
    if (offer.length > 0) next.offer = offer;
  } else {
    // A lost boss is retried (same node, same battle) while HP remains.
    next.phase = spec.kind === 'boss' ? 'battle' : 'map';
  }
  return next;
}

// Adds one stack and applies run-level effects (Sturdy Fort: max HP +20 and heal 20).
function gainUpgrade(run: RunState, id: string): void {
  run.upgrades[id] = (run.upgrades[id] ?? 0) + 1;
  if (id === 'fort') {
    run.maxHp += RUN_RULES.fortMaxHp;
    run.hp = Math.min(run.maxHp, run.hp + RUN_RULES.fortMaxHp);
  }
}

// Takes one offered upgrade, or skips with null.
export function pickUpgrade(run: RunState, id: string | null): RunState {
  expectPhase(run, 'pick', 'pickUpgrade');
  if (id !== null && !(run.offer ?? []).includes(id)) throw new Error(`pickUpgrade: '${id}' is not on offer`);
  const next = clone(run);
  if (id !== null) gainUpgrade(next, id);
  delete next.offer;
  next.phase = 'map';
  return next;
}

// Buys shop item `index`. Returns the same run unchanged when it cannot be bought.
export function buyItem(run: RunState, index: number): RunState {
  const item = run.phase === 'shop' ? run.shop?.items[index] : undefined;
  if (!item || item.sold || run.gold < item.price) return run;
  const def = getUpgrade(item.upgradeId);
  if (!def || (run.upgrades[def.id] ?? 0) >= def.maxStacks) return run;
  const next = clone(run);
  next.gold -= item.price;
  next.shop!.items[index].sold = true;
  gainUpgrade(next, def.id);
  return next;
}

// Buys the shop's one heal. Same run unchanged when gold is short, it was bought, or HP is full.
export function buyHeal(run: RunState): RunState {
  const shop = run.phase === 'shop' ? run.shop : undefined;
  if (!shop || shop.healed || run.gold < shop.healPrice || run.hp >= run.maxHp) return run;
  const next = clone(run);
  next.gold -= shop.healPrice;
  next.hp = Math.min(next.maxHp, next.hp + shop.healAmount);
  next.shop!.healed = true;
  return next;
}

export function leaveShop(run: RunState): RunState {
  expectPhase(run, 'shop', 'leaveShop');
  const next = clone(run);
  delete next.shop;
  next.phase = 'map';
  return next;
}

export function restHeal(run: RunState): RunState {
  expectPhase(run, 'rest', 'restHeal');
  const next = clone(run);
  next.hp = Math.min(next.maxHp, next.hp + Math.round(next.maxHp * RUN_RULES.restHealFraction));
  next.phase = 'map';
  return next;
}

export function abandonRun(run: RunState): RunState {
  if (run.phase === 'over') return run;
  const next = clone(run);
  delete next.offer;
  delete next.shop;
  next.outcome = 'lost';
  next.phase = 'over';
  return next;
}

export function runScore(run: RunState): number {
  return run.stats.battlesWon * 100 + run.hp * 2 + run.gold + (run.outcome === 'won' ? 1000 : 0);
}

// The Daily run: one seed per local calendar date.
export function dailySeed(d: Date): { seed: number; daily: string } {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const daily = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { seed: seedFromString(`daily:${daily}`), daily };
}

// Impure on purpose: the one place a new run seed comes from Math.random. 1 .. 2^31-1.
export function randomRunSeed(): number {
  return 1 + Math.floor(Math.random() * 0x7ffffffe);
}
