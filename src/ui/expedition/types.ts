// Option shapes of the Expedition screens. The screens take plain data and callbacks
// only (no run rules): the integration layer reads the run and wires the callbacks.
import type { RunState, UpgradeDef } from '../../contracts.ts';

export interface OwnedUpgrade {
  def: UpgradeDef;
  stacks: number;
}

export interface StartOptions {
  dailyDate: string; // 'YYYY-MM-DD'
  dailyBest?: number; // best score of today's Daily run
  bestScore: number;
  runsPlayed: number;
  runsWon: number;
  resume?: { hp: number; maxHp: number; gold: number; battlesWon: number; daily?: string };
  onNew(): void;
  onDaily(): void;
  onResume?(): void;
  onBack(): void;
}

export interface MapOptions {
  run: RunState;
  available: readonly string[]; // node ids the player may enter now
  upgrades: readonly OwnedUpgrade[];
  onChoose(nodeId: string): void;
  onBack(): void;
  onAbandon(): void;
}

export interface PickOptions {
  title: string; // 'Victory!'
  elite: boolean;
  offer: readonly UpgradeDef[];
  owned: Readonly<Record<string, number>>; // upgrade id -> stacks
  hp: number; // run HP after this battle
  maxHp: number;
  hpLost: number;
  gold: number; // gold after this battle
  goldGained: number;
  onPick(id: string): void;
  onSkip(): void;
}

export interface ShopOptions {
  gold: number;
  hp: number;
  maxHp: number;
  items: readonly { def: UpgradeDef; price: number; sold: boolean; owned: number }[];
  heal: { price: number; amount: number; done: boolean };
  onBuy(index: number): void; // the screen stays up; show it again with the new data
  onHeal(): void; // likewise
  onLeave(): void;
}

export interface RestOptions {
  hp: number;
  maxHp: number;
  heal: number;
  onRest(): void;
}

export interface BattleLostOptions {
  hpLost: number;
  hp: number; // run HP after the loss
  maxHp: number;
  boss: boolean;
  coins?: { earned: number; total: number }; // campaign coins this battle paid out
  onContinue(): void;
}

export interface RunResultOptions {
  outcome: 'won' | 'lost';
  score: number;
  best?: number;
  newBest: boolean;
  daily?: string;
  stats: { battlesWon: number; battlesLost: number; goldEarned: number; hpLost: number; seconds: number };
  hp: number;
  maxHp: number;
  upgrades: readonly OwnedUpgrade[];
  coins?: { earned: number; total: number }; // campaign coins the run paid out
  onNewRun(): void;
  onMap(): void;
}

export interface ExpeditionScreens {
  showStart(o: StartOptions): void;
  showMap(o: MapOptions): void;
  showPick(o: PickOptions): void;
  showShop(o: ShopOptions): void;
  showRest(o: RestOptions): void;
  showBattleLost(o: BattleLostOptions): void;
  showRunResult(o: RunResultOptions): void;
  hide(): void;
  readonly visible: boolean;
}
