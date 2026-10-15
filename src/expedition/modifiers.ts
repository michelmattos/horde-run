// The modifiers layer: owned upgrades turn a generated battle into the battle actually
// played. applyUpgrades is the only way upgrades touch a battle. It edits plain LevelDef
// numbers and gates, and puts the rule changes the LevelDef cannot express into
// LevelDef.mods for battle.ts. Pure: the input level is deep-copied, never mutated.
// The World 2 upgrades work the same way: Frost Gate adds a freezing gate, Ice Rink an
// ice patch, and Ice Skates, Hot Cocoa and Avalanche set the World 2 BattleMods. World 3:
// Clockwork Gate adds a timed x3 and keeps every timed gate open longer, Rubber Boots,
// Saw Guards, Crowbar and Bank Shot set the World 3 BattleMods (Saw Guards costs enemy
// defender HP, Crowbar also hits harder, Bank Shot also fires faster). Added gates keep
// clear of belts, turntables and saws.
import type { BattleMods, GateDef, IceWallDef, LevelDef } from '../contracts.ts';
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
const FROST = { value: 3, freeze: { after: 40, duration: 3, hp: 30 } }; // Frost Gate: x3 that ices over
const ICE_WALL_GAP = 1; // min z clearance between an added gate and an ice wall it overlaps in x
// Ice Rink: an ice patch from just past the muzzle, most of the lane wide.
const RINK = { z: 2.5, length: 8, edge: 0.5 };
const SKATES_GRIP = 0.45; // iceGrip per stack (cap 0.9: a little slide always stays)
const COCOA = { thawRate: 2, freezeAfter: 1.5, waves: 1.1, more: 0.75 }; // more: x on snowman/penguin intervals
const AVALANCHE = { radius: 3, seconds: 2, perStack: 1 }; // champion landing freeze; +1 radius and s per extra stack
const CLOCKWORK = { value: 3, toggle: { on: 3, off: 2 }, open: 1.5 }; // the added x3; open: x on every timed gate's on time
const BOOTS_GRIP = [0.5, 0.9]; // beltGrip by stacks
const SAWGUARD = { guard: 0.75, defenderHp: 1.25 };
const CROWBAR = { shieldBreak: 0.5, champion: 1.25 }; // shield damage per weight; champion damage x
const BANKSHOT = { every: [4, 2], fire: 1.1 }; // ricochetEvery by stacks; fire rate x per stack
const HAZARD_GAP = 1.5; // min clearance between an added gate line and a belt, turntable or saw track

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
  gates: Pick<GateDef, 'op' | 'value' | 'x' | 'width' | 'move' | 'uses' | 'freeze' | 'toggle'>[];
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
  if (stacks(upgrades, 'clockwork') > 0)
    plans.push({
      upgradeId: 'clockwork',
      at: 0.65,
      gates: [{ op: 'mul', value: CLOCKWORK.value, x: -1, width: 3, toggle: { ...CLOCKWORK.toggle } }],
    });
  if (stacks(upgrades, 'frost-gate') > 0)
    plans.push({
      upgradeId: 'frost-gate',
      at: 0.4,
      gates: [{ op: 'mul', value: FROST.value, x: 1, width: 3, freeze: { ...FROST.freeze } }],
    });
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

// A gate whose hit width overlaps an ice wall in x must stand clear of it in z.
function clearOfIceWall(g: GateDef, w: IceWallDef): boolean {
  const apartX = Math.abs(g.x - w.x) - g.width / 2 - Math.abs(g.move?.amplitude ?? 0) - w.width / 2 >= SIDE_GAP;
  return apartX || Math.abs(g.z - w.z) >= w.depth / 2 + ICE_WALL_GAP;
}

// A gate line must keep clear of belts, turntables and the z span of saw tracks.
function clearOfHazards(level: LevelDef, g: GateDef): boolean {
  const z = g.z;
  for (const c of level.conveyors ?? []) if (z > c.z - HAZARD_GAP && z < c.z + c.length + HAZARD_GAP) return false;
  for (const t of level.turntables ?? []) if (Math.abs(z - t.z) < t.radius + HAZARD_GAP) return false;
  for (const s of level.saws ?? []) {
    const dz = s.path?.dz ?? 0;
    if (z > Math.min(s.z, s.z + dz) - s.radius - HAZARD_GAP && z < Math.max(s.z, s.z + dz) + s.radius + HAZARD_GAP)
      return false;
  }
  return true;
}

