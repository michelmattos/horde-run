// The modifiers layer: owned upgrades turn a generated battle into the battle actually
// played. applyUpgrades is the only way upgrades touch a battle. It edits plain LevelDef
// numbers and gates, and puts the rule changes the LevelDef cannot express into
// LevelDef.mods for battle.ts. Pure: the input level is deep-copied, never mutated.
import type { BattleMods, GateDef, LevelDef } from '../contracts.ts';
import { cardsClash } from '../game/gateSpacing.ts';
import { getUpgrade } from './upgrades.ts';

const MAX_GATES = 32; // sim limit (gates crossed are tracked in a 32-bit mask)
const GATE_Z_MIN = 6; // nearest gate line: just past the muzzle (z 1.5), still clear of the bottom HUD
const GATE_GAP = 3; // min z distance from any other gate line (cards overlapping in x: CARD_CLEAR_Z)
const SIDE_GAP = 0.3; // min clear space between gates side by side on one line
const SIDE_SHIFTS = [0, -0.5, 0.5, -1, 1, -1.5, 1.5, -2, 2, -2.5, 2.5, -3, 3]; // sideways nudges tried when a z is taken
const SHIFT_COST = 1.5; // one unit sideways counts as 1.5 units of z away from the preferred spot
const DEFENDER_GAP = 2.5; // min z distance from any defender
const LANE_MARGIN = 0.3; // gates stay this far inside the lane edge
const SWIVEL_EDGE = 0.6; // swivel never aims closer than this to the lane edge
const MIN_CHARGE = 20;
// Add gates give +value to every soldier that crosses (a +2 gate triples a stream of
// single soldiers), so the run's add gates are brittle: they break after `uses` crossings.
const SUPPLY = { value: 2, uses: 120 };
const FORK_ADD = { value: 3, uses: 150 };
const KNIGHT_EVERY = [10, 7, 5]; // shots per knight, by stacks (the card counts shots, battle.ts mobs)
const KNIGHT = { hp: 18, damage: 12, radius: 0.6 };

// Stacks owned of a known upgrade, clamped to [0, maxStacks]; unknown ids count 0.
function stacks(upgrades: Readonly<Record<string, number>>, id: string): number {
  const def = getUpgrade(id);
  const n = upgrades[id];
  if (!def || typeof n !== 'number' || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(def.maxStacks, Math.floor(n)));
}

interface GatePlan {
  upgradeId: string;
  at: number; // preferred z as a fraction of the player's half [GATE_Z_MIN, length/2]
  gates: Pick<GateDef, 'op' | 'value' | 'x' | 'width' | 'move' | 'uses'>[];
}

// Added gates in a fixed order so placement is deterministic: rarest first, so when the
// lane is full it is a common gate that does not fit.
function gatePlans(upgrades: Readonly<Record<string, number>>, hw: number): GatePlan[] {
  const plans: GatePlan[] = [];
  if (stacks(upgrades, 'tripler') > 0) {
    const width = 2.4;
    const amplitude = Math.max(0.1, Math.min(1.8, hw - LANE_MARGIN - width / 2));
    plans.push({
      upgradeId: 'tripler',
      at: 0.85,
      gates: [{ op: 'mul', value: 3, x: 0, width, move: { amplitude, period: 7 } }],
    });
  }
  if (stacks(upgrades, 'fork') > 0)
    plans.push({
      upgradeId: 'fork',
      at: 0.55,
      gates: [
        { op: 'mul', value: 2, x: -1.7, width: 3 },
        { op: 'add', value: FORK_ADD.value, uses: FORK_ADD.uses, x: 1.7, width: 3 },
      ],
    });
  // Two Supply Gates stand side by side, so they share the line in front of the cannon.
  const supply = stacks(upgrades, 'supply');
  const supplyX = supply > 1 ? [-1.85, 1.85] : [0];
  if (supply > 0)
    plans.push({
      upgradeId: 'supply',
      at: 0,
      gates: supplyX
        .slice(0, supply)
        .map((x) => ({ op: 'add', value: SUPPLY.value, uses: SUPPLY.uses, x, width: 3.4 })),
    });
  const doublerAt = [0.3, 0.7, 0.5];
  const doublerX = [-2, 2, 0];
  for (let i = 0; i < stacks(upgrades, 'doubler'); i++)
    plans.push({ upgradeId: 'doubler', at: doublerAt[i], gates: [{ op: 'mul', value: 2, x: doublerX[i], width: 3 }] });
  return plans;
}

