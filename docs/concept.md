# Single-Player Crowd Shooter: Design Concept

*Revised 2026-10-14. Working title: **Horde Run**. A personal, single-player web game built with **Babylon.js** that keeps Mob Control's core loop, with no ads, no multiplayer, no monetization and no store release. **Phone-first: it is played mainly in a mobile browser, and touch is the primary control scheme.** Background research: [mob-control.md](https://github.com/michelmattos/horde-run).*

## 1. The idea

Keep what makes Mob Control fun: one thumb aims a cannon, a trickle of units hits a x3 gate and becomes a flood, and the flood crashes into the enemy base. Drop everything that exists only to serve ads and fake PvP: rewarded-video boosts, interstitials, base raids, AI opponents dressed up as players, energy and timers, random card packs.

In their place go the things single-player games use to stay interesting: **a hand-built campaign, a roguelite run mode, bosses, and progression you earn by playing**. It runs in a phone's browser in portrait mode (desktop works too, as a secondary target), and it's built to be played by one person, so the only goal is that it's fun.

## 2. What stays (the core loop)

Unchanged from Mob Control, because it is the game:

1. Drag a thumb left and right to aim a cannon at the bottom of a vertical lane; it fires mobs on its own.
2. Mobs pass through **gates** (x2, x3, +10, moving gates, negative gates) and the crowd snowballs.
3. Enemy units and defenders come down the lane; units cancel on contact.
4. A charge meter launches a **Champion** for a big push.
5. Destroy the enemy base to win. Battles stay short: 60 to 120 seconds.

The one addition: **choices before and during battle** (loadout, champion, run upgrades). Without PvP, depth has to come from player decisions rather than opponents.

## 3. What replaces ads and PvP

| In Mob Control | Why it exists there | Replacement here |
|---|---|---|
| Rewarded ads (boosts, revives, 2x coins) | Revenue and pacing | Boosts earned in play; retry is free and instant |
| Interstitials | Revenue | Nothing. One battle flows into the next |
| Base raids / revenge / shields | Return hook, social pressure | **Your base as a home screen** you rebuild, plus **"invasion" story levels** where AI factions attack you |
| Champions League ladder | Status, retention | **Mastery stars** per level, **challenge tiers**, a **daily seeded run** with your own local best scores |
| Card packs (random) | Purchase driver | **Fixed unlocks**: each card comes from a specific level, boss or achievement, or is bought with in-game coins |
| Monthly Season Pass | Content refresh | New worlds and challenge levels whenever you feel like adding them |
| Energy / timers | Session limiting | None |

## 4. Game structure: three modes

### 4.1 Campaign (the spine)

- **Worlds of ~10 to 20 levels**, each with its own enemy faction, theme and signature mechanic, ending in a boss. Start with one world and add more over time; the six below are a menu, not a commitment.
- Every few levels introduce one new idea, then remix it (section 5).
- **3 stars per level, the same three goals everywhere** (decided 2026-10-14): 1 star for winning, 1 for finishing with your base above half health, 1 for beating the level's target time. Stars unlock later worlds and cosmetics.
- **No story** (decided 2026-10-14): each world opens with a title card, nothing more.
- **Difficulty: moderate** (decided 2026-10-14): early levels are easy, and the last few levels of a world plus its boss should take a retry or two.
- **Theme: toys** (decided 2026-10-14): your army is plastic toy soldiers fighting across a house, each world a different room with its own toy faction. The table below is a first pass at that, open to renaming.

| World | Faction | Signature mechanic |
|---|---|---|
| 1. Bedroom Floor | Rival plastic army (other colour) | Basics: static gates, simple defenders |
| 2. Freezer / Snow Globe | Snowmen and wind-up penguins | Ice lanes (mobs slide), freezing gates |
| 3. Clockwork Workshop | Wind-up robots | Moving gates, conveyor belts, timed doors |
| 4. Bathtub | Rubber ducks | Bubble gates (divide), enemy converts your units |
| 5. Science Fair | Chemistry-set slimes | Baking-soda lava, firecracker barrels you can trigger |
| 6. Top Shelf Castle | The Toy King's army | Multi-lane battlefields, everything combined |

