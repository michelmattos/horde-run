// The Expedition upgrade pool: 30 data-only definitions (20 from World 1, 5 around ice
// and freezing gates from World 2, 5 around timed gates, belts, saws and shield walls
// from World 3). Ids are save keys, so never rename one. What each upgrade does to a
// battle lives in modifiers.ts; run-level effects (Sturdy Fort) live in run.ts. Text
// lines stay short for phone cards. A World 2 or 3 upgrade sets `icon` to its nearest
// World 1 icon and `iconW2` / `iconW3` to its own sticker, which the UI draws instead.
import type { UpgradeDef, UpgradeRarity } from '../contracts.ts';

export const UPGRADES: readonly UpgradeDef[] = Object.freeze([
  // Gate
  {
    id: 'doubler',
    name: 'Doubler Gate',
    text: 'Adds an x2 gate on your half of the lane.',
    rarity: 'common',
    category: 'gate',
    icon: 'gate-x2',
    maxStacks: 3,
  },
  {
    id: 'supply',
    name: 'Supply Gate',
    text: 'A +2 gate by your cannon; breaks after 120.',
    rarity: 'common',
    category: 'gate',
    icon: 'gate-plus',
    maxStacks: 2,
  },
  {
    id: 'fork',
    name: 'Fork Gates',
    text: 'A left x2 and a right +3 that breaks after 150.',
    rarity: 'rare',
    category: 'gate',
    icon: 'gate-fork',
    maxStacks: 1,
  },
  {
    id: 'tripler',
    name: 'Big Multiplier',
    text: 'Adds a narrow, slowly sliding x3 gate.',
    rarity: 'epic',
    category: 'gate',
    icon: 'gate-x3',
    maxStacks: 1,
  },
  // Mob
  {
    id: 'tough',
    name: 'Thick Plastic',
    text: 'Your soldiers have +25% HP.',
    rarity: 'common',
    category: 'mob',
    icon: 'mob-tough',
    maxStacks: 3,
  },
  {
    id: 'sharp',
    name: 'Sharp Bayonets',
    text: 'Soldiers deal +30% damage to the enemy fort.',
    rarity: 'common',
    category: 'mob',
    icon: 'mob-sharp',
    maxStacks: 3,
  },
  {
    id: 'knights',
    name: 'Knight Escort',
    text: 'Every 10th shot carries a Knight (7th, 5th).',
    rarity: 'rare',
    category: 'mob',
    icon: 'mob-knight',
    maxStacks: 3,
  },
  {
    id: 'reinforce',
    name: 'Reinforcements',
    text: 'Start each battle with 25 soldiers.',
    rarity: 'common',
    category: 'mob',
    icon: 'mob-reinforce',
    maxStacks: 3,
  },
  // Cannon
  {
    id: 'rapid',
    name: 'Oiled Gears',
    text: 'Cannon fires 20% faster.',
    rarity: 'common',
    category: 'cannon',
    icon: 'cannon-rapid',
    maxStacks: 3,
  },
  {
    id: 'scatter',
    name: 'Scatter Barrel',
    text: '+1 soldier per shot, fired in a wider spray.',
    rarity: 'common',
    category: 'cannon',
    icon: 'cannon-scatter',
    maxStacks: 2,
  },
  {
    id: 'burst',
    name: 'Burst Fire',
    text: 'Fires bursts of 3 shots, at 45% fire rate.',
    rarity: 'rare',
    category: 'cannon',
    icon: 'cannon-burst',
    maxStacks: 1,
  },
  {
    id: 'swivel',
    name: 'Swivel Mount',
    text: 'Cannon aims 1 step wider to each side.',
    rarity: 'common',
    category: 'cannon',
    icon: 'cannon-swivel',
    maxStacks: 1,
  },
  // Champion
  {
    id: 'pep',
    name: 'Pep Talk',
    text: 'Champion charges 20% faster.',
    rarity: 'common',
    category: 'champion',
    icon: 'champ-charge',
    maxStacks: 3,
  },
  {
    id: 'rally',
    name: 'Rallying Champion',
    text: '30 soldiers charge out with each Champion.',
    rarity: 'rare',
    category: 'champion',
    icon: 'champ-rally',
    maxStacks: 2,
  },
  {
    id: 'bigchamp',
    name: 'Bigger Champion',
    text: 'Champion +50% HP and damage, Knights +25%.',
    rarity: 'rare',
    category: 'champion',
    icon: 'champ-big',
    maxStacks: 2,
  },
  // Relic
  {
    id: 'overcharge',
    name: 'Overcharged Gates',
    text: 'Every multiplier gate is +1 stronger.',
    drawback: 'Enemy defenders +20% HP.',
    rarity: 'epic',
    category: 'relic',
    icon: 'relic-overcharge',
    maxStacks: 1,
  },
  {
    id: 'glass',
    name: 'Glass Cannon',
    text: 'Cannon fires 40% faster.',
    drawback: 'Your fort has 30% less HP in battle.',
    rarity: 'epic',
    category: 'relic',
    icon: 'relic-glass',
    maxStacks: 1,
  },
  {
    id: 'chest',
    name: 'War Chest',
    text: '+50% gold from battles.',
    drawback: 'Enemy waves are 10% bigger.',
    rarity: 'rare',
    category: 'relic',
    icon: 'relic-chest',
    maxStacks: 1,
  },
  {
    id: 'sapper',
    name: 'Sappers',
    text: 'Enemy towers and walls have 30% less HP.',
    rarity: 'rare',
    category: 'relic',
    icon: 'relic-sapper',
    maxStacks: 1,
  },
  {
    id: 'fort',
    name: 'Sturdy Fort',
    text: 'Run max HP +20, and heal 20 HP now.',
    rarity: 'common',
    category: 'relic',
    icon: 'relic-fort',
    maxStacks: 2,
  },
  // World 2: ice and freezing gates
  {
    id: 'frost-gate',
    name: 'Frost Gate',
    text: 'An x3 gate that ices up for 3 s after 40 cross.',
    rarity: 'rare',
    category: 'gate',
    icon: 'gate-x3',
    iconW2: 'gate-frost',
    maxStacks: 1,
  },
  {
    id: 'rink',
    name: 'Ice Rink',
    text: 'Ice by your cannon: soldiers slide out wide.',
    rarity: 'common',
    category: 'gate',
    icon: 'gate-fork',
    iconW2: 'gate-rink',
    maxStacks: 1,
  },
  {
    id: 'skates',
    name: 'Ice Skates',
    text: 'Soldiers keep 45% (90%) of steering on ice.',
    rarity: 'common',
    category: 'mob',
    icon: 'mob-sharp',
    iconW2: 'mob-skates',
    maxStacks: 2,
  },
  {
    id: 'cocoa',
    name: 'Hot Cocoa',
    text: 'Gates thaw 2x faster and ice up 50% later.',
    drawback: 'Enemy waves +10%, more snowmen and penguins.',
    rarity: 'rare',
    category: 'relic',
    icon: 'relic-overcharge',
    iconW2: 'relic-cocoa',
    maxStacks: 1,
  },
  {
    id: 'avalanche',
    name: 'Avalanche',
    text: 'Champion landings freeze foes 2 s (3 s).',
    rarity: 'rare',
    category: 'champion',
    icon: 'champ-big',
    iconW2: 'champ-avalanche',
    maxStacks: 2,
  },
  // World 3: timed gates, belts, saws and shield walls
  {
    id: 'clockwork',
    name: 'Clockwork Gate',
    text: 'A timed x3 gate; timed gates stay open longer.',
    rarity: 'rare',
    category: 'gate',
    icon: 'gate-x3',
    iconW3: 'gate-clock',
    maxStacks: 1,
  },
  {
    id: 'boots',
    name: 'Rubber Boots',
    text: 'Belts and turntables push you 50% (90%) less.',
    rarity: 'common',
    category: 'mob',
    icon: 'mob-tough',
    iconW3: 'mob-boots',
    maxStacks: 2,
  },
  {
    id: 'sawguard',
    name: 'Saw Guards',
    text: 'Saws do 75% less harm to your soldiers.',
    drawback: 'Enemy defenders and shield walls +25% HP.',
    rarity: 'rare',
    category: 'relic',
    icon: 'relic-fort',
    iconW3: 'relic-sawguard',
    maxStacks: 1,
  },
  {
    id: 'crowbar',
    name: 'Crowbar',
    text: 'Soldiers dent shields; Champion +25% damage.',
    rarity: 'rare',
    category: 'champion',
    icon: 'champ-big',
    iconW3: 'champ-crowbar',
    maxStacks: 1,
  },
  {
    id: 'bankshot',
    name: 'Bank Shot',
    text: 'Every 4th (2nd) shot ricochets; +10% fire rate.',
    rarity: 'common',
    category: 'cannon',
    icon: 'cannon-scatter',
    iconW3: 'cannon-bank',
    maxStacks: 2,
  },
] satisfies UpgradeDef[]);