// Two gates on the same line with a clear gap between their hit widths (a fork).
function sideBySide(a: GateDef, b: GateDef): boolean {
  if (a.z !== b.z) return false;
  const reach = (g: GateDef): number => g.width / 2 + Math.abs(g.move?.amplitude ?? 0);
  return Math.abs(a.x - b.x) - reach(a) - reach(b) >= SIDE_GAP;
}

// Where a plan's gates go: the nearest z to `preferred` (0.5 steps) inside [zMin, zMax],
// shifted sideways when that is closer, that keeps every gate GATE_GAP from any other gate
// line, CARD_CLEAR_Z from any gate whose sign card it would cover or be covered by, and
// clear of defenders. Null when the player's half is full.
function place(level: LevelDef, plan: GateDef[], preferred: number, zMin: number, zMax: number): GateDef[] | null {
  const hw = level.lane.width / 2;
  const fits = (gates: GateDef[]): boolean =>
    gates.every(
      (g) =>
        Math.abs(g.x) + (g.move?.amplitude ?? 0) + g.width / 2 <= hw - LANE_MARGIN + 1e-9 &&
        level.gates.every((o) => (Math.abs(o.z - g.z) >= GATE_GAP || sideBySide(o, g)) && !cardsClash(o, g)) &&
        (level.defenders ?? []).every((d) => Math.abs(d.z - g.z) >= DEFENDER_GAP),
    );
  const start = Math.round(Math.min(zMax, Math.max(zMin, preferred)) * 2) / 2;
  const candidates: { z: number; dx: number; cost: number }[] = [];
  for (let z = zMin; z <= zMax + 1e-9; z += 0.5)
    for (const dx of SIDE_SHIFTS) candidates.push({ z, dx, cost: Math.abs(z - start) + SHIFT_COST * Math.abs(dx) });
  candidates.sort((a, b) => a.cost - b.cost || a.z - b.z || a.dx - b.dx);
  for (const c of candidates) {
    const moved = plan.map((g) => ({ ...g, x: g.x + c.dx, z: c.z }));
    if (fits(moved)) return moved;
  }
  return null;
}

function addGates(level: LevelDef, upgrades: Readonly<Record<string, number>>): void {
  const hw = level.lane.width / 2;
  const zMin = GATE_Z_MIN;
  const zMax = level.lane.length * 0.5;
  if (zMax < zMin) return;
  const ids = new Set(level.gates.map((g) => g.id));
  const counter: Record<string, number> = {};
  for (const plan of gatePlans(upgrades, hw)) {
    if (level.gates.length + plan.gates.length > MAX_GATES) continue;
    const drafts = plan.gates.map((g): GateDef => {
      const width = Math.min(g.width, 2 * (hw - LANE_MARGIN));
      const reach = g.move?.amplitude ?? 0;
      const limit = Math.max(0, hw - LANE_MARGIN - width / 2 - reach);
      const gate: GateDef = {
        id: '',
        op: g.op,
        value: g.value,
        x: Math.max(-limit, Math.min(limit, g.x)),
        z: 0,
        width,
      };
      if (g.move) gate.move = { ...g.move };
      if (g.uses !== undefined) gate.uses = g.uses;
      return gate;
    });
    const placed = place(level, drafts, zMin + plan.at * (zMax - zMin), zMin, zMax);
    if (!placed) continue;
    for (const g of placed) {
      do {
        counter[plan.upgradeId] = (counter[plan.upgradeId] ?? 0) + 1;
        g.id = `up-${plan.upgradeId}-${counter[plan.upgradeId]}`;
      } while (ids.has(g.id));
      ids.add(g.id);
      level.gates.push(g);
    }
  }
}