### 4.2 Roguelite "Expedition" mode (the long-term replay engine)

This replaces the daily-login and PvP hooks. A run is a chain of ~10 to 15 battles on a branching map, in the style of *Slay the Spire*:

- **Start** with a basic cannon and a champion of your choice.
- **Between battles**, pick one of three **upgrades**: new gate types that spawn on your lanes, mob modifiers ("every 10th mob is a Knight"), cannon modifiers ("fires in bursts of 3, slower"), relics ("multiplier gates are +1 stronger, but enemy defenders have +20% HP").
- **Map nodes**: normal battle, elite (harder, better reward), shop (spend run gold), event (risk/reward choice), rest (heal base HP), boss.
- **Base HP carries over**: losing a battle costs base HP instead of ending the run. The run ends at 0 HP or after the final boss.
- **Synergies** are the point: "Splitter gates" + "units explode on death" + "Mass Abduction ultimate" becomes a build.
- **Ascension levels** (difficulty modifiers) after the first clear.
- **Daily Expedition**: one fixed seed per date, so each day has a fresh run to beat your own best on.

### 4.3 Challenge / puzzle levels

- Hand-made levels with **fixed loadouts and a limited number of mobs** ("you have 40 mobs, the base has 500 HP, find the route"). Gate placement becomes a puzzle.
- Cheap to make in volume once a level editor exists.

## 5. Level design variety

Without opponents, the levels must do the surprising. Building blocks, introduced in the campaign and recombined in Expedition:

- **Gates**: multiply, add, divide/subtract (traps), moving, toggling on a timer, one-use gates that break after N units, **forks** (left x2 vs right +30), stacked gates.
- **Lane geometry**: splits and merges, multiple lanes, ramps, chokepoints, rotating platforms, conveyor belts.
- **Hazards**: saws, lava, pits, wind that pushes the crowd, ice.
- **Enemy behaviours**: defenders that shoot, shield walls that need champions, healers, spawners, an enemy cannon that aims at you (the stand-in for a PvP rival).
- **Objectives besides "destroy base"**: escort a cart, hold for 60s, collect coins through gates, race the enemy crowd, rescue captured units who join you.
- **Unit types with roles**: swarmers (fast, weak), knights (tanky), archers (ranged), bombers (AoE on death), giants (slow, carry crowds). Each world unlocks one.

## 6. Bosses

Each world ends in a multi-phase boss that tests that world's mechanic:

- **Tin General**: rides a wind-up tank base that strafes across the lane; lead your shots.
- **Snow Globe Giant**: freezes your gates in phase 2; thaw them with fire mobs.
- **Jack-in-the-Box**: rearranges gates every 15 seconds.
- **Giant Rubber Duck**: bubble gates convert your crowd to its side; split your stream to avoid them.
- **Slime Volcano**: weak spots open briefly; time your champion.
- **The Toy King**: uses your own cannon types against you.

Bosses return in Expedition and get **Hard** variants for the endgame.

## 7. Progression

- **Cannons, mob types, champions and ultimates** keep Mob Control's card fantasy, but they are **unlocked, not gambled**. A collection screen shows how to get each one.
- **Upgrades** cost one currency (coins) earned in all modes, tuned so a normal playthrough maxes the gear you use. No grind wall.
- **Loadout**: pick a cannon, two mob types, a champion and an ultimate before each campaign level.
- **Home base**: rebuild your village between worlds with coins. Mostly visual, with small perks (+5% starting crowd).
- **Expedition unlocks**: finishing runs adds starting champions, new upgrades to the pool, and ascension levels. They widen options rather than raw power.
- **Achievements and cosmetics**: mob, cannon and base skins, trails, victory effects.