const BY_ID = new Map(UPGRADES.map((u) => [u.id, u]));

export function getUpgrade(id: string): UpgradeDef | undefined {
  return BY_ID.get(id);
}

export const RARITY_PRICE: Readonly<Record<UpgradeRarity, number>> = Object.freeze({
  common: 45,
  rare: 75,
  epic: 110,
});

const RARITIES: readonly UpgradeRarity[] = ['common', 'rare', 'epic'];
const WEIGHTS: Record<UpgradeRarity, number> = { common: 60, rare: 30, epic: 10 };
const ELITE_WEIGHTS: Record<UpgradeRarity, number> = { common: 25, rare: 50, epic: 25 };

// Draws `count` distinct upgrade ids not yet at maxStacks: a rarity tier by weight
// (among tiers that still have candidates), then a uniform pick inside the tier.
// Returns fewer when the pool runs short.
export function drawOffer(
  rand: () => number,
  owned: Readonly<Record<string, number>>,
  opts: { elite?: boolean; count?: number } = {},
): string[] {
  const count = opts.count ?? 3;
  const weights = opts.elite ? ELITE_WEIGHTS : WEIGHTS;
  const pool = UPGRADES.filter((u) => (owned[u.id] ?? 0) < u.maxStacks);
  const out: string[] = [];
  while (out.length < count && pool.length > 0) {
    const tiers = RARITIES.filter((r) => pool.some((u) => u.rarity === r));
    const total = tiers.reduce((s, r) => s + weights[r], 0);
    let roll = rand() * total;
    let tier = tiers[tiers.length - 1];
    for (const r of tiers) {
      roll -= weights[r];
      if (roll < 0) {
        tier = r;
        break;
      }
    }
    const inTier = pool.filter((u) => u.rarity === tier);
    const chosen = inTier[Math.min(inTier.length - 1, Math.floor(rand() * inTier.length))];
    out.push(chosen.id);
    pool.splice(pool.indexOf(chosen), 1);
  }
  return out;
}