function scaleMods(
  base: BattleMods | undefined,
  upgrades: Readonly<Record<string, number>>,
  unitsPerShot: number,
): BattleMods {
  const mods: BattleMods = structuredClone(base ?? {});
  const tough = stacks(upgrades, 'tough');
  if (tough) mods.mobHp = (mods.mobHp ?? 1) * 1.25 ** tough;
  const sharp = stacks(upgrades, 'sharp');
  if (sharp) mods.mobDamage = (mods.mobDamage ?? 1) * 1.3 ** sharp;
  const knights = stacks(upgrades, 'knights');
  if (knights) {
    const every = KNIGHT_EVERY[knights - 1] * Math.max(1, unitsPerShot);
    mods.knightEvery = mods.knightEvery !== undefined ? Math.min(mods.knightEvery, every) : every;
    mods.knight ??= { ...KNIGHT };
  }
  const big = stacks(upgrades, 'bigchamp');
  if (big && mods.knight) {
    mods.knight.hp *= 1.25 ** big;
    mods.knight.damage *= 1.25 ** big;
  }
  const reinforce = stacks(upgrades, 'reinforce');
  if (reinforce) mods.startCrowd = (mods.startCrowd ?? 0) + 25 * reinforce;
  if (stacks(upgrades, 'scatter')) mods.shotSpread = Math.max(mods.shotSpread ?? 0, 0.6);
  if (stacks(upgrades, 'burst')) mods.burst = { shots: 3, gap: 0.08 };
  const rally = stacks(upgrades, 'rally');
  if (rally) mods.championEcho = (mods.championEcho ?? 0) + 30 * rally;
  return mods;
}

export function applyUpgrades(level: LevelDef, upgrades: Readonly<Record<string, number>>): LevelDef {
  const out: LevelDef = structuredClone(level);

  // 1. Gates from upgrades, then Overcharge (so it also boosts those).
  addGates(out, upgrades);
  const overcharge = stacks(upgrades, 'overcharge') > 0;
  if (overcharge) for (const g of out.gates) if (g.op === 'mul') g.value += 1;

  // 2. Cannon.
  let fire = 1.2 ** stacks(upgrades, 'rapid');
  if (stacks(upgrades, 'burst')) fire *= 0.45;
  if (stacks(upgrades, 'glass')) fire *= 1.4;
  out.cannon.fireRate *= fire;
  out.cannon.unitsPerShot = Math.round(out.cannon.unitsPerShot) + stacks(upgrades, 'scatter');
  if (stacks(upgrades, 'swivel')) {
    const cap = out.lane.width / 2 - SWIVEL_EDGE;
    out.cannon.aimLimit = Math.max(out.cannon.aimLimit, Math.min(out.cannon.aimLimit + 1, cap));
  }

  // 3. Champion.
  const pep = stacks(upgrades, 'pep');
  out.champion.chargeNeeded = Math.max(MIN_CHARGE, Math.round(out.champion.chargeNeeded * 0.8 ** pep));
  const big = 1.5 ** stacks(upgrades, 'bigchamp');
  out.champion.hp *= big;
  out.champion.damage *= big;

  // 4. Fort (this battle only).
  if (stacks(upgrades, 'glass')) out.playerBase.hp = Math.max(1, Math.round(out.playerBase.hp * 0.7));

  // 5. Enemy scaling.
  let defenderHp = 1;
  if (overcharge) defenderHp *= 1.2;
  if (stacks(upgrades, 'sapper')) defenderHp *= 0.7;
  if (defenderHp !== 1 && out.defenders)
    for (const d of out.defenders) d.hp = Math.max(1, Math.round(d.hp * defenderHp));
  if (stacks(upgrades, 'chest')) {
    for (const w of out.enemyWaves) w.count = Math.max(1, Math.round(w.count * 1.1));
    if (out.enemySpawnRate) out.enemySpawnRate.perSecond *= 1.1;
    if (out.boss) for (const ph of out.boss.phases) if (ph.trickle !== undefined) ph.trickle *= 1.1;
  }

  // 6. Battle mods, merged onto any the generator set.
  const mods = scaleMods(out.mods, upgrades, out.cannon.unitsPerShot);
  if (Object.keys(mods).length > 0) out.mods = mods;
  return out;
}