## 8. Technical plan (Babylon.js web game)

### Stack

| Piece | Choice | Why |
|---|---|---|
| Engine | **Babylon.js** (`@babylonjs/core` ES modules, latest stable) | As requested; WebGL2 with WebGPU available later |
| Language / build | **TypeScript + Vite** | Fast reload while tuning feel; static build output |
| UI | **Babylon GUI** for in-battle HUD, plain HTML/CSS for menus | Menus are easier in HTML and get native touch scrolling; HUD stays in the canvas |
| Physics | **None** (custom simulation) | A physics engine can't handle thousands of units cheaply; mobs only need simple movement and overlap tests |
| Assets | Low-poly glTF models (e.g. Kenney/Quaternius CC0 packs) or simple primitives first | Free, light, good enough for a personal game |
| Saves | `localStorage` (JSON save file) with export/import | No server needed |
| Hosting | A static host (e.g. GitHub Pages) so the phone can load it; `npm run dev --host` to test on the phone over Wi-Fi while developing | No backend at all |
| Install | **Progressive Web App** (manifest + service worker) | "Add to Home Screen" gives full-screen, portrait-locked play with no browser bars, and works offline |

### Crowd simulation (the hard part)

The fun depends on thousands of units on screen at 60 fps, so the simulation is data-oriented:

- **Units in flat typed arrays** (position x/z, velocity, hp, type, team, flags) instead of one object or mesh per mob. Update everything in one loop each frame.
- **Rendering with thin instances**: one mesh per unit type, positions written to a single matrix buffer each frame (`thinInstanceSetBuffer`). Thousands of mobs become a handful of draw calls.
- **Animation** with Babylon's **baked vertex animation** (`BakedVertexAnimationManager`) so running/attacking animations play on the GPU for all instances. Start with a simple bob-and-squash in the vertex shader if that's quicker.
- **Spatial hash grid** over the lane for unit-vs-unit cancellation, separation and hits on defenders.
- **Gates**: when a unit crosses a gate's line inside its width, apply the effect once (each unit remembers which gates it passed). Multipliers clone the unit with a small spread so the crowd visibly "bursts".
- **Unit cap**: above a set budget (about 1,500 live units on a phone, more on desktop), new units merge into "stacked" mobs that count as several, so the crowd keeps growing without killing the frame rate. Mob Control does something similar.
- **Fixed timestep** (e.g. 60 Hz) separate from rendering, plus a **seeded RNG**, so the daily Expedition seed is reproducible.

### Code structure

```
src/
  main.ts            boot, engine, scene switching
  core/              loop, input (pointer drag), seeded RNG, save system
  sim/               unit arrays, spatial grid, movement, combat, gates
  render/            thin-instance renderers, VAT animation, effects
  game/              battle rules, cannon, champions, ultimates, bosses
  meta/              campaign map, Expedition map + upgrades, shop, collection
  ui/                HUD (Babylon GUI), menus (HTML)
  data/
    levels/*.json    level layouts: lane geometry, gates, enemies, objectives
    units.json       unit stats; cannons, champions, upgrades
```

Levels are **data, not code**, so they can be edited quickly and later built with an **in-browser level editor** (drag gates and defenders onto a lane, test instantly). The editor is touch-friendly too, so levels can be tweaked on the phone.

### Touch controls (first-class)

Touch is the primary input. Mouse and keyboard are mapped onto the same actions afterwards, never the other way round.

