// What the player brings into a campaign battle (concept §2 and §4: loadout of two mob
// types, a champion and an ultimate). These shapes are shared word for word with the
// progression task, which turns owned items and upgrade tiers into a BattleLoadout; the
// battle layer only reads numbers from it. The cannon is not here: it reshapes the
// LevelDef (fire rate, units per shot, spread) before the battle is created.
//
// Unit variant bytes (render): UNIT_VARIANT in contracts.ts (0 rifleman / enemy mob,
// 1 knight, 2 sprinter, 3 bomber, 4 giant, 5 snowball, 6 archer, 8 sarge, 9 tank, 10 drummer,
// 11 Wind-up Robot).
//
// Milestone 5 gear: a mob may carry riders (the Giant drops them when it falls), the
// Blizzard ultimate freezes the enemy crowd for `power` seconds, and a cannon may fire
// rolling snowballs (BattleLoadout.shot) instead of loose mobs.
//
// Milestone 6 gear (World 3): an archer-like mob carries `ranged` (it shoots the nearest
// enemy ahead of it, sim SpawnOpts.ranged), the Wind-up Robot champion carries `gateWalk`
// (it walks the line of the first gate it reaches and re-triggers it), and the Gear Gun
// fires ricochet shots: each shot of the crowd mob gets a sideways speed of `angle` times
// its forward speed, alternating sides, and bounces off the lane walls `bounces` times.

export interface MobSpec {
  id: string;
  variant: number;
  kind: 'mob' | 'heavy';
  perShot: number | null; // null: the cannon's units per shot; else a fixed count (fractions carry over)
  hp: number;
  damage: number;
  radius: number;
  speed: number;
  deathBlast?: { radius: number; damage: number };
  riders?: number; // single mobs released when the unit dies (heavy slots: the Giant)
  ranged?: { range: number; every: number; damage: number }; // shoots an enemy within range every `every` s
}
export interface ChampionSpec {
  id: string;
  variant: number;
  hpMul: number;
  damageMul: number;
  radius: number;
  speed: number;
  chargeMul: number;
  echo: number;
  gateWalk?: { seconds: number; radius: number }; // walks a gate's line for `seconds`, re-triggering it
}
export interface UltimateSpec {
  id: 'barrage' | 'paratroopers' | 'marble' | 'blizzard';
  chargeNeeded: number;
  power: number; // barrage / paratroopers: mobs; marble: weight it flattens; blizzard: freeze seconds
}
// Snowball Launcher: each shot of the crowd mob is one rolling ball of the shot's weight
// that grows through gates and over lone mobs and bursts at burstWeight or on contact.
// Gear Gun: each shot of the crowd mob flies off at a slant (sideways speed = angle x its
// forward speed) and ricochets off the lane walls `bounces` times.
export type ShotSpec =
  | { kind: 'snowball'; burstWeight: number; maxRadius: number }
  | { kind: 'ricochet'; angle: number; bounces: number };
export interface BattleLoadout {
  mobs: [MobSpec, MobSpec];
  mixEvery: number;
  champion: ChampionSpec;
  ultimate: UltimateSpec;
  shot?: ShotSpec; // absent: the cannon fires loose mobs
}

// The starter loadout every new player owns: riflemen with a knight every 10th shot,
// Sarge and the Barrage. Tuned with the human autoplay so World 1 plays a little easier
// than without a loadout (Milestone 3 tuning) but keeps its curve: the brief's first
// draft (a knight every 5th shot, a 30-mob barrage every 120 mobs) won every attempt of
// every level about 35% faster, and the ultimate came round more often than the champion.
export const DEFAULT_BATTLE_LOADOUT: BattleLoadout = {
  mobs: [
    { id: 'rifleman', variant: 0, kind: 'mob', perShot: null, hp: 1, damage: 1, radius: 0.28, speed: 7 },
    { id: 'knight', variant: 1, kind: 'heavy', perShot: 1, hp: 10, damage: 10, radius: 0.55, speed: 5.5 },
  ],
  mixEvery: 10,
  champion: { id: 'sarge', variant: 8, hpMul: 1, damageMul: 1, radius: 1.0, speed: 4.5, chargeMul: 1, echo: 0 },
  ultimate: { id: 'barrage', chargeNeeded: 360, power: 20 },
};

// The mobs as the cannon fires them: [main, mix]. A crowd mob (perShot null) is always
// the main fire and a fixed-count mob the every-mixEvery-th mix, whichever slot the
// player put it in: a knight or bomber every shot outpaced the riflemen it replaced. Of
// two fixed-count mobs the lighter one is the main fire; two crowd mobs keep their order.
export function firingOrder(mobs: readonly [MobSpec, MobSpec]): [MobSpec, MobSpec] {
  const [m0, m1] = mobs;
  return m0.perShot !== null && (m1.perShot === null || m1.hp < m0.hp) ? [m1, m0] : [m0, m1];
}