// Where a plan's gates go: the nearest z to `preferred` (0.5 steps) inside [zMin, zMax],
// shifted sideways when that is closer, that keeps every gate GATE_GAP from any other gate
// line, CARD_CLEAR_Z from any gate whose sign card it would cover or be covered by, and
// clear of defenders and ice walls. Null when the player's half is full.
function place(level: LevelDef, plan: GateDef[], preferred: number, zMin: number, zMax: number): GateDef[] | null {
  const hw = level.lane.width / 2;
  const fits = (gates: GateDef[]): boolean =>
    gates.every(
      (g) =>
        Math.abs(g.x) + (g.move?.amplitude ?? 0) + g.width / 2 <= hw - LANE_MARGIN + 1e-9 &&
        level.gates.every((o) => (Math.abs(o.z - g.z) >= GATE_GAP || sideBySide(o, g)) && !cardsClash(o, g)) &&
        (level.defenders ?? []).every((d) => Math.abs(d.z - g.z) >= DEFENDER_GAP) &&
        (level.iceWalls ?? []).every((w) => clearOfIceWall(g, w)) &&
        clearOfHazards(level, g),
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
      if (g.freeze) gate.freeze = { ...g.freeze };
      if (g.toggle) gate.toggle = structuredClone(g.toggle);
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
  const skates = stacks(upgrades, 'skates');
  if (skates) mods.iceGrip = Math.min(0.9, (mods.iceGrip ?? 0) + SKATES_GRIP * skates);
  if (stacks(upgrades, 'cocoa')) {
    mods.thawRate = (mods.thawRate ?? 1) * COCOA.thawRate;
    mods.freezeAfter = (mods.freezeAfter ?? 1) * COCOA.freezeAfter;
  }
  const boots = stacks(upgrades, 'boots');
  if (boots) mods.beltGrip = Math.max(mods.beltGrip ?? 0, BOOTS_GRIP[boots - 1]);
  if (stacks(upgrades, 'sawguard')) mods.sawGuard = Math.max(mods.sawGuard ?? 0, SAWGUARD.guard);
  if (stacks(upgrades, 'crowbar')) mods.shieldBreak = (mods.shieldBreak ?? 0) + CROWBAR.shieldBreak;
  const bank = stacks(upgrades, 'bankshot');
  if (bank) {
    const every = BANKSHOT.every[bank - 1];
    mods.ricochetEvery = mods.ricochetEvery !== undefined ? Math.min(mods.ricochetEvery, every) : every;
  }
  const avalanche = stacks(upgrades, 'avalanche');
  if (avalanche) {
    const extra = AVALANCHE.perStack * (avalanche - 1);
    const prev = mods.championFreeze;
    mods.championFreeze = {
      radius: Math.max(prev?.radius ?? 0, AVALANCHE.radius + extra),
      seconds: Math.max(prev?.seconds ?? 0, AVALANCHE.seconds + extra),
    };
  }
  return mods;
}

// Ice Rink: an ice patch in front of the cannon, so fresh shots slide apart.
function addRink(level: LevelDef): void {
  const width = Math.max(1, level.lane.width - 2 * RINK.edge);
  const length = Math.min(RINK.length, level.lane.length * 0.5 - RINK.z);
  if (length <= 0) return;
  level.ice = [...(level.ice ?? []), { x: 0, z: RINK.z, width, length }];
}

export function applyUpgrades(level: LevelDef, upgrades: Readonly<Record<string, number>>): LevelDef {
  const out: LevelDef = structuredClone(level);

  // 1. Gates and ice from upgrades, then Overcharge (so it also boosts those).
  addGates(out, upgrades);
  if (stacks(upgrades, 'rink')) addRink(out);
  const overcharge = stacks(upgrades, 'overcharge') > 0;
  if (overcharge) for (const g of out.gates) if (g.op === 'mul') g.value += 1;
  if (stacks(upgrades, 'clockwork'))
    for (const g of out.gates) if (g.toggle) g.toggle.on = Math.round(g.toggle.on * CLOCKWORK.open * 100) / 100;

  // 2. Cannon.
  let fire = 1.2 ** stacks(upgrades, 'rapid');
  if (stacks(upgrades, 'burst')) fire *= 0.45;
  if (stacks(upgrades, 'glass')) fire *= 1.4;
  fire *= BANKSHOT.fire ** stacks(upgrades, 'bankshot');
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
  if (stacks(upgrades, 'crowbar')) out.champion.damage *= CROWBAR.champion;

  // 4. Fort (this battle only).
  if (stacks(upgrades, 'glass')) out.playerBase.hp = Math.max(1, Math.round(out.playerBase.hp * 0.7));

  // 5. Enemy scaling.
  let defenderHp = 1;
  if (overcharge) defenderHp *= 1.2;
  if (stacks(upgrades, 'sapper')) defenderHp *= 0.7;
  if (stacks(upgrades, 'sawguard')) defenderHp *= SAWGUARD.defenderHp;
  if (defenderHp !== 1 && out.defenders)
    for (const d of out.defenders) d.hp = Math.max(1, Math.round(d.hp * defenderHp));
  let waves = 1;
  if (stacks(upgrades, 'chest')) waves *= 1.1;
  const cocoa = stacks(upgrades, 'cocoa') > 0;
  if (cocoa) waves *= COCOA.waves;
  if (waves !== 1) {
    for (const w of out.enemyWaves) w.count = Math.max(1, Math.round(w.count * waves));
    if (out.enemySpawnRate) out.enemySpawnRate.perSecond *= waves;
    if (out.boss) for (const ph of out.boss.phases) if (ph.trickle !== undefined) ph.trickle *= waves;
  }
  // Hot Cocoa's other cost: the World 2 enemies come more often.
  if (cocoa) {
    if (out.trickleMix) out.trickleMix.every = Math.max(2, Math.round(out.trickleMix.every * COCOA.more));
    for (const d of out.defenders ?? []) if (d.spawn) d.spawn.every *= COCOA.more;
  }

  // 6. Battle mods, merged onto any the generator set.
  const mods = scaleMods(out.mods, upgrades, out.cannon.unitsPerShot);
  if (Object.keys(mods).length > 0) out.mods = mods;
  return out;
}