- **One-thumb play.** Everything in a battle is reachable with the thumb of the hand holding the phone. The cannon fires on its own; drag left and right anywhere in the lower part of the screen to aim.
- **Relative drag, not tap-to-aim.** The cannon follows the finger's horizontal movement from where it touched down, so the thumb never covers the cannon and you can aim from anywhere along the bottom. Sensitivity is a setting.
- **Instant response.** Input is read every frame from raw pointer events, with at most a tiny smoothing on the cannon, so aiming feels glued to the finger.
- **Champion and ultimate as big buttons** in the bottom corners (at least 56 px, clear of the screen edges and the home indicator), filling up as they charge. A second finger can tap them while the first keeps aiming (multi-touch tracked by pointer id).
- **No hover, no right-click, no tiny targets.** Every menu control is at least 48 px, and tooltips become tap-to-inspect.
- **Browser gestures switched off on the game canvas**: `touch-action: none`, no text selection or long-press menu, no double-tap zoom, no pull-to-refresh or swipe-back during battle.
- **Haptics** through the Vibration API where the phone supports it (a light tick on gate multiply, a bump on champion launch), with a toggle. iPhone browsers ignore it, and Michel plays on an iPhone, so feedback must land through visuals and sound instead.
- **Pause on interruption**: the game pauses when the tab is hidden, a call comes in, or the phone leaves portrait.
- **Mouse and keyboard** for desktop play map to the same actions: click-and-drag to aim, Space for the champion, E for the ultimate.

### Screen, layout and camera

- **Portrait first**: levels are designed for a tall phone screen. Wider screens show more scenery at the sides, never more lane.
- **Safe areas**: the HUD stays clear of notches and the home indicator (`env(safe-area-inset-*)`), and the layout uses `100dvh` so the browser's collapsing toolbar doesn't crop the game.
- **Readable at arm's length**: big gate numbers and high-contrast team colours, legible on a 6-inch screen.
- Fixed, tilted top-down camera looking up the lane, with a gentle zoom-out as the crowd grows. **No screen shake, ever** (decided 2026-10-14); big hits read through flashes, particles and sound instead.

### Phone performance

- **Target device: Michel's iPhone 17 Pro Max** (decided 2026-10-14), so Safari/WebKit on iOS is the browser that matters most. Hold a steady 60 fps there (capped, for heat and battery, even though the screen can do 120 Hz), and test in mobile Safari and as a home-screen app at every milestone. iOS can't lock orientation from the web, so leaving portrait pauses and shows a rotate prompt.
- **Resolution scaling**: render at a capped pixel ratio (e.g. 1.5 instead of 3) through Babylon's hardware scaling, and lower it automatically if frames start running long.
- **Cheap visuals**: simple materials, baked lighting, no real-time shadows on mobs (a blob shadow at most), pooled particle effects.
- **Heat and battery**: cap at 60 fps, stop rendering in static menus, and pause fully when hidden.
- **Small download**: compressed textures and models, one texture atlas per world, so the first load is quick on mobile data.

## 9. Build plan

Milestones sized for a personal project, each one playable:

1. **Core feel prototype**: one lane, cannon aiming, mobs, x2/x3/+N gates, enemy mobs and a base to destroy. Built and tuned on a phone from day one: touch aiming, full-screen portrait, installable as an app. Tune until it's satisfying with no menus at all, and check the frame rate on the phone with 1,000+ units.
2. **One complete world**: 10 levels from JSON, defenders, one champion, one boss, stars, and saved progress.
3. **Expedition prototype**: a 5-battle run with 15 to 20 upgrades and a branching map. See whether it's more replayable than the campaign.
4. **Progression and polish**: loadouts, unlocks, coins, sound, particles, home base.
5. **Level editor**, then more worlds, unit types, bosses and challenge levels at whatever pace is fun.

## 10. Open questions

- ~~Theme~~ **Decided:** toys (plastic soldiers across a house; see section 4.1).
- ~~Where the code lives~~ **Decided:** GitHub repo [michelmattos/horde-run](https://github.com/michelmattos/horde-run), live at https://michelmattos.github.io/horde-run/.
- ~~Your phone~~ **Decided:** iPhone 17 Pro Max (see Phone performance).
- ~~Name~~ **Decided:** keep "Horde Run".
- Also decided 2026-10-14: fixed three-goal stars, moderate difficulty, no story (section 4.1), and no screen shake (section 8).
